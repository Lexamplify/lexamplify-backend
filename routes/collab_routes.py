"""Case Collaboration — blueprint /api/collab (plan phase 2).

One implicit "room" per lpms_case; a share writes a message with an
attached resource reference (no parallel share table). The sender and
every recipient are validated through utils.case_access.require_case_access
on EVERY endpoint — spec §10 explicitly rejects frontend-only visibility.

Endpoints:
  GET    /api/collab/cases/<case_id>/messages?before=&limit=50
  POST   /api/collab/cases/<case_id>/messages
  PATCH  /api/collab/messages/<id>
  DELETE /api/collab/messages/<id>
  POST   /api/collab/cases/<case_id>/read
  GET    /api/collab/cases/<case_id>/eligible-recipients
  POST   /api/collab/share          (universal entry point for the frontend)

The SSE endpoint and the mention bell live in later phases; this
blueprint ships the HTTP surface first so the frontend can start
building the room UI.
"""
from __future__ import annotations
import sqlite3
import time

from flask import Blueprint, current_app, g, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from utils import lpms_store as L
from utils.case_access import eligible_recipient_ids, require_case_access
from utils.mentions import resolve_mentions

collab_bp = Blueprint("collab", __name__, url_prefix="/api/collab")


# ─── small helpers ──────────────────────────────────────────────────────

def _db_path() -> str:
    """Resolve the SQLite file via the same extension LPMS uses, so the
    collab tables and the lpms_* tables stay in one DB."""
    return current_app.extensions.get("lpms_db_path") or "lex_assistant.db"


def _conn():
    """One raw sqlite connection per request. We can't reuse env.conn()
    because this blueprint is standalone — but we match the row_factory
    + close pattern the LPMS Env uses."""
    c = getattr(g, "_collab_conn", None)
    if c is None:
        c = sqlite3.connect(_db_path())
        c.row_factory = sqlite3.Row
        g._collab_conn = c
    return c


@collab_bp.teardown_request
def _close_conn(_exc):
    c = getattr(g, "_collab_conn", None)
    if c is not None:
        try:
            c.rollback()
            c.close()
        except Exception:  # noqa: BLE001
            pass
        g._collab_conn = None


def _uid():
    """Current user's id as int, or raise so the route 401s via JWT guard."""
    return int(get_jwt_identity())


def _case_or_404(case_id):
    """Return the lpms_cases row for case_id if the caller is allowed to
    see it; else (None, (jsonify, 404)). 404 (not 403) is the convention
    the Vault + Matters routes already use — don't disclose existence to
    an outsider."""
    try:
        cid = int(case_id)
    except (TypeError, ValueError):
        return None, (jsonify({"error": True, "message": "Case not found."}), 404)
    c = _conn()
    row = c.execute(
        "SELECT id, firm_id, title, workspace_id, advocate_id, team_id, restricted "
        "FROM lpms_cases WHERE id = ?",
        (cid,),
    ).fetchone()
    if not row or not require_case_access(_uid(), cid):
        return None, (jsonify({"error": True, "message": "Case not found."}), 404)
    return row, None


def _message_or_404(message_id, author_only=False):
    """Fetch a message row and verify the caller may act on it. author_only
    is True for PATCH/DELETE where only the author may touch it."""
    try:
        mid = int(message_id)
    except (TypeError, ValueError):
        return None, (jsonify({"error": True, "message": "Message not found."}), 404)
    c = _conn()
    row = c.execute(
        "SELECT * FROM case_messages WHERE id = ? AND deleted_at IS NULL",
        (mid,),
    ).fetchone()
    if not row or not require_case_access(_uid(), row["case_id"]):
        return None, (jsonify({"error": True, "message": "Message not found."}), 404)
    if author_only and int(row["author_user_id"]) != _uid():
        return None, (jsonify({"error": True, "message": "You can only edit your own messages."}), 403)
    return row, None


