"""The small Groq client that replaced litellm (litellm alone took about 150 MB, and the free server has 512 MB in total)."""
import sys

import pytest

import utils.llm_client as lc


class FakeResponse:
    def __init__(self, status=200, body=None, text=""):
        self.status_code = status
        self._body = body
        self.text = text or (str(body) if body else "")

    def json(self):
        if self._body is None:
            raise ValueError("not json")
        return self._body


OK = {"model": "m", "choices": [{"message": {"role": "assistant", "content": "hello"}, "finish_reason": "stop"}], "usage": {"total_tokens": 321}}


@pytest.fixture(autouse=True)
def key(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-key")


def test_a_normal_answer_has_the_fields_the_callers_read(monkeypatch):
    sent = {}

    def post(url, json=None, headers=None, timeout=None):
        sent.update(url=url, json=json, headers=headers, timeout=timeout)
        return FakeResponse(200, OK)
    monkeypatch.setattr(lc.requests, "post", post)
    r = lc.completion(model="groq/openai/gpt-oss-120b", messages=[{"role": "user", "content": "hi"}], temperature=0.2, drop_params=True, num_retries=0, litellm_only="x")
    assert r.choices[0].message.content == "hello" and r.choices[0].finish_reason == "stop" and r.usage.total_tokens == 321
    assert sent["json"]["model"] == "openai/gpt-oss-120b" and sent["json"]["temperature"] == 0.2
    assert "drop_params" not in sent["json"] and "litellm_only" not in sent["json"]     # options Groq does not know are dropped
    assert sent["headers"]["Authorization"] == "Bearer test-key" and sent["timeout"][1] >= 5


def test_every_call_has_a_read_timeout(monkeypatch):
    seen = []
    monkeypatch.setattr(lc.requests, "post", lambda *a, **k: (seen.append(k["timeout"]), FakeResponse(200, OK))[1])
    lc.completion(messages=[], timeout=42)
    lc.completion(messages=[])
    assert seen[0][1] == 42 and seen[1][1] > 0


def test_a_timeout_becomes_our_timeout_and_is_not_retried(monkeypatch):
    calls = []

    def post(*a, **k):
        calls.append(1)
        raise lc.requests.exceptions.ReadTimeout("slow")
    monkeypatch.setattr(lc.requests, "post", post)
    with pytest.raises(lc.Timeout):
        lc.completion(messages=[], num_retries=3, fallbacks=[])
    assert len(calls) == 1


def test_a_rate_limit_keeps_the_providers_wait_time_in_its_message(monkeypatch):
    monkeypatch.setattr(lc.requests, "post", lambda *a, **k: FakeResponse(429, text='{"error":{"message":"Rate limit reached. Please try again in 32.4s"}}'))
    with pytest.raises(lc.RateLimitError) as e:
        lc.completion(messages=[], fallbacks=[])
    import utils.ai_helper as ah
    assert ah._is_rate_limit_error(e.value) and ah._retry_after_seconds(e.value, 5) == pytest.approx(33.4)


def test_the_next_model_is_tried_when_the_first_fails(monkeypatch):
    models = []

    def post(url, json=None, **k):
        models.append(json["model"])
        return FakeResponse(500, text="boom") if len(models) == 1 else FakeResponse(200, OK)
    monkeypatch.setattr(lc.requests, "post", post)
    r = lc.completion(model="groq/a/b", fallbacks=["groq/c/d"], messages=[])
    assert models == ["a/b", "c/d"] and r.choices[0].message.content == "hello"


def test_when_every_model_fails_the_first_reason_is_reported(monkeypatch):
    n = []
    monkeypatch.setattr(lc.requests, "post", lambda *a, **k: (n.append(1), FakeResponse(429, text="rate_limit_exceeded first") if len(n) == 1 else FakeResponse(400, text="bad"))[1])
    with pytest.raises(lc.RateLimitError):
        lc.completion(model="groq/a/b", fallbacks=["groq/c/d"], messages=[])


def test_a_server_error_is_retried_but_a_bad_request_is_not(monkeypatch):
    monkeypatch.setattr(lc.time, "sleep", lambda s: None)
    calls = []
    monkeypatch.setattr(lc.requests, "post", lambda *a, **k: (calls.append(1), FakeResponse(503, text="down"))[1])
    with pytest.raises(lc.LLMError):
        lc.completion(messages=[], num_retries=2, fallbacks=[])
    assert len(calls) == 3
    calls.clear()
    monkeypatch.setattr(lc.requests, "post", lambda *a, **k: (calls.append(1), FakeResponse(400, text="invalid"))[1])
    with pytest.raises(lc.LLMError):
        lc.completion(messages=[], num_retries=2, fallbacks=[])
    assert len(calls) == 1


def test_without_a_key_it_fails_plainly_before_any_network_call(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "")
    monkeypatch.setattr(lc.requests, "post", lambda *a, **k: pytest.fail("no call expected"))
    with pytest.raises(lc.LLMError):
        lc.completion(messages=[])


def test_an_unreadable_answer_is_an_error_not_a_crash(monkeypatch):
    monkeypatch.setattr(lc.requests, "post", lambda *a, **k: FakeResponse(200, None, text="<html>"))
    with pytest.raises(lc.LLMError):
        lc.completion(messages=[], fallbacks=[])


def test_the_secret_key_never_appears_in_an_error_message(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "gsk_SECRET_VALUE_123")
    monkeypatch.setattr(lc.requests, "post", lambda *a, **k: FakeResponse(401, text="invalid key"))
    with pytest.raises(lc.LLMError) as e:
        lc.completion(messages=[], fallbacks=[])
    assert "gsk_SECRET_VALUE_123" not in str(e.value)


def test_the_app_no_longer_loads_litellm_at_start(tmp_path):
    """The whole point: litellm is about 150 MB. Run in a clean process so other tests cannot have loaded it."""
    import subprocess
    import os
    # The child builds the app through tests/helpers_app.make_app (temp working folder and database, every data path redirected),
    # started with cwd=tmp_path so nothing is opened relative to the repo.
    code = ("import sys, pathlib, pytest;"
            "from tests.helpers_app import make_app;"
            "make_app(pathlib.Path(sys.argv[1]), pytest.MonkeyPatch());"
            "bad=[m for m in ('litellm','chromadb','sentence_transformers','torch','groq','tavily') if m in sys.modules];"
            "print('LOADED', bad)")
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = subprocess.run([sys.executable, "-c", code, str(tmp_path)], cwd=str(tmp_path), capture_output=True, text=True, timeout=180, env={**os.environ, "PYTHONPATH": root})
    assert "LOADED []" in out.stdout, out.stdout[-500:] + out.stderr[-800:]
