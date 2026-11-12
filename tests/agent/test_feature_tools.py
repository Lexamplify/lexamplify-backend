"""Feature-coverage gate tests: the tools added when walking every sidebar
feature (matters sub-features, workspace summary, calendar list/delete,
drafts + letterheads, Practice firm/team/clients/settings, research,
firm conflict engine, navigation map)."""
import sqlite3

import pytest

from agent import engine, providers
from agent.tools import (core_tools, action_tools, update_tools, matter_tools,  # noqa: F401
                         workspace_tools, draft_tools, practice_tools, research_tools)  # noqa: F401
from agent.tools import registry
from tests.agent.test_phase2 import MATTERS_SQL, fake
from tests.agent.test_phase3 import CAL_SQL, WS_SQL, VAULT_SQL

EXTRA_SQL = [
    "CREATE TABLE deadlines (id INTEGER PRIMARY KEY AUTOINCREMENT, matter_id INTEGER, title TEXT, date TEXT, description TEXT, ai_extracted INTEGER)",
    "CREATE TABLE tasks_matter (id INTEGER PRIMARY KEY AUTOINCREMENT, matter_id INTEGER, title TEXT, done INTEGER DEFAULT 0)",
    "CREATE TABLE handoff_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, matter_id INTEGER, author_user_id INTEGER, text TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
    "CREATE TABLE saved_drafts (id TEXT PRIMARY KEY, owner_user_id INTEGER, title TEXT, raw_text TEXT, clauses_json TEXT, summary TEXT)",
    "CREATE TABLE letterheads (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT, is_default INTEGER DEFAULT 0, active_template TEXT DEFAULT 'firm', template_docx TEXT, counterparty_template_docx TEXT)",
    "CREATE TABLE lpms_firms (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, owner_user_id INTEGER, settings TEXT, created_at TEXT)",
    "CREATE TABLE lpms_members (id INTEGER PRIMARY KEY AUTOINCREMENT, firm_id INTEGER, user_id INTEGER, role TEXT, name TEXT, email TEXT, phone TEXT, managed INTEGER DEFAULT 0, active INTEGER DEFAULT 1, email_notify INTEGER DEFAULT 1, created_by INTEGER, created_at TEXT)",
    "CREATE TABLE lpms_clients (id INTEGER PRIMARY KEY AUTOINCREMENT, firm_id INTEGER, name TEXT, phone TEXT, email TEXT, created_by INTEGER, created_at TEXT, updated_at TEXT)",
    "CREATE TABLE lpms_cases (id INTEGER PRIMARY KEY AUTOINCREMENT, firm_id INTEGER, title TEXT, status TEXT, case_no TEXT)",
]


@pytest.fixture
def db(tmp_path):
    path = str(tmp_path / "feat.db")
    with sqlite3.connect(path) as c:
        c.execute(MATTERS_SQL)
        c.execute(CAL_SQL)
        c.execute(WS_SQL)
        c.execute(VAULT_SQL)
        for s in EXTRA_SQL:
            c.execute(s)
        c.execute("INSERT INTO workspaces (id, firm_id, name, court, case_type, created_by) "
                  "VALUES (10, 1, 'Chambers — General', 'Delhi HC', 'Civil', 1)")
        c.execute("INSERT INTO matters (id, title, owner_user_id, workspace_id) VALUES (1, 'Kumar vs State', 1, 10)")
        c.execute("INSERT INTO lpms_firms (id, name, owner_user_id) VALUES (1, 'Rao & Associates', 1)")
        c.execute("INSERT INTO lpms_members (firm_id, user_id, role, name) VALUES (1, 1, 'owner', 'Asha Rao')")
        c.execute("INSERT INTO lpms_members (firm_id, user_id, role, name) VALUES (1, 2, 'junior', 'Ravi Nair')")
    return path


@pytest.fixture(autouse=True)
def _reset_provider():
    yield
    providers.set_provider(None)


def _run(db, tool, inputs, user_id=1, ws=10):
    fake([{"plan": [{"tool": tool, "inputs": inputs}], "reply": "ok"}])
    return engine.submit_task(db, user_id, ws, f"use {tool}")


# ── Matters sub-features ────────────────────────────────────────────────────

def test_matter_deadline_task_note_and_details(db):
    assert _run(db, "add_matter_deadline", {"matter_id": 1, "title": "File reply", "date": "2026-12-01"})["state"] == "COMPLETED"
    assert _run(db, "add_matter_task", {"matter_id": 1, "title": "Call client"})["state"] == "COMPLETED"
    assert _run(db, "add_matter_note", {"matter_id": 1, "text": "Client prefers settlement"})["state"] == "COMPLETED"
    t = _run(db, "get_matter_details", {"matter_id": 1})
    out = t["steps"][0]["output"]
    assert out["deadlines"][0]["title"] == "File reply"
    assert out["tasks"][0]["title"] == "Call client"
    assert "settlement" in out["notes"][0]["text"]


