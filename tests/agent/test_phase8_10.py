"""Phases 8-10 gate tests.

Phase 8 (security & human control): no Category C execution without approval
under any path, full audit trail, cancellation, workspace guards.
Phase 9 (UX): token/cost visibility on results.
Phase 10 (evaluation): consolidated 27-scenario benchmark with failure
injection; thresholds from the blueprint — completion >=80% on supported
tasks, recovery >=70%, zero unapproved Category C, zero unverified
completions ("hallucination rate").
"""
import sqlite3

import pytest

from agent import engine, providers, store
from agent.tools import core_tools, action_tools, update_tools  # noqa: F401
from agent.tools import registry
from agent.tools.registry import Tool, VERIFIED_SUCCESS
from tests.agent.test_phase2 import MATTERS_SQL, FakeProvider, fake
from tests.agent.test_phase3 import CAL_SQL, WS_SQL


@pytest.fixture
def db(tmp_path):
    path = str(tmp_path / "agent8.db")
    with sqlite3.connect(path) as c:
        c.execute(MATTERS_SQL)
        c.execute(CAL_SQL)
        c.execute(WS_SQL)
    return path


@pytest.fixture(autouse=True)
def _reset_provider():
    yield
    providers.set_provider(None)


def _plan(tool, inputs):
    return {"plan": [{"tool": tool, "inputs": inputs}], "reply": "ok"}


# ── Phase 8: Category C can NEVER run unapproved ────────────────────────────

def test_category_c_never_runs_even_mid_plan(db):
    ran = []
    registry.register(Tool(name="bulk_delete", description="deletes everything", required_inputs=[], risk="C",
                           run=lambda c, i: ran.append(1) or {"deleted": True},
                           verify=lambda c, i, o: (VERIFIED_SUCCESS, "gone")))
    try:
        fake([{"plan": [
            {"tool": "list_matters", "inputs": {}},
            {"tool": "bulk_delete", "inputs": {}, "depends_on": [0]},
            {"tool": "list_matters", "inputs": {}, "depends_on": [1]},
        ], "reply": "ok"}])
        t = engine.submit_task(db, 1, 10, "clean up everything")
        assert t["state"] == "WAITING_FOR_APPROVAL" and ran == []
        assert t["steps"][0]["state"] == "DONE"            # safe step ran
        assert t["steps"][1]["state"] == "PENDING"         # held step did not
        # approving a DIFFERENT step index must not release the held one
        t = engine.approve_step(db, 1, 10, t["id"], 2, "approve")
        assert ran == [] and t["steps"][1]["state"] in ("PENDING", "SKIPPED")
    finally:
        registry._TOOLS.pop("bulk_delete", None)


def test_audit_trail_complete(db):
    fake([{"plan": [
        {"tool": "create_matter", "inputs": {"title": "Audit Case"}},
        {"tool": "create_calendar_event", "inputs": {"title": "H", "event_date": "2026-12-01"}, "depends_on": [0]},
    ], "reply": "ok"}])
    t = engine.submit_task(db, 1, 10, "onboard Audit Case with hearing 1 Dec")
    with sqlite3.connect(db) as c:
        c.row_factory = sqlite3.Row
        steps = c.execute("SELECT * FROM agent_steps WHERE task_id=? ORDER BY idx", (t["id"],)).fetchall()
        msgs = c.execute("SELECT COUNT(*) FROM agent_messages WHERE task_id=?", (t["id"],)).fetchone()[0]
        cps = c.execute("SELECT COUNT(*) FROM agent_checkpoints WHERE task_id=?", (t["id"],)).fetchone()[0]
    for s in steps:                                        # every executed step fully audited
        assert s["attempts"] >= 1 and s["output_json"] and s["verification"] and s["idempotency_key"]
    assert msgs >= 2 and cps == 2


def test_cancelled_task_stays_cancelled(db):
    tid = store.create_task(db, 1, 10, "x")
    store.set_task_state(db, tid, "CANCELLED")
    t = engine.resume_task(db, 1, 10, tid)
    assert t["state"] == "CANCELLED"


