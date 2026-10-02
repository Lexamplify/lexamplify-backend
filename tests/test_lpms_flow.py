"""
Practice (LPMS): the firm, the team, roles, cases, hearings, daily proceedings and the timeline.
Real blueprint, real JWT, throw-away SQLite file (see conftest.PracticeHarness / the `firm` fixture).
"""
from datetime import timedelta

from utils import lpms_store as L


def today():
    return L.today_ist()


def iso(days=0):
    return (today() + timedelta(days=days)).isoformat()


def make_case(p, advocate=None, **kw):
    body = {"case_no": kw.pop("case_no", "CS 10/2026"), "court": kw.pop("court", "Saket District Court"), "title": kw.pop("title", "Sharma v. Verma"),
            "case_type": kw.pop("case_type", "Civil")}
    if advocate is not None:
        body["advocate_id"] = advocate
    body.update(kw)
    return p.ok(p.post("/cases", body), 201)["case"]


# ── firm & team ─────────────────────────────────────────────────────────────────────
def test_nobody_gets_in_without_a_practice(practice):
    p = practice.person("Solo Lawyer")
    me = p.ok(p.get("/me"))
    assert me["member"] is None and me["meta"]["case_types"]
    r = p.get("/cases")
    assert r.status_code == 403 and r.get_json()["code"] == "NO_FIRM"
    assert practice.app.test_client().get("/api/practice/me").status_code == 401


def test_creating_a_practice_makes_you_the_senior_advocate_once(practice):
    p = practice.person("Asha Rao")
    me = p.ok(p.post("/firm", {"name": "Rao & Associates"}), 201)
    assert me["member"]["role"] == "senior" and me["firm"]["name"] == "Rao & Associates" and me["perms"]["manage_team"]
    assert p.post("/firm", {"name": "Second"}).status_code == 409
    q = practice.person("Nameless")
    assert q.post("/firm", {"name": " "}).status_code == 400


def test_senior_adds_team_members_and_they_are_real_accounts(firm):
    t = firm.team
    members = t["asha"].ok(t["asha"].get("/members"))["members"]
    assert {m["name"]: m["role"] for m in members} == {"Asha Rao": "senior", "Ravi Nair": "junior", "Meena Das": "staff", "Kiran Shah": "junior"}
    assert any(u["email"] == "ravi@example.com" for u in firm.users.values())
    # validation
    r = t["asha"].post("/members", {"name": "X", "email": "bad", "password": "TempPass123!"})
    assert r.status_code == 400
    r = t["asha"].post("/members", {"name": "X", "email": "x@example.com", "password": "short"})
    assert r.status_code == 400 and "8 characters" in r.get_json()["message"]
    # an existing account is not silently taken over: the senior is told, and must confirm to link it
    other = firm.person("Existing Lawyer", "existing@example.com")
    r = t["asha"].post("/members", {"email": "existing@example.com", "role": "junior"})
    assert r.status_code == 409 and r.get_json()["code"] == "EXISTS"
    ok = t["asha"].ok(t["asha"].post("/members", {"email": "existing@example.com", "role": "junior", "link_existing": True}), 201)
    assert ok["managed"] is False
    # ... and a linked (not firm-created) account's password is theirs alone
    r = t["asha"].post(f"/members/{ok['member']['id']}/password", {"password": "NewPass12345"})
    assert r.status_code == 403
    assert other.ok(other.get("/me"))["member"]["role"] == "junior"
    # a created account's password can be reset by the senior, juniors cannot
    rid = t["ravi"].member_id
    t["asha"].ok(t["asha"].post(f"/members/{rid}/password", {"password": "BrandNew12345"}))
    assert firm.passwords[t["ravi"].uid] == "BrandNew12345"
    assert t["ravi"].post(f"/members/{rid}/password", {"password": "Another12345"}).status_code == 403
    assert t["ravi"].post("/members", {"name": "Y", "email": "y@example.com", "password": "TempPass123!"}).status_code == 403


