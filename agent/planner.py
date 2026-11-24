"""Natural language -> executable plan.

The LLM proposes the plan as JSON; the planner VALIDATES it against the tool
registry (unknown tools and missing inputs are rejected here, before anything
executes). The LLM may instead ask one clarifying question when the
instruction lacks a required input.
"""
from agent import providers
from agent.tools import registry

_SYSTEM = """You are the task planner for LexAmplify, a legal practice app.
Convert the user's instruction into a JSON plan using ONLY these tools:

{tools}

Reply with ONE JSON object, nothing else:
{{"plan": [{{"tool": "<name>", "inputs": {{...}}, "depends_on": []}}], "reply": "<one-line summary for the user>"}}

Rules:
- Use the fewest steps that complete the instruction.
- If a required input is missing from the instruction and cannot be inferred,
  reply instead with {{"question": "<ONE short question asking for exactly what is missing>"}}.
- Never invent tools, never guess required values like titles or names."""


class PlanError(Exception):
    def __init__(self, message, code="VALIDATION_FAILED"):
        super().__init__(message)
        self.code = code


def make_plan(instruction, context_note=""):
    """Returns ("plan", [steps], reply) or ("question", text, None)."""
    tools_desc = "\n".join(
        f"- {t.name} (risk {t.risk}): {t.description} required inputs: {t.required_inputs or 'none'}"
        for t in registry.all_tools())
    messages = [
        {"role": "system", "content": _SYSTEM.format(tools=tools_desc)},
        {"role": "user", "content": (context_note + "\n\n" if context_note else "") + instruction},
    ]
    data = providers.get_provider().complete_json(messages)

    if data.get("question"):
        return ("question", str(data["question"]).strip(), None)

    plan = data.get("plan")
    if not isinstance(plan, list) or not plan:
        raise PlanError("model returned no usable plan")

    validated = []
    for i, step in enumerate(plan):
        name = (step or {}).get("tool")
        tool = registry.get_tool(name)
        if not tool:
            raise PlanError(f"plan step {i} uses unknown tool '{name}'")
        inputs = step.get("inputs") or {}
        missing = tool.validate_inputs(inputs)
        if missing:
            return ("question", f"I need {', '.join(missing)} for {tool.name.replace('_', ' ')} — what should it be?", None)
        deps = [int(d) for d in (step.get("depends_on") or []) if isinstance(d, (int, float, str)) and str(d).isdigit()]
        if any(d >= i for d in deps):
            raise PlanError(f"plan step {i} depends on a later/own step")
        validated.append({"tool": name, "inputs": inputs, "depends_on": deps, "risk": tool.risk})

    return ("plan", validated, str(data.get("reply") or "Working on it."))
