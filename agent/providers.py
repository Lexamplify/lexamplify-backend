"""Model-provider abstraction for the agent.

The engine never imports an SDK directly: it talks to a Provider with one
method, so OpenAI/Groq (today, via utils.llm_client) can be swapped for a
local model later without touching the planner or recovery code.
"""
import json
import re

from utils import llm_client

AGENT_MODEL = "groq/openai/gpt-oss-120b"  # llm_client maps to gpt-4o-mini on OpenAI-only setups


class ProviderError(Exception):
    pass


class LLMProvider:
    """Default provider: utils.llm_client.completion (Groq-first, OpenAI fallback)."""

    def __init__(self):
        self.total_tokens = 0            # cost visibility: engine snapshots this per task

    def complete(self, messages, temperature=0.2, max_tokens=2000):
        try:
            r = llm_client.completion(model=AGENT_MODEL, messages=messages,
                                      temperature=temperature, max_tokens=max_tokens,
                                      timeout=60, num_retries=1)
            try:
                self.total_tokens += int(r.usage.total_tokens or 0)
            except Exception:
                pass
            return r.choices[0].message.content or ""
        except llm_client.LLMError as e:
            raise ProviderError(str(e)) from e

    def complete_json(self, messages, temperature=0.1, max_tokens=2000):
        """Ask for JSON and parse it, tolerating code fences."""
        text = self.complete(messages, temperature=temperature, max_tokens=max_tokens)
        return parse_json_block(text)


def parse_json_block(text):
    t = (text or "").strip()
    m = re.search(r"```(?:json)?\s*(.*?)```", t, re.S)
    if m:
        t = m.group(1).strip()
    start = t.find("{")
    end = t.rfind("}")
    if start == -1 or end == -1:
        raise ProviderError("model returned no JSON object")
    try:
        return json.loads(t[start:end + 1])
    except ValueError as e:
        raise ProviderError(f"model returned invalid JSON: {e}") from e


_provider = None


def get_provider():
    global _provider
    if _provider is None:
        _provider = LLMProvider()
    return _provider


def set_provider(p):
    """Tests inject a fake provider here."""
    global _provider
    _provider = p
