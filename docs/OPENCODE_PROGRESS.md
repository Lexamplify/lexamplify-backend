# OPENCODE_PROGRESS

Work log for the `opencode-refactor` branch. Any engineer (or model) can pick this up and continue.
Update this file after every step: **done / in progress / next / exact commands to resume / known failures**.

- Branch: `opencode-refactor` (never push, never deploy from this branch)
- Brief: `OPENCODE_COMMAND.md` (read it first; its rules win)
- Last updated: 2026-10-21, after STEP 0

---

## DONE

### STEP 0 — read the docs and measure the baseline (no code changes)

Read: `CLAUDE_CODE_HANDOFF.md`, `docs/BASELINE.md`, `docs/PRODUCT_MAP.md`, `docs/RED_TEAM_REPORT.md`,
`docs/DEPLOY_STEPS.md`, `docs/REPORT_FOR_YASHRAJ.md`.

Environment: Windows 11, `venv` Python **3.10.0**, pytest **9.1.1**, Node **v22.13.1**, npm 10.9.2.
HEAD at the time of measurement: `fac6a2b Update repository`.

#### Backend tests

```
.\venv\Scripts\python.exe -m pytest tests -q --ignore=tests/e2e
```

Result (raw last lines):

```
........................................................................ [  9%]
........................................................................ [ 18%]
...........................................................s............ [ 27%]
........................................................................ [ 37%]
...................s.s.s..ss............F...s................... [ 46%]
........................................................................ [ 55%]
........................................................................ [ 65%]
............F........................................................... [ 74%]
........................................................................ [ 83%]
........................................................................ [ 93%]
.....................................................                    [100%]
=========================== short test summary info ===========================
FAILED tests/test_dms_real_app.py::test_the_hub_limit_is_per_user_and_never_counts_preflights
FAILED tests/test_lpms_flow.py::test_hearings_cause_list_and_warnings - Asser...
2 failed, 762 passed, 9 skipped, 275 warnings in 936.67s (0:15:36)
```

**2 failed / 762 passed / 9 skipped** (15 min 36 s). Not one of the failures is "unexplained":

| # | Test | Diagnosis | Alone? |
|---|---|---|---|
| 1 | `tests/test_dms_real_app.py::test_the_hub_limit_is_per_user_and_never_counts_preflights` | **Known, order-dependent.** The rate limiter is a process-wide singleton; an earlier test file leaves it off, so the module's own "90 per minute" allowance is never applied and no request is refused (`0 >= 10` 429s). | **passes alone** (verified: `1 failed, 1 passed` when run with #2) |
| 2 | `tests/test_lpms_flow.py::test_hearings_cause_list_and_warnings` | **Date-dependent, new (not in any doc).** The test books the next Sunday for case `c1`, then posts a *malformed* time (`25:99`) for `iso(4)`. Today is **Wednesday 2026-10-21**, so the next Sunday **is** `iso(4)` (offset +4). `make_hearing()` (`routes/lpms_cases.py:340`) checks the duplicate-day rule **before** it validates the time, so the answer is `409` where the test expects `400`. The test only passes on days when the next Sunday is not `iso(3)`/`iso(4)`. | **fails alone** (verified) |

Fix for #2 is a **code** fix, not a test fix: validate the time before the duplicate-day check
(`400` for a malformed request instead of `409`). The test is left exactly as it is. This is a small
behaviour change, so it is listed in the plan as a decision for the manager.

#### Frontend build

```
cd frontend; npm run build
```

**PASSES.** `✓ 2132 modules transformed`, `✓ built in 14.44s`. Main chunk `index-CjLgttmL.js` 607.88 kB
(gzip 173.34 kB) — over the 500 kB warning; `textToHtml-CI8bqBV6.js` 473.45 kB is the next largest.
Only the usual "chunks are larger than 500 kB" advisory; no error.

#### Frontend unit tests (vitest)

```
cd frontend; npm test
```

```
 Test Files  6 passed (6)
      Tests  74 passed (74)
   Start at  17:15:11
   Duration  43.38s (transform 10.45s, setup 11.42s, import 13.27s, tests 36.96s, environment 59.09s)
```

**74 passed / 0 failed** (6 files: `CaseVaultLive`, `ChamberRoster`, `LexAmplify_Suite`,
`OrganizationGateway`, `startAndDraftApi`, `dochub/scanLayout`).

#### Git status

```
On branch opencode-refactor
Untracked files:
	CLAUDE_CODE_PART2_COMMAND.md
	OPENCODE_COMMAND.md

nothing added to commit but untracked files present
```

