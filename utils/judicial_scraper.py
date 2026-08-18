"""
utils/judicial_scraper.py
Live judicial-directory scraper — Supreme Court + Delhi High Court sitting
judges. No hardcoded judge data: every name/designation/term returned here
is parsed live from the court's own official site at request time (subject
to the 24h cache below). If a source is unreachable, its judges are simply
omitted from the response (with an entry in `errors`) — never backfilled
with static/fabricated data.

── Supreme Court (sci.gov.in/chief-justice-judges/) ──────────────────────
Verified working live (repeated successful fetches, DOM structure confirmed
by direct inspection):
    .judge-profile                    (one per judge, 35 total observed)
      .judge-img .hovrable-content    → DoB / Term of Office / profile link
                                         (absent for the CJI specifically —
                                         handled as a missing term, not an
                                         error)
      .judge-details .judge-name      → name
      .judge-details .cji-india       → present only for the CJI

── Delhi High Court ───────────────────────────────────────────────────────
The directive's originally-given URL (delhihighcourt.nic.in/app/sitting-
judge-wise) is NOT a judges directory — live inspection showed it's an
order-search-by-judge-name utility (a DataTables AJAX grid searching case
ORDERS filtered by a judge you already name as input: columns are
order_date / case_no_order_link / corrigendum). Scraping it as directed
would silently return zero judges. The correct page, per the site's own
"Judges" nav menu, is delhihighcourt.nic.in/web/CJ_Sitting_Judges — used
here instead. Confirmed live: a Drupal view,
    .card-sec .desc-sec a   → judge display text, e.g. "Justice V. Kameswar
                               Rao", "JUSTICE NITIN WASUDEO SAMBRE" (casing
                               is inconsistent site-side — kept verbatim
                               rather than "corrected", since guessing at
                               proper-casing a name is its own way of
                               fabricating data), or "Chief Justice
                               Devendra Kumar Upadhyaya" for the one CJ card
                               (no "Justice" token — designation is derived
                               from this text, not assumed).
PAGINATED: 12 cards/page across (as observed) 4 pages — a naive single-page
scrape would have silently returned only ~25% of sitting judges. Walks
pages until one comes back with zero cards, rather than trusting a parsed
"last page" number that could drift.

delhihighcourt.nic.in was also observed, during development, to reset
connections outright under request volume (not a normal 4xx/5xx — a
connection-level failure) — both as a blanket block lasting several minutes
and as a mid-pagination single-page failure. Neither should discard
already-fetched real data: see _scrape_delhi_hc's partial-failure handling
below and get_all_judges' per-source isolation.
"""
import re

import requests
from bs4 import BeautifulSoup
from cachetools import cached, TTLCache

_HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
        'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    ),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Connection': 'keep-alive',
}

_SCI_URL = 'https://www.sci.gov.in/chief-justice-judges/'
_DHC_URL = 'https://delhihighcourt.nic.in/web/CJ_Sitting_Judges'
_DHC_MAX_PAGES = 12  # observed page count is 4; generous cap against drift, not a live limit

_TERM_RE = re.compile(r'\(DoA\)\s*([\d-]+)\s*to\s*\(DoR\)\s*([\d-]+)')


def _scrape_supreme_court() -> list[dict]:
    resp = requests.get(_SCI_URL, headers=_HEADERS, timeout=(10, 20))
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, 'html.parser')

    judges = []
    for profile in soup.select('.judge-profile'):
        name_el = profile.select_one('.judge-name')
        if not name_el:
            continue

        designation_el = profile.select_one('.cji-india')
        designation = designation_el.get_text(strip=True) if designation_el else 'Judge, Supreme Court of India'

        # Absent for the CJI's own card (its Term of Office lives in a
        # separate full-bio section elsewhere on the page, not here) — a
        # missing term for exactly one entry is expected, not a parse bug.
        term = None
        hover = profile.select_one('.hovrable-content')
        if hover:
            m = _TERM_RE.search(hover.get_text(' ', strip=True))
            if m:
                term = f'{m.group(1)} to {m.group(2)}'

        judges.append({
            'name': name_el.get_text(strip=True),
            'court': 'Supreme Court of India',
            'designation': designation,
            'term': term,
            'courtroom': None,  # not published on this page — never fabricated
        })
    return judges


