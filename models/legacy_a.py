"""SQLAlchemy models for tables historically stored in `lex_assistant.db`.

These models exist so the Postgres consolidation (Phase 1 of the workspaces
refactor) can read/write every one of these tables through the single
SQLAlchemy engine instead of a raw sqlite3 connection.

Rules:
  * One class per legacy table, column names match verbatim.
  * No app-level logic here — these are plain data mappings.
  * Already-modelled tables are NOT redeclared: draft_sessions, draft_versions,
    user_flags live in models/draft_session.py; users / cases / documents /
    audit_events / phone_otps / revoked_tokens / judicial_officers /
    supreme_court_roster live in their own modules.
  * SQLite FTS5 virtual tables (dms_fts, dms_meta_fts) and their shadow
    tables are intentionally NOT modelled; full-text search is reimplemented
    on Postgres with tsvector columns in a later phase.
"""
from datetime import datetime
from sqlalchemy import (
    Boolean, Column, DateTime, Date, Float, Integer, LargeBinary, Text,
    UniqueConstraint, Index, CheckConstraint,
)
from sqlalchemy import text as sql_text
from database import db


# ──────────────────────────────────────────────────────────────────
# Case Vault + folders + sharing + audit + provenance
# ──────────────────────────────────────────────────────────────────
class CaseVault(db.Model):
    __tablename__ = "case_vault"
    id = Column(Integer, primary_key=True, autoincrement=True)
    case_id = Column(Text)
    title = Column(Text)
    doc_type = Column(Text)
    content = Column(Text)
    created_at = Column(DateTime, server_default=sql_text("CURRENT_TIMESTAMP"))
    folder_id = Column(Integer)
    smart_title = Column(Text)
    tags = Column(Text)
    file_blob = Column(LargeBinary)
    file_format = Column(Text)
    user_id = Column(Integer)
    link_shared = Column(Boolean, default=False)
    validity_status = Column(Text, default="Green")
    ratio_headnote = Column(Text)
    is_public = Column(Integer, nullable=False, default=0)


class VaultFolder(db.Model):
    __tablename__ = "vault_folders"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(Text, nullable=False)
    parent_id = Column(Integer)  # self-FK — enforced in Postgres migration
    user_id = Column(Integer)
    created_at = Column(DateTime, server_default=sql_text("CURRENT_TIMESTAMP"))
    protected = Column(Boolean, default=False)
    link_shared = Column(Boolean, default=False)


class DocumentVaultShare(db.Model):
    __tablename__ = "document_vault_shares"
    __table_args__ = (
        UniqueConstraint("node_type", "node_id", "team_member_id"),
        CheckConstraint("node_type IN ('folder', 'document')"),
        CheckConstraint("permission IN ('view', 'edit')"),
    )
    id = Column(Integer, primary_key=True, autoincrement=True)
    node_type = Column(Text, nullable=False)
    node_id = Column(Integer, nullable=False)
    team_member_id = Column(Integer, nullable=False)
    permission = Column(Text, nullable=False, default="view")
    created_at = Column(DateTime, server_default=sql_text("CURRENT_TIMESTAMP"))


class VaultAudit(db.Model):
    __tablename__ = "vault_audit"
    id = Column(Integer, primary_key=True, autoincrement=True)
    folder_id = Column(Integer)
    vault_doc_id = Column(Integer)
    session_title = Column(Text)
    messages_json = Column(Text)
    created_at = Column(DateTime, server_default=sql_text("CURRENT_TIMESTAMP"))


class VaultProvenance(db.Model):
    __tablename__ = "vault_provenance"
    __table_args__ = (CheckConstraint("node_type IN ('folder', 'document')"),)
    id = Column(Integer, primary_key=True, autoincrement=True)
    node_type = Column(Text, nullable=False)
    node_id = Column(Integer)
    node_name = Column(Text, nullable=False)
    action = Column(Text, nullable=False)
    actor_user_id = Column(Integer)
    owner_user_id = Column(Integer)
    detail = Column(Text)
    content_hash = Column(Text, nullable=False)
    created_at = Column(DateTime, server_default=sql_text("CURRENT_TIMESTAMP"))


# ──────────────────────────────────────────────────────────────────
# Teams + matters + matter-children (deadlines, tasks, notes, activity)
# ──────────────────────────────────────────────────────────────────
class Team(db.Model):
    __tablename__ = "teams"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(Text, nullable=False)
    description = Column(Text)
    is_private = Column(Boolean, nullable=False, default=False)
    owner_user_id = Column(Integer, nullable=False)
    created_at = Column(DateTime, server_default=sql_text("CURRENT_TIMESTAMP"))


