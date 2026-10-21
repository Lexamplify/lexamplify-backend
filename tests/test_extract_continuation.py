"""A model answer that is cut off must not lose the facts.

Measured with the real model (the evaluation in docs/EVAL_REPORT.md): the extraction call asked for 1500
tokens, the reasoning model spent most of them thinking, the visible answer was 292 characters and it stopped
in the middle of the JSON (finish_reason "length"). The JSON did not parse, every extracted field was lost,
and the advocate's form came back empty - silently, with no error anywhere.

These tests drive the real chain (route -> ask_groq -> the continuation -> the parser) with a model that
behaves like that, and prove that the facts still arrive.
"""
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

SOURCE = (
    "Cheque No. 004817 dated 12 June 2026 for Rs. 4,75,000/- drawn on Canara Bank, Chennai Main Branch in favour "
    "of M/s Sundaram Agencies, No. 14, Cross Street, T. Nagar, Chennai - 600017. The cheque was presented on "
    "20 June 2026 and returned unpaid: Funds insufficient. The drawer is M/s Kumar Traders Pvt Ltd."
)
FACTS = {
    "sender_name": "M/s Sundaram Agencies",
    "drawer_name": "M/s Kumar Traders Pvt Ltd",
    "cheque_no": "004817",
}


class _Msg:
    def __init__(self, content):
        self.content = content
        self.role = "assistant"


class _Choice:
    def __init__(self, content, finish_reason):
        self.message = _Msg(content)
        self.finish_reason = finish_reason


class _Usage:
    prompt_tokens = 100
    completion_tokens = 100
    total_tokens = 200


class _Response:
    def __init__(self, content, finish_reason):
        self.choices = [_Choice(content, finish_reason)]
        self.usage = _Usage()
        self.model = "test"


@pytest.fixture()
def app(tmp_path, monkeypatch):
    from tests.helpers_app import make_app
    flask_app = make_app(tmp_path, monkeypatch, name="extract.db")
    # helpers_app blanks the provider keys on purpose (the tests must never spend real credits), so the key
    # is set again here: this test wants the model step to run, with a fake answer.
    monkeypatch.setenv("GROQ_API_KEY", "test-key-not-a-real-one")
    return flask_app


def _signed_in(flask_app):
    from tests.helpers_app import register
    return register(flask_app, "extract@example.com")


def test_a_cut_off_answer_is_continued_and_the_facts_still_arrive(app, monkeypatch):
    """The first answer stops in the middle of the JSON (finish_reason "length"); the second one finishes it."""
    import utils.ai_helper as ah

    full = ('{"fields": {"sender_name": {"value": "M/s Sundaram Agencies", "quote": "M/s Sundaram Agencies"}, '
            '"drawer_name": {"value": "M/s Kumar Traders Pvt Ltd", "quote": "M/s Kumar Traders Pvt Ltd"}, '
            '"cheque_no": {"value": "004817", "quote": "004817"}}}')
    cut = len(full) // 2
    calls = []

    def fake_completion(*args, **kwargs):
        calls.append(1)
        if len(calls) == 1:
            return _Response(full[:cut], "length")     # cut off in the middle
        return _Response(full[cut:], "stop")            # the continuation finishes it

    monkeypatch.setattr(ah, "completion", fake_completion)
    client = _signed_in(app)
    r = client.post("/api/drafts/extract", json={"type": "notice_138", "text": SOURCE, "use_model": True})
    assert r.status_code == 200, r.get_data(as_text=True)
    fields = r.get_json()["fields"]
    # the three facts only the model could give (the patterns read the cheque number and the dates)
    for slot in FACTS:
        assert slot in fields, f"the fact {slot} was lost: {sorted(fields)}"
        assert fields[slot]["value"] == FACTS[slot], fields[slot]
    assert len(calls) == 2, f"the answer was not continued ({len(calls)} model calls)"


def test_the_extraction_call_has_room_to_finish_a_reasoning_model(app, monkeypatch):
    """A reasoning model spends part of the allowance thinking. The call must have more than the bare minimum
    and a continuation, or the JSON is cut off and every field is lost."""
    import routes.draft_engine_routes as der
    import utils.ai_helper as ah

    seen = {}

    def fake_ask(system, user, **kwargs):
        seen.update(kwargs)
        return "{}"

    monkeypatch.setattr(ah, "ask_groq", fake_ask)
    client = _signed_in(app)
    r = client.post("/api/drafts/extract", json={"type": "notice_138", "text": SOURCE, "use_model": True})
    assert r.status_code == 200
    assert seen.get("max_tokens", 0) >= 3000, f"not enough room to answer: {seen}"
    assert seen.get("max_continuations", 0) >= 1, f"no continuation if the answer is cut: {seen}"


def test_a_model_answer_that_is_not_json_is_ignored_rather_than_guessed(app, monkeypatch):
    """A model that answers with something else must not put made-up facts into the form."""
    import utils.ai_helper as ah

    monkeypatch.setattr(ah, "ask_groq", lambda *a, **k: "I cannot help with that.")
    client = _signed_in(app)
    r = client.post("/api/drafts/extract", json={"type": "notice_138", "text": SOURCE, "use_model": True})
    assert r.status_code == 200
    fields = r.get_json()["fields"]
    # only what the deterministic patterns could read with certainty - nothing from the model's answer
    assert fields.get("cheque_no", {}).get("value") == "004817"
    assert "sender_name" not in fields
