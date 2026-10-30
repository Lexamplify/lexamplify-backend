"""Anti-hallucination verifier.

Given a piece of generated text and the facts the advocate actually confirmed, find every amount, date,
case number, ID number, person/company name and statute citation in the text and check it against those facts
(or the fixed template). Anything else is reported, and can be turned into a [Bracketed Field].

It is deliberately conservative: it only judges things it can recognise by pattern, and it reports what it
could not check. It proves "this value was not given to me", not "this document is legally correct".
"""
import json
import os
import re
from decimal import Decimal

from . import validators as V

_STATUTES_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "doc_types", "statutes.json")

MONTHS = r"(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)"
DATE_RES = [
    re.compile(r"\b\d{1,2}(?:st|nd|rd|th)?\s+" + MONTHS + r"[a-z]*\.?,?\s+\d{4}\b", re.I),
    re.compile(r"\b\d{1,2}[/\-.]\d{1,2}[/\-.]\d{4}\b"),
    re.compile(r"\b\d{4}-\d{2}-\d{2}\b"),
]
AMOUNT_RE = re.compile(r"(?:₹|Rs\.?|INR)\s*([0-9][0-9,]*(?:\.\d{1,2})?)(?:\s*/-)?", re.I)
CASE_NO_RE = re.compile(r"\b((?:[A-Z][A-Za-z.()]{0,14}\s+){0,2}(?:No\.?|Nos\.?|Case\s+No\.?|C\.C\.?\s*No\.?)\s*[:\-]?\s*\d{1,6}\s*/\s*\d{2,4})\b")
CHEQUE_RE = re.compile(r"cheque\s*(?:no\.?|number|#)?\s*[:\-]?\s*(\d{6})\b", re.I)
PAN_RE = re.compile(r"\b[A-Z]{5}[0-9]{4}[A-Z]\b")
GSTIN_RE = re.compile(r"\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b")
MOBILE_RE = re.compile(r"(?<![\d])(?:\+?91[\s\-]?)?[6-9]\d{9}(?![\d])")
PIN_RE = re.compile(r"(?<![\d,])[1-9]\d{5}(?![\d,/])")
HONORIFIC_NAME_RE = re.compile(
    r"\b(?:Mr|Mrs|Ms|Shri|Smt|Sri|Dr|Adv|M/s)\.?[ \t]+((?:[A-Z][A-Za-z.'\-]+)(?:[ \t]+[A-Z][A-Za-z.'\-]+){0,4})")
COMPANY_RE = re.compile(
    r"\b((?:[A-Z][A-Za-z&.'\-]+[ \t]+){1,5}(?:Pvt\.?[ \t]+Ltd\.?|Private[ \t]+Limited|Limited|Ltd\.?|LLP|Industries|Enterprises|Traders|Agencies|Associates|& Co\.?|Corporation|Bank))\b")
RELATION_NAME_RE = re.compile(r"\b(?:S/o|D/o|W/o|C/o)\.?[ \t]+((?:[A-Z][A-Za-z.'\-]+)(?:[ \t]+[A-Z][A-Za-z.'\-]+){0,3})")

_NAME_NOISE = {"the", "and", "of", "for", "to", "in", "on", "by", "a", "an", "as", "at", "dated", "being"}


def _load_statutes():
    with open(_STATUTES_PATH, encoding="utf-8") as fh:
        return json.load(fh)["acts"]


_ACTS = _load_statutes()


def _alias_table():
    rows = []
    for a in _ACTS:
        names = {a["name"], re.sub(r",\s*\d{4}$", "", a["name"])} | set(a["aliases"])
        for n in names:
            rows.append((n, a))
    rows.sort(key=lambda r: -len(r[0]))
    return rows


_ALIASES = _alias_table()
_ALIAS_RE = re.compile(
    r"(?<![A-Za-z])(" + "|".join(re.escape(n) for n, _ in _ALIASES) + r")(?:\s*,?\s*(\d{4}))?(?![A-Za-z])")
