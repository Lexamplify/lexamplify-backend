"""The assistant's knowledge of the product: one registry, loaded from frontend/src/assistant/features.json.

This module is the whole of checkpoint 1A. It holds no model call and no route; it answers three questions:

  find_candidates(text)      which few features could this sentence be about? (so only those go in a model prompt)
  validate_proposal(...)     is this proposed action allowed, and does it need the lawyer's confirmation first?
  prompt_block(features)     the compact text describing those few features, sized for the token budget

Two rules this file exists to enforce, whatever a model proposes and whatever any document says:
  * Only a feature and an action named in the registry can ever run. Anything else becomes "clarify".
  * An action marked "writes" ALWAYS comes back needing confirmation. There is no input, no phrasing and no text inside
    a document that can produce a write that runs by itself.
"""
from __future__ import annotations

import json
import os
import re
from functools import lru_cache

REGISTRY_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                             "frontend", "src", "assistant", "features.json")

# Keep in step with utils/ai_helper.py's estimate (4 chars/token) so both sides measure the budget the same way.
_CHARS_PER_TOKEN = 4
MAX_CANDIDATES = 4
# The whole prompt for one command must leave room for the sentence, the system text and the model's own reasoning
# inside the ~8000 tokens/minute the account allows, shared with Research and voice parsing.
MAX_PROMPT_TOKENS = 1200


class RegistryError(RuntimeError):
    pass


@lru_cache(maxsize=1)
def load_registry() -> dict:
    """The parsed registry. Cached; call load_registry.cache_clear() in a test that edits the file."""
    try:
        with open(REGISTRY_PATH, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError) as exc:
        raise RegistryError(f"feature registry could not be read: {type(exc).__name__}") from exc
    if not isinstance(data.get("features"), list) or not data["features"]:
        raise RegistryError("feature registry has no features")
    return data


def features() -> list[dict]:
    return load_registry()["features"]


def feature_ids() -> list[str]:
    return [f["id"] for f in features()]


def get_feature(feature_id) -> dict | None:
    if not isinstance(feature_id, str):
        return None
    return next((f for f in features() if f["id"] == feature_id), None)


def action_vocabulary() -> dict:
    """{action id: writes?} - the only action names any feature may use."""
    return load_registry()["actionVocabulary"]


def get_action(feature_id, action_id) -> dict | None:
    feature = get_feature(feature_id)
    if feature is None or not isinstance(action_id, str):
        return None
    return next((a for a in feature["actions"] if a["id"] == action_id), None)


def is_write(feature_id, action_id) -> bool:
    """True when this action changes or sends data. Unknown feature/action is treated as a write: refuse to assume it is safe."""
    action = get_action(feature_id, action_id)
    return True if action is None else bool(action.get("writes"))


# ── picking the few candidate features for a sentence ─────────────────────────────────────────────────────────────────
def _norm(text: str) -> str:
    # Keep non-Latin letters (Devanagari, Tamil): only punctuation is dropped.
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", (text or "").lower())).strip()


def _alias_list(feature: dict) -> list[str]:
    out = []
    for group in (feature.get("aliases") or {}).values():
        out.extend(group)
    return out


def score_feature(text: str, feature: dict) -> int:
    """How well one feature matches the sentence: longer alias phrases count for more than single words."""
    haystack = f" {_norm(text)} "
    score = 0
    for alias in _alias_list(feature) + [feature["name"]]:
        needle = _norm(alias)
        if not needle:
            continue
        if f" {needle} " in haystack:
            score += 3 * len(needle.split())
        elif len(needle) >= 5 and needle in haystack:
            score += 1                                   # inside a longer word, e.g. "hearings" matching "hearing"
    return score


def find_candidates(text: str, limit: int = MAX_CANDIDATES) -> list[dict]:
    """The few features this sentence could be about, best first. Empty when nothing matched - the caller then asks."""
    scored = [(score_feature(text, f), i, f) for i, f in enumerate(features())]
    return [f for s, _, f in sorted(((s, i, f) for s, i, f in scored if s > 0), key=lambda t: (-t[0], t[1]))][:limit]


def obvious_feature(text: str):
    """A command a rule can settle with NO model call: it names exactly one feature clearly and asks only to open it.
    Returns (feature, "open") or None."""
    norm = f" {_norm(text)} "
    if len(norm.split()) > 6:
        return None
    verbs = ("open", "go to", "show", "take me to", "switch to", "view", "kholo", "dikhao")
    if not any(f" {_norm(v)} " in norm or norm.strip().startswith(_norm(v)) for v in verbs):
        return None
    candidates = find_candidates(text, limit=2)
    if len(candidates) != 1:
        return None                                      # ambiguous: let the model (or a question) decide
    if not any(a["id"] == "open" for a in candidates[0]["actions"]):
        return None
    return candidates[0], "open"


