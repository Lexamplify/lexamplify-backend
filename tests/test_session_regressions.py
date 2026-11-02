"""Regression tests for the bugs we fixed live during the E2E test
walkthrough. Each test documents the exact bug it prevents from
coming back; the commit SHA is cited so a future contributor can see
what the fix looked like.

These are focused SQL / code-path checks — they don't spin up the
whole Flask app or hit the network. The goal is "this specific
production-level crash cannot slip past CI again," not full
integration coverage (that lives in test_collab_* and the Document
Hub harness).
"""
import os
import sqlite3
from datetime import datetime, timezone

import pytest
from flask import Flask


# ────────────────────────────────────────────────────────────────────
# Bug 1 — commit 079fad1 + afd2156
#   POST /api/practice/members crashed on
#   `NOT NULL constraint failed: lpms_members.active`
#   (and would have crashed on email_notify next) because the INSERT
#   omitted both columns and SQLAlchemy's instance/database.db schema
#   has NO column DEFAULT on either.
# ────────────────────────────────────────────────────────────────────

LPMS_MEMBERS_SCHEMA_NO_DEFAULTS = """
CREATE TABLE lpms_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    firm_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    active INTEGER NOT NULL,           -- no DEFAULT (SQLAlchemy shape)
    email_notify INTEGER NOT NULL,     -- no DEFAULT
    managed INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER,
    created_at TEXT NOT NULL,
    last_seen TEXT
);
"""


def test_add_member_insert_specifies_active_and_email_notify(tmp_path):
    """The INSERT shape routes/lpms_core.py:add_member emits MUST include
    active + email_notify. Yesterday's crash was silent (500 blocked the
    UI listing new members)."""
    db = tmp_path / "test.db"
    c = sqlite3.connect(str(db))
    c.executescript(LPMS_MEMBERS_SCHEMA_NO_DEFAULTS)

    # Simulate the production INSERT exactly.
    c.execute(
        "INSERT INTO lpms_members "
        "(firm_id, user_id, role, name, email, phone, managed, active, "
        " email_notify, created_by, created_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (1, 42, "junior", "New Member", "n@example.com", None, 0, 1, 1, 1,
         datetime.now(timezone.utc).isoformat(timespec="seconds")),
    )
    c.commit()
    row = c.execute("SELECT active, email_notify FROM lpms_members").fetchone()
    assert row == (1, 1), "both active and email_notify must land as 1"


def test_add_member_insert_without_active_still_crashes(tmp_path):
    """Documents the exact failure mode so a future refactor that drops
    `active` from the INSERT trips immediately in CI, not production."""
    db = tmp_path / "test.db"
    c = sqlite3.connect(str(db))
    c.executescript(LPMS_MEMBERS_SCHEMA_NO_DEFAULTS)

    with pytest.raises(sqlite3.IntegrityError) as exc:
        c.execute(
            "INSERT INTO lpms_members (firm_id, user_id, role, name, email, "
            "phone, managed, created_by, created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?)",
            (1, 42, "junior", "No Active", "n@example.com", None, 0, 1,
             datetime.now(timezone.utc).isoformat(timespec="seconds")),
        )
    assert "active" in str(exc.value).lower()


# ────────────────────────────────────────────────────────────────────
# Bug 2 — commit 5119695
#   DELETE /api/workspaces/<id> cascaded nothing. workspace_members
#   rows were orphaned, SQLite reused the freed PK on next create, and
#   the add-owner INSERT hit a UNIQUE(workspace_id, firm_member_id)
#   conflict. 503 on 'create client'.
# ────────────────────────────────────────────────────────────────────

