"""
utils/ai_helper.py
LLM Gateway — routes through LiteLLM with automatic fallbacks.
Primary: groq/openai/gpt-oss-120b
Fallbacks: groq/llama-3.1-8b-instant → groq/gemma2-9b-it
Set GROQ_API_KEY in .env.
"""
import json
import re

import litellm
from litellm import completion

# Suppress excessive LiteLLM logging in the terminal
litellm.set_verbose = False


def ask_groq(system_prompt: str, user_msg: str) -> str:
    """
    LLM Gateway Router.
    Attempts the primary model first. If it hits a Token Limit or Rate Limit,
    it automatically routes to the fallbacks without crashing.
    """
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user",   "content": user_msg}
    ]

    try:
        response = completion(
            model="groq/openai/gpt-oss-120b",
            messages=messages,
            fallbacks=["groq/llama-3.1-8b-instant", "groq/gemma2-9b-it"],
            num_retries=2,
            drop_params=True
        )
        return response.choices[0].message.content
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
