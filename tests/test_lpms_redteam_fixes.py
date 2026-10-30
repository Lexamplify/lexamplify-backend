"""Regression tests for the red-team findings (restricted-case leaks, password/MFA takeover, two-step fail-open, unicode case numbers, input hardening, audit gaps)."""
from conftest import ORDER_TEXT, make_pdf
from test_lpms_documents import wait
from test_lpms_flow import iso, make_case
from utils import lpms_store as L


# ── 1. restricted cases ─────────────────────────────────────────────────────────────
def test_restricted_case_side_records_do_not_leak(firm):
    t = firm.team
    a, ravi, kiran, meena = t["asha"], t["ravi"], t["kiran"], t["meena"]
    cid = make_case(a, advocate=ravi.member_id, case_no="CS 77/2026")["id"]
    client = a.ok(a.post("/clients", {"name": "Hush Client", "phone": "9876500001"}), 201)["client"]["id"]
    a.ok(a.post("/followups", {"case_id": cid, "client_id": client, "due_date": iso(0), "note": "SECRETNOTE call"}), 201)
    a.ok(a.post("/rti", {"subject": "Zebrafish files", "department": "Dept X", "case_id": cid, "status": "filed", "filing_date": iso(-29)}), 201)
    a.ok(a.post("/events", {"title": "Sealed meeting", "start_date": iso(1), "case_id": cid}), 201)
    a.ok(a.patch(f"/cases/{cid}", {"restricted": True}))
    rng = f"/calendar?from={iso(-2)}&to={iso(10)}"
    for p in (kiran, meena):
        dash = p.ok(p.get("/dashboard"))
        assert "SECRETNOTE" not in str(dash) and "Zebrafish" not in str(dash)
        assert dash["counts"]["rti_open"] == 0
        cal = str(p.ok(p.get(rng)))
        assert "Sealed meeting" not in cal and "Zebrafish" not in cal and "SECRETNOTE" not in cal
        assert p.ok(p.get("/search?q=zebrafish"))["rti"] == []
        cl = [x for x in p.ok(p.get("/clients"))["clients"] if x["id"] == client][0]
        assert cl["open_followups"] == 0
    # people on the case, and seniors, still see everything
    for p in (a, ravi):
        assert "SECRETNOTE" in str(p.ok(p.get("/dashboard")))
        cal = str(p.ok(p.get(rng)))
        assert "Sealed meeting" in cal and "Zebrafish" in cal
        assert len(p.ok(p.get("/search?q=zebrafish"))["rti"]) == 1
        assert [x for x in p.ok(p.get("/clients"))["clients"] if x["id"] == client][0]["open_followups"] == 1
    # an RTI / follow-up with no case stays visible to everyone
    a.ok(a.post("/rti", {"subject": "Plain request", "department": "Dept Y", "status": "filed", "filing_date": iso(-29)}), 201)
    assert len(kiran.ok(kiran.get("/search?q=plain request"))["rti"]) == 1


def test_uploader_loses_a_case_document_once_the_case_is_restricted(firm):
    t = firm.team
    a, ravi, meena = t["asha"], t["ravi"], t["meena"]
    cid = make_case(a, advocate=ravi.member_id, case_no="CS 78/2026")["id"]
    did = meena.upload("m.pdf", make_pdf([ORDER_TEXT + "\nstaff narwhal"]), lpms_case_id=cid).get_json()["doc"]["id"]
    wait(meena, did)
    assert meena.ok(meena.get("/api/dms/docs?q=narwhal"))["total"] == 1
    a.ok(a.patch(f"/cases/{cid}", {"restricted": True}))
    assert meena.ok(meena.get("/api/dms/docs?q=narwhal"))["total"] == 0
    assert meena.get(f"/api/dms/docs/{did}").status_code == 404 and meena.get(f"/api/dms/docs/{did}/download").status_code == 404
    assert ravi.ok(ravi.get("/api/dms/docs?q=narwhal"))["total"] == 1 and a.ok(a.get("/api/dms/docs?q=narwhal"))["total"] == 1
    a.ok(a.patch(f"/cases/{cid}", {"restricted": False}))
    assert meena.ok(meena.get("/api/dms/docs?q=narwhal"))["total"] == 1