class TeamMembership(db.Model):
    __tablename__ = "team_memberships"
    __table_args__ = (UniqueConstraint("team_id", "user_id"),)
    id = Column(Integer, primary_key=True, autoincrement=True)
    team_id = Column(Integer, nullable=False)
    user_id = Column(Integer, nullable=False)
    role = Column(Text, nullable=False, default="member")
    created_at = Column(DateTime, server_default=sql_text("CURRENT_TIMESTAMP"))


class Matter(db.Model):
    __tablename__ = "matters"
    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(Text, nullable=False)
    status = Column(Text, nullable=False, default="open")
    team_id = Column(Integer)
    lead_counsel = Column(Text)
    opened_date = Column(Date)
    owner_user_id = Column(Integer, nullable=False)
    created_at = Column(DateTime, server_default=sql_text("CURRENT_TIMESTAMP"))


class Deadline(db.Model):
    __tablename__ = "deadlines"
    id = Column(Integer, primary_key=True, autoincrement=True)
    matter_id = Column(Integer, nullable=False)
    title = Column(Text, nullable=False)
    date = Column(Date)
    description = Column(Text)
    ai_extracted = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, server_default=sql_text("CURRENT_TIMESTAMP"))


class TaskMatter(db.Model):
    __tablename__ = "tasks_matter"
    id = Column(Integer, primary_key=True, autoincrement=True)
    matter_id = Column(Integer, nullable=False)
    title = Column(Text, nullable=False)
    done = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, server_default=sql_text("CURRENT_TIMESTAMP"))


class HandoffNote(db.Model):
    __tablename__ = "handoff_notes"
    id = Column(Integer, primary_key=True, autoincrement=True)
    matter_id = Column(Integer, nullable=False)
    author_user_id = Column(Integer, nullable=False)
    text = Column(Text, nullable=False)
    created_at = Column(DateTime, server_default=sql_text("CURRENT_TIMESTAMP"))


class MatterActivity(db.Model):
    __tablename__ = "matter_activity"
    id = Column(Integer, primary_key=True, autoincrement=True)
    matter_id = Column(Integer, nullable=False)
    text = Column(Text, nullable=False)
    created_at = Column(DateTime, server_default=sql_text("CURRENT_TIMESTAMP"))


# ──────────────────────────────────────────────────────────────────
# Letterheads, saved drafts, contract analyses, chunks, chat history
# ──────────────────────────────────────────────────────────────────
class Letterhead(db.Model):
    __tablename__ = "letterheads"
    id = Column(Integer, primary_key=True, autoincrement=True)
    owner_user_id = Column(Integer, nullable=False)
    name = Column(Text, nullable=False)
    tagline = Column(Text)
    address = Column(Text)
    contact = Column(Text)
    auto_detected = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, server_default=sql_text("CURRENT_TIMESTAMP"))


class SavedDraft(db.Model):
    __tablename__ = "saved_drafts"
    id = Column(Text, primary_key=True)
    owner_user_id = Column(Integer, nullable=False)
    title = Column(Text, nullable=False)
    raw_text = Column(Text)
    clauses_json = Column(Text)
    summary = Column(Text)
    created_at = Column(DateTime, server_default=sql_text("CURRENT_TIMESTAMP"))


class ContractAnalysis(db.Model):
    __tablename__ = "contract_analyses"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "job_id"),
        Index("ix_contract_analyses_owner", "owner_user_id", "created_at"),
    )
    id = Column(Integer, primary_key=True, autoincrement=True)
    owner_user_id = Column(Text, nullable=False)
    job_id = Column(Text, nullable=False)
    document_name = Column(Text)
    raw_text = Column(Text)
    results_json = Column(Text)
    scan_strategy = Column(Text)
    page_count = Column(Integer)
    word_count = Column(Integer)
    created_at = Column(DateTime, server_default=sql_text("CURRENT_TIMESTAMP"))


class DocumentChunkLegacy(db.Model):
    """The real document_chunks table (SQLite DB A).

    Supersedes the deprecated stub in models/document_chunk.py."""
    __tablename__ = "document_chunks"
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False)
    case_id = Column(Integer)
    document_id = Column(Integer, nullable=False)
    chunk_index = Column(Integer, nullable=False)
    chunk_text = Column(Text, nullable=False)
    embedding = Column(Text, nullable=False)
    created_at = Column(DateTime, server_default=sql_text("CURRENT_TIMESTAMP"))


