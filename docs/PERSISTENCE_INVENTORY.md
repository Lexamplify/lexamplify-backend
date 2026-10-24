# Persistence Inventory

Read-only, source-backed inventory of backend persistence in this repository. No application code was imported or run, no server was started, no tests were run, and no external service was contacted. File sizes and row counts below are from local developer copies, **not production**. Local database copies were made outside the repository, opened read-only with `mode=ro`, queried only with `SELECT COUNT(*)`, and deleted; see “Unverified” for confirmation and limits.

## Summary

| Data family | Where it lives | Survives a Render redeploy? | Local developer-copy size / rows (not production) | Main evidence |
|---|---|---|---|---|
| Accounts, cases, documents, court rosters, guided drafts, user flags, revoked JWTs, audit events, phone OTPs | Neon PostgreSQL through `DATABASE_URL`; SQLAlchemy models | Yes, independent of the Render filesystem | Production counts not measured. Local fallback `instance/database.db` is 151,552 B (`users` 44, `judicial_officers` 83, `supreme_court_roster` 19; other model tables 0) | `app.py:1294-1335`, `app.py:2257-2264`, `models/*.py` |
| Case Vault, folders, shares, provenance, matter/team, letterheads, saved drafts, chat/chunks | `lex_assistant.db` (SQLite) | Only if `PERSISTENT_DATA_DIR` is set to a surviving disk; otherwise no | 45,117,440 B; `case_vault` 913, `vault_folders` 10, `vault_provenance` 14, `matter_activity` 5, `deadlines` 1, `tasks_matter` 1, `handoff_notes` 1 | `app.py:54-102`, `app.py:134-402`, `app.py:2303-2550` |
| Document Hub metadata, queue, FTS index, paper files, bundles, scans | `lex_assistant.db` (SQLite) | Only with a surviving `PERSISTENT_DATA_DIR`; otherwise no | DMS application tables mostly 0; `dms_kv` 1; `dms_fts` 0; `dms_meta_fts` 0 | `utils/dms_index.py:48-145`, `utils/dms_files.py:30-191`, `routes/dms_routes.py:111-134` |
| Practice / LPMS | `lex_assistant.db` (SQLite) | Only with a surviving `PERSISTENT_DATA_DIR`; otherwise no | `lpms_firms` 20, `lpms_members` 20, `lpms_current` 2, `lpms_clients` 18, `lpms_cases` 18, `lpms_parties` 9, `lpms_timeline` 27, `lpms_audit` 79; other LPMS tables 0 | `utils/lpms_store.py:159-298`, `routes/lpms_routes.py:29-73` |
| Legacy clients, billing, team tasks, calendar, IP assets, cause-list cases | `instance/client_data.db` (SQLite) | Only through the `PERSISTENT_DATA_DIR` symlink; otherwise no | 86,016 B; `clients` 1, `time_entries` 1, `invoices` 1, `misc_forms` 40, `event_cache` 5; other tables 0 | `app.py:409-523`, `app.py:1479-1480`, `utils/tenancy.py:45-65` |
| Legacy SSO accounts | `lex_assistant.db` `users` table | Only with a surviving `PERSISTENT_DATA_DIR`; otherwise no | `users` 10 | `routes/sso_routes.py:26`, `routes/sso_routes.py:70-99`, `routes/sso_routes.py:120-126` |
| Document Hub file store | `instance/dms_files`, or `PERSISTENT_DATA_DIR/dms_files`, or `DMS_STORAGE_DIR` | Only if on a persistent disk; existing files are not moved by the symlink | 0 files, 0 B | `utils/dms_store.py:35-42` |
| Document blobs when `DOC_STORAGE=disk` | `data/blobs`, or `PERSISTENT_DATA_DIR/blobs`, or `DOC_STORAGE_DIR` | Only if configured to a persistent path; default backend stores bytes in `case_vault.file_blob` | `data/blobs` missing locally | `utils/doc_storage.py:36-51`, `utils/doc_storage.py:96-126` |
| Uploaded document copies | `static/uploads` or `UPLOAD_FOLDER` | No by default | 148 files, 2,746,654 B | `app.py:1386`, `app.py:1479`, `routes/document_routes.py:377-383` |
| Local vector stores | `chroma_data` and `rag_server/chroma_db`, or `CHROMA_PATH` | No by default | `chroma_data`: 1 file, 262,144 B; `rag_server/chroma_db`: 5 files, 438,436 B | `utils/local_search.py:17`, `utils/local_search.py:53`, `rag_server/main.py:59`, `rag_server/main.py:253` |
| In-flight contract analyses | OS temporary directory `lexamplify_jobs` | No; files are also deleted by age | 167 files, 23,129,548 B | `utils/job_store.py:10-11`, `utils/job_store.py:68-80`, `routes/contract_routes.py:20-33` |
| Virtual Courtroom vault | CWD `vc_vault_data.json` | No | 2,777 B | `routes/argument_routes.py:298-322`, `routes/vault_workspace_routes.py:1602-1617` |
| Logs and batch-failure files | `logs/form_indexer.log`, `failed_batches.log`, `failed_normalization.log` | No | 1,875 B; 2,589,410 B; 386 B | `cron_form_indexer.py:37`, `cron_form_indexer.py:142-151`, `mass_ingestion.py:45-46`, `mass_ingestion.py:410` |
| Local-only SQLite artifacts | `instance/database.db`, `instance/x.db`, root `database.db` | Not production stores | 151,552 B; 114,688 B; 0 B | `app.py:1294`, `app.py:409`; no code reference found for `instance/x.db` |
| External services / stores | Neon, optional Redis/Celery, Pinecone, Chroma, Hugging Face model cache; public S3 dataset read-only in `worker.py` | Neon/Pinecone/S3 are external; Chroma and the HF cache are local and not covered by the Render disk | Names only; see section 7 | `app.py:1294`, `app.py:1465-1468`, `utils/local_search.py:17`, `worker.py:41-55,238-239`, Pinecone call sites |

**Counts are local only.** The row counts above and in section 2 come from local developer database copies. They are not production counts, and production may differ substantially. The temporary copies were deleted; `NO_INVENTORY_TEMP_DIRS` was confirmed after the run.

## 1. Persistent now: Neon/PostgreSQL

Production is intended to use Neon PostgreSQL through the environment variable `DATABASE_URL`. The application normalizes `postgres://` and `postgresql://` to the psycopg2 dialect and strips `channel_binding` before creating the SQLAlchemy engine (`app.py:1294-1302`). In production it refuses to start when `DATABASE_URL` is unset (`app.py:1364-1367`). The local fallback is `sqlite:///database.db` (`app.py:1294`); the local SQLAlchemy file is `instance/database.db` (151,552 B), not a production store.

`create_all()` runs after all model modules are imported (`app.py:2255-2264`). It creates only missing tables; it does not alter existing ones. The explicit post-create alterations found for this group are `users.phone` (`app.py:2269-2284`) and `users.phone_verified` (`app.py:2286-2295`). A one-time, idempotent copy of legacy SQLite users into the SQLAlchemy `User` table runs at startup (`app.py:2297-2301`, `services/legacy_user_migration.py:32-70`).

| Model | Table | Columns | Source |
|---|---|---|---|
| `User` | `users` | `id`, `name`, `email`, `password`, `phone`, `phone_verified`, `role`, `created_at` | `models/user.py:4-16` |
| `Case` | `cases` | `id`, `user_id`, `title`, `description`, `client_name`, `status`, `notes`, `created_at`, `updated_at` | `models/case.py:4-14` |
| `Document` | `documents` | `id`, `user_id`, `case_id`, `filename`, `filetype`, `summary`, `tags`, `created_at` | `models/document.py:4-14` |
| `JudicialOfficer` | `judicial_officers` | `id`, `district_key`, `hmj`, `designation`, `court_room`, `vc_link`, `vc_meeting_id`, `email_id`, `is_on_leave`, `updated_at` | `models/court_models.py:5-17` |
| `SupremeCourtRoster` | `supreme_court_roster` | `id`, `court_room`, `judges`, `vc_link`, `court_master_email`, `updated_at` | `models/court_models.py:37-45` |
| `DraftSession` | `draft_sessions` | `id`, `user_id`, `doc_type`, `title`, `case_ref`, `facts_json`, `step`, `status`, `created_at`, `updated_at` | `models/draft_session.py:5-18` |
| `DraftVersion` | `draft_versions` | `id`, `session_id`, `user_id`, `facts_hash`, `document_json`, `note`, `created_at` | `models/draft_session.py:21-31` |
| `UserFlag` | `user_flags` | `id`, `user_id`, `key`, `value` | `models/draft_session.py:34-42` |
| `RevokedToken` | `revoked_tokens` | `id`, `jti`, `expires_at`, `created_at` | `models/revoked_token.py:5-12` |
| `AuditEvent` | `audit_events` | `id`, `user_id`, `action`, `detail`, `ip`, `at` | `models/audit_event.py:5-14` |
| `PhoneOtp` | `phone_otps` | `id`, `phone`, `purpose`, `code_hash`, `attempts`, `consumed`, `created_at`, `expires_at` | `models/phone_otp.py:6-22` |

`PhoneOtp` is registered because `routes/auth_routes.py:49-50` imports it before `create_all()` runs. The `users` table here is the normal authentication table. It is separate from the legacy SQLite `users` table in `lex_assistant.db` used by the SSO callback; see section 2.6.

Local developer-copy counts for `instance/database.db` (SQLAlchemy fallback, not production): `users` 44, `judicial_officers` 83, `supreme_court_roster` 19, and 0 in `cases`, `documents`, `draft_sessions`, `draft_versions`, `user_flags`, `revoked_tokens`, `audit_events`, and `phone_otps`. Production row counts were not measured.

What is not in Neon: Case Vault documents and folders, vault sharing/provenance, matters/teams, letterheads/saved drafts, Document Hub metadata and queues, all Practice/LPMS data, legacy clients/billing/team/calendar/IP data, DMS files, uploads, Chroma, logs, and temporary contract jobs. Those are covered below.

## 2. SQLite files, schemas, owners, and local counts

### 2.1 SQLite files found locally

| File | Local bytes | Role | Evidence |
|---|---:|---|---|
| `lex_assistant.db` | 45,117,440 | Main raw-SQLite database: Case Vault, DMS, LPMS, legacy SSO users | `app.py:54-102`, `app.py:132`, `app.py:2307` |
| `lex_assistant.db-wal` | 0 | SQLite WAL sidecar beside the CWD path | Local file listing; DMS enables WAL at `utils/dms_index.py:210` |
| `lex_assistant.db-shm` | 32,768 | SQLite shared-memory sidecar beside the CWD path | Local file listing |
| `instance/client_data.db` | 86,016 | Legacy clients, billing, team, calendar, IP, form/event caches | `app.py:409-523` |
| `instance/database.db` | 151,552 | Local SQLAlchemy fallback (`sqlite:///database.db`), not production | `app.py:1294`, `app.py:2255-2264` |
| `instance/x.db` | 114,688 | Orphan/local copy with a `users` table; no code reference found | Local file listing; repository search found no reference |
| `database.db` (repository root) | 0 | Empty file; not the local SQLAlchemy database | Local file listing |

`lex_assistant.db` has 54 application tables (including two FTS5 virtual tables) plus SQLite's internal `sqlite_sequence` (`name`, `seq`). FTS5 also creates its own shadow tables (for example `dms_fts_data`, `dms_fts_idx`, `dms_fts_content`, `dms_fts_docsize`, `dms_fts_config`, and the `dms_meta_fts_*` equivalents); those are SQLite internals and are not separately counted here.

### 2.2 `lex_assistant.db`: Case Vault, Matter/Team, drafts, chat

