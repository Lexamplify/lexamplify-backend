"""Phase 7 gate tests: Level 3 post-completion modification (update tools +
recent-action context), workspace guards on updates, and route-level
restart recovery."""
import sqlite3

import pytest

from agent import context, engine, providers, store
from agent.tools import core_tools, action_tools, update_tools  # noqa: F401
from tests.agent.test_phase2 import make_db, seed_case, fake
from tests.agent.test_phase3 import CAL_SQL, WS_SQL


@pytest.fixture
def db(tmp_path):
    path = make_db(str(tmp_path / "agent7.db"))
    with sqlite3.connect(path) as c:
        c.execute(CAL_SQL)
        c.execute(WS_SQL)
    return path


@pytest.fixture(autouse=True)
def _reset_provider():
    yield
    providers.set_provider(None)


def _plan(tool, inputs):
    return {"plan": [{"tool": tool, "inputs": inputs}], "reply": "ok"}


# ── Level 3: post-completion modification ───────────────────────────────────

def test_l3_change_after_completion(db):
    # Task 1 creates the matter; task 2 says "change the title" — planner gets
    # the created id in context and targets update_matter.
    fake([_plan("create_matter", {"title": "Sharma vs Gupta", "case_no": "CS 70/2026", "court": "Delhi HC"})])
    t1 = engine.submit_task(db, 1, 10, "create a matter titled Sharma vs Gupta")
    mid = t1["steps"][0]["output"]["matter_id"]

    p = fake([_plan("update_matter", {"matter_id": mid, "title": "Sharma vs Gupta & Ors"})])
    t2 = engine.submit_task(db, 1, 10, "change that matter's title to Sharma vs Gupta & Ors")
    assert t2["state"] == "COMPLETED"
    assert t2["steps"][0]["verification"].startswith("VERIFIED_SUCCESS")
    with sqlite3.connect(db) as c:
        assert c.execute("SELECT title FROM lpms_cases WHERE id=?", (mid,)).fetchone()[0] == "Sharma vs Gupta & Ors"
    # the planner was told about the earlier action and its id
    assert f"matter_id={mid}" in p.calls[0][-1]["content"]


def test_l3_update_cascades_to_linked_event(db):
    seed_case(db, "Old", workspace_id=10, case_id=5)
    with sqlite3.connect(db) as c:
        c.execute("INSERT INTO calendar_events (id, event_date, title, workspace_id) VALUES (9, '2026-12-01', 'Hearing — Old', 10)")
    fake([{"plan": [
        {"tool": "update_matter", "inputs": {"matter_id": 5, "title": "New Name"}},
        {"tool": "update_calendar_event", "inputs": {"event_id": 9, "title": "Hearing — New Name"}, "depends_on": [0]},
    ], "reply": "ok"}])
    t = engine.submit_task(db, 1, 10, "rename matter 5 to New Name and fix its hearing title")
    assert t["state"] == "COMPLETED"
    with sqlite3.connect(db) as c:
        assert c.execute("SELECT title FROM calendar_events WHERE id=9").fetchone()[0] == "Hearing — New Name"


def test_update_matter_wrong_workspace_blocked(db):
    seed_case(db, "Foreign", workspace_id=99, case_id=7)
    fake([_plan("update_matter", {"matter_id": 7, "title": "Hacked"}),
          {"ask_user": "Which matter do you mean?"}])      # recovery escalates
    t = engine.submit_task(db, 1, 10, "rename matter 7")
    assert t["state"] in ("FAILED", "WAITING_FOR_USER")    # never silently succeeds
    with sqlite3.connect(db) as c:
        assert c.execute("SELECT title FROM lpms_cases WHERE id=7").fetchone()[0] == "Foreign"


def test_update_with_no_fields_fails_cleanly(db):
    seed_case(db, "X", workspace_id=10, case_id=3)
    fake([_plan("update_matter", {"matter_id": 3}),
          {"ask_user": "What do you want to change?"}])
    t = engine.submit_task(db, 1, 10, "update matter 3")
    assert t["state"] == "WAITING_FOR_USER"


# ── recent-action context ───────────────────────────────────────────────────

def test_context_includes_recent_actions_only_this_workspace(db):
    fake([_plan("create_matter", {"title": "WS10 Case", "case_no": "CS 71/2026", "court": "Delhi HC"})])
    engine.submit_task(db, 1, 10, "create a matter titled WS10 Case")
    fake([_plan("create_matter", {"title": "WS20 Case", "case_no": "CS 72/2026", "court": "Delhi HC"})])
    engine.submit_task(db, 1, 20, "create a matter titled WS20 Case")

    note10 = context.fetch(db, 1, 10)["note"]
    assert "WS10 Case" in note10 and "WS20 Case" not in note10
    assert "matter_id=" in note10


# ── route-level restart recovery ────────────────────────────────────────────

@pytest.fixture
def api(db):
    from flask import Flask
    from flask_jwt_extended import JWTManager, create_access_token
    from routes.agent_routes import agent_bp
    app = Flask(__name__)
    app.config.update(JWT_SECRET_KEY="test-secret-key-that-is-long-enough-for-hs256",
                      JWT_TOKEN_LOCATION=["headers"], TESTING=True)
    JWTManager(app)
    app.extensions['lpms_db_path'] = db
    app.register_blueprint(agent_bp)
    with app.app_context():
        token = create_access_token(identity="1")
    return app.test_client(), {"Authorization": f"Bearer {token}"}


def test_get_task_resumes_stranded_execution(api, db):
    client, headers = api
    tid = store.create_task(db, 1, 10, "stranded")
    store.save_plan(db, tid, [{"tool": "list_matters", "inputs": {}, "depends_on": [], "risk": "A"}])
    store.set_task_state(db, tid, "EXECUTING")             # "server died" here
    fake([])                                               # resume must not re-plan
    r = client.get(f"/api/agent/task/{tid}", headers=headers)
    assert r.status_code == 200
    assert r.get_json()["task"]["state"] == "COMPLETED"    # picked up and finished
