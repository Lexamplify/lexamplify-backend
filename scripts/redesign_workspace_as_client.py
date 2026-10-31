"""Collapse the per-case workspaces into one workspace per CLIENT.

Phase 7 of workspaces-refactor was: 1 lpms_case -> 1 workspace. User
feedback: no, 1 CLIENT -> 1 workspace, with N cases visible inside it.
This migration does the collapse, idempotently.

Flow:
  1. Walk every active workspace that has a client_id set.
  2. Group by (firm_id, client_id). For each group:
       a. Elect the oldest workspace as the "canonical" one (its id is
          kept, so URLs and existing session storage keep working).
       b. Rename it to the client's lpms_clients.name.
       c. Fill in client_type, client_contact_email, phone, address
          from lpms_clients.
       d. For every other workspace in the group:
            - re-point workspace_members rows to the canonical workspace
              (dedup: skip if a membership for the same firm_member_id
              already exists on the canonical);
            - re-point every data table's workspace_id (case_vault,
              vault_folders, draft_sessions, contract_analyses,
              calendar_events, letterheads, conflict_clearance_memos,
              chat_history, dms_docs, document_chunks);
            - update _lx_migration_map rows that pointed to the
              non-canonical ws so lpms_case<->workspace lookups still
              work;
            - archive the non-canonical workspace (status='archived')
              rather than deleting (preserves audit history).
  3. Backfill lpms_cases.workspace_id by joining through client_id ->
     canonical workspace.

Register as `flask db-redesign-client-workspaces`.
"""
from __future__ import annotations
import sqlite3
import time
from pathlib import Path

import click
from flask import current_app
from flask.cli import with_appcontext


REPO_ROOT = Path(__file__).resolve().parents[1]


def _db_path() -> str:
    return current_app.extensions.get("lpms_db_path") or str(REPO_ROOT / "instance" / "database.db")


def _conn():
    conn = sqlite3.connect(_db_path())
    conn.row_factory = sqlite3.Row
    return conn


DATA_TABLES_WITH_WORKSPACE_ID = [
    "case_vault", "vault_folders", "draft_sessions", "contract_analyses",
    "calendar_events", "letterheads", "conflict_clearance_memos",
    "chat_history", "dms_docs", "document_chunks",
]


def _collapse_groups(conn, dry_run: bool) -> dict:
    """Group workspaces by (firm_id, client_id). For each group pick a
    canonical workspace and re-point everything to it."""
    stats = {"groups": 0, "collapsed": 0, "archived": 0, "data_rows": 0, "members": 0}
    groups: dict[tuple, list] = {}
    for row in conn.execute(
        "SELECT id, firm_id, client_id, name, created_at FROM workspaces "
        "WHERE status = 'active' AND client_id IS NOT NULL "
        "ORDER BY created_at ASC"
    ).fetchall():
        key = (row["firm_id"], row["client_id"])
        groups.setdefault(key, []).append(row)

    stats["groups"] = len(groups)
    for (firm_id, client_id), rows in groups.items():
        if len(rows) < 2:
            continue  # already one-per-client
        canonical = rows[0]
        extras = rows[1:]
        stats["collapsed"] += len(extras)

        # Fill in client metadata on the canonical workspace from lpms_clients.
        client = conn.execute(
            "SELECT name, phone, email, address, id_type, notes FROM lpms_clients WHERE id = ?",
            (client_id,),
        ).fetchone()
        if client:
            new_name = client["name"] or canonical["name"]
            if dry_run:
                pass
            else:
                conn.execute(
                    "UPDATE workspaces SET name = ?, "
                    "client_contact_email = COALESCE(?, client_contact_email), "
                    "client_contact_phone = COALESCE(?, client_contact_phone), "
                    "client_address = COALESCE(?, client_address), "
                    "client_notes = COALESCE(?, client_notes), "
                    "updated_at = CURRENT_TIMESTAMP "
                    "WHERE id = ?",
                    (new_name[:200], client["email"], client["phone"],
                     client["address"], client["notes"], canonical["id"]),
                )

        for extra in extras:
            # Re-point workspace_members to canonical (skip duplicates).
            existing = {
                r["firm_member_id"] for r in conn.execute(
                    "SELECT firm_member_id FROM workspace_members WHERE workspace_id = ?",
                    (canonical["id"],),
                ).fetchall()
            }
            moved_members = conn.execute(
                "SELECT id, firm_member_id FROM workspace_members WHERE workspace_id = ?",
                (extra["id"],),
            ).fetchall()
            for wm in moved_members:
                if wm["firm_member_id"] in existing:
                    if not dry_run:
                        conn.execute("DELETE FROM workspace_members WHERE id = ?", (wm["id"],))
                else:
                    if not dry_run:
                        conn.execute(
                            "UPDATE workspace_members SET workspace_id = ? WHERE id = ?",
                            (canonical["id"], wm["id"]),
                        )
                    existing.add(wm["firm_member_id"])
                stats["members"] += 1

            # Re-point every data row with workspace_id.
            for tbl in DATA_TABLES_WITH_WORKSPACE_ID:
                try:
                    if dry_run:
                        n = conn.execute(
                            f"SELECT COUNT(*) FROM {tbl} WHERE workspace_id = ?",
                            (extra["id"],),
                        ).fetchone()[0]
                    else:
                        cur = conn.execute(
                            f"UPDATE {tbl} SET workspace_id = ? WHERE workspace_id = ?",
                            (canonical["id"], extra["id"]),
                        )
                        n = cur.rowcount or 0
                    stats["data_rows"] += n
                except sqlite3.OperationalError:
                    pass  # table missing (fresh DB)

            # Update _lx_migration_map so lpms_case lookups still work.
            if not dry_run:
                try:
                    conn.execute(
                        "UPDATE _lx_migration_map SET new_workspace_id = ? WHERE new_workspace_id = ?",
                        (canonical["id"], extra["id"]),
                    )
                except sqlite3.OperationalError:
                    pass

            # Archive the non-canonical workspace (preserve history).
            if not dry_run:
                conn.execute(
                    "UPDATE workspaces SET status = 'archived', archived_at = CURRENT_TIMESTAMP, "
                    "updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (extra["id"],),
                )
            stats["archived"] += 1
    return stats