def _scrape_delhi_hc_page(page: int) -> list[dict]:
    url = _DHC_URL if page == 0 else f'{_DHC_URL}?page={page}'
    resp = requests.get(url, headers=_HEADERS, timeout=(10, 20))
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, 'html.parser')

    judges = []
    for card in soup.select('.card-sec'):
        link = card.select_one('.desc-sec a')
        if not link:
            continue
        name = re.sub(r'\s+', ' ', link.get_text(strip=True)).strip()
        if not name:
            continue
        designation = 'Chief Justice' if name.lower().startswith('chief justice') else 'Judge, Delhi High Court'
        judges.append({
            'name': name,
            'court': 'Delhi High Court',
            'designation': designation,
            'term': None,       # not published on this listing page — never fabricated
            'courtroom': None,
        })
    return judges


def _scrape_delhi_hc() -> tuple[list[dict], str | None]:
    """
    Returns (judges, warning). `warning` is set only when pagination had to
    stop early on a real request failure (as opposed to the clean "zero
    cards" signal that means we've legitimately reached the last page) —
    the judges collected from whatever pages DID succeed are still real,
    live data and are returned as-is, not discarded.
    """
    judges: list[dict] = []
    for page in range(_DHC_MAX_PAGES):
        try:
            page_judges = _scrape_delhi_hc_page(page)
        except requests.RequestException as exc:
            if page == 0:
                raise  # nothing collected at all — let the caller record this as a full failure
            return judges, f'stopped at page {page + 1} after a request failure ({exc.__class__.__name__}) — list may be incomplete'
        if not page_judges:
            break
        judges.extend(page_judges)
    return judges, None


# Each source gets its OWN 24h cache, populated only on success —
# cachetools' @cached never caches a call that raised, so a source that's
# currently failing is simply retried on the next request instead of an
# empty/failed result getting locked in for a full day. A single cache
# wrapping both sources together would mean one source's outage blanks the
# other's real data for 24h too.
_sc_cache = TTLCache(maxsize=2, ttl=86400)
_dhc_cache = TTLCache(maxsize=2, ttl=86400)


@cached(cache=_sc_cache)
def _scrape_supreme_court_cached() -> list[dict]:
    return _scrape_supreme_court()


@cached(cache=_dhc_cache)
def _scrape_delhi_hc_cached() -> tuple[list[dict], str | None]:
    return _scrape_delhi_hc()


def get_all_judges() -> dict:
    """
    {'judges': [...], 'errors': [...]} — never raises. Sources are scraped
    independently (see per-source caches above) so one failing doesn't wipe
    out the other's real, live results; `errors` reports which source(s)
    failed (or partially failed) and why, for the API layer to surface
    transparently rather than silently under-reporting a partial list.
    """
    judges: list[dict] = []
    errors: list[str] = []

    try:
        judges.extend(_scrape_supreme_court_cached())
    except requests.Timeout:
        errors.append('Supreme Court of India: request timed out')
    except requests.ConnectionError:
        errors.append('Supreme Court of India: connection failed (site may be rate-limiting or geo-restricting this server)')
    except requests.HTTPError as exc:
        errors.append(f'Supreme Court of India: HTTP {exc.response.status_code}')
    except Exception as exc:
        errors.append(f'Supreme Court of India: {exc}')

    try:
        dhc_judges, dhc_warning = _scrape_delhi_hc_cached()
        judges.extend(dhc_judges)
        if dhc_warning:
            errors.append(f'Delhi High Court: {dhc_warning}')
    except requests.Timeout:
        errors.append('Delhi High Court: request timed out')
    except requests.ConnectionError:
        errors.append('Delhi High Court: connection failed (site may be rate-limiting or geo-restricting this server)')
    except requests.HTTPError as exc:
        errors.append(f'Delhi High Court: HTTP {exc.response.status_code}')
    except Exception as exc:
        errors.append(f'Delhi High Court: {exc}')

    return {'judges': judges, 'errors': errors}
