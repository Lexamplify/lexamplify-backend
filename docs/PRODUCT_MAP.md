# Product map (Phase 0)

Classification is from reading the code and the route table, not from user testing. "Core" means it serves one of the three things the manager asked for up front. Generated route data comes from `python scripts/dump_routes.py` (347 routes on 2026-10-18).

## Screens (frontend/src/AppRouter.jsx)

| Class | Path | What it is |
|---|---|---|
| Core | `/start` | Start page with the three tasks |
| Core | `/auto-draft` | Drafting studio (guided modal, editor, Word export) |
| Core | `/contract-analyzer` (alias `/analyzer`) | Contract analysis |
| Core | `/conflict-engine` | Conflict check |
| Core | `/login` | Sign in and sign up |
| Core (feeds drafting) | `/practice/*` | Cases, parties, hearings: the "which case" source for drafting |
| Secondary | `/workspace/matters`, `/workspace/matter/:id`, `/workspace/team/:id`, `/workspace/org` | Matter, team and firm dashboards |
| Secondary | `/dashboard` | Dashboard |
| Secondary | `/vault`, `/case/:id`, `/case/:id/doc/:docId` | Case vault and document viewer |
| Secondary | `/document-hub` | Document Hub (upload, scan, bundles) |
| Secondary | `/calendar`, `/account-settings` | Calendar, account |
| Secondary | `/firm-library`, `/firm-library/draft`, `/legal-forms` | Library and form templates |
| Secondary | `/court-resources` | Court directories |
| To audit | `/war-room` | "Virtual Courtroom". Needs a check for demo or invented data (Phase 3). |
| Public | `/`, `/solutions`, `/security` | Marketing site |

## Backend routes by module (signed-in unless noted)

practice 78, dms 78, vault 33, auth 18 (public), contract 17, matters 15, ai 9, team 8, documents 7, causelist 6, billing 6, disputes 5, clients 5, library 4, ip 4, firm-library 4, conflict 4, teams 3, letterheads 3, plus about 40 single-route modules.
Totals: 19 public (`/api/auth/*` and `/api/ping`), 318 signed-in API routes, 9 non-API pages, 1 static.

## Findings from the map

1. **Legacy tables are not scoped per user.** `routes/client_routes.py`, `billing_routes.py` and `causelist_routes.py` have no `@jwt_required` and no `user_id` filter. The sign-in gate stops anonymous callers, but any signed-in advocate can read or change every other firm's clients and billing. Tracked as a High cross-tenant issue; fix is in the tenancy work.
2. **Legacy server-rendered pages** (`/billing`, `/clients`, `/case-management`, `/contract-viewer`, `/court-resources`, `/dashboard`, `/login`, `/signup`, `/`) are served by Flask outside `/api/`, so the gate does not cover them. They only return static templates, but they are dead weight on the API host.
3. **Dead sidecar calls removed.** `analyzeContractWithGroq` and `draftRevision` in `services/api.js` had no callers and pointed at `localhost:8001`; both removed. `VaultView.jsx` library search and citation resolver now use `VITE_RAG_SERVER_URL`; when it is not set the search stays off and citations open an Indian Kanoon search.
4. **`../../../data/districts.json` import** in `CourtResources.jsx` reaches outside `frontend/`, so the build depends on the repo layout. Scheduled for Phase 4.
5. **The last commit added binaries and a full code copy to git** (`chroma_data/*`, `_backup_before_redteam2/`). Backups should be ignored from now on.
