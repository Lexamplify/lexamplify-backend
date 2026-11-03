"""Claim check: which specific claims in an answer are NOT found in the text it was written from?

It looks at five kinds of claim and compares each, after normalising, with the retrieved source text:
  case      "X v. Y" / "X vs Y" / "X versus Y"
  section   "Section 138(1)(b)" (with sub-parts); "Sec.", "S." and "Sections 138 and 141" too
  amount    rupee amounts ("Rs 50,00,000", "Rs. 50 lakh", "Rs 5 crore", "fifty lakh rupees", "50 million rupees")
  years     lengths of time in years ("3 years", "three-year")
  date      "1 April 2021", "1st day of April 2021", "April 1, 2021", "01/04/2021" (day first), "2021-04-01"

Extra rule - unit consistency: when two amounts are written as the same sum ("Rs 50 million (Rs 50 lakhs)"), they must be equal
once converted (1 lakh = 100,000; 1 crore = 100 lakh; 1 million = 10 lakh). If they are not, the pair is flagged.

It does not decide whether the law is right. It only says "this item is not in the retrieved text, check it". A claim that is
found is not marked; a claim that is not found is returned as {text, kind, reason} and must be shown to the lawyer.
"""
from __future__ import annotations

import datetime as _dt
import re

MAX_FLAGS = 20

# ── numbers ───────────────────────────────────────────────────────────────────────────────────────────────────────────
_ONES = {w: i for i, w in enumerate(
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split())}
_TENS = {w: 10 * (i + 2) for i, w in enumerate("twenty thirty forty fifty sixty seventy eighty ninety".split())}
_NUM_WORD = r"(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)"
_NUM_WORDS = rf"{_NUM_WORD}(?:[\s-]+(?:and\s+)?{_NUM_WORD})*"
_NUM = rf"(?:\d[\d,]*(?:\.\d+)?|{_NUM_WORDS})"

_UNITS = {"thousand": 1_000, "k": 1_000, "lakh": 100_000, "lakhs": 100_000, "lac": 100_000, "lacs": 100_000,
          "crore": 10_000_000, "crores": 10_000_000, "cr": 10_000_000, "million": 1_000_000, "millions": 1_000_000,
          "mn": 1_000_000, "billion": 1_000_000_000, "billions": 1_000_000_000, "bn": 1_000_000_000}
_UNIT_RE = r"(?:thousand|k|lakhs?|lacs?|crores?|cr|millions?|mn|billions?|bn)"


def _words_to_number(text: str):
    total, current, seen = 0, 0, False
    for tok in re.split(r"[\s-]+", text.lower().strip()):
        if tok == "and" or not tok:
            continue
        if tok in _ONES:
            current += _ONES[tok]
        elif tok in _TENS:
            current += _TENS[tok]
        elif tok == "hundred":
            current = max(current, 1) * 100
        else:
            return None
        seen = True
    return (total + current) if seen else None


def _to_number(token: str):
    token = token.strip()
    if re.fullmatch(r"\d[\d,]*(?:\.\d+)?", token):
        try:
            return float(token.replace(",", ""))
        except ValueError:
            return None
    return _words_to_number(token)


# ── normalising text for substring comparison ─────────────────────────────────────────────────────────────────────────
def _norm_text(text: str) -> str:
    t = text.lower()
    t = re.sub(r"\b(?:versus|vs\.?|v\.)(?=\s)", " v ", t)
    t = re.sub(r"\bm/s\.?", " ", t)
    t = re.sub(r"[^\w\s]", " ", t)
    return re.sub(r"\s+", " ", t).strip()


# ── amounts ───────────────────────────────────────────────────────────────────────────────────────────────────────────
_CUR_BEFORE = r"(?:rs\.?|inr|₹|rupees)"
_AMOUNT_BEFORE = re.compile(rf"(?<![\w])({_CUR_BEFORE})\s*({_NUM})(?:\s*/-)?(?:\s*({_UNIT_RE})\b)?", re.I)
_AMOUNT_AFTER = re.compile(rf"(?<![\w])({_NUM})\s*({_UNIT_RE})?\s*(?:rupees|rs\b\.?)", re.I)