def test_a_practice_always_keeps_a_senior_advocate(firm):
    t = firm.team
    me = t["asha"].member_id
    assert t["asha"].patch(f"/members/{me}", {"role": "junior"}).status_code == 409
    assert t["asha"].patch(f"/members/{me}", {"active": False}).status_code == 409
    assert t["asha"].post("/members/leave").status_code == 409
    # promote Ravi, and now Asha may step down
    t["asha"].ok(t["asha"].patch(f"/members/{t['ravi'].member_id}", {"role": "senior"}))
    t["asha"].ok(t["asha"].patch(f"/members/{me}", {"role": "junior"}))
    assert t["ravi"].ok(t["ravi"].get("/me"))["perms"]["manage_team"] is True
    assert t["asha"].ok(t["asha"].get("/me"))["perms"]["manage_team"] is False


def test_deactivated_member_loses_access_and_cases_are_flagged(firm):
    t = firm.team
    make_case(t["asha"], advocate=t["kiran"].member_id)
    r = t["asha"].ok(t["asha"].patch(f"/members/{t['kiran'].member_id}", {"active": False}))
    assert r["orphaned_cases"] == 1
    assert t["kiran"].get("/cases").status_code == 403
    assert t["kiran"].ok(t["kiran"].get("/me"))["member"] is None


# ── cases ───────────────────────────────────────────────────────────────────────────
def test_case_create_validation_and_duplicate_detection(firm):
    a = firm.team["asha"]
    assert a.post("/cases", {"court": "X", "title": "No number"}).status_code == 400
    assert a.post("/cases", {"case_no": "A 1", "court": "X", "title": "t", "case_type": "Spaceship"}).status_code == 400
    assert a.post("/cases", {"case_no": "A 1", "court": "X", "title": "t", "filing_date": "31-12-2026"}).status_code == 400
    c = make_case(a, case_no="W.P.(C) 55/2026", court="Delhi High Court")
    assert c["status"] == "Active" and c["advocate_id"] == a.member_id           # lead defaults to the creator
    # same number typed differently, same court -> refused unless forced
    r = a.post("/cases", {"case_no": "wpc 55 / 2026", "court": "delhi high court", "title": "Again"})
    assert r.status_code == 409 and r.get_json()["code"] == "DUPLICATE_CASE"
    a.ok(a.post("/cases", {"case_no": "wpc 55 / 2026", "court": "delhi high court", "title": "Again", "force": True}), 201)
    # a different court is a different case
    make_case(a, case_no="W.P.(C) 55/2026", court="Punjab and Haryana High Court", title="Other court")
    assert a.get("/cases?q=wpc55").get_json()["total"] == 3


def test_roles_on_cases(firm):
    t = firm.team
    a, ravi, kiran, meena = t["asha"], t["ravi"], t["kiran"], t["meena"]
    c = make_case(a, advocate=ravi.member_id)["id"]
    # everybody in the firm can SEE the firm-wide case
    for p in (ravi, kiran, meena):
        assert p.ok(p.get(f"/cases/{c}"))["case"]["title"] == "Sharma v. Verma"
    assert ravi.ok(ravi.get(f"/cases/{c}"))["case"]["level"] == "limited"
    assert kiran.ok(kiran.get(f"/cases/{c}"))["case"]["level"] is None
    assert meena.ok(meena.get(f"/cases/{c}"))["case"]["can"]["update"] is False
    # create: only the senior (juniors only if the firm allows it); staff never
    assert ravi.post("/cases", {"case_no": "J 1", "court": "X", "title": "t"}).status_code == 403
    assert meena.post("/cases", {"case_no": "J 1", "court": "X", "title": "t"}).status_code == 403
    a.ok(a.put("/settings", {"junior_create_cases": True}))
    mine = ravi.ok(ravi.post("/cases", {"case_no": "J 2", "court": "X", "title": "Mine"}), 201)["case"]
    assert mine["advocate_id"] == ravi.member_id
    assert ravi.post("/cases", {"case_no": "J 3", "court": "X", "title": "t", "advocate_id": kiran.member_id}).status_code == 403
    # edit: the assigned junior may update status / next action / remarks, nothing else
    r = ravi.ok(ravi.patch(f"/cases/{c}", {"next_action": "File rejoinder", "next_action_due": iso(5), "remarks": "Client to bring docs", "status": "Awaiting Orders"}))
    assert set(r["changed"]) == {"next_action", "next_action_due", "remarks", "status"}
    r = ravi.patch(f"/cases/{c}", {"title": "Hijacked"})
    assert r.status_code == 403 and "Senior Advocate" in r.get_json()["message"]
    assert ravi.patch(f"/cases/{c}", {"advocate_id": kiran.member_id}).status_code == 403
    # another junior cannot touch it, staff cannot either
    assert kiran.patch(f"/cases/{c}", {"remarks": "x"}).status_code == 403
    assert meena.patch(f"/cases/{c}", {"remarks": "x"}).status_code == 403
    # firm setting: juniors may update any case
    a.ok(a.put("/settings", {"junior_scope": "all"}))
    kiran.ok(kiran.patch(f"/cases/{c}", {"remarks": "Covering today"}))
    # senior can reassign, and the new advocate is told
    a.ok(a.patch(f"/cases/{c}", {"advocate_id": kiran.member_id}))
    assert any("assigned to you" in n["title"].lower() or "assigned" in n["title"].lower() for n in kiran.ok(kiran.get("/notifications"))["items"])
    # staff cannot be the lead advocate
    assert a.patch(f"/cases/{c}", {"advocate_id": meena.member_id}).status_code == 400


