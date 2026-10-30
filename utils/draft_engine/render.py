"""Turn a document type + confirmed facts into a structured document. No language model is involved.

Output is JSON blocks (title, paragraphs, numbered paragraphs, signature...) plus the list of details still
missing and any warnings. Missing details become "[Bracketed Field: <label>]". Nothing is guessed.
"""
import hashlib
import json
import re
from datetime import timedelta
from decimal import Decimal

from . import validators as V
from .registry import REF_RE, get_type

BRACKET = "[Bracketed Field: {}]"
BRACKET_RE = re.compile(r"\[Bracketed Field:[^\]]*\]")
_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_LIMITS = {"longtext": 2000, "address": 400}
DEFAULT_LIMIT = 300


def clean_value(raw, slot_type="text") -> str:
    """Normalise whitespace, drop control characters, and defuse anything that could pass as a template
    anchor or as one of our own bracket markers."""
    s = _CTRL.sub("", str(raw if raw is not None else ""))
    s = s.replace("{{", "{ {").replace("}}", "} }")
    s = re.sub(r"\[Bracketed Field:([^\]]*)\]?", lambda m: "(Bracketed Field:" + m.group(1) + ")", s)
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{3,}", "\n\n", s).strip()
    return s[: _LIMITS.get(slot_type, DEFAULT_LIMIT)]


def _normalise(slot, value):
    """Return (display_value, problem). A value that fails its validator is treated as not provided."""
    t = slot["type"]
    v = clean_value(value, t)
    if not v:
        return "", None
    if t == "date":
        d = V.parse_date(v)
        return (V.format_date(d), None) if d else ("", "is not a date this tool can read (use e.g. 17 October 2026)")
    if t == "amount":
        a = V.parse_amount(v)
        return (str(a), None) if a is not None else ("", "is not a rupee amount (write digits, e.g. 4,75,000)")
    if t == "number":
        return (v, None) if re.fullmatch(r"\d{1,3}", v) else ("", "must be a whole number")
    if t == "choice":
        opts = slot.get("options") or []
        if opts and v not in opts:
            return "", "must be one of: " + "; ".join(opts)
        return v, None
    if t == "cheque_no":
        return (re.sub(r"\s", "", v), None) if V.valid_cheque_no(v) else ("", "must be the 6-digit cheque number")
    if t == "mobile":
        m = V.normalise_mobile(v)
        return (m, None) if m else ("", "is not a valid 10-digit Indian mobile number")
    if t == "pan":
        return (V._compact(v), None) if V.valid_pan(v) else ("", "is not a valid PAN")
    if t == "gstin":
        return (V._compact(v), None) if V.valid_gstin(v) else ("", "is not a valid GSTIN")
    if t == "pin":
        return (re.sub(r"\s", "", v), None) if V.valid_pin(v) else ("", "is not a valid 6-digit PIN code")
    if t == "ifsc":
        return (V._compact(v), None) if V.valid_ifsc(v) else ("", "is not a valid IFSC")
    return v, None


def _apply(value, slot, flt):
    if not value:
        return ""
    t = slot["type"]
    if flt == "inr":
        return V.format_inr(Decimal(value))
    if flt == "words":
        return V.amount_in_words(Decimal(value))
    if flt == "date" or (t == "date" and not flt):
        return value  # already formatted day-month-year
    if flt == "upper":
        return value.upper()
    if t == "amount" and not flt:
        return V.format_inr(Decimal(value))
    return value


