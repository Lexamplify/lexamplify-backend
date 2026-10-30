# LexAmplify — Luxury Template Migration · HANDOFF

_Last updated: 2026-10-26. Repo: `goutham037/lexamplify-template` (this folder: `C:\Users\ASUS\lexamplify-template-wc`). Live: https://lexamplify.netlify.app (`main`)._

## 1. What this project is

Migrate the **real LexAmplify product** into this **clean, redesigned "luxury" template**, screen by screen. The rule: **rewrite each feature from scratch** in the luxury design, using the legacy app only as a *reference* for endpoints/behaviour — **never copy-paste** legacy components.

- **This repo** (`lexamplify-template-wc`) = the new luxury frontend (Vite + React, HashRouter). This is the product now.
- **Legacy/reference app** = `C:\Users\ASUS\lexamplify-src` (repo `Lexamplify/lexamplify-backend`): the Flask backend (served at `api.lexamplify.com`) + its old React frontend (`src/components/*`). **Backend is the real backend** both use. The old frontend components are **reference only** — do not mount or copy them.

## 2. Hosting / deploy (Netlify)

- **Site:** `lexamplify.netlify.app` — Netlify site id `a5865f1b-a87f-451a-8aa3-9e5d37db6f92`, team "stev" (account `goutham037`). Auto-builds from this repo's `main`. CLI authed as sharan goutham.
- **Backend reach:** the frontend calls a **relative `/api`** (same-origin). A **Netlify edge function** (`netlify/edge-functions/api-proxy.js`) proxies `/api/*` → `https://api.lexamplify.com` **and strips the `Domain=.lexamplify.com` from Set-Cookie** so the auth cookie is accepted on the `netlify.app` host. This is why login works here without any backend change. (`netlify.toml` wires build + edge function + SPA fallback; `public/_redirects` is the SPA fallback.)
- **Deploy (manual, with edge-fn bundling):**
  ```
  cd C:\Users\ASUS\lexamplify-template-wc
  netlify deploy --site a5865f1b-a87f-451a-8aa3-9e5d37db6f92 --prod
  ```
  Or just `git push` (auto-builds). `--no-build` does NOT bundle the edge function — deploy WITH build.

## 3. Architecture

- Entry: `src/main.jsx` → imports the luxury stylesheets (`src/styles/theme.css`, `luxury-system.css`, `themes.css`, `shell.css`, `studio.css`, `pages.css`, `editor.css`) + `store/useSettings.js` → mounts `src/App.jsx`.
- `src/App.jsx`: `<AuthProvider>` → `HashRouter` → `/login` + a `<Protected><Shell/></Protected>` layout wrapping all app routes. `Protected` gates on a real session (`GET /api/auth/me` via `src/context/AuthContext.jsx`), splash while initialising, redirect to `/login` when logged out.
- `src/shell/Shell.jsx`: the luxury frame — dark-green `.rail` sidebar (gold accents) with the full product nav (Workspace / Litigation & disputes / Practice & vault), translucent `.topbar`, `<Outlet/>`, real user + sign-out, user block links to `/settings`.
- **Design system = global CSS + `lx-*` classes** (`.lx-page/.lx-rise`, `.ph`, `.lx-card`, `.lx-btn`, `.lx-field`, `.lx-badge`, `.lx-list/.lx-item`, `.lx-stats/.lx-stat`, `.lx-dash-grid`, `.lx-empty`). Theme via `data-theme` on `<html>` from `src/store/useSettings.js` (default `slate-pro`). **To build a new screen, copy the STYLE of `src/pages/Today.jsx` / `Matters.jsx`.**

### Wiring pattern (every page uses this)
```js
const API_BASE = import.meta.env.VITE_API_BASE_URL || '';       // relative -> edge proxy
// GET:  fetch(`${API_BASE}/api/...`, { credentials: 'include' })
// POST: add headers { 'Content-Type':'application/json', 'X-CSRF-TOKEN': csrf() }
function csrf(){ const m=document.cookie.match(/(?:^|;\s*)csrf_access_token=([^;]+)/); return m?decodeURIComponent(m[1]):''; }
// 401 => "Your session has expired. Please sign in again." ; loading/error/empty states ; NO fabricated data.
import { useAuth } from '../context/AuthContext.jsx'; // user/logout
```

## 4. Screens — all rebuilt from scratch (`src/pages/*`), wired to the real backend

