"""
utils/ai_helper.py
LLM Gateway — routes through LiteLLM with automatic fallbacks.
Primary: groq/openai/gpt-oss-120b
Fallbacks: groq/openai/gpt-oss-20b → groq/qwen/qwen3.6-27b
Set GROQ_API_KEY in .env.

Fallback chain verified live against this account's actual model catalog
(GET https://api.groq.com/openai/v1/models) — the previous fallbacks,
groq/llama-3.1-8b-instant and groq/gemma2-9b-it, both 404/400 on this
account (not found / decommissioned) and were silently making every
fallback attempt fail closed, with only the primary model's own failure
ever actually surfacing.
"""
import json
import os
import re
import threading
import time
from collections import deque

from utils.llm_client import completion, RateLimitError, Timeout as LLMTimeout

# Suppress excessive LiteLLM logging in the terminal

# qwen/qwen3.6-27b (unlike the gpt-oss family, which keeps reasoning in a
# separate hidden channel) inlines its chain-of-thought directly into
# `.content` as a <think>...</think> block — confirmed live. Only matters
# when this fallback actually fires, but a lawyer-facing draft leaking raw
# reasoning text is a real quality bug, not a hypothetical one.
_THINK_BLOCK_RE = re.compile(r'<think>.*?</think>', re.DOTALL | re.IGNORECASE)

# This Groq account's on_demand tier caps tokens-per-minute (TPM) at 8000 —
# verified live via the actual API error: "Request too large ... on tokens
# per minute (TPM): Limit 8000, Requested 8859". TPM is an ACCOUNT-WIDE
# ROLLING window, not a per-request ceiling: sizing a single call's own
# prompt+max_tokens under 8000 (the headroom calc below) is necessary but
# NOT sufficient, because a multi-call continuation sequence fires several
# large calls within seconds of each other, and their usage stacks up
# against the SAME rolling window — reproduced live, where identical
# requests alternately succeeded or hit this exact 400 purely depending on
# how much of the window recent calls had already used. The headroom calc
# below sizes each individual call correctly; _call_with_rate_limit_retry
# below handles the OTHER half — backing off and retrying when the account
# hits the rolling ceiling regardless of this call's own size.
_GROQ_TPM_BUDGET = 8000
_GROQ_TPM_SAFETY_MARGIN = 400  # headroom for the char/4 estimate below being approximate
_MIN_COMPLETION_TOKENS = 512
_RATE_LIMIT_RETRY_DELAYS = (12, 20)  # seconds — enough for a per-minute window to partly recover
# No real tokenizer for Groq's model mix is wired in here — 4 chars/token
# is the standard rough English estimate, good enough to stay safely under
# the hard 8000 ceiling with the margin above, not to bill precisely.
_CHARS_PER_TOKEN_ESTIMATE = 4
# Fed back into the next continuation call instead of the full accumulated
# assistant text — otherwise a long partial draft alone would eventually
# consume the entire TPM budget on its own, leaving ~0 headroom for the
# actual continuation and making every later round fail the same way a
# too-large reference context does. The model only needs to see enough of
# its own tail to know where it left off, not the whole document again.
_CONTINUATION_TAIL_CHARS = 2000


def _estimate_tokens(messages) -> int:
    total_chars = sum(len(m.get('content') or '') for m in messages)
    return total_chars // _CHARS_PER_TOKEN_ESTIMATE


_RETRY_AFTER_RE = re.compile(r'try again in ([\d.]+)s', re.IGNORECASE)


def _is_rate_limit_error(exc) -> bool:
    if isinstance(exc, RateLimitError):
        return True
    # litellm's completion_with_fallbacks() (used whenever `fallbacks=` is
    # passed) re-raises every attempt's failure wrapped in a plain
    # Exception once all fallbacks are exhausted, losing the original
    # RateLimitError type — confirmed live in the actual traceback. The
    # message text itself still carries Groq's own error shape, so that's
    # the only reliable signal left to detect this specific, recoverable
    # case instead of treating it the same as a genuine failure.
    return 'rate_limit_exceeded' in str(exc) or 'RateLimitError' in str(exc)


def _retry_after_seconds(exc, default: float) -> float:
    # Groq's own error body names the exact wait, e.g. "Please try again in
    # 32.43s" — using that beats guessing: a fixed delay verified live at
    # 12s+20s (32s total) still weekly undershot an actual 32.43s ask on one
    # occasion, since Groq's true remaining window time varies with
    # whatever else the account has sent recently, not a fixed constant.
    match = _RETRY_AFTER_RE.search(str(exc))
    if match:
        return float(match.group(1)) + 1  # small buffer past the exact boundary
    return default


