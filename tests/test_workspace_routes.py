"""End-to-end tests for /api/workspaces (Phase 2 of workspaces-refactor).

Each test spins up an isolated throw-away sqlite via tests.helpers_app.make_app,
registers a fresh user, creates a firm so the user has an lpms membership, and
exercises the workspace endpoints via a real Flask test client.

Covers:
  * list is empty on a fresh account
  * create → 201 with the row + the creator as owner
  * create without a firm → 400 no_firm
  * create without a name → 400 invalid_workspace_id
  * get single workspace returns members
  * patch updates fields
  * archive / unarchive flip status + archived_at
  * invite firm member, remove firm member
  * cannot remove the last owner
  * second user can't see the first user's workspace (observe mode)
"""
from __future__ import annotations
import os
import pytest

from tests.helpers_app import make_app, register


@pytest.fixture
def app(tmp_path, monkeypatch):
    # Turn the feature on for the duration of the test.
    monkeypatch.setenv("WORKSPACES_ENABLED", "true")
    monkeypatch.setenv("WORKSPACE_ISOLATION_MODE", "enforce")
    return make_app(tmp_path, monkeypatch)


def _create_firm(signed, firm_name="Chambers A"):
    r = signed.post("/api/practice/firm", json={"name": firm_name, "your_name": "Advocate A"})
    assert r.status_code in (201, 200), r.get_json()


# ──────────────────────────────────────────────────────────────────
# Happy path
# ──────────────────────────────────────────────────────────────────
def test_list_empty_on_fresh_user(app):
    with app.app_context():
        s = register(app, "a@example.com")
    _create_firm(s)
    r = s.get("/api/workspaces")
    assert r.status_code == 200
    assert r.get_json() == {"workspaces": []}


def test_create_workspace_sets_creator_as_owner(app):
    with app.app_context():
        s = register(app, "a@example.com")
    _create_firm(s)
    r = s.post("/api/workspaces", json={"name": "Sharma v. State", "case_no": "WP 123/2026", "court": "Delhi HC"})
    assert r.status_code == 201, r.get_json()
    ws = r.get_json()["workspace"]
    assert ws["name"] == "Sharma v. State"
    assert ws["case_no"] == "WP 123/2026"
    assert ws["court"] == "Delhi HC"
    assert ws["status"] == "active"
    assert ws["archived_at"] is None
    assert ws["created_by"] >= 1
    assert len(ws["members"]) == 1
    assert ws["members"][0]["role"] == "owner"


def test_create_without_firm_returns_no_firm(app):
    with app.app_context():
        s = register(app, "nofirm@example.com")
    r = s.post("/api/workspaces", json={"name": "W"})
    assert r.status_code == 400
    assert r.get_json()["code"] == "no_firm"


def test_create_without_name_returns_invalid(app):
    with app.app_context():
        s = register(app, "a@example.com")
    _create_firm(s)
    r = s.post("/api/workspaces", json={})
    assert r.status_code == 400
    assert r.get_json()["code"] == "invalid_workspace_id"


# ──────────────────────────────────────────────────────────────────
# Get / patch / archive
# ──────────────────────────────────────────────────────────────────
def test_get_single_workspace_returns_members(app):
    with app.app_context():
        s = register(app, "a@example.com")
    _create_firm(s)
    wid = s.post("/api/workspaces", json={"name": "X"}).get_json()["workspace"]["id"]
    r = s.get(f"/api/workspaces/{wid}")
    assert r.status_code == 200
    ws = r.get_json()["workspace"]
    assert ws["id"] == wid
    assert len(ws["members"]) == 1


def test_patch_updates_fields(app):
    with app.app_context():
        s = register(app, "a@example.com")
    _create_firm(s)
    wid = s.post("/api/workspaces", json={"name": "X"}).get_json()["workspace"]["id"]
    r = s.patch(f"/api/workspaces/{wid}", json={"name": "Y", "facts": "parties: A vs B"})
    assert r.status_code == 200
    ws = r.get_json()["workspace"]
    assert ws["name"] == "Y"
    assert ws["facts"] == "parties: A vs B"


def test_archive_and_unarchive_flip_status(app):
    with app.app_context():
        s = register(app, "a@example.com")
    _create_firm(s)
    wid = s.post("/api/workspaces", json={"name": "X"}).get_json()["workspace"]["id"]

    r = s.post(f"/api/workspaces/{wid}/archive")
    assert r.status_code == 200
    assert r.get_json()["workspace"]["status"] == "archived"
    assert r.get_json()["workspace"]["archived_at"] is not None

    # Default list excludes archived
    assert s.get("/api/workspaces").get_json() == {"workspaces": []}
    # ?archived=1 includes them
    arch = s.get("/api/workspaces?archived=1").get_json()["workspaces"]
    assert len(arch) == 1 and arch[0]["status"] == "archived"

    r = s.post(f"/api/workspaces/{wid}/unarchive")
    assert r.status_code == 200
    assert r.get_json()["workspace"]["status"] == "active"


# ──────────────────────────────────────────────────────────────────
# Access control
# ──────────────────────────────────────────────────────────────────
def test_other_user_cannot_see_workspace(app):
    with app.app_context():
        a = register(app, "a@example.com")
    _create_firm(a, "Chambers A")
    wid = a.post("/api/workspaces", json={"name": "A's case"}).get_json()["workspace"]["id"]

    with app.app_context():
        b = register(app, "b@example.com")
    _create_firm(b, "Chambers B")

    # B doesn't see A's workspace in the list…
    assert b.get("/api/workspaces").get_json() == {"workspaces": []}
    # …and GETting by id is forbidden.
    r = b.get(f"/api/workspaces/{wid}")
    assert r.status_code == 403
    assert r.get_json()["code"] == "forbidden_workspace"


def test_last_owner_cannot_be_removed(app):
    with app.app_context():
        s = register(app, "a@example.com")
    _create_firm(s)
    wid = s.post("/api/workspaces", json={"name": "X"}).get_json()["workspace"]["id"]
    # Find my firm_member_id from the GET
    members = s.get(f"/api/workspaces/{wid}").get_json()["workspace"]["members"]
    fm_id = members[0]["firm_member_id"]

    r = s.delete(f"/api/workspaces/{wid}/members/{fm_id}")
    assert r.status_code == 400
    assert "last owner" in r.get_json()["message"]