class ChatHistory(db.Model):
    __tablename__ = "chat_history"
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer)
    user_message = Column(Text, nullable=False)
    bot_response = Column(Text, nullable=False)
    created_at = Column(DateTime, server_default=sql_text("CURRENT_TIMESTAMP"))


# ──────────────────────────────────────────────────────────────────
# Calendar events (canonical table — DB B had a sibling with 7 rows that
# the consolidation script merges in; it uses the richer superset below)
# ──────────────────────────────────────────────────────────────────
class CalendarEvent(db.Model):
    __tablename__ = "calendar_events"
    id = Column(Integer, primary_key=True, autoincrement=True)
    event_date = Column(Text)
    event_type = Column(Text)
    title = Column(Text)
    related_case_id = Column(Text)  # TEXT so both DB A (text) and DB B (int) migrate cleanly
    location = Column(Text)
    opposing_counsel = Column(Text)
    google_event_id = Column(Text)
    owner_user_id = Column(Text)
    created_at = Column(DateTime, server_default=sql_text("CURRENT_TIMESTAMP"))


class UserNotificationSettings(db.Model):
    __tablename__ = "user_notification_settings"
    id = Column(Integer, primary_key=True, autoincrement=True)
    owner_user_id = Column(Text, nullable=False, unique=True)
    email_alerts_enabled = Column(Integer, default=0)
    alert_email = Column(Text, default="")
    updated_at = Column(DateTime, server_default=sql_text("CURRENT_TIMESTAMP"))


# ──────────────────────────────────────────────────────────────────
# Conflict engine
# ──────────────────────────────────────────────────────────────────
class ConflictClearanceMemo(db.Model):
    __tablename__ = "conflict_clearance_memos"
    id = Column(Integer, primary_key=True, autoincrement=True)
    ref_id = Column(Text, nullable=False)
    target_entity = Column(Text, nullable=False)
    opposing_party = Column(Text)
    matter_type = Column(Text)
    generated_at = Column(Text)
    memo_text = Column(Text)


# ──────────────────────────────────────────────────────────────────
# DMS (Document Management System)
# ──────────────────────────────────────────────────────────────────
class DmsDoc(db.Model):
    __tablename__ = "dms_docs"
    __table_args__ = (
        Index("ix_dms_batch", "batch_id"),
        Index("ix_dms_class", "doc_class"),
        Index("ix_dms_date", "doc_date"),
        Index("ix_dms_del", "deleted_at"),
        Index("ix_dms_group", "group_id", "version"),
        Index("ix_dms_review", "review"),
        Index("ix_dms_sha", "sha256"),
        Index("ix_dms_status", "status"),
        Index("ix_dms_thash", "text_hash"),
        Index("ix_dms_upl", "uploaded_by"),
    )
    doc_id = Column(Integer, primary_key=True)
    sha256 = Column(Text, nullable=False)
    store_key = Column(Text, nullable=False)
    enc = Column(Integer, nullable=False, default=0)
    size = Column(Integer, nullable=False, default=0)
    mime = Column(Text)
    ext = Column(Text)
    kind = Column(Text)
    original_name = Column(Text)
    rel_path = Column(Text)
    status = Column(Text, nullable=False, default="queued")
    status_note = Column(Text)
    warnings = Column(Text)
    page_count = Column(Integer, nullable=False, default=0)
    page_kind = Column(Text)
    method = Column(Text)
    ocr_pages = Column(Integer, nullable=False, default=0)
    ocr_conf = Column(Float)
    doc_class = Column(Text)
    class_conf = Column(Float)
    class_src = Column(Text, nullable=False, default="auto")
    class_evidence = Column(Text)
    review = Column(Text)
    meta = Column(Text)
    doc_date = Column(Text)
    next_hearing = Column(Text)
    parties = Column(Text)
    court = Column(Text)
    case_keys = Column(Text)
    text_hash = Column(Text)
    group_id = Column(Integer, nullable=False)
    version = Column(Integer, nullable=False, default=1)
    is_current = Column(Integer, nullable=False, default=1)
    version_note = Column(Text)
    batch_id = Column(Text)
    uploaded_by = Column(Integer)
    tags = Column(Text)
    legal_hold = Column(Integer, nullable=False, default=0)
    deleted_at = Column(Text)
    deleted_by = Column(Integer)
    created_at = Column(Text, nullable=False, server_default=sql_text("CURRENT_TIMESTAMP"))
    updated_at = Column(Text)
    processed_at = Column(Text)


