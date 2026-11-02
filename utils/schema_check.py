"""Read-only check: does this LOCAL SQLite file have the workspace_id columns the code expects?

It opens the file with SQLite's read-only URI (mode=ro), runs only PRAGMA table_info, and returns / logs what is missing.
It never writes, so it cannot change the database. Moving an old file to the workspace schema is the job of the official
migration, not of app start-up.
"""
from __future__ import annotations

import sqlite3

# Tables whose code reads or writes workspace_id.
WORKSPACE_TABLES = (
    "case_vault", "vault_folders", "contract_analyses", "draft_sessions", "calendar_events", "letterheads",
    "conflict_clearance_memos", "chat_history", "dms_docs", "document_chunks", "lpms_cases",
)


def missing_workspace_columns(engine) -> list[str]:
    """Names like 'draft_sessions.workspace_id' for tables that exist but lack the column.
    [] for non-SQLite, an in-memory database, or when the file cannot be opened read-only (the check is best effort)."""
    if engine.dialect.name != "sqlite":
        return []
    path = getattr(engine.url, "database", None)
    if not path or path == ":memory:":
        return []
    try:
        con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=2)
    except sqlite3.Error:
        return []
    try:
        missing = []
        for table in WORKSPACE_TABLES:
            cols = {r[1] for r in con.execute(f'PRAGMA table_info("{table}")')}
            if cols and "workspace_id" not in cols:          # no rows from PRAGMA = table does not exist: skip it
                missing.append(f"{table}.workspace_id")
        return missing
    except sqlite3.Error:
        return []
    finally:
        con.close()


def warn_if_local_schema_is_old(app, engine) -> list[str]:
    missing = missing_workspace_columns(engine)
    if missing:
        app.logger.warning("Local database is out of date (missing: %s). Use a fresh DB file; see docs/LOCAL_DATABASE.md. "
                           "Nothing was changed.", ", ".join(missing))
    return missing
