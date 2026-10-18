"""Conflict check: real firm data only, honest about empty data, Indian name variants, isolated per firm."""
import pytest

from tests.helpers_app import make_app, register


@pytest.fixture()
def world(tmp_path, monkeypatch):
    flask_app = make_app(tmp_path, monkeypatch)
    a, b, c = register(flask_app, "a@example.com"), register(flask_app, "b@example.com"), register(flask_app, "c@example.com")
    for who, firm in ((a, "Raman Chambers"), (b, "Other Chambers")):
        assert who.post("/api/practice/firm", json={"name": firm}).status_code in (200, 201)
    return flask_app, a, b, c


def _client(s, name):
    r = s.post("/api/practice/clients", json={"name": name})
    assert r.status_code in (200, 201), r.get_json()
    return (r.get_json().get("client") or r.get_json())["id"]


def _case(s, **kw):
    body = {"case_no": "CC 1/2026", "court": "Metropolitan Magistrate, Chennai", "title": "A v. B", **kw}
    r = s.post("/api/practice/cases", json=body)
    assert r.status_code in (200, 201), r.get_json()
    return (r.get_json().get("case") or r.get_json())["id"]


def _check(s, client="", opposing=None):
    r = s.post("/api/practice/conflicts/check", json={"client_name": client, "opposing_names": opposing or []})
    assert r.status_code == 200, r.get_json()
    return r.get_json()


def _seed(a):
    sundaram = _client(a, "M/s Sundaram Agencies")
    arun = _client(a, "Mr. Arun Kumar")
    c1 = _case(a, case_no="CC 1/2026", title="Sundaram Agencies v. Kumar Traders", client_id=sundaram, opposite_party="M/s Kumar Traders Pvt Ltd")
    c2 = _case(a, case_no="OS 22/2025", title="Arun Kumar v. Gupta", client_id=arun, opposite_party="Ramesh Gupta")
    a.post(f"/api/practice/cases/{c2}/parties", json={"role": "witness", "name": "Priya Raman"})
    return c1, c2


def test_an_empty_practice_is_never_reported_as_clear(world):
    _f, a, _b, _c = world
    r = _check(a, "Rajesh Sharma", ["Tech Corp India Private Limited"])
    assert r["status"] == "no_records" and "not a clearance" in r["headline"].lower()
    assert r["findings"] == [] and r["searched"] == {"clients": 0, "cases": 0, "parties": 0}


def test_no_demo_names_are_ever_returned(world):
    _f, a, _b, _c = world
    _seed(a)
    for name in ("Rajesh Sharma", "Tech Corp India Private Limited", "Karan Patel", "State of Maharashtra"):
        r = _check(a, name)
        assert r["status"] == "clear" and not [f for f in r["findings"] if f["level"] != "info"], (name, r)


def test_acting_against_someone_you_act_against_elsewhere_is_a_conflict(world):
    _f, a, _b, _c = world
    _seed(a)
    r = _check(a, "Kumar Traders")
    assert r["status"] == "possible" or r["status"] == "conflict"
    top = r["findings"][0]
    assert top["kind"] == "client_is_opposed_elsewhere" and top["level"] == "conflict" and top["record"]["case_no"] == "CC 1/2026"
    assert r["status"] == "conflict"


def test_the_other_side_being_your_own_client_is_a_conflict(world):
    _f, a, _b, _c = world
    _seed(a)
    r = _check(a, "Mrs. Meena Iyer", ["Sundaram Agencies Pvt Ltd"])
    kinds = {f["kind"]: f for f in r["findings"]}
    assert r["status"] == "conflict" and kinds["opposite_is_our_client"]["level"] == "conflict" and kinds["opposite_is_client"]["level"] == "conflict"


@pytest.mark.parametrize("typed,expect", [("Sundharam Agencies", "conflict"), ("Arun Kumar", "info"), ("R. Gupta", "possible"), ("Mohd. Rafiq", None)])
def test_indian_variants_and_initials(world, typed, expect):
    _f, a, _b, _c = world
    _seed(a)
    r = _check(a, "New Client", [typed]) if typed != "R. Gupta" else _check(a, typed)
    levels = {f["level"] for f in r["findings"]}
    if expect is None:
        assert not levels
    elif typed == "Arun Kumar":
        assert any(f["kind"] == "existing_client" for f in _check(a, typed)["findings"])
    else:
        assert expect in levels, (typed, r["findings"])


def test_a_clear_result_reports_what_was_searched(world):
    _f, a, _b, _c = world
    _seed(a)
    r = _check(a, "Venkatesh Reddy")
    assert r["status"] == "clear" and "2 clients" in r["headline"] and "2 cases" in r["headline"]
    assert any("Indian scripts" in l for l in r["limits"])


def test_each_firm_only_ever_sees_its_own_records(world):
    _f, a, b, c = world
    _seed(a)
    rb = _check(b, "Kumar Traders", ["Sundaram Agencies"])
    assert rb["status"] == "no_records" and rb["searched"]["clients"] == 0       # firm B cannot see firm A's clients or cases
    r = c.post("/api/practice/conflicts/check", json={"client_name": "x"})
    assert r.status_code == 403 and r.get_json()["code"] == "NO_FIRM"            # no practice yet: a plain message, not a crash


def test_inputs_are_validated_and_errors_are_plain(world):
    _f, a, _b, _c = world
    assert a.post("/api/practice/conflicts/check", json={}).status_code == 400
    assert a.post("/api/practice/conflicts/check", json={"client_name": "x" * 500}).status_code == 400
    assert a.post("/api/practice/conflicts/check", json={"client_name": "x", "opposing_names": "not a list"}).status_code == 400
    assert a.post("/api/practice/conflicts/check", json=[1]).status_code == 400
    assert a.post("/api/practice/conflicts/check", json={"client_name": "x", "opposing_names": [f"n{i}" for i in range(50)]}).status_code == 200


def test_each_check_is_written_to_the_firm_audit_trail(world):
    _f, a, _b, _c = world
    _seed(a)
    _check(a, "Kumar Traders")
    audit = a.get("/api/practice/audit")
    assert audit.status_code == 200
    assert "conflict_check" in str(audit.get_json())


def test_the_older_conflict_screen_answers_from_real_records_too(world):
    _f, a, b, c = world
    _seed(a)
    r = a.post("/api/conflict/check", json={"entity_name": "Kumar Traders", "matter_type": "Criminal"}).get_json()
    assert r["status"] == "High Conflict" and any("Kumar Traders" in x["excerpt"] for x in r["results"])
    assert a.post("/api/conflict/check", json={"entity_name": "Rajesh Sharma"}).get_json()["status"] == "Clear"
    assert b.post("/api/conflict/check", json={"entity_name": "Kumar Traders"}).get_json()["status"] == "No Records"
    nofirm = c.post("/api/conflict/check", json={"entity_name": "x"})
    assert nofirm.status_code == 403 and "message" in nofirm.get_json()
    assert a.post("/api/conflict/check", json={"entity_name": ""}).status_code == 400


def test_the_global_vault_file_routes_are_gone(world):
    _f, a, _b, _c = world
    assert a.get("/api/contract/vault").status_code in (404, 405)
    assert a.post("/api/contract/save", json={"case_id": "x", "title": "t"}).status_code in (404, 405)
