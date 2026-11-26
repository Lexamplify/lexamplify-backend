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

    def complete(self, messages, temperature=0.2, max_tokens=2000, **extra):
        try:
            r = llm_client.completion(model=AGENT_MODEL, messages=messages,
                                      temperature=temperature, max_tokens=max_tokens,
                                      timeout=60, num_retries=1, **extra)
            try:
                self.total_tokens += int(r.usage.total_tokens or 0)
            except Exception:
                pass
            return r.choices[0].message.content or ""
        except llm_client.LLMError as e:
            raise ProviderError(str(e)) from e

    def complete_json(self, messages, temperature=0.1, max_tokens=3000):
        """Ask for JSON and parse it robustly.

        1) JSON mode (response_format=json_object) — makes the provider emit
           syntactically valid JSON, which removes the usual "missing comma /
           unescaped quote" failures from long free-form outputs.
        2) If the provider rejects JSON mode (e.g. the prompt doesn't contain
           the word 'json', or the model doesn't support it), fall back to a
           plain completion.
        3) On a parse error, one repair retry: hand the bad text back and ask
           for ONLY corrected, strictly-valid JSON.
        """
        # 1) JSON mode.
        try:
            text = self.complete(messages, temperature=temperature, max_tokens=max_tokens,
                                  response_format={"type": "json_object"})
            return parse_json_block(text)
        except ProviderError:
            pass  # json-mode unsupported or junk output — fall through

        # 2) Plain completion.
        text = self.complete(messages, temperature=temperature, max_tokens=max_tokens)
        try:
            return parse_json_block(text)
        except ProviderError as first_err:
            # 3) One repair retry.
            repair = list(messages) + [
                {"role": "assistant", "content": text[:6000]},
                {"role": "user", "content":
                    "Your previous reply was not valid JSON (" + str(first_err) + "). "
                    "Reply again with ONLY the corrected, strictly valid JSON object — "
                    "no prose, no markdown, no code fences."},
            ]
            text2 = self.complete(repair, temperature=0, max_tokens=max_tokens,
                                  response_format={"type": "json_object"})
            return parse_json_block(text2)


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
