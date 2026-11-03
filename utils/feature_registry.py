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
import unicodedata
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


def _is_indic_script(text: str) -> bool:
    return any(0x0900 <= ord(ch) <= 0x097F or 0x0B80 <= ord(ch) <= 0x0BFF for ch in (text or ""))


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
        elif _is_indic_script(alias):
            if len(needle) >= 5 and needle in haystack:
                score += 1
        elif any(f" {needle}{suf} " in haystack for suf in ("s", "es", "ed", "ing")):
            score += 1                                   # Latin whole-word + suffix, e.g. "hearings" matching "hearing"
    return score


def find_candidates(text: str, limit: int = MAX_CANDIDATES) -> list[dict]:
    """The few features this sentence could be about, best first. Empty when nothing matched - the caller then asks."""
    scored = [(score_feature(text, f), i, f) for i, f in enumerate(features())]
    return [f for s, _, f in sorted(((s, i, f) for s, i, f in scored if s > 0), key=lambda t: (-t[0], t[1]))][:limit]


# ── zero-token intent classification (checkpoint 1D-a1) ────────────────────────────────────────────────────────────────
# TODO: Hindi/Tamil/Roman-script word lists below are not yet reviewed by a native speaker; review and refine them.
LEGAL_TERMS = frozenset({
    "bail", "arrest", "section", "act", "article", "court", "ipc", "bns", "bnss", "crpc",
    "fir", "contract", "notice", "tort", "arbitration", "injunction", "plaintiff", "defendant",
    "petition", "appeal",
})

_SMALLTALK_PHRASES = (
    "hey lexamplify", "hi lexamplify", "hello lexamplify", "thank you", "good morning",
    "good afternoon", "good evening", "hi", "hello", "hey", "thanks", "ok", "okay", "bye",
    "goodbye", "namaste", "नमस्ते", "வணக்கம்",
)
_SMALLTALK_WORDS = frozenset({
    "hi", "hello", "hey", "lexamplify", "there", "thanks", "thank", "you", "ok", "okay",
    "good", "morning", "afternoon", "evening", "bye", "goodbye", "namaste", "नमस्ते", "வணக்கம்",
})

_OPEN_VERBS_PREFIX = ("take me to", "switch to", "go to", "open", "kholo")
_OWN_DATA_POSSESSIVES = (
    "my", "mine", "meri", "mera", "mere", "मेरा", "मेरी", "मेरे", "என்", "எங்கள்",
)
_OWN_DATA_NOUNS = (
    "matter", "matters", "case", "cases", "hearing", "hearings", "client", "clients",
    "document", "documents", "file", "files", "deadline", "deadlines",
    "sunwai", "tareekh", "mukadma", "mamla", "muvakkil", "dastavez",
    "सुनवाई", "तारीख", "मुकदमा", "मामला", "मुवक्किल", "दस्तावेज़",
    "விசாரணை", "வழக்கு", "ஆவணம்", "கட்சிக்காரர்",
)
_OWN_DATA_LOOKUP_CUES = (
    "how many", "when", "next", "upcoming", "pending",
    "kab", "kitne", "kitna", "kitni", "agli", "agla",
    "कब", "कितने", "अगली", "अगला", "எப்போது", "அடுத்த",
)
_FIRST_PERSON_OWN_DATA_RE = re.compile(
    r"(?<![A-Za-z0-9])(?:"
    r"how\s+many\s+(?:(?:pending|upcoming|open|active)\s+)?(?:clients|matters|cases|hearings|documents|deadlines)\s+do\s+i\s+have|"
    r"do\s+i\s+have\s+any\s+(?:(?:pending|upcoming)\s+)?(?:hearings|deadlines|matters|cases|clients|documents)"
    r")(?![A-Za-z0-9])",
    re.I,
)

_FEATURE_HELP_PREFIXES = ("how do i", "how to", "where is", "where can i")
_POLITE_PREFIXES = ("please", "can you", "could you", "would you")
_ENGLISH_ACTION_VERBS = (
    "take me to", "switch to", "go to", "check conflicts",
    "open", "show", "view", "draft", "write", "prepare", "create", "add", "schedule",
    "upload", "find", "search", "analyse", "analyze", "delete", "share", "send",
)
_SHOW_QUESTION_PREFIXES = (
    "show me what", "show what", "show me how", "show how", "show me why", "show why",
    "show me whether", "show whether", "show me when", "show when", "show me who", "show who",
)
_INDIC_AND_ROMAN_ACTION_VERBS = (
    "kholo", "dikhao", "banao", "likho", "karna",
    "thira", "kaattu", "ezhuthu",
    "खोलो", "दिखाओ", "बनाओ", "लिखो", "करना",
    "திற", "காட்டு", "எழுது",
)
_QUESTION_WORDS_AND_PHRASES = (
    "meaning of", "difference between", "tell me about",
    "what", "why", "how", "when", "who", "which", "whether", "explain", "define",
    "kya", "kyon", "kyun", "kaise", "kab", "kaun", "matlab", "samjhao", "batao",
    "enna", "en", "eppadi", "yaar", "artham", "vilakku",
    "क्या", "क्यों", "कैसे", "कब", "कौन", "मतलब", "समझाओ", "बताओ",
    "என்ன", "ஏன்", "எப்படி", "யார்", "அர்த்தம்", "விளக்கு",
)
_LEADING_QUESTION_AUX = frozenset({"is", "are", "can", "does", "do", "should", "will", "may"})


