# Go live

How to put the current version of LexAmplify on the air, in the order that keeps the site working, and how to
undo it in two minutes if something is wrong.

Two things are deployed:

- **the backend** — Flask on Render (`api.lexamplify.com`);
- **the frontend** — the built React app on Firebase Hosting, on **two** sites: `test.lexamplify.com` and
  `lexamplify.com`.

The environment variables the backend needs are listed in `docs/RENDER_ENV_CHECKLIST.md` (names only). This
file is the order of operations.

---

## 0. Before you start (10 minutes)

1. **Know the two Firebase site ids.** They are in the Firebase console (Hosting → your sites) or in the
   command line:

   ```bash
   firebase hosting:sites:list
   ```

   It prints one line per site. Put the id of the `test.lexamplify.com` site in `<TEST_SITE_ID>` and the id of
   the `lexamplify.com` site in `<LIVE_SITE_ID>` below (write them here, in this file, so the next person does
   not have to look them up):

   ```
   <TEST_SITE_ID> =
   <LIVE_SITE_ID> =
   ```

   You need the Firebase CLI logged in to the project that owns the sites:

   ```bash
   firebase login
   firebase use --add          # pick the project shown in .firebaserc (lexamplify-4)
   ```

2. **Check the hosting configuration.** `firebase.json` currently holds **one** unnamed hosting block, so
   `firebase deploy --only hosting:<SITE_ID>` only works for the project's *default* site. If your
   `<TEST_SITE_ID>` or `<LIVE_SITE_ID>` is **not** the default site, the file needs one named block per site
   before the deploy in step 5 can address it. The blocks are copies of the existing one with the site named:

   ```json
   "hosting": {
       "<TEST_SITE_ID>": { "site": "<TEST_SITE_ID>", "public": "frontend/dist", "...": "same as now" },
       "<LIVE_SITE_ID>": { "site": "<LIVE_SITE_ID>", "public": "frontend/dist", "...": "same as now" }
   }
   ```

   (This file is not changed by the engineer; it is the owner's decision which shape to use. Everything else in
   the block — the CSP, the cache headers, the rewrites — must stay exactly as it is.)

3. **Take a backup.** Neon: Branches → create a branch from now. Render: note the commit that is running now
   (Render → the service → Events → the deploy log shows the commit). That commit is your way back.

4. **Check the Render disk.** Practice, the Case Vault and the Document Hub keep their data on disk. If no
   Persistent Disk is attached, a redeploy erases them. Confirm in Render → service → Disks. If a disk is
   attached, set `PERSISTENT_DATA_DIR` to its mount path.

---

## 1. The backend: environment variables (5 minutes)

Render → the service → **Environment**. Set the variables from the short table at the end of
`docs/RENDER_ENV_CHECKLIST.md`:

| Name | Value |
|---|---|
| `FLASK_ENV` | `production` |
| `JWT_SECRET_KEY` | 32+ random characters (`openssl rand -hex 32`) |
| `DATABASE_URL` | the Neon connection string |
| `GROQ_API_KEY` | the Groq key |
| `MAX_CONTENT_LENGTH` | `33554432` |
| `LLM_TPM_BUDGET` | your real Groq per-minute allowance |
| `MALLOC_ARENA_MAX` | `2` |
| `FRONTEND_URL` | `https://lexamplify.com` (or the test site, if that is the one you use) |
| `SSO_FRONTEND_REDIRECT` | `https://lexamplify.com/start` |

Save. **Never paste a value into chat, a commit or a screenshot.**

---

## 2. The backend: redeploy (3 minutes)

Render redeploys automatically when the branch it watches changes, or you can start one by hand:
**Manual Deploy → Deploy latest commit**.

Watch the log. You want to see:

```
Database tables verified successfully!
```

and **not**:

```
[app] Refusing to start: this deployment is not ready to serve.
```

If you see the refusal, the log names the exact variable that is wrong — go back to step 1, fix it, redeploy.
(The new tables — `draft_sessions`, `draft_versions`, `user_flags`, `revoked_tokens`, `audit_events` — are
created automatically on the first start.)

---

## 3. The backend: is it alive? (1 minute)

```bash
curl https://api.lexamplify.com/api/ping
```

Expect:

```json
{"db": true, "ok": true}
```

`"db": false` means the database is not reachable — check `DATABASE_URL` and that the Neon branch is awake.

Then, signed in, `https://api.lexamplify.com/api/status` should say every check is `ok`. Add `?deep=1` once to
see whether the AI provider answers.

---

## 4. The frontend: build (2 minutes)

```bash
cd frontend
npm install
npm run build
```

The build must finish with `✓ built`. Check that `frontend/.env.production` still points at the API:

```
VITE_API_BASE_URL=https://api.lexamplify.com
```

(That file is committed and holds no secret. Do not change the API address to a local one.)