class _TokenPacer:
    """Keeps this server's calls inside the provider's per-minute token allowance, which every user and every screen shares.
    Firing calls and waiting for "rate limit" errors wastes the allowance on refused requests and then sleeps; asking first
    for room in the last minute's budget is faster overall. Reservations are corrected to the real usage after the call."""

    def __init__(self):
        self._events = deque()      # [time, tokens]
        self._lock = threading.Lock()

    def _budget(self):
        return float(os.getenv("LLM_TPM_BUDGET", _GROQ_TPM_BUDGET)) * 0.9

    def _window(self):
        return float(os.getenv("LLM_TPM_WINDOW_SECONDS", "60"))

    def acquire(self, tokens, deadline=None):
        while True:
            with self._lock:
                now = time.time()
                window = self._window()
                while self._events and now - self._events[0][0] >= window:
                    self._events.popleft()
                used = sum(e[1] for e in self._events)
                if not self._events or used + tokens <= self._budget():      # an oversized request may run alone
                    event = [now, tokens]
                    self._events.append(event)
                    return event
                wait = self._events[0][0] + window - now + 0.05
            if deadline is not None and time.time() + wait >= deadline:
                raise AITimeout("AI_TIMEOUT: the shared AI allowance is used up and there is no time left to wait for it")
            time.sleep(min(max(wait, 0.05), 2.0))

    @staticmethod
    def settle(event, actual_tokens):
        if event is not None and actual_tokens:
            event[1] = actual_tokens


_PACER = _TokenPacer()


class AITimeout(Exception):
    """The AI provider did not answer inside the time we allow. Raised instead of waiting for minutes."""


# litellm waits 10 minutes per attempt by default, and the fallback chain tries three models in turn: one stuck
# request could keep a screen spinning for 30 minutes. Every call now has a ceiling.
DEFAULT_TIMEOUT_SECONDS = float(os.getenv("LLM_TIMEOUT_SECONDS", "75"))


def _call_with_rate_limit_retry(deadline=None, **call_kwargs):
    """Retries a completion() call, with a real sleep, specifically when
    Groq's rolling TPM window is exhausted — see _GROQ_TPM_BUDGET's comment
    for why this is a separate problem from sizing a single call's own
    max_tokens. litellm's own num_retries retries too fast to let a
    per-minute window recover, which is why this account still hit the
    exact same rate-limit error after "LiteLLM Retried: 2 times" — verified
    live. num_retries=0 here since this loop is the retry strategy now.

    `deadline` (epoch seconds) is the point after which the caller no longer wants an answer: no new attempt starts,
    no rate-limit sleep runs past it, and each attempt's own timeout is cut to the time that is left."""
    last_err = None
    for attempt, default_delay in enumerate((0,) + _RATE_LIMIT_RETRY_DELAYS):
        if attempt > 0:
            wait = _retry_after_seconds(last_err, default_delay)
            if deadline is not None and time.time() + wait >= deadline:
                raise AITimeout("AI_TIMEOUT: the provider is rate-limiting and there is no time left to wait")
            time.sleep(wait)
        kwargs = dict(call_kwargs)
        if deadline is not None:
            remaining = deadline - time.time()
            if remaining < 5:
                raise AITimeout("AI_TIMEOUT: out of time before the call started")
            kwargs["timeout"] = max(5.0, min(float(kwargs.get("timeout") or DEFAULT_TIMEOUT_SECONDS), remaining / 2))
        else:
            kwargs.setdefault("timeout", DEFAULT_TIMEOUT_SECONDS)
        reserve = int(kwargs.pop("_reserve_tokens", 0) or 0) if "_reserve_tokens" in kwargs else 0
        event = _PACER.acquire(reserve, deadline) if reserve else None
        try:
            response = completion(num_retries=0, **kwargs)
            try:
                _PACER.settle(event, int(getattr(getattr(response, "usage", None), "total_tokens", 0) or 0))
            except Exception:  # noqa: BLE001 - usage is optional
                pass
            return response
        except Exception as e:
            last_err = e
            if _is_timeout_error(e):
                raise AITimeout(f"AI_TIMEOUT: {type(e).__name__}") from e
            if not _is_rate_limit_error(e):
                raise
    raise last_err