def _clean_for_intent(text: str) -> str:
    """Lowercase and strip punctuation while keeping Unicode combining marks attached to Indic letters."""
    norm = unicodedata.normalize("NFC", text or "").lower()
    chars = [
        ch if (ch.isalnum() or unicodedata.category(ch).startswith("M")) else " "
        for ch in norm
    ]
    return " ".join("".join(chars).split())


def _has_any(padded: str, phrases) -> bool:
    return any(f" {p} " in padded for p in phrases)


def _has_legal_term(padded: str) -> bool:
    return any(f" {t} " in padded or f" {t}s " in padded for t in LEGAL_TERMS)


def _strip_polite_prefixes(cleaned: str) -> str:
    rest = cleaned
    changed = True
    while changed and rest:
        changed = False
        for prefix in _POLITE_PREFIXES:
            if rest == prefix:
                return ""
            if rest.startswith(prefix + " "):
                rest = rest[len(prefix) + 1:].strip()
                changed = True
                break
    return rest


def _starts_with_any_verb(text: str, verbs) -> bool:
    return any(text == v or text.startswith(v + " ") for v in verbs)


def classify_intent(text: str, lang_hint: str | None = None) -> str:
    """Pure rule-based intent classifier. Returns one of:
    'smalltalk', 'own_data', 'feature_help', 'action', 'answer'.
    """
    _ = lang_hint
    cleaned = _clean_for_intent(text)
    if not cleaned:
        return "answer"
    words = cleaned.split()
    padded = f" {cleaned} "
    has_legal = _has_legal_term(padded)

    # a. smalltalk: 3 words or fewer, greeting/thanks/ack, and no legal term.
    if len(words) <= 3 and not has_legal:
        if _has_any(padded, _SMALLTALK_PHRASES) and all(w in _SMALLTALK_WORDS for w in words):
            return "smalltalk"

    # b. own_data: skip if text starts with an open-verb; otherwise needs possessive + record noun + lookup cue + no legal term,
    #    or one of the two narrow first-person own-data patterns (Run 4 TASK 6).
    stripped_polite = _strip_polite_prefixes(cleaned)
    starts_with_open = (
        _starts_with_any_verb(cleaned, _OPEN_VERBS_PREFIX)
        or _starts_with_any_verb(stripped_polite, _OPEN_VERBS_PREFIX)
    )
    if not starts_with_open and not has_legal:
        if (
            _has_any(padded, _OWN_DATA_POSSESSIVES)
            and _has_any(padded, _OWN_DATA_NOUNS)
            and _has_any(padded, _OWN_DATA_LOOKUP_CUES)
        ) or _FIRST_PERSON_OWN_DATA_RE.search(cleaned):
            return "own_data"

    has_candidate = bool(find_candidates(text, limit=1))

    # c. feature_help: "what can you do", "what can i ask", "help" (alone), or help prefix + candidate.
    if (
        cleaned == "help"
        or " what can you do " in padded
        or " what can i ask " in padded
        or (_has_any(padded, _FEATURE_HELP_PREFIXES) and has_candidate)
    ):
        return "feature_help"

    # d. action: strip polite prefixes first, then whole-word candidate + explicit verb.
    if has_candidate:
        english_verb = (
            _starts_with_any_verb(stripped_polite, _ENGLISH_ACTION_VERBS)
            and not _starts_with_any_verb(stripped_polite, _SHOW_QUESTION_PREFIXES)
        )
        indic_or_roman_verb = _has_any(padded, _INDIC_AND_ROMAN_ACTION_VERBS)
        if english_verb or indic_or_roman_verb:
            return "action"

    # e. answer: question mark, question word/phrase as whole word, or leading modal/auxiliary verb.
    if (
        "?" in (text or "")
        or "？" in (text or "")
        or _has_any(padded, _QUESTION_WORDS_AND_PHRASES)
        or (words and words[0] in _LEADING_QUESTION_AUX)
    ):
        return "answer"

    # f. action: at least one whole-word/suffix candidate.
    if has_candidate:
        return "action"

    # g. answer: everything else.
    return "answer"


