"""The public part of the API, in one place.

app.py's sign-in gate lets every request through except the paths listed here: every other /api/ call needs
a signed-in session. The two test files that watch the gate use this list:

  - tests/test_api_gate_matrix.py calls every route without a session and proves that everything outside
    this list is refused, and that everything inside it is not;
  - tests/test_route_snapshot.py records the same classification in the frozen route table, so a route that
    quietly changes sides is noticed.

Nothing is skipped silently: the list is short, it is written out here, and any change to it has to be made
in this file (and reviewed).
"""
import re

# The gate's own list (app.py: _PUBLIC_API_PREFIXES / _PUBLIC_API_EXACT).
PUBLIC_API_PREFIXES = ("/api/auth/",)
PUBLIC_API_EXACT = {"/api/ping"}

# What the gate answers when there is no session (app.py: _jwt_missing).
GATE_CODE = "AUTH_REQUIRED"
GATE_MESSAGE = "Please sign in to continue."

_PLACEHOLDER = re.compile(r"<(?:(?P<conv>[a-zA-Z_]+)(?:\([^)]*\))?:)?(?P<name>[a-zA-Z_][a-zA-Z0-9_]*)>")


def is_public(path):
    """True when the gate lets this path through without a session."""
    return path in PUBLIC_API_EXACT or path.startswith(PUBLIC_API_PREFIXES)


def gate_class(path):
    """Which group a path belongs to: public, signed-in, static or a legacy page outside /api/."""
    if path.startswith("/api/"):
        return "public" if is_public(path) else "signed-in"
    if path.startswith("/static"):
        return "static"
    return "non-api"


def is_gate_refusal(response):
    """True when the answer is the gate turning an anonymous caller away (not a route's own 401)."""
    if response.status_code != 401:
        return False
    body = response.get_json(silent=True) or {}
    return body.get("code") == GATE_CODE and body.get("message") == GATE_MESSAGE


def concrete_url(rule):
    """A URL that matches the rule, with every placeholder filled in."""
    def fill(m):
        conv = (m.group("conv") or "string").lower()
        if conv == "int":
            return "1"
        if conv == "float":
            return "1.5"
        if conv == "path":
            return "x"
        if conv == "uuid":
            return "00000000-0000-0000-0000-000000000000"
        return "x"
    return _PLACEHOLDER.sub(fill, rule)
