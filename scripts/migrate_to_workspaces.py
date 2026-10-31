"""Migrate pre-existing cases + unscoped data into the workspaces model.

Phase 7 of the workspaces-refactor. Idempotent — can be re-run safely.

Flow:
  1. For every lpms_cases row that doesn't already have a corresponding
     workspace (match on firm_id + case_no), create a Workspace. The
     workspace creator becomes an "owner" member via workspace_members.
  2. For every matter in `matters` that doesn't match an lpms_case,
     create a Workspace in the user's default firm.
  3. Record the mapping old_lpms_case_id -> new_workspace_id and
     old_matter_id -> new_workspace_id in `_lx_migration_map`.
  4. Backfill child tables that currently have workspace_id = NULL:
     - case_vault, vault_folders, draft_sessions, contract_analyses,
       calendar_events, letterheads, conflict_clearance_memos,
       chat_history, dms_docs, document_chunks
     Assigns workspace_id based on:
       (a) case_vault.case_id == 'matter:<id>'  ->  mapped workspace
       (b) owner_user_id's default workspace     ->  fallback

Register as `flask db-migrate-workspaces`. --dry-run prints counts only.
"""
from __future__ import annotations
import sqlite3
import time
from pathlib import Path

import click
from flask.cli import with_appcontext
from flask import current_app

REPO_ROOT = Path(__file__).resolve().parents[1]


def _db_path() -> str:
    return current_app.extensions.get("lpms_db_path") or str(REPO_ROOT / "instance" / "database.db")


def _conn():
    conn = sqlite3.connect(_db_path())
    conn.row_factory = sqlite3.Row
    return conn


# ──────────────────────────────────────────────────────────────────
# Core migration steps
# ──────────────────────────────────────────────────────────────────
def _ensure_map_table(conn) -> None:
    conn.execute(
        """CREATE TABLE IF NOT EXISTS _lx_migration_map (
            kind TEXT NOT NULL,            -- 'lpms_case' | 'matter'
            old_id INTEGER NOT NULL,
            new_workspace_id INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (kind, old_id)
        )"""
    )


def _default_workspace_for_user(conn, user_id: int) -> int | None:
    """Return the first workspace the user owns or belongs to, or None."""
    # First: a workspace they created.
    r = conn.execute(
        "SELECT id FROM workspaces WHERE created_by = ? ORDER BY id ASC LIMIT 1",
        (user_id,),
    ).fetchone()
    if r:
        return r["id"]
    # Second: a workspace they're a member of via lpms_members -> workspace_members.
    r = conn.execute(
        "SELECT wm.workspace_id "
        "FROM workspace_members wm "
        "JOIN lpms_members lm ON lm.id = wm.firm_member_id "
        "WHERE lm.user_id = ? AND lm.active = 1 "
        "ORDER BY wm.workspace_id ASC LIMIT 1",
        (user_id,),
    ).fetchone()
    return r["workspace_id"] if r else None


def _create_workspaces_from_lpms(conn, dry_run: bool) -> int:
    cases = conn.execute(
        "SELECT id, firm_id, case_no, court, title, case_type, client_id, created_by "
        "FROM lpms_cases WHERE archived_at IS NULL",
    ).fetchall()
    created = 0
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    for c in cases:
        # Already migrated?
        mapped = conn.execute(
            "SELECT new_workspace_id FROM _lx_migration_map WHERE kind='lpms_case' AND old_id=?",
            (c["id"],),
        ).fetchone()
        if mapped:
            continue
        # Does a workspace with the same firm_id + case_no already exist?
        existing = conn.execute(
            "SELECT id FROM workspaces WHERE firm_id = ? AND case_no = ? LIMIT 1",
            (c["firm_id"], c["case_no"]),
        ).fetchone()
        if existing:
            conn.execute(
                "INSERT OR IGNORE INTO _lx_migration_map (kind, old_id, new_workspace_id, created_at) "
                "VALUES ('lpms_case', ?, ?, ?)",
                (c["id"], existing["id"], now),
            )
            continue
        if dry_run:
            created += 1
            continue
        name = c["title"] or f"Case {c['case_no']}"
        cur = conn.execute(
            "INSERT INTO workspaces (firm_id, name, case_no, court, case_type, client_id, "
            "lead_counsel_user_id, status, created_by, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)",
            (c["firm_id"], name[:200], c["case_no"], c["court"], c["case_type"],
             c["client_id"], c["created_by"], c["created_by"], now, now),
        )
        new_ws_id = cur.lastrowid
        # Add creator as owner (via their lpms_members row in this firm).
        mem = conn.execute(
            "SELECT id FROM lpms_members WHERE firm_id = ? AND user_id = ? AND active = 1 LIMIT 1",
            (c["firm_id"], c["created_by"]),
        ).fetchone()
        if mem:
            conn.execute(
                "INSERT OR IGNORE INTO workspace_members "
                "(workspace_id, firm_member_id, role, added_by, added_at) "
                "VALUES (?, ?, 'owner', ?, ?)",
                (new_ws_id, mem["id"], c["created_by"], now),
            )
        conn.execute(
            "INSERT INTO _lx_migration_map (kind, old_id, new_workspace_id, created_at) "
            "VALUES ('lpms_case', ?, ?, ?)",
            (c["id"], new_ws_id, now),
        )
        created += 1
    return created


