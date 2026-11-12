"""Phase 3 gate tests: context auto-fetch, calendar events, conflict check,
vault search, navigation, and context injection into planning."""
import sqlite3

import pytest

from agent import context, engine, providers
from agent.tools import core_tools, action_tools  # noqa: F401 — register all tools
from tests.agent.test_phase2 import FakeProvider, MATTERS_SQL, fake  # reuse scaffolding

CAL_SQL = ("CREATE TABLE IF NOT EXISTS calendar_events (id INTEGER PRIMARY KEY AUTOINCREMENT, event_date TEXT, "
           "event_type TEXT, title TEXT, related_case_id TEXT, location TEXT, opposing_counsel TEXT, "
           "google_event_id TEXT, owner_user_id TEXT, workspace_id INTEGER)")
WS_SQL = ("CREATE TABLE IF NOT EXISTS workspaces (id INTEGER PRIMARY KEY AUTOINCREMENT, firm_id INTEGER, name TEXT, "
          "case_no TEXT, court TEXT, case_type TEXT, parties TEXT, client_type TEXT, created_by INTEGER)")
VAULT_SQL = ("CREATE TABLE IF NOT EXISTS case_vault (id INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT, title TEXT, "
             "doc_type TEXT, smart_title TEXT, tags TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, "
             "user_id INTEGER, workspace_id INTEGER)")


@pytest.fixture
def db(tmp_path):
    path = str(tmp_path / "agent3.db")
    with sqlite3.connect(path) as c:
        c.execute(MATTERS_SQL)
        c.execute(CAL_SQL)
        c.execute(WS_SQL)
        c.execute(VAULT_SQL)
        c.execute("INSERT INTO workspaces (id, firm_id, name, court, case_type, parties, created_by) "
                  "VALUES (10, 1, 'Advocate Chambers — General', 'Delhi High Court', 'Civil', "
                  "'[{\"role\":\"petitioner\",\"name\":\"Rajesh Kumar\"}]', 1)")
    return path


@pytest.fixture(autouse=True)
def _reset_provider():
    yield
    providers.set_provider(None)


# ── context auto-fetch ──────────────────────────────────────────────────────

def test_context_fetch_builds_note(db):
    with sqlite3.connect(db) as c:
        c.execute("INSERT INTO matters (title, owner_user_id, workspace_id) VALUES ('Kumar vs State', 1, 10)")
        c.execute("INSERT INTO calendar_events (event_date, title, workspace_id) VALUES (date('now','+3 day'), 'Hearing', 10)")
    out = context.fetch(db, 1, 10)
    note = out["note"]
    assert "Advocate Chambers" in note and "Delhi High Court" in note
    assert "Kumar vs State" in note and "Hearing" in note
    assert "pre-fill" in note
    assert out["workspace"]["case_type"] == "Civil"


def test_context_fetch_empty_without_workspace(db):
    assert context.fetch(db, 1, None)["note"] == ""


def test_context_fetch_survives_missing_tables(tmp_path):
    bare = str(tmp_path / "bare.db")
    sqlite3.connect(bare).close()
    out = context.fetch(bare, 1, 10)       # no tables at all — degrade, don't raise
    assert out["workspace"] is None


def test_context_note_reaches_planner(db):
    p = fake([{"plan": [{"tool": "list_matters", "inputs": {}}], "reply": "ok"}])
    engine.submit_task(db, 1, 10, "list my matters")
    user_msg = p.calls[0][-1]["content"]
    assert "Delhi High Court" in user_msg and "list my matters" in user_msg


# ── create_calendar_event ───────────────────────────────────────────────────

def _plan(tool, inputs):
    return {"plan": [{"tool": tool, "inputs": inputs}], "reply": "ok"}


def test_create_event_verified(db):
    fake([_plan("create_calendar_event", {"title": "Hearing — Kumar", "event_date": "2026-11-20"})])
    t = engine.submit_task(db, 1, 10, "add a hearing on 20 Nov")
    assert t["state"] == "COMPLETED"
    assert t["steps"][0]["verification"].startswith("VERIFIED_SUCCESS")
    with sqlite3.connect(db) as c:
        row = c.execute("SELECT title, event_date, workspace_id FROM calendar_events").fetchone()
    assert row == ("Hearing — Kumar", "2026-11-20", 10)
    assert "calendar" in t["messages"][-1]["text"]


def test_create_event_bad_date_fails(db):
    fake([_plan("create_calendar_event", {"title": "Hearing", "event_date": "next tuesday"})])
    t = engine.submit_task(db, 1, 10, "add a hearing next tuesday")
    assert t["state"] == "FAILED"
    with sqlite3.connect(db) as c:
        assert c.execute("SELECT COUNT(*) FROM calendar_events").fetchone()[0] == 0


