"""
utils/ai_helper.py
LLM Gateway — routes through LiteLLM with automatic fallbacks.
Primary: groq/llama-3.3-70b-versatile
Fallbacks: groq/llama-3.1-8b-instant → groq/gemma2-9b-it
Set GROQ_API_KEY in .env.
"""
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
            model="groq/llama-3.3-70b-versatile",
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
