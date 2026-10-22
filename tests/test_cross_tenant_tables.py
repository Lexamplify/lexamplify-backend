"""User-owned tables, one by one: the second advocate can never read, change or delete the first one's rows.

This is the table-by-table version of tests/test_tenancy.py. The same rule, but written as a matrix, so that
a table which holds a firm's own data cannot be added without a check for it: the test at the bottom of this
file compares the tables the code says are per-advocate with the tables checked here.

For every table the matrix says how a row is made, how it is listed, how it is read, how it is changed and how
it is deleted. The test then proves, for the second signed-in advocate:
  - the row is not in their list;
  - they cannot open it;
  - they cannot change it;
  - they cannot delete it;
  - and the first advocate's row is exactly as it was afterwards.
"""
import pytest

from tests.helpers_app import make_app, register
from utils import tenancy

# ── the matrix ────────────────────────────────────────────────────────────────────────────────
# create: (method, path, body)          list: (method, path)
# read / update / delete: (method, path, body) with {id} for the row id; None = the table has no such route
# id_path: where the new row's id is in the answer ("letterhead.id"); None = the table has no single-row id
# needs_client: the row refers to a client, so one is made first
# update_body_uses_id: the write carries the id in the body, not in the path
# unchanged: what must still be in the owner's list after the other advocate's attempts
TABLES = [
    {
        "table": "clients",
        "create": ("post", "/api/clients/add", {"name": "M/s Sundaram Agencies", "phone": "9876543210"}),
        "id_path": "id",
        "list": ("get", "/api/clients/list"),
        "marker": "Sundaram",
        "read": ("get", "/api/clients/{id}", None),
        "update": ("put", "/api/clients/update/{id}", {"name": "HACKED"}),
        "delete": ("delete", "/api/clients/delete/{id}", None),
    },
    {
        "table": "tracked_cases",
        "create": ("post", "/api/causelist/save", {"case_name": "Sundaram v. Kumar", "case_number": "CC 1/2026",
                                                    "court": "MM Chennai", "next_hearing": "2026-12-01"}),
        "id_path": "id",
        "list": ("get", "/api/causelist/list"),
        "marker": "Sundaram",
        "read": None,
        "update": ("put", "/api/causelist/update/{id}", {"case_name": "HACKED"}),
        "delete": ("delete", "/api/causelist/delete/{id}", None),
    },
    {
        "table": "ip_assets",
        "create": ("post", "/api/ip/add", {"ip_type": "Trademark", "title": "Sundaram Mark", "renewal_due": "2027-01-01"}),
        "id_path": "id",
        "list": ("get", "/api/ip/list"),
        "marker": "Sundaram Mark",
        "read": None,
        "update": ("put", "/api/ip/update/{id}", {"title": "HACKED"}),
        "delete": ("delete", "/api/ip/delete/{id}", None),
    },
    {
        "table": "time_entries",
        "create": ("post", "/api/billing/log-time", {"hours": 2, "rate": 5000, "description": "Sundaram drafting"}),
        "id_path": "id",
        "needs_client": True,
        "list": ("get", "/api/billing/time-entries"),
        "marker": "Sundaram drafting",
        "read": None,
        "update": None,
        "delete": None,
    },
    {
        "table": "invoices",
        "create": ("post", "/api/billing/generate-invoice", {"amount": 10000, "apply_gst": True}),
        "id_path": "id",
        "needs_client": True,
        "list": ("get", "/api/billing/invoices"),
        "marker": "10000",
        "read": None,
        "update": ("put", "/api/billing/mark-paid/{id}", {}),
        "delete": None,
        "unchanged": "Draft",
    },
    {
        "table": "team_members",
        "create": ("post", "/api/team/members/add", {"name": "Junior Sundaram", "email": "junior.sundaram@example.com"}),
        "id_path": "id",
        "list": ("get", "/api/team/members"),
        "marker": "Junior Sundaram",
        "read": None,
        "update": None,
        "delete": ("delete", "/api/team/members/delete/{id}", None),
    },
    {
        "table": "tasks",
        "create": ("post", "/api/team/tasks/add", {"title": "File the Sundaram vakalatnama", "due_date": "2026-11-01"}),
        "id_path": "id",
        "list": ("get", "/api/team/tasks"),
        "marker": "Sundaram",
        "read": None,
        "update": ("put", "/api/team/tasks/update/{id}", {"title": "HACKED"}),
        "delete": ("delete", "/api/team/tasks/delete/{id}", None),
    },
    {
        "table": "calendar_events",
        "create": ("post", "/api/calendar/save",
                   {"events": [{"event_date": "2026-12-01", "event_type": "Hearing", "title": "Sundaram v. Kumar"}]}),
        "id_path": None,
        "list": ("get", "/api/calendar/events"),
        "marker": "Sundaram",
        "read": None,
        "update": None,
        "delete": None,
    },
    {
        "table": "saved_drafts",
        # The browser chooses this id, and the write is an upsert: without an owner check a second advocate
        # could overwrite the first one's draft by using its id. That hole was found by this matrix.
        "create": ("post", "/api/drafts", {"id": "draft_sundaram_1", "title": "Sundaram notice", "rawText": "Sundaram v. Kumar"}),
        "id_path": "draft.id",
        "list": ("get", "/api/drafts"),
        "marker": "Sundaram",
        "read": None,
        "update": ("post", "/api/drafts", {"id": "draft_sundaram_1", "title": "HACKED", "rawText": "HACKED"}),
        "update_body_uses_id": True,
        "delete": ("delete", "/api/drafts/{id}", None),
    },
    {
        "table": "letterheads",
        "create": ("post", "/api/letterheads", {"name": "Sundaram & Associates", "tagline": "Advocates"}),
        "id_path": "letterhead.id",
        "list": ("get", "/api/letterheads"),
        "marker": "Sundaram & Associates",
        "read": None,
        "update": None,
        "delete": ("delete", "/api/letterheads/{id}", None),
    },
    {
        "table": "draft_sessions",
        "create": ("post", "/api/drafts/sessions",
                   {"type": "notice_138", "facts": {"sender_name": "Sundaram"}, "title": "Sundaram session"}),
        "id_path": "id",
        "list": ("get", "/api/drafts/sessions"),
        "marker": "Sundaram",
        "read": ("get", "/api/drafts/sessions/{id}", None),
        "update": ("put", "/api/drafts/sessions/{id}", {"title": "HACKED"}),
        "delete": ("delete", "/api/drafts/sessions/{id}", None),
    },
]