| Table | Columns (DDL; runtime additions noted) | Local rows | Main owner / evidence |
|---|---|---:|---|
| `calendar_events` | `id`, `event_date`, `event_type`, `title`, `related_case_id`, `location`, `opposing_counsel`, `google_event_id`, `owner_user_id` | 0 | `app.py:139-148`, `app.py:2335-2339`, `routes/calendar_routes.py:45` |
| `case_vault` | `id`, `case_id`, `title`, `doc_type`, `content`, `created_at`, `folder_id`, `smart_title`, `tags`, `file_blob`, `file_format`, `user_id`, `link_shared`, `validity_status`, `ratio_headnote` | 913 | `app.py:150-157`, `app.py:169-200`, `app.py:2364-2390`, `app.py:1776`, `routes/document_routes.py:407` |
| `vault_folders` | `id`, `name`, `parent_id`, `user_id`, `created_at`, `protected`, `link_shared` | 10 | `app.py:161-167`, `app.py:191-199`, `app.py:2355-2390` |
| `document_vault_shares` | `id`, `node_type`, `node_id`, `team_member_id`, `permission`, `created_at` | 0 | `app.py:208-218`, `routes/vault_workspace_routes.py:1029` |
| `vault_audit` | `id`, `folder_id`, `vault_doc_id`, `session_title`, `messages_json`, `created_at` | 0 | `app.py:221-229`, `routes/vault_workspace_routes.py:1705` |
| `vault_provenance` | `id`, `node_type`, `node_id`, `node_name`, `action`, `actor_user_id`, `owner_user_id`, `detail`, `content_hash`, `created_at` | 14 | `app.py:242-253`, `app.py:980-1020` |
| `teams` | `id`, `name`, `description`, `is_private`, `owner_user_id`, `created_at` | 0 | `app.py:271-279`, `routes/matter_routes.py:69-116` |
| `team_memberships` | `id`, `team_id`, `user_id`, `role`, `created_at` | 0 | `app.py:281-289`, `routes/matter_routes.py:116-145` |
| `matters` | `id`, `title`, `status`, `team_id`, `lead_counsel`, `opened_date`, `owner_user_id`, `created_at` | 0 | `app.py:295-305`, `routes/matter_routes.py:160-230` |
| `deadlines` | `id`, `matter_id`, `title`, `date`, `description`, `ai_extracted`, `created_at` | 1 | `app.py:307-316`, `routes/matter_routes.py:303-350` |
| `tasks_matter` | `id`, `matter_id`, `title`, `done`, `created_at` | 1 | `app.py:320-326`, `routes/matter_routes.py:353-400` |
| `handoff_notes` | `id`, `matter_id`, `author_user_id`, `text`, `created_at` | 1 | `app.py:329-335`, `routes/matter_routes.py:422-480` |
| `matter_activity` | `id`, `matter_id`, `text`, `created_at` | 5 | `app.py:341-346`, `routes/matter_routes.py:504-530` |
| `letterheads` | `id`, `owner_user_id`, `name`, `tagline`, `address`, `contact`, `auto_detected`, `created_at` | 0 | `app.py:354-363`, `routes/letterhead_routes.py` |
| `saved_drafts` | `id`, `owner_user_id`, `title`, `raw_text`, `clauses_json`, `summary`, `created_at` | 0 | `app.py:372-380`, `routes/draft_engine_routes.py:347-384` |
| `document_chunks` | `id`, `user_id`, `case_id`, `document_id`, `chunk_index`, `chunk_text`, `embedding`, `created_at` | 0 | `app.py:383-392`, `utils/rag_pipeline.py:146-160`, `routes/document_routes.py:512` |
| `chat_history` | `id`, `user_id`, `user_message`, `bot_response`, `created_at` | 0 | `app.py:395-401`, `routes/ai_routes.py:20-27`, `routes/ai_routes.py:146-160` |

`case_vault` is the main document store: 913 local rows, with `file_blob` defined as SQLite `BLOB` (`app.py:170`, `app.py:1776`). It also carries the Firm Library columns `validity_status` and `ratio_headnote` (`app.py:2364-2378`). The 45 MB local database size is consistent with storing document bytes directly in this table; no row contents were read.

Local-only note: `python app.py` calls `init_db()` (`app.py:2765-2767`), and that function starts with `DROP TABLE IF EXISTS calendar_events` (`app.py:137`). Gunicorn uses `create_app()` and does not call `init_db()`; this is a local-development path, not the production path.

### 2.3 `lex_assistant.db`: Document Hub / DMS

DMS tables are created by `utils/dms_index.py:48-145` and `utils/dms_files.py:30-191`; the routes are mounted at `/api/dms` (`routes/dms_routes.py:111`) and `/api/dms/files/*` (`routes/dms_files.py:1-12`, `routes/dms_files.py:26-39`, `routes/dms_files.py:61-70`). All DMS application tables are empty in the local copy except `dms_kv` (1 row of DMS key/value metadata). The shared `vault_provenance` table is listed in 2.2.

| Table | Columns | Local rows | Source |
|---|---|---|---|
| `dms_docs` | `doc_id`, `sha256`, `store_key`, `enc`, `size`, `mime`, `ext`, `kind`, `original_name`, `rel_path`, `status`, `status_note`, `warnings`, `page_count`, `page_kind`, `method`, `ocr_pages`, `ocr_conf`, `doc_class`, `class_conf`, `class_src`, `class_evidence`, `review`, `meta`, `doc_date`, `next_hearing`, `parties`, `court`, `case_keys`, `text_hash`, `group_id`, `version`, `is_current`, `version_note`, `batch_id`, `uploaded_by`, `tags`, `legal_hold`, `deleted_at`, `deleted_by`, `created_at`, `updated_at`, `processed_at` | 0 | `utils/dms_index.py:49-93` |
| `dms_pages` | `doc_id`, `page_no`, `text`, `keys` | 0 | `utils/dms_index.py:105-111` |
| `dms_jobs` | `id`, `doc_id`, `kind`, `status`, `attempts`, `run_after`, `locked_by`, `locked_at`, `error`, `created_at`, `finished_at` | 0 | `utils/dms_index.py:113-125` |
| `dms_kv` | `k`, `v` | 1 | `utils/dms_index.py:129` |
| `dms_locations` | `id`, `scope`, `parent_id`, `name`, `kind`, `code`, `notes`, `archived`, `created_by`, `created_at` | 0 | `utils/dms_files.py:31-42` |
| `dms_pfiles` | `id`, `scope`, `seq`, `file_no`, `token`, `title`, `kind`, `case_ref`, `case_label`, `client`, `location_id`, `location_note`, `status`, `holder`, `holder_user_id`, `issued_at`, `due_at`, `pages_est`, `notes`, `created_by`, `created_at`, `updated_at`, `archived_at` | 0 | `utils/dms_files.py:45-70` |
| `dms_pfile_moves` | `id`, `pfile_id`, `action`, `actor_id`, `actor_name`, `from_holder`, `to_holder`, `from_loc`, `to_loc`, `due_at`, `note`, `at` | 0 | `utils/dms_files.py:76-89` |
| `dms_pfile_docs` | `pfile_id`, `doc_id`, `linked_by`, `linked_at` | 0 | `utils/dms_files.py:92-98` |
| `dms_filing` | `doc_id`, `owner_id`, `state`, `top_ref`, `top_score`, `candidates`, `note`, `sig`, `evaluated_at`, `decided_by`, `decided_at`, `filed_ref`, `prev_ref`, `via` | 0 | `utils/dms_files.py:101-116` |
| `dms_file_prefs` | `user_id`, `auto_file` | 0 | `utils/dms_files.py:119-122` |
| `dms_bundles` | `id`, `scope`, `owner_id`, `title`, `case_ref`, `options`, `status`, `build_state`, `build_note`, `progress`, `built_at`, `built_pages`, `built_size`, `built_sha`, `built_key`, `built_enc`, `built_warnings`, `built_fp`, `saved_doc_id`, `created_at`, `updated_at` | 0 | `utils/dms_files.py:124-146` |
| `dms_bundle_items` | `id`, `bundle_id`, `seq`, `kind`, `doc_id`, `title`, `label`, `pages`, `note`, `in_index` | 0 | `utils/dms_files.py:149-160` |
| `dms_scan_sessions` | `id`, `scope`, `owner_id`, `status`, `state`, `created_at`, `updated_at` | 0 | `utils/dms_files.py:164-172` |
| `dms_scan_pages` | `id`, `session_id`, `seq`, `src_name`, `src_kind`, `status`, `error`, `w`, `h`, `text`, `info`, `created_at` | 0 | `utils/dms_files.py:175-188` |
| `dms_fts` | virtual FTS5 columns `text`, `keys`; external content from `dms_pages`, `content_rowid='rowid'` | 0 | `utils/dms_index.py:159-181` |
| `dms_meta_fts` | virtual FTS5 columns `title`, `refs`, `parties`, `court`, `cls` | 0 | `utils/dms_index.py:171-173` |

The FTS tables are kept in sync by SQLite triggers on `dms_pages` (`utils/dms_index.py:184-195`), and a trigger on `case_vault` deletes DMS rows when a vault row is deleted (`utils/dms_index.py:197-204`, `utils/dms_files.py:193-196`). These are SQLite-only mechanisms.

### 2.4 `lex_assistant.db`: Practice / LPMS

LPMS tables are created by `utils/lpms_store.py:159-298` and served under `/api/practice` (`routes/lpms_routes.py:29-73`). Local counts show a populated developer practice; they are not production counts.

| Table | Columns | Local rows |
|---|---|---:|
| `lpms_firms` | `id`, `name`, `owner_user_id`, `settings`, `created_at` | 20 |
| `lpms_members` | `id`, `firm_id`, `user_id`, `role`, `name`, `email`, `phone`, `active`, `email_notify`, `managed`, `created_by`, `created_at`, `last_seen` | 20 |
| `lpms_current` | `user_id`, `member_id` | 2 |
| `lpms_clients` | `id`, `firm_id`, `name`, `phone`, `email`, `address`, `id_type`, `id_number`, `occupation`, `comm_pref`, `notes`, `archived`, `created_by`, `created_at`, `updated_at` | 18 |
| `lpms_cases` | `id`, `firm_id`, `case_no`, `case_key`, `court`, `title`, `category`, `case_type`, `filing_date`, `reg_no`, `hall_no`, `judge`, `opposite_party`, `client_id`, `advocate_id`, `priority`, `status`, `next_action`, `next_action_due`, `remarks`, `restricted`, `outcome`, `closed_at`, `archived_at`, `created_by`, `created_at`, `updated_at` | 18 |
| `lpms_parties` | `id`, `case_id`, `role`, `name`, `contact`, `notes`, `created_at` | 9 |
| `lpms_hearings` | `id`, `firm_id`, `case_id`, `hearing_date`, `hearing_time`, `court`, `hall_no`, `judge`, `purpose`, `serial_no`, `advocate_id`, `status`, `note`, `created_by`, `created_at`, `updated_at` | 0 |
| `lpms_proceedings` | `id`, `firm_id`, `case_id`, `hearing_id`, `proc_date`, `outcome`, `notes`, `observations`, `orders`, `next_date`, `next_purpose`, `author_id`, `created_at`, `edited_at` | 0 |
| `lpms_timeline` | `id`, `firm_id`, `case_id`, `kind`, `title`, `detail`, `actor_id`, `ref_id`, `at` | 27 |
| `lpms_notes` | `id`, `firm_id`, `case_id`, `client_id`, `author_id`, `body`, `pinned`, `created_at`, `edited_at` | 0 |
| `lpms_comms` | `id`, `firm_id`, `case_id`, `client_id`, `channel`, `direction`, `subject`, `body`, `status`, `to_addr`, `created_by`, `created_at` | 0 |
| `lpms_followups` | `id`, `firm_id`, `client_id`, `case_id`, `due_date`, `note`, `channel`, `assignee_id`, `status`, `created_by`, `created_at`, `done_at` | 0 |
| `lpms_rti` | `id`, `firm_id`, `case_id`, `client_id`, `subject`, `department`, `pio`, `reference_no`, `filing_date`, `mode`, `fee`, `response_due`, `response_date`, `appeal_due`, `appeal1_date`, `appeal2_due`, `appeal2_date`, `status`, `outcome`, `assignee_id`, `notes`, `created_by`, `created_at`, `updated_at` | 0 |
| `lpms_rti_events` | `id`, `rti_id`, `kind`, `note`, `actor_id`, `at` | 0 |
| `lpms_events` | `id`, `firm_id`, `kind`, `title`, `start_date`, `end_date`, `start_time`, `end_time`, `location`, `notes`, `case_id`, `client_id`, `member_id`, `created_by`, `created_at` | 0 |
| `lpms_notifications` | `id`, `firm_id`, `user_id`, `kind`, `title`, `body`, `link`, `case_id`, `dedupe_key`, `created_at`, `read_at` | 0 |
| `lpms_outbox` | `id`, `firm_id`, `to_user_id`, `to_name`, `to_email`, `subject`, `body`, `kind`, `dedupe_key`, `status`, `attempts`, `error`, `created_at`, `sent_at` | 0 |
| `lpms_audit` | `id`, `firm_id`, `user_id`, `actor`, `action`, `entity`, `entity_id`, `summary`, `detail`, `ip`, `at`, `prev_hash`, `hash` | 79 |
| `lpms_mfa` | `user_id`, `secret`, `enabled`, `last_step`, `recovery`, `failures`, `locked_until`, `created_at`, `enabled_at` | 0 |
| `lpms_reminder_runs` | `firm_id`, `ran_at`, `summary` | 0 |