_ALIAS_MAP = {n.lower(): a for n, a in _ALIASES}
_GENERIC_ACT_RE = re.compile(r"((?:[A-Z][\w&'\-]*\s+(?:(?:of|and|for|the|&)\s+)?){1,8}(?:Act|Code|Sanhita|Adhiniyam)),?\s+(\d{4})")
_SECTION_RE = re.compile(
    r"\b(?:Sections?|Secs?\.?|Ss\.)\s*(\d+[A-Za-z]{0,2}(?:\s*\([0-9A-Za-z]+\))*(?:\s*(?:,|and|&|or|to|/)\s*\d+[A-Za-z]{0,2}(?:\s*\([0-9A-Za-z]+\))*)*)")
_NUM_RE = re.compile(r"\d+")
_ARTICLE_RE = re.compile(r"\bArticles?\s+(\d+)[A-Za-z]?\b")


def _norm_name(s: str) -> str:
    toks = [t for t in re.findall(r"[a-z0-9]+", s.lower()) if t not in _NAME_NOISE]
    return " ".join(toks)


def _compact(s) -> str:
    return re.sub(r"[\s\-]", "", str(s or "")).upper()


def _dedupe(items):
    seen, out = set(), []
    for it in items:
        k = (it["kind"], it["text"])
        if k not in seen:
            seen.add(k)
            out.append(it)
    return out


def allowed_from_facts(facts: dict, extra_text: str = "") -> dict:
    """Index every confirmed fact (and the fixed template text) so we can look values up by kind."""
    allowed = {"amount": set(), "date": set(), "name": set(), "id": set(), "text": ""}
    blob = [extra_text or ""]
    for _k, entry in (facts or {}).items():
        v = entry.get("value") if isinstance(entry, dict) else entry
        if v is None or v == "":
            continue
        s = str(v)
        blob.append(s)
        amt = V.parse_amount(s)
        if amt is not None:
            allowed["amount"].add(amt)
        d = V.parse_date(s)
        if d:
            allowed["date"].add(d)
        allowed["id"].add(_compact(s))
    # any amount / date / id written inside the facts' free text is also something the advocate supplied
    text = "\n".join(blob)
    allowed["text"] = text
    for m in AMOUNT_RE.finditer(text):
        a = V.parse_amount(m.group(1))
        if a is not None:
            allowed["amount"].add(a)
    for rx in DATE_RES:
        for m in rx.finditer(text):
            d = V.parse_date(re.sub(r"(?i)(\d)(st|nd|rd|th)", r"\1", m.group(0)))
            if d:
                allowed["date"].add(d)
    for rx in (PAN_RE, GSTIN_RE, MOBILE_RE, PIN_RE):
        for m in rx.finditer(text):
            allowed["id"].add(_compact(m.group(0)))
    allowed["name_blob"] = _norm_name(text)
    return allowed


def _name_allowed(name: str, allowed) -> bool:
    n = _norm_name(name)
    if not n:
        return True
    blob = allowed["name_blob"]
    return n in blob or all(tok in blob.split() for tok in n.split())


def find_claims(text: str) -> list:
    """Every checkable claim in the text: {kind, text, span}."""
    claims = []
    for m in AMOUNT_RE.finditer(text):
        claims.append({"kind": "amount", "text": m.group(0).strip(), "value": m.group(1), "span": m.span()})
    for rx in DATE_RES:
        for m in rx.finditer(text):
            claims.append({"kind": "date", "text": m.group(0), "span": m.span()})
    for m in CASE_NO_RE.finditer(text):
        claims.append({"kind": "case number", "text": m.group(1), "span": m.span(1)})
    for m in CHEQUE_RE.finditer(text):
        claims.append({"kind": "cheque number", "text": m.group(1), "span": m.span(1)})
    for rx, kind in ((GSTIN_RE, "GSTIN"), (PAN_RE, "PAN")):
        for m in rx.finditer(text):
            claims.append({"kind": kind, "text": m.group(0), "span": m.span()})
    for m in MOBILE_RE.finditer(text):
        claims.append({"kind": "mobile number", "text": m.group(0).strip(), "span": m.span()})
    for rx in (HONORIFIC_NAME_RE, RELATION_NAME_RE):
        for m in rx.finditer(text):
            claims.append({"kind": "name", "text": m.group(1).strip(" ."), "span": m.span(1)})
    for m in COMPANY_RE.finditer(text):
        claims.append({"kind": "name", "text": m.group(1).strip(), "span": m.span(1)})
    return claims


