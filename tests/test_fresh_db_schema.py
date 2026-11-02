"""A FRESH local database must carry workspace_id where the code needs it; an OLD file is only warned about (never changed);
and a schema error must not be reported as "the database is waking up".

Real bug: Auto-Draft "Start drafting" returned 503 "database is not responding / waking up" because draft_sessions had no
workspace_id (old local file). On a fresh file, Practice > Matters still returned 500 because lpms_cases (and several raw
tables) were created without workspace_id - only init_db() added it, and `flask run` never calls init_db().
"""
import logging
import sqlite3
from types import SimpleNamespace

from sqlalchemy.exc import OperationalError

from tests.helpers_app import make_app, register
from utils.schema_check import WORKSPACE_TABLES, missing_workspace_columns

OLD_DRAFT_SESSIONS = """
CREATE TABLE draft_sessions (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, doc_type VARCHAR(64) NOT NULL, title VARCHAR(200), case_ref VARCHAR(64),
    facts_json TEXT NOT NULL, step VARCHAR(24), status VARCHAR(16), created_at DATETIME, updated_at DATETIME)
"""


def _columns(db_file, table):
    con = sqlite3.connect(str(db_file))
    try:
        return {r[1] for r in con.execute(f'PRAGMA table_info("{table}")')}
    finally:
        con.close()


def test_fresh_database_has_workspace_id_everywhere_it_is_needed(tmp_path, monkeypatch):
    make_app(tmp_path, monkeypatch, name="fresh.db")
    db_file = tmp_path / "fresh.db"
    for table in ("draft_sessions", "lpms_cases", "calendar_events", "letterheads", "chat_history", "document_chunks", "dms_docs"):
        assert "workspace_id" in _columns(db_file, table), table
    from sqlalchemy import create_engine
    assert missing_workspace_columns(create_engine(f"sqlite:///{db_file}")) == []
    assert "draft_sessions" in WORKSPACE_TABLES and "lpms_cases" in WORKSPACE_TABLES


def test_drafts_and_practice_cases_work_on_a_fresh_database(tmp_path, monkeypatch):
    flask_app = make_app(tmp_path, monkeypatch, name="fresh.db")
    a = register(flask_app, "fresh@example.com")
    assert a.post("/api/practice/firm", json={"name": "Rao & Associates"}).status_code == 201
    r = a.post("/api/workspaces", json={"name": "Sharma Industries", "client_name": "Sharma Industries"})
    assert r.status_code == 201, r.get_json()
    ws = {"X-Workspace-Id": str(a.get("/api/workspaces").get_json()["workspaces"][0]["id"])}

    r = a.post("/api/drafts/sessions", json={"type": "notice_138", "facts": {}}, headers=ws)
    assert r.status_code == 201, r.get_json()
    assert a.get("/api/drafts/sessions", headers=ws).status_code == 200
    r = a.get("/api/practice/cases?per_page=100&sort=next_hearing", headers=ws)       # the call that returned 500 (c.workspace_id)
    assert r.status_code == 200, r.get_json()


def test_old_database_is_warned_about_and_left_untouched(tmp_path, monkeypatch, caplog):
    db_file = tmp_path / "old.db"
    con = sqlite3.connect(str(db_file))
    con.execute(OLD_DRAFT_SESSIONS)
    con.commit()
    con.close()
    with caplog.at_level(logging.WARNING):
        make_app(tmp_path, monkeypatch, name="old.db")
    assert any("Local database is out of date" in m and "draft_sessions.workspace_id" in m for m in caplog.messages)
    assert "workspace_id" not in _columns(db_file, "draft_sessions")        # read-only: nothing was altered


def test_schema_check_ignores_postgres():
    assert missing_workspace_columns(SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))) == []


def _app_with_failing_route(tmp_path, monkeypatch, exc):
    flask_app = make_app(tmp_path, monkeypatch)

    def boom():
        raise exc
    flask_app.add_url_rule("/api/_test_db_boom", "test_db_boom", boom)
    return register(flask_app, "boom@example.com")


def test_schema_error_is_not_reported_as_database_waking_up(tmp_path, monkeypatch):
    exc = OperationalError("SELECT 1", {}, Exception("no such column: draft_sessions.workspace_id"))
    r = _app_with_failing_route(tmp_path, monkeypatch, exc).get("/api/_test_db_boom")
    body = r.get_json()
    assert r.status_code == 500
    assert body["code"] == "DB_SCHEMA_MISMATCH"
    assert "waking up" not in body["message"] and "not responding" not in body["message"]
    assert "workspace_id" not in body["message"]                    # no internal names shown to the user
    assert body["request_id"]


def test_real_connection_problem_still_says_database_is_waking_up(tmp_path, monkeypatch):
    exc = OperationalError("SELECT 1", {}, Exception("could not connect to server: Connection refused"))
    r = _app_with_failing_route(tmp_path, monkeypatch, exc).get("/api/_test_db_boom")
    assert r.status_code == 503
    assert r.get_json()["code"] == "DB_UNAVAILABLE"
    assert "waking up" in r.get_json()["message"]