HEAD = `fac6a2b Update repository`. Working tree clean apart from the two untracked command files
(they are the brief; not committed yet).

#### Routes (for the route snapshot in Step 1)

```
.\venv\Scripts\python.exe scripts\dump_routes.py
```

**364 routes**: 19 public (`/api/auth/*`, `/api/ping`), 335 signed-in, 9 legacy non-API pages, 1 static.
(`docs/PRODUCT_MAP.md` says 363 — one route was added since that document was written.)

#### Browser tests (e2e) — NOT run in this baseline

`tests/e2e` was excluded (`--ignore=tests/e2e`) to match the documented baseline. Playwright browsers
(chromium, firefox, webkit) **are** installed locally, so the e2e suite can be run for the Step 4 proof.

---

## KNOWN FAILURES (carry these forward; do not let them grow)

**None.** Both baseline failures are fixed (Step 1), and the suite is green: **791 passed, 9 skipped, 0 failed**.

---

## OBSERVATIONS (not fixed yet, no risk to the running app)

- `scripts/dump_routes.py` builds the app **in the repository root**: it does not `chdir` to a temp folder and
  does not set `LEGACY_USER_MIGRATION=off`, so it opens the developer's real `lex_assistant.db`
  (it printed `[legacy_user_migration] migrated 10 legacy user(s) from lex_assistant.db`). It only reads,
  but the same gap is the open red-team item "older test files may read the real database". Candidate for Step 7.
- The test suite itself is safe: `tests/conftest.py` sets `LEGACY_USER_MIGRATION=off` and every Part 2 test app
  runs from a temp folder (`tests/helpers_app.py:make_app`).

---

## DONE (continued)

### STEP 1 — Safety net before any refactor

Commit: `step 1: safety net before any refactor (tests: 791/791)`.

**1a — the route table is frozen.** `tests/test_route_snapshot.py` + `tests/route_snapshot.txt` (364 lines:
`METHODS | path | endpoint | gate`). The test walks `app.url_map` and fails if a route disappears, appears,
changes name or changes sides. Rewrite the file on purpose only:
`REGENERATE_ROUTE_SNAPSHOT=1 python -m pytest tests/test_route_snapshot.py -q`.

**1b — the gate is default-deny, proved for every route.** `tests/test_api_gate_matrix.py` +
`tests/api_gate.py` (the public list in one place). It calls **every method of every route** without a
session: all 335 signed-in routes must answer 401 with the gate's own answer; the 19 public routes must reach
their own code (the four that ask for a session themselves — `GET/PATCH /api/auth/me`,
`POST /api/auth/change-password`, `POST /api/auth/refresh` — are listed by name); the 9 legacy pages outside
`/api/` are listed by name and must not be behind the gate. Nothing is skipped silently.
*Proof it bites:* with the gate switched off in `app.py`, the test fails; with it on, it passes.

**1c — one row per user-owned table.** `tests/test_cross_tenant_tables.py`: a matrix of 11 tables
(clients, tracked_cases, ip_assets, time_entries, invoices, team_members, tasks, calendar_events,
saved_drafts, letterheads, draft_sessions). For each: the second advocate does not see the row in the list,
cannot open it, cannot change it, cannot delete it, and the owner's row is exactly as it was afterwards.
The last test compares the tables the code calls per-advocate (`OWNED_TABLES` in the route modules) with the
tables checked here, so a new one cannot be added without a check.

**1d — the rate-limit tests are deterministic.** Root cause found: `flask_limiter`'s `init_app()` returns
early when the limiter is off, so an app built while another test file had left the process-wide limiter off
**never enforced a limit at all** (that is why the hub test saw 0 refusals in the full run and passed alone).
`tests/test_dms_real_app.py` and `tests/test_lpms_real_app.py` now switch the limiter on **before**
`create_app()` and reset the counters at the start of the limit test. No assertion was weakened.

**1e — a malformed hearing time is a bad request.** `routes/lpms_cases.py:make_hearing` now validates the
time before it compares the day with the diary, so `25:99` is a 400 and only a well-formed request can be a
409. The existing test was not touched; `tests/test_lpms_hearing_validation.py` (4 tests) proves both halves
(a malformed time is a 400 on a booked day and on a free day; a valid time on a booked day is still a 409).

**A real hole found by 1c and fixed:** `POST /api/drafts` (Auto-Draft Studio) wrote with an upsert on an id
chosen by the browser, so a second signed-in advocate who knew an id could **overwrite the first advocate's
saved draft** (verified: "ORIGINAL CONTENT" → "B OVERWROTE IT"). `app.py` now refuses a row that belongs to
somebody else (404, nothing said about its contents) and refuses an id that is not a short piece of text
(400; before: a 500). `tests/test_saved_drafts.py` covers it; the matrix test fails without the fix.

