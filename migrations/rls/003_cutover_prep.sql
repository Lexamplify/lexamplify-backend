-- ============================================================================
-- LexAmplify RLS — Phase 2, step 3: CUTOVER-PREP.
-- ============================================================================
-- Supabase enabled RLS with ZERO policies on 76 public tables by default. The
-- app's current `postgres` role has rolbypassrls=True so it never noticed, but
-- the non-bypass `app_rls` role is DENIED on every policy-less RLS table — so
-- the app cannot run as app_rls until each such table is handled.
--
-- This migration:
--   (a) gives `dms_docs` a tenant policy (own uploads + active-workspace docs);
--   (b) DISABLES RLS on the other 75 policy-less tables, returning them to
--       app-level-only enforcement — which is EXACTLY how they are protected
--       today (RLS has never been in force). The app-level firm/owner filters
--       and the Phase-1 X-Workspace-Id gate remain the control on these.
--
-- After this, app_rls can run the whole app, with policy-backed RLS as a
-- backstop on the 10 tenant-data tables (clauses + the 8 in 002 + dms_docs,
-- plus the team_memberships read policy). Harden further later by replacing a
-- DISABLE below with real policies, table by table.
--
-- Run as `postgres`. Safe to run while the app still connects as postgres.
-- Reverse any line with:  ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
-- ============================================================================

-- (a) dms_docs — Document Hub. Own uploads, or documents in the active
--     workspace (workspace_id matches the X-Workspace-Id GUC). No header →
--     only your own uploads are visible (fail closed).
ALTER TABLE dms_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE dms_docs FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dms_docs_rls_select ON dms_docs;
DROP POLICY IF EXISTS dms_docs_rls_insert ON dms_docs;
DROP POLICY IF EXISTS dms_docs_rls_update ON dms_docs;
DROP POLICY IF EXISTS dms_docs_rls_delete ON dms_docs;
CREATE POLICY dms_docs_rls_select ON dms_docs FOR SELECT USING (
  uploaded_by = NULLIF(current_setting('app.user_id', true), '')::int
  OR (workspace_id IS NOT NULL
      AND workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::int)
);
CREATE POLICY dms_docs_rls_insert ON dms_docs FOR INSERT WITH CHECK (
  uploaded_by = NULLIF(current_setting('app.user_id', true), '')::int
);
CREATE POLICY dms_docs_rls_update ON dms_docs FOR UPDATE
  USING      (uploaded_by = NULLIF(current_setting('app.user_id', true), '')::int)
  WITH CHECK (uploaded_by = NULLIF(current_setting('app.user_id', true), '')::int);
CREATE POLICY dms_docs_rls_delete ON dms_docs FOR DELETE USING (
  uploaded_by = NULLIF(current_setting('app.user_id', true), '')::int
);

