"""Consolidate the two legacy SQLite databases into the SQLAlchemy engine.

Phase 1 of the workspaces-refactor. Idempotent: can be re-run safely.
Reads rows from `lex_assistant.db` (DB A) and `instance/client_data.db` (DB B)
with raw sqlite3, writes them to whatever `SQLALCHEMY_DATABASE_URI` points at
(Postgres in production, sqlite:///database.db locally by default) via the
models in models/legacy_a.py and models/legacy_b.py.

Writes are per-row with best-effort uniqueness handling:
  * Rows that collide on a unique constraint are skipped (ON CONFLICT DO NOTHING).
  * Row counts in / out / skipped are logged per table.
  * `calendar_events` and `user_notification_settings` exist in both A and B —
    DB A is treated as canonical; DB B rows are merged in afterwards.

Run with:
  flask --app app db-consolidate            # merge both DBs
  flask --app app db-consolidate --dry-run  # count only, don't write
  flask --app app db-consolidate --only=case_vault,contract_analyses

The command stays destructive-safe: nothing in the two sqlite files is
modified. The source files remain readable so legacy routes keep working
until each one is rewired in a later part of Phase 1.
"""
from __future__ import annotations
import os
import sqlite3
import time
from pathlib import Path
from typing import Iterable

import click
from flask import current_app
from flask.cli import with_appcontext
from sqlalchemy.exc import IntegrityError

from database import db
from models import legacy_a, legacy_b


REPO_ROOT = Path(__file__).resolve().parents[1]
DB_A_PATH = REPO_ROOT / "lex_assistant.db"
DB_B_PATH = REPO_ROOT / "instance" / "client_data.db"


# ──────────────────────────────────────────────────────────────────
# Mapping: sqlite table name → SQLA model class
# ──────────────────────────────────────────────────────────────────
_A_MAP: dict[str, type] = {}
for _name in legacy_a.__all__:
    _cls = getattr(legacy_a, _name)
    _A_MAP[_cls.__tablename__] = _cls

_B_MAP: dict[str, type] = {}
for _name in legacy_b.__all__:
    _cls = getattr(legacy_b, _name)
    _B_MAP[_cls.__tablename__] = _cls

# DB B rows that need to be merged into DB A's canonical tables.
# (DB B schema was slightly different — we normalise types in the row loader.)
_B_INTO_A_MERGE: dict[str, type] = {
    "calendar_events": legacy_a.CalendarEvent,
    "user_notification_settings": legacy_a.UserNotificationSettings,
}


# ──────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────
def _rows(conn: sqlite3.Connection, table: str) -> Iterable[dict]:
    """Yield all rows of `table` as dicts (column name → value)."""
    conn.row_factory = sqlite3.Row
    try:
        cur = conn.execute(f'SELECT * FROM "{table}"')
    except sqlite3.OperationalError as e:
        click.echo(f"  ! table {table} not readable: {e}")
        return
    for r in cur:
        yield {k: r[k] for k in r.keys()}


def _normalise(row: dict, model: type) -> dict:
    """Keep only columns the SQLA model actually has, and coerce the
    cross-DB collision tables' type mismatches to the canonical type."""
    cols = {c.name for c in model.__table__.columns}
    out = {k: v for k, v in row.items() if k in cols}
    tname = model.__tablename__
    if tname == "calendar_events":
        # DB A: related_case_id TEXT, owner_user_id TEXT.
        # DB B: related_case_id INTEGER, owner_user_id INTEGER.
        # Canonical model keeps TEXT — stringify ints.
        for key in ("related_case_id", "owner_user_id"):
            if key in out and out[key] is not None:
                out[key] = str(out[key])
    return out