LPMS uses `INTEGER PRIMARY KEY` (implicit SQLite rowid) rather than `AUTOINCREMENT`, plus partial unique indexes such as `lpms_members_firm_user_active ... WHERE active = 1` and `lpms_notif_dedupe ... WHERE dedupe_key IS NOT NULL` (`utils/lpms_store.py:164-172`, `utils/lpms_store.py:266-272`). It deliberately disables foreign-key enforcement on its connections (`utils/lpms_store.py:152-155`).

### 2.5 `instance/client_data.db`: legacy application tables

Created by `init_sqlite_db()` at `app.py:409-523`. The `owner_user_id` column is added at runtime by `utils/tenancy.py:45-65` to the legacy owned tables; it is not in the original `CREATE TABLE` text. Local counts are developer-copy only.

| Table | Columns | Local rows | Main routes / evidence |
|---|---|---:|---|
| `tracked_cases` | `id`, `case_name`, `case_number`, `cnr_number`, `court`, `client_name`, `case_type`, `next_hearing`, `last_hearing`, `status`, `notes`, `created_at`, `cnr`, `title`, `next_hearing_date`, `owner_user_id` | 0 | `app.py:415-431`; `routes/causelist_routes.py:128-219`; `routes/client_routes.py` |
| `clients` | `id`, `name`, `phone`, `email`, `address`, `client_type`, `notes`, `created_at`, `contact`, `company`, `owner_user_id` | 1 | `app.py:432-443`; `routes/client_routes.py:30-118` |
| `time_entries` | `id`, `client_id`, `case_id`, `date`, `hours`, `rate`, `description`, `created_at`, `owner_user_id` | 1 | `app.py:457-466`; `routes/billing_routes.py:42-78` |
| `invoices` | `id`, `client_id`, `invoice_number`, `amount`, `gst`, `total`, `status`, `due_date`, `paid_date`, `notes`, `created_at`, `owner_user_id` | 1 | `app.py:467-479`; `routes/billing_routes.py:87-170` |
| `ip_assets` | `id`, `ip_type`, `title`, `registration_number`, `filing_date`, `renewal_due`, `status`, `notes`, `created_at`, `owner_user_id` | 0 | `app.py:480-490`; `routes/causelist_routes.py:274-334` |
| `team_members` | `id`, `name`, `email`, `role`, `created_at`, `user_id`, `owner_user_id` | 0 | `app.py:491-510`; `routes/team_routes.py:67-108` |
| `tasks` | `id`, `title`, `assigned_to`, `case_id`, `due_date`, `priority`, `status`, `notes`, `created_at`, `owner_user_id` | 0 | `app.py:511-521`; `routes/team_routes.py:120-217` |
| `misc_forms` | `id`, `name`, `url`, `category`, `court`, `created_at`, `updated_at` | 40 | `cron_form_indexer.py:128-138`, `cron_form_indexer.py:204-215` |
| `event_cache` | `event_id`, `title`, `description`, `event_date`, `venue`, `organizer`, `register_url`, `raw_content`, `source_url`, `cached_at` | 5 | `routes/court_routes.py:25-38`, `routes/court_routes.py:1134-1175` |

`misc_forms` and `event_cache` are caches/regenerable data, not user-authored records. `tracked_cases`, `clients`, `time_entries`, `invoices`, `ip_assets`, `team_members`, and `tasks` are user data. `instance/client_data.db` also has SQLite's internal `sqlite_sequence` (6 local rows), and `instance/database.db` / `instance/x.db` each have the SQLAlchemy model tables plus `sqlite_sequence`.

### 2.6 Legacy SQLite `users` and local-only files

The SSO callback creates and reads its own SQLite `users` table at `lex_assistant.db` (`routes/sso_routes.py:26`, `routes/sso_routes.py:70-99`). It issues JWTs with that SQLite row id (`routes/sso_routes.py:120-126`). Normal authentication uses the SQLAlchemy `User` table in Neon. The startup migration copies legacy SQLite users into Neon once (`services/legacy_user_migration.py:32-70`), but a user created by SSO after startup is only in SQLite until a later restart/migration. This is the split-brain described in section 8.

Local-only files:

| File / table | Local rows / bytes | Status |
|---|---:|---|
| `lex_assistant.db` `users` | Columns: `id`, `email`, `password`, `name`, `created_at`, `sso_provider`; 10 rows | Legacy SSO table, separate from the Neon `users` table; DDL at `routes/sso_routes.py:74-85` |
| `instance/database.db` | 151,552 B; `users` 44, `judicial_officers` 83, `supreme_court_roster` 19, other model tables 0 | Local SQLAlchemy fallback, not production |
| `instance/x.db` | 114,688 B; `users` 10; other model tables 0 | No code reference found; origin not verified |
| `database.db` (root) | 0 B | Empty artifact; not the SQLAlchemy database |
| `conflict_clearance_memos` | Columns: `id`, `ref_id`, `target_entity`, `opposing_party`, `matter_type`, `generated_at`, `memo_text`; table absent in the local `lex_assistant.db` | DDL and insert exist at `routes/conflict_routes.py:945-965`; it is created lazily on first memo write |

## 3. SQLite portability inventory

The application uses raw `sqlite3` extensively, not only SQLAlchemy. The following SQLite-specific constructs were re-checked in source. They matter because moving the SQLite data to PostgreSQL would require changing both SQL text and connection code, not just copying rows.

| SQLite feature | Evidence (`file:line`) | Why it is not a straight PostgreSQL move |
|---|---|---|
| `AUTOINCREMENT` and `sqlite_sequence` | `app.py:140`, `app.py:151`, `app.py:210`, `app.py:243`, `app.py:272`, `app.py:296`, `app.py:308`, `app.py:321`, `app.py:330`, `app.py:342`, `app.py:355`, `utils/dms_index.py:114`, `utils/dms_files.py:77`, `routes/conflict_routes.py:946`, `cron_form_indexer.py:129` | PostgreSQL uses identity/serial columns; `sqlite_sequence` has no equivalent. Local `lex_assistant.db` has 14 `sqlite_sequence` rows. |
| WAL and connection PRAGMAs | `utils/dms_index.py:43`, `utils/dms_index.py:210`, `routes/court_routes.py:947`, `cron_form_indexer.py:192-193`, `mass_ingestion.py:515`, `utils/lpms_store.py:154`, `utils/dms_files.py:202`, `utils/tenancy.py:48` | `journal_mode=WAL`, `busy_timeout`, `foreign_keys=OFF`, and `table_info` are SQLite connection/file settings. PostgreSQL has MVCC, different FK semantics, and catalog views. |
| FTS5 virtual tables, external content, triggers, `MATCH`, `bm25`, `snippet` | `utils/dms_index.py:159-181`, `utils/dms_index.py:184-195`, `utils/dms_index.py:578-580`, `utils/dms_index.py:712-734`, `utils/dms_index.py:754-773` | PostgreSQL has no FTS5. Search, ranking, highlighting, and the insert/delete/update triggers need a `tsvector`/GIN or external-search redesign. |
| `INSERT OR REPLACE` | `routes/court_routes.py:1171`, `utils/dms_index.py:174` | PostgreSQL uses `INSERT ... ON CONFLICT ... DO UPDATE`; `OR REPLACE` can also change delete/insert side effects. |
| `INSERT OR IGNORE` | `routes/dms_f_paper.py:208`, `routes/dms_f_scan.py:595`, `utils/dms_index.py:402-403`, `utils/dms_index.py:598`, `utils/lpms_store.py:450`, `utils/lpms_store.py:459`, `utils/lpms_store.py:593` | PostgreSQL needs `ON CONFLICT DO NOTHING`; `rowcount`/last-insert semantics differ. |
| `ON CONFLICT ... DO UPDATE` / `excluded` | `routes/dms_f_filing.py:64`, `routes/dms_f_filing.py:214`, `routes/dms_f_filing.py:268`, `routes/draft_engine_routes.py:384`, `routes/vault_workspace_routes.py:1029`, `utils/lpms_store.py:344`, `utils/lpms_store.py:681` | Mostly portable in shape, but depends on SQLite unique/partial indexes and `?` binding; each statement needs review. |
| `rowid` and FTS `content_rowid` | `utils/dms_index.py:169-170`, `utils/dms_index.py:186-193`, `utils/dms_index.py:578`, `utils/dms_index.py:718` | PostgreSQL has no implicit `rowid`; use primary keys and explicit ordering. |
| SQLite date/time functions | `routes/court_routes.py:1141`, `routes/court_routes.py:1174`, `routes/dms_f_filing.py:35`, `routes/dms_f_filing.py:163`, `routes/dms_routes.py:308`, `routes/dms_routes.py:320`, `utils/dms_paper.py:443`, `routes/matter_routes.py:213`, `routes/lpms_core.py:502-505`, `utils/lpms_reports.py:61`, `utils/lpms_reports.py:344`, `utils/lpms_reports.py:373` | `datetime('now')`, `date('now')`, `date(:today, '+3 day')`, and `date(column)` are SQLite expressions. PostgreSQL needs `now()`, `CURRENT_DATE`, `date + interval`, and explicit casts. |
| `?` positional placeholders | `app.py:1038`, `utils/dms_index.py:156`, `utils/dms_index.py:578`, `utils/lpms_store.py:344`, and throughout the raw-SQL routes | PostgreSQL drivers use `%s` (or SQLAlchemy bound parameters); every raw statement and parameter tuple needs conversion. |
| `BLOB` / raw bytes in a row | `app.py:170`, `app.py:1776`, `app.py:1856`, `utils/doc_storage.py:96-126` | PostgreSQL `bytea` or an object store; a 45 MB local SQLite file with 913 vault rows is a warning that row size and backup behavior must be checked. |
| `GLOB` | No `GLOB` use found in repository Python source | No direct blocker found, but `LIKE`, `COLLATE NOCASE`, and case-folding behavior still need review. |
| `executescript` for multi-statement DDL | `utils/dms_index.py:211`, `utils/dms_files.py:201`, `utils/lpms_store.py:302`, `routes/court_routes.py:952`, `cron_form_indexer.py:184` | PostgreSQL drivers generally execute one statement at a time; the schema bootstrap must become a migration. |
| `sqlite_master` introspection | `app.py:1084`, `routes/vault_workspace_routes.py:58`, `utils/dms_index.py:156` | Replace with `information_schema`/`pg_catalog` queries. |
| `row_factory = sqlite3.Row` and tuple/name access | `app.py:108-119`, `app.py:1584-1585`, `utils/dms_index.py:42`, `routes/court_routes.py:946` | Raw sqlite3 row objects are not psycopg rows; every raw query path needs a DB-API or SQLAlchemy adaptation. |
| SQLite JSON1 table-valued functions | `app.py:1038`, `app.py:1051`, `app.py:1543-1544`, `app.py:1589`, `app.py:1626-1627`, `app.py:2018-2019` | `json_each`, `json_extract`, and `json_valid` need PostgreSQL `jsonb`/`jsonb_array_elements` equivalents, and the stored JSON text must remain valid. |
| `cursor.lastrowid` | `app.py:1781`, `app.py:2136`, `routes/conflict_routes.py:964`, `routes/billing_routes.py:62`, `routes/causelist_routes.py:148`, `routes/dms_routes.py:493`, `routes/lpms_cases.py:148`, `routes/lpms_more.py:94` | PostgreSQL needs `RETURNING id`; last-row-id is connection/statement-specific. |
| `connection.total_changes` | `routes/billing_routes.py:151`, `routes/causelist_routes.py:192`, `routes/causelist_routes.py:204`, `routes/client_routes.py:105`, `routes/team_routes.py:108` | PostgreSQL cursor `rowcount` is not a drop-in replacement for SQLite's connection-wide change counter. |
| `BEGIN IMMEDIATE` queue claim | `utils/dms_worker.py:60-64` | SQLite's write-lock transaction serializes the DMS queue claim. PostgreSQL would need a different claim (for example `FOR UPDATE SKIP LOCKED`) or an external queue. |
| `COLLATE NOCASE` | `utils/lpms_store.py:337`, `utils/lpms_store.py:350` | SQLite's `NOCASE` is ASCII-only and not the same as PostgreSQL collations; ordering and uniqueness can change. |

