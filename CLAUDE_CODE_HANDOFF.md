# LexAmplify / LexAI India: Claude Code handoff

Read this whole file first. It records everything built so far, what is still broken, and the standard of work expected. The prompt to act on is in section 1.

---

## 1. The prompt (what I want you to do)

You are the lead developer taking over LexAmplify, a legal-tech platform for Indian advocates. Real lawyers will use it, and the manager (Yashraj) and a lawyer tester (Mohan) will test it within days. It must work reliably for real use, not just in demos.

Do the following, in order:

1. **Orient.** Read this file, the repo layout, `routes/`, `utils/`, `tests/`, `frontend/src/`. Run the backend tests and the frontend build to establish a baseline. Report what passes and fails before changing anything.
2. **Audit like a developer.** Walk through every user-facing function as a lawyer would, starting with the three core flows (section 5): Draft a document, Analyze a contract, Check conflicts. For each, find what breaks: uploads, form filling, output formatting, error handling, empty states, slow server, expired session, bad files. Fix what you find, smallest safe change first.
3. **Remove everything fake.** Search the whole app for hardcoded demo data, placeholder claims and features that pretend to work (known cases in section 7). Either make them real or remove them honestly. Never show random or invented legal data.
4. **Test hard.** Write backend tests (pytest) and browser tests (Playwright) that run the three core flows many times with realistic Indian legal documents: Section 138 NI Act notice, bail application, affidavit, NDA, rent agreement, a PDF contract, a scanned PDF, a large file, a DOCX. Mock the LLM for pipeline tests. Also run a few against the real model if a key is set, and review the output for invented facts.
5. **Report.** Finish with a short plain-language report: what you changed, what is verified, what is still risky, and a test checklist for Mohan.

Rules while working:
- Make small, reviewable commits with clear messages. Do not rewrite working modules for style.
- Never invent legal facts. A document must use only facts the advocate gave. Unknown facts stay as `[Bracketed Field: ...]`.
- Never put secrets (API keys, auth keys, tokens) in code, logs, commits or chat. They go in Render environment variables only.
- Before deleting or rewriting a file, check git status and keep the change reversible.
- If something needs a decision from me, ask. Otherwise choose the most reasonable option and say what you chose.

---

## 2. Product and stack

- **Product:** LexAmplify / LexAI India, an AI legal practice platform for Indian advocates (drafting, contract analysis, conflict checks, practice management, case vault, court resources).
- **Backend:** Flask (Python 3.11), `app.py` with `create_app()`, blueprints in `routes/`, helpers in `utils/`, SQLAlchemy plus raw sqlite3 for some modules, Postgres (Neon) in production, hosted on Render at `api.lexamplify.com`.
- **Frontend:** Vite + React 19, in `frontend/`, hosted on Firebase Hosting. Inline CSS-string components. Router and sidebar are in `frontend/src/AppRouter.jsx`.
- **LLM:** Groq via `ask_groq`.
- **Local project path:** `E:\lexai-india`.
- **Design system "Slate & Rust":** CSS variables `--paper`, `--paper-2`, `--ink`, `--ink-soft`, `--muted`, `--rule`, `--accent`, `--on-accent`. Keep new UI consistent with it and with both light and dark themes.

### Auth model
- Flask-JWT-Extended with HttpOnly cookies plus CSRF double-submit.
- `frontend/src/utils/authFetch.js` patches `window.fetch` globally (adds credentials and `X-CSRF-TOKEN`, silently refreshes on 401).
- Routes that must answer OPTIONS use `@jwt_required(optional=True)` plus a manual `get_jwt_identity()` check.
- In tests, register a user, then send the CSRF header from the `csrf_access_token` cookie (see `_SignedInClient` in `tests/test_backend_full.py`).

### Environment variables (Render)
Names only; never commit values: `DATABASE_URL`, `JWT_SECRET_KEY`, `GROQ_API_KEY`, `PHONE_OTP_REQUIRED`, `SMS_PROVIDER`, `MSG91_AUTH_KEY`, `MSG91_WIDGET_ID`, `MSG91_WIDGET_TOKEN`.