def _insert_batch(model: type, rows: list[dict], dry_run: bool) -> tuple[int, int]:
    """Insert rows one by one. Returns (written, skipped)."""
    if dry_run or not rows:
        return (len(rows) if dry_run else 0), 0
    written = skipped = 0
    for r in rows:
        try:
            db.session.add(model(**r))
            db.session.flush()
            written += 1
        except IntegrityError:
            db.session.rollback()
            skipped += 1
        except Exception as e:
            db.session.rollback()
            click.echo(f"    ! {model.__tablename__}: {type(e).__name__}: {e}")
            skipped += 1
    db.session.commit()
    return written, skipped


def _migrate_sqlite(
    src_path: Path,
    mapping: dict[str, type],
    label: str,
    only: set[str] | None,
    dry_run: bool,
) -> None:
    if not src_path.exists():
        click.echo(f"[{label}] source file {src_path} not found — skipping")
        return
    conn = sqlite3.connect(str(src_path))
    try:
        tables = sorted(mapping.keys())
        for t in tables:
            if only and t not in only:
                continue
            model = mapping[t]
            raw = list(_rows(conn, t))
            if not raw:
                click.echo(f"[{label}] {t:<30} 0 rows (empty)")
                continue
            cleaned = [_normalise(r, model) for r in raw]
            written, skipped = _insert_batch(model, cleaned, dry_run)
            verb = "would-write" if dry_run else "wrote"
            click.echo(
                f"[{label}] {t:<30} {len(raw):>6} read  "
                f"{verb} {written:>6}  skipped {skipped:>4}"
            )
    finally:
        conn.close()


# ──────────────────────────────────────────────────────────────────
# Flask CLI command
# ──────────────────────────────────────────────────────────────────
@click.command("db-consolidate")
@click.option("--dry-run", is_flag=True, help="Print row counts without writing.")
@click.option("--only", default="", help="Comma-separated list of table names to migrate.")
@with_appcontext
def db_consolidate_command(dry_run: bool, only: str) -> None:
    """Consolidate lex_assistant.db + instance/client_data.db into the SQLA engine."""
    only_set = {t.strip() for t in only.split(",") if t.strip()} or None

    engine_url = str(db.engine.url)
    click.echo(f"Target engine: {engine_url}")
    click.echo(f"Mode: {'DRY RUN (no writes)' if dry_run else 'LIVE WRITE'}")
    if only_set:
        click.echo(f"Filtering to tables: {sorted(only_set)}")

    # Create tables if the target engine doesn't have them yet.
    # This is safe: db.create_all() is a no-op for tables that exist.
    if not dry_run:
        click.echo("Ensuring target tables exist (create_all)…")
        db.create_all()

    start = time.time()

    # Step 1: DB A (canonical for the collision tables).
    _migrate_sqlite(DB_A_PATH, _A_MAP, "A", only_set, dry_run)

    # Step 2: DB B — only tables unique to B.
    b_only = {t: m for t, m in _B_MAP.items() if t not in _B_INTO_A_MERGE}
    _migrate_sqlite(DB_B_PATH, b_only, "B", only_set, dry_run)

    # Step 3: Merge DB B's collision tables into DB A's canonical ones.
    for t, model in _B_INTO_A_MERGE.items():
        if only_set and t not in only_set:
            continue
        if not DB_B_PATH.exists():
            continue
        conn = sqlite3.connect(str(DB_B_PATH))
        try:
            raw = list(_rows(conn, t))
            if not raw:
                click.echo(f"[B->A merge] {t:<24} 0 rows (empty)")
                continue
            cleaned = [_normalise(r, model) for r in raw]
            written, skipped = _insert_batch(model, cleaned, dry_run)
            verb = "would-merge" if dry_run else "merged"
            click.echo(
                f"[B->A merge] {t:<24} {len(raw):>6} read  "
                f"{verb} {written:>6}  skipped {skipped:>4}"
            )
        finally:
            conn.close()

    took = time.time() - start
    click.echo(f"Done in {took:.1f}s")


def register(app) -> None:
    """Register the CLI command with the Flask app."""
    app.cli.add_command(db_consolidate_command)
