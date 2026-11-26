-- ============================================================================
-- LexAmplify RLS — Phase 2, step 1: the non-superuser role + the first table.
-- ============================================================================
-- WHAT THIS IS
--   Row-Level Security as a DEFENSE-IN-DEPTH backstop under the app-level
--   firm/owner filters (utils/access.py). It makes a forgotten `WHERE
--   owner_user_id = ?` fail CLOSED at the database instead of leaking rows.
--
-- WHY IT IS SAFE TO APPLY NOW (inert until cutover)
--   The application still connects as the Supabase pooled `postgres` role,
--   which is SUPERUSER and BYPASSES RLS entirely (FORCE included). So enabling
--   RLS + policies below changes NOTHING for the running app. Enforcement only
--   begins when the app's DATABASE_URL is pointed at the `app_rls` role created
--   here (a later, deliberate step). This file is the canary: one clean table.
--
-- CONTRACT WITH THE APP
--   pg_compat sets per-connection GUCs on every checkout (utils/pg_compat.py,
--   utils/request_identity.py): app.user_id / app.workspace_id / app.firm_id.
--   set_config() cannot store SQL NULL — an absent identity becomes '' — so
--   every policy reads it as NULLIF(current_setting('app.X', true), '')::int,
--   which turns '' into NULL. A NULL predicate hides the row (fail closed) and
--   never raises ''::int.
--
-- POOLER REQUIREMENT
--   The app_rls role MUST connect through Supabase's SESSION pooler (or a
--   direct connection), NEVER the transaction pooler — session GUCs would be
--   reset between statements there, and this autocommit adapter cannot fall
--   back to SET LOCAL in an explicit transaction.
--
-- ROLLBACK / KILL-SWITCH is at the bottom of this file.
-- ============================================================================

-- 1) The request role. Run as `postgres`. SET A REAL PASSWORD before running;
--    do not commit the password — put the resulting connection string in the
--    DATABASE_URL_RLS env var (session pooler host), not in source control.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rls') THEN
    -- CREATE ROLE app_rls LOGIN PASSWORD '<<SET_ME>>' NOBYPASSRLS;
    RAISE NOTICE 'Create the role manually with a real password:';
    RAISE NOTICE '  CREATE ROLE app_rls LOGIN PASSWORD ''<<SET_ME>>'' NOBYPASSRLS;';
  END IF;
END$$;

-- 2) Privileges. app_rls gets DML on existing + future tables and sequence
--    usage (INSERT ... RETURNING id / lastrowid needs nextval). Tables stay
--    OWNED by postgres, so FORCE ROW LEVEL SECURITY is required for policies
--    to apply to a non-owner that nonetheless has broad grants.
GRANT USAGE ON SCHEMA public TO app_rls;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rls;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rls;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rls;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_rls;

-- 3) Canary table: clauses. Cleanest tenancy key (owner_user_id INT NOT NULL)
--    plus the nullable workspace_id legacy-visibility rule, preserved exactly.
ALTER TABLE clauses ENABLE ROW LEVEL SECURITY;
ALTER TABLE clauses FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clauses_rls_select ON clauses;
DROP POLICY IF EXISTS clauses_rls_insert ON clauses;
DROP POLICY IF EXISTS clauses_rls_update ON clauses;
DROP POLICY IF EXISTS clauses_rls_delete ON clauses;

-- SELECT: your own clauses, with the legacy workspace rule (a NULL-workspace
-- row is visible when no workspace is active, or it belongs to the active one).
CREATE POLICY clauses_rls_select ON clauses FOR SELECT USING (
  owner_user_id = NULLIF(current_setting('app.user_id', true), '')::int
  AND (
    NULLIF(current_setting('app.workspace_id', true), '') IS NULL
    OR workspace_id IS NULL
    OR workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::int
  )
);

-- INSERT / UPDATE / DELETE: only your own rows; a new row must be owned by you.
CREATE POLICY clauses_rls_insert ON clauses FOR INSERT WITH CHECK (
  owner_user_id = NULLIF(current_setting('app.user_id', true), '')::int
);
CREATE POLICY clauses_rls_update ON clauses FOR UPDATE
  USING      (owner_user_id = NULLIF(current_setting('app.user_id', true), '')::int)
  WITH CHECK (owner_user_id = NULLIF(current_setting('app.user_id', true), '')::int);
CREATE POLICY clauses_rls_delete ON clauses FOR DELETE USING (
  owner_user_id = NULLIF(current_setting('app.user_id', true), '')::int
);

-- ============================================================================
-- KILL-SWITCH / ROLLBACK (per table — instant, no app code change):
--   ALTER TABLE clauses DISABLE ROW LEVEL SECURITY;
--   -- or revert the app's DATABASE_URL to the postgres (superuser) role,
--   -- which bypasses every policy at once.
-- To drop the role entirely (after reassigning/removing grants):
--   REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_rls;
--   REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM app_rls;
--   DROP ROLE app_rls;
-- ============================================================================
