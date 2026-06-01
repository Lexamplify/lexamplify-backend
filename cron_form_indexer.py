#!/usr/bin/env python3
"""
cron_form_indexer.py — LexAI India
Nightly cron job: scrapes Indian court / government portals for PDF form
links and upserts them into the misc_forms table in SQLite.

Scheduled example (Linux/macOS crontab):
    0 2 * * * /path/to/venv/python /path/to/cron_form_indexer.py

Windows Task Scheduler:
    Program: C:\\lexai\\venv\\Scripts\\python.exe
    Arguments: C:\\lexai\\cron_form_indexer.py8

Exit codes:
    0 — success
    1 — FAIL-SAFE triggered (too few links; DB unchanged)
    2 — database error
"""

from __future__ import annotations

import logging
import os
import re
import sqlite3
import sys
import time
from datetime import datetime, timezone
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

# ── Runtime paths ─────────────────────────────────────────────────────────────
_ROOT   = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(_ROOT, 'instance', 'client_data.db')
LOG_DIR = os.path.join(_ROOT, 'logs')

# ── Tunables ──────────────────────────────────────────────────────────────────
FAIL_SAFE_MIN     = 10    # abort WITHOUT touching DB if total links < this
REQUEST_TIMEOUT   = 25    # seconds per HTTP request
INTER_TARGET_WAIT = 2.0   # polite crawl delay between target sites
MAX_REDIRECTS     = 5

# ── Scrape targets ────────────────────────────────────────────────────────────
SCRAPE_TARGETS: list[dict] = [
    {
        'label':     'Delhi High Court — Forms',
        'forms_url': 'https://delhihighcourt.nic.in/forms',
        'base_url':  'https://delhihighcourt.nic.in',
        'court':     'Delhi HC',
    },
    {
        'label':     'eCourts — Common Forms',
        'forms_url': 'https://ecourts.gov.in/ecourts_home/static/common-forms.php',
        'base_url':  'https://ecourts.gov.in',
        'court':     'eCourts',
    },
    {
        'label':     'Bombay High Court — Forms',
        'forms_url': 'https://bombayhighcourt.nic.in/libWeb/forms.php',
        'base_url':  'https://bombayhighcourt.nic.in',
        'court':     'Bombay HC',
    },
    {
        'label':     'Supreme Court of India — Forms',
        'forms_url': 'https://www.sci.gov.in/forms/',
        'base_url':  'https://www.sci.gov.in',
        'court':     'Supreme Court',
    },
    {
        'label':     'Allahabad High Court — Forms',
        'forms_url': 'https://www.allahabadhighcourt.in/forms/index.html',
        'base_url':  'https://www.allahabadhighcourt.in',
        'court':     'Allahabad HC',
    },
    {
        'label':     'Madras High Court — Forms',
        'forms_url': 'https://hcmadras.tn.gov.in/forms.html',
        'base_url':  'https://hcmadras.tn.gov.in',
        'court':     'Madras HC',
    },
]

# ── Keyword → category mapping (first regex match wins) ──────────────────────
# Order matters: more specific patterns must come before generic ones.
CATEGORY_RULES: list[tuple[str, str]] = [
    (r'vakalatnama|vakalathnama',          'Vakalatnama'),
    (r'bail',                              'Bail Forms'),
    (r'surety',                            'Surety Bond'),
    (r'affidavit',                         'Affidavit'),
    (r'address',                           'Address Change'),
    (r'caveat',                            'Caveat Forms'),
    (r'memo.?appeal|appeal.?memo',         'Memo of Appeal'),
    (r'objection',                         'Objection Forms'),
    (r'checklist|check.list',              'Checklist'),
    (r'synopsis',                          'Synopsis'),
    (r'undertaking',                       'Undertaking'),
    (r'writ',                              'Writ Forms'),
    (r'plaint',                            'Plaint Forms'),
    (r'written.?statement',                'Written Statement'),
    (r'interlocutory',                     'Interlocutory Application'),
    (r'execution',                         'Execution Forms'),
    (r'mediation',                         'Mediation Forms'),
    (r'lok.?adalat',                       'Lok Adalat Forms'),
    (r'appeal',                            'Appeal Forms'),
    (r'petition',                          'Petition Forms'),
    (r'bond',                              'Bond Forms'),
    (r'index',                             'Index Forms'),
    (r'summons',                           'Summons'),
    (r'power.?attorney|poa',               'Power of Attorney'),
]

