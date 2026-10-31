"""Seed each existing workspace with realistic demo data so switching
the workspace in the UI visibly re-skins every scoped feature.

Idempotent — can be re-run safely. Rows are tagged with a special
case_id='demo_seed' / meta flag so they can be cleared with --wipe.

Invoke with:
  flask --app app seed-workspace-demo             # add demo data
  flask --app app seed-workspace-demo --wipe      # remove demo data
  flask --app app seed-workspace-demo --count=3   # 3 of each item per workspace
"""
from __future__ import annotations
import json
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


# Per-workspace flavour text — picked from a cycling list so each workspace
# gets visibly different content without hand-authoring 8 variants.
_FLAVOURS = [
    ("Bail application — bail bond draft",      "Deed of Lease",     "Hearing on bail bond"),
    ("Writ petition — Section 226 draft",       "Partnership Deed",  "Response to counter-affidavit"),
    ("Reply to show-cause notice",              "Service Agreement", "Bench conference"),
    ("Notice under Section 138 NI Act",         "Non-Disclosure Agreement", "Mediation session"),
    ("Rejoinder affidavit",                     "Memorandum of Understanding", "Status conference"),
    ("Review petition brief",                   "Loan Agreement",    "Oral argument prep"),
    ("Vakalatnama + opening memo",              "Franchise Agreement", "Document discovery deadline"),
    ("Appeal grounds",                          "Supply Contract",   "Judgment reservation"),
]


def _flavour_for(i: int) -> tuple:
    return _FLAVOURS[i % len(_FLAVOURS)]


SEED_TAG = "DEMO_SEED"  # dropped into row content/tags so --wipe can find it.


def _owner_for_workspace(conn, ws_id: int) -> int | None:
    """Find a user_id to use as the row owner for seeded data."""
    r = conn.execute("SELECT created_by FROM workspaces WHERE id = ?", (ws_id,)).fetchone()
    return r["created_by"] if r else None


def _seed_contracts(conn, ws, flavour, owner_uid: int, dry: bool) -> int:
    name = f"{flavour[1]} — {ws['name']} [DEMO]"
    if conn.execute(
        "SELECT 1 FROM contract_analyses WHERE workspace_id = ? AND document_name = ? LIMIT 1",
        (ws["id"], name)
    ).fetchone():
        return 0
    if dry: return 1
    results = {
        "document_name": name,
        "page_count": 12,
        "word_count": 3800,
        "DEMO_SEED": True,
        "summary": f"Demo analysis for {ws['name']}. {flavour[1]} executed between parties — risk areas flagged for review.",
        "clauses": [
            {"id": "c1", "risk": "AMBER", "text": "Indemnity cap set to one year of fees — below standard.", "section": "Indemnity"},
            {"id": "c2", "risk": "GREEN", "text": "Governing law: Indian law. Jurisdiction: courts at Mumbai.", "section": "Governing Law"},
            {"id": "c3", "risk": "RED",   "text": "Automatic renewal with 90-day notice window — client may miss.", "section": "Term"},
        ],
    }
    job_id = f"demo-{ws['id']}-{int(time.time()*1000)}"
    conn.execute(
        """INSERT INTO contract_analyses
               (owner_user_id, job_id, document_name, raw_text, results_json,
                scan_strategy, page_count, word_count, workspace_id, created_at)
           VALUES (?,?,?,?,?,?,?,?,?, CURRENT_TIMESTAMP)""",
        (str(owner_uid), job_id, name,
         f"DEMO_SEED contract text for {ws['name']}. {flavour[1]} between parties A and B.",
         json.dumps(results), "Defensive", 12, 3800, ws["id"]),
    )
    return 1


def _seed_drafts(conn, ws, flavour, owner_uid: int, dry: bool) -> int:
    title = f"{flavour[0]} — {ws['name']} [DEMO]"
    if conn.execute(
        "SELECT 1 FROM draft_sessions WHERE workspace_id = ? AND title = ? LIMIT 1",
        (ws["id"], title)
    ).fetchone():
        return 0
    if dry: return 1
    facts = {
        "DEMO_SEED": True,
        "case_name": ws["name"],
        "case_no": ws["case_no"] or "—",
        "court": ws["court"] or "—",
        "petitioner": "Client of record",
        "respondent": "Opposite Party",
    }
    now = time.strftime("%Y-%m-%d %H:%M:%S")
    conn.execute(
        """INSERT INTO draft_sessions
               (user_id, doc_type, title, case_ref, facts_json, step, status, workspace_id, created_at, updated_at)
           VALUES (?,?,?,?,?,?, 'draft', ?, ?, ?)""",
        (owner_uid, "bail_application", title[:200], str(ws["id"]),
         json.dumps(facts), "details", ws["id"], now, now),
    )
    return 1