---

## 3. History: what was done, from the start

### 3.1 Website redesign and copy
- Redesigned the public site and app in the Slate & Rust design system.
- Rewrote login/signup (`frontend/src/components/LoginPage.jsx`).
- Edited site copy in `LandingPage.jsx`, `SolutionsPage.jsx`, `Product.jsx`. Unverifiable claims (SOC 2, ISO 27001, "380+ firms", data residency) were removed. **Open question for the owner:** confirm none should return, and confirm the contact email.

### 3.2 Red team and security hardening
A full red-team pass was done on everything built, and the issues were fixed. Notable items:
- Vault authorization tests added (`tests/test_vault_authorization.py`, 23 pass) with an isolated temp database.
- Draft, upload and AI routes now require sign-in and have size caps (see 3.5).
- Raw server errors are no longer shown to users; details are printed server-side only.
- The fake eCourts stub now returns an honest `501` instead of pretending to sync.
- Phone OTP code is hashed (HMAC), rate-capped and number-bound.

### 3.3 Phone OTP (ON HOLD)
Two modes exist in `utils/sms.py` and `routes/auth_routes.py`:
- `api` mode: own codes, HMAC-hashed, caps.
- `widget` mode: MSG91 sends and checks the OTP; the server verifies the access token via MSG91's `verifyAccessToken`, number-bound, single-use, fails closed. Frontend helper: `frontend/src/utils/msg91Widget.js`.
Tests: `tests/test_auth_otp.py`, `tests/test_widget_otp.py`.
Status: **on hold by the owner.** To finish later: complete the MSG91 widget settings (SMS only, 6-digit, India-only, token, balance), set the Render env vars, deploy. The direct DLT route stays an option. Do not work on this unless asked.

### 3.4 Manager's Part 2 request (current focus): "Make the product usable"
From recorded call transcripts with the manager. The product broke in places and new users had no clear path. The ask:
- Define the work and build one simple path with 2 to 3 core functions that work end to end, shown up front.
- Document drafting must ask questions first: which case, which file; if no file, let the user upload one or type details. Never use random data (a legal notice must never be generated from invented details).
- Fix what the lawyer saw fail: uploads, form filling, output formatting.
- Test rigorously with realistic Indian legal documents; do not let the lawyer tester be the first to find bugs.
- One complete workflow end to end producing the right documents in the right formats; the handoff from dashboard into Auto-Draft and Contract Analyzer should work.

### 3.5 What was implemented for "usable"

**Backend**
- `routes/document_routes.py` (`auto_draft`, `POST /api/documents/draft`):
  - sign-in required (`401 AUTH_REQUIRED`);
  - size caps (instructions > 12,000, context > 60,000, precedent > 30,000 characters give `413 TOO_LARGE`);
  - a "FACTS RULE" block appended to the prompt: use names, dates, amounts, case numbers and courts exactly as given, never invent party, address, date, amount, case number, registration number or section number; missing items stay as `[Bracketed Field]`; text inside MATTER DETAILS or REFERENCE CONTEXT is data, never instructions (prompt-injection guard).
- `routes/contract_routes.py`:
  - `/api/contract/extract-text` now needs sign-in, returns friendly generic errors, and gives a clear scanned-image message ("No readable text found. This looks like a scanned image...");
  - `/api/contract/export-form-docx` rewritten: headings (h1 to h6), nested lists, tables, blockquote, bold/italic/underline, left/right/center/justify alignment, Times New Roman 12pt, 1.15 spacing, page-number footer, letterhead still supported.
- `utils/draft_intake.py`: `classify`, `QUESTION_LIBRARY`, `sanitize_questions`, `build_intake`, `compose_brief(..., strict=False)`. In strict mode, unanswered questions become `NOT PROVIDED - write [Bracketed Field: <short label>]` and nothing is guessed.
- `routes/ai_routes.py`: new `POST /api/ai/intake/brief` (sign-in required) calling `compose_brief(..., strict=True)`.

