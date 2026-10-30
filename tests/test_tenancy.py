"""One advocate can never read, change or delete another advocate's rows in the older tables
(clients, billing, tracked cases, IP assets, team roster and task board, calendar)."""
import sqlite3

import pytest

from tests.helpers_app import make_app, register
from utils import tenancy


@pytest.fixture()
def world(tmp_path, monkeypatch):
    flask_app = make_app(tmp_path, monkeypatch)
    tenancy.reset_cache()
    first = register(flask_app, "first@example.com")      # id 1: the earliest account owns any pre-existing rows
    a = register(flask_app, "a@example.com")
    b = register(flask_app, "b@example.com")
    return flask_app, first, a, b


def _id(r):
    body = r.get_json()
    assert r.status_code in (200, 201), body
    return body["id"]


def test_clients_are_private(world):
    _f, _first, a, b = world
    cid = _id(a.post("/api/clients/add", json={"name": "M/s Sundaram Agencies", "phone": "9876543210"}))
    assert [c["name"] for c in a.get("/api/clients/list").get_json()] == ["M/s Sundaram Agencies"]
    assert b.get("/api/clients/list").get_json() == []
    assert b.get(f"/api/clients/{cid}").status_code == 404
    assert b.put(f"/api/clients/update/{cid}", json={"name": "HACKED"}).status_code == 404
    assert b.delete(f"/api/clients/delete/{cid}").status_code == 404
    assert a.get(f"/api/clients/{cid}").get_json()["name"] == "M/s Sundaram Agencies"      # untouched


def test_tracked_cases_and_the_calendar_export_are_private(world):
    _f, _first, a, b = world
    cid = _id(a.post("/api/causelist/save", json={"case_name": "Sundaram v. Kumar", "case_number": "CC 1/2026", "court": "MM Chennai", "next_hearing": "2026-12-01"}))
    assert len(a.get("/api/causelist/list").get_json()) == 1 and b.get("/api/causelist/list").get_json() == []
    assert b.put(f"/api/causelist/update/{cid}", json={"case_name": "HACKED"}).status_code == 404
    assert b.delete(f"/api/causelist/delete/{cid}").status_code == 404
    ics_b = b.get("/api/causelist/export-ics").data.decode()
    assert "Sundaram" not in ics_b and "VEVENT" not in ics_b
    assert "Sundaram v. Kumar" in a.get("/api/causelist/export-ics").data.decode()
    assert a.get("/api/causelist/list").get_json()[0]["case_name"] == "Sundaram v. Kumar"


def test_ip_assets_are_private(world):
    _f, _first, a, b = world
    iid = _id(a.post("/api/ip/add", json={"ip_type": "Trademark", "title": "LEX", "renewal_due": "2027-01-01"}))
    assert len(a.get("/api/ip/list").get_json()) == 1 and b.get("/api/ip/list").get_json() == []
    assert b.put(f"/api/ip/update/{iid}", json={"title": "HACKED"}).status_code == 404
    assert b.delete(f"/api/ip/delete/{iid}").status_code == 404
    assert a.get("/api/ip/list").get_json()[0]["title"] == "LEX"


def test_billing_is_private_and_cannot_link_to_someone_elses_client(world):
    _f, _first, a, b = world
    client = _id(a.post("/api/clients/add", json={"name": "Client A"}))
    te = _id(a.post("/api/billing/log-time", json={"client_id": client, "hours": 2, "rate": 5000, "description": "Drafting"}))
    inv = _id(a.post("/api/billing/generate-invoice", json={"client_id": client, "amount": 10000, "apply_gst": True}))
    assert len(a.get("/api/billing/time-entries").get_json()) == 1 and b.get("/api/billing/time-entries").get_json() == []
    assert len(a.get("/api/billing/invoices").get_json()) == 1 and b.get("/api/billing/invoices").get_json() == []
    assert b.put(f"/api/billing/mark-paid/{inv}", json={}).status_code == 404
    assert b.post(f"/api/billing/generate-pdf/{inv}").status_code == 404
    assert a.get("/api/billing/invoices").get_json()[0]["status"] == "Draft"
    # B cannot attach their own time or invoice to A's client id
    assert b.post("/api/billing/log-time", json={"client_id": client, "hours": 1, "rate": 1}).status_code == 404
    assert b.post("/api/billing/generate-invoice", json={"client_id": client, "amount": 1}).status_code == 404
    # invoice numbers count each advocate's own invoices, not the whole firm's
    own = _id(b.post("/api/clients/add", json={"name": "Client B"}))
    r = b.post("/api/billing/generate-invoice", json={"client_id": own, "amount": 500}).get_json()
    assert r["invoice_number"].endswith("-0001")
    assert te and inv


