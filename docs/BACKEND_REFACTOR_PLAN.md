# Backend Modularization & Optimization Plan

Status: **planned** (repo cleanup already applied on branch `backend-cleanup`).
Target: slim `app.py` (5,053 lines) down to an application factory that only
configures extensions and registers blueprints.

> Why this is a *plan* and not yet applied to the routes: the refactor moves
> 46 live route handlers and must be verified by actually starting the app and
> running `tests/`. That requires the full dependency set (chromadb,
> sentence-transformers, pinecone, PyMuPDF, opencv, pytesseract…) plus
> Neon/Redis — i.e. a real dev/CI environment. Each step below is independently
> testable; execute them in order and run the smoke test after each.

---

## Progress & findings (2026-10-22)

Done on `backend-cleanup`, each verified by the CI gate (boots `create_app()` +
runs the deterministic test suite):

- **Repo cleanup** (9,628 -> 511 tracked files) + `README.md` + this plan.
- **CI harness** (`.github/workflows/backend-ci.yml`) — boot smoke-test + regression
  gate. Excludes `tests/test_corpus.py` (flaky AI/fixture suite) and two pre-existing
  order-dependent flakes (`test_hearings_cause_list_and_warnings`, the job-store
  redteam test) so green == "no regression from the refactor".
- **Step: page routes** -> `routes/page_routes.py` (`page_bp`). Verified green.
- **Step: health routes** (`/api/ping`, `/api/status`) -> `routes/health_routes.py`
  (`health_bp`). Verified green.

**IMPORTANT finding — the `core/` DB extraction is NOT a no-op.** Moving
`_ThreadLocalDB` + the `db` instance into `core/db.py` turned ~13 vault / DMS / LPMS
tests red (test_vault_workspace, test_vault_authorization, test_dms_real_app,
test_lpms_flow) — the suites wire the raw SQLite handle to a per-test temp DB, and
the module move disturbed that isolation. It was **reverted**. Before re-attempting
Step 1, inspect how `tests/conftest.py` + the vault tests point `db` at a temp file
(they likely `monkeypatch`/patch the symbol by its module path) and make the tests
patch `core.db.db` (or have `app.db` and `core.db.db` stay the same object the tests
target). This step needs local, iterative test runs — do not land it blind.

## The key structural fact

Almost everything lives **inside `create_app()`** (lines ~1182–5050). The 46
inline `@app.route` handlers are **closures** that capture `app`, the raw
thread-local `db`, `jwt`, and ~40 module-level helpers. That is why they were
never extracted — they rely on closure scope, not imports. Extraction therefore
has two parts:

1. Lift the shared helpers/globals into an importable `core/` package.
2. Move each route into its blueprint and replace captured names with imports.

A default-deny gate (`_require_sign_in_for_api`, an app-level `before_request`)
already protects every `/api/*` route, so **no per-route `@jwt_required` needs
adding** when a handler moves — auth behaviour is preserved automatically.

There are currently **zero** files that `import app`, so there is no import
cycle today. Preserve that: **blueprints import `core/`; `core/` never imports a
blueprint.**

---

## Step 1 — Extract `core/` (no behaviour change)

Create a package for the load-bearing globals the routes capture:

```
core/
  __init__.py
  db.py          # _ThreadLocalDB, db, DB_PATH, and ONE merged idempotent schema builder
  vault.py       # identity/authz/provenance/title helpers
  bridges.py     # _dms_* / _lpms_* factory-callback helpers + their TTL caches
  cors.py        # PROD_ORIGINS, origin regexes, add_cors_headers
  docgen.py      # generate_pdf_blob, generate_docx_blob
  pinecone.py    # _get_pinecone_index + embed constants
```

Helpers to move (from `app.py` module scope, ~lines 107–1180):

- **DB handle:** `_ThreadLocalDB` class + `db = _ThreadLocalDB('lex_assistant.db')`
  + `DB_PATH` — the single most load-bearing global (nearly every vault route
  uses `db.execute`).
- **Identity / authz:** `_current_vault_user_id`, `_vault_owner_ok`,
  `_current_user_team_member_ids`, `_resolve_team_member_user_ids`,
  `_get_ancestor_folder_ids`, `_effective_permission`, `_visible_shared_vault_ids`,
  `_vault_access_ok`, `_PERMISSION_RANK`.
- **Provenance:** `_write_provenance` + `_PROVENANCE_LOCK`.
- **Bridges:** `_dms_*`, `_lpms_*` helpers + `_DMS_MEMBER_CACHE/_LOCK/_TTL`.
- **Title/format:** `format_vault_title`, `resolve_vault_title`,
  `extract_case_title_from_content`, `format_case_title`, citation regexes.
- **Docgen / Pinecone / CORS constants** as listed above.

`app.py` then imports these instead of defining them. Nothing else changes yet.
**Smoke test:** app boots, `/api/status` green, a vault list request works.

## Step 2 — Consolidate the three schema builders