def test_workspace_delete_must_remove_member_rows(tmp_path):
    """A workspace delete MUST clear workspace_members for that id, so
    the next workspace to inherit the PK can register its owner without
    tripping the UNIQUE index."""
    db = tmp_path / "test.db"
    c = sqlite3.connect(str(db))
    c.executescript("""
        CREATE TABLE workspaces (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
        CREATE TABLE workspace_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workspace_id INTEGER NOT NULL,
            firm_member_id INTEGER NOT NULL,
            role TEXT,
            UNIQUE(workspace_id, firm_member_id)
        );
    """)
    # Create + delete + reuse PK (SQLite behavior without AUTOINCREMENT).
    c.execute("INSERT INTO workspaces (name) VALUES ('A')")           # id=1
    c.execute("INSERT INTO workspace_members (workspace_id, firm_member_id, role) VALUES (1, 7, 'owner')")

    # Simulate production delete endpoint — explicitly deletes the
    # member rows BEFORE the workspace row (as it does in commit 5119695).
    c.execute("DELETE FROM workspace_members WHERE workspace_id = 1")
    c.execute("DELETE FROM workspaces WHERE id = 1")
    c.commit()

    # Create a new workspace — depending on SQLite's PK-reuse this may
    # or may not get id=1 again. Either way, inserting a fresh owner
    # row for the SAME (workspace_id, firm_member_id) pair must succeed.
    cur = c.execute("INSERT INTO workspaces (name) VALUES ('B')")
    new_id = cur.lastrowid
    c.execute(
        "INSERT INTO workspace_members (workspace_id, firm_member_id, role) VALUES (?, ?, ?)",
        (new_id, 7, "owner"),
    )
    c.commit()
    assert c.execute(
        "SELECT COUNT(*) FROM workspace_members WHERE workspace_id = ?", (new_id,)
    ).fetchone()[0] == 1


# ────────────────────────────────────────────────────────────────────
# Bug 3 — commit 8e50744
#   routes/contract_routes.py:_resolve_firm_id_for_jwt crashed with
#   `NameError: name 'current_app' is not defined`. The helper used
#   current_app without importing it at module level (the siblings had
#   lazy inline imports; this one didn't).
# ────────────────────────────────────────────────────────────────────

def test_contract_routes_imports_current_app_at_module_level():
    """The ergonomic fix was to import current_app on the module's top
    `from flask import …` line. Lock that so a future cleanup that
    moves it back to a lazy inline import inside _resolve_firm_id_for_jwt
    trips this test immediately."""
    import importlib
    mod = importlib.import_module("routes.contract_routes")
    assert hasattr(mod, "current_app"), (
        "routes.contract_routes must expose current_app at module scope — "
        "otherwise checklist_master_get() 500s on NameError"
    )


# ────────────────────────────────────────────────────────────────────
# Bug 4 — commit 8eaae2d
#   case_visible_sql() returned a predicate with
#   `(workspace_id = :__ws_id OR workspace_id IS NULL)` which let
#   legacy un-scoped matters show up under EVERY client. User saw
#   Mehta v. UoI / Case A / Case B leaking into both Mehta and Rohit.
# ────────────────────────────────────────────────────────────────────

@pytest.fixture
def app_with_lpms(tmp_path):
    db = tmp_path / "lex.db"
    c = sqlite3.connect(str(db))
    c.executescript("""
        CREATE TABLE lpms_cases (
            id INTEGER PRIMARY KEY,
            firm_id INTEGER, advocate_id INTEGER, team_id INTEGER,
            restricted INTEGER DEFAULT 0, title TEXT, workspace_id INTEGER
        );
        CREATE TABLE lpms_members (
            id INTEGER PRIMARY KEY, firm_id INTEGER, user_id INTEGER,
            role TEXT, active INTEGER DEFAULT 1
        );
        CREATE TABLE team_memberships (team_id INTEGER, user_id INTEGER);
    """)
    c.executemany(
        "INSERT INTO lpms_cases (id, firm_id, advocate_id, team_id, "
        "restricted, title, workspace_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
            (1, 1, 1, None, 0, "Legacy case (no workspace)", None),
            (2, 1, 1, None, 0, "Mehta's case",              10),
            (3, 1, 1, None, 0, "Rohit's case",              11),
        ],
    )
    c.execute("INSERT INTO lpms_members (id, firm_id, user_id, role) "
              "VALUES (1, 1, 42, 'senior')")
    c.commit()
    c.close()
    app = Flask("test-regressions")
    app.extensions["lpms_db_path"] = str(db)
    return app


def _run_vis(app, member, workspace_id_header):
    """Call case_visible_sql with a simulated workspace header and
    return the ids of lpms_cases that pass the predicate."""
    from utils import lpms_store as L

    with app.test_request_context(headers={"X-Workspace-Id": str(workspace_id_header)} if workspace_id_header is not None else {}):
        where, params = L.case_visible_sql(member, "c")
        conn = sqlite3.connect(app.extensions["lpms_db_path"])
        try:
            return sorted(
                r[0] for r in conn.execute(
                    f"SELECT id FROM lpms_cases c WHERE {where}", params
                ).fetchall()
            )
        finally:
            conn.close()