def facts_hash(used: dict) -> str:
    """Same facts in, same hash out: the fingerprint of what the document is allowed to say."""
    canon = json.dumps(used, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()[:16]


def plain_value(entry):
    """Facts may arrive as plain values or as {value, source, ...} records."""
    if isinstance(entry, dict):
        return entry.get("value")
    return entry


def render(type_id: str, facts: dict) -> dict:
    d = get_type(type_id)
    if not d:
        raise KeyError(type_id)
    slots = {s["id"]: s for s in d["slots"]}
    values, problems = {}, []
    for sid, slot in slots.items():
        raw = plain_value((facts or {}).get(sid))
        val, problem = _normalise(slot, raw)
        if problem:
            problems.append({"slot": sid, "label": slot["label"], "message": f"{slot['label']} {problem}."})
        if val:
            values[sid] = val

    unresolved = {}

    def fill(text, drop_if_missing_optional=False):
        """Substitute anchors. Returns the text, or None when the line should be dropped."""
        dropped = False

        def sub(m):
            nonlocal dropped
            sid, flt = m.group(1), m.group(2)
            slot = slots[sid]
            val = values.get(sid, "")
            if not val:
                if drop_if_missing_optional and not slot.get("required"):
                    dropped = True
                    return ""
                unresolved.setdefault(sid, {"slot": sid, "label": slot["label"], "required": bool(slot.get("required")),
                                            "group": slot.get("group", "")})
                return BRACKET.format(slot["label"])
            return _apply(val, slot, flt)

        out = REF_RE.sub(sub, text or "")
        return None if dropped else out

    blocks, n, lc = [], 0, 0
    for b in d["blocks"]:
        if any(w not in values for w in (b.get("when") or [])):
            continue
        t = b["type"]
        if t in ("pagebreak", "spacer"):
            blocks.append({"type": t})
            continue
        if t in ("address", "signature"):
            lines = [x for x in (fill(l, True) for l in b.get("lines", [])) if x]
            blocks.append({"type": t, "lines": lines})
            continue
        if t == "table":
            rows = [[fill(c) for c in row] for row in b.get("rows", [])]
            blocks.append({"type": "table", "header": b.get("header", False), "rows": rows})
            continue
        if b.get("each"):
            sid = b["each"]
            lines = [x.strip() for x in values.get(sid, "").split("\n") if x.strip()]
            if not lines:
                fill("{{" + sid + "}}")                      # records the missing slot
                lines = [BRACKET.format(slots[sid]["label"])]
        else:
            lines = [fill(b.get("text", ""))]
        for text in lines:
            blk = {"type": t, "text": text}
            if t == "numbered":
                n += 1
                blk["number"] = n
            elif t == "lettered":
                lc += 1
                blk["letter"] = f"({chr(96 + lc) if lc <= 26 else lc})"
            if t != "lettered":
                lc = 0
            for k in ("align", "bold"):
                if k in b:
                    blk[k] = b[k]
            blocks.append(blk)

    used = {sid: values[sid] for sid in values}
    warnings = [{"level": "problem", "message": p["message"], "slot": p["slot"]} for p in problems]
    warnings += run_checks(d, values)
    ordered_unresolved = [unresolved[s["id"]] for s in d["slots"] if s["id"] in unresolved]
    return {
        "type": d["id"], "title": d.get("short") or d["label"], "blocks": blocks,
        "unresolved": ordered_unresolved, "warnings": warnings,
        "facts_hash": facts_hash({"type": d["id"], "facts": used}),
        "review": d.get("review", {}),
    }


# ── statutory timing checks (only when both dates are known; never assume a missing one) ────────
def _dt(values, key):
    return V.parse_date(values.get(key)) if values.get(key) else None


def _check_cheque_validity(values):
    c, p = _dt(values, "cheque_date"), _dt(values, "presentation_date")
    if not (c and p):
        return []
    out = []
    if p < c:
        out.append({"level": "problem", "message": "The presentation date is before the date on the cheque. Please re-check both."})
    latest = _add_months(c, 3)
    if p > latest:
        out.append({"level": "problem", "message": "The cheque appears to have been presented more than three months after its date. "
                    "Section 138 needs presentation within its validity, so check this before sending the notice."})
    return out


def _check_notice_30_days(values):
    r, n = _dt(values, "info_received_date"), _dt(values, "notice_date")
    if not (r and n):
        return []
    out = []
    if n < r:
        out.append({"level": "problem", "message": "The notice date is before the date your client received the return memo. Please re-check."})
    elif n - r > timedelta(days=30):
        out.append({"level": "problem", "message": "The notice is dated more than 30 days after your client received the return memo. "
                    "Section 138(b) requires the notice within 30 days, so this notice may be out of time."})
    return out


def _add_months(d, months):
    y, m = divmod(d.month - 1 + months, 12)
    y, m = d.year + y, m + 1
    for day in (d.day, 30, 29, 28):
        try:
            return d.replace(year=y, month=m, day=day)
        except ValueError:
            continue
    return d


def _check_lease_registration(values):
    try:
        months = int(values.get("term_months", ""))
    except ValueError:
        return []
    if months > 12:
        return [{"level": "note", "message": "A lease for more than one year must be registered (Section 17, Registration Act, 1908). "
                 "Check registration and stamp duty for your state before signing."}]
    return []


CHECKS = {"cheque_validity": _check_cheque_validity, "notice_within_30_days": _check_notice_30_days,
          "lease_registration": _check_lease_registration}


def run_checks(defn, values):
    out = []
    for name in defn.get("checks", []):
        fn = CHECKS.get(name)
        if fn:
            out.extend(fn(values))
    return out


def blocks_to_text(blocks) -> str:
    """Plain-text form of the structured document (used for verification and for text/preview parity)."""
    lines = []
    for b in blocks:
        t = b["type"]
        if t in ("address", "signature"):
            lines.extend(b.get("lines", []))
        elif t == "table":
            for row in b.get("rows", []):
                lines.append(" | ".join(row))
        elif t == "numbered":
            lines.append(f"{b['number']}. {b['text']}")
        elif t == "lettered":
            lines.append(f"{b.get('letter', '')} {b['text']}")
        elif t in ("pagebreak", "spacer"):
            lines.append("")
        else:
            lines.append(b.get("text", ""))
    return "\n".join(lines)


def fixed_text(type_id: str) -> str:
    """The reviewed wording of a type with every {{anchor}} removed. The verifier treats it as allowed."""
    d = get_type(type_id)
    if not d:
        return ""
    parts = []
    for b in d["blocks"]:
        parts.append(b.get("text", ""))
        parts.extend(b.get("lines", []) or [])
        for row in b.get("rows", []) or []:
            parts.extend(row)
    return REF_RE.sub(" ", "\n".join(parts))
