# Baseline (Phase 0)

Measured on 2026-10-18 on commit `db66ab8` ("fixing the product"), before any Part 2 change, on Windows 11 with the repo `venv` (Python 3.10). No `GROQ_API_KEY`, `DATABASE_URL` or `JWT_SECRET_KEY` was set; tests use throw-away SQLite databases and mocked AI.

## Backend: `pytest tests --ignore=tests/test_demo_pdfs.py`
**393 passed, 6 failed, 7 skipped, 52 warnings (8 min 52 s).**

| Failing test | What happens | Likely cause (not yet fixed) |
|---|---|---|
| `test_dms_files_scan::test_upload_validation` | A file `src….pdf` is left behind | Temp-file cleanup / worker timing |
| `test_dms_real_app::hub_limit…` | No 429 in the full run (passes alone) | Rate limiter state shared across tests |
| `test_dms_redteam_fixes::restart_requeues…` | `recover_stale` returns 0, expected 1 | Timing of the stale-job threshold |
| `test_dms_rules::encryption_at_rest…` | "hides content" assertion fails | Needs investigation |
| `test_lpms_real_app::practice_limit…` | No 429 in the full run (passes alone) | Rate limiter state shared across tests |
| `test_vault_workspace::a_pdf_opens_in_the_editor…` | `PermissionError [WinError 32]` | Windows temp file still open (test bug) |

`tests/test_demo_pdfs.py` was not run (needs a `DEMO_DIR` setting). The earlier run on commit `ab815aa` had 387 passed and 7 failed; the login-gate test now passes after the previous commit.
The run ends with asyncio "Event loop is closed" noise from an HTTPS client left open at exit.

## Frontend
- `npm run build`: passes. Main chunk 605 kB (over the 500 kB warning).
- `npm test` (vitest): **26 failed, 53 passed (79 tests); 4 of 7 files fail.**
  - `Dynamic3TierWorkspace.test.jsx` 14 failed (`createTeam` / `createMatter is not a function`: the tests call a store API that has changed).
  - `LexAmplify_Final_E2E.test.jsx` 4 failed.
  - `LexAmplify_Suite.test.jsx` 8 failed (missing elements such as "AI Legal Associate" and "Save to Case Vault"; the UI has changed since).
  - `scanLayout.test.js` fails to load: `window is not defined` (needs the jsdom environment).

## Routes
347 routes: 19 public (`/api/auth/*`, `/api/ping`), 318 signed-in API routes, 9 legacy non-API pages, 1 static. See `docs/PRODUCT_MAP.md`. The default-deny gate is in `app.py` (`_require_sign_in_for_api`).

## Not measured in the baseline
Real-model output (no key), browser tests (Playwright), Lighthouse, deploy.