def test_create_event_duplicate_not_recreated(db):
    fake([_plan("create_calendar_event", {"title": "Hearing", "event_date": "2026-11-20"}),
          _plan("create_calendar_event", {"title": "Hearing", "event_date": "2026-11-20"})])
    engine.submit_task(db, 1, 10, "add hearing")
    t = engine.submit_task(db, 1, 10, "add hearing")
    assert t["state"] == "COMPLETED" and t["steps"][0]["output"]["duplicate"] is True
    with sqlite3.connect(db) as c:
        assert c.execute("SELECT COUNT(*) FROM calendar_events").fetchone()[0] == 1


# ── run_conflict_check ──────────────────────────────────────────────────────

def test_conflict_check_flags_other_workspace(db):
    with sqlite3.connect(db) as c:
        c.execute("INSERT INTO matters (title, owner_user_id, workspace_id) VALUES ('Gupta vs Sharma', 1, 99)")
    fake([_plan("run_conflict_check", {"party_name": "Gupta"})])
    t = engine.submit_task(db, 1, 10, "conflict check Gupta")
    assert t["state"] == "COMPLETED"
    out = t["steps"][0]["output"]
    assert out["conflict"] is True and any(h["kind"] == "matter" for h in out["hits"])
    assert "Potential conflict" in t["messages"][-1]["text"]


def test_conflict_check_clean_name(db):
    fake([_plan("run_conflict_check", {"party_name": "Nobody Named This"})])
    t = engine.submit_task(db, 1, 10, "conflict check")
    assert t["state"] == "COMPLETED" and t["steps"][0]["output"]["conflict"] is False


def test_conflict_check_same_workspace_not_conflict(db):
    with sqlite3.connect(db) as c:
        c.execute("INSERT INTO matters (title, owner_user_id, workspace_id) VALUES ('Kumar vs State', 1, 10)")
    fake([_plan("run_conflict_check", {"party_name": "Nonexistent Xyz"})])
    t = engine.submit_task(db, 1, 10, "conflict check Nonexistent Xyz")
    assert t["steps"][0]["output"]["conflict"] is False


# ── search_vault ────────────────────────────────────────────────────────────

def test_search_vault_scoped(db):
    with sqlite3.connect(db) as c:
        c.execute("INSERT INTO case_vault (title, workspace_id) VALUES ('NDA — Kumar', 10)")
        c.execute("INSERT INTO case_vault (title, workspace_id) VALUES ('NDA — OtherClient', 99)")
    fake([_plan("search_vault", {"query": "NDA"})])
    t = engine.submit_task(db, 1, 10, "find NDAs in the vault")
    out = t["steps"][0]["output"]
    assert out["count"] == 1 and out["documents"][0]["title"] == "NDA — Kumar"


# ── navigate ────────────────────────────────────────────────────────────────

def test_navigate_resolves_route(db):
    fake([_plan("navigate", {"destination": "calendar"})])
    t = engine.submit_task(db, 1, 10, "open the calendar")
    assert t["state"] == "COMPLETED" and t["steps"][0]["output"]["navigate_to"] == "/calendar"


def test_navigate_with_entity(db):
    fake([_plan("navigate", {"destination": "matters", "entity_id": 7})])
    t = engine.submit_task(db, 1, 10, "open matter 7")
    assert t["steps"][0]["output"]["navigate_to"] == "/matters/7"


def test_navigate_unknown_destination_fails(db):
    fake([_plan("navigate", {"destination": "narnia"})])
    t = engine.submit_task(db, 1, 10, "go to narnia")
    assert t["state"] == "FAILED"


# ── multi-step plan across modules ──────────────────────────────────────────

def test_multistep_conflict_then_matter_then_event(db):
    fake([{"plan": [
        {"tool": "run_conflict_check", "inputs": {"party_name": "Verma"}},
        {"tool": "create_matter", "inputs": {"title": "Verma vs Union"}, "depends_on": [0]},
        {"tool": "create_calendar_event", "inputs": {"title": "First hearing — Verma", "event_date": "2026-12-01"}, "depends_on": [1]},
    ], "reply": "Running conflict check, creating the matter, then scheduling."}])
    t = engine.submit_task(db, 1, 10, "onboard Verma vs Union and schedule first hearing 1 Dec")
    assert t["state"] == "COMPLETED"
    assert [s["state"] for s in t["steps"]] == ["DONE", "DONE", "DONE"]
    assert all(s["verification"].startswith("VERIFIED_SUCCESS") for s in t["steps"])
    with sqlite3.connect(db) as c:
        assert c.execute("SELECT COUNT(*) FROM matters WHERE workspace_id=10").fetchone()[0] == 1
        assert c.execute("SELECT COUNT(*) FROM calendar_events WHERE workspace_id=10").fetchone()[0] == 1
