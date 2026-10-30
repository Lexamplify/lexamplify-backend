"""
utils/llm_client.py: a small, dependency-light client for Groq's chat API.

Why it exists: the `litellm` package we used before costs about 150 MB of memory just to be imported, and the free Render
plan stops the whole server at 512 MB ("Ran out of memory") while an analysis is running. Groq speaks the same JSON
protocol as OpenAI, so one plain HTTPS call (with the `requests` library the app already loads) does the job.

It keeps the parts of litellm the app relied on: model fallbacks, a per-call timeout, `num_retries` for transient errors,
unsupported parameters silently dropped, and a response object with `.choices[0].message.content`,
`.choices[0].finish_reason` and `.usage.total_tokens`. Errors carry the provider's own text, which the callers read to
find "Please try again in 32s" on a rate limit.
"""
import os
import time

import requests

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
OPENAI_URL = "https://api.openai.com/v1/chat/completions"

# OpenAI fallback mapping — when only OPENAI_API_KEY is set, re-route Groq model
# names to OpenAI-compatible ones so existing callers (ai_helper.ask_groq) keep
# working without any change. gpt-4o-mini is the stable, cheap default here.
_OPENAI_MODEL_MAP = {
    "groq/openai/gpt-oss-120b":  "gpt-4o-mini",
    "groq/openai/gpt-oss-20b":   "gpt-4o-mini",
    "groq/qwen/qwen3.6-27b":     "gpt-4o-mini",
}

# Parameters Groq's chat endpoint accepts. Anything else a caller passes (litellm-only options) is dropped.
_ALLOWED = {"temperature", "top_p", "max_tokens", "max_completion_tokens", "stop", "response_format", "reasoning_effort",
            "seed", "frequency_penalty", "presence_penalty", "n", "tools", "tool_choice", "user"}


class LLMError(Exception):
    def __init__(self, message, status=0):
        super().__init__(message)
        self.status = status


class RateLimitError(LLMError):
    """HTTP 429 / rate_limit_exceeded. The message contains the provider's own "try again in Ns"."""


class Timeout(LLMError):
    """No answer inside the time limit."""


class _Obj:
    def __init__(self, **kw):
        self.__dict__.update(kw)

    def __getitem__(self, key):
        return self.__dict__[key]

    def get(self, key, default=None):
        return self.__dict__.get(key, default)


def _wrap(data):
    choices = []
    for ch in data.get("choices") or []:
        msg = ch.get("message") or {}
        choices.append(_Obj(message=_Obj(content=msg.get("content") or "", role=msg.get("role", "assistant")),
                            finish_reason=ch.get("finish_reason")))
    usage = data.get("usage") or {}
    return _Obj(choices=choices, usage=_Obj(total_tokens=usage.get("total_tokens", 0), prompt_tokens=usage.get("prompt_tokens", 0),
                                            completion_tokens=usage.get("completion_tokens", 0)), model=data.get("model"))


def _model_name(model):
    m = str(model or "")
    return m.split("/", 1)[1] if m.startswith("groq/") else m


def _one_call(model, messages, timeout, params):
    # Prefer Groq when its key is present (free tier is faster for the models
    # the app was built around). Fall back to OpenAI when only OPENAI_API_KEY
    # is configured — same wire protocol, so one `requests.post` works for both.
    groq_key = os.getenv("GROQ_API_KEY", "")
    openai_key = os.getenv("OPENAI_API_KEY", "")
    if groq_key:
        url, api_key, resolved_model = GROQ_URL, groq_key, _model_name(model)
    elif openai_key:
        url, api_key = OPENAI_URL, openai_key
        base = _model_name(model)
        resolved_model = _OPENAI_MODEL_MAP.get(model) or _OPENAI_MODEL_MAP.get(base) or (base if base.startswith(("gpt-", "o1-", "o3-")) else "gpt-4o-mini")
    else:
        raise LLMError("No LLM provider configured — set GROQ_API_KEY or OPENAI_API_KEY in backend/.env.", status=401)

    body = {"model": resolved_model, "messages": messages}
    body.update({k: v for k, v in params.items() if k in _ALLOWED and v is not None})
    try:
        res = requests.post(url, json=body, headers={"Authorization": f"Bearer {api_key}"}, timeout=(8, max(5.0, float(timeout))))
    except requests.exceptions.Timeout as e:
        raise Timeout(f"request timed out after {timeout}s") from e
    except requests.exceptions.RequestException as e:
        raise LLMError(f"connection problem: {type(e).__name__}") from e
    if res.status_code == 200:
        try:
            return _wrap(res.json())
        except ValueError as e:
            raise LLMError("the AI service returned an unreadable answer", status=502) from e
    text = res.text[:600]
    if res.status_code == 429 or "rate_limit_exceeded" in text:
        raise RateLimitError(f"rate_limit_exceeded: {text}", status=429)
    raise LLMError(f"HTTP {res.status_code}: {text}", status=res.status_code)


def completion(model="groq/openai/gpt-oss-120b", messages=None, fallbacks=None, timeout=60, num_retries=0, **params):
    """Same call shape as litellm.completion for what this app uses. Tries `model`, then each fallback in turn."""
    messages = messages or []
    models = [model] + list(fallbacks or [])
    first = last = None
    for m in models:
        attempts = 1 + max(0, int(num_retries or 0))
        for attempt in range(attempts):
            try:
                return _one_call(m, messages, timeout, params)
            except RateLimitError as e:
                first, last = first or e, e
                break                                   # a refused model is not retried: the next model has its own allowance
            except Timeout as e:
                first, last = first or e, e
                break                                   # a stuck model is not retried either
            except LLMError as e:
                first, last = first or e, e
                if e.status and e.status < 500 and e.status != 408:
                    break                               # a bad request or a bad key will not get better by repeating it
                if attempt + 1 < attempts:
                    time.sleep(min(2.0 * (attempt + 1), 6.0))
    raise first or LLMError("no model to call")          # the first model's reason is the informative one
