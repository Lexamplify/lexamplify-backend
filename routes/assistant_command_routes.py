"""POST /api/assistant/command - the executive assistant's one route (checkpoint 1B).

What it does: reads one command, works out which feature it is about, and returns a PROPOSAL.

What it does NOT do, by design:
  * It never changes the lawyer's data. The only rows it writes are its own history. A proposed action that would
    change or send anything comes back with requires_confirm=true and is carried out later, by the existing endpoint,
    after the lawyer clicks Confirm.
  * It never sends document text, case records or client notes to a model. The model sees the command and at most four
    short feature descriptions from the registry - nothing else exists in this file to send.
  * It never trusts the model. Whatever comes back is checked against the registry allowlist (and against the very
    features that were offered) before it reaches the browser.

Workspace rule. Routing a command reads no workspace data (the model sees only the command and the registry feature
list), so a command works WITHOUT a workspace: nothing is saved to history and nothing workspace-scoped is touched. What is
NOT optional, and is enforced even when the app is in "observe" mode: a workspace id that is not valid is refused (400), and
one this user cannot reach is refused (403). Anything that WOULD read workspace data must call require_workspace_for_data(),
which refuses (403 NO_WORKSPACE) when there is no workspace - it never falls back to "everything".
"""
from __future__ import annotations

import logging
import threading
import time
import uuid

from flask import Blueprint, g, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required, verify_jwt_in_request

# Imported here, at module level, ON PURPOSE: app.py imports this blueprint while building the app, which registers the
# two tables in the metadata BEFORE create_all() runs. Importing them inside the view instead would mean create_all()
# never saw them, and a fresh deployment would quietly run with no history at all.
from models.assistant_history import AssistantConversation, AssistantMessage  # noqa: F401 - registers the tables
from utils import assistant_router as router
from utils import feature_registry as reg
from utils.limiter import limiter

log = logging.getLogger("app")

assistant_command_bp = Blueprint("assistant_command", __name__, url_prefix="/api/assistant")

# Two different limits. The generous one covers every command, including the ones a rule settles with no model call;
# the strict one covers only the commands that actually spend tokens.
RATE_ALL = "60 per minute"
MODEL_CALLS_PER_MINUTE = 6
_MODEL_WINDOW_SECONDS = 60.0

_model_calls: dict[str, list] = {}
_model_calls_lock = threading.Lock()


def _user_key():
    """Rate-limit bucket: the signed-in person (an office shares one address), else the address."""
    try:
        verify_jwt_in_request(optional=True)
        ident = get_jwt_identity()
    except Exception:  # noqa: BLE001
        ident = None
    return f"assistant-user:{ident}" if ident else f"assistant-ip:{request.remote_addr}"


def _model_budget_left(user_id) -> bool:
    """True when this person may spend another model call this minute. Counts only model-backed commands."""
    now = time.time()
    key = str(user_id)
    with _model_calls_lock:
        times = [t for t in _model_calls.get(key, []) if now - t < _MODEL_WINDOW_SECONDS]
        if len(times) >= MODEL_CALLS_PER_MINUTE:
            _model_calls[key] = times
            return False
        times.append(now)
        _model_calls[key] = times
        return True


def reset_model_call_counter():
    """For tests: forget this process's per-minute model-call counts."""
    with _model_calls_lock:
        _model_calls.clear()


def _err(code, message, status, **extra):
    body = {"error": True, "code": code, "message": message, "request_id": getattr(g, "request_id", None), **extra}
    resp = jsonify(body)
    resp.status_code = status
    return resp


def _reply(intent, *, understood=None, feature=None, action=None, inputs=None, requires_confirm=False, route=None,
           question=None, choices=None, conversation_id=None, model_used=False, history=None, auto_open=False):
    body = {
        "intent": intent,
        "understood": understood,
        "feature": feature,
        "action": action,
        "inputs": inputs or {},
        "requires_confirm": bool(requires_confirm),
        "route": route,
        "question": question,
        "choices": choices or [],
        "conversationId": conversation_id,
        "modelUsed": bool(model_used),
        "history": history if history is not None else [],
        "requestId": getattr(g, "request_id", None),
    }
    # autoOpen is present ONLY when the page may jump there by itself, and only for a command a rule settled with an explicit
    # opening verb or a multi-word feature name. A reply without the key means "do not auto-open". A model-backed reply
    # never carries it. The page opens by itself only when it is exactly true.
    if auto_open is True:
        body["autoOpen"] = True
    return jsonify(body)


class NoWorkspaceError(Exception):
    """Raised by require_workspace_for_data when something that needs a workspace is asked for without one."""