| Nav item | Route | Page file | Backend |
|---|---|---|---|
| Start | `/` | `Today.jsx` | practice/cases, drafts/sessions |
| Matters | `/matters`, `/matters/:id` | `Matters.jsx`, `MatterDetail.jsx` | `/api/practice/cases`(+/:id), create |
| Dashboard | `/dashboard` | `Dashboard.jsx` | cases + causelist + drafts analytics |
| Contract Analyzer | `/contract-analyzer` → `/contracts` | `Contracts.jsx`, `ContractDetail.jsx` | `/api/contract/*` (analyze→poll→clauses, rewrite, export) |
| Auto-Draft Studio | `/auto-draft` → `/draft` | `Draft.jsx` + `DraftEditor.jsx` (**WordCraft**) | `/api/drafts/*` |
| Court Resources | `/court-resources` | `CourtResources.jsx` | `/api/court-*`, `/directory/*`, `/legal-events` |
| Legal Calendar | `/calendar` | `Calendar.jsx` | `/api/calendar/events` + case hearings; add-event |
| Virtual Courtroom | `/war-room` | `WarRoom.jsx` | `/api/ai/simulate` + `/api/ai/chat` |
| Practice | `/practice` | `Practice.jsx` | `/api/practice/dashboard|cases|clients` |
| Case Vault | `/vault` | `CaseVault.jsx` | `/api/vault/*` |
| Document Hub | `/document-hub` | `DocumentHub.jsx` | `/api/dms/*` |
| Conflict Engine | `/conflict-engine` | `ConflictEngine.jsx` | `/api/conflict/check` + `/api/cases/autocomplete` |
| Firm Library | `/firm-library` → `/library` | `Library.jsx` | `/api/firm-library/saved` |
| Legal Forms | `/legal-forms` | `LegalForms.jsx` | templates catalog + `/api/contract/autofill-template`, `export-form-docx` |
| Research | `/research` | `Research.jsx` | `/api/legal-research` |
| Settings | `/settings` | `Settings.jsx` | `/api/auth/me`, change-password, theme store |
| (Login) | `/login` | `Login.jsx` | `/api/auth/login`, Google SSO link |

`src/pages/Soon.jsx` = luxury "being rebuilt" placeholder (now unused — all screens are built).

### The WordCraft draft editor (ours — not legacy)
Built in THIS template: `src/components/editor/WordCraftEditor.jsx` + `src/collab/wordcraftBridge.js` (+ AiPanel/PresenceBar/ShareDialog, `src/collab/useCollabDoc.js`), WASM bundle in `public/wordcraft/`. Used by `src/pages/DraftEditor.jsx` on `/draft/:id`. (A wiring agent once replaced it with block-rendering; it was restored from commit `cbaf66e`.)

## 5. Static vs dynamic (quick reference)
- **Court Resources:** frontend fetches everything; the **backend** hardcodes HC list, bare acts, cause-list URLs, district/form link tables as Python literals in `lexamplify-src/routes/court_routes.py` (`_HIGH_COURTS`, `_BARE_ACTS`, `_CAUSE_LIST_URLS`, `_HC`, `_DISTRICTS`, `_FORMS`). Judges (DB), legal feed (live RSS), SC forms (live scrape) are dynamic.
- **Bundled frontend static data** (`src/data/`): `legalTemplates.js` (Legal Forms catalog — by design), `disputeCatalog.json`/`districts.json`/judge JSONs (legacy fallbacks), `sample.js` (demo data — now UNUSED, safe to delete).
- **Hardcoded UI constants** (tab labels, date names, dropdown options, Settings integrations list) are fine. **`Research.jsx` "Recent"** is hardcoded but labelled like real recent searches — worth wiring or relabelling.
- Everything else (matters, drafts, vault, dms, practice, calendar, contracts, conflict, AI) is real DB/AI.

## 6. Verification status
- **Build-verified:** every page builds clean; app boots.
- **Eyeball-verified (logged in):** shell + nav + Today + Dashboard + Court Resources rendered with real data in a live session (user `naren`). The rest is build-verified but **not all clicked-through logged-in** — the assistant cannot hold a production login (and must not enter credentials). **Next owner should sign in at the live URL and click every screen.**

## 7. Gotchas
1. **Can't self-verify logged-in** — no production credentials are used by the assistant. A human must sign in to review authenticated screens.
2. **Stale chunks:** right after a deploy, an already-open tab can throw `Failed to fetch dynamically imported module … MIME text/html`. It's a cache artifact, NOT a bug — **reload**.
3. **Backend cold start:** Render sleeps; the first `/api/auth/me` can be slow (AuthContext retries, shows the splash). `authFetch`'s `/api/auth/me` is excluded from refresh-replay to avoid an infinite splash.
4. **Edge function must be bundled** — deploy WITH build (not `--no-build`).
5. **No fabricated data, ever** — real lawyers use this. New screens must fetch real data or show honest empty states.

## 8. Pending / follow-ups
- Sign-in sweep of all authenticated screens; refine any that look off.
- Distinct **Firm Library / Contract Analyzer / Auto-Draft Studio** screens if they should differ from Library / Contracts / Draft (currently aliased).
- Reconcile the restored **WordCraft `DraftEditor`** (collab/`useDocStore`) with the wired `Draft.jsx` list (session → editor flow).
- Deeper sub-routes: `/case/:caseId`, nested `/practice/*`, Document Hub scan/bundle write flows, Calendar/Vault heavy write actions (several are read-first with follow-up buttons).
- Optional: relabel/wire Research "Recent"; delete unused `src/data/sample.js`; move backend hardcoded court constants into an editable store.

## 9. Key paths
- Pages: `src/pages/*.jsx` · Shell/nav: `src/shell/Shell.jsx` · Routes: `src/App.jsx` · Auth: `src/context/AuthContext.jsx` · Design tokens/classes: `src/styles/theme.css` + `luxury-system.css` · WordCraft: `src/components/editor/` + `src/collab/` + `public/wordcraft/` · Netlify: `netlify.toml`, `netlify/edge-functions/api-proxy.js`, `public/_redirects`.
- Backend reference: `C:\Users\ASUS\lexamplify-src\routes\*.py` + `app.py` (read for endpoint shapes; never copy its frontend).
