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
import re

import litellm
from litellm import completion

# Suppress excessive LiteLLM logging in the terminal
litellm.set_verbose = False

# qwen/qwen3.6-27b (unlike the gpt-oss family, which keeps reasoning in a
# separate hidden channel) inlines its chain-of-thought directly into
# `.content` as a <think>...</think> block — confirmed live. Only matters
# when this fallback actually fires, but a lawyer-facing draft leaking raw
# reasoning text is a real quality bug, not a hypothetical one.
_THINK_BLOCK_RE = re.compile(r'<think>.*?</think>', re.DOTALL | re.IGNORECASE)


def ask_groq(system_prompt: str, user_msg: str, max_continuations: int = 0, **kwargs) -> str:
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
    tokens-per-minute budget that covers prompt + max_tokens together —
    verified live (see auto_draft() in routes/document_routes.py). A single
    request with max_tokens=8192 blows that budget before generation even
    starts. Chaining several requests at the existing safe max_tokens
    ceiling reaches the same total output without ever exceeding the
    per-request budget.
    """
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user",   "content": user_msg}
    ]

    try:
        full_content = ''
        remaining = max_continuations
        while True:
            response = completion(
                model="groq/openai/gpt-oss-120b",
                messages=messages,
                fallbacks=["groq/openai/gpt-oss-20b", "groq/qwen/qwen3.6-27b"],
                num_retries=2,
                drop_params=True,
                **kwargs
            )
            choice = response.choices[0]
            piece = _THINK_BLOCK_RE.sub('', choice.message.content or '').strip()
            full_content += piece
            if choice.finish_reason != 'length' or remaining <= 0:
                break
            remaining -= 1
            # Feed the partial output back as assistant history so the
            # model resumes the same document instead of restarting it.
            messages.append({"role": "assistant", "content": choice.message.content or ''})
            messages.append({
                "role": "user",
                "content": "Continue exactly where you left off. Do not repeat any earlier "
                           "text, do not restart, and do not add a preamble — resume the "
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