The most coupled areas are DMS search (`FTS5` plus triggers), LPMS upserts/partial indexes and date filtering, the DMS queue claim (`BEGIN IMMEDIATE`), and the raw-SQL routes that use `?`, `lastrowid`, `total_changes`, and `sqlite3.Row`. A copy of tables alone would not preserve behavior.

## 4. Runtime filesystem writes

These are writes outside the SQLAlchemy/Neon path. Sizes and file counts are from the local working copy only.

| Path / area | Writer and purpose | Local size / count | Persistence status |
|---|---|---:|---|
| `static/uploads` (or `UPLOAD_FOLDER`) | `POST /api/documents/upload` saves the uploaded bytes, then inserts extracted text into `case_vault` (`routes/document_routes.py:346-383`, `routes/document_routes.py:407-412`). The saved filename is not stored in that insert. | 148 files, 2,746,654 B | Not covered by `PERSISTENT_DATA_DIR`; lost on redeploy unless `UPLOAD_FOLDER` points at a disk. Extracted text remains in `case_vault`; the original file copy may be orphaned. |
| `instance/dms_files` (default) / `PERSISTENT_DATA_DIR/dms_files` / `DMS_STORAGE_DIR` | Content-addressed Document Hub file store; `storage_root()` chooses the path (`utils/dms_store.py:35-42`). Bundles and zip downloads use `<root>/_incoming` (`routes/dms_f_bundles.py:468-470`, `routes/dms_routes.py:1167-1169`); scan pages use `<root>/_scan` (`utils/dms_scan.py:70-80`). | 0 files, 0 B | Automatically under `PERSISTENT_DATA_DIR` when that variable is set and `DMS_STORAGE_DIR` is not; existing files in `instance/dms_files` are not moved by the DB symlink. |
| `data/blobs` (default) / `PERSISTENT_DATA_DIR/blobs` / `DOC_STORAGE_DIR` | Only when `DOC_STORAGE=disk`; `doc_storage.store()` writes `YYYY/MM/<uuid>.<ext>` and puts a reference marker in `case_vault.file_blob` (`utils/doc_storage.py:36-51`, `utils/doc_storage.py:96-126`). The default backend is `sqlite`, which stores bytes in the row. | `data/blobs` missing locally | Not covered unless explicitly configured; a lost blob file leaves an unresolvable marker, and `resolve()` returns `None` (`utils/doc_storage.py:129-150`). |
| `data/cases` | Source directory for the batch ingestion script, not a Flask request path (`mass_ingestion.py:41`, `mass_ingestion.py:512`). | 6 files, 600,008 B | Not a runtime database; if used on a host, it is still local and not covered by `PERSISTENT_DATA_DIR`. |
| `failed_batches.log`, `failed_normalization.log` | Batch ingestion appends failures at repository root (`mass_ingestion.py:45-46`, `mass_ingestion.py:268`, `mass_ingestion.py:410`). | 2,589,410 B; 386 B | Not covered; may contain case/document text or identifiers depending on the failure. |
| `chroma_data` | `utils/local_search.py` uses `CHROMA_PATH` default `chroma_data` and `chromadb.PersistentClient(path=CHROMA_PATH)` (`utils/local_search.py:17`, `utils/local_search.py:53`). Vector search is off unless `LOCAL_VECTOR_SEARCH=1` (`utils/local_search.py:21-25`). | 1 file, 262,144 B (`chroma.sqlite3`) | Not covered by `PERSISTENT_DATA_DIR`; only covered if `CHROMA_PATH` is explicitly put on a disk. |
| `rag_server/chroma_db` | Separate RAG server hard-codes `CHROMA_DIR = .../rag_server/chroma_db` and opens `PersistentClient(path=str(CHROMA_DIR))` (`rag_server/main.py:59`, `rag_server/main.py:253`). | 5 files, 438,436 B | Not covered by `PERSISTENT_DATA_DIR`; whether this service is deployed was not verified. |
| `logs/form_indexer.log` | `cron_form_indexer.py` writes a fixed log under `logs/` (`cron_form_indexer.py:37`, `cron_form_indexer.py:142-151`). | 1 file, 1,875 B | Not covered; cron-only, non-user data. |
| OS temp `lexamplify_jobs` | Contract-analysis job JSON; `JOB_DIR = tempfile.gettempdir()/lexamplify_jobs` (`utils/job_store.py:10-11`), atomic writes at `utils/job_store.py:25-34`, age cleanup at `utils/job_store.py:68-80`. The code comments say these files hold contract text (`utils/job_store.py:68-69`). | 167 files, 23,129,548 B | Not covered by `PERSISTENT_DATA_DIR`; lost on restart; 6-hour age cleanup is best-effort, not a shutdown hook. |
| CWD `vc_vault_data.json` | Virtual Courtroom sessions are read-modify-written as one global JSON object (`routes/argument_routes.py:298-322`, `routes/vault_workspace_routes.py:1602-1617`). Both API paths are behind the app-wide sign-in gate (`app.py:2553-2570`), but the file has no per-user partition. | 2,777 B | Not covered; lost on redeploy; not in SQL. |
| Hugging Face / SentenceTransformers cache | `SentenceTransformerEmbeddingFunction(model_name="sentence-transformers/all-MiniLM-L6-v2")` is created in `utils/local_search.py:36-39`; the RAG server also uses a local sentence-transformer (`rag_server/main.py:25`). No `HF_HOME`, `TRANSFORMERS_CACHE`, or `SENTENCE_TRANSFORMERS_HOME` setting was found. | Not measured | Default user cache, outside the repository and outside `PERSISTENT_DATA_DIR`; redownloaded after a restart. |
| Bundle working directories | `utils/dms_bundle.py` defaults to `tempfile.mkdtemp(prefix="bundle_")` when no workdir is supplied (`utils/dms_bundle.py:390-391`); the route supplies `_incoming` for the final PDF (`routes/dms_f_bundles.py:468-470`). | Not measured | OS temp working files are ephemeral; final bundle is committed into the DMS store. |
| `case_vault.file_blob` (not a filesystem path by default) | `doc_storage.store()` returns raw bytes for the default `sqlite` backend, and the vault insert stores them in `file_blob` (`app.py:1776`, `utils/doc_storage.py:96-126`). | Part of the 45,117,440 B `lex_assistant.db`; 913 vault rows | Survives only as part of the SQLite database; if `DOC_STORAGE=disk`, the bytes move to the configured blob directory. |

## 5. In-memory and process state

The default Gunicorn configuration is one process with six threads (`gunicorn.conf.py:12-17`). `WEB_CONCURRENCY` can raise the process count, and several features are process-local. The following were re-checked in source.

| State | Evidence | Effect with more than one worker / process |
|---|---|---|
| Flask-Limiter counters | `utils/limiter.py:9` creates `Limiter(...)` with no `storage_uri`; `app.py:1473-1474` initializes it. Flask-Limiter's default in-process memory backend applies. | Each worker has its own counters; a client can exceed the intended rate by spreading requests across workers. DMS/LPMS limits at `app.py:1500-1501` and `app.py:1521-1522` are also per process. |
| LPMS reminder scheduler | `routes/lpms_routes.py:70-73` creates and starts `L.Scheduler` unless `LPMS_SCHEDULER=0`; the thread loop is `utils/lpms_store.py:1009-1022`; each sweep uses `BEGIN IMMEDIATE` (`utils/lpms_store.py:989-1007`). | One scheduler thread starts per process. Database serialization and reminder/outbox dedupe reduce duplicate sends, but the duplicate sweep work still exists and the exact suppression behavior was not runtime-tested. |
| DMS extraction workers | `routes/dms_routes.py:131-134` starts `W.Worker` unless `DMS_WORKERS=0`; default is 2 (`routes/dms_routes.py:133`); thread start is `utils/dms_worker.py:409-419`; queue claim is `BEGIN IMMEDIATE` (`utils/dms_worker.py:60-64`). | Each process starts its own 2 extraction threads plus heartbeat. The queue claim is DB-serialized, so duplicate claims are avoided, but memory/CPU use multiplies and SQLite write contention rises. |
| DMS scan workers | `utils/dms_scan.py:675-687`; default `DMS_SCAN_WORKERS` is 2. | Same multiplication/contention pattern. |
| Contract `LOCAL_JOBS` | `routes/contract_routes.py:20`; job start/registration at `routes/contract_routes.py:568-591`; cleanup at `routes/contract_routes.py:610-613`. | Per-process dict, but the authoritative state is the JSON file (`utils/job_store.py:41-55`). The dict is a cache, not the durable store. |
| Contract `_LIVE_JOBS` | `routes/contract_routes.py:33`; used for the per-user active count at `routes/contract_routes.py:568-574` and restart detection at `routes/contract_routes.py:59-66`. | Per-process. `ANALYSIS_MAX_ACTIVE_PER_USER` is therefore per worker, not global. A job running in worker A is not in worker B's `_LIVE_JOBS`; B relies on `worker_pid` and the heartbeat instead. |
| Contract job file updates | `utils/job_store.py:13` (`threading.RLock()`), `utils/job_store.py:25-34` (atomic replace), `utils/job_store.py:58-65` (read-modify-write). | The lock is process-local. Two workers updating the same job can lose fields because the read and replace are not one cross-process transaction. |
| Contract SSE streams | `routes/contract_routes.py:645-722`; each stream holds a request thread and stops after `STREAM_MAX_SECONDS` (`routes/contract_routes.py:28`, `routes/contract_routes.py:662-663`). | With six threads, concurrent long streams can occupy all request threads. This is capacity, not durable state. |
| Neon keepalive thread | `app.py:2226-2247`; starts only for PostgreSQL and `DB_KEEPALIVE!=0`. | One daemon thread per process; duplicate `SELECT 1` traffic, no data-loss effect. |
| DMS member cache | `app.py:1065` (`_DMS_MEMBER_CACHE`), read/written at `app.py:1137-1144`; short-lived per-process cache. | A stale cache in one worker can briefly show different share/team visibility. |
| Legacy owner cache | `utils/tenancy.py:23` (`_legacy_cache`), refreshed for 60 seconds. | Per-process; legacy unowned rows may be claimed/read differently for up to a minute after a change. |
| Local vector search globals | `utils/local_search.py:28-30` (`_lock`, `_collection`, `_embedder`), `utils/local_search.py:33-53`. | Each process loads its own model/collection. With vector search enabled, memory use multiplies; the on-disk Chroma directory is shared only if all processes point at the same path. |
| RAG server collection global | `rag_server/main.py:73` (`_collection = None`), `rag_server/main.py:253`. | Per-process; separate service lifecycle was not verified. |
| Provenance write serialization | `app.py:977` (`_PROVENANCE_LOCK`), `app.py:998-1023` (`BEGIN IMMEDIATE`). | The in-process lock is only for threads, but the explicit SQLite `BEGIN IMMEDIATE` also serializes across connections/processes. This path is designed for multi-process safety, subject to the shared database path/WAL caveat in section 6. |
| `vc_vault_data.json` read-modify-write | `routes/argument_routes.py:306-322`; `routes/vault_workspace_routes.py:1602-1617`. No lock or atomic replace is used. | Concurrent saves can overwrite each other; multiple workers make that more likely. The file is also lost on restart. |

