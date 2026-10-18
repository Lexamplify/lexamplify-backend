# LexAmplify — Part 2 "Make the product usable": command for Claude Code

Paste everything below the line into Claude Code, run from `E:\lexai-india`. Read `CLAUDE_CODE_HANDOFF.md` first (it holds the history). OTP stays ON HOLD. Never print or commit secrets (`.env`, `MSG91_AUTH_KEY`, JWT keys).

---

## ROLE
You are a principal engineer and product architect with 20 years' experience shipping legal and enterprise software. You are taking over LexAmplify, a Flask + Neon Postgres backend (Render) and a Vite + React 19 frontend (Firebase Hosting) for Indian advocates. Your standard is: a lawyer who has never seen the product opens it in an office, and in under 5 minutes produces a correct, correctly formatted document without help, and nothing breaks. A product that works for the developer but fails for the first tester is a failure. Optimise for that moment.

## WHAT THE MANAGER ASKED (source of truth, verbatim intent from the call)
1. The product breaks in several places, and a new user has no clear path. Build ONE simple path so anyone landing knows what to do. Define what that work is.
2. Show 2–3 core functions up front, not the whole feature set: "Draft a document", "Analyze a contract", "Check conflicts".
3. Drafting must ASK before creating. A legal notice must never be generated with random data. It must ask which case and which file; if there is no file, let the user upload one or type the details. Never fill in invented data.
4. Fix the failures the lawyer saw: uploading a document, filling the fields, and formatting of the output.
5. Test hard. Run the flagship flow many times on realistic Indian legal documents. Use an AI-agent walkthrough to find breakages. Fix before Mohan tests.
6. At least one flow must be fully end to end. The dashboard-to-Auto-Draft and dashboard-to-Contract-Analyzer handoffs fit this.
Benchmark competitor: Harvey. Winning trait: simple. Not feature-rich, simple and working.

## CURRENT STATE (honest, from the previous sessions — verify, do not trust)
Built and committed: Start page with three actions; GuidedDraftModal (type, source [open doc | case | file | manual], questions, review, generate); strict brief (`/api/ai/intake/brief`, unknowns become `[Bracketed Field: X]`); FACTS RULE on `/api/documents/draft`; hardened extract-text (pdf/docx/txt, empty/corrupt give 422); hardened Word export; route guard with return-to-page; session-expiry handling; default-deny API gate (public only `/api/auth/*`, `/api/ping`); prod error masking; two-step login fail-closed fix. Backend suite roughly 399 pass / 1–4 known failures (rate-limit order, Windows PDF file lock, scan temp-file flake, one missing module).
NEVER DONE: any run against the real LLM (Groq); testing on realistic Indian documents at volume; a real AI-agent walkthrough; verification of Analyze-a-contract and Check-conflicts as full end-to-end flows; dashboard handoff beyond reading the code; deploy confirmation; Mohan test; report to Yashraj. The user says the current Start page and flows work but are not "enterprise grade". Treat them as a first draft.

## NON-NEGOTIABLE RULES
- Simple beats clever. Every screen answers: what is this, what do I do next. No jargon. Max 3 choices per decision. One primary button per screen.
- No invented facts, ever. Anything unknown stays `[Bracketed Field: …]` and is highlighted in the preview so the user fills it before export.
- Fail closed on security, fail soft on UX: every error gives a plain-English message plus a next step (retry, edit, contact). No raw JSON, stack, or "undefined" ever reaches the screen.
- Back up before changing (`_backup_before_<phase>`), commit small, keep tests green. Do not delete features; hide them behind "More tools".
- Do not weaken the API gate or CSRF. Do not touch OTP.

## PHASE 0 — Baseline and map (read-only, ~30 min)
1. Run backend tests and `npm run build`; record the baseline in `docs/BASELINE.md`.
2. Inventory every route and page; classify as Core / Secondary / Dead. Write `docs/PRODUCT_MAP.md`.
3. Grep every frontend `fetch` and API base URL; list anything pointing at `localhost` (known: VaultView, `services/api.js` use `http://localhost:8001`) and anything that would 401 under the default-deny gate. Fix them.

