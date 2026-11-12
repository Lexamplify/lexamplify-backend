"""Phase 4 gate tests: error classification, deterministic supervisor,
Level 1 checkpoint resume, Level 2 backward reasoning, LLM-proposed input
fixes, loop detection, recovery budgets, ask-user escalation."""
import sqlite3

import pytest

from agent import engine, providers, recovery, store
from agent.tools import core_tools, action_tools  # noqa: F401
from agent.tools import registry
from agent.tools.registry import Tool, VERIFIED_SUCCESS
from tests.agent.test_phase2 import make_db, seed_case, fake
from tests.agent.test_phase3 import CAL_SQL, WS_SQL


@pytest.fixture
def db(tmp_path):
    path = make_db(str(tmp_path / "agent4.db"))
    with sqlite3.connect(path) as c:
        c.execute(CAL_SQL)
        c.execute(WS_SQL)
    return path


@pytest.fixture(autouse=True)
def _reset_provider():
    yield
    providers.set_provider(None)


def _plan(tool, inputs, extra=None):
    return {"plan": [{"tool": tool, "inputs": inputs}] + (extra or []), "reply": "ok"}


# ── classification ──────────────────────────────────────────────────────────

def test_classify_known_errors():
    assert recovery.classify(sqlite3.OperationalError("locked")) == "DATABASE_ERROR"
    assert recovery.classify(sqlite3.IntegrityError("unique")) == "CONFLICT"
    assert recovery.classify(TimeoutError()) == "NETWORK_TIMEOUT"
    assert recovery.classify(ValueError("bad date")) == "VALIDATION_FAILED"
    assert recovery.classify(KeyError("title")) == "MISSING_PARAMETER"
    assert recovery.classify(PermissionError()) == "PERMISSION_DENIED"
    assert recovery.classify(LookupError()) == "RESOURCE_NOT_FOUND"
    assert recovery.classify(providers.ProviderError("down")) == "EXTERNAL_SERVICE_UNAVAILABLE"
    assert recovery.classify(RuntimeError("?")) == "UNKNOWN_ERROR"


# ── supervisor determinism ──────────────────────────────────────────────────

def test_supervisor_budget_and_loop_detection():
    s = recovery.Supervisor(budget=3)
    assert s.allow("t", "VALIDATION_FAILED", "bad date x")
    assert not s.allow("t", "VALIDATION_FAILED", "bad date x")   # identical failure = loop
    assert s.allow("t", "VALIDATION_FAILED", "bad date y")
    assert s.allow("t2", "DATABASE_ERROR", "locked")
    assert not s.allow("t3", "UNKNOWN_ERROR", "fresh")           # budget (3) spent


# ── transient errors retried without LLM ────────────────────────────────────

def test_transient_database_error_retried(db):
    calls = []

    def flaky(ctx, i):
        calls.append(1)
        if len(calls) == 1:
            raise sqlite3.OperationalError("database is locked")
        return {"ok": True}

    registry.register(Tool(name="flaky_tool", description="transient", required_inputs=[], risk="A",
                           run=flaky, verify=lambda c, i, o: (VERIFIED_SUCCESS, "fine")))
    try:
        fake([_plan("flaky_tool", {})])
        t = engine.submit_task(db, 1, 10, "do flaky thing")
        assert t["state"] == "COMPLETED" and len(calls) == 2     # retried in-loop, no LLM consult
    finally:
        registry._TOOLS.pop("flaky_tool", None)


# ── LLM input fix for the failing step ──────────────────────────────────────

def test_recovery_fixes_bad_input_same_step(db):
    # Planner proposes a bad date; recovery model corrects it; step succeeds.
    fake([
        _plan("create_calendar_event", {"title": "Hearing", "event_date": "20-11-2026"}),
        {"fix_step": 0, "inputs": {"title": "Hearing", "event_date": "2026-11-20"}},
    ])
    t = engine.submit_task(db, 1, 10, "add hearing on 20/11/2026")
    assert t["state"] == "COMPLETED"
    with sqlite3.connect(db) as c:
        assert c.execute("SELECT event_date FROM calendar_events").fetchone()[0] == "2026-11-20"
    assert any("retrying with corrected details" in m["text"] for m in t["messages"])


def test_recovery_loop_detected_same_bad_fix(db):
    # Recovery "fixes" with the SAME bad date → same failure signature → loop detected → FAILED.
    fake([
        _plan("create_calendar_event", {"title": "Hearing", "event_date": "garbage"}),
        {"fix_step": 0, "inputs": {"title": "Hearing", "event_date": "garbage"}},
        {"fix_step": 0, "inputs": {"title": "Hearing", "event_date": "garbage"}},
    ])
    t = engine.submit_task(db, 1, 10, "add hearing")
    assert t["state"] == "FAILED"
    assert "recovery budget is spent" in t["messages"][-1]["text"]
    with sqlite3.connect(db) as c:
        assert c.execute("SELECT COUNT(*) FROM calendar_events").fetchone()[0] == 0


