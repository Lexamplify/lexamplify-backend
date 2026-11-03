"""A backend file that is not on the frozen list below must not name an LLM / speech model.

New code reads model names through utils/model_config.py (settings with a safe fallback chain), so a retired or unavailable
model is fixed by changing one setting, not by editing code. The frozen list is the files that already name models today; it
may only shrink. If you move a file onto model_config, delete it from the list.
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
MODEL_RE = re.compile(r"(gpt-oss|llama-3|qwen|whisper|gemma|mixtral|gpt-4o|mistral|deepseek|allam-|orpheus|prompt-guard)", re.I)
SCAN_DIRS = ("routes", "utils", "services", "tasks", "models", "scripts")
ALLOWED_TODAY = {
    "utils/model_config.py",                                   # the one place that is meant to name them
    "rag_query.py", "routes/ai_routes.py", "routes/argument_routes.py", "routes/assistant_routes.py", "routes/calendar_routes.py",
    "routes/conflict_routes.py", "routes/contract_routes.py", "routes/document_routes.py", "routes/draft_engine_routes.py",
    "routes/stt_routes.py", "scripts/eval_drafts.py", "scripts/eval_inline_edit.py", "tasks/contract_tasks.py",
    "utils/ai_helper.py", "utils/llm_client.py", "utils/rag_pipeline.py",
}


def _backend_files():
    files = list(ROOT.glob("*.py"))
    for d in SCAN_DIRS:
        files += list((ROOT / d).rglob("*.py"))
    return files


def test_new_files_do_not_hard_code_model_names():
    offenders = sorted(
        f.relative_to(ROOT).as_posix() for f in _backend_files()
        if f.relative_to(ROOT).as_posix() not in ALLOWED_TODAY and MODEL_RE.search(f.read_text(encoding="utf-8", errors="ignore"))
    )
    assert not offenders, f"These files name a model directly; use utils/model_config.py instead: {offenders}"


def test_the_new_research_modules_are_clean():
    for name in ("utils/research_service.py", "utils/claim_check.py"):
        assert not MODEL_RE.search((ROOT / name).read_text(encoding="utf-8")), name


# The assistant must take every model name from utils/model_config.py — never a literal, on either side of the app.
ASSISTANT_FILES = (
    "utils/feature_registry.py",
    "frontend/src/assistant/features.json",
    "frontend/src/assistant/featureRegistry.js",
)


def test_the_assistant_files_name_no_model():
    for name in ASSISTANT_FILES:
        path = ROOT / name
        assert path.exists(), name
        assert not MODEL_RE.search(path.read_text(encoding="utf-8")), name


def test_the_assistant_files_do_not_reach_a_provider_directly():
    """1A is data and rules only: no HTTP call, no provider client, no API key."""
    for name in ASSISTANT_FILES:
        text = (ROOT / name).read_text(encoding="utf-8")
        for forbidden in ("api.groq.com", "GROQ_API_KEY", "OPENAI_API_KEY", "requests.post", "llm_client", "Groq("):
            assert forbidden not in text, (name, forbidden)


def test_the_frozen_list_only_names_files_that_still_exist_and_still_need_it():
    stale = sorted(n for n in ALLOWED_TODAY
                   if not (ROOT / n).exists() or not MODEL_RE.search((ROOT / n).read_text(encoding="utf-8", errors="ignore")))
    assert not stale, f"Remove these from ALLOWED_TODAY (they no longer name a model): {stale}"
