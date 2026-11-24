"""Recovery engine (Levels 1 and 2) with a deterministic supervisor.

The SUPERVISOR is plain code: it classifies errors, decides whether a retry /
input-replan / backward fix is even allowed (budgets, loop detection), and
only then lets the LLM propose the actual correction. The LLM never decides
how many times to try.

Level 1 — checkpoint resume: engine skips DONE steps, so fixing and rerunning
a task never redoes finished work (engine.resume_task after a restart).
Level 2 — backward reasoning: when a step keeps failing, the LLM inspects the
whole plan + outputs and may blame an EARLIER step; the engine resets from
there and cascades forward.
"""
import sqlite3

from agent import providers
from agent.tools import registry

# Error classification codes (docs/agent/ARCHITECTURE.md §5)
RETRYABLE = {"NETWORK_TIMEOUT", "RATE_LIMITED", "DATABASE_ERROR", "EXTERNAL_SERVICE_UNAVAILABLE"}

MAX_RECOVERY_ACTIONS_PER_TASK = 5


def classify(exc):
    if isinstance(exc, sqlite3.OperationalError):
        return "DATABASE_ERROR"
    if isinstance(exc, sqlite3.IntegrityError):
        return "CONFLICT"
    if isinstance(exc, (TimeoutError,)):
        return "NETWORK_TIMEOUT"
    if isinstance(exc, providers.ProviderError):
        return "EXTERNAL_SERVICE_UNAVAILABLE"
    if isinstance(exc, (ValueError,)):
        return "VALIDATION_FAILED"
    if isinstance(exc, KeyError):
        return "MISSING_PARAMETER"
    if isinstance(exc, PermissionError):
        return "PERMISSION_DENIED"
    if isinstance(exc, LookupError):
        return "RESOURCE_NOT_FOUND"
    return "UNKNOWN_ERROR"


class Supervisor:
    """Per-task recovery bookkeeping: budgets and loop detection. Purely
    deterministic — no LLM involvement in these decisions."""

    def __init__(self, budget=MAX_RECOVERY_ACTIONS_PER_TASK):
        self.budget = budget
        self.actions = 0
        self.signatures = set()

    def allow(self, tool_name, code, detail=""):
        """One recovery action for this (tool, code, detail) — False means
        stop: budget exhausted or the exact same failure already recovered
        once (a second identical failure is a loop, not bad luck)."""
        sig = (tool_name, code, detail[:120])
        if self.actions >= self.budget:
            return False
        if sig in self.signatures:
            return False
        self.signatures.add(sig)
        self.actions += 1
        return True


_FIX_SYSTEM = """You repair a failed step in an executing plan for a legal-practice app.
Plan steps (with outputs so far) and the failure are given. Reply with ONE JSON object:
- To fix the FAILING step's inputs: {"fix_step": <failing index>, "inputs": {...corrected inputs...}}
- If an EARLIER step's inputs caused this (backward reasoning): {"fix_step": <that earlier index>, "inputs": {...}}
- If the task cannot be fixed without the user: {"ask_user": "<one short question>"}
Correct ONLY what the error demands. Never invent facts the user did not give (names, dates you cannot derive)."""


def propose_fix(steps, failed_idx, error_text, instruction):
    """Ask the LLM for a correction. Returns ("fix", idx, inputs) or
    ("ask_user", question) or ("give_up", reason). The caller validates."""
    plan_desc = "\n".join(
        f"step {s['idx']}: tool={s['tool']} inputs={s['inputs']} state={s['state']} output={s.get('output')}"
        for s in steps)
    messages = [
        {"role": "system", "content": _FIX_SYSTEM},
        {"role": "user", "content": (f"Original instruction: {instruction}\n\nPlan:\n{plan_desc}\n\n"
                                     f"Step {failed_idx} FAILED with: {error_text}")},
    ]
    try:
        data = providers.get_provider().complete_json(messages, temperature=0.1)
    except providers.ProviderError as e:
        return ("give_up", f"recovery model unavailable: {e}")

    if data.get("ask_user"):
        return ("ask_user", str(data["ask_user"]).strip())

    idx = data.get("fix_step")
    inputs = data.get("inputs")
    if not isinstance(idx, int) or not isinstance(inputs, dict) or idx < 0 or idx > failed_idx:
        return ("give_up", "recovery model returned no usable fix")

    tool = registry.get_tool(next((s["tool"] for s in steps if s["idx"] == idx), None))
    if not tool:
        return ("give_up", f"fix targets unknown step {idx}")
    missing = tool.validate_inputs(inputs)
    if missing:
        return ("give_up", f"fix is missing required inputs: {missing}")
    return ("fix", idx, inputs)