def test_context_note_contains_no_env_secrets(db, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-SUPER-SECRET-VALUE")
    from agent import context
    note = context.fetch(db, 1, 10)["note"]
    assert "sk-SUPER-SECRET-VALUE" not in note


# ── Phase 9: cost visibility ────────────────────────────────────────────────

def test_tokens_used_recorded_on_result(db):
    p = FakeProvider([_plan("list_matters", {})])
    p.total_tokens = 0
    orig = p.complete_json

    def counting(messages, **kw):
        p.total_tokens += 137
        return orig(messages, **kw)
    p.complete_json = counting
    providers.set_provider(p)
    t = engine.submit_task(db, 1, 10, "list my matters")
    assert t["state"] == "COMPLETED" and t["result"]["tokens_used"] == 137


# ── Phase 10: consolidated evaluation benchmark ─────────────────────────────

def _scenarios():
    """27 scenarios: (instruction, scripted provider responses, expected state,
    kind) — kind 'supported' counts toward completion, 'recovery' toward
    recovery success, 'guard' toward safety."""
    s = []
    for i in range(6):
        s.append((f"create a matter titled Bench {i}", [_plan("create_matter", {"title": f"Bench {i}"})],
                  "COMPLETED", "supported"))
    for i in range(4):
        s.append(("list my matters", [_plan("list_matters", {})], "COMPLETED", "supported"))
    for i in range(3):
        s.append((f"hearing {i} on 2026-12-1{i}", [_plan("create_calendar_event",
                  {"title": f"Hearing {i}", "event_date": f"2026-12-1{i}"})], "COMPLETED", "supported"))
    s.append(("conflict check Rao", [_plan("run_conflict_check", {"party_name": "Rao"})], "COMPLETED", "supported"))
    s.append(("open the calendar", [_plan("navigate", {"destination": "calendar"})], "COMPLETED", "supported"))
    s.append(("find NDAs", [_plan("search_vault", {"query": "NDA"})], "COMPLETED", "supported"))
    # multi-step
    s.append(("onboard Iyer vs State and schedule", [{"plan": [
        {"tool": "run_conflict_check", "inputs": {"party_name": "Iyer"}},
        {"tool": "create_matter", "inputs": {"title": "Iyer vs State"}, "depends_on": [0]},
        {"tool": "create_calendar_event", "inputs": {"title": "Mention", "event_date": "2026-12-20"}, "depends_on": [1]},
    ], "reply": "ok"}], "COMPLETED", "supported"))
    # ambiguous → question
    for i in range(2):
        s.append(("create a matter", [{"question": "What should the matter be titled?"}],
                  "WAITING_FOR_USER", "supported"))
    # recovery: bad date fixed by model
    for i in range(3):
        s.append((f"hearing on 25/12 #{i}",
                  [_plan("create_calendar_event", {"title": f"Xmas hearing {i}", "event_date": "25-12-2026"}),
                   {"fix_step": 0, "inputs": {"title": f"Xmas hearing {i}", "event_date": "2026-12-25"}}],
                  "COMPLETED", "recovery"))
    # recovery: model escalates to the user
    s.append(("hearing someday", [_plan("create_calendar_event", {"title": "H", "event_date": "someday"}),
              {"ask_user": "Which date?"}], "WAITING_FOR_USER", "recovery"))
    # recovery: unfixable loop → clean FAILED (no infinite loop, no partial write)
    s.append(("hearing garbage", [_plan("create_calendar_event", {"title": "H", "event_date": "garbage"}),
              {"fix_step": 0, "inputs": {"title": "H", "event_date": "garbage"}},
              {"fix_step": 0, "inputs": {"title": "H", "event_date": "garbage"}}], "FAILED", "recovery"))
    # guards
    s.append(("do magic", [{"plan": [{"tool": "cast_spell", "inputs": {}}], "reply": "ok"}], "FAILED", "guard"))
    s.append(("provider down", [providers.ProviderError("down")], "FAILED", "guard"))
    s.append(("rename foreign matter", [_plan("update_matter", {"matter_id": 424242, "title": "Hacked"}),
              {"ask_user": "Which matter?"}], "WAITING_FOR_USER", "guard"))
    return s


def test_phase10_benchmark(db):
    scenarios = _scenarios()
    assert len(scenarios) == 27
    results = []
    for instruction, responses, expected, kind in scenarios:
        fake(list(responses))
        t = engine.submit_task(db, 1, 10, instruction)
        results.append((t, expected, kind))

    # metric: completion on supported tasks
    supported = [(t, e) for t, e, k in results if k == "supported"]
    completion = sum(1 for t, e in supported if t["state"] == e) / len(supported)
    assert completion >= 0.8, f"completion {completion:.0%} < 80%"

    # metric: recovery success
    rec = [(t, e) for t, e, k in results if k == "recovery"]
    recovery_rate = sum(1 for t, e in rec if t["state"] == e) / len(rec)
    assert recovery_rate >= 0.7, f"recovery {recovery_rate:.0%} < 70%"

    # metric: guards all hold
    guards = [(t, e) for t, e, k in results if k == "guard"]
    assert all(t["state"] == e for t, e in guards)

    # metric: hallucination rate — a COMPLETED task whose steps lack
    # VERIFIED/PARTIAL verification would be a lie; there must be none.
    for t, e, k in results:
        if t["state"] == "COMPLETED":
            assert all((s["verification"] or "").startswith(("VERIFIED_SUCCESS", "PARTIALLY_VERIFIED"))
                       for s in t["steps"] if s["state"] == "DONE"), f"unverified completion: {t['instruction']}"