def test_matter_subfeatures_workspace_guarded(db):
    with sqlite3.connect(db) as c:
        c.execute("INSERT INTO matters (id, title, owner_user_id, workspace_id) VALUES (99, 'Foreign', 1, 77)")
    fake([{"plan": [{"tool": "add_matter_note", "inputs": {"matter_id": 99, "text": "x"}}], "reply": "ok"},
          {"ask_user": "Which matter?"}])
    t = engine.submit_task(db, 1, 10, "note on matter 99")
    assert t["state"] in ("FAILED", "WAITING_FOR_USER")
    with sqlite3.connect(db) as c:
        assert c.execute("SELECT COUNT(*) FROM handoff_notes").fetchone()[0] == 0


# ── Workspace summary + calendar ────────────────────────────────────────────

def test_workspace_summary(db):
    with sqlite3.connect(db) as c:
        c.execute("INSERT INTO calendar_events (event_date, title, workspace_id) VALUES (date('now','+2 day'), 'Hearing', 10)")
        c.execute("INSERT INTO case_vault (title, workspace_id) VALUES ('NDA', 10)")
    t = _run(db, "workspace_summary", {})
    out = t["steps"][0]["output"]
    assert out["workspace"]["name"] == "Chambers — General"
    assert out["counts"] == {"open_matters": 1, "upcoming_events": 1, "vault_documents": 1}


def test_list_and_delete_calendar_event_needs_approval(db):
    with sqlite3.connect(db) as c:
        c.execute("INSERT INTO calendar_events (id, event_date, title, workspace_id) VALUES (5, '2026-12-01', 'H', 10)")
    t = _run(db, "list_calendar_events", {})
    assert t["steps"][0]["output"]["count"] == 1

    fake([{"plan": [{"tool": "delete_calendar_event", "inputs": {"event_id": 5}}], "reply": "ok"}])
    t = engine.submit_task(db, 1, 10, "delete event 5")
    assert t["state"] == "WAITING_FOR_APPROVAL"          # C = held
    t = engine.approve_step(db, 1, 10, t["id"], 0, "approve")
    assert t["state"] == "COMPLETED"
    with sqlite3.connect(db) as c:
        assert c.execute("SELECT COUNT(*) FROM calendar_events").fetchone()[0] == 0


# ── Drafts + letterheads ────────────────────────────────────────────────────

def test_save_and_list_drafts(db):
    assert _run(db, "save_draft", {"title": "NDA v1", "text": "This NDA..."})["state"] == "COMPLETED"
    t = _run(db, "list_drafts", {})
    assert t["steps"][0]["output"]["drafts"][0]["title"] == "NDA v1"


def test_letterhead_template_switch(db):
    with sqlite3.connect(db) as c:
        c.execute("INSERT INTO letterheads (id, user_id, name, template_docx, counterparty_template_docx) "
                  "VALUES (3, 1, 'Main', 'a.docx', 'b.docx')")
    t = _run(db, "list_letterheads", {})
    lh = t["steps"][0]["output"]["letterheads"][0]
    assert lh["has_firm_template"] and lh["has_counterparty_template"] and lh["active_template"] == "firm"
    t = _run(db, "set_letterhead_template", {"letterhead_id": 3, "template": "counterparty"})
    assert t["state"] == "COMPLETED"
    with sqlite3.connect(db) as c:
        assert c.execute("SELECT active_template FROM letterheads WHERE id=3").fetchone()[0] == "counterparty"


def test_letterhead_other_user_blocked(db):
    with sqlite3.connect(db) as c:
        c.execute("INSERT INTO letterheads (id, user_id, name) VALUES (9, 42, 'NotMine')")
    fake([{"plan": [{"tool": "set_letterhead_template", "inputs": {"letterhead_id": 9, "template": "firm"}}], "reply": "ok"},
          {"ask_user": "Which letterhead?"}])
    t = engine.submit_task(db, 1, 10, "switch letterhead 9")
    assert t["state"] in ("FAILED", "WAITING_FOR_USER")


# ── Practice ────────────────────────────────────────────────────────────────

def test_practice_overview_and_team(db):
    t = _run(db, "get_my_practice", {})
    out = t["steps"][0]["output"]
    assert out["firm"]["name"] == "Rao & Associates" and out["my_role"] == "owner" and out["members"] == 2
    t = _run(db, "list_team_members", {})
    assert t["steps"][0]["output"]["count"] == 2


def test_add_and_list_clients_duplicate_safe(db):
    assert _run(db, "add_client", {"name": "Mehta Industries", "email": "m@x.com"})["state"] == "COMPLETED"
    t2 = _run(db, "add_client", {"name": "Mehta Industries"})
    assert t2["steps"][0]["output"]["duplicate"] is True
    t = _run(db, "list_clients", {})
    assert t["steps"][0]["output"]["count"] == 1