def require_workspace_for_data(workspace_id):
    """Every lookup of workspace DATA (cases, documents, matters, clients, anything scoped to a client workspace) must call
    this first, with the workspace id the request resolved to. No workspace -> 403 NO_WORKSPACE, never "everything".

    Nothing in the assistant reads workspace data today, so nothing calls it yet; it exists so that the day something does,
    the rule is one line and cannot be forgotten. Returns the id when there is one.
    """
    if workspace_id is None:
        raise NoWorkspaceError("this needs a client workspace")
    return workspace_id


@assistant_command_bp.app_errorhandler(NoWorkspaceError)
def _no_workspace(_exc):
    return _err("NO_WORKSPACE", "Please choose a client workspace first.", 403)


def _current_workspace_or_error():
    """(workspace_id, None) or (None, error response).

    No workspace header (or an empty one) is allowed and gives (None, None): routing a command reads no workspace data.
    A workspace id that is not a positive integer is a 400, and one this user is not a member of is a 403 - both enforced
    whatever WORKSPACE_ISOLATION_MODE says. Anything that needs the workspace calls require_workspace_for_data().
    """
    from utils.workspace_access import can_access, request_workspace_id
    try:
        wid = request_workspace_id()
    except ValueError:
        return None, _err("INVALID_WORKSPACE", "That workspace id is not valid.", 400)
    if wid is None:
        return None, None
    try:
        uid = int(get_jwt_identity())
    except (TypeError, ValueError):
        return None, _err("NO_WORKSPACE", "Please choose a client workspace first.", 403)
    # Enforced here whatever WORKSPACE_ISOLATION_MODE says: the assistant reaches across features, so it never guesses.
    if not can_access(uid, wid):
        log.warning("assistant: workspace access denied user=%s ws=%s", uid, wid)
        return None, _err("WORKSPACE_FORBIDDEN", "You do not have access to that workspace.", 403)
    return wid, None