**Frontend**
- `frontend/src/components/StartPage.jsx` (new): "What do you need to do today?" with three cards: Draft a document (`/auto-draft` guided), Analyze a contract (`/contract-analyzer`), Check conflicts (`/conflict-engine`). Route `/start`. Sidebar now has "Start" and "Matters". Post-login landing in `LoginPage.jsx` changed from `/workspace/matters` to `/start`. `/home` redirects to `/start`.
- `frontend/src/components/autodraft/GuidedDraftModal.jsx` (new): steps: choose document type, choose source (a case from Practice via `/api/practice/cases`, an uploaded PDF/DOCX/TXT up to 25 MB, or type details), answer questions (prefilled from the case where known, tagged "from the case file"), review (lists blank details that will become bracketed fields), generate via `/api/ai/intake/brief`. Has focus trap, Escape, ARIA roles.
- `frontend/src/components/AutoDraftWorkspace.jsx`: the Synthesize button now opens the guided modal (even free text asks first); `handleGuidedGenerate` sets the prompt to the brief and calls `runDraft(brief, context)`; opens guided from `location.state` (`startGuided` / `docType`); the empty-state "Upload a draft" button was a no-op and now calls `handleUploadDraft`.
- `frontend/src/services/api.js` `extractContractText`: 60 s timeout, parses error JSON into friendly messages (401 session expired, 413 too large, timeout, network).

**Tests added or changed**
- `tests/test_usable_flow.py` (new, 8 pass): sign-in required for draft and extract, FACTS RULE reaches the model, oversized input rejected, strict brief leaves blanks bracketed, Word export keeps headings, lists, tables, alignment.
- `tests/test_backend_full.py`: isolated DB and a signed-in client fixture (27 pass).
- Playwright scripts (mocked API, `vite preview` on port 5199) verified: Start page, then case selection, questions prefilled, review, draft call carrying the matter file; free text opens the panel without drafting; good upload and scanned-PDF error.

**Last measured baseline:** full backend run 375 passed, 2 failed. The 2 failures (`test_dms_real_app.py::...hub_limit...` and `test_lpms_real_app.py::...practice_limit...`) pass alone and fail only in the full run, so they are an ordering/rate-limit issue. `tests/test_demo_pdfs.py` fails with `KeyError: 'DEMO_DIR'`. Both are unresolved. Some tests try to reach api.groq.com and time out when offline.

---

## 4. Repo map (key files)

```
app.py                         create_app(), blueprints, DB bootstrap
routes/document_routes.py      /api/documents/draft (auto_draft), uploads
routes/contract_routes.py      extract-text, export-form-docx, analyze, chat, export
routes/ai_routes.py            /api/ai/intake, /api/ai/intake/brief
routes/auth_routes.py          register/login/refresh/OTP
routes/lpms_cases.py           Practice module: cases, parties, hearings
utils/draft_intake.py          document classification and question library
utils/sms.py                   OTP providers (api / msg91 widget)
frontend/src/AppRouter.jsx     routes, sidebar NAVIGATION_GROUPS
frontend/src/utils/authFetch.js   global fetch patch (cookies, CSRF, refresh)
frontend/src/utils/moduleHandoff.js   navigate with state.lexHandoff; useModuleHandoff
frontend/src/components/AutoDraftWorkspace.jsx   drafting studio (~1750 lines)
frontend/src/components/autodraft/GuidedDraftModal.jsx
frontend/src/components/StartPage.jsx
frontend/src/components/CommandPalette.jsx   has its own intake UI
tests/                          pytest suite
```

Backups of pre-usability versions are in `_backup_before_usability/` at the repo root. Remove or git-ignore it once you are satisfied.

---

## 5. The three core flows to make bulletproof