def _create_workspaces_from_matters(conn, dry_run: bool) -> int:
    """`matters` are the older model — create workspaces for any not already
    covered by lpms_cases (dedupe by title + owner_user_id)."""
    matters = conn.execute(
        "SELECT id, title, owner_user_id, team_id, opened_date FROM matters",
    ).fetchall()
    created = 0
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    for m in matters:
        mapped = conn.execute(
            "SELECT new_workspace_id FROM _lx_migration_map WHERE kind='matter' AND old_id=?",
            (m["id"],),
        ).fetchone()
        if mapped:
            continue
        # Find a firm for this user — use their first active lpms_members row.
        fm = conn.execute(
            "SELECT firm_id, id FROM lpms_members WHERE user_id = ? AND active = 1 LIMIT 1",
            (m["owner_user_id"],),
        ).fetchone()
        if not fm:
            continue  # No firm -> cannot create a workspace
        # Dedupe by same name in same firm.
        existing = conn.execute(
            "SELECT id FROM workspaces WHERE firm_id = ? AND name = ? LIMIT 1",
            (fm["firm_id"], (m["title"] or "")[:200]),
        ).fetchone()
        if existing:
            conn.execute(
                "INSERT OR IGNORE INTO _lx_migration_map (kind, old_id, new_workspace_id, created_at) "
                "VALUES ('matter', ?, ?, ?)",
                (m["id"], existing["id"], now),
            )
            continue
        if dry_run:
            created += 1
            continue
        cur = conn.execute(
            "INSERT INTO workspaces (firm_id, name, status, created_by, created_at, updated_at) "
            "VALUES (?, ?, 'active', ?, ?, ?)",
            (fm["firm_id"], (m["title"] or f"Matter {m['id']}")[:200], m["owner_user_id"], now, now),
        )
        new_ws_id = cur.lastrowid
        conn.execute(
            "INSERT OR IGNORE INTO workspace_members "
            "(workspace_id, firm_member_id, role, added_by, added_at) "
            "VALUES (?, ?, 'owner', ?, ?)",
            (new_ws_id, fm["id"], m["owner_user_id"], now),
        )
        conn.execute(
            "INSERT INTO _lx_migration_map (kind, old_id, new_workspace_id, created_at) "
            "VALUES ('matter', ?, ?, ?)",
            (m["id"], new_ws_id, now),
        )
        created += 1
    return created


def _backfill_table(conn, table: str, dry_run: bool,
                    owner_col: str = "user_id", id_col: str = "id") -> int:
    """Give every row with workspace_id=NULL a workspace assignment, based on
    the row's owner's default workspace."""
    try:
        rows = conn.execute(
            f"SELECT {id_col} AS __id, {owner_col} AS __u FROM {table} "
            f"WHERE workspace_id IS NULL AND {owner_col} IS NOT NULL"
        ).fetchall()
    except sqlite3.OperationalError:
        return 0  # table missing or column missing — skip
    updated = 0
    # Cache per-user default workspace to avoid n×lookup
    cache: dict[int, int | None] = {}
    for r in rows:
        try:
            uid = int(r["__u"])
        except (TypeError, ValueError):
            continue
        if uid not in cache:
            cache[uid] = _default_workspace_for_user(conn, uid)
        wid = cache[uid]
        if wid is None:
            continue
        if dry_run:
            updated += 1
            continue
        conn.execute(
            f"UPDATE {table} SET workspace_id = ? WHERE {id_col} = ? AND workspace_id IS NULL",
            (wid, r["__id"]),
        )
        updated += 1
    return updated