class DmsPage(db.Model):
    __tablename__ = "dms_pages"
    doc_id = Column(Integer, primary_key=True)
    page_no = Column(Integer, primary_key=True)
    text = Column(Text, nullable=False)
    keys = Column(Text, nullable=False, default="")


class DmsJob(db.Model):
    __tablename__ = "dms_jobs"
    __table_args__ = (
        Index("ix_dms_jobs_doc", "doc_id"),
        Index("ix_dms_jobs_q", "status", "run_after", "id"),
    )
    id = Column(Integer, primary_key=True, autoincrement=True)
    doc_id = Column(Integer, nullable=False)
    kind = Column(Text, nullable=False, default="extract")
    status = Column(Text, nullable=False, default="queued")
    attempts = Column(Integer, nullable=False, default=0)
    run_after = Column(Float, nullable=False, default=0)
    locked_by = Column(Text)
    locked_at = Column(Float)
    error = Column(Text)
    created_at = Column(Float, nullable=False)
    finished_at = Column(Float)


class DmsKv(db.Model):
    __tablename__ = "dms_kv"
    k = Column(Text, primary_key=True)
    v = Column(Text)


class DmsLocation(db.Model):
    __tablename__ = "dms_locations"
    __table_args__ = (Index("ix_dms_loc_scope", "scope", "parent_id"),)
    id = Column(Integer, primary_key=True)
    scope = Column(Text, nullable=False)
    parent_id = Column(Integer)
    name = Column(Text, nullable=False)
    kind = Column(Text, nullable=False, default="almirah")
    code = Column(Text)
    notes = Column(Text)
    archived = Column(Integer, nullable=False, default=0)
    created_by = Column(Integer)
    created_at = Column(Text, nullable=False)


class DmsFilePrefs(db.Model):
    __tablename__ = "dms_file_prefs"
    user_id = Column(Integer, primary_key=True)
    auto_file = Column(Integer, nullable=False, default=1)


class DmsFiling(db.Model):
    __tablename__ = "dms_filing"
    __table_args__ = (Index("ix_dms_filing_owner", "owner_id", "state"),)
    doc_id = Column(Integer, primary_key=True)
    owner_id = Column(Integer, nullable=False)
    state = Column(Text, nullable=False)
    top_ref = Column(Text)
    top_score = Column(Float)
    candidates = Column(Text)
    note = Column(Text)
    sig = Column(Text)
    evaluated_at = Column(Text)
    decided_by = Column(Integer)
    decided_at = Column(Text)
    filed_ref = Column(Text)
    prev_ref = Column(Text)
    via = Column(Text)


class DmsPfile(db.Model):
    __tablename__ = "dms_pfiles"
    __table_args__ = (
        UniqueConstraint("scope", "seq"),
        Index("ix_dms_pf_case", "case_ref"),
        Index("ix_dms_pf_due", "status", "due_at"),
        Index("ix_dms_pf_loc", "location_id"),
        Index("ix_dms_pf_scope", "scope", "status"),
    )
    id = Column(Integer, primary_key=True)
    scope = Column(Text, nullable=False)
    seq = Column(Integer, nullable=False)
    file_no = Column(Text, nullable=False)
    token = Column(Text, nullable=False, unique=True)
    title = Column(Text, nullable=False)
    kind = Column(Text, nullable=False, default="file")
    case_ref = Column(Text)
    case_label = Column(Text)
    client = Column(Text)
    location_id = Column(Integer)
    location_note = Column(Text)
    status = Column(Text, nullable=False, default="in")
    holder = Column(Text)
    holder_user_id = Column(Integer)
    issued_at = Column(Text)
    due_at = Column(Text)
    pages_est = Column(Integer)
    notes = Column(Text)
    created_by = Column(Integer)
    created_at = Column(Text, nullable=False)
    updated_at = Column(Text, nullable=False)
    archived_at = Column(Text)


class DmsPfileDoc(db.Model):
    __tablename__ = "dms_pfile_docs"
    __table_args__ = (Index("ix_dms_pfd_doc", "doc_id"),)
    pfile_id = Column(Integer, primary_key=True)
    doc_id = Column(Integer, primary_key=True)
    linked_by = Column(Integer)
    linked_at = Column(Text, nullable=False)