@assistant_command_bp.route("/command", methods=["POST"])
@jwt_required()
@limiter.limit(RATE_ALL, key_func=_user_key)
def command():
    from models.assistant_history import TEXT_LIMIT
    from utils.assistant_history import read_recent, record_turn

    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return _err("BAD_REQUEST", "Send a JSON object with a text field.", 400)
    text = body.get("text")
    if not isinstance(text, str) or not text.strip():
        return _err("NO_TEXT", "Tell me what you would like to do.", 400)
    text = text.strip()
    if len(text) > router.MAX_COMMAND_CHARS:
        return _err("TEXT_TOO_LONG", f"Please keep the command under {router.MAX_COMMAND_CHARS} characters.", 400)

    workspace_id, error = _current_workspace_or_error()
    if error is not None:
        return error
    # The person, for the per-minute counters. History needs a workspace as well, so the integer id is taken only then
    # (_current_workspace_or_error has already checked it is one).
    user_id = get_jwt_identity()
    conversation_id = body.get("conversationId") if isinstance(body.get("conversationId"), int) else None
    lang_hint = body.get("lang") if isinstance(body.get("lang"), str) else None

    def finish(reply_kwargs):
        """Record the turn (best effort) and answer. History never decides whether the command worked.
        With no workspace nothing is recorded or read: conversationId is null and history is empty."""
        kwargs = dict(reply_kwargs)
        intent = kwargs.pop("intent")
        if workspace_id is None:
            return _reply(intent, conversation_id=None, history=[], **kwargs)
        person = int(user_id)
        cid = record_turn(user_id=person, workspace_id=workspace_id, conversation_id=conversation_id,
                          text=text[:TEXT_LIMIT], intent=reply_kwargs.get("intent"), feature=reply_kwargs.get("feature"),
                          understood=reply_kwargs.get("understood"))
        return _reply(intent, conversation_id=cid, history=read_recent(person, workspace_id), **kwargs)

    # 1. A command a rule can settle: no model call, no tokens.
    obvious = reg.obvious_match(text)
    if obvious is not None:
        feature, action_id, auto_open = obvious
        # A plain "open" carries no inputs, so it is built straight from the registry rather than through validate_proposal:
        # that would refuse it for a feature whose OTHER actions need an input (research needs a question to answer, the
        # conflict engine a party name), and a plain open would then wrongly fall through to the model. The registry still
        # decides everything: the feature and the action must be declared, and whether it changes data is is_write().
        if reg.get_action(feature["id"], action_id) is not None:
            changes_data = reg.is_write(feature["id"], action_id)
            return finish({"intent": router.action_intent(action_id), "understood": f"Open {feature['name']}.",
                           "feature": feature["id"], "action": action_id, "inputs": {},
                           "requires_confirm": changes_data, "route": feature["route"],
                           "auto_open": auto_open and not changes_data})

    # 2. Nothing in the product matches these words: ask, rather than spend a model call on it.
    candidates = reg.find_candidates(text)
    if not candidates:
        return finish({"intent": "clarify", "question": "I could not tell which part of Lexamplify you mean. "
                                                        "What would you like to do?",
                       "choices": reg.suggestion_chips(4)})

    # 3. Model-backed from here. Its own, stricter allowance.
    if not _model_budget_left(user_id):
        return _err("RATE_LIMITED", "You have asked for a lot at once. Please wait a minute and try again.", 429,
                    retryable=True)

    indic = router.is_indic(text, lang_hint)
    try:
        proposal = router.call_router_model(text, candidates, indic=indic)
    except router.AssistantBusy:
        resp = _err("ASSISTANT_BUSY", "The assistant is busy right now. Please try again in a few seconds.", 503,
                    retryable=True)
        resp.headers["Retry-After"] = "5"
        return resp
    except router.RouterUnavailable:
        return _err("ASSISTANT_UNAVAILABLE", "The assistant could not be reached just now. Please try again.", 502,
                    retryable=True)

    # An unreadable reply is a question for the lawyer, never a second attempt and never a guess.
    if proposal is None:
        return finish({"intent": "clarify", "question": "I did not quite catch that. Could you say it another way?",
                       "choices": [f"Open {c['name']}" for c in candidates[:4]], "model_used": True})

    if proposal.get("feature") is None or proposal.get("action") is None:
        asked = proposal.get("question")
        return finish({"intent": "clarify",
                       "question": asked.strip()[:300] if isinstance(asked, str) and asked.strip()
                       else "Which part of Lexamplify did you mean?",
                       "choices": [f"Open {c['name']}" for c in candidates[:4]], "model_used": True})

    # 4. Nothing the model said is trusted: it must name a feature it was actually offered, and one of that feature's
    #    own actions. A write always comes back needing the lawyer's confirmation.
    checked = reg.validate_proposal(proposal, allowed_feature_ids=[c["id"] for c in candidates])
    if not checked.get("ok"):
        return finish({"intent": "clarify", "question": checked["question"],
                       "choices": [f"Open {c['name']}" for c in candidates[:4]], "model_used": True})

    understood = proposal.get("understood")
    feature = reg.get_feature(checked["feature"])
    return finish({
        "intent": router.action_intent(checked["action"]),
        "understood": understood.strip()[:200] if isinstance(understood, str) and understood.strip()
        else f"{checked['action'].title()} in {feature['name']}.",
        "feature": checked["feature"], "action": checked["action"], "inputs": checked["inputs"],
        "requires_confirm": checked["requires_confirm"], "route": checked["route"], "model_used": True,
    })

# ── the lawyer's own history ───────────────────────────────────────────────────────────────────────────────────────────
# Metadata and deletion only. Both answer for the signed-in person in the workspace they are in, and nothing else: a
# conversation belonging to someone else, or to another workspace, is reported exactly like one that does not exist.

@assistant_command_bp.route("/conversations", methods=["GET"])
@jwt_required()
@limiter.limit(RATE_ALL, key_func=_user_key)
def conversations():
    from utils.assistant_history import list_conversations

    workspace_id, error = _current_workspace_or_error()
    if error is not None:
        return error
    if workspace_id is None:                       # no workspace, no history: an empty list, not an error
        return jsonify({"conversations": [], "requestId": getattr(g, "request_id", None)})
    return jsonify({"conversations": list_conversations(int(get_jwt_identity()), workspace_id),
                    "requestId": getattr(g, "request_id", None)})


@assistant_command_bp.route("/conversations/<int:conversation_id>", methods=["DELETE"])
@jwt_required()
@limiter.limit(RATE_ALL, key_func=_user_key)
def remove_conversation(conversation_id):
    from utils.assistant_history import delete_conversation

    workspace_id, error = _current_workspace_or_error()
    if error is not None:
        return error
    # Someone else's conversation and a conversation that never existed get the same answer: 404, nothing revealed.
    # With no workspace there is no history to delete, so it is the same 404.
    if workspace_id is None or not delete_conversation(user_id=int(get_jwt_identity()), workspace_id=workspace_id,
                               conversation_id=conversation_id):
        return _err("NOT_FOUND", "That conversation is not there any more.", 404)
    return jsonify({"deleted": True, "id": conversation_id, "requestId": getattr(g, "request_id", None)})

