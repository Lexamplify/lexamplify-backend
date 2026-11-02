# Model names that still need fixing (suggestions only — NOT applied)

Every model name below belongs to a module owned by someone else, so nothing here has been changed. Each row is a suggested
edit with the reason and what to test. Line numbers are from commit `4f9fc71`.

## The account's model list

The Groq key in use can call only these (names as the API gives them):

```
allam-2-7b, canopylabs/orpheus-arabic-saudi, canopylabs/orpheus-v1-english,
meta-llama/llama-prompt-guard-2-22m, meta-llama/llama-prompt-guard-2-86m,
openai/gpt-oss-120b, openai/gpt-oss-20b, openai/gpt-oss-safeguard-20b,
qwen/qwen3.8-27b, whisper-large-v3, whisper-large-v3-turbo
```

**No llama chat model and no `qwen3.6` are on it.** A call to one fails with HTTP 404 `model_not_found`. The production key may
offer a different set, so every name should come from a setting (`utils/model_config.py`), never from a literal in the code.

## Two call styles — the prefix differs

* `utils/llm_client.py` → `completion(model="groq/openai/gpt-oss-120b", ...)` — **keeps** the `groq/` prefix (it is stripped at
  `utils/llm_client.py:71-73`).
* the Groq SDK directly → `client.chat.completions.create(model="openai/gpt-oss-120b", ...)` — **no** `groq/` prefix.

Most rows below are the second style. Check which one the file uses before pasting a name in.

## The edits

| # | File:line | Now | Suggested | Why |
|---|---|---|---|---|
| 1 | `routes/ai_routes.py:748` | `llama-3.1-8b-instant` | `openai/gpt-oss-20b` | `/api/summarize-judgment`. A summary is a plain, cheap job; the 20b model is the smallest on the list. |
| 2 | `routes/assistant_routes.py:641` | `llama-3.1-8b-instant` | `openai/gpt-oss-120b` | `/api/chat`, the main call, with `tools=`. Tool choice is the hardest part of this route, so the larger model. |
| 3 | `routes/assistant_routes.py:695` | `llama-3.1-8b-instant` | `openai/gpt-oss-120b` | The retry of the same call; keep it identical to row 2. |
| 4 | `routes/assistant_routes.py:947` | `llama-3.1-8b-instant` | `openai/gpt-oss-20b` | A second, smaller pass in the same route. |
| 5 | `utils/rag_pipeline.py:415` | `llama-3.1-8b-instant` | `openai/gpt-oss-20b` | Suggested follow-up actions after a chat answer. **Also raise `max_tokens=280` (line 418)** — see "Reasoning tokens" below. |
| 6 | `utils/rag_pipeline.py:724` | `llama-3.1-8b-instant` | `openai/gpt-oss-120b` | `detect_tool_action()`, with `tools=`; wrong tool choice sends the lawyer to the wrong screen. |
| 7 | `utils/rag_pipeline.py:931` | `llama-3.1-8b-instant` | `openai/gpt-oss-20b` | The intent router, with `response_format={"type": "json_object"}`. Small and fast is right here. |
| 8 | `utils/ai_helper.py:247` | `groq/qwen/qwen3.6-27b` (3rd fallback) | `groq/qwen/qwen3.8-27b` | Contract Analyzer. Almost certainly a typo for the model that exists: `3.6` is not on the list, `3.8` is. Note `utils/ai_helper.py:26-31` already strips this family's `<think>` block, so the rename needs no other change. |
| 9 | `utils/llm_client.py:27` | `"groq/qwen/qwen3.6-27b"` key | `"groq/qwen/qwen3.8-27b"` | The OpenAI-only translation map; keep the key in step with row 8 or the OpenAI path loses its mapping. |
| 10 | `rag_query.py:54` | `llama-3.1-8b-instant` | `openai/gpt-oss-20b` | A standalone script, not part of the running app. Lowest priority. |
| 11 | `utils/rag_pipeline.py:43-46` | `llama-3.3-70b-versatile`, `llama-3.1-70b-versatile`, `llama-3.1-8b-instant`, `mixtral-8x7b-32768` | leave, or prune | Keys in the OpenAI-only translation map, not calls. Harmless; they only matter when `OPENAI_API_KEY` is set and `GROQ_API_KEY` is not. |

Rows 1-10 are one-line changes. The better fix for 1-7 is to add a setting pair per module to `utils/model_config.py`
(`model_chain(...)`, as `research_models()` and `stt_parse_models()` do) so the next retirement is a settings change, not a
code change. `tests/test_no_hardcoded_models.py` holds a frozen list of the files that still name models; remove a file from
`ALLOWED_TODAY` once it reads its names from `model_config`.

## Reasoning tokens (gpt-oss only)

The gpt-oss models think before they answer, and those tokens come out of the same budget as the answer. A small `max_tokens`
can therefore be spent entirely on reasoning and return **empty content** with no error. This is exactly what
`routes/stt_routes.py` hit; it was fixed there by raising the budget to 1500 and treating an empty reply as a reason to try the
next model (`routes/stt_routes.py:98-101`, `PARSE_MAX_TOKENS`).

* **Row 5 (`max_tokens=280`) is the one real danger here.** Raise it to at least 1000, or the suggestion chips may come back blank.
* Groq's docs list `reasoning_effort` as `low`, `medium`, `high`, supported by gpt-oss-20b and gpt-oss-120b only. `low` is
  right for routers and short jobs. Sending it to a model that does not take it is an HTTP 400, so any caller that sets it
  needs a plain retry without it (as `_ask_for_event()` does).
* Groq's docs do not state whether reasoning tokens count against `max_completion_tokens`, so treat an empty `content` as a
  normal outcome rather than an error, whatever the budget.

## JSON mode and tools

* `response_format={"type": "json_object"}` is documented as available on all models, gpt-oss included (row 7 already uses it).
* `response_format={"type": "json_schema"}` (strict structured output) is documented for gpt-oss-20b / 120b and qwen3.8-27b,
  **but not together with tool use or streaming**. Rows 2, 3 and 6 pass `tools=`, so they must stay on `json_object` or on no
  `response_format` at all.
* Always read a model's reply defensively: find the first `{...}` even when the model wraps it in prose or a code fence.

## What to test after applying any row

1. `.\.venv\Scripts\python.exe -m pytest tests -q --ignore=tests/e2e` and compare the failures with the known set — at
   `4f9fc71` that is 66 failed / 10 errors, none of them new.
2. The screen each row serves, by hand, signed in: row 1 → summarize a judgment; rows 2-4, 6, 7 → `/api/chat` with a question,
   a draft request and a document request, checking the right tool is chosen; row 5 → the follow-up chips appear and are not
   blank; rows 8-9 → run a contract analysis and force the fallback.
3. Watch the backend log for `model_not_found` and for an empty answer with no error.
4. Keep an eye on the token budget: this account is capped at about 8000 tokens per minute across everything, and the gpt-oss
   models spend more per call than the llama models did.

Nothing in this file has been applied. Owners: `routes/ai_routes.py`, `routes/assistant_routes.py`, `utils/rag_pipeline.py`,
`utils/ai_helper.py`, `utils/llm_client.py` and `rag_query.py` are all last touched by Saurabh Bishnoi in this repository's
history; Priyam should confirm rows 2-4 and 6-7, which are the chat/assistant behaviour.
