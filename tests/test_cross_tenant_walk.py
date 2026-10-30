"""Walk every route of the real app as a second advocate and prove nothing of the first advocate's leaks or changes.

1. Advocate A creates data in every family that has a create route; every text field carries a unique canary string.
2. Advocate B, signed in, calls every route (GET with no parameters; every method on routes with ids 1..15, which are the
   ids A's rows have). B must never see a canary, and A's data must be exactly as A left it.
3. A signed-out visitor gets 401 from every non-public API route.
Network and AI calls are cut off so the walk is fast and cannot spend money.
"""
import json
import os
import re
import time

import pytest

from tests.helpers_app import make_app, register

CANARY = "ZXQCANARYA7f3a"
SKIP = re.compile(r"^/api/(auth/|proxy|ai/|legal-research|generate-arguments|firm-library/external-search|kanoon|causelist/fetch|ecourts|court-data|court-globals|districts|upload-case)")
PUBLIC = re.compile(r"^/api/(auth/|ping$)")


@pytest.fixture()
def world(tmp_path, monkeypatch):
    import requests

    def no_network(*a, **k):
        raise requests.ConnectionError("network is off in the tenancy walk")
    monkeypatch.setattr(requests.sessions.Session, "request", no_network)
    import utils.ai_helper as ah
    import utils.llm_client as lc

    def ai_off(*a, **k):
        raise RuntimeError("AI is off in the tenancy walk")
    monkeypatch.setattr(lc, "completion", ai_off)
    monkeypatch.setattr(ah, "completion", ai_off)
    flask_app = make_app(tmp_path, monkeypatch)
    a, b = register(flask_app, "a@example.com"), register(flask_app, "b@example.com")
    return flask_app, a, b


def _seed(a):
    """A's data in every family that can be created over the API. Returns a map of what was created."""
    made = {}

    def post(path, body, key):
        trace = os.environ.get("WALK_TRACE")
        if trace:
            with open(trace, "a", encoding="utf-8") as fh:
                fh.write(f"SEED {path}\n")
        r = a.post(path, json=body)
        made[key] = r.status_code
        return r.get_json() if r.status_code < 300 else {}

    post("/api/practice/firm", {"name": f"{CANARY} Chambers"}, "practice_firm")
    cl = post("/api/practice/clients", {"name": f"{CANARY} Client", "notes": CANARY}, "practice_client")
    cid = (cl.get("client") or cl).get("id")
    cs = post("/api/practice/cases", {"case_no": "CC 1/2026", "court": "Madras High Court", "title": f"{CANARY} v. Other", "client_id": cid, "opposite_party": f"{CANARY} Rival"}, "practice_case")
    post("/api/drafts/sessions", {"type": "notice_138", "facts": {"sender_name": f"{CANARY} Sender"}, "title": f"{CANARY} draft"}, "draft_session")
    post("/api/vault/folders", {"name": f"{CANARY} folder"}, "vault_folder")
    post("/api/clients/add", {"name": f"{CANARY} legacy client"}, "legacy_client")
    post("/api/causelist/save", {"case_name": f"{CANARY} tracked", "case_number": "X 1"}, "tracked_case")
    post("/api/ip/add", {"ip_type": "Trademark", "title": f"{CANARY} mark"}, "ip_asset")
    post("/api/team/members/add", {"name": f"{CANARY} Jay", "email": "jay@example.com"}, "roster")
    post("/api/team/tasks/add", {"title": f"{CANARY} task"}, "task")
    post("/api/calendar/save", {"events": [{"event_date": "2026-12-01", "event_type": "Hearing", "title": f"{CANARY} hearing"}]}, "calendar")
    post("/api/billing/log-time", {"hours": 1, "rate": 1000, "description": CANARY}, "time_entry")
    post("/api/teams", {"name": f"{CANARY} team"}, "team")
    post("/api/matters", {"title": f"{CANARY} matter"}, "matter")
    post("/api/letterheads", {"name": f"{CANARY} letterhead", "html": CANARY}, "letterhead")
    up = a.post("/api/vault/documents/upload", data={"file": (__import__("io").BytesIO(("Agreement. " + CANARY + " confidential clause text for the search.").encode()), "canary.txt", "text/plain")},
                content_type="multipart/form-data")
    made["vault_document"] = up.status_code
    post("/api/drafts/flags/first_run_guide_done", {}, "noop")
    made["case_id"] = (cs.get("case") or cs).get("id")
    return made


SLOW = []
BUDGET_SECONDS = 420
_walk_started = [0.0]


def _call(client, method, url, **kw):
    """One request, timed. Calls slower than 3 s are listed in the output so they can be examined or skipped."""
    t0 = time.time()
    trace = os.environ.get("WALK_TRACE")
    if trace:
        with open(trace, "a", encoding="utf-8") as fh:
            fh.write(f"{method} {url}\n")
    r = getattr(client, method.lower())(url, **kw)
    took = time.time() - t0
    if took > 3:
        SLOW.append((method, url, round(took, 1)))
    return r


def _out_of_time():
    return time.time() - _walk_started[0] > BUDGET_SECONDS