class DmsPfileMove(db.Model):
    __tablename__ = "dms_pfile_moves"
    __table_args__ = (Index("ix_dms_pfm_file", "pfile_id", "id"),)
    id = Column(Integer, primary_key=True, autoincrement=True)
    pfile_id = Column(Integer, nullable=False)
    action = Column(Text, nullable=False)
    actor_id = Column(Integer)
    actor_name = Column(Text)
    from_holder = Column(Text)
    to_holder = Column(Text)
    from_loc = Column(Text)
    to_loc = Column(Text)
    due_at = Column(Text)
    note = Column(Text)
    at = Column(Text, nullable=False)


class DmsBundle(db.Model):
    __tablename__ = "dms_bundles"
    __table_args__ = (Index("ix_dms_bundles_scope", "scope", "updated_at"),)
    id = Column(Integer, primary_key=True)
    scope = Column(Text, nullable=False)
    owner_id = Column(Integer, nullable=False)
    title = Column(Text, nullable=False)
    case_ref = Column(Text)
    options = Column(Text, nullable=False, default="{}")
    status = Column(Text, nullable=False, default="draft")
    build_state = Column(Text, nullable=False, default="idle")
    build_note = Column(Text)
    progress = Column(Float, nullable=False, default=0)
    built_at = Column(Text)
    built_pages = Column(Integer)
    built_size = Column(Integer)
    built_sha = Column(Text)
    built_key = Column(Text)
    built_enc = Column(Integer, nullable=False, default=0)
    built_warnings = Column(Text)
    built_fp = Column(Text)
    saved_doc_id = Column(Integer)
    created_at = Column(Text, nullable=False)
    updated_at = Column(Text, nullable=False)


class DmsBundleItem(db.Model):
    __tablename__ = "dms_bundle_items"
    __table_args__ = (
        Index("ix_dms_bi_bundle", "bundle_id", "seq"),
        Index("ix_dms_bi_doc", "doc_id"),
    )
    id = Column(Integer, primary_key=True)
    bundle_id = Column(Integer, nullable=False)
    seq = Column(Integer, nullable=False)
    kind = Column(Text, nullable=False, default="doc")
    doc_id = Column(Integer)
    title = Column(Text)
    label = Column(Text)
    pages = Column(Text)
    note = Column(Text)
    in_index = Column(Integer, nullable=False, default=1)


class DmsScanSession(db.Model):
    __tablename__ = "dms_scan_sessions"
    __table_args__ = (Index("ix_dms_scan_owner", "owner_id", "status"),)
    id = Column(Text, primary_key=True)
    scope = Column(Text, nullable=False)
    owner_id = Column(Integer, nullable=False)
    status = Column(Text, nullable=False, default="open")
    state = Column(Text, nullable=False, default="{}")
    created_at = Column(Text, nullable=False)
    updated_at = Column(Text, nullable=False)


class DmsScanPage(db.Model):
    __tablename__ = "dms_scan_pages"
    __table_args__ = (
        Index("ix_dms_scanp_q", "status", "id"),
        Index("ix_dms_scanp_sess", "session_id", "seq"),
    )
    id = Column(Integer, primary_key=True)
    session_id = Column(Text, nullable=False)
    seq = Column(Integer, nullable=False)
    src_name = Column(Text)
    src_kind = Column(Text)
    status = Column(Text, nullable=False, default="queued")
    error = Column(Text)
    w = Column(Integer)
    h = Column(Integer)
    text = Column(Text)
    info = Column(Text)
    created_at = Column(Text, nullable=False)


# ──────────────────────────────────────────────────────────────────
# LPMS (Legal Practice Management System — firm-scoped case module)
# ──────────────────────────────────────────────────────────────────
class LpmsFirm(db.Model):
    __tablename__ = "lpms_firms"
    id = Column(Integer, primary_key=True)
    name = Column(Text, nullable=False)
    owner_user_id = Column(Integer, nullable=False)
    settings = Column(Text, nullable=False, default="{}")
    created_at = Column(Text, nullable=False)


class LpmsMember(db.Model):
    __tablename__ = "lpms_members"
    __table_args__ = (Index("lpms_members_firm", "firm_id"),)
    id = Column(Integer, primary_key=True)
    firm_id = Column(Integer, nullable=False)
    user_id = Column(Integer, nullable=False)
    role = Column(Text, nullable=False)
    name = Column(Text, nullable=False)
    email = Column(Text)
    phone = Column(Text)
    active = Column(Integer, nullable=False, default=1)
    email_notify = Column(Integer, nullable=False, default=1)
    managed = Column(Integer, nullable=False, default=0)
    created_by = Column(Integer)
    created_at = Column(Text, nullable=False)
    last_seen = Column(Text)