# The tables the code itself says are per-advocate. If one of them is added, the matrix above must grow.
TABLES_CHECKED_BY_THE_CODE = {"clients", "tracked_cases", "ip_assets", "time_entries", "invoices",
                               "team_members", "tasks", "calendar_events"}


@pytest.fixture()
def world(tmp_path, monkeypatch):
    flask_app = make_app(tmp_path, monkeypatch)
    tenancy.reset_cache()
    register(flask_app, "first@example.com")      # the earliest account owns any row that has no owner
    a = register(flask_app, "a@example.com")
    b = register(flask_app, "b@example.com")
    return flask_app, a, b


def _pick(payload, dotted):
    value = payload
    for part in dotted.split("."):
        value = value[part]
    return value


def _id_of(resp):
    body = resp.get_json()
    assert resp.status_code in (200, 201), body
    return body["id"]


@pytest.mark.parametrize("spec", TABLES, ids=[s["table"] for s in TABLES])
def test_the_second_advocate_cannot_reach_the_first_ones_rows(world, spec):
    _flask_app, a, b = world
    table = spec["table"]
    marker = spec["marker"]

    # 1. the first advocate makes a row
    method, path, body = spec["create"]
    body = dict(body or {})
    if spec.get("needs_client"):
        body["client_id"] = _id_of(a.post("/api/clients/add", json={"name": "Sundaram client"}))
    created = getattr(a, method)(path, json=body)
    assert created.status_code in (200, 201), (table, created.status_code, created.get_data(as_text=True)[:200])
    row_id = _pick(created.get_json(), spec["id_path"]) if spec.get("id_path") else None

    # 2. it is in the owner's list, and in nobody else's
    lmethod, lpath = spec["list"]
    owner_list = getattr(a, lmethod)(lpath)
    other_list = getattr(b, lmethod)(lpath)
    assert owner_list.status_code == 200, (table, owner_list.status_code)
    assert marker in owner_list.get_data(as_text=True), (table, "the row is missing from its owner's list")
    assert marker not in other_list.get_data(as_text=True), (table, "the second advocate can see the row")

    # 3. the second advocate cannot open it
    if spec.get("read"):
        rmethod, rpath, _body = spec["read"]
        r = getattr(b, rmethod)(rpath.format(id=row_id))
        assert r.status_code in (403, 404), (table, "the row was opened", r.status_code, r.get_data(as_text=True)[:200])
        assert marker not in r.get_data(as_text=True), (table, "the row's contents leaked")

    # 4. the second advocate cannot change it
    if spec.get("update"):
        umethod, upath, ubody = spec["update"]
        ubody = dict(ubody or {})
        if spec.get("update_body_uses_id"):
            ubody["id"] = row_id
        r = getattr(b, umethod)(upath.format(id=row_id), json=ubody)
        assert r.status_code not in (200, 201), (table, "the row was changed", r.status_code, r.get_data(as_text=True)[:200])
        assert marker not in r.get_data(as_text=True), (table, "the row's contents leaked")

    # 5. the second advocate cannot delete it
    if spec.get("delete"):
        dmethod, dpath, _body = spec["delete"]
        r = getattr(b, dmethod)(dpath.format(id=row_id))
        assert r.status_code not in (200, 204), (table, "the row was deleted", r.status_code)

    # 6. the owner's row is exactly as it was
    after = getattr(a, lmethod)(lpath).get_data(as_text=True)
    assert spec.get("unchanged", marker) in after, (table, "the row is gone")
    assert "HACKED" not in after, (table, "the second advocate's write landed")


def test_every_table_the_code_calls_per_advocate_is_checked_here():
    """If a table is added to the per-advocate list in the code, it must be added to the matrix above."""
    from routes.billing_routes import OWNED_TABLES as BILLING
    from routes.causelist_routes import OWNED_TABLES as CAUSELIST
    from routes.client_routes import OWNED_TABLES as CLIENT
    from routes.team_routes import OWNED_TABLES as TEAM

    from_the_code = set(BILLING) | set(CAUSELIST) | set(CLIENT) | set(TEAM) | {"calendar_events"}
    assert from_the_code == TABLES_CHECKED_BY_THE_CODE, (
        "the code now treats other tables as per-advocate - check them here too:\n"
        f"only in the code: {sorted(from_the_code - TABLES_CHECKED_BY_THE_CODE)}"
    )
    checked_here = {spec["table"] for spec in TABLES}
    assert TABLES_CHECKED_BY_THE_CODE <= checked_here, (
        f"these tables are per-advocate but are not checked here: {sorted(TABLES_CHECKED_BY_THE_CODE - checked_here)}"
    )
