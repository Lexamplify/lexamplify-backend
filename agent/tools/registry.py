"""Tool registry. Every tool declares its metadata (risk category,
required inputs, verification) so the engine can enforce policy without
knowing what the tool does.

run(ctx, inputs) -> dict        ctx = {"db_path", "user_id", "workspace_id"}
verify(ctx, inputs, output) -> (classification, evidence_str)
"""

VERIFIED_SUCCESS = "VERIFIED_SUCCESS"
VERIFIED_FAILURE = "VERIFIED_FAILURE"
PARTIALLY_VERIFIED = "PARTIALLY_VERIFIED"
UNVERIFIED = "UNVERIFIED"


class Tool:
    def __init__(self, name, description, required_inputs, risk, run, verify=None, optional_inputs=None):
        assert risk in ("A", "B", "C")
        self.name = name
        self.description = description
        self.required_inputs = list(required_inputs)
        self.optional_inputs = list(optional_inputs or [])
        self.risk = risk
        self._run = run
        self._verify = verify

    def validate_inputs(self, inputs):
        missing = [k for k in self.required_inputs if not (inputs or {}).get(k)]
        return missing

    def run(self, ctx, inputs):
        return self._run(ctx, inputs or {})

    def verify(self, ctx, inputs, output):
        if not self._verify:
            return (UNVERIFIED, "tool declares no verification method")
        return self._verify(ctx, inputs or {}, output)

    def spec(self):
        return {"name": self.name, "description": self.description,
                "required_inputs": self.required_inputs, "optional_inputs": self.optional_inputs,
                "risk": self.risk}


_TOOLS = {}


def register(tool):
    _TOOLS[tool.name] = tool
    return tool


def get_tool(name):
    return _TOOLS.get(name)


def all_tools():
    return list(_TOOLS.values())


def specs():
    return [t.spec() for t in all_tools()]