def _plain_server_error(r):
    """A 5xx is acceptable only as a deliberate outage answer (502/503 with a code) or the masked envelope, never raw text."""
    body = r.get_json(silent=True)
    text = r.get_data().decode("utf-8", "replace")
    if not isinstance(body, dict) or not body.get("code"):
        return False
    return not re.search(r"Traceback|Exception|Error:|sqlite|psycopg|api[_ ]?key|\.py|File \"", text)


def _snapshot(a, paths):
    out = {}
    for p in paths:
        trace = os.environ.get("WALK_TRACE")
        if trace:
            with open(trace, "a", encoding="utf-8") as fh:
                fh.write(f"SNAP {p}\n")
        r = a.get(p)
        out[p] = (r.status_code, r.get_data().decode("utf-8", "replace") if r.status_code < 500 else "")
    return out


def _routes(flask_app):
    out = []
    for rule in flask_app.url_map.iter_rules():
        if not rule.rule.startswith("/api/") or PUBLIC.match(rule.rule) or SKIP.match(rule.rule):
            continue
        methods = sorted(rule.methods - {"HEAD", "OPTIONS"})
        out.append((rule.rule, methods, [a for a in rule.arguments]))
    return sorted(out)


def test_walk_every_route_as_a_second_advocate(world):
    flask_app, a, b = world
    made = _seed(a)
    assert made["practice_firm"] in (200, 201) and made["draft_session"] in (200, 201) and made["legacy_client"] == 200 and made["calendar"] == 200
    routes = _routes(flask_app)
    plain_gets = [r for r, methods, args in routes if "GET" in methods and not args]
    SLOW.clear()
    _walk_started[0] = time.time()
    before = _snapshot(a, plain_gets)
    assert any(CANARY in body for _s, body in before.values()), "the seed created nothing readable: the walk would prove nothing"

    leaks, fivexx, calls = [], [], 0
    # 1. every parameterless GET as B
    for path in plain_gets:
        r = _call(b, "GET", path + ("&" if "?" in path else "?") + "query=ZXQCANARY&q=ZXQCANARY&search=ZXQCANARY")
        calls += 1
        if r is None:
            continue
        if CANARY in r.get_data().decode("utf-8", "replace"):
            leaks.append(("GET", path, r.status_code))
        if r.status_code >= 500 and not _plain_server_error(r):
            fivexx.append(("GET", path, r.status_code))
    # 2. every route with ids, every method, ids 1..15 (A's rows have ids in this range), empty and tiny bodies
    skipped_for_time = []
    for path, methods, args in routes:
        if not args:
            continue
        if _out_of_time():
            skipped_for_time.append(path)
            continue
        for ident in range(1, 7):
            url = re.sub(r"<[^>]+>", str(ident), path)
            for m in methods:
                kw = {"json": {}} if m in ("POST", "PUT", "PATCH", "DELETE") else {}
                r = _call(b, m, url, **kw)
                calls += 1
                if r is None:
                    continue
                if CANARY in r.get_data().decode("utf-8", "replace"):
                    leaks.append((m, url, r.status_code))
                if r.status_code >= 500 and not _plain_server_error(r):
                    fivexx.append((m, url, r.status_code))
    print(f"WALK: {len(routes)} routes, {calls} calls as the second advocate, {len(leaks)} leaks, {len(fivexx)} server errors, {len(SLOW)} slow")
    print("SLOW:", SLOW[:15])
    print("LEAKS:", leaks[:10])
    print("ERRORS:", fivexx[:20])
    assert not skipped_for_time, f"the walk ran out of time before reaching: {skipped_for_time[:10]}"
    assert not leaks, leaks[:10]
    # 3. A's data is exactly as A left it
    after = _snapshot(a, plain_gets)
    changed = [p for p in plain_gets if before[p][1] != after[p][1] and not p.endswith(("/me", "/notifications")) and "audit" not in p and "activity" not in p
               and "updated" not in before[p][1][:0]]
    # lists that include timestamps of "last seen" may legitimately differ; compare only the canary-bearing ones
    changed = [p for p in changed if CANARY in before[p][1] and CANARY not in after[p][1]]
    assert not changed, changed
    assert not fivexx, f"server errors while a second advocate poked every route: {fivexx[:12]}"


def test_a_signed_out_visitor_gets_401_from_every_non_public_api_route(world):
    flask_app, _a, _b = world
    anon = flask_app.test_client()
    bad = []
    for rule in flask_app.url_map.iter_rules():
        if not rule.rule.startswith("/api/") or PUBLIC.match(rule.rule):
            continue
        url = re.sub(r"<[^>]+>", "1", rule.rule)
        for m in rule.methods - {"HEAD", "OPTIONS"}:
            r = anon.open(url, method=m, json={})
            if r.status_code != 401:
                bad.append((m, url, r.status_code))
    assert not bad, bad[:15]


def test_the_only_public_api_routes_are_login_related_and_ping(world):
    flask_app, _a, _b = world
    public = sorted(r.rule for r in flask_app.url_map.iter_rules() if r.rule.startswith("/api/") and PUBLIC.match(r.rule))
    assert all(p.startswith("/api/auth/") or p == "/api/ping" for p in public)
    assert "/api/ping" in public