## PHASE 1 — The one simple path (design, then build)
Design a "Matter-first" home called **Start**:
- Headline: "What would you like to get done?" Three large cards only: **Draft a document**, **Analyze a contract**, **Check conflicts**. Under each, one plain sentence and the time it takes. A quiet "All tools" link opens the rest.
- First-run: after the first sign-in, a 3-step dismissible guide ("Pick a task → add your case or file → review and download"). Remember completion per user server-side, not only in localStorage.
- Every task uses the SAME wizard shell: a left-to-right stepper (Choose → Add details → Review → Download), a persistent "Save and finish later" and "Start over", autosave of progress so a refresh or crash loses nothing, and a final screen with Download Word / Download PDF / Open in editor / Do another.
- Empty states teach: no cases yet → "Add your first case" inline, not a dead end.
- Accessibility and polish: keyboard flow, focus rings, 44px touch targets, responsive to 360px, light theme with calm legal palette (deep ink, warm paper, one accent), consistent spacing scale, skeleton loaders not spinners, no layout shift. Match the new website design language.
Deliver Playwright screenshots (desktop, tablet, phone) in `docs/screens/`.

## PHASE 2 — Draft a document: expert-grade, never hallucinating
Build the drafting engine as a pipeline, not one prompt:
1. **Document-type registry** (`utils/doc_types/*.json`): for each type (legal notice u/s 138 NI Act, general legal notice, rent/lease agreement, sale deed, affidavit, NDA, vakalatnama, reply notice, plaint skeleton, bail application) define required slots, optional slots, validators (PAN, GSTIN, PIN, Indian mobile, cheque no., amounts in ₹ with words, date formats, court names from `data/`), statutory timelines (e.g. 15 days notice period, 30 days cause of action for s.138), and the section skeleton and clause library written by a human-reviewed template, with the LLM only fluent-filling the prose between fixed anchors.
2. **Intake (asks first)**: choose type → choose source (open document / existing case / uploaded file / type details). From any source, run **extraction with provenance**: every extracted value stores `{value, source_doc, page/offset, confidence}`. Show extracted values as an editable form with the source snippet beside each; unconfirmed low-confidence values are flagged amber. Missing required slots are asked as plain questions, one group at a time, with examples in Indian context.
3. **Verifier (anti-hallucination)**: after generation, programmatically check that every party name, amount, date, case number, section, and address in the output appears in the confirmed facts or the template; anything else is removed or turned into `[Bracketed Field]` and surfaced as a warning list ("3 items need your attention"). Statute citations must come from a whitelist file; unknown citations are flagged, never silently kept. Add a deterministic `facts_hash` so the same inputs give the same facts section.
4. **Rendering**: output real Word with proper styles: legal letterhead block, numbered paragraphs, headings, tables for schedules, Indian number format (4,75,000), amount in words, date style "17 October 2026", signature block, page numbers, A4, Times New Roman/Cambria 12pt, 1.5 line spacing. Export from structured JSON, not from scraping HTML. Add PDF export. Verify by converting the .docx to PDF and diffing text against the preview.
5. **Editor**: inline editing with the highlighted unresolved fields as chips; "regenerate this clause only"; version history (last 10); "explain this clause".
6. **LLM resilience**: timeouts, one retry with backoff, provider fallback (secondary model), strict JSON schema output with repair pass, token budgeting with chunked long files, and a clear "AI is busy, your details are saved, retry" state. Never block on the LLM for the form stage.

## PHASE 3 — Analyze a contract and Check conflicts, same shell
- **Analyze**: upload (PDF, DOCX, TXT, scanned with OCR fallback) or paste → progress with named steps → result as: 5-line plain summary, risk-ranked clause list (High/Med/Low) each with the exact quoted text, why it matters, and suggested fix wording; missing-clause checklist; one-click "Draft the amendment" which hands the finding to Draft with facts prefilled.
- **Check conflicts**: input party names (typed or extracted from an uploaded file) → fuzzy match (Indic transliteration, initials, "M/s", "Pvt Ltd" variants) against the firm's own clients and opposite parties → results as Clear / Possible / Conflict with the matching record and why; never claim "clear" if the data set is empty, say "no records to check against yet" and offer import.
- Make **dashboard → Auto-Draft** and **dashboard → Analyzer** handoffs carry case id, parties, and documents, with a visible "From case X" banner and a way to detach.