def _amount_value(num: str, unit):
    n = _to_number(num)
    if n is None:
        return None
    return int(round(n * (_UNITS[unit.lower()] if unit else 1)))


def find_amounts(text: str) -> list[tuple[str, int, int, int]]:
    """[(matched text, rupees, start, end)] for every rupee amount in the text."""
    out = []
    for m in _AMOUNT_BEFORE.finditer(text):
        v = _amount_value(m.group(2), m.group(3))
        if v is not None:
            out.append((m.group(0).strip(), v, m.start(), m.end()))
    for m in _AMOUNT_AFTER.finditer(text):
        v = _amount_value(m.group(1), m.group(2))
        if v is not None and not any(s <= m.start() < e for _, _, s, e in out):
            out.append((m.group(0).strip(), v, m.start(), m.end()))
    return out


def _bare_numbers(text: str) -> set[int]:
    """Plain figures in the source ("5000000", "50,00,000") count as the same sum even without a rupee sign."""
    return {int(float(x.replace(",", ""))) for x in re.findall(r"\d[\d,]{3,}(?:\.\d+)?", text) if x.replace(",", "").replace(".", "").isdigit()}


def _fmt_rupees(v: int) -> str:
    s = str(v)
    if len(s) <= 3:
        return f"Rs {s}"
    head, tail = s[:-3], s[-3:]
    parts = []
    while len(head) > 2:
        parts.insert(0, head[-2:])
        head = head[:-2]
    if head:
        parts.insert(0, head)
    return "Rs " + ",".join(parts + [tail])


# ── years (lengths of time) ───────────────────────────────────────────────────────────────────────────────────────────
_YEARS_RE = re.compile(rf"(?<![\w.])({_NUM})[\s-]*years?\b", re.I)
_MONTHS_RE = re.compile(rf"(?<![\w.])({_NUM})[\s-]*months?\b", re.I)


def find_years(text: str) -> list[tuple[str, float]]:
    out = []
    for m in _YEARS_RE.finditer(text):
        n = _to_number(m.group(1))
        if n is not None:
            out.append((m.group(0).strip(), n))
    return out


def _source_year_lengths(text: str) -> set[float]:
    have = {n for _, n in find_years(text)}
    for m in _MONTHS_RE.finditer(text):
        n = _to_number(m.group(1))
        if n is not None and n % 12 == 0:
            have.add(n / 12)
    return have


