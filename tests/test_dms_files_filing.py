"""Auto-filing: documents that belong to no case get a proposed case with reasons; certain matches are filed (and can be undone),
uncertain ones wait in a one-click queue. Real Practice + Document Hub blueprints, real extraction."""
import time

from conftest import make_pdf
from test_lpms_flow import make_case

API = "/api/dms/files"


def ready(p, doc_id, timeout=60):
    t0 = time.time()
    while time.time() - t0 < timeout:
        d = p.ok(p.get(f"/api/dms/docs/{doc_id}"))["doc"]
        if d["status"] not in ("queued", "processing"):
            return d
        time.sleep(0.15)
    raise AssertionError("still processing")


def settle(p, doc_id, timeout=30):
    """The worker reads the file, THEN the filing hook runs - wait for the filing row to appear."""
    ready(p, doc_id)
    t0 = time.time()
    while time.time() - t0 < timeout:
        if p.h.sql("SELECT 1 FROM dms_filing WHERE doc_id = ?", doc_id):
            return
        time.sleep(0.1)


def order(number="W.P.(C) 1234/2024", court="IN THE HIGH COURT OF DELHI AT NEW DELHI", petitioner="Rajesh Kumar", respondent="Union of India & Ors.", extra=""):
    return (f"{court}\n{number}\n{petitioner} ... Petitioner\nversus\n{respondent} ... Respondents\nORDER\nDate: 12-03-2025\n"
            f"Heard learned counsel for the parties. Issue notice. List on 15.05.2025 for further hearing.\n{extra}")


def case_of(p, doc_id):
    return p.h.sql("SELECT case_id FROM case_vault WHERE id = ?", doc_id)[0]["case_id"]


def new_case(a, **kw):
    kw.setdefault("case_no", "WP(C) 1234/2024")
    kw.setdefault("court", "Delhi High Court")
    kw.setdefault("title", "Rajesh Kumar v. Union of India")
    kw.setdefault("opposite_party", "Union of India")
    return make_case(a, **kw)["id"]


def test_a_certain_match_is_filed_on_arrival_and_can_be_undone(firm):
    a = firm.team["asha"]
    c = new_case(a)
    did = a.upload("scan001.pdf", make_pdf([order("W.P.(C) 1234/2024", extra="auto-filing alpaca")])).get_json()["doc"]["id"]
    settle(a, did)
    assert case_of(a, did) == f"lpms:{c}"
    f = a.ok(a.get(f"{API}/filing?state=filed"))
    assert f["total"] == 1 and f["items"][0]["filed"]["via"] == "auto" and f["items"][0]["filed"]["ref"] == f"lpms:{c}"
    assert a.ok(a.get(f"/api/dms/docs/{did}"))["doc"]["practice_case"]["id"] == c
    # on the case's own timeline
    tl = a.ok(a.get(f"/cases/{c}/timeline"))["items"]
    assert any(x["kind"] == "document" and "filed" in x["title"].lower() for x in tl)
    # undo puts it back and it is not re-filed behind the person's back
    a.ok(a.post(f"{API}/filing/{did}/undo"))
    assert case_of(a, did) == "General"
    a.ok(a.post(f"{API}/filing/rescan"))
    assert case_of(a, did) == "General"
    assert a.ok(a.get(f"{API}/filing?state=pending"))["total"] == 0
    assert a.ok(a.get(f"{API}/filing?state=dismissed"))["total"] == 1
    assert a.post(f"{API}/filing/{did}/undo").status_code == 409                    # nothing left to undo


def test_with_auto_filing_off_it_waits_for_one_click(firm):
    a = firm.team["asha"]
    c = new_case(a)
    assert a.ok(a.put(f"{API}/filing/settings", {"auto_file": False}))["auto_file"] is False
    did = a.upload("scan002.pdf", make_pdf([order(extra="manual alpaca")])).get_json()["doc"]["id"]
    settle(a, did)
    assert case_of(a, did) == "General"
    q = a.ok(a.get(f"{API}/filing?state=pending"))
    assert q["total"] == 1 and q["summary"]["pending"] == 1 and q["summary"]["confident"] == 1
    it = q["items"][0]
    assert it["confident"] and it["candidates"][0]["ref"] == f"lpms:{c}" and it["candidates"][0]["reasons"]
    r = a.ok(a.post(f"{API}/filing/{did}/confirm"))
    assert r["case_ref"] == f"lpms:{c}" and r["label"]
    assert case_of(a, did) == f"lpms:{c}"
    assert a.ok(a.get(f"{API}/filing?state=pending"))["total"] == 0
    assert a.ok(a.get(f"{API}/filing?state=filed"))["items"][0]["filed"]["via"] == "confirm"


