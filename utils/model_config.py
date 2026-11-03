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


# Voice typing: turning one spoken sentence into a calendar entry (a small, fast job; the 20b model first).
STT_PARSE_PRIMARY_SETTING = "STT_PARSE_MODEL"
STT_PARSE_FALLBACKS_SETTING = "STT_PARSE_FALLBACKS"
STT_PARSE_DEFAULT_PRIMARY = "groq/openai/gpt-oss-20b"
STT_PARSE_DEFAULT_FALLBACKS = ["groq/openai/gpt-oss-120b"]


def stt_parse_models() -> tuple[str, list[str]]:
    return model_chain(STT_PARSE_PRIMARY_SETTING, STT_PARSE_FALLBACKS_SETTING, STT_PARSE_DEFAULT_PRIMARY, STT_PARSE_DEFAULT_FALLBACKS)

# The assistant's router: turn one command into a proposed action. A small, strict JSON job, so the 20b model leads.
ASSISTANT_PRIMARY_SETTING = "ASSISTANT_ROUTER_MODEL"
ASSISTANT_FALLBACKS_SETTING = "ASSISTANT_ROUTER_FALLBACKS"
ASSISTANT_DEFAULT_PRIMARY = "groq/openai/gpt-oss-20b"
ASSISTANT_DEFAULT_FALLBACKS = ["groq/openai/gpt-oss-120b"]

# Hindi / Tamil commands go to the larger model by default: it reads mixed Indic-English wording more reliably.
ASSISTANT_INDIC_PRIMARY_SETTING = "ASSISTANT_ROUTER_MODEL_INDIC"
ASSISTANT_INDIC_FALLBACKS_SETTING = "ASSISTANT_ROUTER_FALLBACKS_INDIC"
ASSISTANT_INDIC_DEFAULT_PRIMARY = "groq/openai/gpt-oss-120b"
ASSISTANT_INDIC_DEFAULT_FALLBACKS = ["groq/openai/gpt-oss-20b"]


def assistant_models(indic: bool = False) -> tuple[str, list[str]]:
    """(primary, fallbacks) for the assistant router. `indic` picks the Hindi/Tamil chain."""
    if indic:
        return model_chain(ASSISTANT_INDIC_PRIMARY_SETTING, ASSISTANT_INDIC_FALLBACKS_SETTING,
                           ASSISTANT_INDIC_DEFAULT_PRIMARY, ASSISTANT_INDIC_DEFAULT_FALLBACKS)
    return model_chain(ASSISTANT_PRIMARY_SETTING, ASSISTANT_FALLBACKS_SETTING,
                       ASSISTANT_DEFAULT_PRIMARY, ASSISTANT_DEFAULT_FALLBACKS)