#### Proof (raw)

```
.\venv\Scripts\python.exe -m pytest tests -q --ignore=tests/e2e
...
791 passed, 9 skipped, 286 warnings in 917.69s (0:15:17)
```

Baseline was `2 failed, 762 passed, 9 skipped`. Now: **791 passed, 9 skipped, 0 failed** (+27 new tests,
+ the 2 that used to fail).

#### Red-team check for this step (section 3 of the brief)

Probe: `C:\Users\hp\AppData\Local\Temp\opencode\step1_redteam.py` (temporary file, not in the repo).
Attacks on the two changed places (`POST /api/drafts`, `POST /api/practice/cases/<id>/hearings`):

| Attack | Result |
|---|---|
| Unauthenticated save / hearing | 401 (the gate) |
| Another advocate saves over an existing draft id | 404, and the answer contains nothing of the draft |
| Another advocate deletes the draft | 404, the draft is still there |
| Empty body, null fields, 200 000-character title and body | no trace, no leak (200, stored as given) |
| Hindi/Tamil text, ₹ amounts | stored and returned unchanged |
| Control characters (NUL, ESC, BEL) in the id and text | stored as given, no crash |
| `'; DROP TABLE saved_drafts; --` as the id | stored as text; the table is still there |
| `../../x.pdf` as the id | stored as text (the id is never used as a file name) |
| The id is a list | was a 500 → now **400** ("That draft id is not valid.") |
| The id is a number / a string number | accepted as text |
| Malformed hearing time, 5 000-character time, control characters in the time, bad date | 400 each, no crash |
| A good time, then the same day again | 201, then 409 |
| Secrets or stack traces in the answers or the log | none (the JWT secret never appears; 5xx are masked with a request id) |
| New `except: pass`, new `localhost` URL, prints of user data | none added |

Result: **no problems**. The only thing the probe found was the 500 on a list-shaped draft id, which is fixed
and now has a test.

---

## IN PROGRESS

Nothing yet — Step 1 is committed; waiting for the manager's "go" on **Step 2**.

## NEXT

**Step 2 — make the new version live-able** (see the plan in the chat reply):

- 2a `docs/RENDER_ENV_CHECKLIST.md` — every environment variable the app reads (names only, never values),
  which are required in production, what a strong value looks like, and what the error says when one is
  missing. The start-up error must name the exact missing variable in plain English (small change in the
  config part of `app.py`).
- 2b `scripts/smoke.py` — it already exists and covers ping, sign-in, drafting a notice, Word/PDF export and
  sign-out; review it against the brief, extend if needed, and run it against a local server (proof).
- 2c `docs/GO_LIVE.md` — the exact ordered steps (Render env → redeploy → ping → `firebase deploy` for BOTH
  `test.lexamplify.com` and `lexamplify.com` → hard refresh → smoke → rollback), including "how to roll back
  in 2 minutes".

## EXACT COMMANDS TO RESUME

```powershell
# backend (about 16 minutes on this machine)
.\venv\Scripts\python.exe -m pytest tests -q --ignore=tests/e2e

# the two known failures on their own
.\venv\Scripts\python.exe -m pytest tests\test_dms_real_app.py::test_the_hub_limit_is_per_user_and_never_counts_preflights -q
.\venv\Scripts\python.exe -m pytest tests\test_lpms_flow.py::test_hearings_cause_list_and_warnings -q

# the Step 1 safety net on its own
.\venv\Scripts\python.exe -m pytest tests\test_route_snapshot.py tests\test_api_gate_matrix.py tests\test_cross_tenant_tables.py tests\test_saved_drafts.py tests\test_lpms_hearing_validation.py -q

# rewrite the route snapshot on purpose (read the diff before committing it)
$env:REGENERATE_ROUTE_SNAPSHOT="1"; .\venv\Scripts\python.exe -m pytest tests\test_route_snapshot.py -q; Remove-Item Env:\REGENERATE_ROUTE_SNAPSHOT

# frontend
cd frontend; npm run build; npm test

# browser tests (real backend, real Chromium, strict CSP) — about 5 minutes
$env:E2E_REBUILD="1"; .\venv\Scripts\python.exe -m pytest tests\e2e -q

# routes
.\venv\Scripts\python.exe scripts\dump_routes.py

# smoke script against a local server (needs SMOKE_EMAIL / SMOKE_PASSWORD, or --register on localhost)
.\venv\Scripts\python.exe scripts\smoke.py http://127.0.0.1:5000 --register
```
