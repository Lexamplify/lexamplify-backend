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

VC links/meeting IDs are NOT available in this table. The official site
publishes those as a single monthly "Video Conference Hearing Links" PDF
circular (document-category/vc-links/), not as structured per-judge HTML —
parsing that would mean downloading and table-extracting a PDF, a materially
different task not attempted here. vc_link/vc_meeting_id are therefore left
untouched by this scraper; a prior seed value (e.g. from the JSON fallback)
survives repeated re-scrapes rather than being wiped to None.
"""
import uuid

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