## PHASE 4 — Reliability and "does not break in front of others"
- Global React error boundary per route with friendly recovery; no white screens. Offline/slow banner. Request timeouts and cancel on navigation. Idempotent submit buttons (disable + dedupe). Autosave drafts.
- Backend: request IDs in every response and log; structured logs; consistent error envelope `{error:true, code, message}`; input size caps everywhere; file-type sniffing by magic bytes, not extension; virus-safe handling (never execute); temp-file cleanup; DB connection retry for Neon wake-up (503 DB_WAKING already handled, extend everywhere); health endpoint that checks DB and LLM reachability; graceful degradation.
- Config safety: refuse to start in production with weak or missing secrets; fail with a clear log line.
- Remove or auth-wrap dead legacy routes and `/api/proxy`; fix the frontend import of `../../../data/*.json` (move into `frontend/src/data` or a shared package) so builds are not layout-fragile.
- Fix the stale vitest suites (22 failing) or delete tests that test removed code; make Windows-safe temp handling for the PDF test; stabilise the rate-limit tests.

## PHASE 5 — Enterprise and scale
- **Tenancy**: add `firm_id`/`user_id` scoping to the legacy unscoped tables (clients, billing, causelist, ip, calendar) with an Alembic/Flask-Migrate migration and a backfill; add a test that user A can never read or write user B's rows across every router (automate it by walking `app.url_map`).
- Audit log for sign-in, document create/export/delete, share; export to CSV. Roles (owner, associate, clerk) enforced on server.
- Rate limits per user and per IP with sensible UX messages; background jobs (Celery already present) for long analysis with polling; pagination and indexes on list endpoints; cache static legal data.
- Observability: Sentry-style error capture hook (env-gated), basic metrics (draft success rate, export failures, LLM latency), and a `/status` page.
- Security pass: dependency audit (`pip-audit`, `npm audit`), headers (CSP, HSTS, frame-ancestors), cookie flags, CORS allowlist, secrets scan (`gitleaks`).

## PHASE 6 — Test like a hostile first-time user
1. Build a **golden corpus** `tests/fixtures/indian_legal/` of ≥ 30 realistic synthetic documents (no real client data): s.138 cheque-bounce packs, rent agreements, sale deeds, plaints, a 40-page commercial contract, scanned PDFs, Hindi/Tamil-mixed text, messy Word files with tables, a .doc-renamed-.docx, a password-protected PDF, an empty file, a 50 MB file.
2. Automated: for each fixture × each task, run the flow and assert (a) no 5xx, (b) no invented facts per the verifier, (c) every extracted value traceable, (d) Word opens and text matches preview, (e) bracketed fields remain for unknowns. Run the flagship (s.138 notice from a case file) **100 times** with the LLM stubbed for determinism AND **20 times** against the real LLM; log failure rate and fix until zero hard failures.
3. **AI-agent walkthrough**: run a Playwright-driven agent persona ("junior advocate, first day, never read docs") through Start → each core task on desktop and 375px mobile, recording confusion points (more than 2 seconds idle, dead ends, unclear labels). Save a report `docs/WALKTHROUGH.md` with screenshots; fix every finding; re-run until clean.
4. Chaos cases: kill network mid-upload, double-click submit, expired session mid-draft, Neon asleep, LLM timeout, huge paste, special characters, RTL/Indic text, browser back button, two tabs.
5. Cross-browser: Chromium, Firefox, WebKit; Windows and Mac fonts for docx.

## PHASE 7 — Acceptance gate (all must pass before you say "done")
- New user, no help, produces a correct s.138 notice in ≤ 5 minutes. Show the screen recording or step screenshots.
- Zero invented facts across the corpus; verifier catches seeded hallucinations in tests.
- Backend and frontend suites green on a clean checkout (`pytest`, `vitest`, Playwright). Build passes. No `localhost` in production bundle.
- Cross-tenant test green. Gate test green (only `/api/auth/*` and `/api/ping` public).
- Lighthouse accessibility ≥ 95 on Start; no console errors on the three flows.
- Deploy steps verified on a staging URL: `npm run build`, `firebase deploy`, Render redeploy, then a smoke script `scripts/smoke.py` hitting login → draft → export against the live API.

## PHASE 8 — Hand-off documents (write them)
1. `docs/REPORT_FOR_YASHRAJ.md`: one page, plain language: what changed, the 3 core flows, what is proven (with numbers from tests), what is not yet, risks, and the demo script.
2. `docs/MOHAN_TEST_CHECKLIST.md`: step-by-step tasks with expected results and a place to note problems, using the fixture documents.
3. Update `CLAUDE_CODE_HANDOFF.md` with decisions and open items.

## HOW TO WORK
Plan first (show the plan, then proceed without asking unless blocked). Work phase by phase; after each phase run the full tests, commit with a clear message, and print a 5-line status. If a requirement is ambiguous, choose the simplest option that satisfies the manager's words above and note it in the report. Report anything you could not verify honestly instead of claiming success.