def _seed_calendar(conn, ws, flavour, owner_uid: int, dry: bool) -> int:
    event_type = "hearing"
    title = f"{flavour[2]} — {ws['name']} [DEMO]"
    if conn.execute(
        "SELECT 1 FROM calendar_events WHERE workspace_id = ? AND title = ? LIMIT 1",
        (ws["id"], title)
    ).fetchone():
        return 0
    if dry: return 1
    # Pick a date ~2 weeks out.
    future_day = time.strftime("%Y-%m-%d", time.localtime(time.time() + 14 * 86400 + ws["id"] * 86400))
    conn.execute(
        """INSERT INTO calendar_events
               (event_date, event_type, title, related_case_id, location, opposing_counsel,
                owner_user_id, workspace_id, created_at)
           VALUES (?,?,?,?,?,?,?,?, CURRENT_TIMESTAMP)""",
        (future_day, event_type, title, ws["case_no"] or "", ws["court"] or "", "Adv. Patel",
         str(owner_uid), ws["id"]),
    )
    return 1


def _seed_vault_doc(conn, ws, flavour, owner_uid: int, dry: bool) -> int:
    title = f"{flavour[1]} draft — {ws['name']} [DEMO]"
    if conn.execute(
        "SELECT 1 FROM case_vault WHERE workspace_id = ? AND title = ? LIMIT 1",
        (ws["id"], title)
    ).fetchone():
        return 0
    if dry: return 1
    conn.execute(
        """INSERT INTO case_vault
               (case_id, title, doc_type, content, smart_title, tags, user_id, workspace_id, is_public)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        (f"ws:{ws['id']}:demo", title, "demo_draft",
         f"[{SEED_TAG}] Draft content for {flavour[1]} in matter {ws['name']}.\n\n"
         "This document is seeded for workspace-isolation demonstration — "
         "it is NOT a real draft and should be deleted via "
         "`flask seed-workspace-demo --wipe` once you are done exploring.",
         title[:120], f"{SEED_TAG},demo", owner_uid, ws["id"], 0),
    )
    return 1


def _wipe(conn) -> dict:
    """Remove every seeded row across all demo tables."""
    counts: dict[str, int] = {}
    for sql, label in [
        ("DELETE FROM contract_analyses WHERE document_name LIKE '%[DEMO]%'", "contract_analyses"),
        ("DELETE FROM draft_sessions WHERE title LIKE '%[DEMO]%'", "draft_sessions"),
        ("DELETE FROM calendar_events WHERE title LIKE '%[DEMO]%'", "calendar_events"),
        ("DELETE FROM case_vault WHERE title LIKE '%[DEMO]%' OR tags LIKE '%" + SEED_TAG + "%'", "case_vault"),
    ]:
        try:
            cur = conn.execute(sql)
            counts[label] = cur.rowcount or 0
        except sqlite3.OperationalError:
            counts[label] = 0
    conn.commit()
    return counts


@click.command("seed-workspace-demo")
@click.option("--dry-run", is_flag=True, help="Count only, don't write.")
@click.option("--wipe", is_flag=True, help="Remove all previously-seeded demo rows.")
@click.option("--count", default=1, help="Items per workspace per table (default 1).")
@with_appcontext
def seed_workspace_demo_command(dry_run: bool, wipe: bool, count: int) -> None:
    click.echo(f"Target DB: {_db_path()}")
    conn = _conn()
    try:
        if wipe:
            click.echo("Wiping previously-seeded demo rows…")
            counts = _wipe(conn)
            for k, v in counts.items():
                click.echo(f"  removed {v:>4} from {k}")
            return

        workspaces = conn.execute(
            "SELECT id, name, case_no, court, firm_id, created_by FROM workspaces "
            "WHERE status = 'active' ORDER BY id"
        ).fetchall()
        if not workspaces:
            click.echo("No workspaces found — run db-migrate-workspaces first.")
            return

        click.echo(f"Seeding {len(workspaces)} workspace(s), {count} item(s) each…")
        totals = {"contracts": 0, "drafts": 0, "calendar": 0, "vault": 0}
        for i, ws in enumerate(workspaces):
            uid = ws["created_by"]
            if uid is None:
                click.echo(f"  ws#{ws['id']} ({ws['name']}): no owner — skipping")
                continue
            per_ws = 0
            for j in range(count):
                flavour = _flavour_for(i * count + j)
                totals["contracts"] += _seed_contracts(conn, ws, flavour, uid, dry_run)
                totals["drafts"]    += _seed_drafts(conn, ws, flavour, uid, dry_run)
                totals["calendar"]  += _seed_calendar(conn, ws, flavour, uid, dry_run)
                totals["vault"]     += _seed_vault_doc(conn, ws, flavour, uid, dry_run)
                per_ws += 4
            click.echo(f"  ws#{ws['id']} ({ws['name']}): {per_ws} rows planned")
        if not dry_run:
            conn.commit()
        verb = "would-insert" if dry_run else "inserted"
        for k, v in totals.items():
            click.echo(f"  {verb} {v:>4} {k}")
    finally:
        conn.close()
    click.echo("Done.")


def register(app) -> None:
    app.cli.add_command(seed_workspace_demo_command)