def test_closing_archiving_and_reopening(firm):
    a = firm.team["asha"]
    c = make_case(a)["id"]
    r = a.ok(a.patch(f"/cases/{c}", {"status": "Disposed", "outcome": "Decreed in favour of client"}))["case"]
    assert r["closed"] and r["closed_at"]
    a.ok(a.patch(f"/cases/{c}", {"status": "Active"}))
    assert a.ok(a.get(f"/cases/{c}"))["case"]["closed"] is False
    tl = [x["title"] for x in a.ok(a.get(f"/cases/{c}/timeline"))["items"]]
    assert any("reopened" in x for x in tl) and any("Status: Active → Disposed" in x for x in tl)
    # archive hides from the default list, blocks edits, and can be undone - senior only
    assert firm.team["ravi"].post(f"/cases/{c}/archive", {}).status_code == 403
    a.ok(a.post(f"/cases/{c}/archive", {"archive": True}))
    assert a.get("/cases").get_json()["total"] == 0 and a.get("/cases?archived=1").get_json()["total"] == 1
    r = a.patch(f"/cases/{c}", {"remarks": "x"})
    assert r.status_code == 409 and r.get_json()["code"] == "ARCHIVED"
    assert a.post(f"/cases/{c}/hearings", {"date": iso(3)}).status_code == 409
    a.ok(a.post(f"/cases/{c}/archive", {"archive": False}))
    a.ok(a.patch(f"/cases/{c}", {"remarks": "back"}))


def test_restricted_cases_are_invisible_to_everyone_else(firm):
    t = firm.team
    a, ravi, kiran, meena = t["asha"], t["ravi"], t["kiran"], t["meena"]
    secret = make_case(a, advocate=ravi.member_id, title="Confidential Merger", case_no="CS 99/2026", restricted=True,
                       client={"name": "Secret Client", "phone": "9000000001"})
    cid = secret["id"]
    a.ok(a.post(f"/cases/{cid}/hearings", {"date": iso(0)}), 201)
    assert ravi.ok(ravi.get(f"/cases/{cid}"))["case"]["id"] == cid                      # the lead sees it
    for p in (kiran, meena):
        assert p.get(f"/cases/{cid}").status_code == 404
        assert p.get("/cases").get_json()["total"] == 0
        assert p.get("/search?q=Confidential").get_json()["cases"] == []
        assert p.get("/hearings").get_json()["hearings"] == []
        assert p.get(f"/cases/{cid}/proceedings").status_code == 404
        assert p.ok(p.get("/dashboard"))["counts"]["active"] == 0
        assert p.ok(p.get("/reports/case_status"))["summary"][0]["value"] == 0
        assert p.get(f"/cases/{cid}/hearings", ).status_code in (404, 405)
        assert p.post(f"/cases/{cid}/hearings", {"date": iso(9)}).status_code == 404
    # only the senior can switch it on or off
    assert ravi.patch(f"/cases/{cid}", {"restricted": False}).status_code == 403
    a.ok(a.patch(f"/cases/{cid}", {"restricted": False}))
    assert kiran.ok(kiran.get(f"/cases/{cid}"))["case"]["title"] == "Confidential Merger"


