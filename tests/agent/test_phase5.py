"""Phase 5 gate tests: evidence reports with confidence labels, the
no-verification-no-completion invariant, partial verification, and
multi-step dependency plans."""
import sqlite3

import pytest

from agent import engine, providers
from agent.tools import core_tools, action_tools  # noqa: F401
from agent.tools import registry
from agent.tools.registry import Tool, PARTIALLY_VERIFIED, UNVERIFIED
from tests.agent.test_phase2 import make_db, fake
from tests.agent.test_phase3 import CAL_SQL, WS_SQL


@pytest.fixture
def db(tmp_path):
    path = make_db(str(tmp_path / "agent5.db"))
    with sqlite3.connect(path) as c:
        c.execute(CAL_SQL)
        c.execute(WS_SQL)
    return path


@pytest.fixture(autouse=True)
def _reset_provider():
    yield
    providers.set_provider(None)


def test_completed_task_carries_evidence_report(db):
    fake([{"plan": [
        {"tool": "create_matter", "inputs": {"title": "Evidence Case", "case_no": "CS 60/2026", "court": "Delhi HC"}},
        {"tool": "create_calendar_event", "inputs": {"title": "Hearing", "event_date": "2026-12-05"}, "depends_on": [0]},
    ], "reply": "ok"}])
    t = engine.submit_task(db, 1, 10, "onboard and schedule")
    assert t["state"] == "COMPLETED"
    ev = t["result"]["evidence"]
    assert len(ev) == 2
    assert all(e["confidence"] == "VERIFIED" for e in ev)
    assert "lpms_cases row id=" in ev[0]["evidence"]         # cites the DB row, not the AI's claim
    assert "calendar_events row id=" in ev[1]["evidence"]


def test_partially_verified_completes_but_labeled_uncertain(db):
    registry.register(Tool(name="fuzzy_tool", description="partial", required_inputs=[], risk="A",
                           run=lambda c, i: {"ok": True},
                           verify=lambda c, i, o: (PARTIALLY_VERIFIED, "state matched on 1 of 2 checks")))
    try:
        fake([{"plan": [{"tool": "fuzzy_tool", "inputs": {}}], "reply": "ok"}])
        t = engine.submit_task(db, 1, 10, "fuzzy")
        assert t["state"] == "COMPLETED"
        assert t["result"]["evidence"][0]["confidence"] == "UNCERTAIN"
    finally:
        registry._TOOLS.pop("fuzzy_tool", None)


def test_unverified_never_completes(db):
    # A tool with NO verification method cannot sail a task to COMPLETED.
    registry.register(Tool(name="blind_tool", description="no verify", required_inputs=[], risk="A",
                           run=lambda c, i: {"claims": "all good"}))
    try:
        fake([{"plan": [{"tool": "blind_tool", "inputs": {}}], "reply": "ok"}])
        t = engine.submit_task(db, 1, 10, "blind")
        assert t["state"] == "FAILED"
        assert t["error"]["code"] == "VALIDATION_FAILED"
    finally:
        registry._TOOLS.pop("blind_tool", None)


def test_five_step_dependency_plan(db):
    fake([{"plan": [
        {"tool": "run_conflict_check", "inputs": {"party_name": "Mehta"}},
        {"tool": "create_matter", "inputs": {"title": "Mehta vs State", "case_no": "CS 61/2026", "court": "Delhi HC"}, "depends_on": [0]},
        {"tool": "list_matters", "inputs": {}, "depends_on": [1]},
        {"tool": "create_calendar_event", "inputs": {"title": "Mention — Mehta", "event_date": "2026-12-10"}, "depends_on": [1]},
        {"tool": "navigate", "inputs": {"destination": "calendar"}, "depends_on": [3]},
    ], "reply": "ok"}])
    t = engine.submit_task(db, 1, 10, "onboard Mehta vs State, schedule mention 10 Dec, open calendar")
    assert t["state"] == "COMPLETED"
    assert [s["state"] for s in t["steps"]] == ["DONE"] * 5
    assert len(t["result"]["evidence"]) == 5
    assert t["steps"][2]["output"]["count"] == 1             # step 3 saw step 2's matter


def test_planner_rejects_forward_dependency(db):
    fake([{"plan": [
        {"tool": "list_matters", "inputs": {}, "depends_on": [1]},   # depends on a LATER step
        {"tool": "create_matter", "inputs": {"title": "X"}},
    ], "reply": "ok"}])
    t = engine.submit_task(db, 1, 10, "weird plan")
    assert t["state"] == "FAILED"