HTTP_HEADERS: dict[str, str] = {
    'User-Agent': (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
        'AppleWebKit/537.36 (KHTML, like Gecko) '
        'Chrome/124.0.0.0 Safari/537.36'
    ),
    'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-IN,en-US;q=0.9,en;q=0.8',
    'DNT':             '1',
    'Cache-Control':   'no-cache',
}

# ── SQLite schema ─────────────────────────────────────────────────────────────
_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS misc_forms (
    id          INTEGER  PRIMARY KEY AUTOINCREMENT,
    name        TEXT     NOT NULL,
    url         TEXT     NOT NULL UNIQUE,
    category    TEXT     NOT NULL DEFAULT 'General Forms',
    court       TEXT,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_misc_forms_category ON misc_forms (category);
CREATE INDEX IF NOT EXISTS idx_misc_forms_court    ON misc_forms (court);
"""

# ── Logging setup ─────────────────────────────────────────────────────────────
os.makedirs(LOG_DIR, exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)-8s] %(message)s',
    datefmt='%Y-%m-%dT%H:%M:%S',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(
            os.path.join(LOG_DIR, 'form_indexer.log'),
            encoding='utf-8',
        ),
    ],
)
log = logging.getLogger('form_indexer')


# ── Helpers ───────────────────────────────────────────────────────────────────

def _classify(raw_href: str, link_text: str) -> str:
    """Return the first matching category, or 'General Forms'."""
    combined = (raw_href + ' ' + link_text).lower()
    for pattern, category in CATEGORY_RULES:
        if re.search(pattern, combined, re.IGNORECASE):
            return category
    return 'General Forms'


def _name_from_href(raw_href: str) -> str:
    """Derive a human-readable name from a bare PDF filename."""
    path     = urlparse(raw_href).path
    filename = path.rstrip('/').rsplit('/', 1)[-1]
    cleaned  = (
        re.sub(r'\.pdf$', '', filename, flags=re.IGNORECASE)
          .replace('_', ' ')
          .replace('-', ' ')
          .title()
          .strip()
    )
    return cleaned or filename


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(_SCHEMA_SQL)
    conn.commit()


def get_connection() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA foreign_keys=ON')
    return conn


def upsert_forms(conn: sqlite3.Connection, forms: list[dict]) -> int:
    """
    Insert new forms and update changed ones atomically.
    Uses SQLite's UPSERT syntax (requires SQLite >= 3.24, shipped with
    Python 3.6+ on all platforms).
    Returns the total count processed.
    """
    now = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
    cur = conn.cursor()
    for form in forms:
        cur.execute(
            """
            INSERT INTO misc_forms (name, url, category, court, updated_at)
            VALUES (:name, :url, :category, :court, :now)
            ON CONFLICT(url) DO UPDATE SET
                name       = excluded.name,
                category   = excluded.category,
                court      = excluded.court,
                updated_at = excluded.updated_at
            """,
            {**form, 'now': now},
        )
    conn.commit()
    return len(forms)


# ── Scraping core ─────────────────────────────────────────────────────────────

def scrape_target(target: dict, session: requests.Session) -> list[dict]:
    """
    Fetch one target page and return a deduplicated list of form dicts.

    VULNERABILITY 1 PATCH — Brittle CSS Selectors:
    ──────────────────────────────────────────────
    We iterate EVERY <a> tag in the page and apply a regex directly to its
    raw `href` attribute value.  We never call soup.find_all('a', class_='...')
    because Indian government sites routinely rename CSS classes during
    redesigns while keeping the underlying PDF file paths unchanged.

    VULNERABILITY 2 PATCH — The Relative URL Trap:
    ───────────────────────────────────────────────
    Every href (absolute, root-relative, or relative) is passed through
    urllib.parse.urljoin(base_url, raw_href), which correctly handles:
        '/forms/bail.pdf'    → 'https://court.nic.in/forms/bail.pdf'
        '../dl/form.pdf'     → 'https://court.nic.in/dl/form.pdf'
        'https://other.gov/' → 'https://other.gov/'  (absolute: unchanged)
    Without this step, relative links silently become broken URLs in the DB.
    """
    forms_url = target['forms_url']
    base_url  = target['base_url']
    court     = target['court']

    log.info('Fetching: %s', forms_url)
    try:
        resp = session.get(
            forms_url,
            timeout=REQUEST_TIMEOUT,
            allow_redirects=True,
        )
        resp.raise_for_status()
    except requests.HTTPError as exc:
        raise RuntimeError(
            f'HTTP {exc.response.status_code} received from {forms_url}'
        ) from exc

    soup      = BeautifulSoup(resp.content, 'html.parser')
    found:    list[dict] = []
    seen_urls: set[str]  = set()

    for a_tag in soup.find_all('a', href=True):
        raw_href: str = a_tag['href'].strip()

        # ── Regex on the raw href attribute — no CSS class dependency ─────────
        # Matches: file.pdf  /path/to/file.pdf  file.pdf?v=1  (case-insensitive)
        if not re.search(r'\.pdf(\?[^#"]*)?$', raw_href, re.IGNORECASE):
            continue

        # ── Convert every href to an absolute URL via urljoin ─────────────────
        absolute_url = urljoin(base_url, raw_href)

        # Skip non-HTTP targets (mailto:, javascript:, etc.)
        if not absolute_url.startswith('http'):
            continue

        # Deduplicate within this target's page
        if absolute_url in seen_urls:
            continue
        seen_urls.add(absolute_url)

        link_text = a_tag.get_text(' ', strip=True)
        name      = link_text if len(link_text) >= 4 else _name_from_href(raw_href)

        found.append({
            'name':     name[:255],
            'url':      absolute_url,
            'category': _classify(raw_href, name),
            'court':    court,
        })

    log.info('  → %d valid PDF links on %s', len(found), forms_url)
    return found


# ── Entry point ───────────────────────────────────────────────────────────────

def run() -> int:
    log.info('=== LexAI Form Indexer — run started %s ===',
             datetime.utcnow().isoformat())

    session = requests.Session()
    session.headers.update(HTTP_HEADERS)
    session.max_redirects = MAX_REDIRECTS

    all_forms: list[dict] = []
    target_errors = 0

    for idx, target in enumerate(SCRAPE_TARGETS):
        try:
            forms = scrape_target(target, session)
            all_forms.extend(forms)
        except requests.ConnectionError as exc:
            log.error('Connection error — %s: %s', target['label'], exc)
            target_errors += 1
        except requests.Timeout:
            log.error('Timeout after %ds — %s', REQUEST_TIMEOUT, target['label'])
            target_errors += 1
        except RuntimeError as exc:
            log.error('%s: %s', target['label'], exc)
            target_errors += 1
        except Exception:
            log.exception('Unexpected error scraping %s', target['label'])
            target_errors += 1
        finally:
            if idx < len(SCRAPE_TARGETS) - 1:
                time.sleep(INTER_TARGET_WAIT)

    # ── VULNERABILITY 3 PATCH — Silent Wipeout / Fail-Safe Guard ─────────────
    #
    # If the scraper collected fewer than FAIL_SAFE_MIN valid PDF links in total,
    # something is fundamentally wrong:
    #   • All target sites may have changed structure since the last run
    #   • The server's IP may be blocked by the government WAF
    #   • Sites may now render PDF lists via JavaScript (not parseable by BS4)
    #   • All network requests failed with errors
    #
    # In any of these cases, writing the partial result would SILENTLY WIPE OUT
    # all existing forms that were not re-scraped, degrading the user-facing UI.
    # We abort completely and log a CRITICAL message so the operator is alerted.
    # The database is left completely untouched.
    if len(all_forms) < FAIL_SAFE_MIN:
        log.critical(
            'FAIL-SAFE TRIGGERED: Only %d valid PDF links were collected '
            '(minimum threshold = %d). '
            'Database has NOT been modified. '
            'Diagnosis: %d/%d scrape targets failed. '
            'Check if government sites have changed structure, '
            'or if the server IP is being blocked.',
            len(all_forms),
            FAIL_SAFE_MIN,
            target_errors,
            len(SCRAPE_TARGETS),
        )
        return 1   # operator must investigate before next run

    # Cross-target deduplication: the same PDF is sometimes linked from multiple
    # court portals. Keep the first occurrence (preserves the more specific court label).
    seen_global: set[str]  = set()
    unique_forms: list[dict] = []
    for form in all_forms:
        if form['url'] not in seen_global:
            seen_global.add(form['url'])
            unique_forms.append(form)

    log.info(
        'Deduplication complete: %d unique forms (from %d raw links across %d targets)',
        len(unique_forms), len(all_forms), len(SCRAPE_TARGETS),
    )

    try:
        conn = get_connection()
        ensure_schema(conn)
        count = upsert_forms(conn, unique_forms)
        conn.close()
        log.info('Database update complete — %d rows processed.', count)
    except sqlite3.OperationalError as exc:
        log.critical('SQLite operational error: %s', exc)
        return 2
    except sqlite3.Error as exc:
        log.critical('Database error: %s', exc)
        return 2

    log.info('=== Form Indexer run finished successfully ===')
    return 0


if __name__ == '__main__':
    sys.exit(run())