def test_filters_search_and_sorting(firm):
    a = firm.team["asha"]
    ravi = firm.team["ravi"].member_id
    make_case(a, case_no="CRL.A. 5/2026", title="State v. Mehta", case_type="Criminal", court="Sessions Court", advocate=ravi, priority="urgent", category="Bail",
              opposite_party="State of Delhi")
    make_case(a, case_no="MACP 7/2026", title="Iyer Accident Claim", case_type="MCOP", court="MACT Dwarka", category="Motor accident", client={"name": "Lakshmi Iyer"})
    make_case(a, case_no="CC 9/2026", title="Consumer v. Bank", case_type="Consumer", court="District Commission", status="Stayed")
    lst = lambda q: a.ok(a.get("/cases?" + q))
    assert lst("case_type=Criminal")["total"] == 1
    assert lst("status=Stayed")["cases"][0]["case_no"] == "CC 9/2026"
    assert lst(f"advocate_id={ravi}")["total"] == 1
    assert lst("mine=1")["total"] == 2                                                   # the senior's own (the other two went to Asha by default)
    assert lst("priority=urgent")["total"] == 1
    assert lst("q=lakshmi")["total"] == 1                                               # by client
    assert lst("q=crla5")["total"] == 1                                                 # by case number, however typed
    assert lst("q=state of delhi")["total"] == 1                                        # by opposite party
    assert lst("q=ravi")["total"] == 1                                                  # by advocate
    assert lst("court=MACT Dwarka")["total"] == 1
    assert lst("category=Bail")["total"] == 1
    assert lst("sort=case_no")["cases"][0]["case_no"] == "CC 9/2026"
    assert lst("sort=priority")["cases"][0]["priority"] == "urgent"
    assert "Sessions Court" in lst("")["facets"]["courts"]
    # the global search finds people and parties too
    p = a.ok(a.post(f"/cases/{lst('q=crla5')['cases'][0]['id']}/parties", {"role": "witness", "name": "Inspector Bose"}), 201)
    s = a.ok(a.get("/search?q=bose"))
    assert s["parties"][0]["name"] == "Inspector Bose" and a.get("/search?q=a").get_json()["cases"] == []
    assert p["party"]["role"] == "witness"


# ── hearings, cause list, proceedings ───────────────────────────────────────────────
def test_hearings_cause_list_and_warnings(firm):
    t = firm.team
    a, ravi = t["asha"], t["ravi"]
    c1 = make_case(a, advocate=ravi.member_id, case_no="A 1/2026", title="Case One", court="Court 1")["id"]
    c2 = make_case(a, advocate=ravi.member_id, case_no="A 2/2026", title="Case Two", court="Court 1")["id"]
    # a Sunday gives a warning (not an error), a court holiday too
    sunday = next(today() + timedelta(days=i) for i in range(1, 8) if (today() + timedelta(days=i)).weekday() == 6)
    r = a.ok(a.post(f"/cases/{c1}/hearings", {"date": sunday.isoformat(), "time": "10:30", "hall_no": "4", "serial_no": "12", "purpose": "Arguments"}), 201)
    assert any("Sunday" in w for w in r["warnings"])
    a.ok(a.post("/events", {"kind": "holiday", "title": "Diwali", "start_date": iso(3)}), 201)
    r = a.ok(a.post(f"/cases/{c2}/hearings", {"date": iso(3), "time": "10:30"}), 201)
    assert any("Diwali" in w for w in r["warnings"])
    # same advocate, same minute, same day -> a clash warning
    r = a.ok(a.post(f"/cases/{c1}/hearings", {"date": iso(3), "time": "10:30"}), 201)
    assert any("already has" in w for w in r["warnings"])
    # one scheduled hearing per case per day
    assert a.post(f"/cases/{c1}/hearings", {"date": iso(3)}).status_code == 409
    assert a.post(f"/cases/{c1}/hearings", {"date": "not-a-date"}).status_code == 400
    assert a.post(f"/cases/{c1}/hearings", {"date": iso(4), "time": "25:99"}).status_code == 400
    cl = a.ok(a.get(f"/hearings?date={iso(3)}"))
    assert len(cl["hearings"]) == 2 and cl["holidays"][iso(3)] == "Diwali" and "Court 1" in cl["courts"]
    assert a.ok(a.get(f"/hearings?from={iso(0)}&to={iso(10)}"))["hearings"][0]["hearing_date"] <= iso(10)
    assert a.get("/hearings?from=2020-01-01&to=2026-12-31").status_code == 400
    assert len(a.ok(a.get(f"/hearings?date={iso(3)}&mine=1"))["hearings"]) == 0
    assert len(ravi.ok(ravi.get(f"/hearings?date={iso(3)}&mine=1"))["hearings"]) == 2
    # only the senior moves a hearing to another advocate
    hid = cl["hearings"][0]["id"]
    assert ravi.patch(f"/hearings/{hid}", {"advocate_id": t["kiran"].member_id}).status_code == 403
    a.ok(a.patch(f"/hearings/{hid}", {"advocate_id": t["kiran"].member_id}))
    # ... and then Kiran (covering) may update that hearing but not the others
    t["kiran"].ok(t["kiran"].patch(f"/hearings/{hid}", {"purpose": "Covering for Ravi"}))
    other = next(h["id"] for h in cl["hearings"] if h["id"] != hid)
    assert t["kiran"].patch(f"/hearings/{other}", {"purpose": "x"}).status_code == 403
    # reschedule is recorded on the timeline
    a.ok(a.patch(f"/hearings/{hid}", {"hearing_date": iso(6)}))
    assert any("moved from" in x["title"] for x in a.ok(a.get(f"/cases/{cl['hearings'][0]['case_id']}/timeline"))["items"])
    # delete only while nothing happened
    a.ok(a.delete(f"/hearings/{other}"))


