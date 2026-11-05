"""Phase 1a - the create-matter flag, the label ping, and the server guard.

The model is faked everywhere (the network guard in conftest stays on, so nothing can reach a provider). What these
prove: the flag is OFF by default and read per request; the label ping carries no sentence, calls no model, and stores
only the intent label; and the server guard keeps a create-matter sentence (which may carry client names) away from any
model, log line or history row - while leaving navigation and reads untouched.
"""
import json
import logging
import sqlite3
from types import SimpleNamespace

import pytest

from routes import assistant_command_routes as route_mod
from tests.helpers_app import make_app, register
from utils import assistant_router as router

pytestmark = pytest.mark.strict_network

CREATE_SENTENCE = "create a matter for Sharma vs Rao"
# The names that must never leak to a model, a log line or a history row.
SECRET_NAMES = ("Sharma", "Rao")


class Res:
    def __init__(self, content, total_tokens=120, model="openai/gpt-oss-20b"):
        self.choices = [SimpleNamespace(message=SimpleNamespace(content=content), finish_reason="stop")]
        self.usage = SimpleNamespace(total_tokens=total_tokens, prompt_tokens=100, completion_tokens=20)
        self.model = model


class World:
    """One signed-in advocate in their own workspace, with the router model faked."""

    def __init__(self, flask_app, client, workspace_id, calls, state):
        self.app, self.client, self.workspace_id, self.calls, self.state = flask_app, client, workspace_id, calls, state

    def ask(self, text, **body):
        return self.client.post("/api/assistant/command", json={"text": text, **body},
                                headers={"X-Workspace-Id": str(self.workspace_id)})

    def ping(self, **body):
        return self.client.post("/api/assistant/command", json={"flow": "create_matter", **body},
                                headers={"X-Workspace-Id": str(self.workspace_id)})

    def say(self, content):
        self.state["reply"] = content


def _make_world(tmp_path, monkeypatch, email="advocate@example.com"):
    flask_app = make_app(tmp_path, monkeypatch)
    client = register(flask_app, email)
    client.post("/api/practice/firm", json={"name": "Rao & Associates"})
    r = client.post("/api/workspaces", json={"name": "Sharma Industries", "client_name": "Sharma Industries"})
    assert r.status_code == 201, r.get_json()
    wid = client.get("/api/workspaces").get_json()["workspaces"][0]["id"]

    calls, state = [], {"reply": json.dumps({"feature": "calendar", "action": "open", "inputs": {}, "understood": "Open."})}

    def fake_completion(**kw):
        calls.append(kw)
        reply = state["reply"]
        if isinstance(reply, Exception):
            raise reply
        return Res(reply) if isinstance(reply, str) else reply
    monkeypatch.setattr("utils.llm_client.completion", fake_completion)
    route_mod.reset_model_call_counter()
    return World(flask_app, client, wid, calls, state)


@pytest.fixture
def world(tmp_path, monkeypatch):
    # The flag is unset unless a test sets it, so the default-OFF behaviour is what most tests see.
    monkeypatch.delenv("ASSISTANT_CREATE_MATTER_ENABLED", raising=False)
    return _make_world(tmp_path, monkeypatch)


def _history_texts(world):
    body = world.ping().get_json()
    return " ".join((h.get("text") or "") + " " + (h.get("understood") or "") for h in body.get("history", []))


# ── the flag, read per request, default OFF ────────────────────────────────────────────────────────────────────────────
def test_the_flag_is_off_by_default(world):
    body = world.ping().get_json()
    assert body["flow"] == "create_matter" and body["enabled"] is False
    assert world.calls == []                                            # a ping never calls a model


@pytest.mark.parametrize("value", ["true", "1", "yes", "on", "TRUE", "On", "Yes", "  true  "])
def test_truthy_values_turn_it_on(world, monkeypatch, value):
    monkeypatch.setenv("ASSISTANT_CREATE_MATTER_ENABLED", value)
    assert world.ping().get_json()["enabled"] is True


@pytest.mark.parametrize("value", ["false", "0", "no", "off", "False", "OFF", "No", "Off", "", "   ", "maybe", "2"])
def test_everything_else_is_off(world, monkeypatch, value):
    monkeypatch.setenv("ASSISTANT_CREATE_MATTER_ENABLED", value)
    assert world.ping().get_json()["enabled"] is False


def test_the_flag_is_read_per_request_not_cached(world, monkeypatch):
    assert world.ping().get_json()["enabled"] is False
    monkeypatch.setenv("ASSISTANT_CREATE_MATTER_ENABLED", "true")
    assert world.ping().get_json()["enabled"] is True
    monkeypatch.setenv("ASSISTANT_CREATE_MATTER_ENABLED", "off")
    assert world.ping().get_json()["enabled"] is False


# ── the label ping: no sentence, no model, intent-only history ─────────────────────────────────────────────────────────
def test_the_ping_needs_no_text_and_is_not_refused(world):
    r = world.ping()
    assert r.status_code == 200 and r.get_json()["flow"] == "create_matter"