def _backfill_case_vault_from_matter_ref(conn, dry_run: bool) -> int:
    """case_vault rows with case_id = 'matter:<id>' can be assigned to the
    workspace mapped from that matter, overriding the owner-default."""
    rows = conn.execute(
        "SELECT cv.id, cv.case_id FROM case_vault cv "
        "WHERE cv.workspace_id IS NULL AND cv.case_id LIKE 'matter:%'"
    ).fetchall()
    updated = 0
    for r in rows:
        try:
            old_matter_id = int(r["case_id"].split(":", 1)[1])
        except (ValueError, IndexError):
            continue
        mapped = conn.execute(
            "SELECT new_workspace_id FROM _lx_migration_map "
            "WHERE kind='matter' AND old_id=?",
            (old_matter_id,),
        ).fetchone()
        if not mapped:
            continue
        if dry_run:
            updated += 1
            continue
        conn.execute(
            "UPDATE case_vault SET workspace_id = ? WHERE id = ? AND workspace_id IS NULL",
            (mapped["new_workspace_id"], r["id"]),
        )
        updated += 1
    return updated


# ──────────────────────────────────────────────────────────────────
# Flask CLI command
# ──────────────────────────────────────────────────────────────────
@click.command("db-migrate-workspaces")
@click.option("--dry-run", is_flag=True, help="Print planned changes without writing.")
@with_appcontext
def db_migrate_workspaces_command(dry_run: bool) -> None:
    """Migrate pre-existing cases + unscoped data into the workspaces model."""
    click.echo(f"Target DB: {_db_path()}")
    click.echo(f"Mode: {'DRY RUN (no writes)' if dry_run else 'LIVE WRITE'}")

    # Make sure the workspace_id columns exist before we query them.
    # init_db() in app.py is where the ALTER TABLEs live; it's only
    # auto-run from `python app.py`, not from the Flask CLI, so we
    # invoke it explicitly here.
    try:
        import app as _app_module
        _app_module.init_db()
    except Exception as _e:  # noqa: BLE001
        click.echo(f"warn: init_db() raised {type(_e).__name__}: {_e}")

    conn = _conn()
    try:
        _ensure_map_table(conn)
        if not dry_run:
            conn.commit()

        n_cases = _create_workspaces_from_lpms(conn, dry_run)
        verb = "would-create" if dry_run else "created"
        click.echo(f"[lpms_cases -> workspaces] {verb} {n_cases}")

        n_matters = _create_workspaces_from_matters(conn, dry_run)
        click.echo(f"[matters -> workspaces]    {verb} {n_matters}")

        # Backfill case_vault from matter: references first (more specific).
        n_cv_matter = _backfill_case_vault_from_matter_ref(conn, dry_run)
        vverb = "would-assign" if dry_run else "assigned"
        click.echo(f"[case_vault (matter:ref)]  {vverb} {n_cv_matter}")

        # Then the generic owner-default backfill across all tables.
        totals = {}
        for tbl, owner in [
            ("case_vault", "user_id"),
            ("vault_folders", "user_id"),
            ("draft_sessions", "user_id"),
            ("contract_analyses", "owner_user_id"),
            ("calendar_events", "owner_user_id"),
            ("letterheads", "owner_user_id"),
            ("conflict_clearance_memos", "owner_user_id"),
            ("chat_history", "user_id"),
            ("dms_docs", "uploaded_by"),
            ("document_chunks", "user_id"),
        ]:
            n = _backfill_table(conn, tbl, dry_run, owner_col=owner,
                                id_col="doc_id" if tbl == "dms_docs" else "id")
            totals[tbl] = n
            click.echo(f"[{tbl:<28}] {vverb} {n}")

        if not dry_run:
            conn.commit()
    finally:
        conn.close()
    click.echo("Done.")


def register(app) -> None:
    app.cli.add_command(db_migrate_workspaces_command)