# ── 2. password / two-step reset only for people who are still ours ─────────────────────
def test_password_and_mfa_reset_need_a_current_member_of_this_firm(firm, practice):
    t = firm.team
    a, ravi, kiran = t["asha"], t["ravi"], t["kiran"]
    # works for a current managed member (unchanged behaviour)
    a.ok(a.post(f"/members/{kiran.member_id}/password", {"password": "BrandNew12345"}))
    a.ok(a.post(f"/members/{kiran.member_id}/mfa-reset"))
    # Ravi is removed, then another practice links his account
    a.ok(a.patch(f"/members/{ravi.member_id}", {"active": False}))
    assert a.post(f"/members/{ravi.member_id}/password", {"password": "Takeover12345"}).status_code == 403
    assert a.post(f"/members/{ravi.member_id}/mfa-reset").status_code == 403
    boss = practice.person("Other Boss")
    boss.ok(boss.post("/firm", {"name": "Other Firm"}), 201)
    boss.ok(boss.post("/members", {"email": "ravi@example.com", "role": "junior", "link_existing": True}), 201)
    before = dict(practice.passwords)
    assert a.post(f"/members/{ravi.member_id}/password", {"password": "Takeover12345"}).status_code == 403
    assert a.post(f"/members/{ravi.member_id}/mfa-reset").status_code == 403
    assert practice.passwords == before


# ── 3. two-step sign-in must not fail open ──────────────────────────────────────────────
import pytest  # noqa: E402
from test_lpms_real_app import Browser, fresh_allowances, real  # noqa: E402,F401


def _mfa_user(flask_app, name):
    b = Browser(flask_app, name=name)
    b.ok(b.send("post", "/firm", {"name": name + " Chambers"}), 201)
    secret = b.ok(b.send("post", "/mfa/setup"))["secret"].replace(" ", "")
    b.ok(b.send("post", "/mfa/enable", {"code": L.totp_at(secret)}))
    return b, secret