The process-local state is not itself the durable record, but it affects correctness under `WEB_CONCURRENCY > 1`: rate limits, active-job counts, caches, scheduler/worker duplication, and the unlocked `vc_vault_data.json` update are all per-process. The DMS queue and provenance chain are the two places where the source explicitly adds database-level serialization.

## 6. `PERSISTENT_DATA_DIR` coverage and gaps

`PERSISTENT_DATA_DIR` is read at import time (`app.py:54`). If it is set **and the directory exists**, the app symlinks exactly two paths (`app.py:100-102`):

- `lex_assistant.db` → `<PERSISTENT_DATA_DIR>/lex_assistant.db`
- `instance/client_data.db` → `<PERSISTENT_DATA_DIR>/client_data.db`

### 6.1 What the symlink does on first attach

`_symlink_onto_persistent_disk()` creates an empty target file if the target does not exist, and if a real local file already exists it renames that local file to `<path>.pre-disk-backup`, then creates the symlink (`app.py:70-82`). It does **not** copy the existing database bytes into the persistent target. The practical consequence is: attaching a disk to an existing deployment can make the running app start against an empty database, with the old file left only in the ephemeral `.pre-disk-backup`. This is source behavior, not a production observation. It is a major difference between “the disk is attached” and “the existing data is on the disk.”

### 6.2 Covered vs. not covered

| Item | Covered by `PERSISTENT_DATA_DIR`? | Evidence / note |
|---|---|---|
| `lex_assistant.db` main file | Yes, via symlink | `app.py:100-102` |
| `instance/client_data.db` main file | Yes, via symlink | `app.py:100-102` |
| `lex_assistant.db-wal` / `-shm` | **No explicit coverage** | The symlink covers only the database path. Local listing has `lex_assistant.db-wal` 0 B and `lex_assistant.db-shm` 32,768 B beside the CWD path. DMS enables WAL (`utils/dms_index.py:210`). DMS/LPMS open `os.path.realpath('lex_assistant.db')` (`app.py:1491`, `app.py:1514`) while legacy routes open the bare symlink path (`app.py:132`), so two path spellings of the same database exist. Runtime sidecar placement was not tested; see “Unverified.” |
| `instance/client_data.db-wal` / `-shm` | **No explicit coverage** | `routes/court_routes.py:947` enables WAL on this file; no symlink logic for sidecars. |
| DMS file store, new writes | Yes, automatically, if `PERSISTENT_DATA_DIR` exists and `DMS_STORAGE_DIR` is unset | `utils/dms_store.py:35-42` chooses `<PDD>/dms_files`; the store creates the directory. |
| Existing `instance/dms_files` files | **No migration** | Switching the root changes where new files go; old files are not copied or linked. |
| DMS `_incoming` and `_scan` | Yes, as subdirectories of the DMS root | `routes/dms_f_bundles.py:468-470`, `utils/dms_scan.py:70-80` |
| Document blobs, `DOC_STORAGE=disk`, new writes | Yes only when `DOC_STORAGE=disk` and no custom `DOC_STORAGE_DIR` | `utils/doc_storage.py:40-51` chooses `<PDD>/blobs`; default is `sqlite` and stores bytes in the row. |
| Existing `data/blobs` | **No migration** | Changing the storage root does not move old blob files. |
| `static/uploads` | **No** | `UPLOAD_FOLDER` defaults to `static/uploads` (`app.py:1386`); it is not derived from `PERSISTENT_DATA_DIR`. |
| `chroma_data` | **No** | Default is a relative path (`utils/local_search.py:17`); only `CHROMA_PATH` can move it. |
| `rag_server/chroma_db` | **No** | Hard-coded relative to the RAG server (`rag_server/main.py:59`). |
| `logs/form_indexer.log` | **No** | Fixed under the repository (`cron_form_indexer.py:37`). |
| OS temp `lexamplify_jobs` | **No** | Uses the OS temp directory (`utils/job_store.py:10`). |
| `vc_vault_data.json` | **No** | Uses `os.getcwd()` (`routes/argument_routes.py:306`, `routes/vault_workspace_routes.py:1602`). |
| `data/cases`, `failed_batches.log`, `failed_normalization.log` | **No** | Repository-relative paths (`mass_ingestion.py:41-46`). |
| Hugging Face model cache | **No** | No cache-directory environment setting was found; default user cache. |
| `instance/database.db`, `instance/x.db`, root `database.db` | **No** | Not part of the production path; `instance/database.db` is the local SQLAlchemy fallback. |

### 6.3 Other coverage notes

- The symlink block is a no-op when `PERSISTENT_DATA_DIR` is unset or is not an existing directory (`app.py:100`). The DMS and blob helpers make the same `isdir` check (`utils/dms_store.py:38-40`, `utils/doc_storage.py:49-50`).
- DMS file encryption depends on `DMS_ENCRYPTION_KEY`; a `.enc` file cannot be read without the matching key (`utils/dms_store.py:63-72`, `utils/dms_store.py:177-190`). The key is configuration, not on the disk.
- `DMS_STORAGE_DIR` can point anywhere and is treated as explicit/persistent by `storage_info()` (`utils/dms_store.py:49-53`); the code does not verify that an explicit path is actually on a persistent disk.
- `DOC_STORAGE_DIR` similarly overrides the blob location (`utils/doc_storage.py:46-51`).
- `UPLOAD_FOLDER` similarly overrides the upload location (`app.py:1386`), but nothing derives it from `PERSISTENT_DATA_DIR`.
- No backup, snapshot, or restore mechanism for the SQLite files or the file stores was found in the reviewed source. This is not a claim that Render/Neon has no external backups; it means the repository has no application-level backup path.

## 7. External stores

Names only; no credential values were read or printed. The repository-wide search covered tracked files, including `requirements.txt`, `tasks/`, root workers, `mass_ingestion.py`, `scripts/`, and example config files; `venv/`, `rag_venv/`, and `node_modules/` were excluded. `.env.example` was inspected for key names only.

| Store / service | Environment names | What it holds | Evidence |
|---|---|---|---|
| Neon PostgreSQL | `DATABASE_URL` | SQLAlchemy tables in section 1: accounts, cases, documents, court rosters, drafts, flags, revoked tokens, audit events, phone OTPs | `app.py:1294-1302`, `app.py:1364-1367`, `app.py:2257-2264` |
| Redis / Celery (optional) | `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND`, `REDIS_URL` | Optional Celery broker/result backend; local fallback is `redis://localhost:6379/0` | `app.py:1465-1468`, `routes/contract_routes.py:725`, `routes/contract_routes.py:822` |
| Pinecone | `PINECONE_API_KEY`, `PINECONE_HOST`, `PINECONE_INDEX_NAME`, `PINECONE_NAMESPACE` | Case-law vector index/namespace used by Firm Library, legal research, assistant, and contract search | `app.py:631-638`, `routes/firm_library_routes.py:82-84`, `routes/legal_research_routes.py:32-34`, `routes/assistant_routes.py:361-363`, `tasks/contract_tasks.py:397-401` |
| AWS S3 public judgment dataset (read-only ingestion) | `TARGET_YEAR` in `worker.py:54`; no AWS credential variables (unsigned client) | Public `indian-supreme-court-judgments` tar downloaded to a temporary file and processed into Pinecone; not application user data | `worker.py:8`, `worker.py:13-14`, `worker.py:41-46`, `worker.py:50-55`, `worker.py:238-239`; started by `loop_ingestion.py:29` |
| Chroma (local on-disk) | `CHROMA_PATH` for `utils/local_search.py`; no environment override for `rag_server/chroma_db` | Local vector collections; not a hosted external service | `utils/local_search.py:17`, `utils/local_search.py:53`, `rag_server/main.py:59`, `rag_server/main.py:253` |
| Hugging Face model cache (local) | No `HF_HOME`, `TRANSFORMERS_CACHE`, or `SENTENCE_TRANSFORMERS_HOME` found | Downloaded sentence-transformer model files; not application data | `utils/local_search.py:19`, `utils/local_search.py:36-39` |

### 7.1 Object-storage finding (corrects the earlier contradiction)

The earlier note that listed “AWS S3 for worker ingestion” and the earlier statement that no S3 backend exists are both partly true but refer to different things:

- **Read path exists.** `worker.py:46` creates an unsigned `boto3` S3 client; `worker.py:238-239` calls `download_fileobj` for `s3://indian-supreme-court-judgments/...` (`BUCKET_NAME` and `TAR_KEY` at `worker.py:53-55`). This is a read-only download of a public dataset.
- **No upload path.** No `put_object`, `upload_file`, `upload_fileobj`, `copy_object`, `create_bucket`, or `delete_object` call was found in repository Python. `worker.py` writes its output to Pinecone (`worker.py:50-51`), not object storage. Therefore no code uploads application data to object storage.
- **Standalone worker, not the Flask app.** `loop_ingestion.py:29` starts `worker.py` as a subprocess; no `import worker` or `from worker import` was found. `README.md:17` calls it a “Background ingestion worker”; `docs/WORDCRAFT_REWORK_PHASE4_BACKEND.md:22` groups `loop_ingestion.py` and `mass_ingestion.py` with Pinecone demo scripts. It is not an application file backend.
- **Name-only S3 profile.** `mass_ingestion.py:49-52`, `mass_ingestion.py:102`, and `mass_ingestion.py:163-165` name an `aws_s3_ecourts` normalization profile, but the code reads local files from `data/cases` (`mass_ingestion.py:41`, `mass_ingestion.py:512`) and has no boto import or call.
- **No application object-storage backend.** `utils/doc_storage.py` supports only `sqlite` and `disk` (`utils/doc_storage.py:37,40-51,96-126`); `utils/dms_store.py` is filesystem-based (`utils/dms_store.py:35-42`); uploads use `static/uploads` or `UPLOAD_FOLDER` (`routes/document_routes.py:377-383`, `app.py:1386`). No R2, Cloudflare, MinIO, or GCS implementation was found. No object-storage match was found in `tasks/`, `scripts/`, `requirements.txt`, or `.env.example`; `.env.example` has no object-storage key names.
- **Undeclared worker dependency.** `requirements.txt` contains no `boto3` or `botocore` match, although `worker.py:8,13-14` imports them. That is a standalone-worker packaging gap, not evidence of an app storage backend.
- **Other S3 mentions are comments/URLs.** `app.py:591,646` refer to worker.py’s S3 filenames; `services/court_scraper.py:89` and `templates/court_resources.html:1713` refer to external S3-hosted PDFs; `docs/WORDCRAFT_REWORK_PHASE4_BACKEND.md:33-34` only proposes future object storage. `FIREBASE_HOSTING_ORIGIN_RE` in `app.py:577` is an origin/CORS pattern, not a storage backend; no Supabase, MongoDB, or Firebase Storage application-data backend was found.

