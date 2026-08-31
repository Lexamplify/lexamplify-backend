"""
services/court_scraper.py
Live judicial-roster scraper — upserts JudicialOfficer rows from each
district's official court site. No fabricated data: a cell that fails to
parse is left as None (and, on an existing record, left UNCHANGED — see
_upsert_judge) rather than guessed at or blanked out.

── Rohini North / North-West Districts (delhi_rohini / delhi_rohini_nw) ──
The directive's originally-given URL (delhidistrictcourts.nic.in/lockdown-
filing) is NOT a judges directory — live inspection showed it's a leftover
COVID-era "admit card" print page, unrelated to any roster. The correct
sources, per each site's own "List of Judges" nav item, are TWO SEPARATE
eCourts-platform portals — not one page with two sections, as later
re-verified when North District support was added:
    delhi_rohini_nw → https://rohini.dcourts.gov.in/list-of-judges/
    delhi_rohini    → https://northdelhi.dcourts.gov.in/list-of-judges/
Confirmed live on both: `table.data-table-1` blocks (one per designation
category — "District and Sessions Judge", "District Judge Commercial
Court", etc.), each with a uniform 5-column row:
    td[0] profile photo (unused) · td[1] name (as an <a> link) ·
    td[2] designation · td[3] room number · td[4] location
rohini.dcourts.gov.in: 42 rows, 100% "North West District". northdelhi.
dcourts.gov.in: same structure, 100% "North District". Each portal serves
only its own district — _parse_roster's location check (td[4] against
_EXPECTED_LOCATION) is a defensive backstop for if that ever stops being
true, not the primary isolation mechanism (the URL choice is). No
rowspans/colspans were found across any table on either site (verified
programmatically), so the fixed 5-cell-per-row assumption below is safe as
things stand today — re-verify if either site's markup changes.

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
from datetime import date, datetime, timedelta, timezone

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

# Each district has its OWN circular PDF — confirmed live by fetching each
# district's document-category/vc-links/ page directly, rather than assuming
# one PDF covers both. They live on different S3 buckets entirely, not just
# different paths. Exported (not module-private) so app.py's CLI command and
# the /api/admin/sync-court-data route both read the one verified copy
# instead of each hardcoding their own — a later task handed both a
# DIFFERENT, 404ing URL for each district, which duplicated literals would
# have silently reintroduced.
DISTRICT_PDF_URLS = {
    "delhi_rohini_nw": "https://cdnbbsr.s3waas.gov.in/s3ec0277ee3bc58ce560b86c2b59363281/uploads/2026/08/2026082227.pdf",
    "delhi_rohini": "https://cdnbbsr.s3waas.gov.in/s3ec0232b3ee0272954b956a7d1f86f76a/uploads/2026/08/2026080849.pdf",
}

_DISTRICT_URLS = {
    # Confirmed live: these are two ENTIRELY SEPARATE eCourts portals, not
    # one page with two sections. rohini.dcourts.gov.in/list-of-judges/ was
    # re-checked for this task and still returns 42 rows, 100% labeled
    # "North West District" — zero "North District" rows exist there.
    # North District has its own portal, northdelhi.dcourts.gov.in, with the
    # identical page/table structure but exclusively "North District" rows.
    # So per-district isolation is achieved by URL selection, not by
    # filtering sections within a shared page — _EXPECTED_LOCATION below is
    # still enforced per row as a defensive check in case that ever changes.
    "delhi_rohini_nw": "https://rohini.dcourts.gov.in/list-of-judges/",
    "delhi_rohini": "https://northdelhi.dcourts.gov.in/list-of-judges/",
}

_EXPECTED_LOCATION = {
    "delhi_rohini_nw": "north west district",
    "delhi_rohini": "north district",
}


def _parse_roster(html: str, district_key: str) -> list[dict]:
    expected_location = _EXPECTED_LOCATION.get(district_key)
    soup = BeautifulSoup(html, "html.parser")
    judges = []
    skipped_wrong_district = 0
    for table in soup.select("table.data-table-1"):
        for tr in table.select("tbody tr"):
            tds = tr.find_all("td")
            if len(tds) < 4:
                continue  # not a judge row we recognize — skip, don't guess
            # Defensive district isolation: the 5th column ("Location") names
            # the district this row belongs to. Both portals currently only
            # ever contain their own district's rows, but if that ever
            # changes (or a district_key is pointed at the wrong URL), this
            # stops a cross-district row from being silently upserted rather
            # than trusting table position alone.
            if expected_location and len(tds) >= 5:
                location = tds[4].get_text(strip=True).lower()
                if location and location != expected_location:
                    skipped_wrong_district += 1
                    continue
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
    if skipped_wrong_district:
        print(f"Skipped {skipped_wrong_district} row(s) labeled for a different district than {district_key!r}.")
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

        judges = _parse_roster(response.text, district_key)
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
_EMAIL_RE = re.compile(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+")


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


def extract_email(text):
    """A row's email lives in its own column ('Email ID of Courts') and
    nothing else in the row could accidentally match an '@'-containing
    pattern, so — unlike the meeting-ID/phone collision above — a whole-row
    scan is unambiguous here; no column targeting needed."""
    if not text:
        return None
    text_clean = " ".join(str(text).split())
    match = _EMAIL_RE.search(text_clean)
    return match.group(0).rstrip(".,;:") if match else None


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


def _name_matches_officer(text: str, off: JudicialOfficer) -> bool:
    """WHOLE-WORD containment either direction (a source string often
    combines "Name, Designation" and hmj is name-only). Plain substring
    containment was tried first and, against the real PDF, matched "Ms.
    Gita" (normalizes to just "gita") to an unrelated row for "Sh. Yashu
    Khurana ... Digital Traffic Court" — "gita" is a raw substring of
    "digital". Comparing word SETS instead of raw strings fixes that:
    "gita" is a whole word in her own row but not in "digital traffic
    court". Shared by the PDF row matcher and the leave-list matcher below."""
    text_words = set(normalize_name(text).split())
    off_words = set(normalize_name(off.hmj).split())
    return bool(off_words) and bool(text_words) and (off_words <= text_words or text_words <= off_words)


