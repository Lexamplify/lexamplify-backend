"""Read-only check: does this LOCAL SQLite file have the workspace_id columns the code expects?

It only looks (PRAGMA table_info) and returns / logs what is missing. It never changes the database.
Moving an old file to the workspace schema is the job of the official migration, not of app start-up.
"""
from __future__ import annotations

from sqlalchemy import inspect

# Tables whose code reads or writes workspace_id.
WORKSPACE_TABLES = (
    "case_vault", "vault_folders", "contract_analyses", "draft_sessions", "calendar_events", "letterheads",
    "conflict_clearance_memos", "chat_history", "dms_docs", "document_chunks", "lpms_cases",
)


def missing_workspace_columns(engine) -> list[str]:
    """Names like 'draft_sessions.workspace_id' for tables that exist but lack the column. [] for non-SQLite or when up to date."""
    if engine.dialect.name != "sqlite":
        return []
    insp = inspect(engine)
    present = set(insp.get_table_names())
    return [f"{t}.workspace_id" for t in WORKSPACE_TABLES
            if t in present and "workspace_id" not in {c["name"] for c in insp.get_columns(t)}]


def warn_if_local_schema_is_old(app, engine) -> list[str]:
    missing = missing_workspace_columns(engine)
    if missing:
        app.logger.warning("Local database is out of date (missing: %s). Use a fresh DB file; see docs/local-database-setup.md. "
                           "Nothing was changed.", ", ".join(missing))
    return missing
