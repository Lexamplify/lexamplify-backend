# Court Resources — Data Freshness

How LexAmplify keeps its public court-resources data fresh. The data is served
by `routes/court_routes.py`; everything refreshes **on demand** — no cron, no
token, nothing to configure. This doc covers what refreshes, when, and how to
extend it.

## What is captured vs. static

| Domain | Source | Freshness | Where |
|---|---|---|---|
| Legal events / news | LiveLaw + Bar & Bench RSS | **Live per request** (30-min cache) + durable `event_cache` fallback | `/api/legal-events` |
| Court forms (PDFs) | HC / eCourts / SCI forms pages scraped | Run `cron_form_indexer.py` (shell) → `misc_forms` | `cron_form_indexer.py` |
| District judges + SC roster | dcourts roster PDFs / seeded JSON | **Daily** (local seed by default; live opt-in) | `services/court_scraper.py` via `_capture_judges()` |
| Sitting judges (SC + Delhi HC) | live scrape, 30-min cache | On demand | `/api/courts/judges` |
| SC forms (PDF binaries) | sci.gov.in, 5-min cache | On demand | `/api/forms/fetch-dynamic` |
| Court rosters (sitting / bail / duty / vacation) | Court roster pages scraped for PDF links + dates | **On demand** (12h cache) → `court_rosters` | `/api/court-rosters` |
| Bar associations directory | Verified apex seed + `instance/bar_associations.json` | **On demand** (seed on first view) → `bar_associations` | `/api/court-bar-associations` |
| High courts, districts, bare acts, cause-list URLs, forms index | curated link tables | Static (edit in code) | `_HC`, `_DISTRICTS`, `_BARE_ACTS`, `_CAUSE_LIST_URLS`, `_FORMS`, `_HIGH_COURTS` |

### Court rosters
`_ROSTER_TARGETS` lists court roster pages (Delhi HC confirmed; add more HCs
there). Each is scraped for roster **PDF links**, tagged with a category
(`sitting` / `bail` / `duty` / `vacation`) and the effective date parsed from the
filename. We link the official PDF rather than parse bench assignments (that
layout is per-court and fragile). `/api/court-rosters?court=delhi&category=bail`.

### Bar associations
No clean machine-readable source exists, and we never ship guessed URLs into a
legal product. So the directory is **curated**: a verified apex seed (Bar Council
of India, SCAORA) plus an admin-maintained `instance/bar_associations.json` —
a list of `{name, kind, state, url, phone?, email?}`, the same seed-from-JSON
pattern the judges directory uses. Drop a verified directory into that file and
the daily capture upserts it. `/api/court-bar-associations?state=Delhi&kind=Apex`.

### Why cause lists and case status are **links, not scraped data**
Every court cause-list / case-status portal (Delhi HC `online-causelist`, the
dcourts eCourts portals, etc.) is behind a **per-request CAPTCHA** and a
court+date form. They cannot be captured unattended and must not be faked, so we
serve the official URL and the user completes the lookup on the court site. This
matches how the reference apps in this space work.

## Refresh model — on demand, no token or cron

The serving endpoints refresh themselves. There is **no external scheduler, no
token, and nothing to configure** — this is deliberate (the host sleeps when
idle, so an in-process timer wouldn't fire anyway). When a signed-in user opens
a tab:

- **Rosters** (`/api/court-rosters`): if `court_rosters` is empty or its newest
  row is older than `_ROSTER_TTL_HOURS` (12h), the request scrapes the official
  roster pages, upserts, then serves. One fast GET per court (well under the
  worker timeout) and fail-safe — a scrape failure still serves the cached rows.
- **Bar associations** (`/api/court-bar-associations`): seeds the verified apex
  bodies + `instance/bar_associations.json` on first access (empty table).
- **Legal events** (`/api/legal-events`): live LiveLaw + Bar & Bench fetch with a
  30-min in-memory cache; persists each result to `event_cache` and falls back to
  that snapshot only if both feeds are down.
- **Forms** (`misc_forms`): run `cron_form_indexer.py` from a shell / OS scheduler
  when you want fresh form links; the static `_FORMS` table always backs the UI.

The first visitor after the TTL lapses pays a ~1–2s refresh; everyone after gets
the cached rows.

> The token-gated `/api/admin/daily-refresh` and `/api/admin/refresh-status`
> routes still exist for an optional explicit refresh, but they require
> `ADMIN_SYNC_TOKEN` and sit behind the normal sign-in gate. With no token set
> (the default) they are inert — the on-demand path above is what keeps the data
> fresh, so no secrets or GitHub Action are needed.

## Design notes / safeguards
- **Fail-safe:** `cron_form_indexer.run()` aborts without touching the DB if it
  collects too few links (a site redesign or IP block never wipes `misc_forms`).
- **Durable events:** the legal-events snapshot persists to `event_cache`, so
  `/api/legal-events` serves instantly after a cold start and falls back to the
  last snapshot if both RSS feeds are down — never an empty screen, never faked.
- **No fabricated data:** every captured item has a real source URL.
- All writes target the same `instance/client_data.db` (symlinked onto Render's
  Persistent Disk).

## Extending
- **More roster courts:** add `{court, url, base, match}` entries to
  `_ROSTER_TARGETS` (Bombay / Madras / Allahabad etc. publish roster PDFs the
  same way). The `match` substring filters that page's PDFs to the roster ones.
- **Fill the bar directory:** add verified entries to
  `instance/bar_associations.json`. Only include URLs you have confirmed resolve.
- **A new domain:** add a `_capture_<x>()` returning `(status, count, detail)`,
  call it on demand from a `/api/court-*` read endpoint (the empty/stale-cache
  pattern in `get_court_rosters`), and add a card in `CourtResources.jsx`.

## Frontend
New read endpoints to surface in `CourtResources.jsx`:
`/api/court-rosters` and `/api/court-bar-associations` (both support filters,
return loading/empty states — wire with the standard `credentials:'include'`
pattern from HANDOFF.md).