-- (b) Return the remaining 75 policy-less tables to app-level-only protection
--     so app_rls can access them. (status quo — RLS was never enforced here.)
ALTER TABLE agent_checkpoints          DISABLE ROW LEVEL SECURITY;
ALTER TABLE agent_failure_memory       DISABLE ROW LEVEL SECURITY;
ALTER TABLE agent_messages             DISABLE ROW LEVEL SECURITY;
ALTER TABLE agent_steps                DISABLE ROW LEVEL SECURITY;
ALTER TABLE agent_tasks                DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events               DISABLE ROW LEVEL SECURITY;
ALTER TABLE bar_associations           DISABLE ROW LEVEL SECURITY;
ALTER TABLE capture_runs               DISABLE ROW LEVEL SECURITY;
ALTER TABLE cases                      DISABLE ROW LEVEL SECURITY;
ALTER TABLE chat_history               DISABLE ROW LEVEL SECURITY;
ALTER TABLE conflict_clearance_memos   DISABLE ROW LEVEL SECURITY;
ALTER TABLE contract_analyses          DISABLE ROW LEVEL SECURITY;
ALTER TABLE court_rosters              DISABLE ROW LEVEL SECURITY;
ALTER TABLE deadlines                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE dms_bundle_items           DISABLE ROW LEVEL SECURITY;
ALTER TABLE dms_bundles                DISABLE ROW LEVEL SECURITY;
ALTER TABLE dms_file_prefs             DISABLE ROW LEVEL SECURITY;
ALTER TABLE dms_filing                 DISABLE ROW LEVEL SECURITY;
ALTER TABLE dms_jobs                   DISABLE ROW LEVEL SECURITY;
ALTER TABLE dms_kv                     DISABLE ROW LEVEL SECURITY;
ALTER TABLE dms_locations              DISABLE ROW LEVEL SECURITY;
ALTER TABLE dms_pages                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE dms_pfile_docs             DISABLE ROW LEVEL SECURITY;
ALTER TABLE dms_pfile_moves            DISABLE ROW LEVEL SECURITY;
ALTER TABLE dms_pfiles                 DISABLE ROW LEVEL SECURITY;
ALTER TABLE dms_scan_pages             DISABLE ROW LEVEL SECURITY;
ALTER TABLE dms_scan_sessions          DISABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks            DISABLE ROW LEVEL SECURITY;
ALTER TABLE document_vault_shares      DISABLE ROW LEVEL SECURITY;
ALTER TABLE documents                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE draft_versions             DISABLE ROW LEVEL SECURITY;
ALTER TABLE event_cache                DISABLE ROW LEVEL SECURITY;
ALTER TABLE firm_master_checklists     DISABLE ROW LEVEL SECURITY;
ALTER TABLE handoff_notes              DISABLE ROW LEVEL SECURITY;
ALTER TABLE invoices                   DISABLE ROW LEVEL SECURITY;
ALTER TABLE ip_assets                  DISABLE ROW LEVEL SECURITY;
ALTER TABLE judicial_officers          DISABLE ROW LEVEL SECURITY;
ALTER TABLE letterheads                DISABLE ROW LEVEL SECURITY;
ALTER TABLE lpms_audit                 DISABLE ROW LEVEL SECURITY;
ALTER TABLE lpms_cases                 DISABLE ROW LEVEL SECURITY;
ALTER TABLE lpms_clients               DISABLE ROW LEVEL SECURITY;
ALTER TABLE lpms_comms                 DISABLE ROW LEVEL SECURITY;
ALTER TABLE lpms_current               DISABLE ROW LEVEL SECURITY;
ALTER TABLE lpms_events                DISABLE ROW LEVEL SECURITY;
ALTER TABLE lpms_firms                 DISABLE ROW LEVEL SECURITY;
ALTER TABLE lpms_followups             DISABLE ROW LEVEL SECURITY;
ALTER TABLE lpms_hearings              DISABLE ROW LEVEL SECURITY;
ALTER TABLE lpms_members               DISABLE ROW LEVEL SECURITY;
ALTER TABLE lpms_mfa                   DISABLE ROW LEVEL SECURITY;
ALTER TABLE lpms_notes                 DISABLE ROW LEVEL SECURITY;
ALTER TABLE lpms_notifications         DISABLE ROW LEVEL SECURITY;
ALTER TABLE lpms_outbox                DISABLE ROW LEVEL SECURITY;
ALTER TABLE lpms_parties               DISABLE ROW LEVEL SECURITY;
ALTER TABLE lpms_proceedings           DISABLE ROW LEVEL SECURITY;
ALTER TABLE lpms_reminder_runs         DISABLE ROW LEVEL SECURITY;
ALTER TABLE lpms_rti                   DISABLE ROW LEVEL SECURITY;
ALTER TABLE lpms_rti_events            DISABLE ROW LEVEL SECURITY;
ALTER TABLE lpms_timeline              DISABLE ROW LEVEL SECURITY;
ALTER TABLE matter_activity            DISABLE ROW LEVEL SECURITY;
ALTER TABLE phone_otps                 DISABLE ROW LEVEL SECURITY;
ALTER TABLE revoked_tokens             DISABLE ROW LEVEL SECURITY;
ALTER TABLE supreme_court_roster       DISABLE ROW LEVEL SECURITY;
ALTER TABLE tasks                      DISABLE ROW LEVEL SECURITY;
ALTER TABLE tasks_matter               DISABLE ROW LEVEL SECURITY;
ALTER TABLE team_members               DISABLE ROW LEVEL SECURITY;
ALTER TABLE teams                      DISABLE ROW LEVEL SECURITY;
ALTER TABLE tracked_cases              DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_flags                 DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_notification_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE users                      DISABLE ROW LEVEL SECURITY;
ALTER TABLE vault_audit                DISABLE ROW LEVEL SECURITY;
ALTER TABLE vault_folders              DISABLE ROW LEVEL SECURITY;
ALTER TABLE vault_provenance           DISABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members          DISABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces                 DISABLE ROW LEVEL SECURITY;
