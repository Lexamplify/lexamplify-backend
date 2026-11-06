"""Model names from settings, with a safe fallback chain.

A model name is read from an environment setting (the NAME of the setting is what you configure; its value is never logged).
If the setting is empty, the built-in default is used. Defaults are models the Groq account is known to offer.
"""
from __future__ import annotations

import os


def _split(raw: str) -> list[str]:
    return [m.strip() for m in raw.split(",") if m.strip()]


def model_chain(primary_setting: str, fallbacks_setting: str, default_primary: str, default_fallbacks: list[str]) -> tuple[str, list[str]]:
    """(primary, fallbacks) with empty settings replaced by the defaults and duplicates removed.
    The fallbacks setting is a comma-separated list; set it to a single "-" to turn fallbacks off."""
    primary = (os.getenv(primary_setting) or "").strip() or default_primary
    raw = (os.getenv(fallbacks_setting) or "").strip()
    if raw == "-":
        fallbacks: list[str] = []
    else:
        fallbacks = _split(raw) if raw else list(default_fallbacks)
    chain: list[str] = []
    for m in [primary] + fallbacks:
        if m not in chain:
            chain.append(m)
    return chain[0], chain[1:]


# Research answer model. Defaults are on the account's list (gpt-oss-120b, then gpt-oss-20b).
RESEARCH_PRIMARY_SETTING = "RESEARCH_ANSWER_MODEL"
RESEARCH_FALLBACKS_SETTING = "RESEARCH_ANSWER_FALLBACKS"
RESEARCH_DEFAULT_PRIMARY = "groq/openai/gpt-oss-120b"
RESEARCH_DEFAULT_FALLBACKS = ["groq/openai/gpt-oss-20b"]


def research_models() -> tuple[str, list[str]]:
    return model_chain(RESEARCH_PRIMARY_SETTING, RESEARCH_FALLBACKS_SETTING, RESEARCH_DEFAULT_PRIMARY, RESEARCH_DEFAULT_FALLBACKS)