def test_daily_proceeding_closes_the_hearing_and_schedules_the_next(firm):
    t = firm.team
    a, ravi, kiran = t["asha"], t["ravi"], t["kiran"]
    c = make_case(a, advocate=ravi.member_id, court="Tis Hazari Court", hall_no="7", judge="Hon. Sharma")["id"]
    h = a.ok(a.post(f"/cases/{c}/hearings", {"date": iso(0), "purpose": "Evidence"}), 201)["hearing"]
    assert a.post(f"/cases/{c}/proceedings", {}).status_code == 400
    assert kiran.post(f"/cases/{c}/proceedings", {"notes": "x"}).status_code == 403
    assert t["meena"].post(f"/cases/{c}/proceedings", {"notes": "x"}).status_code == 403
    assert ravi.post(f"/cases/{c}/proceedings", {"notes": "x", "proc_date": iso(5)}).status_code == 400      # cannot record the future
    assert ravi.post(f"/cases/{c}/proceedings", {"notes": "x", "next_date": iso(-5)}).status_code == 400    # next date not before the hearing
    r = ravi.ok(ravi.post(f"/cases/{c}/proceedings", {
        "notes": "Witness PW1 examined.", "observations": "Court noted delay by defence.", "orders": "Matter adjourned. Defence to pay costs of Rs 500.",
        "outcome": "adjourned", "next_date": iso(21), "next_purpose": "Cross-examination of PW1"}), 201)
    assert r["proceeding"]["hearing_id"] == h["id"] and r["next_hearing_id"]
    case = a.ok(a.get(f"/cases/{c}"))["case"]
    by_status = {x["id"]: x for x in case["hearings"]}
    assert by_status[h["id"]]["status"] == "adjourned" and by_status[r["next_hearing_id"]]["status"] == "scheduled"
    assert by_status[r["next_hearing_id"]]["hall_no"] == "7" and case["next_hearing"] == iso(21) and case["last_hearing"] == iso(0)
    assert case["counts"]["proceedings"] == 1
    # the timeline carries it, newest first, with who wrote it
    tl = a.ok(a.get(f"/cases/{c}/timeline"))["items"]
    assert tl[0]["kind"] in ("proceeding", "hearing") and any(x["kind"] == "proceeding" and "Adjourned" in x["title"] and x["actor"] == "Ravi Nair" for x in tl)
    # recording the same next date again reuses the hearing instead of duplicating it
    r2 = ravi.ok(ravi.post(f"/cases/{c}/proceedings", {"notes": "Mentioned again", "next_date": iso(21), "hearing_id": "none"}), 201)
    assert r2["next_hearing_id"] == r["next_hearing_id"]
    # the senior was told (the junior wrote it)
    assert any("Proceeding recorded" in n["title"] for n in a.ok(a.get("/notifications"))["items"])
    # only the author or a senior edits an entry, and the edit is audited with the old text
    pid = r["proceeding"]["id"]
    assert kiran.patch(f"/proceedings/{pid}", {"notes": "tampered"}).status_code == 403
    a.ok(a.patch(f"/proceedings/{pid}", {"orders": "Matter adjourned. Costs waived."}))
    log = a.ok(a.get("/audit?group=hearings"))["items"]
    edit = next(x for x in log if x["action"] == "proceeding_update")
    assert "Costs of Rs 500" not in str(edit["detail"]) and "Rs 500" in str(edit["detail"])
    # disposing a case from the proceeding
    r3 = ravi.ok(ravi.post(f"/cases/{c}/proceedings", {"orders": "Suit decreed.", "outcome": "disposed", "set_status": "Disposed", "hearing_id": "none"}), 201)
    assert r3["case"]["closed"] and r3["case"]["outcome"] == "Suit decreed."


def test_a_proceeding_without_hearing_id_finds_the_hearing_of_that_day(firm):
    a = firm.team["asha"]
    c = make_case(a)["id"]
    h = a.ok(a.post(f"/cases/{c}/hearings", {"date": iso(0)}), 201)["hearing"]
    r = a.ok(a.post(f"/cases/{c}/proceedings", {"notes": "Heard", "outcome": "heard"}), 201)
    assert r["proceeding"]["hearing_id"] == h["id"]
    assert a.ok(a.get(f"/hearings?date={iso(0)}"))["hearings"][0]["status"] == "heard"


def test_team_notes_parties_followups_and_comm_log(firm):
    t = firm.team
    a, ravi, kiran = t["asha"], t["ravi"], t["kiran"]
    c = make_case(a, advocate=ravi.member_id, client={"name": "Client C", "phone": "9811111111", "email": "c@client.in"})["id"]
    # notes: everyone who can see the case may add one; only author/senior edits
    n = kiran.ok(kiran.post(f"/cases/{c}/notes", {"body": "Remember the affidavit"}), 201)["note"]
    assert ravi.patch(f"/notes/{n['id']}", {"body": "x"}).status_code == 403
    a.ok(a.patch(f"/notes/{n['id']}", {"pinned": True}))
    assert a.ok(a.get(f"/cases/{c}/notes"))["notes"][0]["pinned"] is True
    kiran.ok(kiran.delete(f"/notes/{n['id']}"))
    # firm-wide board
    a.ok(a.post("/notes", {"body": "Office closed Friday"}), 201)
    assert t["meena"].ok(t["meena"].get("/notes"))["notes"][0]["body"] == "Office closed Friday"
    # parties
    p = ravi.ok(ravi.post(f"/cases/{c}/parties", {"role": "respondent", "name": "XYZ Ltd", "contact": "legal@xyz.com"}), 201)["party"]
    assert kiran.patch(f"/parties/{p['id']}", {"name": "Z"}).status_code == 403
    ravi.ok(ravi.patch(f"/parties/{p['id']}", {"name": "XYZ Pvt Ltd"}))
    assert ravi.post(f"/cases/{c}/parties", {"role": "nonsense", "name": "A"}).status_code == 400
    # follow-ups drive the pending list
    f = t["meena"].ok(t["meena"].post("/followups", {"case_id": c, "due_date": iso(-1), "note": "Ask for original agreement"}), 201)["followup"]
    assert f["overdue"] is True and f["client_name"] == "Client C"
    pend = a.ok(a.get("/dashboard"))["pending"]
    assert any(x["kind"] == "followup" for x in pend)
    t["meena"].ok(t["meena"].patch(f"/followups/{f['id']}", {"status": "done"}))
    assert a.ok(a.get("/followups"))["followups"] == []
    # logging a phone call lands in the client's history and on the case timeline
    a.ok(a.post("/comms", {"case_id": c, "channel": "call", "body": "Client agreed to settle at 5 lakh"}), 201)
    assert a.ok(a.get(f"/comms?case_id={c}"))["comms"][0]["channel"] == "call"
    assert any("Client contact logged" in x["title"] for x in a.ok(a.get(f"/cases/{c}/timeline"))["items"])