def check_citations(text: str) -> list:
    """Statute citations that cannot exist: unknown Act, or a section number above the Act's last section."""
    issues = []
    known_spans = []
    for m in _ALIAS_RE.finditer(text):
        known_spans.append(m.span())
    for m in _GENERIC_ACT_RE.finditer(text):
        name = re.sub(r"\s+", " ", m.group(1)).strip()
        # strip leading words that are only sentence starters ("Under the", "As per")
        name = re.sub(r"^(?:(?:Under|As|Per|In|The|Of|By|With|And|Read|Section|Sections)\s+)+", "", name, flags=re.I).strip()
        if not name:
            continue
        key = name.lower()
        year = m.group(2)
        known = any(abs(m.start() - s) < 90 and e >= m.start() for s, e in known_spans) or key in _ALIAS_MAP
        if not known:
            # a generic Act name whose full name+year matches a known Act is fine
            if any(a["name"].lower() == f"{key}, {year}" for a in _ACTS):
                continue
            issues.append({"kind": "citation", "text": f"{name}, {year}", "span": m.span(),
                           "reason": "This Act is not in the approved list of statutes, so it cannot be confirmed. Check the name and year."})
    for m in _SECTION_RE.finditer(text):
        window = text[m.end(): m.end() + 170]
        am = _ALIAS_RE.search(window)
        if not am:
            continue
        # the Act must be the next Act named, with no sentence break in between
        between = window[: am.start()]
        if re.search(r"[.;]\s+[A-Z]", between) or "\n" in between:
            continue
        act = _ALIAS_MAP.get(am.group(1).lower())
        if not act:
            continue
        for num in _NUM_RE.findall(re.sub(r"\([0-9A-Za-z]+\)", "", m.group(1))):
            if int(num) > act["max_section"]:
                issues.append({"kind": "citation", "text": f"Section {num} of the {act['name']}", "span": m.span(),
                               "reason": f"The {act['name']} has no section {num}. This may be a section from an older law (for example the IPC) cited under the new one."})
    return issues


def verify(text: str, facts: dict, template_text: str = "") -> dict:
    """Return {ok, issues:[...], checked:int}. `template_text` is fixed wording that is allowed to say anything
    it contains (it is reviewed text, not model output)."""
    allowed = allowed_from_facts(facts, template_text)
    issues = []
    claims = find_claims(text)
    for c in claims:
        kind, raw = c["kind"], c["text"]
        ok = True
        if kind == "amount":
            amt = V.parse_amount(c["value"])
            ok = amt is not None and amt in allowed["amount"]
            # amounts written in words are checked through the digits they sit beside; small figures like Rs. 5 allowed
        elif kind == "date":
            d = V.parse_date(re.sub(r"(?i)(\d)(st|nd|rd|th)", r"\1", raw))
            ok = d is not None and d in allowed["date"]
        elif kind in ("PAN", "GSTIN", "mobile number"):
            ok = _compact(V.normalise_mobile(raw) if kind == "mobile number" else raw) in allowed["id"]
        elif kind == "cheque number":
            ok = raw in allowed["text"] or _compact(raw) in allowed["id"]
        elif kind == "case number":
            ok = _compact(raw) in _compact(allowed["text"]) or re.sub(r"\s", "", raw.split()[-1]) in re.sub(r"\s", "", allowed["text"])
        elif kind == "name":
            ok = _name_allowed(raw, allowed)
        if not ok:
            issues.append({"kind": kind, "text": raw, "span": c["span"],
                           "reason": f"This {kind} was not in the details you confirmed."})
    issues.extend(check_citations(text))
    issues = _dedupe(issues)
    return {"ok": not issues, "issues": issues, "checked": len(claims)}


def bracket_unverified(text: str, issues: list) -> str:
    """Replace each unverifiable value with a bracketed field so the advocate must supply it."""
    spans = sorted({tuple(i["span"]) for i in issues if i["kind"] != "citation"}, reverse=True)
    label = {i["span"]: i["kind"] for i in issues}
    out = text
    for s, e in spans:
        out = out[:s] + f"[Bracketed Field: {label.get((s, e), 'detail')}]" + out[e:]
    return out