# ── the prompt text for the model (candidates only, never the whole registry) ──────────────────────────────────────────
def estimate_tokens(text: str) -> int:
    return len(text or "") // _CHARS_PER_TOKEN


def prompt_block(candidates: list[dict]) -> str:
    """The compact description of the candidate features. Aliases are NOT included: they did their job in the prefilter."""
    lines = []
    for f in candidates:
        actions = ", ".join(f"{a['id']}{'*' if a.get('writes') else ''}" for a in f["actions"])
        inputs = ", ".join(i["name"] for i in f.get("inputs") or []) or "none"
        lines.append(f"- id={f['id']} | {f['name']}: {f['purpose']} | inputs: {inputs} | actions: {actions}")
    return "\n".join(lines)


# ── validating what the model proposed ─────────────────────────────────────────────────────────────────────────────────
_CLARIFY = "clarify"
_INT_RE = re.compile(r"^-?\d+$")


def _coerce(value, kind):
    """Return the value in the declared type, or None when it does not fit. Never raises."""
    if value is None:
        return None
    if kind == "int":
        if isinstance(value, bool):
            return None
        if isinstance(value, int):
            return value
        if isinstance(value, str) and _INT_RE.match(value.strip()):
            return int(value.strip())
        return None
    if kind == "date":
        return value.strip()[:40] if isinstance(value, str) and re.match(r"^\d{4}-\d{2}-\d{2}$", value.strip()) else None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        value = str(value)
    return value.strip()[:400] if isinstance(value, str) and value.strip() else None


def validate_proposal(proposal, *, allowed_feature_ids=None) -> dict:
    """Check a proposed action against the registry allowlist.

    Returns either
        {"ok": True, "feature": id, "action": id, "inputs": {...}, "requires_confirm": bool, "route": "/x"}
    or
        {"ok": False, "intent": "clarify", "reason": "...", "question": "..."}

    `allowed_feature_ids` narrows the allowlist further (for example to the candidates actually shown to the model), so a
    model that invents a feature it was never offered is refused even if that feature exists.
    """
    if not isinstance(proposal, dict):
        return _reject("not_an_object", "I did not understand that. Could you say it another way?")

    feature_id, action_id = proposal.get("feature"), proposal.get("action")
    feature = get_feature(feature_id)
    if feature is None:
        return _reject("unknown_feature", "I am not sure which part of Lexamplify you mean. Which one did you want?")
    if allowed_feature_ids is not None and feature_id not in set(allowed_feature_ids):
        return _reject("feature_not_offered", "I am not sure which part of Lexamplify you mean. Which one did you want?")

    action = get_action(feature_id, action_id)
    if action is None:
        return _reject("unknown_action", f"I cannot do that in {feature['name']}. What would you like me to do there?")
    if action_id not in action_vocabulary():
        return _reject("action_not_in_vocabulary", f"I cannot do that in {feature['name']}.")

    declared = {i["name"]: i for i in (feature.get("inputs") or [])}
    raw_inputs = proposal.get("inputs") if isinstance(proposal.get("inputs"), dict) else {}
    inputs = {}
    for name, value in raw_inputs.items():
        if name not in declared:
            continue                                     # an input this feature never declared is dropped, not passed on
        clean = _coerce(value, declared[name].get("type", "text"))
        if clean is not None:
            inputs[name] = clean

    missing = [n for n, spec in declared.items() if spec.get("required") and n not in inputs]
    if missing:
        return _reject("missing_input", f"I need the {missing[0].replace('_', ' ')} for that. What is it?", feature=feature_id, action=action_id)

    # The Confirm rule. A write NEVER comes back ready to run, whatever the proposal said: the lawyer confirms on screen.
    return {"ok": True, "feature": feature_id, "action": action_id, "inputs": inputs,
            "requires_confirm": bool(action.get("writes")), "route": feature["route"]}


def _reject(reason, question, **extra) -> dict:
    return {"ok": False, "intent": _CLARIFY, "reason": reason, "question": question, **extra}


def suggestion_chips(limit: int = 6) -> list[str]:
    """Empty-state suggestions, built from the registry rather than hard-coded."""
    return [f"Open {f['name']}" for f in features() if any(a["id"] == "open" for a in f["actions"])][:limit]
