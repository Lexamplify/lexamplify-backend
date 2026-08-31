"""
services/court_scraper.py
Live judicial-roster scraper — upserts JudicialOfficer rows from each
district's official court site. No fabricated data: a cell that fails to
parse is left as None (and, on an existing record, left UNCHANGED — see
_upsert_judge) rather than guessed at or blanked out.

── Rohini North-West District (delhi_rohini_nw) ──────────────────────────
The directive's originally-given URL (delhidistrictcourts.nic.in/lockdown-
filing) is NOT a judges directory — live inspection showed it's a leftover
COVID-era "admit card" print page, unrelated to any roster. The correct
source, per the official site's own "List of Judges" nav item, is the
modern eCourts-platform subdomain:
    https://rohini.dcourts.gov.in/list-of-judges/
Confirmed live: 13 `table.data-table-1` blocks (one per designation
category — "District and Sessions Judge", "District Judge Commercial
Court", etc.), each with a uniform 5-column row:
    td[0] profile photo (unused) · td[1] name (as an <a> link) ·
    td[2] designation · td[3] room number · td[4] location
42 rows observed, all "North West District" — this subdomain serves only
that one district, matching delhi_rohini_nw exactly. No rowspans/colspans
were found across any table (verified programmatically), so the fixed
5-cell-per-row assumption below is safe for this source as it stands today
— re-verify if the site's markup changes.

VC links/meeting IDs are NOT available in this table — see the PDF scraper
below for those.

── VC-links PDF circular (scrape_vc_links_from_pdf) ──────────────────────
Fetched from https://rohini.dcourts.gov.in/document-category/vc-links/'s
"Video Conference Hearing Links" PDF. Confirmed live via pdfplumber against
the actual August-2026 circular: a genuine gridded table (extract_tables()
finds it cleanly, no OCR/text-position guessing needed), 8 columns —
Sr.No / Name+Designation / Court No. / Reader Name / Reader Mobile /
Court Email / Meeting Number / Virtual Court URL — split across 2 pages
(17 + 17 rows; the header row is present only on page 1's table, not
repeated on page 2's continuation).

IMPORTANT, found by testing against the real file: naively regex-scanning
the WHOLE joined row string for a 9-11-digit sequence (as a first draft of
this scraper did) silently extracts the wrong number, because "Reader
Mobile" is itself a bare 10-digit number and sits BEFORE the real "Meeting
Number" column in row order — e.g. for row 1, that approach returns
'9911230168' (the reader's phone) instead of '1768361187' (the actual
meeting number). Column position, not a blind row-wide regex, is what
actually disambiguates them. So: the header row is located once (by
content, not a fixed page number, since it isn't repeated across pages)
and its columns mapped by keyword; every row after that — regardless of
which page/table it came from — is read from the mapped Meeting Number /
Virtual Court URL / Name columns specifically. If a future district's PDF
doesn't have a recognizable header (different authority, different
layout), extraction falls back to the original whole-row regex scan rather
than failing outright — degraded, not broken.
"""
import os
import re
import tempfile
import uuid

import pdfplumber
import requests
import urllib3
from bs4 import BeautifulSoup

from database import db
from models.court_models import JudicialOfficer

# delhidistrictcourts.nic.in (and its subdomains) frequently present broken/
# misconfigured certificate chains — verify=False avoids a hard crash on an
# otherwise-reachable government site. Suppressed globally at import time
# since every call site below uses verify=False by design, not by accident.
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
}

_DISTRICT_URLS = {
    "delhi_rohini_nw": "https://rohini.dcourts.gov.in/list-of-judges/",
}