---

## 5. The frontend: deploy to both sites (3 minutes)

Deploy the **test site first**, check it, and only then the live site.

```bash
cd ..                                  # back to the repository root
firebase deploy --only hosting:<TEST_SITE_ID>
```

Open `https://test.lexamplify.com`, hard refresh (Ctrl+Shift+R), and check that the app loads and can sign in.

When that works:

```bash
firebase deploy --only hosting:<LIVE_SITE_ID>
```

Open `https://lexamplify.com` and hard refresh again.

If the CLI says it cannot find the site, it is the `firebase.json` shape in step 0.2 — the site id in the
command and the block in the file have to be the same.

---

## 6. In the browser (5 minutes)

1. `https://test.lexamplify.com` → sign in with the test account.
2. **Hard refresh** (Ctrl+Shift+R). The old build is cached by the service worker and by the browser.
3. Open the console (F12) and look for red lines. A Content-Security-Policy refusal is printed as
   "Refused to …" and names the host that is not allowed — add that host to the matching directive in
   `firebase.json` and deploy hosting again.
4. Try "Continue with Google" — this is the one thing the automated tests cannot exercise (the browser test
   suite runs under the same policy but without a real Google sign-in).
5. On `https://lexamplify.com`: hard refresh, sign in, and check the three screens — Start, Draft a document,
   Analyze a contract.

---

## 7. The smoke test (2 minutes)

Make sure a **test account** exists (sign up on the site with an address you control; use it only for this).

```bash
set SMOKE_EMAIL=your-test-account@example.com
set SMOKE_PASSWORD=its password
python scripts/smoke.py https://api.lexamplify.com
```

Expect 15 lines starting with `PASS` and the last line "All checks passed." Any line starting with `FAIL`
says what to look at. The script creates one throw-away draft and deletes it; it changes nothing else.

The password is read from the environment only — never type it on the command line, where it would stay in
the shell history.

---

## 8. By hand, once (10 minutes)

1. Start → Draft a document → cheque bounce notice → From a file → upload
   `tests/fixtures/indian_legal/s138_return_memo_1.pdf` → fill the rest → Review → Download Word and PDF.
   Open both. Leave one detail empty on purpose: the review must show a yellow blank, not a guess.
2. Start → Analyze a contract → upload `commercial_contract_40pages.docx`. This is the first run against the
   real AI: check that each flagged clause really is in the contract.
3. Start → Check conflicts with an empty Practice: it must say "nothing to check against — this is not a
   clearance".

---

## 9. Afterwards (5 minutes)

- `https://api.lexamplify.com/api/status` (signed in): every check `ok`, `memory_mb` well under 250 while
  idle and under about 350 after one analysis. If it climbs towards 512, the service will be killed — look for
  the `[analyze] job … started, server memory N MB` lines in the Render log.
- Render → Metrics → Memory: the same numbers over time.

---

## Rolling back in 2 minutes

**The frontend (a new build is broken):**

The Firebase console has the rollback: **Hosting → the site → Releases → "Rollback to this release"** on the
release you want back. It takes effect in seconds; no build is needed.

There is **no `firebase hosting:rollback` command** in the Firebase CLI (checked in the installed
firebase-tools 15.19.0) — the releases and their rollback buttons live in the console.

If the console is not to hand, the same result comes from rebuilding and redeploying the previous commit:

```bash
git checkout <the-commit-that-worked>
cd frontend && npm install && npm run build && cd ..
firebase deploy --only hosting:<TEST_SITE_ID>
firebase deploy --only hosting:<LIVE_SITE_ID>
```

(`firebase hosting:releases:list` is not a command either; the release list is in the console.)

**The backend (a new deploy is broken):**

Render → the service → **Events** → the failed deploy → **Rollback**. Render redeploys the previous commit
in a couple of minutes. If you know which commit was good, use **Manual Deploy → Deploy a specific commit**
and type it in.

Rolling back the backend does not undo the database: the new tables (`draft_sessions`, `draft_versions`,
`user_flags`, `revoked_tokens`, `audit_events`) and the `owner_user_id` columns are additive and harmless if
they stay. Rows that existed before ownership belong to the earliest registered account and are shown to
nobody else — that is intended, not a side effect of the rollback.

**If sign-in itself is broken,** it is almost always the start-up check: look for "Refusing to start" in the
Render log, set `JWT_SECRET_KEY` (32+ random characters) and `DATABASE_URL` correctly, and redeploy.

**If only the AI is broken,** set `GROQ_API_KEY` again and restart the service. Nothing else is affected.

---

## What is not covered by this document

- Safari and iPhone (the browser tests ran on Chromium and Firefox only).
- Lighthouse (not installed here).
- The Render disk question — that is a question for you, step 0.4.
- A legal review of the document templates. Every template says so on the screen.
