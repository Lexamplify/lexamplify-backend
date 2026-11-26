# Row-Level Security rollout (Phase 2)

RLS is a **defense-in-depth backstop** under the app-level access control in
`utils/access.py`. The app's own firm/owner filters stay the primary control;
RLS makes a *missed* filter fail closed at the database.

## The one thing that makes this work
The app connects to Postgres as **one pooled role**, authorized by its own
Flask JWT — the DB can't see who's asking. So `pg_compat` pushes the caller's
identity into session GUCs on every connection checkout
(`utils/request_identity.py` → `app.user_id` / `app.workspace_id` /
`app.firm_id`), and every policy reads them as
`NULLIF(current_setting('app.user_id', true), '')::int` (empty → NULL → fail
closed; never `''::int`).

## Why applying the SQL is safe before cutover
While the app connects as the Supabase **superuser** `postgres`, RLS is
**bypassed** (FORCE included). Enabling RLS + policies changes nothing for the
running app. Enforcement begins only when `DATABASE_URL` is pointed at the
non-superuser `app_rls` role — a separate, deliberate step.

## Rollout order (cleanest tenancy key first, weakest last)
1. `clauses`  — owner_user_id INT NOT NULL  ← **001 (canary)**
2. `saved_drafts` / `draft_sessions` — owner/user_id NOT NULL
3. `matters`  — owner_user_id (+ workspace_id, team_id)
4. `clients`  — owner_user_id (nullable)
5. `calendar_events` — owner_user_id **TEXT** (no ::int cast — per-table predicate)
6. `case_vault` — user_id nullable + is_public carve-out (read wider than write)
7. `dms_docs` — workspace_id only (no owner); child tables none → EXISTS joins
8. `time_entries` — **no owner column** → scope via workspace_id / join clients. **Last.**

Each step: `ENABLE` + `FORCE` RLS, add policies, validate as `app_rls`, then move on.

## Apply + validate (per step)
1. Create the role once (set a real password; keep it out of git):
   `CREATE ROLE app_rls LOGIN PASSWORD '…' NOBYPASSRLS;`
   Put the session-pooler connection string in env `DATABASE_URL_RLS`.
2. Run the step's `.sql` as `postgres` (Supabase SQL editor).
3. `python migrations/rls/validate_rls.py` — connects as `app_rls`, sets the
   GUCs manually, and asserts a user sees only their own rows and cross-tenant
   reads/writes are blocked. **Red = do not proceed; green = next table.**

## ⚠ Cutover blocker: Supabase default-deny RLS on ~40 tables
Supabase enabled `ROW LEVEL SECURITY` with **zero policies** on most `public`
tables at creation (`teams`, `team_members`, `team_memberships`, `workspaces`,
`workspace_members`, `users`, the whole `lpms_*` family, `tasks`, `vault_*`,
`tracked_cases`, …). With the current `postgres` role this is invisible — it
has `rolbypassrls=True`. But `app_rls` does **not** bypass, and *RLS-enabled +
no-policy = deny all rows*. So the moment the app connects as `app_rls`, every
such table returns nothing / rejects every write and the app breaks.

Therefore **cutover-prep is mandatory**: for every table `app_rls` must touch
that does NOT yet have tenant policies, either (a) write policies, or (b)
`ALTER TABLE <t> DISABLE ROW LEVEL SECURITY` to return it to app-level-only
(the status quo). Plan: DISABLE on the non-sensitive / infra / shared tables
(auth infra, rosters, join tables we haven't modelled) and keep policy-backed
RLS on the owner/firm data tables. A join-policy also needs its referenced
table readable by `app_rls` (e.g. the `matters` team carve-out required a
SELECT policy on `team_memberships`).

## Cutover (after all key tables pass)
Point the app's `DATABASE_URL` at `app_rls` via the **session pooler**, keep a
privileged role only for migrations/DDL/background workers (which run with no
request identity → NULL GUCs → RLS would hide everything). Leave the app-level
filters in place — this is a backstop, not a replacement.

## Kill-switch
Per table: `ALTER TABLE <t> DISABLE ROW LEVEL SECURITY;`
Global: revert `DATABASE_URL` to the `postgres` role. Either restores pre-RLS
behavior instantly with no code change.
