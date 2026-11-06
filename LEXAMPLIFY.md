# LEXAMPLIFY — Architecture & Structure Memo

Living reference for anyone (human or AI) adding features without breaking existing flows.
Last updated: 2026-11-06, branch `lexamplify_improvement` (UI revamp).

## 1. The one rule that prevents wasted work: TWO frontend trees

`frontend/src/main.jsx` renders **`App.jsx`** — that is the ONLY live app (the **BLUE** app).

| | BLUE app (LIVE — edit this) | GREEN app (DEAD — do not edit) |
|---|---|---|
| Root | `src/App.jsx` (HashRouter, URLs `/#/...`) | `src/AppRouter.jsx` (BrowserRouter) |
| Shell | `src/shell/Shell.jsx` (navy `.rail` sidebar, `styles/shell.css`) | Layout inside AppRouter.jsx |
| Pages | `src/pages/*.jsx` | `src/components/*.jsx` |
| Analyzer | `pages/Contracts.jsx` + `pages/ContractDetail.jsx` | `components/ContractAnalyzer.jsx` |

The green tree is only referenced by two `components/vault/*` dialogs and one test. All gold/green
warm-luxury colours live there and never render.

## 2. Routes → pages (App.jsx)

Public: `/` Landing (signed-out) · `/login` · `/signup` · `/features` · `/how` · `/faq`.
Inside `<Protected><Shell/></Protected>`:
`/start` Today · `/matters(/:id)` Matters/MatterDetail · `/draft` Draft (legacy) · `/draft/:id` DraftEditor ·
`/auto-draft` StudioHome · `/contracts(/:id)` + `/contract-analyzer` Contracts/ContractDetail ·
`/research` · `/calendar` · `/library` + `/firm-library` Library · `/settings` · `/dashboard` ·
`/court-resources` · `/conflict-engine` · `/legal-forms` · `/war-room` · `/practice(/*)`, `/audit`,
`/clients(/:id)` · `/vault` CaseVault · `/document-hub` · `/workspaces`.

## 3. Theme / palette (MANDATED: blue slate-pro)

- **Single token base**: `styles/theme.css :root` — rewritten to blue so every `var()` renders blue even
  if the data-theme controller falls back. Runtime `data-theme="slate-pro"` (set by `store/useSettings.js`,
  imported first in main.jsx).
- Tokens: `--accent #2563C9` · `--accent-ink #1E54AD` · `--accent-soft #E3EDFB` · `--ink #141C2B` ·
  `--rail #101827` (sidebar) · `--bg #F4F6F8` · `--paper #FFF` · `--paper-2 #EEF1F5` · `--rule #DDE3EC` ·
  status `--ok #1F9D6B` / `--warn #D08A1E` / `--risk #D64545` · navy shadows `--sh-1/2/3`.
- **Rules for new UI**: use tokens only; never hardcode colours. Errors → `--risk` family, warnings/
  attention → `--warn` family (never blue), success → `--ok`, selection/accent → `--accent`.
  Soft tints: `color-mix(in srgb, var(--X) N%, transparent)`.
- Shared primitives in `styles/luxury-system.css`: `.lx-btn`, `.lx-card`, `.lx-item`, `.lx-empty`,
  `.lx-badge--*`, and (new) `.lx-skeleton`, `.lx-spinner`, `.lx-error`, a `prefers-reduced-motion` guard.
  `lx-btn--gold` is a legacy NAME — it resolves to blue `var(--accent)`.
- `styles/themes.css` holds a 7-theme engine; only `slate-pro` matters. `index.css` is NOT imported (dead).

## 4. Backend

- Flask, single entry `app.py` at repo root. Run: `PORT=5000 <python> app.py`
  (venv with all deps lives at `C:/Users/Dell/Documents/lexamplify/backend/.venv`). Debug is hard-OFF,
  no reloader → **restart manually after backend edits**.
- One DB: `instance/database.db` (legacy paths redirected by `utils/legacy_sqlite_shim.py`).
- Frontend Vite proxy: `/api` → `http://localhost:5000` (vite.config.js; `usePolling` enabled for Windows HMR).
- Workspace scoping via `X-Workspace-Id` header (attached globally by `utils/authFetch.js`).
- Contract analysis: POST `/api/contract/analyze(-file)` → `job_id`; progress polled from
  `/api/contract/analyses/active` and `/analysis-status/:id`. AI = OpenAI gpt-4o-mini via backend key.
- DOCX letterhead export: `utils/draft_engine/export.py` (see scripts/verify_letterhead_export.py
  regression test before touching geometry).

## 5. Testing without spending money (mock AI)

- Never trigger real analysis/draft AI calls in dev testing.
- `pages/Contracts.jsx` exposes a DEV-only hook: `window.__lxMockContract(progress?, stage?)` injects a
  fake in-flight analysis so the loading panel renders with zero backend/AI calls (stripped from prod
  builds via `import.meta.env.DEV`).
- Frontend tests: Vitest (`npx vitest run` in `frontend/`), jsdom, setup in `src/test/setup.js`.
- Test login (local only): rahul@test.com / 12345678.

## 6. Branches

- `auto-draft-studio-2` = **blue PROD** (stable; restore point `456e642`).
- `lexamplify_improvement` = UI revamp branch (all changes below live here). Never pushed; merge only
  after founder approval. Switch: `git checkout <branch>` (commit first).

## 7. UI-revamp changes on this branch (2026-11-06)

1. `theme.css` → blue token base (was warm-luxury gold/green).
2. `vite.config.js` → `server.watch.usePolling` (Windows HMR fix).
3. `pages/Contracts.jsx` → InlineAnalysisPanel redesigned: 5-step stepper (Extract/Dispatch/Analyse/
   Cross-check/Finalise) + thick blue gradient progress bar with live shimmer; rust tints → blue;
   DEV mock hook added.
4. `shell.css` → sidebar de-golded: active-nav pill/icon/label, brand "L" logo, user avatar, hover tints,
   badge glow, search focus ring → blue tokens. `Shell.jsx`: Start nav → `/start` (active state now
   highlights), IP-alert pill amber → `--warn`, notification badge fallback → blue.
5. `luxury-system.css` → shadow tokens green→navy; added `.lx-skeleton/.lx-spinner/.lx-error` +
   reduced-motion guard. `pages.css`/`studio.css` → modal/palette scrims green-black→navy.
   `workspace-switcher.css`/`workspaces-page.css` → brick-red errors → `--risk`.
6. Per-page palette sweep (all `pages/*`): every hardcoded off-palette colour (Tailwind reds/ambers/
   greens, steel-blue/purple badges, rust chips, stale `var(--x,#hex)` fallbacks, the undefined
   `--good` → `--ok`) mapped to the token families above. Draft/DraftEditor attention chips stay WARN
   (amber) by design — never blue.

## 8. Known follow-ups (deliberately NOT done — break-risk, verify backend first)

- Wiring dead controls (Research court filter/Save/Export, Library "Use as template", MatterDetail
  Quick-actions, Settings Notifications toggles + Integrations Connect) — endpoints must be verified first.
- Replacing `window.location.reload()` on workspace switch; DraftEditor 1.2s iframe polling →
  MutationObserver; consolidating Today/Dashboard and Draft/StudioHome duplicates; native
  confirm()/alert() → in-app modals; `lx-btn--gold` → `lx-btn--accent` rename.