class LpmsCurrent(db.Model):
    __tablename__ = "lpms_current"
    user_id = Column(Integer, primary_key=True)
    member_id = Column(Integer, nullable=False)


class LpmsClient(db.Model):
    __tablename__ = "lpms_clients"
    __table_args__ = (Index("lpms_clients_firm", "firm_id", "archived"),)
    id = Column(Integer, primary_key=True)
    firm_id = Column(Integer, nullable=False)
    name = Column(Text, nullable=False)
    phone = Column(Text)
    email = Column(Text)
    address = Column(Text)
    id_type = Column(Text)
    id_number = Column(Text)
    occupation = Column(Text)
    comm_pref = Column(Text)
    notes = Column(Text)
    archived = Column(Integer, nullable=False, default=0)
    created_by = Column(Integer)
    created_at = Column(Text, nullable=False)
    updated_at = Column(Text, nullable=False)


class LpmsCase(db.Model):
    __tablename__ = "lpms_cases"
    __table_args__ = (
        Index("lpms_cases_adv", "firm_id", "advocate_id"),
        Index("lpms_cases_client", "client_id"),
        Index("lpms_cases_firm", "firm_id", "archived_at"),
        Index("lpms_cases_key", "firm_id", "case_key"),
        Index("lpms_cases_team", "team_id"),
    )
    id = Column(Integer, primary_key=True)
    firm_id = Column(Integer, nullable=False)
    case_no = Column(Text, nullable=False)
    case_key = Column(Text, nullable=False)
    court = Column(Text, nullable=False)
    title = Column(Text, nullable=False)
    category = Column(Text)
    case_type = Column(Text, nullable=False, default="Civil")
    filing_date = Column(Text)
    reg_no = Column(Text)
    hall_no = Column(Text)
    judge = Column(Text)
    opposite_party = Column(Text)
    client_id = Column(Integer)
    advocate_id = Column(Integer)
    priority = Column(Text, nullable=False, default="normal")
    status = Column(Text, nullable=False, default="Active")
    next_action = Column(Text)
    next_action_due = Column(Text)
    remarks = Column(Text)
    restricted = Column(Integer, nullable=False, default=0)
    outcome = Column(Text)
    closed_at = Column(Text)
    archived_at = Column(Text)
    created_by = Column(Integer)
    created_at = Column(Text, nullable=False)
    updated_at = Column(Text, nullable=False)
    team_id = Column(Integer)


class LpmsParty(db.Model):
    __tablename__ = "lpms_parties"
    __table_args__ = (Index("lpms_parties_case", "case_id"),)
    id = Column(Integer, primary_key=True)
    case_id = Column(Integer, nullable=False)
    role = Column(Text, nullable=False)
    name = Column(Text, nullable=False)
    contact = Column(Text)
    notes = Column(Text)
    created_at = Column(Text, nullable=False)


class LpmsHearing(db.Model):
    __tablename__ = "lpms_hearings"
    __table_args__ = (
        Index("lpms_hearings_case", "case_id", "hearing_date"),
        Index("lpms_hearings_date", "firm_id", "hearing_date"),
    )
    id = Column(Integer, primary_key=True)
    firm_id = Column(Integer, nullable=False)
    case_id = Column(Integer, nullable=False)
    hearing_date = Column(Text, nullable=False)
    hearing_time = Column(Text)
    court = Column(Text)
    hall_no = Column(Text)
    judge = Column(Text)
    purpose = Column(Text)
    serial_no = Column(Text)
    advocate_id = Column(Integer)
    status = Column(Text, nullable=False, default="scheduled")
    note = Column(Text)
    created_by = Column(Integer)
    created_at = Column(Text, nullable=False)
    updated_at = Column(Text, nullable=False)


class LpmsProceeding(db.Model):
    __tablename__ = "lpms_proceedings"
    __table_args__ = (Index("lpms_proc_case", "case_id", "proc_date"),)
    id = Column(Integer, primary_key=True)
    firm_id = Column(Integer, nullable=False)
    case_id = Column(Integer, nullable=False)
    hearing_id = Column(Integer)
    proc_date = Column(Text, nullable=False)
    outcome = Column(Text)
    notes = Column(Text)
    observations = Column(Text)
    orders = Column(Text)
    next_date = Column(Text)
    next_purpose = Column(Text)
    author_id = Column(Integer)
    created_at = Column(Text, nullable=False)
    edited_at = Column(Text)