**Bottom line:** code reads from S3 only in the standalone public-dataset ingestion worker; no code uploads application data to S3/R2/GCS/MinIO, and no application object-storage backend exists. This corrects both the earlier overstatement (“AWS S3 for worker ingestion”) and the earlier understatement (“no S3 references at all”).

## 8. Redeploy/restart loss impact

“Redeploy” and “restart” are treated as a process/filesystem replacement on Render Free. A mounted Persistent Disk would survive; the repository does not prove one is attached. The table separates what is lost from what remains. The “with a surviving `PERSISTENT_DATA_DIR`” column is a diagnostic baseline only: Option C (a new paid disk) is **not allowed by the free-tier constraint**.

| Data family | Without a surviving disk | With a surviving `PERSISTENT_DATA_DIR` | Recovery / notes |
|---|---|---|---|
| Neon accounts, cases, documents, rosters, drafts, flags, revoked JWTs, audit events, phone OTPs | Survives; unaffected by Render filesystem | Survives | Depends on Neon retention/backup, not on this repository. The app refuses to start without `DATABASE_URL` in production (`app.py:1364-1367`). |
| `lex_assistant.db`: Case Vault, folders, shares, provenance, matters/teams, letterheads, saved drafts, chat/chunks | Lost | Main database survives if the symlink target is intact | The symlink covers only the main file. `-wal`/`-shm` are not explicitly covered; recent committed transactions could be lost if a sidecar was on ephemeral storage. No application-level backup was found. |
| `lex_assistant.db`: DMS metadata, queue, FTS, paper/bundle/scan tables | Lost | Survives with the main database | DMS files may still exist on a persistent DMS root but become orphaned if metadata is lost. |
| `lex_assistant.db`: LPMS firms, members, cases, clients, hearings, timeline, audit, outbox | Lost | Survives with the main database | `lpms_audit` is a hash chain; losing it loses the audit trail. |
| `instance/client_data.db`: legacy clients, billing, team, tasks, calendar, IP | Lost | Survives if the symlink target is intact | Sidecars are not explicitly covered. The app recreates empty tables at startup (`app.py:1479-1480`), so a missing file looks like an empty feature, not an error. |
| Legacy SQLite `users` / SSO accounts | Lost; accounts and their JWTs become invalid | Survives only if the lex database survives | Migration to Neon runs only at startup (`services/legacy_user_migration.py:32-70`). SSO accounts created after startup are not in Neon. |
| DMS file store | Lost unless `DMS_STORAGE_DIR` points to a surviving path | Survives for new writes under `<PDD>/dms_files`; existing `instance/dms_files` files are not moved | Metadata without files: downloads fail. Files without metadata: content-addressed files remain but are not addressable by the app. If `DMS_ENCRYPTION_KEY` is lost or changed, `.enc` files are unreadable (`utils/dms_store.py:177-190`). |
| Document blobs, default `DOC_STORAGE=sqlite` | Lost with `lex_assistant.db` | Survives with the database | The bytes are in `case_vault.file_blob`, part of the 45 MB local database. |
| Document blobs, `DOC_STORAGE=disk` | Lost if `data/blobs` is not persistent | Survives for new writes under `<PDD>/blobs`; existing `data/blobs` is not moved | A surviving `file_blob` marker pointing at a missing file resolves to `None` (`utils/doc_storage.py:129-150`). |
| `static/uploads` | Lost | Not covered by `PERSISTENT_DATA_DIR`; survives only if `UPLOAD_FOLDER` points at a disk | Extracted text remains in `case_vault` for the document-upload route, but the original file copy is gone. The saved filename is not recorded in the `case_vault` insert (`routes/document_routes.py:377-412`). |
| `chroma_data` / `rag_server/chroma_db` | Lost | Not covered unless `CHROMA_PATH` is explicitly persistent; the RAG server path is fixed | No automatic rebuild was found. Re-indexing requires source text and an explicit reindex/seed step. |
| Contract job JSON (`lexamplify_jobs`) | Lost; in-flight and recently completed local analyses disappear | Not covered | Status returns “not found” or the restart failure message (`routes/contract_routes.py:36-39`, `routes/contract_routes.py:795-796`). |
| `vc_vault_data.json` | Lost | Not covered | Virtual Courtroom sessions are not in SQL; no per-user partition. |
| `logs/form_indexer.log`, `failed_batches.log`, `failed_normalization.log` | Lost | Not covered | Diagnostic data; not user-facing persistence. |
| Hugging Face / SentenceTransformers cache | Lost | Not covered | Redownloaded; first vector-search use can be slower. |
| `data/cases` | Lost if only on the host | Not covered | Batch-ingestion input, not a live request store. |
| `instance/database.db`, `instance/x.db`, root `database.db` | Not production data | Not covered | Local artifacts only. |

Two additional loss modes are source-visible:

1. **First attach can hide existing data.** If a real `lex_assistant.db` exists and `PERSISTENT_DATA_DIR` points at an empty disk, the local file is renamed to `.pre-disk-backup` and the app starts against a new empty target (`app.py:70-82`). This is not a copy/migration.
2. **SSO identity split.** A user created by the SSO callback is stored only in `lex_assistant.db` and receives a JWT with that SQLite id (`routes/sso_routes.py:70-99`, `routes/sso_routes.py:120-126`). If the SQLite file is lost, the account and token identity are lost even though Neon is healthy. If the file survives but the user is not yet in Neon, normal auth and SSO can disagree about the user id.

## Unverified

The following items were not established by this read-only review. They are not findings and should not be treated as confirmed production behavior.

**Access and production state**

- No production access was used. Production row counts, database sizes, disk usage, Neon storage usage, backup retention, RPO, and RTO are unknown.
- Actual Render environment values were not read. This includes whether `PERSISTENT_DATA_DIR` is set, whether a disk is attached, its mount path and size, and the values of `DMS_STORAGE_DIR`, `DOC_STORAGE`, `DOC_STORAGE_DIR`, `CHROMA_PATH`, `UPLOAD_FOLDER`, `WEB_CONCURRENCY`, `DMS_WORKERS`, `DMS_SCAN_WORKERS`, `LPMS_SCHEDULER`, `DB_KEEPALIVE`, and `DMS_ENCRYPTION_KEY`.
- No `.env` file, secret value, database row content, uploaded file content, or `vc_vault_data.json` content was read.
- Whether the local databases match the current production schema after all migrations is unknown. The local files were used only for the counts in section 2.
- Whether the local row counts are representative of production is unknown; they are explicitly **not** production counts.
- Whether the production deployment runs one Gunicorn process or more than one was not observed. `gunicorn.conf.py` defaults to one process and six threads, but `WEB_CONCURRENCY` can override it.
- Whether `rag_server` is deployed as a separate service, and whether its `rag_server/chroma_db` directory is used in production, was not verified.
- Whether production uses Celery/Redis or the local JSON job path was not observed. The code supports both.
- Whether production has any `static/uploads` files that are still needed, and whether all 148 local files are referenced anywhere, was not verified. The upload insert does not store the saved filename (`routes/document_routes.py:377-412`), but static serving or external links could still use the files.
- Whether `instance/x.db` is an old local copy, a test artifact, or something else is unknown. No code reference was found; it was not deleted.
- Whether `data/cases`, `failed_batches.log`, and `failed_normalization.log` are needed operationally was not established.
- Whether the production `conflict_clearance_memos` table exists and has rows is unknown; it is absent from the local `lex_assistant.db` and is created lazily (`routes/conflict_routes.py:945-965`).
- The local `phone_otps` count is reported as 0 from the earlier completed local count. The final re-check was interrupted before it printed, so that single value was not re-verified in the last pass.
- FTS5 shadow-table row counts were not measured; only the two virtual tables and application tables are reported.

**Runtime behavior not executed**

- WAL and `-shm` placement through the `lex_assistant.db` symlink, and the interaction between the bare symlink path and `os.path.realpath('lex_assistant.db')`, were reasoned from source and local file placement but not tested at runtime. The local `lex_assistant.db-shm` is 32,768 B and `lex_assistant.db-wal` is 0 B; this does not prove what happens on Render.
- The first-attach sequence was not run. The source path at `app.py:70-82` renames an existing real file to `.pre-disk-backup` and creates an empty target; actual behavior on a Render disk was not observed.
- Whether concurrent processes can safely use the same SQLite database through two path spellings with WAL was not tested.
- Whether the LPMS scheduler suppresses all duplicate reminder sends across multiple processes was not tested. The code uses database serialization and dedupe, but the end-to-end email behavior was not exercised.
- Whether DMS extraction/scan workers remain correct under real multi-process load was not tested; only the `BEGIN IMMEDIATE` claim path was inspected.
- Whether `vc_vault_data.json` loses updates under concurrent requests was not tested. The source shows a read-modify-write with no file lock or atomic replace.
- Whether the contract JSON store loses fields when two workers update the same job was not tested. The lock is process-local (`utils/job_store.py:13`), and the write is a read-modify-replace.
- Whether the 20-second SSE stream limit plus six Gunicorn threads is sufficient in production was not load-tested.
- Whether the local `instance/database.db` is exactly the file Flask-SQLAlchemy resolves for `sqlite:///database.db` was inferred from the local layout; it is not a production store either way.
- Exact Hugging Face/SentenceTransformers cache location, size, and redownload behavior were not measured.
- Whether the local Chroma collections can be rebuilt from current source text, and whether any reindex/seed procedure exists, was not verified beyond the absence of an automatic rebuild in the reviewed paths.
- Whether `DMS_ENCRYPTION_KEY` is stable across deploys, and whether encrypted `.enc` files have an escrowed key, was not verified.
- Whether any existing persistent disk has enough free space for database growth, BLOBs, DMS files, and Chroma was not measured. `utils/dms_store.py:54-55` exposes free space in a status helper, but no global quota check was found.
- Whether any external backup/snapshot/restore process exists for Neon, the Render disk, DMS files, or object data was not verified. The repository contains no application-level backup path.

**Temporary-copy handling**

Temporary database copies used for the local counts were created outside the repository, opened read-only with `mode=ro`, queried only with `SELECT COUNT(*)`, and deleted. `NO_INVENTORY_TEMP_DIRS` was confirmed after the run. No application import, `create_app()`, server start, test run, or external service connection was performed.

## Options A/B/C (free-tier constraint)

These are planning comparisons, not recommendations. No option is preferred or selected here. The constraint is that the project must stay on free tiers; **Option C is a paid disk and is not allowed by that constraint**. Each option would need its own migration, rollback, and verification plan; none is a drop-in change under the current source. Vendor limits, prices, and behaviours are not stated from memory; they are listed as items to verify in vendor documentation.

| Option | Free-tier status | Effort | Risk | Main unresolved area |
|---|---|---|---|---|
| **A. Move everything to Neon Postgres** | Candidate only if Neon free-tier limits fit; verify vendor docs | High | High | Filesystem stores, Chroma, temp jobs, `vc_vault_data.json`, HF cache, SSO cutover |
| **B. Keep SQLite; Litestream to Cloudflare R2; R2 for uploaded files** | Candidate only if Render, Litestream, and R2 free-tier limits fit; verify vendor docs | Medium-high | High | File-store rewrite, cold-start restore, two replicas, WAL/path behavior, multi-process writes |
| **C. Paid Render disk** | **Not allowed by constraint** | Low-medium operational | Medium-high if it were allowed | First-attach data loss, sidecars, paths not covered by the disk, backups, capacity |

### A. Move everything to Neon Postgres

**What moves.** All 54 SQLite application tables in `lex_assistant.db` plus the legacy tables in `instance/client_data.db` move into Neon Postgres; in the pure form of this option, `case_vault.file_blob` becomes `bytea`; legacy SSO users and conflict memos move with them. Neon already hosts the SQLAlchemy core (`app.py:1294-1335`), so the target service exists, but the raw-SQL layer is separate from that SQLAlchemy layer.

