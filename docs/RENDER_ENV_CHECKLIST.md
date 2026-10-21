# Render environment checklist

Every environment variable the app reads, **names only — never a value**. Do not paste a value into chat, into
a commit, or into a screenshot. Set them in **Render → your service → Environment**, then redeploy.

How to read this file:

- **Must be set** — the server refuses to start without it (the exact error is at the bottom of this file).
- **Needed for the product** — the server starts, but the feature does not work until it is set.
- **Optional** — a switch or a limit; the default is fine unless the table says otherwise.
- **Not yours to set** — set by Render or by the operating system.

Nothing here is a secret you should read out loud; each row only names the variable and says how strong a
value has to be.

---

## A. Must be set in production (the server will not start without them)

| Variable | What it does | What a strong value looks like | If it is missing |
|---|---|---|---|
| `JWT_SECRET_KEY` | Signs the session cookies. Anyone who knows it can forge a session as any advocate. | At least **32 random characters**, not a word and not `changeme`. `openssl rand -hex 32` gives one. | The server refuses to start: *"JWT_SECRET_KEY is missing. Set it to at least 32 random characters…"* |
| `DATABASE_URL` | The Postgres (Neon) connection string: accounts, drafts, audit trail. | The Neon connection string, whole, exactly as Neon shows it (`postgresql://…`). | The server refuses to start: *"DATABASE_URL is not set. Put the Postgres connection string from Neon into the Render environment…"* |

Both problems are reported **together**, in one message, at the top of the Render log.

A weak or guessable `JWT_SECRET_KEY` (`changeme`, `password`, `test`, …) is refused exactly like a missing one.

---

## B. Needed for the product to work as sold

