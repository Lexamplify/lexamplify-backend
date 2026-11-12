"""Phase 2 gate tests for the Executive Assistant core: store, planner,
engine, verification, approvals, workspace isolation, API routes, and the
20-task mini-benchmark. The LLM is always a scripted fake (conftest blanks
all API keys; tests run offline)."""
import json
import sqlite3

import pytest

from agent import engine, planner, providers, store
from agent.tools import core_tools  # noqa: F401 — registers list_matters / create_matter
from agent.tools import registry
from agent.tools.registry import Tool, VERIFIED_FAILURE, VERIFIED_SUCCESS


MATTERS_SQL = ("CREATE TABLE IF NOT EXISTS matters (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, "
               "status TEXT NOT NULL DEFAULT 'open', team_id INTEGER, lead_counsel TEXT, opened_date DATE, "
               "owner_user_id INTEGER NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, workspace_id INTEGER)")


class FakeProvider:
    """Returns scripted JSON responses in order; records the prompts it saw."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def complete_json(self, messages, **kw):
        self.calls.append(messages)
        if not self.responses:
            raise providers.ProviderError("fake provider exhausted")
        r = self.responses.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


@pytest.fixture
def db(tmp_path):
    path = str(tmp_path / "agent.db")
    with sqlite3.connect(path) as c:
        c.execute(MATTERS_SQL)
    return path


@pytest.fixture(autouse=True)
def _reset_provider():
    yield
    providers.set_provider(None)


def fake(responses):
    p = FakeProvider(responses)
    providers.set_provider(p)
    return p


PLAN_CREATE = {"plan": [{"tool": "create_matter", "inputs": {"title": "Sharma vs Gupta"}, "depends_on": []}],
               "reply": "Creating the matter now."}
PLAN_LIST = {"plan": [{"tool": "list_matters", "inputs": {}, "depends_on": []}], "reply": "Listing matters."}


# ── store ────────────────────────────────────────────────────────────────────

def test_store_task_roundtrip(db):
    tid = store.create_task(db, 7, 3, "do something")
    store.save_plan(db, tid, [{"tool": "list_matters", "inputs": {}, "depends_on": [], "risk": "A"}])
    store.set_step(db, tid, 0, state="DONE", output={"ok": True}, verification="VERIFIED_SUCCESS: fine")
    store.set_task_state(db, tid, "COMPLETED", result={"x": 1})
    store.add_message(db, tid, "ai", "done")
    t = store.get_task(db, tid)
    assert t["state"] == "COMPLETED" and t["user_id"] == 7 and t["workspace_id"] == 3
    assert t["steps"][0]["state"] == "DONE" and t["steps"][0]["output"] == {"ok": True}
    assert t["steps"][0]["idempotency_key"] == f"{tid}:0"
    assert t["messages"][-1]["text"] == "done"
    assert store.list_tasks(db, 7, 3)[0]["id"] == tid
    assert store.list_tasks(db, 7, 99) == []          # another workspace sees nothing
    assert store.list_tasks(db, 8, 3) == []           # another user sees nothing


def test_failure_memory(db):
    store.record_failure(db, "RATE_LIMITED", "create_matter", "429", {"wait": 30}, verified=True)
    assert store.lookup_failure(db, "RATE_LIMITED", "create_matter") == {"wait": 30}
    assert store.lookup_failure(db, "RATE_LIMITED", "other_tool") is None


# ── planner ──────────────────────────────────────────────────────────────────

def test_planner_validates_known_tools(db):
    fake([PLAN_CREATE])
    kind, steps, reply = planner.make_plan("create a matter titled Sharma vs Gupta")
    assert kind == "plan" and steps[0]["tool"] == "create_matter" and steps[0]["risk"] == "B"


def test_planner_rejects_unknown_tool(db):
    fake([{"plan": [{"tool": "drop_database", "inputs": {}}], "reply": "ok"}])
    with pytest.raises(planner.PlanError):
        planner.make_plan("drop everything")


def test_planner_missing_input_becomes_question(db):
    fake([{"plan": [{"tool": "create_matter", "inputs": {}}], "reply": "ok"}])
    kind, q, _ = planner.make_plan("create a matter")
    assert kind == "question" and "title" in q


def test_planner_passes_model_question_through(db):
    fake([{"question": "What should the matter be called?"}])
    kind, q, _ = planner.make_plan("create a matter")
    assert kind == "question" and "called" in q


# ── engine happy path + verification ────────────────────────────────────────

def test_engine_creates_and_verifies_matter(db):
    fake([PLAN_CREATE])
    t = engine.submit_task(db, 1, 10, "create a matter titled Sharma vs Gupta")
    assert t["state"] == "COMPLETED"
    step = t["steps"][0]
    assert step["state"] == "DONE" and step["verification"].startswith("VERIFIED_SUCCESS")
    with sqlite3.connect(db) as c:
        row = c.execute("SELECT title, workspace_id, owner_user_id FROM matters").fetchone()
    assert row == ("Sharma vs Gupta", 10, 1)
    assert "#" in t["messages"][-1]["text"]           # summary cites the created id


def test_engine_duplicate_matter_not_recreated(db):
    fake([PLAN_CREATE, dict(PLAN_CREATE)])
    engine.submit_task(db, 1, 10, "create a matter titled Sharma vs Gupta")
    t2 = engine.submit_task(db, 1, 10, "create a matter titled Sharma vs Gupta")
    assert t2["state"] == "COMPLETED" and t2["steps"][0]["output"]["duplicate"] is True
    with sqlite3.connect(db) as c:
        n = c.execute("SELECT COUNT(*) FROM matters").fetchone()[0]
    assert n == 1


def test_engine_workspace_isolation(db):
    fake([PLAN_CREATE, PLAN_LIST])
    engine.submit_task(db, 1, 10, "create a matter titled Sharma vs Gupta")
    t = engine.submit_task(db, 1, 20, "list my matters")      # other workspace
    assert t["state"] == "COMPLETED" and t["steps"][0]["output"]["count"] == 0


def test_engine_failed_verification_fails_task(db):
    registry.register(Tool(name="broken_tool", description="always lies", required_inputs=[], risk="A",
                           run=lambda ctx, i: {"claims": "done"},
                           verify=lambda ctx, i, o: (VERIFIED_FAILURE, "no evidence in DB")))
    try:
        fake([{"plan": [{"tool": "broken_tool", "inputs": {}}], "reply": "ok"}])
        t = engine.submit_task(db, 1, 10, "do the broken thing")
        assert t["state"] == "FAILED" and t["error"]["code"] == "VALIDATION_FAILED"
        assert "not marking this done" in t["messages"][-1]["text"]
    finally:
        registry._TOOLS.pop("broken_tool", None)


def test_engine_tool_exception_bounded_attempts(db):
    attempts = []

    def boom(ctx, i):
        attempts.append(1)
        raise RuntimeError("kaput")           # UNKNOWN_ERROR → not retryable blindly

    registry.register(Tool(name="exploding_tool", description="raises", required_inputs=[], risk="A", run=boom))
    try:
        # plan, then recovery consult (provider exhausted → give up cleanly)
        fake([{"plan": [{"tool": "exploding_tool", "inputs": {}}], "reply": "ok"}])
        t = engine.submit_task(db, 1, 10, "explode")
        assert t["state"] == "FAILED"
        assert len(attempts) == 1             # non-retryable errors are not blindly retried
        with sqlite3.connect(db) as c:
            n = c.execute("SELECT COUNT(*) FROM agent_failure_memory").fetchone()[0]
        assert n == 1                         # the failure is remembered
    finally:
        registry._TOOLS.pop("exploding_tool", None)


# ── WAITING_FOR_USER round trip ─────────────────────────────────────────────

def test_engine_question_then_answer(db):
    fake([{"question": "What title?"}, PLAN_CREATE])
    t = engine.submit_task(db, 1, 10, "create a matter")
    assert t["state"] == "WAITING_FOR_USER" and t["messages"][-1]["text"] == "What title?"
    t = engine.resume_with_answer(db, 1, 10, t["id"], "Sharma vs Gupta")
    assert t["state"] == "COMPLETED"
    with sqlite3.connect(db) as c:
        assert c.execute("SELECT COUNT(*) FROM matters").fetchone()[0] == 1


# ── Category C approval ─────────────────────────────────────────────────────

def _temp_c_tool(record):
    return Tool(name="send_notice", description="sends a legal notice (consequential)", required_inputs=[],
                risk="C", run=lambda ctx, i: record.append("sent") or {"sent": True},
                verify=lambda ctx, i, o: (VERIFIED_SUCCESS, "recorded"))


def test_engine_category_c_waits_for_approval(db):
    record = []
    registry.register(_temp_c_tool(record))
    try:
        fake([{"plan": [{"tool": "send_notice", "inputs": {}}], "reply": "ok"}])
        t = engine.submit_task(db, 1, 10, "send the notice")
        assert t["state"] == "WAITING_FOR_APPROVAL" and record == []       # did NOT run
        t = engine.approve_step(db, 1, 10, t["id"], 0, "approve")
        assert t["state"] == "COMPLETED" and record == ["sent"]
    finally:
        registry._TOOLS.pop("send_notice", None)


def test_engine_category_c_reject_cancels(db):
    record = []
    registry.register(_temp_c_tool(record))
    try:
        fake([{"plan": [{"tool": "send_notice", "inputs": {}}], "reply": "ok"}])
        t = engine.submit_task(db, 1, 10, "send the notice")
        t = engine.approve_step(db, 1, 10, t["id"], 0, "reject")
        assert t["state"] == "CANCELLED" and record == []
    finally:
        registry._TOOLS.pop("send_notice", None)


# ── provider failure never crashes ──────────────────────────────────────────

def test_engine_provider_down_fails_cleanly(db):
    fake([providers.ProviderError("No LLM provider configured")])
    t = engine.submit_task(db, 1, 10, "list my matters")
    assert t["state"] == "FAILED" and t["error"]["code"] == "EXTERNAL_SERVICE_UNAVAILABLE"


# ── API routes ──────────────────────────────────────────────────────────────

@pytest.fixture
def api(db, tmp_path, monkeypatch):
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
    client = app.test_client()
    client.environ_base = {}
    return client, {"Authorization": f"Bearer {token}"}


def test_api_task_lifecycle(api, db):
    client, headers = api
    fake([PLAN_CREATE])
    r = client.post("/api/agent/task", headers=headers, json={"instruction": "create a matter titled Sharma vs Gupta"})
    assert r.status_code == 201, r.get_json()
    task = r.get_json()["task"]
    assert task["state"] == "COMPLETED"

    r = client.get("/api/agent/tasks", headers=headers)
    assert r.status_code == 200 and len(r.get_json()["tasks"]) == 1

    r = client.get(f"/api/agent/task/{task['id']}", headers=headers)
    assert r.status_code == 200 and r.get_json()["task"]["id"] == task["id"]


def test_api_rejects_empty_instruction(api):
    client, headers = api
    r = client.post("/api/agent/task", headers=headers, json={})
    assert r.status_code == 400


def test_api_requires_auth(api):
    client, _ = api
    r = client.post("/api/agent/task", json={"instruction": "x"})
    assert r.status_code == 401


def test_api_other_users_task_hidden(api, db):
    client, headers = api
    other = store.create_task(db, 999, None, "someone else's secret task")
    r = client.get(f"/api/agent/task/{other}", headers=headers)
    assert r.status_code == 404


# ── 20-task mini-benchmark (Phase 2 acceptance: ≥60% completion) ────────────

BENCH = []
for i in range(8):
    BENCH.append((f"create a matter titled Case {i}",
                  {"plan": [{"tool": "create_matter", "inputs": {"title": f"Case {i}"}}], "reply": "ok"}, "COMPLETED"))
for i in range(6):
    BENCH.append(("list my matters", PLAN_LIST, "COMPLETED"))
BENCH += [
    ("create a matter", {"plan": [{"tool": "create_matter", "inputs": {}}], "reply": "ok"}, "WAITING_FOR_USER"),
    ("create a matter", {"question": "What title?"}, "WAITING_FOR_USER"),
    ("do magic", {"plan": [{"tool": "cast_spell", "inputs": {}}], "reply": "ok"}, "FAILED"),
    ("garbage json", providers.ProviderError("invalid JSON"), "FAILED"),
    ("list my matters", PLAN_LIST, "COMPLETED"),
    ("create a matter titled Final", {"plan": [{"tool": "create_matter", "inputs": {"title": "Final"}}], "reply": "ok"}, "COMPLETED"),
]


def test_benchmark_20_tasks(db):
    assert len(BENCH) == 20
    ok = 0
    for instruction, scripted, expected in BENCH:
        fake([scripted])
        t = engine.submit_task(db, 1, 10, instruction)
        if t["state"] == expected:
            ok += 1
    rate = ok / len(BENCH)
    assert rate >= 0.6, f"benchmark pass rate {rate:.0%} below Phase 2 gate (details: expected states not reached)"
    # With a scripted provider the engine itself must be fully deterministic:
    assert rate == 1.0, f"engine behaved nondeterministically: {rate:.0%}"