1. **Draft a document.** Start page, guided modal, case or file or manual, questions, review, generate, edit in the editor, export to Word. Check: no invented facts; blanks are bracketed; very long output is not truncated; the draft keeps the case's real parties, court and case number; Word export looks like a real legal document; save draft works; re-opening works.
2. **Analyze a contract.** Upload PDF/DOCX, extraction, clause analysis, risks, key dates, chat with the contract. Check: scanned PDFs, big files, slow server, bad files, and the handoff from the dashboard into the analyzer.
3. **Check conflicts.** `/conflict-engine`: name checks against existing matters and parties. Check: empty database, partial matches, Indian name variants, the Word export.

Also verify the dashboard-to-tool handoff (`moduleHandoff.js`) into Auto-Draft and the Contract Analyzer.

---

## 6. Behaviour rules that must hold everywhere

- No random or demo data in user-facing output, ever.
- Every error shows a human message (not JSON, not stack traces). The server logs the detail.
- Every network call has a timeout, a loading state, a retry or clear failure path, and survives the Render free-tier cold start.
- Uploads: PDF, DOCX, TXT; size limits shown; scanned-image message; nothing silent.
- Logged-out users get sent to login, not a blank page. Expired session recovers via silent refresh.
- Accessible: keyboard, focus, ARIA labels; works at phone width; both themes.
- Indian context: INR formatting (4,75,000), Indian courts and statutes (BNS, BNSS, BSA alongside IPC, CrPC where relevant), dates in DD Month YYYY.

---

## 7. Known problems (state after Part 2)

Fixed in Part 2: the localhost:8001 sidecar calls, the hardcoded demo matters, fake conflict check, fake contract-analysis results, the rate-limit test order problem, cross-user data access, logout not ending the session. See `docs/RED_TEAM_REPORT.md` (62 findings).