def _backfill_cases(conn, dry_run: bool) -> int:
    """Fill lpms_cases.workspace_id by joining through client_id."""
    try:
        rows = conn.execute(
            "SELECT c.id, c.client_id, c.firm_id "
            "FROM lpms_cases c WHERE c.workspace_id IS NULL AND c.client_id IS NOT NULL"
        ).fetchall()
    except sqlite3.OperationalError:
        return 0
    updated = 0
    for r in rows:
        ws = conn.execute(
            "SELECT id FROM workspaces WHERE status = 'active' "
            "AND firm_id = ? AND client_id = ? ORDER BY created_at ASC LIMIT 1",
            (r["firm_id"], r["client_id"]),
        ).fetchone()
        if not ws:
            continue
        if dry_run:
            updated += 1
            continue
        conn.execute(
            "UPDATE lpms_cases SET workspace_id = ? WHERE id = ? AND workspace_id IS NULL",
            (ws["id"], r["id"]),
        )
        updated += 1
    return updated


@click.command("db-redesign-client-workspaces")
@click.option("--dry-run", is_flag=True, help="Count only, don't write.")
@with_appcontext
def db_redesign_command(dry_run: bool) -> None:
    """Collapse per-case workspaces into per-client workspaces."""
    click.echo(f"Target DB: {_db_path()}")
    click.echo(f"Mode: {'DRY RUN' if dry_run else 'LIVE WRITE'}")

    # Make sure the new columns exist (init_db() may not have run under CLI).
    try:
        import app as _app_module
        _app_module.init_db()
    except Exception as e:
        click.echo(f"warn: init_db() raised {type(e).__name__}: {e}")

    conn = _conn()
    try:
        stats = _collapse_groups(conn, dry_run)
        click.echo(f"[collapse] groups scanned: {stats['groups']}")
        click.echo(f"[collapse] workspaces to collapse: {stats['collapsed']}")
        click.echo(f"[collapse] workspace_members touched: {stats['members']}")
        click.echo(f"[collapse] data rows re-pointed: {stats['data_rows']}")
        click.echo(f"[collapse] archived non-canonical workspaces: {stats['archived']}")

        n_cases = _backfill_cases(conn, dry_run)
        click.echo(f"[cases backfill] {('would-set' if dry_run else 'set')} workspace_id on {n_cases} lpms_cases")

        if not dry_run:
            conn.commit()
    finally:
        conn.close()
    click.echo("Done.")


def register(app) -> None:
    app.cli.add_command(db_redesign_command)
