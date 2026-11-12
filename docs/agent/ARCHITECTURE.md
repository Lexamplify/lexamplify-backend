# Executive Assistant — Agent Architecture

Status: locked 2026-11-12 (Phase 1). Source blueprint: Autonomous AI Agent Platform (Priyam ~90% + JN safety patterns ~10%).

## 1. Overview

An autonomous agent (not a chatbot) that accepts natural-language/voice instructions, plans multi-step tasks, executes them via a registered tool set against LexAmplify's own APIs, recovers from failures, and verifies outcomes against actual state.

Deterministic **Agent Engine** (plain Python) coordinates; the LLM (gpt-4o-mini via `utils/llm_client.completion`) does interpretation, planning and recovery reasoning only. The engine, not the LLM, owns the task lifecycle.

## 2. Components

| Component | File | Responsibility |
|---|---|---|
| Model provider | `agent/providers.py` | `complete(messages, json_schema=None)` — wraps `utils/llm_client.completion`; provider-swappable; JSON-mode enforcement + schema validation |
| Task store | `agent/store.py` | SQLite persistence (`_ensure_schema` pattern) for tasks/steps/checkpoints/failure memory |
| Planner | `agent/planner.py` | NL → structured plan (list of step nodes w/ tool, inputs, risk, verification) |
| Tool registry | `agent/tools/registry.py` | Tool metadata: name, schema, risk category, idempotency, verification method |
| Tools | `agent/tools/*.py` | Action modules calling internal route logic (matters, calendar, conflict, drafts, vault, navigate) |
| Executor | `agent/engine.py` | Lifecycle state machine, step execution, checkpointing, bounded retries, loop detection |
| Recovery | `agent/recovery.py` | Error classification → recovery strategy (L1 checkpoint resume, L2 backward reasoning), recovery supervisor w/ budgets |
| Verifier | `agent/verify.py` | Per-tool independent verification (DB query / API re-read); VERIFIED_SUCCESS/FAILURE/PARTIAL/UNVERIFIED |
| API | `routes/agent_routes.py` | `agent_bp` @ `/api/agent` |
| UI | `frontend/src/pages/Assistant.jsx` | Chat + task timeline + approval cards |

## 3. Database (in `instance/database.db`, `_ensure_schema` on connect)

```sql
agent_tasks(
  id TEXT PK,            -- uuid4
  user_id INTEGER, workspace_id INTEGER,
  instruction TEXT, state TEXT,           -- CREATED|PLANNING|EXECUTING|RECOVERING|WAITING_FOR_USER|WAITING_FOR_APPROVAL|VERIFYING|COMPLETED|FAILED|CANCELLED
  plan_json TEXT, result_json TEXT, error_json TEXT,
  created_at TEXT, updated_at TEXT
)
agent_steps(
  id TEXT PK, task_id TEXT, idx INTEGER,
  tool TEXT, inputs_json TEXT, depends_on_json TEXT,
  risk TEXT,                               -- A|B|C
  state TEXT,                              -- PENDING|RUNNING|DONE|FAILED|SKIPPED
  output_json TEXT, verification TEXT, attempts INTEGER DEFAULT 0,
  idempotency_key TEXT, updated_at TEXT
)
agent_checkpoints(id INTEGER PK AUTOINC, task_id TEXT, step_idx INTEGER, snapshot_json TEXT, created_at TEXT)
agent_failure_memory(id INTEGER PK AUTOINC, error_code TEXT, tool TEXT, signature TEXT, resolution_json TEXT, verified INTEGER, created_at TEXT)
agent_messages(id INTEGER PK AUTOINC, task_id TEXT, who TEXT, text TEXT, created_at TEXT)
```

## 4. API contracts (`/api/agent`, all `@jwt_required`, workspace via `X-Workspace-ID`)

| Endpoint | Body | Returns |
|---|---|---|
| `POST /task` | `{instruction}` | `{task_id, state, plan?, question?}` — creates, plans, begins executing (sync for v1) |
| `GET /tasks` | — | list for user+workspace |
| `GET /task/<id>` | — | full task: state, steps, messages, verification |
| `POST /task/<id>/reply` | `{answer}` | resume WAITING_FOR_USER |
| `POST /task/<id>/approve` | `{step_idx, decision: approve\|reject}` | resume/skip Category C step |
| `POST /task/<id>/cancel` | — | cancel |

## 5. Error codes

`MISSING_PARAMETER, AUTH_REQUIRED, PERMISSION_DENIED, RESOURCE_NOT_FOUND, VALIDATION_FAILED, RATE_LIMITED, NETWORK_TIMEOUT, EXTERNAL_SERVICE_UNAVAILABLE, DATABASE_ERROR, DUPLICATE_OPERATION, CONFLICT, STALE_CONTEXT, UNKNOWN_ERROR`

Recovery supervisor rules (deterministic): max 2 retries/step, max 5 recovery actions/task, loop detection on repeated (tool, error) signature, idempotency-key check before any re-execution of a write.

## 6. Risk categories

- **A (read-only):** query matters/calendar/context — autonomous.
- **B (reversible create):** create matter/event/draft — autonomous, verified, idempotency-keyed.
- **C (consequential):** delete, bulk ops, external sends — requires approval (`WAITING_FOR_APPROVAL`, confirmation card UI).

## 7. Security

Reuse `@jwt_required` + `request_workspace_id()` + `can_access()`. Tools receive `(user_id, workspace_id)` explicitly; no tool may query outside that workspace. Secrets never enter prompts. All agent actions written to `agent_steps` (audit trail).

## 8. Verification

Each tool declares `verify(output) -> (classification, evidence)`; e.g. create_matter verifies by re-querying the matter row by id. A task reaches COMPLETED only if all executed steps are VERIFIED_SUCCESS or PARTIAL-with-note.

## 9. Testing strategy

- Unit: store, registry, planner (mocked LLM), recovery classification.
- Integration: `tests/agent/` on conftest throwaway app+DB; fake LLM injected at `agent.providers` level (conftest already blanks API keys).
- Per-phase gate: phase's tests green before next phase starts.
- Benchmark: `tests/agent/test_benchmark.py` — 20 canned tasks w/ scripted fake-LLM plans; target ≥60% (Phase 2), grow later.

## 10. Out of scope (deferred/excluded)

Local LLM (Ollama), Temporal, PostgreSQL/Qdrant, browser automation, OpenTelemetry, multi-app support, awake mode.