def own_data_feature(text: str) -> dict:
    """Pick the single registry feature for an own_data reply using only registry data."""
    candidates = find_candidates(text, limit=1)
    if candidates:
        return candidates[0]
    padded = f" {_clean_for_intent(text)} "
    if _has_any(padded, ("hearing", "hearings", "deadline", "deadlines", "sunwai", "tareekh", "सुनवाई", "तारीख", "விசாரணை")):
        return get_feature("calendar") or features()[0]
    if _has_any(padded, ("client", "clients", "muvakkil", "मुवक्किल", "கட்சிக்காரர்")):
        return get_feature("clients") or features()[0]
    if _has_any(padded, ("document", "documents", "file", "files", "dastavez", "दस्तावेज़", "ஆவணம்")):
        return get_feature("document_hub") or features()[0]
    return get_feature("matters") or features()[0]


# ── a command a plain rule can settle, with no model ───────────────────────────────────────────────────────────────────────
# Leading/trailing punctuation a dictation or a keyboard adds: . , ! ? ; : and the Hindi danda and double danda.
_EDGE_PUNCTUATION = ".,!?;:\u0964\u0965"
_FILLER_WORDS = frozenset({"please", "the", "my"})
# The only words that turn a bare name into "open it". Nothing is added to this list: no new synonyms.
_LEADING_VERBS = ("take me to", "switch to", "go to", "open", "show", "view", "kholo", "dikhao")   # longest first
_TRAILING_VERBS = ("kholo", "dikhao")                                    # Hindi puts the verb after the name


def _clean_command(text: str) -> str:
    """NFC, case-folded, single-spaced, with leading and trailing punctuation removed. Nothing inside the text is touched."""
    cleaned = unicodedata.normalize("NFC", text or "").casefold()
    cleaned = " ".join(cleaned.split())
    return cleaned.strip(_EDGE_PUNCTUATION + " ")


def _alias_index() -> dict:
    """{cleaned alias or feature name: set of feature ids that own it}. Built from the registry on every call (it is small),
    so a test that edits the registry file is never answered from a stale copy."""
    index: dict = {}
    for f in features():
        for alias in _alias_list(f) + [f["name"]]:
            key = _clean_command(alias)
            if key:
                index.setdefault(key, set()).add(f["id"])
    return index


def _strip_verb(cleaned: str):
    """(the text without ONE opening verb, whether a verb was removed)."""
    for verb in _LEADING_VERBS:
        if cleaned.startswith(verb + " "):
            return cleaned[len(verb) + 1:].strip(), True
    for verb in _TRAILING_VERBS:
        if cleaned.endswith(" " + verb):
            return cleaned[: -len(verb) - 1].strip(), True
    return cleaned, False


def obvious_match(text: str):
    """A command a rule can settle with NO model call: after cleaning, the WHOLE text is exactly one feature's alias or name.
    Returns (feature, "open", auto_open) or None.

    Cleaning is only this: Unicode form (NFC) and case, repeated spaces, leading and trailing punctuation (. , ! ? ; : and the
    Hindi danda), the filler words please / the / my, and ONE opening verb (open, show, view, go to, take me to, switch to,
    kholo, dikhao). There is no fuzzy matching and no synonym. "open legal forms.", "Please open the legal forms" and
    "legal forms" are understood; "open legal forms and delete everything" and "go to calendar and add a hearing" are not: the
    rest of the sentence is not an alias, so they go the model route. A word two features share ("agreement") is not understood.

    auto_open says whether the page may jump there by itself. It may only when the lawyer clearly asked to go: the text has an
    explicit opening verb ("open matters", "show tomorrow"), or the whole text is the feature's full NAME and that name is two
    or more words ("legal forms", "case vault"). A bare one-word name ("matters", "settings") or a bare alias ("tomorrow",
    "notice", "calendar") is understood but is NOT auto_open: a stray dictated word, or a one-word answer to a question, must
    never make the page jump away. The page then shows the normal card with an Open button.
    """
    cleaned = _clean_command(text)
    # "my cases", "my day" and "my documents" are aliases as written, so the text is tried with its filler words kept AND
    # with them removed (the verb is looked for after the fillers are gone, so "please open ..." works). Whichever way it
    # reads, exactly one feature must own the result.
    variants = []
    for candidate in (cleaned, " ".join(w for w in cleaned.split() if w not in _FILLER_WORDS)):
        base, had_verb = _strip_verb(candidate)
        if base:
            variants.append((base, had_verb))
    index = _alias_index()
    owners = set()
    for base, _ in variants:
        owners |= index.get(base, set())
    if len(owners) != 1:
        return None
    feature = get_feature(next(iter(owners)))
    if feature is None or not any(a["id"] == "open" for a in feature["actions"]):
        return None
    name_key = _clean_command(feature["name"])
    multi_word_name = len(name_key.split()) >= 2
    auto_open = any(base in index and (had_verb or (multi_word_name and base == name_key)) for base, had_verb in variants)
    return feature, "open", auto_open


def obvious_feature(text: str):
    """(feature, "open") for a command a rule can settle, or None. See obvious_match for the rules and for auto_open."""
    match = obvious_match(text)
    return None if match is None else (match[0], match[1])


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