def _parse_roster(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    judges = []
    for table in soup.select("table.data-table-1"):
        for tr in table.select("tbody tr"):
            tds = tr.find_all("td")
            if len(tds) < 4:
                continue  # not a judge row we recognize — skip, don't guess
            name_cell = tds[1]
            name_link = name_cell.find("a")
            name = (name_link or name_cell).get_text(strip=True)
            designation = tds[2].get_text(strip=True)
            court_room = tds[3].get_text(strip=True)
            if not name:
                continue
            judges.append({
                "hmj": name,
                "designation": designation or None,
                "court_room": court_room or None,
            })
    return judges


def _upsert_judge(district_key: str, parsed: dict) -> None:
    existing = JudicialOfficer.query.filter_by(
        hmj=parsed["hmj"], district_key=district_key
    ).first()

    if existing:
        # Only overwrite a field when the scrape actually produced a value —
        # a blank/failed cell must never clobber a previously-known-good one.
        if parsed.get("designation"):
            existing.designation = parsed["designation"]
        if parsed.get("court_room"):
            existing.court_room = parsed["court_room"]
        if parsed.get("vc_link"):
            existing.vc_link = parsed["vc_link"]
        if parsed.get("vc_meeting_id"):
            existing.vc_meeting_id = parsed["vc_meeting_id"]
    else:
        db.session.add(JudicialOfficer(
            id=str(uuid.uuid4()),
            district_key=district_key,
            hmj=parsed["hmj"],
            designation=parsed.get("designation"),
            court_room=parsed.get("court_room"),
            vc_link=parsed.get("vc_link"),
            vc_meeting_id=parsed.get("vc_meeting_id"),
        ))


def scrape_and_upsert_roster(district_key: str = "delhi_rohini_nw") -> bool:
    target_url = _DISTRICT_URLS.get(district_key)
    if not target_url:
        print(f"Scraper Error: no known roster URL for district_key={district_key!r}")
        return False

    try:
        response = requests.get(target_url, headers=_HEADERS, timeout=15, verify=False)
        response.raise_for_status()

        judges = _parse_roster(response.text)
        if not judges:
            # Zero rows almost always means the site's markup changed under
            # us, not that the roster is genuinely empty — treat as a
            # failure rather than silently committing nothing as "success".
            print(f"Scraper Error: parsed 0 judges from {target_url} — selectors may be stale")
            return False

        for parsed in judges:
            _upsert_judge(district_key, parsed)

        db.session.commit()
        print(f"Upserted {len(judges)} judicial officer record(s) for {district_key}.")
        return True

    except Exception as e:
        print(f"Scraper Error: {e}")
        db.session.rollback()
        return False


# ── VC-links PDF circular extraction ───────────────────────────────────────

_HONORIFIC_RE = re.compile(
    r"\b(sh|shri|smt|ms|dr|mr|hon'?ble|justice|cjm|acjm|mm|asj|dj)\b\.?",
    re.IGNORECASE,
)
_NON_ALPHA_RE = re.compile(r"[^a-zA-Z\s]")
_WEBEX_RE = re.compile(r"https?://[^\s]*webex\.com/[^\s]*", re.IGNORECASE)
_MEETING_ID_RE = re.compile(r"\b(\d{3,4}[\s\-]?\d{3,4}[\s\-]?\d{3,4})\b")


def normalize_name(name):
    if not name:
        return ""
    cleaned = _HONORIFIC_RE.sub("", str(name))
    cleaned = _NON_ALPHA_RE.sub("", cleaned)
    return " ".join(cleaned.lower().split())


def normalize_room(room):
    if not room:
        return ""
    return "".join(re.findall(r"\d+", str(room)))


def extract_webex_link(text, hyperlinks=None):
    if not text and not hyperlinks:
        return None
    text_clean = " ".join(str(text or "").split())
    match = _WEBEX_RE.search(text_clean)
    if match:
        return match.group(0).rstrip(",.;:)")
    if hyperlinks:
        for link in hyperlinks:
            uri = link.get("uri", "")
            if "webex.com" in uri.lower():
                return uri.strip()
    return None


def extract_meeting_id(text):
    if not text:
        return None
    text_clean = " ".join(str(text).split())
    for m in _MEETING_ID_RE.findall(text_clean):
        digits = re.sub(r"[\s\-]", "", m)
        if 9 <= len(digits) <= 11:
            return digits
    return None


def _clean_cell(cell) -> str:
    return " ".join(str(cell or "").split())


def _looks_like_header_row(row) -> bool:
    joined = " ".join(_clean_cell(c).lower() for c in row)
    return "meeting" in joined and ("officer" in joined or "judge" in joined)


def _locate_pdf_columns(header_row) -> dict:
    """Maps a header row's cells to {'name'|'room'|'meeting'|'link': index}
    by keyword, so data rows can be read from the RIGHT column instead of a
    row-wide regex scan — see the module docstring for why that matters
    (the Reader Mobile column collides with the Meeting Number regex)."""
    columns = {}
    for idx, cell in enumerate(header_row):
        h = _clean_cell(cell).lower()
        if "meeting" in h:
            columns["meeting"] = idx
        elif "url" in h or "webex" in h:
            columns["link"] = idx
        elif "court" in h and "no" in h:
            columns["room"] = idx
        elif "name" in h and "officer" in h:
            columns["name"] = idx
    return columns


def _iter_pdf_rows(pdf):
    """Yields (row, page_hyperlinks, columns) for every data row across every
    page/table of the PDF, resolving `columns` ONCE from whichever table
    carries the header (it isn't necessarily repeated on later pages — see
    module docstring) and reusing it for every subsequent row. `columns` is
    {} for rows read before any header is found, signalling callers to fall
    back to the whole-row regex scan for that row."""
    columns: dict = {}
    for page in pdf.pages:
        tables = page.extract_tables() or []
        page_hyperlinks = getattr(page, "hyperlinks", [])
        for table in tables:
            for row in table:
                if not row:
                    continue
                if _looks_like_header_row(row):
                    if not columns:
                        columns = _locate_pdf_columns(row)
                    continue  # never treat a header row as data, first or repeated
                yield row, page_hyperlinks, dict(columns)


def _match_officer(row, officers) -> "JudicialOfficer | None":
    # Priority 1: normalized name — WHOLE-WORD containment either direction
    # (a cell often combines "Name, Designation" and hmj is name-only).
    # Plain substring containment was tried first and, against the real PDF,
    # matched "Ms. Gita" (normalizes to just "gita") to an unrelated row for
    # "Sh. Yashu Khurana ... Digital Traffic Court" — "gita" is a raw
    # substring of "digital". Comparing word SETS instead of raw strings
    # fixes that: "gita" is a whole word in her own row but not in
    # "digital traffic court".
    for cell in row:
        cell_words = set(normalize_name(cell).split())
        if not cell_words:
            continue
        for off in officers:
            off_words = set(normalize_name(off.hmj).split())
            if off_words and (off_words <= cell_words or cell_words <= off_words):
                return off

    # Priority 2: court room number fallback.
    for cell in row:
        room_num = normalize_room(cell)
        if not room_num:
            continue
        for off in officers:
            if off.court_room and normalize_room(off.court_room) == room_num:
                return off
    return None


def scrape_vc_links_from_pdf(pdf_source, district_key="delhi_rohini_nw"):
    temp_path = None
    try:
        if pdf_source.startswith("http://") or pdf_source.startswith("https://"):
            res = requests.get(pdf_source, headers=_HEADERS, verify=False, timeout=25)
            res.raise_for_status()

            # Explicitly closed (the `with` block exits) before pdfplumber
            # opens it, and before the `finally` block below deletes it —
            # an still-open handle on Windows makes both operations fail.
            with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
                tmp.write(res.content)
                temp_path = tmp.name
            target_pdf = temp_path
        else:
            target_pdf = os.path.abspath(pdf_source)
            if not os.path.exists(target_pdf):
                raise FileNotFoundError(f"Local PDF file not found: {target_pdf}")

        officers = JudicialOfficer.query.filter_by(district_key=district_key).all()
        if not officers:
            print(f"No officers found for district {district_key}. Scrape HTML roster first.")
            return False

        updated_count = 0

        with pdfplumber.open(target_pdf) as pdf:
            for row, page_hyperlinks, columns in _iter_pdf_rows(pdf):
                if len(row) < 2:
                    continue

                if columns.get("meeting") is not None and columns["meeting"] < len(row):
                    parsed_meeting_id = extract_meeting_id(_clean_cell(row[columns["meeting"]]))
                else:
                    # No header found for this row's table — fall back to a
                    # whole-row scan (may be less precise; see docstring).
                    row_str = " ".join(_clean_cell(c) for c in row)
                    parsed_meeting_id = extract_meeting_id(row_str)

                if columns.get("link") is not None and columns["link"] < len(row):
                    parsed_link = extract_webex_link(_clean_cell(row[columns["link"]]), page_hyperlinks)
                else:
                    row_str = " ".join(_clean_cell(c) for c in row)
                    parsed_link = extract_webex_link(row_str, page_hyperlinks)

                if not parsed_link and not parsed_meeting_id:
                    continue

                matched_officer = _match_officer(row, officers)
                if not matched_officer:
                    continue

                changed = False
                if parsed_link and matched_officer.vc_link != parsed_link:
                    matched_officer.vc_link = parsed_link
                    changed = True
                if parsed_meeting_id and matched_officer.vc_meeting_id != parsed_meeting_id:
                    matched_officer.vc_meeting_id = parsed_meeting_id
                    changed = True
                if changed:
                    updated_count += 1

        db.session.commit()
        print(f"Successfully matched and updated VC links for {updated_count} officers.")
        return True

    except Exception as e:
        print(f"PDF Parsing Error: {e}")
        db.session.rollback()
        return False
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass
