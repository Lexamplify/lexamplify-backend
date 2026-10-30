"""A hearing request is checked before the diary is compared with what is already booked.

Why this file exists: the request can be wrong in two ways at once - the time is not a time ("25:99"),
and the day already has a hearing for that case. Only one answer can be right, and it must be the same
answer on every day of the year:

  - a malformed time is a bad request (400) whatever the diary looks like - the user must be told that
    "25:99" is not a time, not that the case is busy;
  - a well-formed request for a day that is already booked is still a clash (409).

The order in the code (routes/lpms_cases.py: make_hearing) is what makes this true, so these tests pin
the order down. They use the real Practice blueprint on a throw-away database (see conftest.py).
"""
from datetime import timedelta

from utils import lpms_store as L


def today():
    return L.today_ist()


def iso(days=0):
    return (today() + timedelta(days=days)).isoformat()


def make_case(p, **kw):
    body = {"case_no": kw.pop("case_no", "CS 10/2026"), "court": kw.pop("court", "Saket District Court"),
            "title": kw.pop("title", "Sharma v. Verma"), "case_type": kw.pop("case_type", "Civil")}
    body.update(kw)
    return p.ok(p.post("/cases", body), 201)["case"]


def test_a_malformed_time_is_a_bad_request_even_on_a_day_that_is_already_booked(firm):
    asha = firm.team["asha"]
    case = make_case(asha, case_no="HV 1/2026", title="Validation Case One")
    day = iso(1)

    booked = asha.ok(asha.post(f"/cases/{case['id']}/hearings", {"date": day, "time": "10:30"}), 201)
    assert booked["hearing"]["hearing_date"] == day

    # the same day, but the time is not a time: the user is told what is wrong with the time
    r = asha.post(f"/cases/{case['id']}/hearings", {"date": day, "time": "25:99"})
    assert r.status_code == 400, r.get_json()
    assert "10:30" in r.get_json()["message"], r.get_json()

    # ... and nothing was booked by the refused request
    assert len(asha.ok(asha.get(f"/cases/{case['id']}"))["case"]["hearings"]) == 1


def test_a_malformed_time_is_a_bad_request_on_a_free_day_too(firm):
    asha = firm.team["asha"]
    case = make_case(asha, case_no="HV 2/2026", title="Validation Case Two")
    r = asha.post(f"/cases/{case['id']}/hearings", {"date": iso(2), "time": "99:99"})
    assert r.status_code == 400, r.get_json()
    assert "10:30" in r.get_json()["message"], r.get_json()


def test_a_well_formed_request_for_a_day_that_is_already_booked_is_still_a_clash(firm):
    asha = firm.team["asha"]
    case = make_case(asha, case_no="HV 3/2026", title="Validation Case Three")
    day = iso(3)
    asha.ok(asha.post(f"/cases/{case['id']}/hearings", {"date": day, "time": "10:30"}), 201)

    # a good time, but the case already has a hearing that day -> the clash rule still answers 409
    r = asha.post(f"/cases/{case['id']}/hearings", {"date": day, "time": "16:45"})
    assert r.status_code == 409, r.get_json()
    assert r.get_json().get("code") == "DUPLICATE_HEARING", r.get_json()

    # ... and only one hearing was ever booked for that day
    assert len(asha.ok(asha.get(f"/cases/{case['id']}"))["case"]["hearings"]) == 1


def test_a_malformed_date_is_still_a_bad_request(firm):
    asha = firm.team["asha"]
    case = make_case(asha, case_no="HV 4/2026", title="Validation Case Four")
    r = asha.post(f"/cases/{case['id']}/hearings", {"date": "not-a-date", "time": "25:99"})
    assert r.status_code == 400, r.get_json()