def test_uncertain_and_unmatched_documents_are_never_filed_by_themselves(firm):
    a = firm.team["asha"]
    c1 = new_case(a)
    # same case number, another court: a suggestion, never an automatic filing
    other = a.upload("o.pdf", make_pdf([order(court="IN THE HIGH COURT OF BOMBAY", petitioner="Somebody Else", respondent="Another Person", extra="bombay alpaca")])).get_json()["doc"]["id"]
    # nothing that identifies a case
    blank = a.upload("note.pdf", make_pdf(["Reminder to buy stamp papers and call the clerk tomorrow morning.\nNothing else here."])).get_json()["doc"]["id"]
    settle(a, other)
    settle(a, blank)
    assert case_of(a, other) == "General" and case_of(a, blank) == "General"
    pend = {i["doc"]["id"]: i for i in a.ok(a.get(f"{API}/filing?state=pending"))["items"]}
    assert other in pend and not pend[other]["confident"] and pend[other]["candidates"][0]["ref"] == f"lpms:{c1}"
    assert any("different" in r.lower() for r in pend[other]["candidates"][0]["reasons"])
    nm = a.ok(a.get(f"{API}/filing?state=nomatch"))["items"]
    assert [i["doc"]["id"] for i in nm] == [blank] and nm[0]["note"]
    # the person decides: file by hand into any case they can use, or dismiss
    a.ok(a.post(f"{API}/filing/{blank}/confirm", {"case_ref": f"lpms:{c1}"}))
    assert case_of(a, blank) == f"lpms:{c1}"
    a.ok(a.post(f"{API}/filing/{other}/dismiss"))
    assert a.ok(a.get(f"{API}/filing?state=pending"))["total"] == 0
    a.ok(a.post(f"{API}/filing/{other}/reopen"))
    assert a.ok(a.get(f"{API}/filing?state=pending"))["total"] == 1
    assert a.post(f"{API}/filing/{other}/reopen").status_code == 404                # it is not dismissed any more


def test_two_cases_with_the_same_number_are_ambiguous(firm):
    a = firm.team["asha"]
    c1 = new_case(a, court="Delhi High Court", title="Kumar v. UOI")
    c2 = new_case(a, court="Delhi High Court", title="Kumar v. State", opposite_party="State", force=True)
    did = a.upload("amb.pdf", make_pdf([order(extra="ambiguity alpaca")])).get_json()["doc"]["id"]
    settle(a, did)
    assert case_of(a, did) == "General"
    it = a.ok(a.get(f"{API}/filing?state=pending"))["items"][0]
    refs = [x["ref"] for x in it["candidates"]]
    assert set(refs[:2]) == {f"lpms:{c1}", f"lpms:{c2}"} and not it["confident"]


def test_bulk_confirm_files_only_what_is_certain(firm):
    a = firm.team["asha"]
    c = new_case(a)
    a.ok(a.put(f"{API}/filing/settings", {"auto_file": False}))
    sure = [a.upload(f"s{i}.pdf", make_pdf([order(extra=f"bulk sure {i}")])).get_json()["doc"]["id"] for i in range(3)]
    unsure = a.upload("u.pdf", make_pdf([order(court="IN THE HIGH COURT OF BOMBAY", petitioner="X Y", respondent="Z W", extra="bulk unsure")])).get_json()["doc"]["id"]
    for d in sure + [unsure]:
        settle(a, d)
    assert a.post(f"{API}/filing/confirm-all", {}).status_code == 400                  # must say which
    r = a.ok(a.post(f"{API}/filing/confirm-all", {"mode": "confident"}))
    assert r["filed"] == 3 and not r["skipped"]
    assert all(case_of(a, d) == f"lpms:{c}" for d in sure) and case_of(a, unsure) == "General"
    r = a.ok(a.post(f"{API}/filing/confirm-all", {"doc_ids": [unsure]}))
    assert r["filed"] == 1 and case_of(a, unsure) == f"lpms:{c}"