def test_team_roster_and_task_board_are_private(world):
    _f, _first, a, b = world
    mid = _id(a.post("/api/team/members/add", json={"name": "Junior Jay", "email": "jay@example.com"}))
    tid = _id(a.post("/api/team/tasks/add", json={"title": "File the vakalatnama", "assigned_to": mid, "due_date": "2026-11-01"}))
    assert [m["name"] for m in a.get("/api/team/members").get_json()] == ["Junior Jay"] and b.get("/api/team/members").get_json() == []
    assert len(a.get("/api/team/tasks").get_json()) == 1 and b.get("/api/team/tasks").get_json() == []
    assert b.put(f"/api/team/tasks/status/{tid}", json={"status": "done"}).status_code == 404
    assert b.put(f"/api/team/tasks/update/{tid}", json={"title": "HACKED"}).status_code == 404
    assert b.delete(f"/api/team/tasks/delete/{tid}").status_code == 404
    assert b.delete(f"/api/team/members/delete/{mid}").status_code == 404
    assert a.get("/api/team/tasks").get_json()[0]["title"] == "File the vakalatnama"
    assert a.put(f"/api/team/tasks/status/{tid}", json={"status": "done"}).status_code == 200


def test_calendar_events_are_private(world):
    _f, _first, a, b = world
    r = a.post("/api/calendar/save", json={"events": [{"event_date": "2026-12-01", "event_type": "Hearing", "title": "Sundaram v. Kumar"}]})
    assert r.status_code == 200
    assert [e["title"] for e in a.get("/api/calendar/events").get_json()["events"]] == ["Sundaram v. Kumar"]
    assert b.get("/api/calendar/events").get_json()["events"] == []


def test_rows_from_before_ownership_belong_to_the_earliest_account_only(world):
    flask_app, first, a, b = world
    path = flask_app.config["SQLITE_DB_PATH"]
    # warm up so the tables and owner columns exist, then plant rows the way the old code wrote them (no owner)
    first.get("/api/clients/list")
    conn = sqlite3.connect(path)
    conn.execute("INSERT INTO clients (name, owner_user_id) VALUES ('Old Client Ltd', NULL)")
    conn.execute("INSERT INTO tracked_cases (case_name, owner_user_id) VALUES ('Old Case', NULL)")
    conn.commit()
    conn.close()
    assert a.get("/api/clients/list").get_json() == [] and b.get("/api/causelist/list").get_json() == []      # nobody else gets them
    assert [c["name"] for c in first.get("/api/clients/list").get_json()] == ["Old Client Ltd"]
    assert [c["case_name"] for c in first.get("/api/causelist/list").get_json()] == ["Old Case"]
    assert a.get("/api/clients/list").get_json() == []                                                         # and it stays that way


def test_every_older_route_still_needs_sign_in(world):
    flask_app, _first, _a, _b = world
    anon = flask_app.test_client()
    for path in ("/api/clients/list", "/api/billing/invoices", "/api/causelist/list", "/api/ip/list", "/api/team/members", "/api/team/tasks", "/api/calendar/events"):
        assert anon.get(path).status_code == 401, path


def test_errors_from_these_routes_never_carry_internals(world):
    _f, _first, a, _b = world
    for method, path, body in (("post", "/api/billing/log-time", {"hours": "not a number"}), ("post", "/api/billing/generate-invoice", {"amount": "x"}),
                               ("post", "/api/clients/add", None), ("post", "/api/clients/add", [1])):
        r = getattr(a, method)(path, json=body) if body is not None else getattr(a, method)(path, data="{bad", content_type="application/json")
        assert r.status_code < 500 or "Traceback" not in r.get_data(as_text=True)
        text = r.get_data(as_text=True)
        assert "could not convert" not in text and "invalid literal" not in text and "sqlite" not in text.lower() and "Traceback" not in text


def test_vault_sharing_only_works_with_people_on_your_own_roster(world):
    _f, _first, a, b = world
    folder = _id(a.post("/api/vault/folders", json={"name": "Drafts 2026"}))
    mine = _id(a.post("/api/team/members/add", json={"name": "Junior Jay", "email": "jay@example.com"}))
    theirs = _id(b.post("/api/team/members/add", json={"name": "Bee Secret", "email": "bee-secret@example.com"}))
    r = a.post("/api/vault/shares", json={"node_type": "folder", "node_id": folder, "team_member_id": theirs, "permission": "view"})
    assert r.status_code == 404 and "Bee Secret" not in r.get_data(as_text=True) and "bee-secret" not in r.get_data(as_text=True)
    ok = a.post("/api/vault/shares", json={"node_type": "folder", "node_id": folder, "team_member_id": mine, "permission": "view"})
    assert ok.status_code in (200, 201), ok.get_json()