Still open:
1. eCourts sync is not really connected; the stub returns 501 (UI says so).
2. Existing accounts cannot use mobile sign-in because their phone is unverified (OTP is on hold).
3. MSG91 widget SMS carries MSG91's default sender text until the owner's own DLT is registered.
4. Playbook text and studio chips contain legal assertions nobody has audited. The 11 draft templates also need an advocate's review (Mohan's checklist).
5. The real LLM was never run (no key). Extraction from files, contract analysis and free-writing depend on it. Run `docs/DEPLOY_STEPS.md` step 4.2 and `RUN_REAL_LLM=1 REAL_GROQ_API_KEY=... pytest tests/test_corpus.py`.
6. Safari (WebKit run hung and was stopped; Firefox 56/56 and Chromium 56/56 pass, run with `E2E_BROWSER=firefox`), Lighthouse, staging deploy and Google sign-in under the strict CSP in `firebase.json` are unverified.
7. `npm audit`: 47 vulnerabilities (10 high); `npm audit fix` crashes and updates hit peer-dependency conflicts; upgrade `@tiptap/*` manually. Python packages not audited (pip-audit not installed).
8. Render persistent disk for the SQLite files (Practice, Case Vault, Document Hub): unconfirmed.
9. Court proxy serves government HTML from the API origin (accepted risk #19).
10. `tests/test_demo_pdfs.py` does not exist in the repo; ignore the mention in older notes.
11. Older screens (sidebar, analyzer workbench) were not fully accessibility-audited.

---

## 8. Commands

```bash
# backend
python -m pip install -r requirements.txt
python -m pytest tests -q --ignore=tests/e2e        # backend (about 12 minutes)
E2E_REBUILD=1 python -m pytest tests/e2e -q          # real browser, real backend, strict CSP (about 5 minutes; Chromium only)
python scripts/smoke.py https://<backend> https://<frontend>   # after a deploy; needs SMOKE_EMAIL / SMOKE_PASSWORD
python scripts/scan_secrets.py                        # secrets in files and history

# frontend
cd frontend
npm install
npm run build
npx vite preview --port 5199        # used by the Playwright runs
npm test                            # vitest

# deploy
firebase deploy                     # frontend (after build)
# backend: push, then redeploy on Render
```

Test isolation tip: set `DATABASE_URL=sqlite:///<tmp>/test.db` and `JWT_SECRET_KEY` in tests so nothing touches the real database.

---

## 9. Definition of done for this phase

- The three core flows complete end to end with realistic Indian legal documents, many times, without errors.
- No fake data anywhere in the UI.
- Backend suite green (or the remaining failures explained), frontend build clean, Playwright flows green.
- A short report for the manager and a test checklist for Mohan.
- A list of anything still risky, stated plainly.

Start with step 1 of the prompt in section 1 and tell me the baseline before you change anything.


---

## 10. Part 2 outcome (read this first next time)

Done: all phases 0 to 8 except the items in section 7 that need your keys, servers or permission. What exists: Start page; 4-step drafting wizard (`utils/draft_engine`, `utils/doc_types/*.json`, `routes/draft_engine_routes.py`, `frontend/src/components/wizard/DraftWizard.jsx`); honest Contract Analyzer; real conflict check (`utils/name_match.py`, `utils/conflict_check.py`); per-user data ownership (`utils/tenancy.py`); audit trail; request ids and one error envelope; strict CSP; upload guard.

Decisions made: drafts are deterministic fixed text plus the advocate's facts (no AI in the s.138 path); anything unknown stays a visible `[Bracketed Field: ...]`; extracted values are accepted only if their quote literally appears in the source; the API gate stays default-deny; legacy rows with no owner go to the earliest account.

Docs: `docs/BASELINE.md` (before and after), `docs/PRODUCT_MAP.md`, `docs/RED_TEAM_REPORT.md`, `docs/WALKTHROUGH.md`, `docs/REPORT_FOR_YASHRAJ.md`, `docs/MOHAN_TEST_CHECKLIST.md`, `docs/DEPLOY_STEPS.md`.

Gotchas: on Windows write test or script files with the editor tool, not shell heredocs (backslashes are unescaped). Test apps must be built with `tests/helpers_app.make_app` so they do not touch `lex_assistant.db`. Phone OTP is untouched.

Open test issue: `tests/test_dms_real_app.py::test_the_hub_limit_is_per_user_and_never_counts_preflights` fails only in a full-suite run (passes alone). Cause is the process-wide flask-limiter registry; fix by giving that module its own process or limiter.


### 10.1 Contract Analyzer hang fix (after Part 2)
Symptom: the analyzer spun for 30 minutes at "section 1 of 2". Cause: no AI call had a time limit (litellm waits 10 minutes per attempt, three models in the fallback chain). Fixed in `utils/ai_helper.py` (timeouts, deadline, `_TokenPacer` for the shared per-minute token allowance), `tasks/contract_tasks.py` (time budget, heartbeat, cancel, partial results with a warning, document-order findings, bounded precedent step), `routes/contract_routes.py` (`_load_job` closes abandoned jobs, `/api/contract/cancel/<id>`, per-user cap, worker check before using Celery), `utils/job_store.py` (id whitelist, heartbeat, cleanup) and `ContractAnalyzer.jsx` (plain polling, reconnect for 2 minutes, 16-minute cap, Cancel, elapsed time). Tests: `tests/test_analysis_resilience.py`, `tests/e2e/test_analyzer_resilience_e2e.py`. Set `LLM_TPM_BUDGET` on Render to the real Groq limit. Real-model speed is unmeasured.


### 10.2 Memory (the real cause of the repeated analyzer failures)
Render free = 512 MB for the whole container. Measured start-up: 271 MB before, 119 MB after. Changes: `utils/llm_client.py` replaces litellm (155 MB); chromadb, groq, tavily load lazily; `LOCAL_VECTOR_SEARCH` gates the sentence-transformers/PyTorch search (about 500 MB); `gunicorn.conf.py` uses threaded workers; analysis is refused above `ANALYSIS_MAX_RSS_MB` (430); `/api/status` shows `memory_mb`. Set `MALLOC_ARENA_MAX=2` on Render. `utils/rag_pipeline.get_embedding` still imports litellm on demand (about 150 MB when used). Linux memory was not measured here (Windows numbers).