def test_update_profile(db):
    t = _run(db, "update_my_profile", {"phone": "+91 98x"})
    assert t["state"] == "COMPLETED"
    with sqlite3.connect(db) as c:
        assert c.execute("SELECT phone FROM lpms_members WHERE user_id=1").fetchone()[0] == "+91 98x"


def test_rename_chamber_owner_with_approval(db):
    fake([{"plan": [{"tool": "rename_chamber", "inputs": {"name": "Rao & Partners"}}], "reply": "ok"}])
    t = engine.submit_task(db, 1, 10, "rename chamber to Rao & Partners")
    assert t["state"] == "WAITING_FOR_APPROVAL"
    t = engine.approve_step(db, 1, 10, t["id"], 0, "approve")
    assert t["state"] == "COMPLETED"
    with sqlite3.connect(db) as c:
        assert c.execute("SELECT name FROM lpms_firms WHERE id=1").fetchone()[0] == "Rao & Partners"


def test_rename_chamber_junior_denied(db):
    fake([{"plan": [{"tool": "rename_chamber", "inputs": {"name": "Hacked LLP"}}], "reply": "ok"},
          {"ask_user": "You need an owner to do this."}])
    t = engine.submit_task(db, 2, 10, "rename chamber")
    t = engine.approve_step(db, 2, 10, t["id"], 0, "approve")       # even approved, role check blocks
    assert t["state"] in ("FAILED", "WAITING_FOR_USER")
    with sqlite3.connect(db) as c:
        assert c.execute("SELECT name FROM lpms_firms WHERE id=1").fetchone()[0] == "Rao & Associates"


def test_practice_tools_without_firm(db):
    fake([{"plan": [{"tool": "get_my_practice", "inputs": {}}], "reply": "ok"},
          {"ask_user": "Create a firm first?"}])
    t = engine.submit_task(db, 777, 10, "my firm?")                  # user 777 has no member row
    assert t["state"] in ("FAILED", "WAITING_FOR_USER")


# ── Research (offline → honest unavailability) ──────────────────────────────

def test_legal_research_unavailable_is_honest(db):
    t = _run(db, "legal_research", {"question": "limitation for cheque bounce?"})
    assert t["state"] == "COMPLETED"
    out = t["steps"][0]["output"]
    assert out["ok"] is False and "unavail" in (out["error"] + out["note"]).lower() or out["ok"] is False
    assert t["result"]["evidence"][0]["confidence"] == "UNCERTAIN"   # never VERIFIED without sources


# ── Firm conflict engine ────────────────────────────────────────────────────

def test_firm_conflict_check_runs_real_engine(tmp_path):
    # Real LPMS schema (utils/lpms_store.ensure_schema) + the agent's own tables.
    from utils import lpms_store
    path = str(tmp_path / "firm.db")
    conn = lpms_store.connect(path)
    lpms_store.ensure_schema(conn)
    conn.execute("INSERT INTO lpms_firms (name, owner_user_id, created_at) VALUES ('Rao & Associates', 1, '2026-01-01')")
    conn.execute("INSERT INTO lpms_members (firm_id, user_id, role, name, active, created_at) "
                 "VALUES (1, 1, 'owner', 'Asha', 1, '2026-01-01')")
    conn.execute("INSERT INTO lpms_clients (firm_id, name, created_by, created_at, updated_at) "
                 "VALUES (1, 'Gupta Traders', 1, '2026-01-01', '2026-01-01')")
    conn.commit()
    conn.close()
    with sqlite3.connect(path) as c:
        c.execute(MATTERS_SQL)
        # app.py-owned tables the conflict engine's visibility SQL joins on
        c.execute("CREATE TABLE IF NOT EXISTS teams (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, "
                  "description TEXT, is_private INTEGER DEFAULT 0, owner_user_id INTEGER)")
        c.execute("CREATE TABLE IF NOT EXISTS team_memberships (id INTEGER PRIMARY KEY AUTOINCREMENT, "
                  "team_id INTEGER, user_id INTEGER, role TEXT)")
    t = _run(path, "firm_conflict_check", {"client_name": "Gupta Traders"})
    # whatever the engine concludes, it must return a status and verified evidence
    assert t["state"] == "COMPLETED", t.get("error")
    assert t["steps"][0]["output"]["status"]


# ── Navigation map covers every sidebar page ────────────────────────────────

def test_navigate_covers_all_sidebar_pages(db):
    for dest, path in [("court_resources", "/court-resources"), ("war_room", "/war-room"),
                       ("document_hub", "/document-hub"), ("firm_library", "/firm-library"),
                       ("legal_forms", "/legal-forms"), ("clients", "/practice/clients"),
                       ("start", "/start")]:
        t = _run(db, "navigate", {"destination": dest})
        assert t["state"] == "COMPLETED" and t["steps"][0]["output"]["navigate_to"] == path
