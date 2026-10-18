# Product map

Classification is from reading the code, the route table and the browser walkthrough. "Core" means it serves one of the three things the manager asked for up front. Route data comes from `python scripts/dump_routes.py` (363 routes after Part 2; it was 347 at the start).

## Screens (frontend/src/AppRouter.jsx)

| Class | Path | What it is |
|---|---|---|
| Core | `/start` | Start page: the three tasks, with the time each takes, "continue where you left off", a first-run guide remembered on the server, and "All tools" |
| Core | `/draft`, `/draft/:id` | The four-step drafting wizard (Choose, Add details, Review, Download). 11 document types |
| Core | `/contract-analyzer` (alias `/analyzer`) | Contract analysis (older screen, now with verified quotes, key dates, honest failure) |
| Core | `/check-conflicts` | Conflict check against the firm's own clients, cases and parties |
| Core | `/login` | Sign in and sign up |
| Core (feeds the three) | `/practice/*` | Cases, clients, parties, hearings. The source for "from one of my cases" and for the conflict check |
| Secondary | `/auto-draft` | Drafting studio: free writing with the AI, and the editor the wizard hands finished documents to. AI drafts here are now checked against what you supplied |
| Secondary | `/conflict-engine` | Older screen. Compares documents for discrepancies; its name check now uses the same real engine |
| Secondary | `/workspace/*`, `/dashboard` | Matter, team and firm dashboards (the invented "AI runs" figure was removed) |
| Secondary | `/vault`, `/case/:id`, `/document-hub`, `/calendar`, `/firm-library`, `/legal-forms`, `/court-resources`, `/account-settings` | Unchanged features, reachable from "All tools" |
| To audit | `/war-room` | "Virtual Courtroom". Not examined in Part 2 for invented data |
| Public | `/`, `/solutions`, `/security` | Marketing site |

## Backend

363 routes: 19 public (`/api/auth/*`, `/api/ping`), about 335 signed-in API routes, 9 legacy server-rendered pages, 1 static.
New: `/api/drafts/*` (types, extract, render, verify, export, sessions with 10 versions, flags), `/api/practice/conflicts/check`, `/api/audit/me` (+ `.csv`), `/api/status`.
Removed: `/api/contract/save` and `/api/contract/vault` (any signed-in user could read or overwrite every user's saved analyses).

## Findings from the map (all dealt with unless marked)

1. **Older tables were shared between all signed-in advocates** (clients, billing, tracked cases, IP assets, roster, tasks, calendar). Fixed: each is owned per advocate; earlier rows belong to the earliest account only.
2. **Legacy server-rendered pages** (`/billing`, `/clients`, `/case-management`, `/contract-viewer`, `/court-resources`, `/dashboard`, `/login`, `/signup`, `/`) are served by Flask outside `/api/`. They return static templates and no data. **Still there; not used by the React app.** Candidates for removal once you confirm nothing links to them.
3. **Dead sidecar calls removed.** Two unused helpers in `services/api.js` and the library search / citation resolver in `VaultView.jsx` pointed at `localhost:8001`. The latter now uses `VITE_RAG_SERVER_URL` and stays off when it is not set.
4. **`../../../data/districts.json`** moved into `frontend/src/data` so the build no longer depends on the repository layout. (The backend still reads `data/districts.json`; a copy exists in both places.)
5. **Backups were being committed.** `_backup_before_*` folders are now ignored (older ones are still in history).
6. **Not used by the React app:** `/api/billing/*`, `/api/clients/*` (only the legacy pages call them). They are now per-advocate and safe; consider removing.
7. **The Practice module is the real "which case" source.** It lives in a SQLite file on the server (`lex_assistant.db`): see `docs/DEPLOY_STEPS.md` about a persistent disk.
