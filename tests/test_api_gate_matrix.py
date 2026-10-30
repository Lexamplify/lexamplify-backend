"""The sign-in gate is default-deny, and this file proves it for every route of the app.

The rule is short: every /api/ call needs a session except the paths listed in tests/api_gate.py. This test
walks the whole route table of the real app and calls every method of every route WITHOUT a session:

  - a route that is not on the public list must answer 401 - the gate refuses it;
  - a route on the public list must not be refused by the gate (it may still refuse the caller itself, for
    its own reasons: a wrong password, a missing field);
  - the legacy pages outside /api/ are listed one by one below: they serve templates without any data, and
    the gate does not cover them (a decision, not an accident - see docs/PRODUCT_MAP.md).

Nothing is skipped silently: every route of the table falls into exactly one of those three groups, and the
test fails if a route lands in a group it was not expected in.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from api_gate import concrete_url, gate_class, is_gate_refusal   # noqa: E402
from helpers_app import make_app                                # noqa: E402

# The pages outside /api/. They answer with a template and no data; they are not behind the sign-in gate.
LEGACY_PAGES = {
    "/",
    "/billing",
    "/case-management",
    "/clients",
    "/contract-viewer",
    "/court-resources",
    "/dashboard",
    "/login",
    "/signup",
}

# The public routes that check the session themselves, so a signed-out caller gets their own 401 (the same
# wording the gate uses - the loader is shared). Every other public route must answer for itself.
PUBLIC_ROUTES_WITH_THEIR_OWN_GUARD = {
    ("GET", "/api/auth/me"),
    ("PATCH", "/api/auth/me"),
    ("POST", "/api/auth/change-password"),
    ("POST", "/api/auth/refresh"),
}


@pytest.fixture()
def app(tmp_path, monkeypatch):
    monkeypatch.setenv("DMS_STRICT_MOUNT", "1")     # a hub that cannot start must fail the test, not shrink the table
    return make_app(tmp_path, monkeypatch, name="gate.db")


def _routes(flask_app):
    for rule in flask_app.url_map.iter_rules():
        methods = sorted(m for m in rule.methods if m not in ("HEAD", "OPTIONS"))
        if methods:
            yield rule, methods


def test_the_gate_refuses_every_route_that_is_not_public(app):
    anon = app.test_client()
    wrong = []
    checked = 0
    for rule, methods in _routes(app):
        if gate_class(rule.rule) != "signed-in":
            continue
        url = concrete_url(rule.rule)
        for method in methods:
            checked += 1
            resp = anon.open(url, method=method)
            if resp.status_code != 401 or not is_gate_refusal(resp):
                wrong.append(f"{method} {rule.rule} -> {resp.status_code} {resp.get_data(as_text=True)[:120]!r}")
    assert checked > 300, f"only {checked} signed-in routes were checked - the walk is broken"
    assert not wrong, "these routes answered a signed-out caller instead of refusing:\n" + "\n".join(wrong)


def test_the_public_routes_are_not_refused_by_the_gate(app):
    """Every public route must reach its own code. The only ones that may refuse a signed-out caller are the
    four that ask for a session themselves - they are listed above, one by one."""
    anon = app.test_client()
    refused, checked = [], 0
    for rule, methods in _routes(app):
        if gate_class(rule.rule) != "public":
            continue
        url = concrete_url(rule.rule)
        for method in methods:
            checked += 1
            resp = anon.open(url, method=method)
            if resp.status_code == 401 and (method, rule.rule) not in PUBLIC_ROUTES_WITH_THEIR_OWN_GUARD:
                refused.append(f"{method} {rule.rule} -> {resp.status_code} {resp.get_data(as_text=True)[:120]!r}")
    assert checked >= 19, f"only {checked} public routes were checked - the walk is broken"
    assert not refused, "the gate refused these public routes:\n" + "\n".join(refused)


def test_the_public_routes_that_ask_for_a_session_are_exactly_the_four_we_know(app):
    """The exemption list above must stay in step with the app: no public route may start asking for a
    session (that would hide the gate's own refusal), and none of the four may stop asking."""
    anon = app.test_client()
    asking = set()
    for rule, methods in _routes(app):
        if gate_class(rule.rule) != "public":
            continue
        for method in methods:
            if anon.open(concrete_url(rule.rule), method=method).status_code == 401:
                asking.add((method, rule.rule))
    assert asking == PUBLIC_ROUTES_WITH_THEIR_OWN_GUARD, (
        "the public routes that ask for a session have changed - list them on purpose:\n"
        f"only here: {sorted(asking - PUBLIC_ROUTES_WITH_THEIR_OWN_GUARD)}\n"
        f"only in the list: {sorted(PUBLIC_ROUTES_WITH_THEIR_OWN_GUARD - asking)}"
    )


def test_the_public_routes_answer_for_themselves(app):
    """/api/ping and the sign-in routes must answer their own business, not the gate's."""
    anon = app.test_client()
    ping = anon.get("/api/ping")
    assert ping.status_code == 200 and ping.get_json().get("ok") is True, ping.get_data(as_text=True)
    login = anon.post("/api/auth/login", json={})
    assert login.status_code == 400, login.get_data(as_text=True)     # it reached the route: it wants a password
    register = anon.post("/api/auth/register", json={})
    assert register.status_code == 400, register.get_data(as_text=True)
    config = anon.get("/api/auth/config")
    assert config.status_code == 200, config.get_data(as_text=True)


def test_the_legacy_pages_outside_the_api_are_the_ones_we_know_about(app):
    found = {rule.rule for rule, _methods in _routes(app) if gate_class(rule.rule) == "non-api"}
    assert found == LEGACY_PAGES, "the pages outside /api/ have changed - list them here on purpose"
    anon = app.test_client()
    for path in sorted(LEGACY_PAGES):
        resp = anon.get(path)
        assert resp.status_code != 401, f"{path} is behind the gate - either move it into /api/ or say so here"