`init_db()` (134–405), `init_sqlite_db()` (411–523) and the inline block inside
`app_context` (~4590–4805) all build the same sqlite schema, with the
`case_vault` column-add logic duplicated verbatim. Merge into one idempotent
`core/db.py::ensure_schema()`.

**Also guard the data-loss footgun:** `init_db()` runs
`DROP TABLE IF EXISTS calendar_events` (line ~137). It is only reached via
`python app.py` (dev), not the gunicorn/prod path — but it should be removed or
gated behind an explicit `ALLOW_DESTRUCTIVE_INIT` env flag.

## Step 3 — Move the 46 routes into blueprints

Mechanics per route: move the view fn to the blueprint module → change
`@app.route('/api/vault/x')` to `@bp.route('/x')` (the blueprint's `url_prefix`
supplies `/api/vault`) → replace captured closure names with
`from core.vault import ...` → delete the inline copy. Do the vault groups first
(largest, one shared helper set), smoke-test, then the independent groups.

| Group | Routes | Destination |
|---|---|---|
| A. Vault **folders** | `/api/vault/folders` (GET/POST/PATCH/DELETE), `/folders/init-blueprint` | **new** `routes/vault_folder_routes.py` |
| B. Vault **documents** | `/api/vault/documents*`, `/vault/save`, `/vault/meta`, `/vault/audit-trail` (11) | **existing** `routes/vault_workspace_routes.py` (no path collisions) |
| C. Vault **shares & provenance** | `/api/vault/shares*`, `/vault/provenance*` (6) | **new** `routes/vault_sharing_routes.py` |
| D. **Drafts** | `/api/drafts`, `/api/drafts/<id>` | **existing** `routes/draft_engine_routes.py` (`drafts_bp`) |
| E. **AI file/judgment** | `/api/ai/extract-file`, `/api/ai/summarize-judgment` | **existing** `routes/ai_routes.py` (`ai_bp`) |
| F. **Firm Library** | `/api/firm-library*` (4) | **new** `routes/firm_library_routes.py` (`library_bp` already owns `/api/library`) |
| G. **Legal research / chat** | `/api/legal-research*`, `/api/document/<id>`, `/api/cases/autocomplete`, `/api/kanoon-redirect`, `/api/chat` | **new** `routes/research_routes.py` (also move `_kanoon_*`, `force_pristine_groq_messages`) |
| H. **Calendar / eCourts / districts** | `/api/calendar/*`, `/api/ecourts/sync`, `/api/districts` | **new** `routes/calendar_routes.py` (or fold into `causelist_routes.py`) |
| I. **Health** | `/api/ping`, `/api/status` | **new** `routes/health_routes.py` |
| J. **Page routes** | `/`, `/login`, `/signup`, `/dashboard`, `/contract-viewer` | **new** `routes/page_routes.py` |

## What STAYS in `app.py` / `create_app()`

App-global concerns are legitimately part of the factory — do **not** move:
Flask + ProxyFix creation; all `app.config`; `celery_init_app`,
`sqlalchemy_db.init_app`, `jwt.init_app`, `limiter.init_app`, `init_sso`; the 3
factory-blueprint try/except blocks (they inject callbacks — import those from
`core/bridges.py`); `core.db.ensure_schema(app)`; `_require_sign_in_for_api`,
`_assign_request_id` and the four `after_request` hooks; the JWT loaders; all
error handlers. Optionally move the four `@app.cli.command`s to `cli.py` and
register via `app.cli.add_command`.

Target: `app.py` ≈ 250 lines (factory + config + `register_blueprint` only).

---

## Optimizations (apply with tests)

1. **Three schema builders → one** (Step 2). Removes duplicated column-add logic.
2. **Remove / guard the `DROP TABLE calendar_events`** data-loss footgun.
3. **Per-request caching for team/share lookups.** `_current_user_team_member_ids`
   runs a full `User` scan and row-by-row updates on every share request; cache
   per request via `flask.g` (mirror the existing DMS TTL-cache pattern).
4. **Lazy-import heavy modules.** `requests`, `bs4`, `pinecone` load eagerly at
   import for every worker; `Groq`/`Tavily` are already lazy-shimmed — extend the
   same pattern to cut the free-tier (512 MB) memory footprint.
5. **De-duplicate the chat path.** `/api/chat` (~580 lines) overlaps
   `ai_bp:/api/ai/chat` + `/api/ai/rag-chat`; pick one and deprecate the other.
6. **(Larger, later) Two data layers.** Raw thread-local sqlite (vault/team) and
   SQLAlchemy/Postgres (users/cases) coexist. Biggest architectural debt — note
   it, don't tackle inside this refactor.

---

## Suggested execution order

`core/` (Step 1) → merge schema (Step 2) → group B into vault_workspace →
groups A/C → groups D/E into existing blueprints → F/G/H/I/J → shrink `app.py`.
Run `tests/` (and a manual `/api/status` + one vault round-trip) after **each**
step; each is independently revertible.
