# LexAmplify Template — Screen ↔ Backend Map

Frontend: `lexamplify-template-wc` (Vite+React, repo `goutham037/lexamplify-template`).
Backend: Flask `app.py` + `routes/*.py` (repo `Lexamplify/lexamplify-backend`), served at `api.lexamplify.com`.

## API base resolution
- Every module reads `const API_BASE = import.meta.env.VITE_API_BASE_URL || ''` → defaults to **empty → relative `/api/...` (same-origin)**.
- **No `.env` exists** in the repo, so the `''` fallback ships. Dev proxies `/api` → `http://localhost:5000` (`vite.config.js`).
- Auth: JWT in an HttpOnly cookie; `utils/authFetch.js` adds `credentials:'include'` + CSRF and retries once via `/api/auth/refresh` on 401.
- **Exceptions (wiring bug):** `CourtResources.jsx` and `LegalResearch.jsx` fall back to a hardcoded `https://lexamplify-backend.onrender.com` instead of `''`. `VaultView.jsx` uses a separate `VITE_RAG_SERVER_URL`.

## Route → Screen → Backend → Status

| Route | Screen | Auth | Backend endpoints | Status |
|---|---|---|---|---|
| `/` | LandingPage | No | — | static (by design) |
| `/solutions` | SolutionsPage | No | — | static |
| `/security` | SecurityPage | No | — | static |
| `/login` | LoginPage | No | /api/auth/config, /otp/*, /login, /register, /forgot-password, /reset-password, SSO google | all-exist |
| `*` | NotFoundPage | No | — | static |
| `/dashboard` | DashboardView | Yes | GET /api/causelist/list | all-exist |
| `/start` | StartPage | Yes | /api/drafts/flags/*, /api/drafts/sessions | all-exist |
| `/draft/:sessionId?` | DraftWizard | Yes | /api/drafts/*, /api/practice/cases*, /api/contract/extract-text | all-exist |
| `/check-conflicts` | ConflictCheck | Yes | POST /api/practice/conflicts/check | all-exist |
| `/workspace/matters` | MatterLauncher | Yes | /api/teams, /api/matters, PATCH /api/matters/<id>/team | all-exist |
| `/workspace/matter/:matterId` | MatterDashboard | Yes | /api/matters/<id>(+deadlines/tasks/notes/documents/activity), /api/vault/documents/upload | all-exist |
| `/workspace/team/:teamId` | TeamDashboard | Yes | /api/teams(+roster), /api/matters | all-exist |
| `/workspace/org` | OrgDashboard | Yes | /api/teams, /api/matters | all-exist |
| `/contract-analyzer`, `/analyzer` | ContractAnalyzer | Yes | /api/contract/analyze, extract-text, cancel/<id>, analysis-status/<id>, stream/<id> (SSE), rewrite, chat, cross-check | all-exist |
| `/auto-draft` | AutoDraftWorkspace | Yes | /api/contract/extract-letterhead, /api/vault/documents/<id>/content, /api/documents/draft, /api/drafts, /api/contract/export-form-docx, extract-text; AutoDraftAssistant → /api/documents/autodraft-assistant; GuidedDraftModal → /api/practice/cases*, /api/ai/intake(+/brief) | all-exist |
| `/court-resources` | CourtResources | Yes | /api/court-globals, /api/courts/high-courts, /api/court-data/<state>, /api/courts/judges, /api/directory/supreme-court, /api/legal-events, /api/forms/fetch-dynamic, /api/proxy | all-exist (⚠ onrender.com fallback) |
| `/conflict-engine` | ConflictEngine | Yes | POST /api/conflict/analyze, GET /api/cases/autocomplete | all-exist |
| `/case/:caseId` | CaseVault | Yes | /api/cases/autocomplete, /api/vault/documents/<id>/citations, /api/vault/* | all-exist |
| `/calendar` | CalendarView | Yes | /api/ai/chat, /api/calendar/events, /api/calendar/save | all-exist |
| `/vault` | CaseWorkspace | Yes | /api/causelist/fetch, /api/ai/chat, /api/vault/*, /api/vault/provenance(+verify) | all-exist |
| `/practice/*` | PracticeApp | Yes | /api/practice/* (cases, me, members, clients, rti, calendar, events, reports, dashboard, search, audit, notifications) | all-exist |
| `/document-hub` | DocumentHub | Yes | /api/dms/*, /api/vault/folders(+init-blueprint), /api/dms/files/* | all-exist |
| `/war-room` | WarRoomView | Yes | /api/ai/chat, /api/vault/save, /api/ai/simulate | all-exist |
| `/firm-library` | FirmLibrary | Yes | /api/firm-library/saved, /external-search, /api/document/<case_id>, /api/vault/save, /api/ai/summarize-judgment | all-exist |
| `/legal-forms` | FormTemplateLibrary | Yes | — (static TEMPLATES + local dispute catalog) | static data (by design) |
| `/firm-library/draft` | LegalForms | Yes | /api/contract/autofill-template, /api/contract/export-form-docx, /api/firm-library | all-exist |
| `/case/:caseId/doc/:docId` | DocumentViewer | Yes | GET /api/vault/documents/<id>, /api/ai/chat | all-exist |
| `/account-settings` | AccountSettings | Yes | GET /api/auth/me, POST /api/auth/change-password | all-exist |
| `/chamber`,`/matters` | → /workspace/matters | Yes | redirect | — |
| `/home` | → /start | Yes | redirect | — |

## Gaps to fix
1. **onrender.com hardcoded fallback** — `CourtResources.jsx` (1153/1206/1238) and `LegalResearch.jsx` (18) default to `https://lexamplify-backend.onrender.com` instead of `''`. On a deployed build with no env var, these bypass the same-origin base and call onrender.com cross-origin (CORS + cookies break). Fix: use `|| ''` like every other module.
2. **VaultView.jsx — orphaned** — imported in `AppRouter.jsx:23` but never rendered by a `<Route>`. It's the only caller of `/api/search` + `/api/resolve-citation`, which exist only in the separate FastAPI RAG service, **not** in Flask. Dead code → remove the import (and file) or leave inert.
3. **Deploy wiring** — the repo has no `.env` / `netlify.toml`, so a Netlify build serves relative `/api` with nothing to proxy it. To work deployed (with login), it needs the same same-origin API proxy + cookie handling the product uses.