def _is_timeout_error(exc) -> bool:
    if isinstance(exc, (TimeoutError, LLMTimeout)):
        return True
    text = f"{type(exc).__name__} {exc}".lower()
    return "timeout" in text or "timed out" in text


def ask_groq(system_prompt: str, user_msg: str, max_continuations: int = 0, deadline=None, **kwargs) -> str:
    """
    LLM Gateway Router.
    Attempts the primary model first. If it hits a Token Limit or Rate Limit,
    it automatically routes to the fallbacks without crashing.

    max_continuations: off by default. When > 0, a response that stops
    because it hit max_tokens (finish_reason == "length") is automatically
    resumed with up to this many follow-up completions, each picking up
    exactly where the last one left off, and the pieces are concatenated.
    This exists instead of just raising max_tokens because this account's
    Groq on_demand tier caps groq/openai/gpt-oss-120b at an 8000
    tokens-per-minute budget that covers prompt + max_tokens together.
    A single request with max_tokens=8192 blows that budget before
    generation even starts. Chaining several requests at a SAFE, DYNAMIC
    max_tokens ceiling (see below) reaches the same total output without
    ever exceeding the per-request budget.
    """
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user",   "content": user_msg}
    ]

    try:
        full_content = ''
        remaining = max_continuations
        while True:
            call_kwargs = dict(kwargs)
            requested_max_tokens = call_kwargs.get('max_tokens')
            if requested_max_tokens:
                headroom = _GROQ_TPM_BUDGET - _GROQ_TPM_SAFETY_MARGIN - _estimate_tokens(messages)
                # Always request SOME completion room rather than refusing
                # outright — a too-small remaining budget still produces a
                # partial sentence, which the caller can treat as
                # finish_reason=="length" and either continue or accept.
                call_kwargs['max_tokens'] = max(_MIN_COMPLETION_TOKENS, min(requested_max_tokens, headroom))

            response = _call_with_rate_limit_retry(
                deadline=deadline,
                _reserve_tokens=_estimate_tokens(messages) + int(call_kwargs.get('max_tokens') or 1500),
                model="groq/openai/gpt-oss-120b",
                messages=messages,
                fallbacks=["groq/openai/gpt-oss-20b", "groq/qwen/qwen3.6-27b"],
                drop_params=True,
                **call_kwargs
            )
            choice = response.choices[0]
            piece = _THINK_BLOCK_RE.sub('', choice.message.content or '').strip()
            full_content += piece
            if choice.finish_reason != 'length' or remaining <= 0:
                break
            remaining -= 1
            # Feed back only the tail of what was just generated — enough
            # for the model to pick up the thread, not the whole
            # accumulated document (see _CONTINUATION_TAIL_CHARS above).
            tail = (choice.message.content or '')[-_CONTINUATION_TAIL_CHARS:]
            messages.append({"role": "assistant", "content": tail})
            messages.append({
                "role": "user",
                "content": "Continue exactly where the text above leaves off. Do not repeat "
                           "any of it, do not restart, and do not add a preamble — resume the "
                           "document from the next character.",
            })
        return full_content
    except Exception as e:
        print(f"LLM Gateway Exhausted all fallbacks. Error: {str(e)}")
        raise e


# All callers (ask_gemini, ask_litellm) transparently route through the gateway
ask_gemini  = ask_groq
ask_litellm = ask_groq


def extract_json_from_llm_response(raw_text):
    """
    Resiliently extracts a JSON object/array out of a raw LLM text response.

    LLMs routinely wrap JSON in ```json fences, or add stray prose before/
    after the actual object even when explicitly told not to — a bare
    json.loads() on the raw string is one adversarial completion away from
    an uncaught JSONDecodeError reaching the route handler. This tries, in
    order: (1) strip a markdown code fence and parse directly, (2) if that
    fails, regex out the outermost {...} or [...] block and parse that.

    Returns the parsed dict/list, or None if no valid JSON could be
    recovered by either strategy. Callers MUST check for None explicitly —
    this never raises, and never silently substitutes a fake empty result.
    """
    if not raw_text or not isinstance(raw_text, str):
        return None

    cleaned = re.sub(r'^```(?:json)?\s*|\s*```$', '', raw_text.strip(), flags=re.MULTILINE).strip()

    try:
        return json.loads(cleaned)
    except (json.JSONDecodeError, ValueError):
        pass

    match = re.search(r'(\{.*\}|\[.*\])', cleaned, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except (json.JSONDecodeError, ValueError):
            pass

    return None
