"""Practice (LPMS): two-step sign-in (TOTP), the IP allow-list, the firm-wide MFA rule, notifications and the reminder engine."""
import base64
import time
from datetime import timedelta

from test_lpms_flow import iso, make_case, today
from utils import lpms_store as L


def enrol(p, h):
    """Turn on two-step sign-in for a person the way the screen does; returns (secret, recovery_codes)."""
    s = p.ok(p.post("/mfa/setup"))
    secret = s["secret"].replace(" ", "")
    assert s["uri"].startswith("otpauth://totp/") and secret in s["uri"] and (s["qr"] is None or s["qr"].lstrip().startswith("<svg"))
    return secret, p.ok(p.post("/mfa/enable", {"code": L.totp_at(secret)}))["recovery_codes"]


# ── TOTP itself ─────────────────────────────────────────────────────────────────────
def test_totp_matches_the_rfc_6238_test_vectors():
    secret = base64.b32encode(b"12345678901234567890").decode()
    for t, expect in ((59, "287082"), (1111111109, "081804"), (1234567890, "005924"), (2000000000, "279037")):
        assert L._hotp(secret, t // 30) == expect
    assert L.totp_check(secret, "287082", t=59) == 1
    assert L.totp_check(secret, "287082", t=59 + 30) == 1          # one step of clock drift is fine
    assert L.totp_check(secret, "287082", t=59 + 300) is None
    assert L.totp_check(secret, "287082", last_step=1, t=59) is None   # a code is never accepted twice
    assert L.totp_check(secret, "12345", t=59) is None and L.totp_check(secret, "abcdef", t=59) is None


def test_whatsapp_numbers():
    assert L.whatsapp_url("98765 43210", "hi").startswith("https://wa.me/919876543210?text=hi")
    assert L.whatsapp_url("09876543210", "x").startswith("https://wa.me/919876543210")
    assert L.whatsapp_url("+44 20 7946 0958", "x").startswith("https://wa.me/442079460958")
    assert L.whatsapp_url("0044 20 7946 0958", "x").startswith("https://wa.me/442079460958")
    assert L.whatsapp_url("12345", "x") is None and L.whatsapp_url("", "x") is None


# ── two-step sign-in through the API and the login gate ─────────────────────────────
def test_enrolment_login_gate_recovery_codes_and_lockout(firm):
    a = firm.team["asha"]
    uid = a.uid
    assert L.login_gate(firm.db_path, uid, None) is None                                 # not on: nothing asked
    assert a.post("/mfa/enable", {"code": "123456"}).status_code == 409                  # must start the setup first
    a.ok(a.post("/mfa/setup"))
    r = a.post("/mfa/enable", {"code": "000000"})
    assert r.status_code == 400 and r.get_json()["code"] == "MFA_INVALID"
    s = a.ok(a.post("/mfa/setup"))["secret"].replace(" ", "")
    codes = a.ok(a.post("/mfa/enable", {"code": L.totp_at(s)}))["recovery_codes"]
    assert len(codes) == 8 and a.ok(a.get("/me"))["mfa"]["enabled"] is True and a.ok(a.get("/me"))["mfa"]["recovery_left"] == 8
    assert a.post("/mfa/setup").status_code == 409                                        # already on
    # the login route now asks for a code
    body, status = L.login_gate(firm.db_path, uid, None)
    assert status == 401 and body["code"] == "MFA_REQUIRED"
    body, status = L.login_gate(firm.db_path, uid, "000000")
    assert status == 401 and body["code"] == "MFA_INVALID"
    # a code that has been used cannot be replayed (the setup step already consumed this time step)
    assert L.login_gate(firm.db_path, uid, L.totp_at(s))[1] == 401
    # a code from the next window works
    nxt = L._hotp(s, int(time.time() // 30) + 1)
    assert L.login_gate(firm.db_path, uid, nxt) is None
    # a recovery code works exactly once
    assert L.login_gate(firm.db_path, uid, codes[0].lower()) is None
    assert L.login_gate(firm.db_path, uid, codes[0])[1] == 401
    assert a.ok(a.get("/me"))["mfa"]["recovery_left"] == 7
    # five wrong codes lock it for a while - even the right code is refused during the lock
    for _ in range(5):
        L.login_gate(firm.db_path, uid, "111111")
    body, status = L.login_gate(firm.db_path, uid, codes[1])
    assert status == 429 and body["code"] == "MFA_LOCKED"
    firm.sql("UPDATE lpms_mfa SET locked_until = 0 WHERE user_id = ?", uid)
    assert L.login_gate(firm.db_path, uid, codes[1]) is None
    # everything is on the audit log, including the wrong guesses
    acts = [x["action"] for x in a.ok(a.get("/audit?group=sign-in&per_page=100"))["items"]]
    assert {"mfa_enabled", "mfa_ok", "mfa_failed", "mfa_locked"} <= set(acts)
    # the secret is stored sealed, never in the clear
    stored = firm.sql("SELECT secret FROM lpms_mfa WHERE user_id = ?", uid)[0][0]
    assert s not in stored and stored[:2] in ("f:", "p:")
    # turning it off needs a valid code
    assert a.post("/mfa/disable", {"code": "000000"}).status_code == 400
    a.ok(a.post("/mfa/disable", {"code": codes[2]}))
    assert L.login_gate(firm.db_path, uid, None) is None


def test_senior_can_reset_a_lost_device(firm):
    t = firm.team
    secret, _ = enrol(t["ravi"], firm)
    assert L.login_gate(firm.db_path, t["ravi"].uid, None)[1] == 401
    assert t["kiran"].post(f"/members/{t['ravi'].member_id}/mfa-reset").status_code == 403
    t["asha"].ok(t["asha"].post(f"/members/{t['ravi'].member_id}/mfa-reset"))
    assert L.login_gate(firm.db_path, t["ravi"].uid, None) is None
    assert any(x["action"] == "mfa_reset" for x in t["asha"].ok(t["asha"].get("/audit"))["items"])


def test_login_history_is_recorded(firm):
    a = firm.team["asha"]
    L.login_event(firm.db_path, a.uid, None, True, None, "203.0.113.9", "Mozilla/5.0 (Test)")
    L.login_event(firm.db_path, a.uid, None, False, "Wrong password", "198.51.100.4", "curl/8")
    L.login_event(firm.db_path, 9999, None, True)                                          # a stranger with no practice: ignored, no crash
    mine = a.ok(a.get("/me/logins"))["items"]
    assert [x["action"] for x in mine][:2] == ["login_failed", "login"] and mine[0]["ip"] == "198.51.100.4"
    assert a.ok(a.get("/audit?group=sign-in"))["total"] >= 2


def test_firm_can_require_two_step_for_everyone(firm):
    t = firm.team
    a = t["asha"]
    r = a.put("/settings", {"mfa_required": True})
    assert r.status_code == 400 and r.get_json()["code"] == "MFA_SELF"                     # the senior must be enrolled first
    secret, _ = enrol(a, firm)
    a.ok(a.put("/settings", {"mfa_required": True}))
    # everybody else is stopped on every practice route until they set it up - but can reach the setup itself
    r = t["ravi"].get("/cases")
    assert r.status_code == 403 and r.get_json()["code"] == "MFA_SETUP"
    me = t["ravi"].ok(t["ravi"].get("/me"))
    assert me["mfa"]["pending"] is True and me["mfa"]["required"] is True
    enrol(t["ravi"], firm)
    assert t["ravi"].get("/cases").status_code == 200
    assert t["ravi"].post("/mfa/disable", {"code": "123456"}).status_code == 409           # cannot turn it off while required


# ── IP allow-list ───────────────────────────────────────────────────────────────────
def test_ip_allow_list_blocks_other_networks_and_never_locks_the_senior_out(firm):
    t = firm.team
    a = t["asha"]
    a.ip, a.env["REMOTE_ADDR"] = "203.0.113.10", "203.0.113.10"
    t["ravi"].env["REMOTE_ADDR"] = "198.51.100.77"
    assert a.put("/settings", {"ip_enabled": True, "ip_allow": ""}).status_code == 400                            # empty list
    assert a.put("/settings", {"ip_enabled": True, "ip_allow": ["not-an-ip"]}).status_code == 400
    r = a.put("/settings", {"ip_enabled": True, "ip_allow": ["198.51.100.0/24"]})                              # would lock herself out
    assert r.status_code == 400 and r.get_json()["code"] == "IP_SELF_LOCKOUT"
    a.ok(a.put("/settings", {"ip_enabled": True, "ip_allow": ["203.0.113.10", "198.51.100.0/24"]}))
    assert a.get("/cases").status_code == 200 and t["ravi"].get("/cases").status_code == 200
    # from an office elsewhere (kiran has another address), everything is refused with a clear reason...
    t["kiran"].env["REMOTE_ADDR"] = "192.0.2.55"
    r = t["kiran"].get("/cases")
    assert r.status_code == 403 and r.get_json()["code"] == "IP_BLOCKED" and r.get_json()["ip"] == "192.0.2.55"
    assert t["kiran"].get("/dashboard").status_code == 403 and t["kiran"].post("/cases", {}).status_code == 403
    me = t["kiran"].ok(t["kiran"].get("/me"))
    assert me["blocked"] == "ip" and me["ip"] == "192.0.2.55"
    # ... a senior on the wrong network can still open Settings to fix the list, but nothing else
    a.env["REMOTE_ADDR"] = "192.0.2.99"
    assert a.get("/cases").status_code == 403
    assert a.get("/settings").status_code == 200
    a.env["REMOTE_ADDR"] = "203.0.113.10"
    a.ok(a.put("/settings", {"ip_enabled": False}))
    assert t["kiran"].get("/cases").status_code == 200


# ── notifications ───────────────────────────────────────────────────────────────────
def test_notification_basics_and_settings(firm):
    t = firm.team
    a, ravi = t["asha"], t["ravi"]
    make_case(a, advocate=ravi.member_id, title="Assigned Case")
    n = ravi.ok(ravi.get("/notifications"))
    assert n["unread"] >= 1 and any("assigned" in x["title"].lower() for x in n["items"])
    first = n["items"][0]["id"]
    ravi.ok(ravi.post(f"/notifications/{first}/read"))
    assert ravi.ok(ravi.get("/notifications?unread=1"))["unread"] == n["unread"] - 1
    assert a.post(f"/notifications/{first}/read").status_code == 200 and ravi.ok(ravi.get("/notifications"))["unread"] == n["unread"] - 1  # someone else's: untouched
    ravi.ok(ravi.post("/notifications/read-all"))
    assert ravi.ok(ravi.get("/notifications"))["unread"] == 0
    # the senior's settings are validated
    assert a.put("/settings", {"reminder_days": [4]}).status_code == 400
    assert a.put("/settings", {"recipients": "everyone"}).status_code == 400
    assert ravi.put("/settings", {"reminder_days": [1]}).status_code == 403
    s = a.ok(a.put("/settings", {"reminder_days": [7, 1, 0], "channels": {"email": False}, "firm_name": "Rao Chambers"}))
    assert s["reminder_days"] == [7, 1, 0] and s["channels"]["email"] is False and a.ok(a.get("/me"))["firm"]["name"] == "Rao Chambers"
    assert "outbox" not in ravi.ok(ravi.get("/settings"))                                    # senior-only details
    # a member can mute their own e-mails
    ravi.ok(ravi.patch("/me", {"email_notify": False}))
    assert ravi.ok(ravi.get("/me"))["member"]["email_notify"] is False


def hearing_on(h, case_id, days, **kw):
    return h.team["asha"].ok(h.team["asha"].post(f"/cases/{case_id}/hearings", {"date": iso(days), **kw}), 201)["hearing"]


def run(h):
    c = L.connect(h.db_path)
    try:
        c.execute("BEGIN IMMEDIATE")
        counts = L.run_reminders(c, 1)
        c.commit()
    finally:
        c.close()
    if h.mail_ok:
        L.flush_outbox(h.db_path, h.lpms.env.send_email)           # what the background sweep does right after
    return counts


def titles(p, kind="hearing_reminder"):
    return [n["title"] for n in p.ok(p.get("/notifications?limit=100"))["items"] if n["kind"] == kind]


def test_reminders_fire_once_per_window_7_3_1_0(firm):
    t = firm.team
    a, ravi = t["asha"], t["ravi"]
    firm.mail_ok = True
    c = make_case(a, advocate=ravi.member_id, title="Window Matter")["id"]
    far = hearing_on(firm, c, 20)
    seven = hearing_on(firm, make_case(a, advocate=ravi.member_id, case_no="W 7", title="Seven")["id"], 7)
    five = hearing_on(firm, make_case(a, advocate=ravi.member_id, case_no="W 5", title="Five")["id"], 5)
    two = hearing_on(firm, make_case(a, advocate=ravi.member_id, case_no="W 2", title="Two")["id"], 2)
    tomorrow = hearing_on(firm, make_case(a, advocate=ravi.member_id, case_no="W 1", title="Tomorrow")["id"], 1)
    now = hearing_on(firm, make_case(a, advocate=ravi.member_id, case_no="W 0", title="TodayCase")["id"], 0)
    counts = run(firm)
    assert counts["hearings"] == 10                                      # five hearings x (the lead + the senior); the 20-day one is not due yet
    got = titles(ravi)
    assert any("Hearing today: TodayCase" in x for x in got) and any("Hearing tomorrow: Tomorrow" in x for x in got)
    assert any("in 2 days: Two" in x for x in got) and any("in 5 days: Five" in x for x in got) and any("in 7 days: Seven" in x for x in got)
    assert not any("Window Matter" in x for x in got)
    # running again, or a hundred times, creates nothing new: no double notifications, no double e-mails
    sent_before = len(firm.sent)
    for _ in range(3):
        assert run(firm)["hearings"] == 0
    assert len(titles(ravi)) == len(got) and len(firm.sent) == sent_before
    # e-mail really went out for the lead and the senior, with the hearing details
    mails = [m for m in firm.sent if "Hearing" in m["subject"]]
    assert {m["to"] for m in mails} == {"ravi@example.com", "asha.rao@example.com"} and len(mails) == 10
    assert any("Tomorrow" in m["subject"] and "tomorrow" in m["subject"] for m in mails)
    # the same hearing moves to a nearer window as days pass: simulate three days later
    L_today = today()
    c2 = L.connect(firm.db_path)
    try:
        c2.execute("BEGIN IMMEDIATE")
        later = L.run_reminders(c2, 1, today=L_today + timedelta(days=4))
        c2.commit()
    finally:
        c2.close()
    assert later["hearings"] > 0                                          # the 7-day-away hearing is now 3 away -> the '3' window
    # a rescheduled hearing is a new date, so it gets its own reminders
    a.ok(a.patch(f"/hearings/{far['id']}", {"hearing_date": iso(3)}))
    assert run(firm)["hearings"] == 2
    # cancelled and heard hearings never remind
    a.ok(a.patch(f"/hearings/{tomorrow['id']}", {"status": "cancelled"}))
    a.ok(a.patch(f"/hearings/{two['id']}", {"status": "heard"}))
    assert run(firm)["hearings"] == 0
    _ = (seven, five, now)


def test_reminder_settings_are_respected(firm):
    t = firm.team
    a, ravi = t["asha"], t["ravi"]
    c = make_case(a, advocate=ravi.member_id)["id"]
    hearing_on(firm, c, 1)
    a.ok(a.put("/settings", {"recipients": "advocate"}))
    assert run(firm)["hearings"] == 1                                    # only the lead, not the senior
    assert titles(a) == [] and len(titles(ravi)) == 1
    a.ok(a.put("/settings", {"recipients": "advocate_and_seniors", "triggers": {"hearing": False}}))
    c2 = make_case(a, advocate=ravi.member_id, case_no="S 2")["id"]
    hearing_on(firm, c2, 1)
    assert run(firm)["hearings"] == 0
    a.ok(a.put("/settings", {"triggers": {"hearing": True}, "reminder_days": [0]}))
    c3 = make_case(a, advocate=ravi.member_id, case_no="S 3")["id"]
    hearing_on(firm, c3, 3)
    assert run(firm)["hearings"] == 0                                    # only "on the day" is wanted
    # in-app off, e-mail on -> a mail but nothing in the bell
    a.ok(a.put("/settings", {"reminder_days": [3, 1, 0], "channels": {"inapp": False, "email": True}}))
    firm.mail_ok = True
    run(firm)
    assert any("S 3" in m["body"] or "Sharma" in m["body"] or "CS 10" in m["body"] for m in firm.sent)


def test_deadlines_rti_and_pending_digest_and_client_emails(firm):
    t = firm.team
    a, ravi = t["asha"], t["ravi"]
    firm.mail_ok = True
    c = make_case(a, advocate=ravi.member_id, next_action="File rejoinder", next_action_due=iso(1), client={"name": "Mail Client", "email": "mc@client.in"})["id"]
    a.ok(a.post("/rti", {"subject": "Plot allotment records", "department": "DDA", "filing_date": iso(-29), "status": "filed", "assignee_id": ravi.member_id}), 201)
    a.ok(a.post("/events", {"kind": "deadline", "title": "Reply to notice", "start_date": iso(3)}), 201)
    a.ok(a.post("/followups", {"case_id": c, "due_date": iso(0), "note": "Chase fee", "assignee_id": ravi.member_id}), 201)
    h = hearing_on(firm, c, -2)                                           # a hearing nobody recorded
    c2 = make_case(a, advocate=ravi.member_id, case_no="E 1", client={"name": "Email Me", "email": "emailme@client.in"})["id"]
    hearing_on(firm, c2, 1)
    a.ok(a.put("/settings", {"client_email_reminders": True}))
    counts = run(firm)
    assert counts["deadlines"] >= 4 and counts["pending"] >= 1 and counts["client_emails"] == 1
    deadlines = titles(ravi, "deadline")
    assert any("Action due tomorrow" in x for x in deadlines) and any("RTI reply due" in x for x in deadlines) and any("follow-up" in x.lower() for x in deadlines)
    assert any("Deadline in 3 days: Reply to notice" in x or "in 3 days: Reply to notice" in x for x in titles(a, "deadline"))
    assert any("your attention" in x for x in titles(ravi, "pending"))
    # the client gets ONE polite e-mail the day before, never twice, and it is logged in the case history
    client_mails = [m for m in firm.sent if m["to"] == "emailme@client.in"]
    assert len(client_mails) == 1 and "Dear Email Me" in client_mails[0]["body"] and "Rao & Associates" in client_mails[0]["body"]
    assert run(firm)["client_emails"] == 0
    assert any(x["to_addr"] == "emailme@client.in" for x in a.ok(a.get(f"/comms?case_id={c2}"))["comms"])
    # the pending digest is once a day: running again the same day adds nothing
    assert run(firm)["pending"] == 0 and h["id"]


def test_catch_up_runs_when_anyone_opens_the_app(firm):
    t = firm.team
    a, ravi = t["asha"], t["ravi"]
    c = make_case(a, advocate=ravi.member_id)["id"]
    hearing_on(firm, c, 0)
    assert firm.sql("SELECT COUNT(*) FROM lpms_notifications WHERE kind = 'hearing_reminder'")[0][0] == 0
    n = ravi.ok(ravi.get("/notifications"))                              # nobody ran the scheduler; opening the bell catches up
    assert any("Hearing today" in x["title"] for x in n["items"])
    runs = a.ok(a.post("/reminders/run"))
    assert runs["counts"]["hearings"] == 0
    assert ravi.post("/reminders/run").status_code == 403


def test_the_outbox_retries_then_gives_up_and_skips_when_unconfigured(firm):
    h = firm
    a = h.team["asha"]
    calls = []

    def flaky(to, subject, body):
        calls.append(to)
        return False
    c = L.connect(h.db_path)
    c.execute("INSERT INTO lpms_outbox (firm_id, to_email, subject, body, dedupe_key, created_at) VALUES (1,'x@y.in','s','b','k1','2026-01-01')")
    c.commit()
    c.close()
    for _ in range(4):
        L.flush_outbox(h.db_path, flaky)
    assert len(calls) == 3 and h.sql("SELECT status, attempts FROM lpms_outbox")[0]["status"] == "failed"
    c = L.connect(h.db_path)
    c.execute("INSERT INTO lpms_outbox (firm_id, to_email, subject, body, dedupe_key, created_at) VALUES (1,'z@y.in','s','b','k2','2026-01-01')")
    c.commit()
    c.close()
    L.mark_unconfigured_outbox(h.db_path)
    assert [r["status"] for r in h.sql("SELECT status FROM lpms_outbox ORDER BY id")] == ["failed", "skipped"]
    assert a.ok(a.get("/settings"))["outbox"] == {"failed": 1, "skipped": 1}