def test_the_ping_stores_only_the_intent_label(world):
    # Phase 1c formalised the stored labels to create_matter_started/confirmed/cancelled (was "Create a matter" in 1a).
    world.ping()
    texts = _history_texts(world)
    assert "create_matter_started" in texts
    for name in SECRET_NAMES:
        assert name not in texts


# ── the label-route event whitelist (Phase 1c) ────────────────────────────────────────────────────────────────────────
def test_confirm_and_cancelled_events_are_accepted(world, monkeypatch):
    monkeypatch.setenv("ASSISTANT_CREATE_MATTER_ENABLED", "true")
    assert world.ping(event="confirm").get_json()["enabled"] is True        # confirm still reports the flag
    assert world.ping(event="cancelled").status_code == 200
    texts = _history_texts(world)
    assert "create_matter_confirmed" in texts and "create_matter_cancelled" in texts
    for name in SECRET_NAMES:
        assert name not in texts


def test_a_confirm_event_is_blocked_when_the_flag_is_off(world):
    assert world.ping(event="confirm").get_json()["enabled"] is False       # default OFF


@pytest.mark.parametrize("body, why", [
    ({"flow": "create_matter", "event": "delete_all"}, "unknown event"),
    ({"flow": "wipe_everything", "event": "started"}, "unknown flow"),
    ({"flow": "create_matter", "event": "started", "text": "create a matter for Sharma vs Rao"}, "extra free text"),
    ({"flow": "create_matter", "event": "started", "note": "x" * 5000}, "oversized extra key"),
    ({"flow": "create_matter", "event": 5}, "non-string event"),
])
def test_a_bad_label_ping_is_refused(world, body, why):
    r = world.client.post("/api/assistant/command", json=body, headers={"X-Workspace-Id": str(world.workspace_id)})
    assert r.status_code == 400, why
    assert r.get_json()["code"] == "BAD_FLOW"
    # the refused body is never stored, so a name slipped in as "extra text" never lands in history
    texts = _history_texts(world)
    for name in SECRET_NAMES:
        assert name not in texts


def test_pings_do_not_spend_the_model_budget(world):
    # Ten pings, then a model-backed command still works: the 6-a-minute MODEL budget was never touched by a ping.
    for _ in range(10):
        assert world.ping().status_code == 200
    world.say(json.dumps({"feature": "matters", "action": "search", "inputs": {}}))
    assert world.ask("find the Sharma matter please").status_code == 200


def test_a_ping_without_a_workspace_is_still_answered(world):
    r = world.client.post("/api/assistant/command", json={"flow": "create_matter"})
    assert r.status_code == 200 and r.get_json()["enabled"] is False and r.get_json()["conversationId"] is None


# ── the server guard: a create-matter sentence never reaches a model, a log, or a history row ──────────────────────────
def test_a_create_matter_sentence_is_never_sent_to_a_model(world, caplog):
    with caplog.at_level(logging.INFO):
        body = world.ask(CREATE_SENTENCE).get_json()
    assert body["intent"] == "clarify" and body["createMatterPrompt"] is True
    assert body["question"] == "Do you want to create a matter?"
    assert body["feature"] is None and body["requires_confirm"] is False
    assert world.calls == [], "the name-bearing sentence must never reach a model"
    logged = " ".join(caplog.messages)
    for name in SECRET_NAMES:
        assert name not in logged and name not in json.dumps(body)


def test_the_guard_stores_only_the_label_never_the_sentence(world):
    world.ask(CREATE_SENTENCE)
    texts = _history_texts(world)
    assert "Create a matter" in texts
    for name in SECRET_NAMES:
        assert name not in texts


def test_the_guard_also_covers_the_today_handover_wording(world):
    # The Today bar hands the same sentence to Assistant.jsx, which auto-sends it. Whatever reaches the route is guarded.
    body = world.ask("open a new matter for Mehta vs State").get_json()
    assert body["createMatterPrompt"] is True and world.calls == []


# ── the detector itself: narrow on purpose (unit, no app) ──────────────────────────────────────────────────────────────
@pytest.mark.parametrize("text", [
    "create a matter", "create a matter for Sharma vs Rao", "make a new case", "start a matter",
    "open a new matter", "add a case", "new matter", "register a case", "set up a matter",
    "I want to create a new brief", "naya mukadma banao", "mukadma darj karna hai",
    "नया मुकदमा बनाओ", "புதிய வழக்கு உருவாக்கு",
])
def test_the_detector_catches_create_wording(text):
    assert router.looks_like_create_matter(text) is True


@pytest.mark.parametrize("text", [
    "open matters", "show my cases", "find the Sharma matter", "search my matters", "go to matters",
    "add a hearing next Tuesday", "delete the rent agreement", "open calendar", "my cases", "show dashboard",
    "which judge sits in the high court on friday", "", "   ",
])
def test_the_detector_ignores_navigation_and_reads(text):
    assert router.looks_like_create_matter(text) is False


# ── the existing route behaviour a plain command still gets (a non-create command is untouched by the guard) ───────────
def test_a_plain_navigation_command_still_routes_normally(world):
    body = world.ask("open calendar").get_json()
    assert body["feature"] == "calendar" and body["intent"] == "navigate"
    assert "createMatterPrompt" not in body