**Effort: High.** The work is not a table copy. It includes schema/data migration, rewriting every raw SQLite statement and connection path, redesigning DMS full-text search and triggers, replacing the DMS queue claim and other `BEGIN IMMEDIATE` serialization, moving BLOBs, and a cutover/rollback plan.

**Risk: High.** The main risks are semantic drift in raw SQL, FTS ranking/highlighting differences, queue-claim races, BLOB/database size growth, SSO identity reconciliation, and an incomplete cutover. The measured local database is 45,117,440 B with 913 `case_vault` rows, but no row contents were read, so the BLOB share and the production footprint are unknown.

**What it leaves unsolved.** All filesystem and non-SQL state remains: DMS files (`utils/dms_store.py:35-42`), `static/uploads` (148 files, 2,746,654 B; `routes/document_routes.py:377-383`), Chroma (`chroma_data` 262,144 B; `rag_server/chroma_db` 438,436 B), contract temp jobs (167 files, 23,129,548 B; `utils/job_store.py:10-11`), `vc_vault_data.json` (2,777 B; `routes/argument_routes.py:298-322`), the Hugging Face cache, logs and failure logs, `data/cases`, and DMS `_incoming`/`_scan`. The SSO JWT-id cutover and the original-upload-filename gap also remain: the upload insert does not store the saved filename (`routes/document_routes.py:377-412`).

#### A.1 SQL rewrite surface (re-counted)

Counts were produced with `git grep -o` (occurrences) and `git grep -l` (files) over tracked production `*.py`, excluding `tests/`, `venv/`, `rag_venv/`, and `node_modules/`. They are source-level counts, not runtime measurements. The raw `?`, date-function, `BLOB`, and `FTS5` rows are upper bounds or literal-token counts as noted; the 394/36 placeholder line count is the closer call-site proxy.

| Pattern | Occurrences / lines | Files | Scope / caveat |
|---|---:|---:|---|
| `?` raw question marks | 2,965 | 75 | Upper bound: every `?` in production Python, including URLs, regexes, and comments. |
| `?` on SQL-ish `execute*` lines | 394 lines | 36 | Lines containing `?` plus `execute`/`executemany`/`executescript`; a call-site line count, not a statement count. |
| `lastrowid` | 48 | 19 | Needs `RETURNING id` or an equivalent. |
| `total_changes` | 11 | 4 | Connection-wide SQLite change counter; no direct psycopg equivalent. |
| `sqlite_master` | 3 | 3 | Replace with `information_schema`/`pg_catalog`. |
| `executescript` | 5 | 5 | Multi-statement DDL bootstrap must become a migration. |
| `INSERT OR REPLACE` | 2 | 2 | PostgreSQL `ON CONFLICT ... DO UPDATE` changes delete/insert side effects. |
| `INSERT OR IGNORE` | 8 | 4 | PostgreSQL `ON CONFLICT DO NOTHING`; row-count/last-id semantics differ. |
| `ON CONFLICT` | 10 | 7 | Mostly portable in shape, but depends on SQLite unique/partial indexes and `?` binding. |
| SQLite date functions | 59 | 23 | Upper bound: regex also matches Python `date(`/`datetime(` calls. |
| `json_each` / `json_extract` | 12 | 2 | Needs `jsonb`/`jsonb_array_elements` and valid JSON text. |
| `row_factory` | 64 | 22 | Raw `sqlite3.Row` access is not a psycopg row. |
| `AUTOINCREMENT` | 45 | 6 | PostgreSQL identity/serial; `sqlite_sequence` has no equivalent. |
| `PRAGMA` | 31 | 16 | WAL, `busy_timeout`, `foreign_keys`, and `table_info` are SQLite-specific. |
| `FTS5` | 7 | 1 | Literal `FTS5`; the FTS surface also has 2 `CREATE VIRTUAL TABLE` and 5 `CREATE TRIGGER` occurrences across 2 files. |
| `BEGIN IMMEDIATE` | 21 | 9 | Additional context: DMS queue, LPMS scheduler, and provenance serialization. |
| `BLOB` | 150 | 18 | Additional context: includes column names such as `file_blob`, not only SQL type declarations. |

#### A.2 DMS FTS5 and triggers

`utils/dms_index.py:159-181` creates two FTS5 virtual tables: `dms_fts` with external content from `dms_pages` and `content_rowid='rowid'`, and `dms_meta_fts` for title/reference/party/court/class fields. `utils/dms_index.py:184-204` keeps them in sync with triggers on `dms_pages` and a `case_vault` cleanup trigger. Search uses `MATCH` (`utils/dms_index.py:573-580`), `bm25` weights (`utils/dms_index.py:712-737`), and `snippet` highlighting (`utils/dms_index.py:754-773`).

A Postgres move would need to replace the virtual tables with `tsvector` columns plus GIN indexes or an external search service; replace the external-content/`rowid` pattern with explicit primary keys; convert the insert/update/delete triggers into PL/pgSQL trigger functions or application-side writes; convert `MATCH` to `@@`/`websearch_to_tsquery`, `bm25` to `ts_rank_cd` or custom weights, and `snippet` to `ts_headline`; and retest tokenization, prefix matching, ranking, and highlighting. The `case_vault` cleanup trigger would become a foreign-key/cascade or a trigger function. Exact ranking and snippet parity is not established by this source review and must be tested.

The DMS queue claim is `BEGIN IMMEDIATE` followed by select-then-update (`utils/dms_worker.py:60-64`). In Postgres it would need a row-locking claim such as `SELECT ... FOR UPDATE SKIP LOCKED` or `UPDATE ... RETURNING`, with the `dms_docs` status update in the same transaction and the existing attempts/heartbeat/lease behavior preserved. Two other paths also rely on SQLite write serialization: the LPMS reminder sweep (`utils/lpms_store.py:989-1007`) and the provenance hash chain (`app.py:998-1023`). Each needs an explicit Postgres transaction/lock design; the hash chain must remain single-writer or use an equivalent serialization guarantee.

#### A.3 BLOB data and size

`case_vault.file_blob` is a SQLite `BLOB` (`app.py:170`); the vault upload inserts raw bytes (`app.py:1776-1778`) and download reads them back (`app.py:1856-1858`). The default document backend returns bytes for the row (`utils/doc_storage.py:40-43,96-103`); the disk backend writes a file and stores a marker instead (`utils/doc_storage.py:104-126`).

A pure “everything to Neon” move would put those bytes into `bytea`; putting them in an object store instead is the file-storage part of Option B, not Option A. The local `lex_assistant.db` is 45,117,440 B and `case_vault` has 913 rows, but no row contents were read, so the BLOB share cannot be attributed. Moving BLOBs into Postgres increases database size, backup/WAL volume, and restore time; whether that fits a free-tier database is a vendor-doc question. The 45 MB local file is not evidence of production size. `static/uploads` is separate (148 files, 2,746,654 B), `data/blobs` is missing locally, and the local DMS file store is 0 files/0 B.

#### A.4 What could stay on SQLite as a rebuildable cache

Only clearly derived/regenerable stores could stay: `misc_forms` (40 rows) and `event_cache` (5 rows) are described as caches/regenerable in section 2.5; the DMS FTS virtual tables are derived from `dms_pages`/`dms_docs` and would need a rebuild procedure; Chroma is a derived vector index only if a reindex path is confirmed, and no automatic rebuild was found (`utils/local_search.py:17,53`; `rag_server/main.py:59,253`). The local SQLAlchemy fallback `instance/database.db` is not production data. The current code treats SQLite as a system of record, so keeping any SQLite as a cache would require a new cache/invalidation layer; no such layer was found.

#### A.5 Established from this source vs. depends on vendor docs

**Established from this source (file:line):**
- Neon is already the SQLAlchemy core (`app.py:1294-1335`), but the raw SQLite layer is separate.
- The SQL counts and FTS/queue/BLOB citations above.
- The SQLite files, file stores, temp jobs, Chroma paths, and `vc_vault_data.json` are separate from Neon (sections 2, 4, and 6).
- `case_vault.file_blob` stores bytes in the row by default (`app.py:170,1776-1778`; `utils/doc_storage.py:96-103`).

**Depends on vendor docs, to be verified (no vendor limits, prices, or behaviours stated here):**
- Neon free-tier database size, compute hours, connection limits, request counts, backup/restore, egress, and whether the measured database/BLOB footprint fits.
- PostgreSQL `tsvector`/GIN ranking, highlighting, and performance parity for the DMS search behavior.
- Whether `bytea` BLOB sizes and the required concurrent connections fit the selected plan.
- Any Neon maintenance/restore behavior during cutover and rollback.

### B. Keep SQLite; Litestream replication to Cloudflare R2; R2 for uploaded files

**What moves.** SQLite remains the application database. Litestream replicates `lex_assistant.db` and `instance/client_data.db` to Cloudflare R2; uploaded files move to R2 through a new application backend. FTS5 tables and triggers stay inside `lex_assistant.db` and are replicated as part of the file.

**Effort: Medium-high.** This needs a deployment wrapper/second process, two replicas, a pre-start restore step, a new R2 file backend, and migration of existing files. It is smaller than the Postgres rewrite but larger than attaching a disk.

**Risk: High.** The main risks are cold-start restore failure, WAL/path ambiguity, two independent database replicas, multi-process SQLite writes, and the absence of any application object-storage backend. R2 file storage adds a second consistency boundary between SQLite metadata and object bytes.

**What it leaves unsolved.** Unless the R2 backend is extended to each store, DMS files, `static/uploads`, disk-backed document blobs, Chroma, contract temp jobs, `vc_vault_data.json`, the Hugging Face cache, logs/failure logs, `data/cases`, and DMS `_incoming`/`_scan` remain local. Existing files are not moved automatically. The SSO split remains: SSO still writes `lex_assistant.db` `users` and issues JWT ids from SQLite (`routes/sso_routes.py:70-99,120-126`). There is also no reconciliation between SQLite metadata and R2 objects.

#### B.1 Running Litestream as a second process alongside Gunicorn

The current production start command is `gunicorn -c gunicorn.conf.py "app:create_app()"` (`README.md:51`). `gunicorn.conf.py` selects `gthread`, defaults to one worker (`WEB_CONCURRENCY`, `gunicorn.conf.py:13`), six threads, and a 120-second timeout (`gunicorn.conf.py:12-17`). The file’s docstring says Gunicorn loads it automatically, so the current start command needs no change for Gunicorn itself (`gunicorn.conf.py:2`). That does **not** start Litestream.

No `Procfile`, `render.yaml`, or `Dockerfile` is tracked in the repository root. Adding Litestream therefore requires a changed Render start command or a new entrypoint/wrapper script that starts one replicator per database and then starts Gunicorn in the foreground (or a Litestream wrapper/exec mode). The build may also need the Litestream binary. The exact command, flags, process accounting, and whether the free instance permits the extra process are vendor-doc questions, not established here.

#### B.2 Restore-on-boot and cold start

A restore step must run **before** the application opens either database. The current app can create an empty target on first attach (`app.py:70-82`), initializes the legacy SQLite schema at startup (`app.py:1479-1480`), and initializes DMS/LPMS schemas (`utils/dms_index.py:207-215`, `utils/lpms_store.py:302`). If Gunicorn starts first, the app can initialize an empty database before Litestream restores the replica. The boot sequence must restore both files, verify them, and fail closed rather than start empty if restore cannot complete.

Cold start therefore includes restore time. The exact time depends on database size, network throughput, and Litestream/R2 behavior; none of those values is stated here. A first boot with no replica, a corrupt replica, or a partially restored database needs an explicit policy.

#### B.3 WAL compatibility and the real file path

WAL is already used by the DMS database (`utils/dms_index.py:210`) and the legacy client database (`routes/court_routes.py:947`). Whether Litestream supports this exact WAL/multi-process usage must be verified in Litestream’s documentation; it is not assumed here.