def _match_officer(row, officers) -> "JudicialOfficer | None":
    # Priority 1: normalized name.
    for cell in row:
        for off in officers:
            if _name_matches_officer(cell, off):
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

                # Whole-row text is the fallback for meeting/link when no
                # header column was found, and the only source for email
                # (unambiguous — see extract_email's docstring).
                row_str = " ".join(_clean_cell(c) for c in row)

                if columns.get("meeting") is not None and columns["meeting"] < len(row):
                    parsed_meeting_id = extract_meeting_id(_clean_cell(row[columns["meeting"]]))
                else:
                    parsed_meeting_id = extract_meeting_id(row_str)

                if columns.get("link") is not None and columns["link"] < len(row):
                    parsed_link = extract_webex_link(_clean_cell(row[columns["link"]]), page_hyperlinks)
                else:
                    parsed_link = extract_webex_link(row_str, page_hyperlinks)

                parsed_email = extract_email(row_str)

                if not parsed_link and not parsed_meeting_id and not parsed_email:
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
                if parsed_email and matched_officer.email_id != parsed_email:
                    matched_officer.email_id = parsed_email
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


# ── Daily leave-status sync ────────────────────────────────────────────────
# Confirmed live on both portals — a genuine HTML table (not a PDF circular,
# the other branch the spec asked me to check for): judges-on-leave/ renders
# ONE table.data-table-1 with columns [Serial No., Name, On leave from, On
# leave till, Nature of Leave], dates as DD/MM/YYYY. The page appears to
# already list only current/near-future entries (there's a separate
# "Archive" link for past ones), but that's not relied on — every row's own
# from/till dates are still checked against IST-today before marking anyone
# on leave, per the spec's explicit date-validity requirement.

_LEAVE_PORTALS = {
    "delhi_rohini_nw": "https://rohini.dcourts.gov.in/judges-on-leave/",
    "delhi_rohini": "https://northdelhi.dcourts.gov.in/judges-on-leave/",
}

_LEAVE_DATE_FORMAT = "%d/%m/%Y"


def get_ist_today() -> date:
    return (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).date()


def _parse_leave_table(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    table = soup.select_one("table.data-table-1")
    if not table:
        return []

    entries = []
    for tr in table.select("tbody tr"):
        tds = tr.find_all("td")
        if len(tds) < 4:
            continue
        name = tds[1].get_text(strip=True)
        if not name:
            continue
        try:
            from_date = datetime.strptime(tds[2].get_text(strip=True), _LEAVE_DATE_FORMAT).date()
            till_date = datetime.strptime(tds[3].get_text(strip=True), _LEAVE_DATE_FORMAT).date()
        except ValueError:
            # An unparseable date is a reason to skip this row, not to guess
            # a date and risk wrongly marking (or missing) a leave.
            continue
        entries.append({"hmj": name, "from": from_date, "till": till_date})
    return entries


def sync_judges_on_leave(district_key: str = "delhi_rohini_nw") -> bool:
    target_url = _LEAVE_PORTALS.get(district_key)
    if not target_url:
        print(f"No leave portal configured for {district_key}.")
        return False

    try:
        response = requests.get(target_url, headers=_HEADERS, timeout=15, verify=False)
        response.raise_for_status()
        entries = _parse_leave_table(response.text)

        today = get_ist_today()
        on_leave_names = {e["hmj"] for e in entries if e["from"] <= today <= e["till"]}

        # Everything above can raise (network, parsing) without touching the
        # DB at all. Only once it has ALL succeeded do we touch ORM state —
        # and even then nothing is written to the database until commit()
        # below, so a failure between here and commit() rolls back to the
        # prior is_on_leave values via the except block, never a half-reset.
        officers = JudicialOfficer.query.filter_by(district_key=district_key).all()
        for off in officers:
            off.is_on_leave = False

        matched_count = 0
        for name in on_leave_names:
            for off in officers:
                if _name_matches_officer(name, off):
                    off.is_on_leave = True
                    matched_count += 1
                    break

        db.session.commit()
        print(f"{matched_count} officer(s) on leave today ({today.isoformat()}) for {district_key}.")
        return True

    except Exception as e:
        print(f"Leave sync error for {district_key}: {e}")
        db.session.rollback()
        return False