def _hydrate_messages(rows):
    """Attach resource references + mentions to a batch of message rows in
    two extra queries (not N+1)."""
    if not rows:
        return []
    c = _conn()
    ids = [r["id"] for r in rows]
    qmarks = ",".join("?" for _ in ids)
    resources = {}
    for r in c.execute(
        f"SELECT * FROM case_message_resources WHERE message_id IN ({qmarks})",
        ids,
    ).fetchall():
        resources.setdefault(r["message_id"], []).append({
            "resource_type": r["resource_type"],
            "resource_id": r["resource_id"],
            "resource_version": r["resource_version"],
        })
    mentions = {}
    for r in c.execute(
        f"SELECT * FROM case_message_mentions WHERE message_id IN ({qmarks})",
        ids,
    ).fetchall():
        mentions.setdefault(r["message_id"], []).append(int(r["mentioned_user_id"]))

    out = []
    for r in rows:
        out.append({
            "id": r["id"],
            "case_id": r["case_id"],
            "author_user_id": r["author_user_id"],
            "kind": r["kind"],
            "body": r["body"] or "",
            "parent_message_id": r["parent_message_id"],
            "created_at": r["created_at"],
            "edited_at": r["edited_at"],
            "resources": resources.get(r["id"], []),
            "mentions": mentions.get(r["id"], []),
        })
    return out


# ─── routes ─────────────────────────────────────────────────────────────

@collab_bp.route("/cases/<case_id>/messages", methods=["GET", "OPTIONS"])
@jwt_required()
def list_messages(case_id):
    if request.method == "OPTIONS":
        return jsonify({}), 200
    _, err = _case_or_404(case_id)
    if err:
        return err
    try:
        limit = max(1, min(int(request.args.get("limit", "50")), 200))
    except (TypeError, ValueError):
        limit = 50
    before = request.args.get("before")
    c = _conn()
    if before:
        try:
            before_id = int(before)
        except (TypeError, ValueError):
            return jsonify({"error": True, "message": "`before` must be a message id."}), 400
        rows = c.execute(
            "SELECT * FROM case_messages "
            "WHERE case_id = ? AND deleted_at IS NULL AND id < ? "
            "ORDER BY id DESC LIMIT ?",
            (int(case_id), before_id, limit),
        ).fetchall()
    else:
        rows = c.execute(
            "SELECT * FROM case_messages "
            "WHERE case_id = ? AND deleted_at IS NULL "
            "ORDER BY id DESC LIMIT ?",
            (int(case_id), limit),
        ).fetchall()
    # Newest-last so the frontend can append downward without reversing.
    messages = list(reversed(_hydrate_messages(rows)))
    return jsonify({"messages": messages, "case_id": int(case_id)}), 200


@collab_bp.route("/cases/<case_id>/messages", methods=["POST", "OPTIONS"])
@jwt_required()
def post_message(case_id):
    if request.method == "OPTIONS":
        return jsonify({}), 200
    case, err = _case_or_404(case_id)
    if err:
        return err
    data = request.get_json(force=True, silent=True) or {}
    body = (data.get("body") or "").strip()
    resources = data.get("resources") or []
    mentions_raw = data.get("mentions") or []
    parent_id = data.get("parent_message_id")

    if not body and not resources:
        return jsonify({"error": True, "message": "Say something or attach a resource."}), 400
    if len(body) > 5000:
        return jsonify({"error": True, "message": "Message is too long (5000 characters max)."}), 400

    resolved_mentions = resolve_mentions(body, mentions_raw, int(case_id))

    c = _conn()
    with c:  # auto commit/rollback
        cur = c.execute(
            "INSERT INTO case_messages "
            "(firm_id, workspace_id, case_id, author_user_id, kind, body, parent_message_id) "
            "VALUES (?, ?, ?, ?, 'message', ?, ?)",
            (int(case["firm_id"]), case["workspace_id"], int(case_id), _uid(),
             body, int(parent_id) if parent_id else None),
        )
        message_id = cur.lastrowid

        for res in resources:
            rtype = (res or {}).get("resource_type") or (res or {}).get("type")
            rid = (res or {}).get("resource_id") or (res or {}).get("id")
            if not rtype or not rid:
                continue
            c.execute(
                "INSERT INTO case_message_resources "
                "(message_id, resource_type, resource_id, resource_version) VALUES (?,?,?,?)",
                (message_id, str(rtype)[:40], str(rid)[:120],
                 str((res or {}).get("resource_version") or "")[:64] or None),
            )

        for uid_m in resolved_mentions:
            c.execute(
                "INSERT INTO case_message_mentions (message_id, mentioned_user_id) VALUES (?, ?)",
                (message_id, int(uid_m)),
            )

        # Notify mentioned users via the existing lpms_notifications stack.
        if resolved_mentions:
            title = f"You were mentioned in {case['title'] or 'a case'}"
            link = f"/matters/{int(case_id)}#collab-{message_id}"
            dedupe = f"mention:{message_id}"
            for uid_m in resolved_mentions:
                if uid_m == _uid():
                    continue
                L.notify(c, int(case["firm_id"]), int(uid_m),
                         "mention.received", title, body=body[:300], link=link,
                         case_id=int(case_id), dedupe_key=dedupe, email=False)

    row = c.execute("SELECT * FROM case_messages WHERE id = ?", (message_id,)).fetchone()
    return jsonify({"message": _hydrate_messages([row])[0]}), 201


@collab_bp.route("/messages/<message_id>", methods=["PATCH", "OPTIONS"])
@jwt_required()
def edit_message(message_id):
    if request.method == "OPTIONS":
        return jsonify({}), 200
    row, err = _message_or_404(message_id, author_only=True)
    if err:
        return err
    if row["kind"] != "message":
        return jsonify({"error": True, "message": "Only user messages can be edited."}), 400
    data = request.get_json(force=True, silent=True) or {}
    body = (data.get("body") or "").strip()
    if not body:
        return jsonify({"error": True, "message": "Message body cannot be empty — delete it instead."}), 400
    if len(body) > 5000:
        return jsonify({"error": True, "message": "Message is too long (5000 characters max)."}), 400
    c = _conn()
    with c:
        c.execute(
            "UPDATE case_messages SET body = ?, edited_at = CURRENT_TIMESTAMP WHERE id = ?",
            (body, int(message_id)),
        )
    updated = c.execute("SELECT * FROM case_messages WHERE id = ?", (int(message_id),)).fetchone()
    return jsonify({"message": _hydrate_messages([updated])[0]}), 200


@collab_bp.route("/messages/<message_id>", methods=["DELETE", "OPTIONS"])
@jwt_required()
def delete_message(message_id):
    if request.method == "OPTIONS":
        return jsonify({}), 200
    row, err = _message_or_404(message_id, author_only=True)
    if err:
        return err
    c = _conn()
    with c:
        c.execute(
            "UPDATE case_messages SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?",
            (int(message_id),),
        )
    return jsonify({"ok": True}), 200


@collab_bp.route("/cases/<case_id>/read", methods=["POST", "OPTIONS"])
@jwt_required()
def mark_read(case_id):
    if request.method == "OPTIONS":
        return jsonify({}), 200
    _, err = _case_or_404(case_id)
    if err:
        return err
    data = request.get_json(force=True, silent=True) or {}
    try:
        up_to = int(data.get("last_read_message_id") or 0)
    except (TypeError, ValueError):
        return jsonify({"error": True, "message": "last_read_message_id must be an int."}), 400
    if up_to <= 0:
        # Default to "the newest message I can see" when the client doesn't name one.
        c = _conn()
        row = c.execute(
            "SELECT MAX(id) AS mx FROM case_messages WHERE case_id = ? AND deleted_at IS NULL",
            (int(case_id),),
        ).fetchone()
        up_to = int(row["mx"] or 0)
    if up_to <= 0:
        return jsonify({"ok": True, "last_read_message_id": 0}), 200
    c = _conn()
    with c:
        c.execute(
            "INSERT INTO case_message_reads (user_id, case_id, last_read_message_id, updated_at) "
            "VALUES (?, ?, ?, CURRENT_TIMESTAMP) "
            "ON CONFLICT(user_id, case_id) DO UPDATE SET "
            "last_read_message_id = MAX(excluded.last_read_message_id, case_message_reads.last_read_message_id), "
            "updated_at = CURRENT_TIMESTAMP",
            (_uid(), int(case_id), up_to),
        )
    return jsonify({"ok": True, "last_read_message_id": up_to}), 200


@collab_bp.route("/cases/<case_id>/eligible-recipients", methods=["GET", "OPTIONS"])
@jwt_required()
def list_eligible_recipients(case_id):
    """Powers the Share dialog's recipient picker. Returns {id, name, email}
    for every user who could legitimately be chosen — never anyone outside
    that set, so the picker can't be used to enumerate the firm."""
    if request.method == "OPTIONS":
        return jsonify({}), 200
    _, err = _case_or_404(case_id)
    if err:
        return err
    ids = eligible_recipient_ids(int(case_id))
    if not ids:
        return jsonify({"recipients": []}), 200
    c = _conn()
    # Resolve display names/emails from lpms_members (firm roster), falling
    # back to users table for users without a member row.
    rows = c.execute(
        f"SELECT m.user_id, m.name, m.email, m.role FROM lpms_members m "
        f"WHERE m.user_id IN ({','.join('?' for _ in ids)}) AND m.active = 1",
        tuple(ids),
    ).fetchall()
    out = [{"user_id": int(r["user_id"]), "name": r["name"], "email": r["email"], "role": r["role"]} for r in rows]
    # Deduplicate (a user can be a member of multiple firms in principle).
    seen = set()
    deduped = []
    for r in out:
        if r["user_id"] in seen:
            continue
        seen.add(r["user_id"])
        deduped.append(r)
    return jsonify({"recipients": deduped}), 200


@collab_bp.route("/share", methods=["POST", "OPTIONS"])
@jwt_required()
def share_resource():
    """Universal share entry point — called by every tool's Share dialog.
    Delegates to utils.share_service.create_share so the business rules
    (recipient eligibility, resource case-linking, audit, notifications)
    live in one place and are easy to test."""
    if request.method == "OPTIONS":
        return jsonify({}), 200
    data = request.get_json(force=True, silent=True) or {}
    case_id = data.get("case_id")
    resource_type = data.get("resource_type") or data.get("type")
    resource_id = data.get("resource_id") or data.get("id")
    recipients = data.get("recipient_user_ids") or data.get("recipients") or []
    body = (data.get("body") or data.get("message") or "").strip()

    if not case_id or not resource_type or not resource_id:
        return jsonify({"error": True, "message": "case_id, resource_type and resource_id are required.",
                        "code": "BAD_REQUEST"}), 400

    try:
        case_id = int(case_id)
    except (TypeError, ValueError):
        return jsonify({"error": True, "message": "case_id must be an int."}), 400

    _, err = _case_or_404(case_id)
    if err:
        return err

    from utils.share_service import create_share, ShareError
    try:
        result = create_share(
            user_id=_uid(),
            case_id=case_id,
            resource_type=str(resource_type),
            resource_id=str(resource_id),
            recipient_user_ids=[int(r) for r in recipients if r is not None],
            body=body,
            conn=_conn(),
        )
    except ShareError as e:
        return jsonify({"error": True, "message": str(e), "code": e.code,
                        **({"blocked_user_ids": e.blocked} if e.blocked else {})}), e.status
    return jsonify(result), 201
