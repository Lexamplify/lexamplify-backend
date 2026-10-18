# Deploy steps

Nothing here has been run against your live Render or Firebase projects. I cannot reach them from this environment. Everything below was checked as far as it can be locally: the frontend builds, the backend starts with the same code, and `scripts/smoke.py` passes against a local copy.

## 0. Before you start (5 minutes)

1. **Back up.** Render: take a database snapshot in Neon (Branches → create a branch from now). Code: the previous version is commit `db66ab8`; the files changed in Part 2 are also copied in `_backup_before_part2/`.
2. **Check these Render environment variables** (names only; never paste values into chat or code):

| Variable | Needed | Note |
|---|---|---|
| `JWT_SECRET_KEY` | yes | At least 32 random characters. **The server now refuses to start otherwise** (clear line in the Render log: "Refusing to start"). |
| `DATABASE_URL` | yes | Neon connection string. Also refuses to start without it. |
| `GROQ_API_KEY` | yes for AI | Without it drafting from the guided form still works; free-writing and analysis show "the AI service did not respond". |
| `MAX_CONTENT_LENGTH` | **change** | Set to `33554432` (32 MB). The screens promise 25 MB; a smaller value (the local `.env` has 16 MB) makes bigger files fail with a polite "too large" message. |
| `FLASK_ENV` | yes | `production` (turns on HSTS and the strict cookie settings). |
| `SENTRY_DSN` | optional | Error reporting. Needs `pip install sentry-sdk` first; ignored if missing. |
| `PHONE_OTP_REQUIRED`, `SMS_PROVIDER`, `MSG91_*` | leave as they are | Phone sign-in stays on hold. |
| `LEGACY_USER_MIGRATION` | leave unset | Defaults to on. Tests and local browser runs switch it off. |

3. **Persistent disk (please check, it matters).** Practice (cases, clients, hearings), the Case Vault and the Document Hub keep their data in SQLite files inside the Render service (`lex_assistant.db`, `instance/client_data.db`, the Hub's file folder). Render's disk is **wiped on every redeploy unless a persistent Disk is attached**. If none is attached, a redeploy loses that data. Confirm in the Render dashboard (service → Disks) before deploying. This is how the product was built, not something Part 2 changed, but Part 2 makes Practice the source for drafting and conflict checks, so it matters more now.

## 1. Backend (Render)

1. Merge or push the branch to the branch Render deploys (`main`). Render redeploys.
2. Watch the log for: `Database tables verified successfully!`. New tables are created automatically on first start: `draft_sessions`, `draft_versions`, `user_flags`, `revoked_tokens`, `audit_events`.
3. The older SQLite tables (clients, billing, tracked cases, IP assets, roster, tasks, calendar) get an `owner_user_id` column the first time each is used. **Rows that existed before belong to the earliest registered account and are shown to nobody else.** If your real data was entered under a different account, tell me and I will add a one-line reassign command.
4. Fonts for PDF export are bundled in `static/fonts/` (DejaVu Serif); nothing to install.

## 2. Frontend (Firebase)

```bash
cd frontend
npm install
npm run build
cd ..
firebase deploy --only hosting
```

`frontend/.env.production` supplies the API address (`https://api.lexamplify.com`); do not override it.

**New in `firebase.json`:** a strict Content-Security-Policy (`script-src 'self' https://accounts.google.com`, no inline scripts). All 46 browser tests run under exactly this policy with no violation, but **Google sign-in could not be exercised here**. After deploying, open the login page in a private window and try "Continue with Google". If it fails, open the browser console, look for a "Refused to…" line naming a host, and add that host to the matching directive in `firebase.json`; redeploy hosting.

## 3. Smoke test against the live API (2 minutes)

Make a test account first (sign up on the site with an address you control; use it only for this).

```bash
set SMOKE_EMAIL=your-test-account@example.com
set SMOKE_PASSWORD=its password
python scripts/smoke.py https://api.lexamplify.com
```

Expect 13 lines starting `PASS` and "All checks passed." Any `FAIL` line says what to look at. The script creates one throw-away draft and deletes it.

Also open `https://api.lexamplify.com/api/ping` (should say the database replied) and, signed in, `/api/status` (all checks "ok"; add `?deep=1` once to confirm the AI provider answers).

## 4. Then, once, by hand (10 minutes)

1. Start → Draft → cheque bounce notice → From a file → upload `tests/fixtures/indian_legal/s138_return_memo_1.pdf` → fill the rest → Review → Download Word and PDF. Open both.
2. Start → Analyze → upload `commercial_contract_40pages.docx`. This is the first run against the real AI: read the flagged clauses and check that each quoted sentence is really in the contract.
3. Start → Check conflicts with an empty Practice (should say "nothing to check against").

## Rolling back

- Frontend: `firebase hosting:rollback` (or redeploy the previous build).
- Backend: redeploy commit `db66ab8` on Render. The new tables are harmless if left in place; the ownership columns are additive.
- If sign-in itself breaks, set `JWT_SECRET_KEY` correctly first (the new start-up check is the most likely thing to stop a misconfigured server).
