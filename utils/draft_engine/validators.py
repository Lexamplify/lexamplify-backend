"""Indian-format validators and formatters used by the drafting engine. Pure functions, no I/O."""
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
           "September", "October", "November", "December"]
_MONTH_LOOKUP = {m.lower(): i + 1 for i, m in enumerate(_MONTHS)}
_MONTH_LOOKUP.update({m[:3].lower(): i + 1 for i, m in enumerate(_MONTHS)})
_MONTH_LOOKUP["sept"] = 9

PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
IFSC_RE = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")
PIN_RE = re.compile(r"^[1-9][0-9]{5}$")
MOBILE_RE = re.compile(r"^[6-9][0-9]{9}$")
CHEQUE_RE = re.compile(r"^[0-9]{6}$")
_GST_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
_GST_RE = re.compile(r"^(0[1-9]|[1-2][0-9]|3[0-8])[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")


def _compact(value) -> str:
    return re.sub(r"[\s\-]", "", str(value or "")).upper()


def valid_pan(value) -> bool:
    return bool(PAN_RE.match(_compact(value)))


def valid_ifsc(value) -> bool:
    return bool(IFSC_RE.match(_compact(value)))


def valid_pin(value) -> bool:
    return bool(PIN_RE.match(re.sub(r"\s", "", str(value or ""))))


def normalise_mobile(value) -> str:
    """Return the 10-digit number, or '' if it is not a valid Indian mobile."""
    digits = re.sub(r"\D", "", str(value or ""))
    if digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    elif digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]
    return digits if MOBILE_RE.match(digits) else ""


def valid_mobile(value) -> bool:
    return bool(normalise_mobile(value))


def valid_cheque_no(value) -> bool:
    return bool(CHEQUE_RE.match(re.sub(r"\s", "", str(value or ""))))


def valid_gstin(value) -> bool:
    g = _compact(value)
    if not _GST_RE.match(g):
        return False
    total = 0
    for i, ch in enumerate(g[:14]):
        product = _GST_CHARS.index(ch) * (1 if i % 2 == 0 else 2)
        total += product // 36 + product % 36
    return g[14] == _GST_CHARS[(36 - total % 36) % 36]


# ── dates ────────────────────────────────────────────────────────────────────
def parse_date(value):
    """Parse the date styles Indian documents use. Returns a date or None; never guesses a missing part."""
    s = str(value or "").strip().rstrip(".")
    if not s:
        return None
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})$", s)
    if m:
        y, mo, d = map(int, m.groups())
    else:
        m = re.match(r"^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$", s)
        if m:
            d, mo, y = map(int, m.groups())          # Indian order: day first
        else:
            m = re.match(r"^(\d{1,2})(?:st|nd|rd|th)?[\s\-]+([A-Za-z]{3,9})[,\s\-]+(\d{4})$", s)
            if not m:
                return None
            d = int(m.group(1))
            mo = _MONTH_LOOKUP.get(m.group(2).lower())
            y = int(m.group(3))
            if not mo:
                return None
    try:
        return date(y, mo, d)
    except ValueError:
        return None


def format_date(d) -> str:
    """17 October 2026 (no leading zero)."""
    if isinstance(d, datetime):
        d = d.date()
    return f"{d.day} {_MONTHS[d.month - 1]} {d.year}"


# ── money ────────────────────────────────────────────────────────────────────
def parse_amount(value):
    """'₹4,75,000/-', 'Rs. 475000', '4,75,000.50' -> Decimal, or None. Lakh/crore words are not guessed."""
    s = str(value or "")
    if re.search(r"\b(lakh|lac|crore|cr)\b", s, re.I):
        return None
    s = re.sub(r"(?i)(rs\.?|inr|₹|/-|rupees|only)", " ", s)
    s = s.replace(",", "").strip()
    if not re.match(r"^\d+(\.\d{1,2})?$", s):
        return None
    try:
        amt = Decimal(s)
    except InvalidOperation:
        return None
    return amt if amt > 0 else None


def format_inr(amount) -> str:
    """Indian digit grouping: 475000 -> ₹4,75,000 ; 1250000.5 -> ₹12,50,000.50"""
    amt = Decimal(amount).quantize(Decimal("0.01"))
    whole, frac = f"{amt:.2f}".split(".")
    head, tail = whole[:-3], whole[-3:]
    if head:
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        whole = ",".join(parts) + "," + tail
    return "₹" + whole + ("" if frac == "00" else "." + frac)


_ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
         "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"]
_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]


def _below_100(n):
    return _ONES[n] if n < 20 else _TENS[n // 10] + (" " + _ONES[n % 10] if n % 10 else "")


def _below_1000(n):
    out = []
    if n >= 100:
        out.append(_ONES[n // 100] + " Hundred")
        n %= 100
    if n:
        out.append(_below_100(n))
    return " ".join(out)


def number_to_words(n: int) -> str:
    if n == 0:
        return "Zero"
    parts = []
    for unit, size in (("Crore", 10_000_000), ("Lakh", 100_000), ("Thousand", 1000)):
        if n >= size:
            q, n = divmod(n, size)
            parts.append((number_to_words(q) if q >= 1000 else _below_1000(q)) + " " + unit)
    if n:
        parts.append(_below_1000(n))
    return " ".join(parts)


def amount_in_words(amount) -> str:
    """Decimal -> 'Rupees Four Lakh Seventy-Five Thousand Only' (paise included when present)."""
    amt = Decimal(amount).quantize(Decimal("0.01"))
    rupees, paise = int(amt), int((amt - int(amt)) * 100)
    text = "Rupees " + number_to_words(rupees)
    if paise:
        text += " and " + number_to_words(paise) + " Paise"
    return text + " Only"