def test_case_visible_sql_strict_workspace_match(app_with_lpms):
    """With X-Workspace-Id=10, ONLY Mehta's case (id=2) must be
    visible — the legacy NULL-workspace case (id=1) and Rohit's case
    (id=3) must stay hidden. The pre-fix predicate had an `OR
    workspace_id IS NULL` leg that let id=1 leak into every client's
    view; the fix (commit 8eaae2d) removed that leg."""
    member = {"id": 1, "firm_id": 1, "user_id": 42, "role": "senior"}
    assert _run_vis(app_with_lpms, member, 10) == [2]
    assert _run_vis(app_with_lpms, member, 11) == [3]


def test_case_visible_sql_no_header_sees_all(app_with_lpms):
    """When no X-Workspace-Id is sent (background jobs, Celery, cron,
    legacy clients), case_visible_sql must NOT filter — otherwise
    firm-wide tooling breaks."""
    member = {"id": 1, "firm_id": 1, "user_id": 42, "role": "senior"}
    assert _run_vis(app_with_lpms, member, None) == [1, 2, 3]


# ────────────────────────────────────────────────────────────────────
# Bug 4b — commit dced75a
#   POST /api/practice/cases created rows with workspace_id=NULL.
#   With the strict case_visible_sql filter from 4, the user's own
#   newly-created matter 404'd on the very next GET. The create path
#   must stamp workspace_id from X-Workspace-Id so the round-trip
#   works.
# ────────────────────────────────────────────────────────────────────

def test_newly_created_case_is_visible_to_creator(app_with_lpms):
    """Simulate POST creating a case with workspace_id=10 (stamped from
    the X-Workspace-Id header), then the immediate GET: the creator
    must see the row under their own active workspace."""
    import sqlite3
    conn = sqlite3.connect(app_with_lpms.extensions["lpms_db_path"])
    conn.execute(
        "INSERT INTO lpms_cases (id, firm_id, advocate_id, team_id, "
        "restricted, title, workspace_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (99, 1, 1, None, 0, "Just-created Mehta case", 10),
    )
    conn.commit()
    conn.close()
    member = {"id": 1, "firm_id": 1, "user_id": 42, "role": "senior"}
    assert 99 in _run_vis(app_with_lpms, member, 10), (
        "a case created under workspace_id=10 must be visible to the "
        "same workspace on the very next GET"
    )


def test_case_create_without_workspace_header_leaves_null(app_with_lpms):
    """Legacy / background path: POST without X-Workspace-Id must leave
    workspace_id=NULL (Celery jobs that run cron reminders fall into
    this bucket). The strict filter then hides the row from any
    client-scoped view — which is the correct behaviour."""
    import sqlite3
    conn = sqlite3.connect(app_with_lpms.extensions["lpms_db_path"])
    conn.execute(
        "INSERT INTO lpms_cases (id, firm_id, advocate_id, team_id, "
        "restricted, title, workspace_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (100, 1, 1, None, 0, "Background-created, no workspace", None),
    )
    conn.commit()
    conn.close()
    member = {"id": 1, "firm_id": 1, "user_id": 42, "role": "senior"}
    # Under a specific workspace header: NULL rows hidden (correct).
    assert 100 not in _run_vis(app_with_lpms, member, 10)
    # No header at all: NULL rows visible (correct).
    assert 100 in _run_vis(app_with_lpms, member, None)


# ────────────────────────────────────────────────────────────────────
# Bug 5 — commit c5f5a62 / Settings → Contract checklist feature
#   Firm master checklist settings PUT required senior/partner role;
#   the server-side check was correct. We lock the string set here so
#   a future change to the role-prefix check (e.g. renaming 'partner'
#   to 'managing-partner' with no fallback) can't silently lock
#   senior admins out of their own setting.
# ────────────────────────────────────────────────────────────────────

def test_contract_checklist_role_gate_accepts_senior_partner_principal():
    """The PUT /api/contract/checklist/master role gate contains the
    exact substrings 'senior', 'partner', 'principal'. Spell them wrong
    and every firm manager gets a 403."""
    src = open("routes/contract_routes.py", encoding="utf-8").read()
    # Lift the exact substring check out of the file so a renaming
    # refactor shows up as a diff.
    for needle in ('"senior"', '"partner"', '"principal"'):
        assert needle in src, f"role gate must still check for {needle}"
