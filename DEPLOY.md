# LexAmplify — Deploy / Launch Runbook

Deployable branch: **`lexamplify_improvement`** (this is the production line; it has no
common history with `main`, so it is deployed directly, not merged).

## Production topology

| Piece | Where | Entry |
|---|---|---|
| Frontend | Firebase Hosting, project `lexamplify-4`, served at `app.lexamplify.com` | `frontend/dist` (SPA rewrite `** -> /index.html`) |
| Backend / API | Render (gunicorn), served at `api.lexamplify.com` | `gunicorn "app:create_app()"` |
| Frontend API base | `frontend/.env.production` -> `VITE_API_BASE_URL=https://api.lexamplify.com` | |
| Staging (optional) | Netlify `lexamplify-app.netlify.app` (edge-function proxy) | `netlify.toml` |

Deploy **backend first**, then frontend — the production frontend calls the production
backend, and the DB migrations below run on backend boot.

---

## CRITICAL: build the WordCraft editor engine before the frontend

The Auto-Draft editor is a WebAssembly engine loaded in an iframe at `/wordcraft/index.html`.
Those engine files are **gitignored** (`frontend/public/wordcraft/`) and are produced by a
**manual** CI workflow — they are NOT in the repo.

If you build the frontend without them, the SPA rewrite answers `/wordcraft/index.html`
with the main app's `index.html`, so the editor iframe loads the **entire app inside
itself** (or hangs on "Loading the editor…"). The whole drafting surface is broken for
real users. This is not a code bug — it is a missing build artifact.

Steps every frontend deploy must include:

1. Run the GitHub workflow **`build-wordcraft`** (`frontend/.github/workflows/build-wordcraft.yml`,
   trigger: `workflow_dispatch`).
2. Download its artifact **`wordcraft-web-lexamplify`** and extract it into
   `frontend/public/wordcraft/` (so `frontend/public/wordcraft/index.html` exists).
3. Only then run the frontend build (below). `vite build` copies `public/` into `dist/`,
   so the engine ships in the deployed bundle.

Verify after deploy: open `https://app.lexamplify.com/wordcraft/index.html` directly — it
must serve the engine (WASM/canvas), NOT the React app shell.

---

## 1. Backend -> api.lexamplify.com

```bash
# from repo root, on branch lexamplify_improvement
# (Render build/start command is already: gunicorn "app:create_app()")
```

Environment variables (Render dashboard):

- `OPENAI_API_KEY` and/or `GROQ_API_KEY` — real keys (analysis + drafting degrade, not crash, if missing)
- `JWT_SECRET_KEY` — a strong secret (NOT the dev placeholder)
- `DATABASE_URL` — see the split-brain note below
- `WORKSPACE_ISOLATION_MODE=enforce` (now the default; set explicitly to be safe)
- `WORKSPACES_ENABLED=true`
- `EMAIL_DRY_RUN` / SMS / `REDIS_URL` — only if those channels are live

Schema migrations (`workspace_id` columns, personal-firm bootstrap, calendar/LPMS
columns) apply automatically on boot via `init_db()` + the LPMS `ensure_schema()`.

## 2. Frontend -> Firebase (app.lexamplify.com)

```bash
# 1) ensure frontend/public/wordcraft/ is populated (see CRITICAL section above)
cd frontend
npm install            # node_modules can be stale; a fresh install is required
npm run build          # uses .env.production -> api.lexamplify.com; copies public/ into dist/
cd ..
firebase deploy --only hosting --project lexamplify-4
```

---

## Pre-launch checklist

- [ ] WordCraft engine built into `frontend/public/wordcraft/` (see CRITICAL section)
- [ ] `npm install` run on the branch (stale `node_modules`; build fails fresh without `yjs`/`y-webrtc`/`y-indexeddb`)
- [ ] Backend deployed first; `WORKSPACE_ISOLATION_MODE=enforce`; real AI keys + JWT secret set
- [ ] Rotate any API key used during local testing
- [ ] Confirm prod `DATABASE_URL` (split-brain, below)
- [ ] Smoke test the deployed build (below)

## Post-deploy smoke test (production)

1. `https://app.lexamplify.com/wordcraft/index.html` serves the engine, not the app shell.
2. Sign up a fresh account -> lands in the app with a workspace (firm auto-bootstrap).
3. Create a client (the "+ Add client" switcher) -> succeeds (no "must belong to a firm").
4. Matters, Dashboard, Legal Calendar, Case Vault all load (no 500s).
5. Run a contract analysis -> progress climbs smoothly and results render.
6. Open Auto-Draft -> the editor loads (not "Loading the editor…" forever).
7. On a phone width, the sidebar is a drawer and nothing overflows.

---

## Known caveats (verify / decide before or shortly after launch)

- **Split-brain DB risk.** The personal-firm bootstrap and `workspace_id` migrations
  assume LPMS firms/members/cases live in a sqlite file that `ensure_schema()`/`init_db()`
  migrate (on Render this is typically `lex_assistant.db` on the attached Persistent Disk).
  If production SQLAlchemy is **Postgres** while LPMS data is a per-instance sqlite file,
  firm/workspace data will be inconsistent across instances. Confirm the consolidated-DB
  path is what production uses.
- **Contract reviews are not isolated per client** — they are firm/user-level, so a review
  run under one client is visible under every client. May be intended (a firm-wide review
  library); decide and, if needed, scope by `workspace_id`.
- **~7 pre-existing backend test failures** (`test_lpms_flow`, `test_autodraft_workspace`)
  predate this branch's launch work (confirmed on the base commit). Not launch-introduced,
  but worth triaging.
- **Celery branch** of `/stream` + `/analysis-status` is only active when `REDIS_URL` /
  `CELERY_BROKER_URL` is set; otherwise analysis runs in-process (local job store).

## What was fixed for launch (branch `lexamplify_improvement`, this pass)

Contract-analyzer loading (smooth climb), mobile-first responsive shell + per-screen
overflow fixes, self-serve firm bootstrap on signup, four core 500s (missing `workspace_id`
columns), an Auto-Draft `starred_types` 404, and security: closed the cross-firm
`X-Workspace-Id` IDOR (two sinks), gated the Celery-branch IDOR, made workspace isolation
`enforce` by default, and hardened the firm-bootstrap race.