def test_login_is_denied_when_the_mfa_secret_cannot_be_read(real, monkeypatch):
    import time
    flask_app, _ = real
    b, secret = _mfa_user(flask_app, "Key Break")
    plain = Browser(flask_app)
    code = L._hotp(secret, int(time.time() // 30) + 1)
    monkeypatch.setenv("LPMS_SECRET_KEY", "a-completely-different-key")          # the stored secret no longer decrypts
    fresh = Browser(flask_app, email=b.email, register=False)
    r = fresh.login(otp=code)
    assert r.status_code in (401, 503) and r.get_json()["code"] == "MFA_UNAVAILABLE" and "administrator" in r.get_json()["error"]
    assert fresh.c.get_cookie("access_token_cookie") is None
    assert plain.login().status_code == 200                                      # nobody else is affected
    monkeypatch.delenv("LPMS_SECRET_KEY")
    r = Browser(flask_app, email=b.email, register=False).login(otp=L._hotp(secret, int(time.time() // 30) + 1))
    assert r.status_code == 200                                                  # key restored -> works again


def test_login_gate_exceptions_only_let_through_people_without_two_step(real, monkeypatch):
    flask_app, _ = real
    b, secret = _mfa_user(flask_app, "Gate Break")
    plain = Browser(flask_app)

    def boom(user, otp):
        raise RuntimeError("gate exploded")
    monkeypatch.setitem(flask_app.extensions, "lpms_login_gate", boom)
    r = Browser(flask_app, email=b.email, register=False).login()
    assert r.status_code == 401 and r.get_json()["code"] == "MFA_UNAVAILABLE"
    assert plain.login().status_code == 200                                      # no two-step: signs in exactly as before
    # if we cannot even tell whether two-step is on, the answer is no
    monkeypatch.setitem(flask_app.extensions, "lpms_mfa_probe", boom)
    assert Browser(flask_app, email=plain.email, register=False).login().status_code == 401


def test_sso_refuses_accounts_with_two_step(real, monkeypatch):
    from routes import sso_routes
    flask_app, _ = real
    b, _s = _mfa_user(flask_app, "Sso Mfa")
    plain = Browser(flask_app)

    class Fake:
        _clients = {"google": 1}

        class google:
            email = None

            @classmethod
            def authorize_access_token(cls):
                return {"userinfo": {"email": cls.email, "name": "X"}}
    monkeypatch.setattr(sso_routes, "oauth", Fake)
    for who, blocked in ((b, True), (plain, False)):
        Fake.google.email = who.email
        monkeypatch.setattr(sso_routes, "_find_or_create_sso_user", lambda e, n, who=who: who.uid)
        r = flask_app.test_client().get("/api/auth/sso/google/callback")
        assert r.status_code == 302
        if blocked:
            assert "sso_error=mfa_required" in r.headers["Location"] and "password" in r.headers["Location"] and not r.headers.getlist("Set-Cookie")
        else:
            assert "sso_error" not in r.headers["Location"] and r.headers.getlist("Set-Cookie")


# ── 4. case numbers in other scripts ─────────────────────────────────────────────────────
def test_norm_key_ascii_is_unchanged_and_other_scripts_are_kept():
    import re
    for raw in ("WP(C) 1234 / 2023", "wpc-1234-2023", "CS 10/2026", "  A.B.C 7 ", "", None, "///", "O.S.No.12 of 2019"):
        assert L.norm_key(raw) == re.sub(r"[^0-9a-z]+", "", (raw or "").lower())          # byte-for-byte what it always was
    assert L.norm_key("WP(C) 1234 / 2023") == "wpc12342023"
    assert L.norm_key("வ.எண் 12/2026") and L.norm_key("वाद संख्या 12/2026") and L.norm_key("வ.எண் 12/2026") != L.norm_key("வ.எண் 13/2026")
    assert L.case_key("WP(C) 1234 / 2023") == "wpc12342023"
    assert L.case_key("///") != L.case_key("---") and L.case_key("///") == L.case_key(" /// ") and L.case_key("///").startswith("~")


def test_unicode_case_numbers_do_not_collide(firm):
    a = firm.team["asha"]
    court = "சென்னை உயர் நீதிமன்றம்"
    c1 = make_case(a, case_no="வ.எண் 12/2026", court=court, title="One")
    r = a.post("/cases", {"case_no": "வ.எண் 13/2026", "court": court, "title": "Two"})
    assert r.status_code == 201, r.get_json()
    r = a.post("/cases", {"case_no": "வ.எண் 12/2026", "court": court, "title": "Again"})
    assert r.status_code == 409 and r.get_json()["code"] == "DUPLICATE_CASE"
    h1 = make_case(a, case_no="वाद 5/2026", court="Delhi", title="Hindi")
    assert a.post("/cases", {"case_no": "वाद 6/2026", "court": "Delhi", "title": "Hindi 2"}).status_code == 201
    # punctuation-only numbers: different ones coexist, the same one twice is still a duplicate, nothing is a 500
    assert a.post("/cases", {"case_no": "///", "court": "Delhi", "title": "Odd 1"}).status_code == 201
    assert a.post("/cases", {"case_no": "---", "court": "Delhi", "title": "Odd 2"}).status_code == 201
    assert a.post("/cases", {"case_no": "///", "court": "Delhi", "title": "Odd 3"}).status_code == 409
    assert a.post("/cases", {"case_no": "   ", "court": "Delhi", "title": "Empty"}).status_code == 400
    assert a.post("/cases", {"court": "Delhi", "title": "Missing"}).status_code == 400
    # renaming a case to an existing Tamil number is still caught, and search finds Tamil numbers
    other = make_case(a, case_no="வ.எண் 99/2026", court=court, title="Three")
    assert a.patch(f"/cases/{other['id']}", {"case_no": "வ.எண் 12/2026"}).status_code == 409
    assert a.ok(a.get("/cases?q=" + "வ.எண் 13/2026"))["total"] >= 1
    assert c1["id"] and h1["id"]


# ── 5. input hardening ───────────────────────────────────────────────────────────────────
def test_non_object_json_bodies_are_400_not_500(firm):
    a = firm.team["asha"]
    for url in ("/cases", "/clients", "/events", "/notes", "/rti", "/followups", "/members"):
        for body in ([1], "x", 5, [], True):
            r = a._req("post", url, json=body)
            assert r.status_code == 400 and r.get_json()["error"] is True, (url, body, r.status_code)
    assert a._req("patch", "/me", json=[1]).status_code == 400
    assert a._req("put", "/settings", json="x").status_code == 400


def test_settings_validation(firm):
    a = firm.team["asha"]
    for body in ({"reminder_days": ["a", 3]}, {"reminder_days": 5}, {"reminder_days": {"x": 1}}, {"reminder_days": [[1]]}, {"reminder_days": [99]},
                 {"ip_allow": 5}, {"ip_allow": {"a": 1}}, {"ip_allow": [1, 2]}, {"ip_allow": [["x"]], "ip_enabled": True}):
        r = a.put("/settings", body)
        assert r.status_code == 400 and r.get_json()["error"] is True, (body, r.status_code)
    a.ok(a.put("/settings", {"reminder_days": [7, "3", 1]}))
    assert a.ok(a.get("/settings"))["reminder_days"] == [7, 3, 1]
    a.ok(a.put("/settings", {"reminder_days": None}))


def test_page_and_date_extremes(firm):
    a = firm.team["asha"]
    for url in ("/cases", "/clients", "/audit"):
        r = a.get(url + "?page=99999999999999999999999")
        assert r.status_code == 200, (url, r.status_code)
        assert a.get(url + "?page=9223372036854775807&per_page=200").status_code == 200
    r = a.post("/rti", {"subject": "S", "department": "D", "status": "filed", "filing_date": "9999-12-31"})
    assert r.status_code == 400
    assert a.get("/reports/upcoming_hearings?from=9999-12-30").status_code == 400
    assert a.get("/reports/upcoming_hearings?to=9999-12-30").status_code == 400
    assert a.get("/reports/upcoming_hearings?from=1000-01-01").status_code == 400
    assert a.post("/events", {"title": "far", "start_date": "9999-12-31"}).status_code == 400
    assert a.get("/reports/upcoming_hearings?from=2026-10-01").status_code == 200


def test_dates_are_strict_but_every_real_format_still_parses():
    import datetime
    for ok in ("2026-11-03", " 2026-11-03 ", "2026-11-03T10:30", "2026-11-03T10:30:00", "2026-11-03 10:30:00", "2026-11-03T10:30:00.123Z",
               "2026-11-03T10:30:00+05:30", "2026-11-03T10:30:00.123456+0530", datetime.date(2026, 11, 3), datetime.datetime(2026, 11, 3, 10, 30)):
        assert L.parse_date(ok) == datetime.date(2026, 11, 3), ok
    assert L.parse_date(None) is None and L.parse_date("") is None
    for bad in ("2026-11-03xyz", "2026-11-03 xyz", "2026-11-033", "x2026-11-03", "2026-13-01", "2026-02-30", "03-11-2026", "2026/11/03", "2026-11-03T", "20261103", "9999-12-31", "0001-01-01", "2026-11-03;DROP"):
        with pytest.raises(ValueError):
            L.parse_date(bad)


def test_strict_dates_over_the_api(firm):
    a = firm.team["asha"]
    assert a.post("/cases", {"case_no": "D 1", "court": "X", "title": "t", "filing_date": "2026-11-03xyz"}).status_code == 400
    assert a.post("/cases", {"case_no": "D 2", "court": "X", "title": "t", "filing_date": "2026-11-03"}).status_code == 201
    assert a.post("/events", {"title": "e", "start_date": "2026-11-03T10:00"}).status_code == 201


# ── 6. audit gaps ────────────────────────────────────────────────────────────────────────
def test_notes_and_followup_deletes_are_audited_and_the_chain_stays_valid(firm):
    a, ravi = firm.team["asha"], firm.team["ravi"]
    cid = make_case(a, advocate=ravi.member_id, case_no="CS 90/2026")["id"]
    n1 = ravi.ok(ravi.post(f"/cases/{cid}/notes", {"body": "first"}), 201)["note"]["id"]
    ravi.ok(ravi.patch(f"/notes/{n1}", {"body": "edited"}))
    ravi.ok(ravi.patch(f"/notes/{n1}", {"body": "edited"}))                           # no change: nothing to log
    ravi.ok(ravi.delete(f"/notes/{n1}"))
    n2 = a.ok(a.post("/notes", {"body": "firm-wide"}), 201)["note"]["id"]
    a.ok(a.patch(f"/notes/{n2}", {"pinned": True}))
    a.ok(a.delete(f"/notes/{n2}"))
    fu = a.ok(a.post("/followups", {"case_id": cid, "due_date": iso(1), "note": "call back"}), 201)["followup"]["id"]
    a.ok(a.delete(f"/followups/{fu}"))
    acts = [x["action"] for x in a.ok(a.get("/audit?per_page=200"))["items"]]
    for want, n in (("case_note_add", 1), ("case_note_update", 1), ("case_note_delete", 1), ("firm_note_add", 1), ("firm_note_update", 1),
                    ("firm_note_delete", 1), ("followup_create", 1), ("followup_delete", 1)):
        assert acts.count(want) == n, (want, acts.count(want))
    assert a.ok(a.get("/audit/verify"))["ok"] is True
    assert "case_note_add" in [x["action"] for x in a.ok(a.get("/audit?group=cases&per_page=200"))["items"]]


# ── 7. low items ─────────────────────────────────────────────────────────────────────────
def test_hearing_on_a_closed_case_and_same_day_next_date(firm):
    a = firm.team["asha"]
    cid = make_case(a, case_no="CS 91/2026")["id"]
    a.ok(a.patch(f"/cases/{cid}", {"status": "Disposed"}))
    r = a.post(f"/cases/{cid}/hearings", {"date": iso(5)})
    assert r.status_code == 409 and "Disposed" in r.get_json()["message"]
    a.ok(a.patch(f"/cases/{cid}", {"status": "Active"}))
    a.ok(a.post(f"/cases/{cid}/hearings", {"date": iso(5)}), 201)
    # a proceeding whose next date is its own day does not list a second hearing that day
    day = iso(0)
    a.ok(a.post(f"/cases/{cid}/hearings", {"date": day}), 201)
    r = a.ok(a.post(f"/cases/{cid}/proceedings", {"proc_date": day, "notes": "heard", "next_date": day}), 201)
    assert r["next_hearing_id"] is None and r["warnings"]
    assert sum(1 for h in a.ok(a.get(f"/cases/{cid}"))["case"]["hearings"] if h["hearing_date"] == day and h["status"] == "scheduled") == 0
    # a normal next date still creates the hearing
    r = a.ok(a.post(f"/cases/{cid}/proceedings", {"proc_date": day, "notes": "again", "hearing_id": "none", "next_date": iso(9)}), 201)
    assert r["next_hearing_id"]


def test_csv_guard_covers_tab_and_cr(firm):
    a = firm.team["asha"]
    me = a.ok(a.get("/me"))
    c = L.connect(firm.db_path)
    c.execute("BEGIN IMMEDIATE")
    for summary in ("\tcmd", "\rcmd", "=cmd", "plain text"):
        L.audit(c, me["firm"]["id"], a.uid, "Asha", "csv_probe", None, None, summary)
    c.commit()
    c.close()
    body = a.get("/audit/export.csv?action=csv_probe").data.decode("utf-8-sig")
    for want in ("'\tcmd", "'\rcmd", "'=cmd", ",plain text,"):
        assert want in body, want