| Variable | What it does | What a strong value looks like | If it is missing |
|---|---|---|---|
| `FLASK_ENV` | Switches the server into production mode: HSTS, the strict cookie settings, the safety check above. | The word `production`. | The app runs in development mode: no HSTS, and the safety check does not fire. |
| `GROQ_API_KEY` | The AI provider (Groq). Free-writing, reading facts out of a file, contract analysis and the chat assistant all need it. | The key from the Groq dashboard, pasted whole. | The app starts. The guided drafting still works (it is fixed text plus the advocate's facts), but the assistant shows *"the AI service did not answer"*, and `/api/status` reports `ai_configured: no`. |
| `MAX_CONTENT_LENGTH` | The largest request the server accepts. The screens promise uploads of 25 MB. | `33554432` (32 MB) — comfortably above the 25 MB the screens promise. The code default is 100 MB, so this only needs setting if you want a tighter cap. | With a cap below 25 MB the user gets a plain *"That upload is too large. The limit is N MB."* — the limit in the message is the number that is set. |

**Note on the two sites:** the browser is allowed to call the API from `https://lexamplify.com`,
`https://www.lexamplify.com`, `https://test.lexamplify.com`, `https://lexamplify-4.web.app` and
`https://lexamplify-4.firebaseapp.com` — this list is in the code, not in the environment. A **third** site
(a new Firebase preview domain, say) needs a one-line change in `app.py`; the same applies to the session
cookie's domain, which is fixed to `.lexamplify.com` in production.

---

## C. Optional, but each one turns on a feature

| Variable | What it does | What a strong value looks like | If it is missing |
|---|---|---|---|
| `PERSISTENT_DATA_DIR` | The folder of the Render Persistent Disk. The Practice database, the Case Vault and the Document Hub live there. | The mount path of the disk, exactly as Render shows it. | The data stays in the container and **is erased on the next redeploy**. The Document Hub screen warns that the files are at risk. |
| `DMS_STORAGE_DIR` | Where uploaded documents are kept. | A folder on the Persistent Disk. | The app picks a sensible place (`<PERSISTENT_DATA_DIR>/dms_files`, else `instance/dms_files`). |
| `DMS_ENCRYPTION_KEY` | Encrypts uploaded documents at rest. | A Fernet key: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`. Store it in Render, never in a file. | Documents are **not** encrypted at rest. A malformed key is refused loudly (it never falls back to plain text). |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | Send the Practice e-mails (hearing reminders) and the password-reset link. | The mail provider's details; `SMTP_PORT` is `587` by default; `MAIL_FROM` defaults to `no-reply@lexamplify.in`. | **The mailer prints the e-mail into the server log instead of sending it** — including the password-reset link. The user never receives it. |
| `FRONTEND_URL`, `FRONTEND_ORIGINS` | Where the links in an e-mail point, and which origins are allowed to ask for a reset link. | `FRONTEND_URL` = the site the user sees (`https://test.lexamplify.com` or `https://lexamplify.com`). `FRONTEND_ORIGINS` = a comma-separated list of the others. | The links point at the built-in default (`https://app.lexamplify.in`). A reset link sent to a visitor would land on the wrong site. |
| `SSO_FRONTEND_REDIRECT` | Where the browser lands after a Google/Microsoft sign-in. | The full URL of the page to land on, e.g. `https://lexamplify.com/start`. | The server prints a warning at start-up: *"FLASK_ENV=production but SSO_FRONTEND_REDIRECT is unset"* — the sign-in would land on `localhost:5173`. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | "Continue with Google". | The client id and secret from the Google Cloud console. | The button is not offered / the sign-in fails with a plain message. |
| `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID` | "Continue with Microsoft". | As above; the tenant defaults to `common`. | Same. |
| `PINECONE_API_KEY`, `PINECONE_HOST`, `PINECONE_INDEX_NAME`, `PINECONE_NAMESPACE` | The case-law vector search (Firm Library). | The Pinecone key and host; the index name defaults to `legal-cases`, the namespace to `legal-cases`. | The semantic case-law search is off; keyword search still works. |
| `TAVILY_API_KEY` | Web search for legal research and for the case-law step of the analyzer. | The Tavily key. | The web search step is skipped with a warning; the rest of the analysis still runs. |
| `ZENROWS_API_KEY` | The proxy used to read court websites (a scraping proxy). | The ZenRows key. | The court scraper uses the direct route instead, which is slower and more likely to be refused. |
| `KANOON_API_TOKEN` | The Kanoon case-law helper. | The token from Kanoon. | That source is skipped. |
| `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND`, `REDIS_URL` | The background queue (contract analysis off the web request). | A Redis URL, e.g. `redis://…`. | Render has no Redis: the analysis then runs inside the web server, which is what happens today. |
| `SENTRY_DSN` | Error reporting. | The DSN from Sentry. The `sentry-sdk` package must also be installed; otherwise it is ignored. | No error reporting; nothing else changes. |
| `ADMIN_SYNC_TOKEN` | The shared secret for the court-data sync URL (opened in a browser, no session). | A long random string; it is compared with `?token=…`. | The route **refuses everyone** (403) — it fails closed, it does not open up. |
| `CHROMA_PATH` | Where the local vector store lives. | A folder on the Persistent Disk. | The default folder (`chroma_data`). Only relevant with `LOCAL_VECTOR_SEARCH` on. |
| `LOCAL_VECTOR_SEARCH` | Meaning-based Firm Library search. | Leave **unset**. Switching it on loads the search model (~500 MB) — more than the whole free Render plan (512 MB). | Only keyword search. This is the safe setting for the free plan. |
| `SMS_PROVIDER`, `MSG91_AUTH_KEY`, `MSG91_WIDGET_ID`, `MSG91_WIDGET_TOKEN`, `MSG91_TEMPLATE_ID`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`, `PHONE_OTP_REQUIRED` | Phone sign-in by OTP. | On hold by the owner; leave as they are. | Phone sign-in is not offered. **Do not change this while the OTP work is paused.** |

---

## D. Knobs: the defaults are right unless the table says otherwise

| Variable | Default | When to change it |
|---|---|---|
| `LLM_TPM_BUDGET` | `8000` (the free Groq tier) | Set your real per-minute token allowance. The analyzer paces its calls to this number; too low a value makes a long contract end as a partial result. |
| `LLM_TIMEOUT_SECONDS` | `75` | One AI call may take at most this long. |
| `LLM_TPM_WINDOW_SECONDS` | `60` | The width of the rolling window the pacer assumes. |
| `ANALYSIS_MAX_SECONDS` | `240 + 20 x sections`, capped at 900 | The time one whole contract analysis may take. |
| `ANALYSIS_CALL_TIMEOUT` | `50` | The time one analyzer call may take. |
| `ANALYSIS_CHUNK_CHARS` | `4500` | How much of the contract is sent in one call. |
| `ANALYSIS_WORKERS` | `3` | How many sections are analysed at the same time. |
| `ANALYSIS_PRECEDENT_SECONDS` | `25` | The time allowed for the case-law step after the analysis. |
| `ANALYSIS_MAX_OUTPUT_TOKENS` | `2500` | The size of one answer from the model. |
| `ANALYSIS_LLM_SLOTS` | `4` | How many AI calls may run at once on the whole server. |
| `ANALYSIS_MAX_ACTIVE_PER_USER` | `2` | How many analyses one advocate may run at once. |
| `ANALYSIS_STREAM_MAX_SECONDS` | `20` | How long a live progress stream may be held open. |
| `ANALYSIS_STALE_SECONDS` | `75` | After this a job with no heartbeat is treated as dead. |
| `ANALYSIS_HARD_LIMIT_SECONDS` | `1200` | The absolute maximum length of one analysis. |
| `ANALYSIS_MAX_RSS_MB` | `430` | Above this the server refuses to start an analysis ("the server is busy, try again in a minute"). The free plan dies at 512 MB. |
| `DMS_RATE_LIMIT` | `1200 per minute` (per advocate) | The Document Hub's own allowance. |
| `LPMS_RATE_LIMIT` | `900 per minute` (per advocate) | The Practice module's allowance. |
| `DMS_MAX_FILE_MB` | `95` | The largest single file the Hub accepts. |
| `DMS_ZIP_MAX_MB` | `500` | The largest bulk upload the Hub accepts. |
| `DMS_WORKERS`, `DMS_SCAN_WORKERS` | `2`, `1` | How many documents are processed at once. Each one uses memory. |
| `DMS_OCR_ENABLED` | `1` | Set to `0` to switch scanning off (saves memory). |
| `DMS_OCR_MAX_PAGES`, `DMS_OCR_DPI`, `DMS_OCR_PAGE_TIMEOUT`, `DMS_OCR_LANGS` | `120`, `200`, `90`, English | The OCR settings for scanned papers. |
| `DMS_SCAN_MAX_PAGES`, `DMS_SCAN_MAX_PDF_MB` | `600`, `100` | The limits of the paper-scanning tools. |
| `DMS_EXTRACT_BUDGET_S`, `DMS_MAX_TEXT_CHARS` | `600`, `6 000 000` | How long one document may take to read, and how much text is kept. |
| `DMS_BUNDLE_MAX_PAGES` | `3000` | The largest bundle the Hub can put together. |
| `DMS_STALE_JOB_SECONDS`, `DMS_TRASH_DAYS` | `90`, `30` | When a job is treated as dead, and when deleted documents are thrown away. |
| `DMS_PDF_FONT`, `LPMS_PDF_FONT`, `LPMS_PDF_FONT_BOLD`, `DRAFT_FONT_DIR` | the fonts bundled in `static/fonts` | Only if you add your own font files. |
| `LPMS_SECRET_KEY` | falls back to `JWT_SECRET_KEY` | The key that signs Practice's own tokens. Set it separately only if you want to rotate it on its own. |
| `LPMS_TZ_OFFSET_MIN` | `330` | India Standard Time (330 minutes). |
| `LPMS_DEFAULT_CC` | `91` | The country code for SMS numbers. |
| `LPMS_REMINDER_INTERVAL` | `600` seconds | How often the Practice reminder scheduler runs. |
| `LPMS_SCHEDULER` | on | Set to `0` to stop the reminder e-mails. |
| `LEGACY_USER_MIGRATION` | on | Rows that existed before accounts were scoped belong to the earliest account. Leave it on; the tests switch it off for themselves. |
| `UPLOAD_FOLDER` | `static/uploads` | Only if the uploads must live somewhere else. |
| `DB_KEEPALIVE` | `1` | A small query that keeps the Postgres connection warm. Set to `0` to switch it off. |
| `JWT_COOKIE_SECURE` | on in production | The app forces it on in production; it cannot be turned off there. |
| `WEB_CONCURRENCY`, `GUNICORN_THREADS`, `GUNICORN_TIMEOUT`, `GUNICORN_GRACEFUL_TIMEOUT` | `1`, `6`, `120`, `30` | The web server's shape. One worker is right for the free plan (the analysis jobs live inside the process). |

---

## E. Not yours to set

| Variable | Who sets it |
|---|---|
| `RENDER` | Render sets it to `true` on every Render service. The app treats it as "this is production" for the safety check. |
| `PORT` | Render sets the port the web server must listen on. |
| `DYNO`, `K_SERVICE`, `FLY_APP_NAME` | Set by Heroku, Google Cloud Run and Fly.io. The app only uses them to recognise a hosted, ephemeral disk. |
| `MALLOC_ARENA_MAX` | **Not read by the app.** It is a setting for the C library on Linux. Set it to `2` on Render: programs that use threads otherwise hold far more memory than they need, and the free plan has only 512 MB. It commonly saves 50 to 100 MB. |

---

## F. Only for the test and smoke scripts — never set them in Render

`SMOKE_EMAIL`, `SMOKE_PASSWORD` (the smoke script), `E2E_BROWSER`, `E2E_FAKE_AI`, `E2E_LIMITS`, `E2E_REBUILD`,
`E2E_SKIP` (the browser tests), `RUN_REAL_LLM`, `REAL_GROQ_API_KEY`, `WALK_TRACE`, `DMS_SCALE_N`,
`REGENERATE_ROUTE_SNAPSHOT`, `DMS_STRICT_MOUNT` (the tests).

---

## The error messages you will see

**The server refuses to start.** The whole message is at the top of the Render log:

```
[app] Refusing to start: this deployment is not ready to serve.
  1. JWT_SECRET_KEY is missing. Set it to at least 32 random characters (for example: openssl rand -hex 32). The server will not start without it, and a weak key would let anyone forge a session.
  2. DATABASE_URL is not set. Put the Postgres connection string from Neon into the Render environment (service -> Environment). The server will not start without a database, and it must never fall back to a local file.
Fix the variables above in the Render environment (service -> Environment) and redeploy. Every variable the app reads is listed in docs/RENDER_ENV_CHECKLIST.md.
```

Each line names the exact variable, says what a good value looks like, and says where to fix it. Fix them all
in one go and redeploy — the message lists everything that is wrong, not just the first thing.

**Other messages worth knowing:**

| Where | What it says |
|---|---|
| A file that is too large | "That upload is too large. The limit is N MB. Please upload a smaller file." (N is the value of `MAX_CONTENT_LENGTH`) |
| The AI has no key | The assistant panel says "the AI service did not answer"; `/api/status` says `ai_configured: no` |
| Mail is not configured | The server log shows `[mailer] SMTP not configured — would send to …` — the e-mail was printed, not sent |
| The server is out of memory | A new analysis is refused above `ANALYSIS_MAX_RSS_MB`: "the server is busy, try again in a minute" |
| The court-data sync URL | "Unauthorized" (403) unless the request carries the `ADMIN_SYNC_TOKEN` |
| Google/Microsoft sign-in is not configured | The server log shows `[sso] WARNING: …`; the button gives a plain message |

---

## The short version to copy into Render (names only)

| Name | Value |
|---|---|
| `FLASK_ENV` | `production` |
| `JWT_SECRET_KEY` | *(32+ random characters)* |
| `DATABASE_URL` | *(the Neon connection string)* |
| `GROQ_API_KEY` | *(the Groq key)* |
| `MAX_CONTENT_LENGTH` | `33554432` |
| `LLM_TPM_BUDGET` | *(your real Groq allowance)* |
| `MALLOC_ARENA_MAX` | `2` |
| `PERSISTENT_DATA_DIR` | *(the disk mount path — only if a disk is attached)* |
| `FRONTEND_URL` | *(the site the user sees)* |
| `SSO_FRONTEND_REDIRECT` | *(where a Google/Microsoft sign-in lands)* |

Everything else in this file is optional and has a working default. `docs/GO_LIVE.md` has the order to set
them in, and how to undo it all in two minutes.