class LpmsTimeline(db.Model):
    __tablename__ = "lpms_timeline"
    __table_args__ = (Index("lpms_timeline_case", "case_id", "id"),)
    id = Column(Integer, primary_key=True)
    firm_id = Column(Integer, nullable=False)
    case_id = Column(Integer, nullable=False)
    kind = Column(Text, nullable=False)
    title = Column(Text, nullable=False)
    detail = Column(Text)
    actor_id = Column(Integer)
    ref_id = Column(Integer)
    at = Column(Text, nullable=False)


class LpmsNote(db.Model):
    __tablename__ = "lpms_notes"
    __table_args__ = (Index("lpms_notes_case", "case_id"),)
    id = Column(Integer, primary_key=True)
    firm_id = Column(Integer, nullable=False)
    case_id = Column(Integer)
    client_id = Column(Integer)
    author_id = Column(Integer)
    body = Column(Text, nullable=False)
    pinned = Column(Integer, nullable=False, default=0)
    created_at = Column(Text, nullable=False)
    edited_at = Column(Text)


class LpmsComm(db.Model):
    __tablename__ = "lpms_comms"
    __table_args__ = (
        Index("lpms_comms_case", "case_id"),
        Index("lpms_comms_client", "client_id"),
    )
    id = Column(Integer, primary_key=True)
    firm_id = Column(Integer, nullable=False)
    case_id = Column(Integer)
    client_id = Column(Integer)
    channel = Column(Text, nullable=False)
    direction = Column(Text, nullable=False, default="out")
    subject = Column(Text)
    body = Column(Text)
    status = Column(Text, nullable=False, default="logged")
    to_addr = Column(Text)
    created_by = Column(Integer)
    created_at = Column(Text, nullable=False)


class LpmsFollowup(db.Model):
    __tablename__ = "lpms_followups"
    __table_args__ = (Index("lpms_followups_due", "firm_id", "status", "due_date"),)
    id = Column(Integer, primary_key=True)
    firm_id = Column(Integer, nullable=False)
    client_id = Column(Integer)
    case_id = Column(Integer)
    due_date = Column(Text, nullable=False)
    note = Column(Text, nullable=False)
    channel = Column(Text)
    assignee_id = Column(Integer)
    status = Column(Text, nullable=False, default="open")
    created_by = Column(Integer)
    created_at = Column(Text, nullable=False)
    done_at = Column(Text)


class LpmsRti(db.Model):
    __tablename__ = "lpms_rti"
    __table_args__ = (Index("lpms_rti_firm", "firm_id", "status"),)
    id = Column(Integer, primary_key=True)
    firm_id = Column(Integer, nullable=False)
    case_id = Column(Integer)
    client_id = Column(Integer)
    subject = Column(Text, nullable=False)
    department = Column(Text, nullable=False)
    pio = Column(Text)
    reference_no = Column(Text)
    filing_date = Column(Text)
    mode = Column(Text)
    fee = Column(Text)
    response_due = Column(Text)
    response_date = Column(Text)
    appeal_due = Column(Text)
    appeal1_date = Column(Text)
    appeal2_due = Column(Text)
    appeal2_date = Column(Text)
    status = Column(Text, nullable=False, default="draft")
    outcome = Column(Text)
    assignee_id = Column(Integer)
    notes = Column(Text)
    created_by = Column(Integer)
    created_at = Column(Text, nullable=False)
    updated_at = Column(Text, nullable=False)


class LpmsRtiEvent(db.Model):
    __tablename__ = "lpms_rti_events"
    __table_args__ = (Index("lpms_rti_events_rti", "rti_id", "id"),)
    id = Column(Integer, primary_key=True)
    rti_id = Column(Integer, nullable=False)
    kind = Column(Text, nullable=False)
    note = Column(Text)
    actor_id = Column(Integer)
    at = Column(Text, nullable=False)


class LpmsEvent(db.Model):
    __tablename__ = "lpms_events"
    __table_args__ = (Index("lpms_events_date", "firm_id", "start_date"),)
    id = Column(Integer, primary_key=True)
    firm_id = Column(Integer, nullable=False)
    kind = Column(Text, nullable=False)
    title = Column(Text, nullable=False)
    start_date = Column(Text, nullable=False)
    end_date = Column(Text)
    start_time = Column(Text)
    end_time = Column(Text)
    location = Column(Text)
    notes = Column(Text)
    case_id = Column(Integer)
    client_id = Column(Integer)
    member_id = Column(Integer)
    created_by = Column(Integer)
    created_at = Column(Text, nullable=False)