def test_recovery_ask_user_escalation(db):
    fake([
        _plan("create_calendar_event", {"title": "Hearing", "event_date": "someday"}),
        {"ask_user": "What date is the hearing?"},
    ])
    t = engine.submit_task(db, 1, 10, "add the hearing")
    assert t["state"] == "WAITING_FOR_USER"
    assert t["messages"][-1]["text"] == "What date is the hearing?"


def test_recovery_give_up_when_fix_invalid(db):
    fake([
        _plan("create_calendar_event", {"title": "Hearing", "event_date": "bad"}),
        {"fix_step": 0, "inputs": {}},        # fix missing required inputs → rejected by validator
    ])
    t = engine.submit_task(db, 1, 10, "add hearing")
    assert t["state"] == "FAILED" and "could not recover" in t["messages"][-1]["text"]


# ── Level 2: backward reasoning ─────────────────────────────────────────────

def test_level2_backward_fix_earlier_step(db):
    # Step 0 creates matter with a junk title; step 1 fails; recovery blames step 0.
    bad_then_good = []

    def picky(ctx, i):
        # Fails until the matter title stops being junk (reads step-0 effect from DB).
        with sqlite3.connect(ctx["db_path"]) as c:
            t = c.execute("SELECT title FROM lpms_cases ORDER BY id DESC LIMIT 1").fetchone()
        if t and t[0] == "JUNK":
            raise ValueError("matter title is junk — cannot schedule")
        bad_then_good.append(1)
        return {"ok": True}

    registry.register(Tool(name="picky_tool", description="needs good matter", required_inputs=[], risk="A",
                           run=picky, verify=lambda c, i, o: (VERIFIED_SUCCESS, "fine")))
    try:
        fake([
            {"plan": [{"tool": "create_matter",
                       "inputs": {"title": "JUNK", "case_no": "CS 40/2026", "court": "Delhi HC"}},
                      {"tool": "picky_tool", "inputs": {}, "depends_on": [0]}], "reply": "ok"},
            {"fix_step": 0, "inputs": {"title": "Verma vs Union", "case_no": "CS 41/2026", "court": "Delhi HC"}},
        ])
        t = engine.submit_task(db, 1, 10, "onboard Verma vs Union")
        assert t["state"] == "COMPLETED"
        assert any("because step 1 was wrong" in m["text"] for m in t["messages"])
        with sqlite3.connect(db) as c:
            titles = [r[0] for r in c.execute("SELECT title FROM lpms_cases ORDER BY id").fetchall()]
        assert "Verma vs Union" in titles      # the corrected matter exists
        assert bad_then_good == [1]            # step 1 ultimately ran once, successfully
    finally:
        registry._TOOLS.pop("picky_tool", None)


# ── Level 1: resume after restart ───────────────────────────────────────────

def test_level1_resume_after_restart(db):
    # Simulate a crash mid-task: step 0 DONE, step 1 PENDING, task left EXECUTING.
    tid = store.create_task(db, 1, 10, "create matter then schedule")
    store.save_plan(db, tid, [
        {"tool": "create_matter", "inputs": {"title": "Resumed Case", "case_no": "CS 50/2026", "court": "Delhi HC"},
         "depends_on": [], "risk": "B"},
        {"tool": "create_calendar_event", "inputs": {"title": "Hearing", "event_date": "2026-12-01"},
         "depends_on": [0], "risk": "B"},
    ])
    seed_case(db, "Resumed Case", workspace_id=10)   # step 0 already done before the "crash"
    store.set_step(db, tid, 0, state="DONE", output={"matter_id": 1, "title": "Resumed Case"},
                   verification="VERIFIED_SUCCESS: pre-crash")
    store.set_task_state(db, tid, "EXECUTING")

    fake([])                                   # no planning call must happen on resume
    t = engine.resume_task(db, 1, 10, tid)
    assert t["state"] == "COMPLETED"
    with sqlite3.connect(db) as c:
        assert c.execute("SELECT COUNT(*) FROM lpms_cases").fetchone()[0] == 1  # step 0 NOT redone
        assert c.execute("SELECT COUNT(*) FROM calendar_events").fetchone()[0] == 1
    assert any("Resuming from the last checkpoint" in m["text"] for m in t["messages"])


def test_resume_ignores_terminal_tasks(db):
    tid = store.create_task(db, 1, 10, "x")
    store.set_task_state(db, tid, "COMPLETED")
    t = engine.resume_task(db, 1, 10, tid)
    assert t["state"] == "COMPLETED" and all(m["who"] == "ai" or True for m in t["messages"])
    assert not any("Resuming" in m["text"] for m in t["messages"])
