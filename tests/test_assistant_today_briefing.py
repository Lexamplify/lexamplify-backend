"""Phase 2 — the Today-briefing flag, the label ping, and the flow whitelist.

The model is faked everywhere (the network guard in conftest stays on, so nothing can reach a provider). What these
prove: the flag is OFF by default and read per request; the label ping carries no sentence, calls no model, and stores
only the fixed label "today_briefing_opened" (feature "start", intent "open"); the whitelist refuses any other event or
any extra key; a ping without a workspace is still answered; and the existing create-matter flow still works alongside
the new flow dispatch. The briefing's actual numbers are read in the browser, never here — so nothing in this route ever
sees a client name, a matter or a hearing.
"""
import json
from types import SimpleNamespace

import pytest

from routes import assistant_command_routes as route_mod
from tests.helpers_app import make_app, register

pytestmark = pytest.mark.strict_network

# A name that must never appear in history, a log line or a reply — proof that no free text can ride a ping.
SECRET_NAME = "Sharma"


class Res:
    def __init__(self, content, total_tokens=120, model="openai/gpt-oss-20b"):
        self.choices = [SimpleNamespace(message=SimpleNamespace(content=content), finish_reason="stop")]
        self.usage = SimpleNamespace(total_tokens=total_tokens, prompt_tokens=100, completion_tokens=20)
        self.model = model


class World:
    """One signed-in advocate in their own workspace, with the router model faked (never expected to be called)."""

    def __init__(self, client, workspace_id, calls):
        self.client, self.workspace_id, self.calls = client, workspace_id, calls

    def brief(self, **body):
        return self.client.post("/api/assistant/command", json={"flow": "today_briefing", **body},
                                headers={"X-Workspace-Id": str(self.workspace_id)})

    def post(self, body):
        return self.client.post("/api/assistant/command", json=body, headers={"X-Workspace-Id": str(self.workspace_id)})

    def history_rows(self):
        return self.brief().get_json().get("history", [])


def _make_world(tmp_path, monkeypatch):
    flask_app = make_app(tmp_path, monkeypatch)
    client = register(flask_app, "advocate@example.com")
    client.post("/api/practice/firm", json={"name": "Rao & Associates"})
    r = client.post("/api/workspaces", json={"name": "Sharma Industries", "client_name": "Sharma Industries"})
    assert r.status_code == 201, r.get_json()
    wid = client.get("/api/workspaces").get_json()["workspaces"][0]["id"]

    calls = []

    def fake_completion(**kw):
        calls.append(kw)
        return Res(json.dumps({"feature": "calendar", "action": "open", "inputs": {}, "understood": "Open."}))
    monkeypatch.setattr("utils.llm_client.completion", fake_completion)
    route_mod.reset_model_call_counter()
    return World(client, wid, calls)


@pytest.fixture
def world(tmp_path, monkeypatch):
    # Unset unless a test sets it, so the default-OFF behaviour is what most tests see.
    monkeypatch.delenv("ASSISTANT_TODAY_BRIEFING_ENABLED", raising=False)
    return _make_world(tmp_path, monkeypatch)


# ── the flag, read per request, default OFF ────────────────────────────────────────────────────────────────────────────
def test_the_flag_is_off_by_default(world):
    body = world.brief().get_json()
    assert body["flow"] == "today_briefing" and body["enabled"] is False
    assert world.calls == []                                            # a ping never calls a model


@pytest.mark.parametrize("value", ["true", "1", "yes", "on", "TRUE", "On", "Yes", "  true  "])
def test_truthy_values_turn_it_on(world, monkeypatch, value):
    monkeypatch.setenv("ASSISTANT_TODAY_BRIEFING_ENABLED", value)
    assert world.brief().get_json()["enabled"] is True