class LpmsNotification(db.Model):
    __tablename__ = "lpms_notifications"
    __table_args__ = (Index("lpms_notif_user", "user_id", "read_at", "id"),)
    id = Column(Integer, primary_key=True)
    firm_id = Column(Integer, nullable=False)
    user_id = Column(Integer, nullable=False)
    kind = Column(Text, nullable=False)
    title = Column(Text, nullable=False)
    body = Column(Text)
    link = Column(Text)
    case_id = Column(Integer)
    dedupe_key = Column(Text)
    created_at = Column(Text, nullable=False)
    read_at = Column(Text)


class LpmsOutbox(db.Model):
    __tablename__ = "lpms_outbox"
    __table_args__ = (Index("lpms_outbox_status", "status", "id"),)
    id = Column(Integer, primary_key=True)
    firm_id = Column(Integer, nullable=False)
    to_user_id = Column(Integer)
    to_name = Column(Text)
    to_email = Column(Text, nullable=False)
    subject = Column(Text, nullable=False)
    body = Column(Text, nullable=False)
    kind = Column(Text)
    dedupe_key = Column(Text, unique=True)
    status = Column(Text, nullable=False, default="pending")
    attempts = Column(Integer, nullable=False, default=0)
    error = Column(Text)
    created_at = Column(Text, nullable=False)
    sent_at = Column(Text)


class LpmsAudit(db.Model):
    __tablename__ = "lpms_audit"
    __table_args__ = (Index("lpms_audit_firm", "firm_id", "id"),)
    id = Column(Integer, primary_key=True)
    firm_id = Column(Integer, nullable=False)
    user_id = Column(Integer)
    actor = Column(Text)
    action = Column(Text, nullable=False)
    entity = Column(Text)
    entity_id = Column(Integer)
    summary = Column(Text)
    detail = Column(Text)
    ip = Column(Text)
    at = Column(Text, nullable=False)
    prev_hash = Column(Text, nullable=False)
    hash = Column(Text, nullable=False)


class LpmsMfa(db.Model):
    __tablename__ = "lpms_mfa"
    user_id = Column(Integer, primary_key=True)
    secret = Column(Text, nullable=False)
    enabled = Column(Integer, nullable=False, default=0)
    last_step = Column(Integer, nullable=False, default=0)
    recovery = Column(Text, nullable=False, default="[]")
    failures = Column(Integer, nullable=False, default=0)
    locked_until = Column(Float, nullable=False, default=0)
    created_at = Column(Text, nullable=False)
    enabled_at = Column(Text)


class LpmsReminderRun(db.Model):
    __tablename__ = "lpms_reminder_runs"
    firm_id = Column(Integer, primary_key=True)
    ran_at = Column(Float, nullable=False)
    summary = Column(Text)


# ──────────────────────────────────────────────────────────────────
# All concrete model classes exported for the consolidation script.
# FTS virtual tables (dms_fts, dms_meta_fts + their shadow tables)
# are intentionally omitted — their function is replaced by Postgres
# tsvector columns in a later phase.
# ──────────────────────────────────────────────────────────────────
__all__ = [
    "CaseVault", "VaultFolder", "DocumentVaultShare", "VaultAudit", "VaultProvenance",
    "Team", "TeamMembership", "Matter", "Deadline", "TaskMatter", "HandoffNote", "MatterActivity",
    "Letterhead", "SavedDraft", "ContractAnalysis", "DocumentChunkLegacy", "ChatHistory",
    "CalendarEvent", "UserNotificationSettings",
    "ConflictClearanceMemo",
    "DmsDoc", "DmsPage", "DmsJob", "DmsKv", "DmsLocation", "DmsFilePrefs", "DmsFiling",
    "DmsPfile", "DmsPfileDoc", "DmsPfileMove",
    "DmsBundle", "DmsBundleItem", "DmsScanSession", "DmsScanPage",
    "LpmsFirm", "LpmsMember", "LpmsCurrent", "LpmsClient", "LpmsCase", "LpmsParty",
    "LpmsHearing", "LpmsProceeding", "LpmsTimeline", "LpmsNote", "LpmsComm", "LpmsFollowup",
    "LpmsRti", "LpmsRtiEvent", "LpmsEvent", "LpmsNotification", "LpmsOutbox", "LpmsAudit",
    "LpmsMfa", "LpmsReminderRun",
]
