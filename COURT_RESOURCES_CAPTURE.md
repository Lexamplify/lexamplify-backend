# Court Resources — Daily Capture

How LexAmplify keeps its public court-resources data fresh. The data is served
by `routes/court_routes.py`; this doc covers the **capture** side (what refreshes,
how it runs daily, and how to extend it).

## What is captured vs. static

| Domain | Source | Freshness | Where |
|---|---|---|---|
| Legal events / news | LiveLaw + Bar & Bench RSS | **Daily capture** → `event_cache`, served by `/api/legal-events` | `_capture_legal_events()` |
| Court forms (PDFs) | HC / eCourts / SCI forms pages scraped | **Daily capture** → `misc_forms` | `cron_form_indexer.py` via `_capture_forms()` |
| District judges + SC roster | dcourts roster PDFs / seeded JSON | **Daily** (local seed by default; live opt-in) | `services/court_scraper.py` via `_capture_judges()` |
| Sitting judges (SC + Delhi HC) | live scrape, 30-min cache | On demand | `/api/courts/judges` |
| SC forms (PDF binaries) | sci.gov.in, 5-min cache | On demand | `/api/forms/fetch-dynamic` |
| Court rosters (sitting / bail / duty / vacation) | Court roster pages scraped for PDF links + dates | **Daily capture** → `court_rosters`, served by `/api/court-rosters` | `_capture_rosters()` |
| Bar associations directory | Verified apex seed + `instance/bar_associations.json` | **Daily upsert** → `bar_associations`, served by `/api/court-bar-associations` | `_capture_bar_associations()` |
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

## Daily refresh

Nothing in-process runs these on a schedule (Render sleeps when idle, and live
scrapes from Render's IPs can hang past the worker timeout). So an **external
cron triggers a background capture on the backend**:

- Endpoint: `GET|POST /api/admin/daily-refresh?token=<ADMIN_SYNC_TOKEN>[&source=live]`
  - Returns `202 {"status":"started"}` immediately; the capture runs in a
    daemon thread (never trips Gunicorn's ~30s worker timeout).
  - `source=local` (default): captures forms + legal events live, re-seeds judges
    from bundled JSON. Fast and reliable.
  - `source=live`: also scrapes district rosters (6s timeouts, local fallback).
- Status: `GET /api/admin/refresh-status?token=<ADMIN_SYNC_TOKEN>` → last 20
  `capture_runs` rows (per-task `status` = ok / warn / error, item counts, time).
- Scheduler: `.github/workflows/daily-court-refresh.yml` runs daily at 01:00 UTC
  (~06:30 IST), hits the endpoint, waits, reads status, and fails the job (red X
  + email) if any task errored. Also runnable on demand via *workflow_dispatch*.

### One-time setup
1. Set backend env `ADMIN_SYNC_TOKEN` to a long random string (already used by
   `/api/admin/sync-court-data`).
2. Add GitHub repo secrets (Settings → Secrets and variables → Actions):
   - `LEXAMPLIFY_API_BASE` = `https://api.lexamplify.com` (no trailing slash)
   - `ADMIN_SYNC_TOKEN` = same value as the backend env.
3. Deploy the backend (the new routes ship in `routes/court_routes.py`).

### Manual run
```
curl "https://api.lexamplify.com/api/admin/daily-refresh?token=$ADMIN_SYNC_TOKEN"
curl "https://api.lexamplify.com/api/admin/refresh-status?token=$ADMIN_SYNC_TOKEN"
```

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
  register it in the `_run_daily_capture()` task tuple, and add a `/api/court-*`
  read endpoint plus a card in `CourtResources.jsx`.

## Frontend
New read endpoints to surface in `CourtResources.jsx`:
`/api/court-rosters` and `/api/court-bar-associations` (both support filters,
return loading/empty states — wire with the standard `credentials:'include'`
pattern from HANDOFF.md).