@pytest.mark.parametrize("value", ["false", "0", "no", "off", "False", "OFF", "", "   ", "maybe", "2"])
def test_everything_else_is_off(world, monkeypatch, value):
    monkeypatch.setenv("ASSISTANT_TODAY_BRIEFING_ENABLED", value)
    assert world.brief().get_json()["enabled"] is False


def test_the_flag_is_read_per_request_not_cached(world, monkeypatch):
    assert world.brief().get_json()["enabled"] is False
    monkeypatch.setenv("ASSISTANT_TODAY_BRIEFING_ENABLED", "true")
    assert world.brief().get_json()["enabled"] is True
    monkeypatch.setenv("ASSISTANT_TODAY_BRIEFING_ENABLED", "off")
    assert world.brief().get_json()["enabled"] is False


# ── the label ping: no sentence, no model, fixed-label-only history ────────────────────────────────────────────────────
def test_the_ping_needs_no_text_and_is_not_refused(world):
    r = world.brief()
    assert r.status_code == 200 and r.get_json()["flow"] == "today_briefing" and r.get_json()["event"] == "opened"


def test_the_ping_stores_only_the_fixed_label(world, monkeypatch):
    monkeypatch.setenv("ASSISTANT_TODAY_BRIEFING_ENABLED", "true")       # recording happens only when the briefing is ON
    world.brief()
    rows = world.history_rows()
    user_rows = [r for r in rows if r.get("role") == "user"]
    assert any(r["text"] == "today_briefing_opened" and r["feature"] == "start" and r["intent"] == "open"
               for r in user_rows)
    blob = json.dumps(rows)
    assert SECRET_NAME not in blob


def test_off_ping_writes_no_history_or_conversation(world):
    # Flag OFF (default): the ping must change nothing — no row, no conversation. "Flag OFF = nothing changes."
    body = world.brief().get_json()
    assert body["enabled"] is False
    assert body["conversationId"] is None
    assert body["history"] == []
    # And nothing was persisted: no messages and no conversation in the Earlier list.
    assert world.history_rows() == []
    convos = world.client.get("/api/assistant/conversations",
                              headers={"X-Workspace-Id": str(world.workspace_id)}).get_json()["conversations"]
    assert convos == []


def test_a_ping_never_spends_the_model_budget(world):
    for _ in range(10):
        assert world.brief().status_code == 200
    assert world.calls == []


# ── the flow / event whitelist ─────────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("body, why", [
    ({"flow": "today_briefing", "event": "refresh"}, "unknown event"),
    ({"flow": "today_briefing", "event": "opened", "text": "what is my day for Sharma"}, "extra free text"),
    ({"flow": "today_briefing", "event": "opened", "note": "x" * 5000}, "oversized extra key"),
    ({"flow": "today_briefing", "event": 5}, "non-string event"),
    ({"flow": "wipe_everything", "event": "opened"}, "unknown flow still 400"),
])
def test_a_bad_ping_is_refused(world, body, why):
    r = world.post(body)
    assert r.status_code == 400, why
    assert r.get_json()["code"] == "BAD_FLOW"
    blob = json.dumps(world.history_rows())
    assert SECRET_NAME not in blob               # a name smuggled as "extra text" never lands in history


def test_a_ping_without_a_workspace_is_still_answered(world):
    r = world.client.post("/api/assistant/command", json={"flow": "today_briefing"})
    body = r.get_json()
    assert r.status_code == 200 and body["enabled"] is False and body["conversationId"] is None and body["history"] == []


# ── the new flow dispatch must not break the existing create-matter ping ───────────────────────────────────────────────
def test_create_matter_ping_still_works(world, monkeypatch):
    monkeypatch.setenv("ASSISTANT_CREATE_MATTER_ENABLED", "true")
    r = world.client.post("/api/assistant/command", json={"flow": "create_matter"},
                          headers={"X-Workspace-Id": str(world.workspace_id)})
    assert r.status_code == 200 and r.get_json()["flow"] == "create_matter" and r.get_json()["enabled"] is True