- **With `PERSISTENT_DATA_DIR` unset:** the symlink block is inactive (`app.py:100`). Legacy code opens the bare relative path `lex_assistant.db` (`app.py:132`); DMS and LPMS open `os.path.realpath('lex_assistant.db')` (`app.py:1491`, `app.py:1514`). Both resolve to the same CWD file. The database and its WAL/SHM sidecars are on the ephemeral filesystem, so every cold start needs a restore. Writes after the last replicated transaction can be lost; the replication-lag/durability window is a vendor-doc question.
- **With `PERSISTENT_DATA_DIR` set:** `app.py:100-102` symlinks `lex_assistant.db` to `<PERSISTENT_DATA_DIR>/lex_assistant.db` and `instance/client_data.db` to `<PERSISTENT_DATA_DIR>/client_data.db`. Legacy code opens the symlink path (`app.py:132`); DMS/LPMS resolve it to the real target (`app.py:1491`, `app.py:1514`). Litestream must watch the **real target path**, not only the symlink. The `-wal`/`-shm` sidecars are not explicitly symlinked (section 6.2); their placement through this path mix was not tested. Local `lex_assistant.db-wal` is 0 B and `-shm` is 32,768 B, which does not prove Render behavior.

Two database files mean **two Litestream replicas and two restore steps**: `lex_assistant.db` and `instance/client_data.db`. FTS5 virtual tables and triggers live inside `lex_assistant.db` (`utils/dms_index.py:159-204`), so file-level replication carries them, but they remain SQLite-only and cannot be queried as ordinary Postgres tables.

With `WEB_CONCURRENCY > 1` (`gunicorn.conf.py:13`), multiple Gunicorn processes share the same SQLite file. SQLite still has a single writer; the DMS queue uses `BEGIN IMMEDIATE` (`utils/dms_worker.py:60-64`), and the process-local state in section 5 still multiplies. The deployment must run one replicator per database, not one per Gunicorn worker; that invariant is not enforced by the current code. Exact behavior under multiple writers plus Litestream must be tested.

#### B.4 R2 for uploaded files requires a new backend

There is no application object-storage backend to configure. `utils/dms_store.py:35-42` chooses a filesystem root; `utils/doc_storage.py:36-51,96-126` supports only `sqlite` and `disk`; uploads write to `static/uploads` or `UPLOAD_FOLDER` (`routes/document_routes.py:377-383`, `app.py:1386`). `worker.py` only downloads a public S3 dataset and is not an upload backend.

Putting uploads in R2 would require new code for each file store (DMS files, `static/uploads`, and any disk-backed blobs), new R2 credentials/environment names, checksum and encryption handling, deletion/lifecycle behavior, signed-URL or proxy access, and a migration for existing files. DMS files can be encrypted with `DMS_ENCRYPTION_KEY` (`utils/dms_store.py:63-72,177-190`); an R2 backend must preserve the same encryption/checksum guarantees. No R2, Cloudflare, MinIO, or GCS code or environment names were found, and `requirements.txt` does not declare `boto3`/`botocore`.

#### B.5 Established from this source vs. depends on vendor docs

**Established from this source (file:line):**
- Current start command and Gunicorn defaults (`README.md:51`, `gunicorn.conf.py:2,12-17`); no `Procfile`, `render.yaml`, or `Dockerfile` in the repository.
- The two SQLite files, their symlink/realpath split, and the WAL settings (`app.py:100-102,132,1491,1514`; `utils/dms_index.py:210`; `routes/court_routes.py:947`).
- FTS5 tables/triggers live inside `lex_assistant.db` (`utils/dms_index.py:159-204`).
- The filesystem-only DMS/doc/upload stores and the absence of an R2/GCS/MinIO backend (section 7).
- The local file counts and sizes in sections 2 and 4.

**Depends on vendor docs, to be verified (no vendor limits, prices, or behaviours stated here):**
- Render free-tier process count, memory/CPU accounting, build steps, start-command/entrypoint support, and cold-start behavior.
- Litestream WAL support, restore behavior, replication lag, wrapper/`-exec` invocation, retention, and R2 compatibility.
- Cloudflare R2 free-tier storage size, request counts, egress, S3 API compatibility, consistency, credentials, and lifecycle behavior.
- Whether one free instance can run Gunicorn plus Litestream within the allowed resources.
- Exact restore time and acceptable data-loss window.

### C. Paid Render disk (comparison only — **not allowed by constraint**)

**Free-tier status: not allowed by constraint.** A paid Render disk is included only for comparison. No vendor price, size, availability, or backup behavior is asserted here.

**Effort: Low-medium operational.** Attach a disk, set paths, pre-stage data, and add backup/monitoring. **Risk: Medium-high if it were allowed.** The first-attach behavior can hide existing data, sidecars are not explicitly covered, and a single disk is a single point of failure with finite capacity.

**What it leaves unsolved.** Uploads, Chroma, contract temp jobs, `vc_vault_data.json`, the Hugging Face cache, logs/failure logs, `data/cases`, and existing `instance/dms_files`/`data/blobs` are not automatically covered; each needs an explicit path/config or code change. The SSO SQLite/Neon identity split also remains. Backups, restore tests, disk-capacity monitoring, and multi-process SQLite contention are not solved by attaching a disk.

#### C.1 First-attach behaviour

`_symlink_onto_persistent_disk()` creates an empty target file if the target does not exist, and if a real local file already exists it renames that file to `<path>.pre-disk-backup` before creating the symlink (`app.py:70-82`). It does **not** copy the existing database bytes into the persistent target. Attaching a disk to an existing deployment can therefore make the running app start against an empty database, with the old file left only in the ephemeral `.pre-disk-backup`. This is source behavior, not a production observation. The data must be staged on the disk before first use; booting first is not a migration.

#### C.2 Sidecars and path coverage

The symlink block covers only the two main database paths (`app.py:100-102`). `lex_assistant.db-wal`/`-shm` and `instance/client_data.db-wal`/`-shm` are not explicitly symlinked. WAL is enabled on the DMS database (`utils/dms_index.py:210`) and the client database (`routes/court_routes.py:947`). Legacy code uses the bare symlink path (`app.py:132`), while DMS/LPMS use `os.path.realpath` (`app.py:1491`, `app.py:1514`); whether SQLite places sidecars beside the symlink or the real target was not tested. The local sidecar sizes are 0 B for `lex_assistant.db-wal` and 32,768 B for `-shm`; they do not establish Render behavior.

#### C.3 What a disk would and would not cover

A disk could cover the two main database files through `PERSISTENT_DATA_DIR`; new DMS writes under `<PDD>/dms_files`; disk-backed document blobs if `DOC_STORAGE=disk`; uploads if `UPLOAD_FOLDER` is pointed at the disk; and Chroma if `CHROMA_PATH` is pointed at the disk. Existing `instance/dms_files` and `data/blobs` are not moved by changing the root. Contract jobs use the OS temp directory (`utils/job_store.py:10-11`), `vc_vault_data.json` uses the CWD (`routes/argument_routes.py:298-322`), and the Hugging Face cache has no configured path (section 4); those need code/config changes, not just a disk. No application-level backup/restore path was found.

#### C.4 Established from this source vs. depends on vendor docs

**Established from this source (file:line):**
- First-attach rename/empty-target behavior (`app.py:70-82`).
- Only the two main database paths are symlinked (`app.py:100-102`); sidecars are not explicitly covered.
- WAL settings and the bare-path/`realpath` mix (`utils/dms_index.py:210`; `routes/court_routes.py:947`; `app.py:132,1491,1514`).
- Which file stores use `PERSISTENT_DATA_DIR` and which do not (section 6.2).

**Depends on vendor docs, to be verified (no vendor limits, prices, or behaviours stated here):**
- Render disk availability, size, price, attach/mount behavior, snapshots, backup retention, and whether a free-tier deployment can use one at all.
- Actual cold-start/attach behavior on Render and whether sidecars follow the real target path.
- Capacity and failure behavior of a single disk.

No option is preferred or selected here; this section is a comparison, not a final recommendation.

## Open questions

**Free-tier constraints**

- Which free-tier limits (database size, compute hours, object storage size, request counts) apply today? To be checked against vendor pages.

**Deployment and disk**

Questions 1-3 and 13 are diagnostic: they establish whether a disk is already attached. A new paid disk is not allowed by the free-tier constraint (Option C).

1. Is a Render Persistent Disk actually attached in production, at what mount path, and what is its size and backup policy?
2. Is `PERSISTENT_DATA_DIR` set to that mount, and is it set before the first process starts?
3. What are the actual production values (names only) for `DMS_STORAGE_DIR`, `DOC_STORAGE`, `DOC_STORAGE_DIR`, `UPLOAD_FOLDER`, `CHROMA_PATH`, `DMS_WORKERS`, `DMS_SCAN_WORKERS`, `LPMS_SCHEDULER`, `DB_KEEPALIVE`, and `WEB_CONCURRENCY`?
4. Is the intended deployment single-process, or is `WEB_CONCURRENCY > 1` expected? If multi-process, which process-local limits/caches/schedulers must be made global?
5. Is `rag_server` deployed separately, and does it share the same disk or a different host?

**Data scope and ownership**

6. What are the production row counts and sizes for each family in the summary table? Local counts are not production.
7. Which features are actually in use in production: Case Vault BLOB storage, `DOC_STORAGE=disk`, DMS, LPMS, SSO, Virtual Courtroom JSON, local vector search, and Celery/Redis?
8. Are SSO-created users expected to live in Neon? If so, should the SSO callback write the SQLAlchemy `User` table and stop issuing SQLite ids?
9. Are the 148 local `static/uploads` files (or their production equivalents) needed as originals, or is the extracted text in `case_vault` sufficient?
10. Is `vc_vault_data.json` still a supported feature? If yes, should it become a per-user table instead of one CWD file?
11. Is `instance/x.db` safe to ignore or remove? It has no code reference, but it was not deleted without owner confirmation.
12. Is `conflict_clearance_memos` used in production? The local table is absent and the code creates it lazily.

**Cutover and correctness**

13. If a disk is already attached, how will existing SQLite and DMS data be copied onto it before first use, given that `_symlink_onto_persistent_disk()` renames an existing file to `.pre-disk-backup` instead of copying it? For the free-tier options, what is the equivalent pre-boot restore/copy step?
14. How should `lex_assistant.db-wal` and `-shm` be handled during cutover, and should all processes open the same real path rather than a mix of symlink and `realpath`?
15. What is the acceptable downtime and rollback window for a migration? Is dual-write or a freeze-and-copy cutover required?
16. How will migrated row counts, BLOB hashes, DMS file hashes, and LPMS audit-chain hashes be verified?
17. If Chroma is lost, can it be rebuilt from `case_vault`/DMS text, and what is the expected rebuild time?
18. If contract job JSON is lost, is it acceptable for in-flight analyses to fail, or must jobs survive a restart?

**Storage and security**

19. Where will DMS files, uploads, and disk-backed blobs live, and what encryption/access-control/lifecycle rules apply?
20. Is `DMS_ENCRYPTION_KEY` stable, and who holds an escrow/recovery copy? A lost or changed key makes `.enc` files unreadable.
21. Do any temp job files, failure logs, or uploads contain privileged client material that requires stricter retention or deletion?
22. What data-residency or vendor constraints apply to Neon, object storage, Pinecone, Redis, and any backup location?

**Recovery and operations**

23. What are the required RPO and RTO for accounts, Case Vault, DMS files, LPMS, legacy client/billing data, and contract jobs?
24. Are Neon backups, any existing Render disk snapshots, object-storage versioning, and restore tests in place? Who owns them?
25. What monitoring exists for disk free space, SQLite size, WAL growth, DMS queue depth, failed jobs, and Chroma/index freshness?
26. What is the retention policy for `lpms_audit`, `vault_provenance`, `audit_events`, `failed_batches.log`, and temp contract jobs?
27. Who approves deletion of local artifacts (`instance/x.db`, root `database.db`, old `.pre-disk-backup` files) and old uploads?