def test_filing_respects_who_may_see_the_case(firm):
    t = firm.team
    a, ravi, meena = t["asha"], t["ravi"], t["meena"]
    secret = new_case(a, case_no="WP(C) 1234/2024", advocate=a.member_id, restricted=True)
    firm.team["asha"].ok(a.put(f"{API}/filing/settings", {"auto_file": False}))
    # ravi cannot see the restricted case: it is not proposed to him and he cannot file into it
    ravi.ok(ravi.put(f"{API}/filing/settings", {"auto_file": True}))
    did = ravi.upload("r.pdf", make_pdf([order(extra="restricted proposal")])).get_json()["doc"]["id"]
    settle(ravi, did)
    assert case_of(ravi, did) == "General"
    assert ravi.ok(ravi.get(f"{API}/filing?state=nomatch"))["total"] == 1
    assert ravi.ok(ravi.get(f"{API}/filing?state=pending"))["total"] == 0
    assert ravi.post(f"{API}/filing/{did}/confirm", {"case_ref": f"lpms:{secret}"}).status_code == 404
    assert all(c["ref"] != f"lpms:{secret}" for c in ravi.ok(ravi.get(f"{API}/cases"))["cases"])
    assert any(c["ref"] == f"lpms:{secret}" for c in a.ok(a.get(f"{API}/cases"))["cases"])
    # only the owner files a document
    mine = meena.upload("m.pdf", make_pdf([order(extra="meena own")])).get_json()["doc"]["id"]
    settle(meena, mine)
    assert a.post(f"{API}/filing/{mine}/confirm", {"case_ref": f"lpms:{secret}"}).status_code in (403, 404)
    # a stranger (another firm) never sees your documents in the queue, and your cases are not offered to them
    stranger = firm.person("Stranger Lawyer")
    stranger.ok(stranger.post("/firm", {"name": "Elsewhere LLP"}), 201)
    assert stranger.ok(stranger.get(f"{API}/filing?state=pending"))["total"] == 0
    assert stranger.ok(stranger.get(f"{API}/cases"))["cases"] == []
    assert stranger.post(f"{API}/filing/{did}/dismiss").status_code == 404
    assert stranger.post(f"{API}/filing/{did}/confirm", {"case_ref": f"lpms:{secret}"}).status_code in (403, 404)


def test_filing_into_an_archived_case_is_refused(firm):
    a = firm.team["asha"]
    c = new_case(a)
    a.ok(a.put(f"{API}/filing/settings", {"auto_file": False}))
    did = a.upload("arch.pdf", make_pdf([order(extra="archived one")])).get_json()["doc"]["id"]
    settle(a, did)
    a.ok(a.post(f"/cases/{c}/archive", {"archive": True}))
    r = a.post(f"{API}/filing/{did}/confirm", {"case_ref": f"lpms:{c}"})
    assert r.status_code in (404, 409)
    assert case_of(a, did) == "General"
    assert a.post(f"{API}/filing/{did}/confirm", {}).status_code in (400, 404, 409)


def test_old_documents_wait_for_a_click_even_when_certain(firm):
    a = firm.team["asha"]
    new_case(a)
    a.ok(a.put(f"{API}/filing/settings", {"auto_file": False}))
    did = a.upload("old.pdf", make_pdf([order(extra="old one")])).get_json()["doc"]["id"]
    settle(a, did)
    a.ok(a.put(f"{API}/filing/settings", {"auto_file": True}))
    firm.sql("UPDATE dms_docs SET created_at = '2020-01-01 00:00:00' WHERE doc_id = ?", did)
    a.ok(a.get(f"{API}/filing?state=pending"))
    assert case_of(a, did) == "General"                                              # a document from 2020 is not filed silently
    assert a.ok(a.get(f"{API}/filing?state=pending"))["total"] == 1