# ── dates ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
_MONTHS = {m: i + 1 for i, m in enumerate("january february march april may june july august september october november december".split())}
_MONTHS.update({m[:3]: i for m, i in list(_MONTHS.items())} | {"sept": 9})
_MON = r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
_DATE_PATTERNS = [
    ("dmy", re.compile(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+(?:(?:day\s+)?of\s+)?({_MON})\.?,?\s+(\d{{4}})\b", re.I)),
    ("mdy", re.compile(rf"\b({_MON})\.?\s+(\d{{1,2}})(?:st|nd|rd|th)?,?\s+(\d{{4}})\b", re.I)),
    ("num", re.compile(r"\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\b")),
    ("iso", re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")),
]


def _make_date(y, m, d):
    try:
        return _dt.date(int(y), int(m), int(d)).isoformat()
    except ValueError:
        return None


def find_dates(text: str) -> list[tuple[str, str]]:
    """[(matched text, ISO date)]. Numeric dates are read day first (Indian format)."""
    out, taken = [], []
    for kind, rx in _DATE_PATTERNS:
        for m in rx.finditer(text):
            if any(s <= m.start() < e for s, e in taken):
                continue
            g = m.groups()
            if kind == "dmy":
                iso = _make_date(g[2], _MONTHS[g[1].lower().rstrip(".")], g[0])
            elif kind == "mdy":
                iso = _make_date(g[2], _MONTHS[g[0].lower().rstrip(".")], g[1])
            elif kind == "num":
                iso = _make_date(g[2], g[1], g[0])
            else:
                iso = _make_date(g[0], g[1], g[2])
            if iso:
                out.append((m.group(0), iso))
                taken.append((m.start(), m.end()))
    return out


# ── sections ──────────────────────────────────────────────────────────────────────────────────────────────────────────
_SEC = r"\d+[A-Za-z]{0,2}(?:\s*\(\s*[A-Za-z0-9]+\s*\))*"
_SECTION_RE = re.compile(rf"(?<![\w])(?:sections?|secs?\.?|s\.|धारा|பிரிவு)\s*({_SEC}(?:\s*(?:,|and|&|or|to|-|और|மற்றும்)\s*{_SEC})*)", re.I)


def _norm_section(s: str) -> str:
    return re.sub(r"\s+", "", s).lower()


def find_sections(text: str) -> list[tuple[str, str]]:
    out = []
    for m in _SECTION_RE.finditer(text):
        for part in re.findall(_SEC, m.group(1)):
            out.append((f"Section {re.sub(chr(10), ' ', part).strip()}", _norm_section(part)))
    return out


# ── case names ────────────────────────────────────────────────────────────────────────────────────────────────────────
_NAME_WORD = r"(?:[A-Z][\w.&'’-]*|of|and|&|the|for|ors\.?|anr\.?)"
_PARTY = rf"[A-Z][\w.&'’-]*(?:\s+{_NAME_WORD}){{0,6}}"
_CASE_RE = re.compile(rf"({_PARTY})\s+(?:v\.?|vs\.?|versus)\s+({_PARTY})")


_LEAD_WORDS = {"in", "the", "see", "under", "as", "also", "per", "held", "whether", "and", "but", "however", "thus", "where", "after",
               "before", "following", "citing", "case", "cases", "for", "of", "by", "on", "with", "from", "this", "that", "it"}
_TRAIL_WORDS = {"of", "and", "&", "the", "for", "ors", "anr"}


def _trim_party(party: str, lead: bool) -> str:
    words = party.split()
    while lead and len(words) > 1 and words[0].lower().rstrip(".,") in _LEAD_WORDS:
        words.pop(0)
    while len(words) > 1 and words[-1].lower().rstrip(".,;:") in _TRAIL_WORDS:
        words.pop()
    return " ".join(words).rstrip(".,;:")


def find_cases(text: str) -> list[tuple[str, str]]:
    out = []
    for m in _CASE_RE.finditer(text):
        left, right = _trim_party(m.group(1), True), _trim_party(m.group(2), False)
        out.append((f"{left} v. {right}", _norm_text(f"{left} v {right}")))
    return out


# ── the check ─────────────────────────────────────────────────────────────────────────────────────────────────────────
def _consistency_flags(answer: str) -> list[dict]:
    """Two amounts written as the same sum, one after the other, must be equal ("Rs 50 million (Rs 50 lakhs)" is not)."""
    flags, amounts = [], find_amounts(answer)
    for (t1, v1, s1, e1), (t2, v2, s2, e2) in zip(amounts, amounts[1:]):
        between = answer[e1:s2]
        if len(between) <= 40 and re.fullmatch(r"\s*(?:\(|\[|,?\s*(?:i\.e\.|ie|or|that is|equivalent to|being|=)\s*)\s*", between, re.I) and v1 != v2:
            span = answer[s1:e2].strip()
            flags.append({"text": span + (")" if span.count("(") > span.count(")") else ""), "kind": "amount",
                          "reason": f"The two amounts do not match: {t1} is {_fmt_rupees(v1)} but {t2} is {_fmt_rupees(v2)} "
                                    "(1 lakh = 100,000; 1 crore = 100 lakh; 1 million = 10 lakh)."})
    return flags


def check_claims(answer: str, source_text: str) -> list[dict]:
    """Claims in `answer` that are not found in `source_text`. [] when everything checkable was found."""
    answer = re.sub(r"\s?\[S\d+\]", "", answer or "")
    source = source_text or ""
    src_norm = _norm_text(source)
    flags, seen = [], set()

    def add(text, kind, reason):
        key = (kind, re.sub(r"\s+", " ", text).strip().lower())
        if key not in seen:
            seen.add(key)
            flags.append({"text": text.strip(), "kind": kind, "reason": reason})

    for f in _consistency_flags(answer):
        add(f["text"], f["kind"], f["reason"])

    for text, norm in find_cases(answer):
        left, _, right = norm.partition(" v ")
        if not (left and right and left in src_norm and right in src_norm):
            add(text, "case", "This case name was not found in the retrieved sources.")

    src_sections = {n for _, n in find_sections(source)}
    for text, norm in find_sections(answer):
        if norm not in src_sections:
            base = re.match(r"\d+[a-z]{0,2}", norm).group(0)
            why = ("This sub-part was not found in the retrieved sources (only the main section appears)."
                   if norm != base and base in src_sections else "This section was not found in the retrieved sources.")
            add(text, "section", why)

    src_amounts = {v for _, v, _, _ in find_amounts(source)} | _bare_numbers(source)
    for text, value, _, _ in find_amounts(answer):
        if value not in src_amounts:
            add(text, "amount", f"This amount ({_fmt_rupees(value)}) was not found in the retrieved sources.")

    src_years = _source_year_lengths(source)
    for text, n in find_years(answer):
        if n not in src_years:
            add(text, "years", "This period was not found in the retrieved sources.")

    src_dates = {iso for _, iso in find_dates(source)}
    for text, iso in find_dates(answer):
        if iso not in src_dates:
            add(text, "date", "This date was not found in the retrieved sources.")

    return flags[:MAX_FLAGS]


# ── old criminal-code currency note (pure rule, no model calls) ───────────────────────────────────────────────────────
OLD_LAW_CURRENCY_NOTE = (
    "IPC, CrPC and the Evidence Act were replaced by BNS, BNSS and BSA from 1 July 2024. "
    "Check which law applies to your case dates."
)

_OLD_CRIMINAL_LAW_RE = re.compile(
    r"(?<![A-Za-z0-9])(?:"
    r"Cr\.\s*P\.\s*C\.?|CrPC|"
    r"I\.\s*P\.\s*C\.?|IPC|"
    r"Code\s+of\s+Criminal\s+Procedure|"
    r"Criminal\s+Procedure\s+Code|"
    r"Indian\s+Penal\s+Code|"
    r"Indian\s+Evidence\s+Act|"
    r"Evidence\s+Act,\s*1872"
    r")(?![A-Za-z0-9])",
    re.I,
)

_NEW_CRIMINAL_LAW_RE = re.compile(
    r"(?<![A-Za-z0-9])(?:"
    r"B\.\s*N\.\s*S\.\s*S\.?|BNSS|"
    r"B\.\s*N\.\s*S\.?|BNS|"
    r"B\.\s*S\.\s*A\.?|BSA|"
    r"Bharatiya\s+Nyaya\s+Sanhita|"
    r"Bharatiya\s+Nagarik\s+Suraksha\s+Sanhita|"
    r"Bharatiya\s+Sakshya\s+Adhiniyam"
    r")(?![A-Za-z0-9])",
    re.I,
)


def currency_flags(text: str) -> list[dict]:
    """Return a single criminal_codes_2024 note when `text` names IPC/CrPC/Indian Evidence Act without also naming BNS/BNSS/BSA."""
    raw = text or ""
    if not _OLD_CRIMINAL_LAW_RE.search(raw):
        return []
    if _NEW_CRIMINAL_LAW_RE.search(raw):
        return []
    return [{"code": "criminal_codes_2024", "note": OLD_LAW_CURRENCY_NOTE}]