def test_case_page_summary_and_trashed_documents_leave_the_queue(firm):
    a = firm.team["asha"]
    c = new_case(a)
    a.ok(a.put(f"{API}/filing/settings", {"auto_file": False}))
    did = a.upload("t.pdf", make_pdf([order(extra="trash me")])).get_json()["doc"]["id"]
    settle(a, did)
    s = a.ok(a.get(f"{API}/case-summary?case_ref=lpms:{c}"))
    assert s["to_file"] == 1 and s["paper_files"] == 0 and s["bundles"] == 0
    a.ok(a.delete(f"/api/dms/docs/{did}"))
    assert a.ok(a.get(f"{API}/filing?state=pending"))["total"] == 0
    assert a.get(f"{API}/case-summary?case_ref=lpms:99999").status_code == 404


def test_the_matcher_needs_a_case_number_plus_one_more_agreeing_detail_to_be_certain(firm):
    from utils import dms_match as M
    a = firm.team["asha"]
    a.ok(a.put(f"{API}/filing/settings", {"auto_file": False}))
    new_case(a, case_no="CS 10/2026", court="Saket District Court", title="Ramesh Sharma v. Suresh Verma", opposite_party="Suresh Verma")
    sharma = lambda extra="", number="CS 10/2026": (f"IN THE COURT OF CIVIL JUDGE, SAKET DISTRICT COURT, NEW DELHI\n{number}\nRamesh Sharma ... Plaintiff\nversus\nSuresh Verma ... Defendant\n"
                                                    f"ORDER\nDate: 12-03-2025\nHeard. List on 15.05.2025.\n{extra}")
    full = a.upload("full.pdf", make_pdf([sharma("full match")])).get_json()["doc"]["id"]                      # number + court + both parties
    party_only = a.upload("parties.pdf", make_pdf([sharma("parties only", number="")])).get_json()["doc"]["id"]    # no number at all
    number_only = a.upload("num.pdf", make_pdf(["CS 10/2026\nA short note that mentions nothing else about the dispute at all, honestly."])).get_json()["doc"]["id"]
    for d in (full, party_only, number_only):
        settle(a, d)
    pend = {i["doc"]["id"]: i for i in a.ok(a.get(f"{API}/filing?state=pending"))["items"]}
    assert pend[full]["confident"] and pend[full]["candidates"][0]["score"] >= M.AUTO_AT
    assert party_only in pend and not pend[party_only]["confident"] and M.SUGGEST_AT <= pend[party_only]["candidates"][0]["score"] < M.AUTO_AT
    assert any("part" in r.lower() for r in pend[party_only]["candidates"][0]["reasons"])
    # a number alone (court unknown) is a suggestion, not a certainty
    assert number_only in pend and not pend[number_only]["confident"]
    # everything the matcher says is stored with the document and survives a rescan
    a.ok(a.post(f"{API}/filing/rescan"))
    assert a.ok(a.get(f"{API}/filing?state=pending"))["total"] == 3
    assert M.decide([]) == ("nomatch", False) and M.decide([{"score": 0.3}]) == ("nomatch", False)
    assert M.decide([{"score": 0.9}, {"score": 0.8}]) == ("pending", False) and M.decide([{"score": 0.9}, {"score": 0.3}]) == ("pending", True)
    assert M.court_compare("Delhi High Court", "IN THE HIGH COURT OF DELHI AT NEW DELHI") == "match"
    assert M.court_compare("Delhi High Court", "IN THE HIGH COURT OF BOMBAY") == "mismatch"
    assert M.court_compare(None, "Delhi High Court") != "match"


def test_the_case_picker_can_look_up_one_case_even_when_it_is_archived(firm):
    a = firm.team["asha"]
    c = new_case(a)
    ref = f"lpms:{c}"
    assert [x["ref"] for x in a.ok(a.get(f"{API}/cases?ref={ref}"))["cases"]] == [ref]
    a.ok(a.post(f"/cases/{c}/archive", {"archive": True}))
    assert a.ok(a.get(f"{API}/cases"))["cases"] == []                                                 # not offered to file into any more
    assert [x["ref"] for x in a.ok(a.get(f"{API}/cases?ref={ref}"))["cases"]] == [ref]                # but a link to it still shows its name
