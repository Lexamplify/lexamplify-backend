"""Practice (LPMS) cases keep their documents in the Document Hub: access follows the case, and the case page sees every upload."""
import time

from conftest import ORDER_TEXT, make_pdf
from test_lpms_flow import make_case


def wait(p, doc_id, timeout=60):
    t0 = time.time()
    while time.time() - t0 < timeout:
        d = p.ok(p.get(f"/api/dms/docs/{doc_id}"))["doc"]
        if d["status"] not in ("queued", "processing"):
            return d
        time.sleep(0.2)
    raise AssertionError("still processing")


def test_case_documents_follow_the_case_and_reach_the_timeline(firm):
    t = firm.team
    a, ravi, kiran, meena = t["asha"], t["ravi"], t["kiran"], t["meena"]
    c = make_case(a, advocate=ravi.member_id, case_no="WP(C) 1234/2024", court="Delhi High Court")["id"]
    pdf = make_pdf([ORDER_TEXT + "\npractice marmot"])
    # everybody in the firm (senior, junior, staff - even a junior not on the case) can file documents on a firm-wide case
    r = meena.upload("order.pdf", pdf, lpms_case_id=c)
    assert r.status_code == 201, r.get_json()
    did = r.get_json()["doc"]["id"]
    assert r.get_json()["doc"]["lpms_case_id"] == c
    d = wait(meena, did)
    assert d["status"] == "ready" and d["doc_class"] == "Court Order"
    # visible to the whole team, found by search, filtered by case; a stranger sees nothing
    for p in (a, ravi, kiran):
        assert p.ok(p.get(f"/api/dms/docs?lpms_case_id={c}"))["total"] == 1
        assert p.ok(p.get("/api/dms/docs?q=marmot"))["total"] == 1
        assert p.get(f"/api/dms/docs/{did}/download").status_code == 200
    assert a.ok(a.get(f"/api/dms/docs/{did}"))["doc"]["practice_case"]["case_no"] == "WP(C) 1234/2024"
    assert a.ok(a.get(f"/api/dms/docs/{did}"))["doc"]["level"] == "own" and ravi.ok(ravi.get(f"/api/dms/docs/{did}"))["doc"]["level"] == "edit"
    stranger = firm.person("Stranger Lawyer")
    stranger.ok(stranger.post("/firm", {"name": "Elsewhere LLP"}), 201)
    assert stranger.ok(stranger.get("/api/dms/docs?q=marmot"))["total"] == 0
    assert stranger.get(f"/api/dms/docs/{did}").status_code == 404 and stranger.get(f"/api/dms/docs/{did}/download").status_code == 404
    assert stranger.upload("x.pdf", pdf, lpms_case_id=c).status_code == 404
    nobody = firm.person("No Firm At All")
    assert nobody.upload("x.pdf", pdf, lpms_case_id=c).status_code == 404
    # the upload is on the case timeline, on the audit log, and the lead advocate was told (the uploader was not the lead)
    tl = a.ok(a.get(f"/cases/{c}/timeline"))["items"]
    assert any(x["kind"] == "document" and "order" in x["title"].lower() and x["actor"] == "Meena Das" for x in tl)
    assert any(x["action"] == "document_upload" for x in a.ok(a.get("/audit?group=documents"))["items"])
    assert any("Document uploaded" in n["title"] for n in ravi.ok(ravi.get("/notifications"))["items"])
    assert a.ok(a.get(f"/cases/{c}"))["case"]["counts"]["documents"] == 1
    assert a.ok(a.get("/dashboard"))["documents"][0]["title"] and a.ok(a.get("/dashboard"))["documents"][0]["case_id"] == c
    # the order's own hearing date is read out of the file, so the case page can suggest it
    assert d["next_hearing"] == "2025-05-15"
    # a new version keeps the case link
    nv = ravi.post(f"/api/dms/docs/{did}/versions", data={"file": (__import__("io").BytesIO(make_pdf([ORDER_TEXT + "\nversion two"])), "order-v2.pdf")}, content_type="multipart/form-data")
    assert nv.status_code == 201 and nv.get_json()["doc"]["lpms_case_id"] == c and nv.get_json()["doc"]["version"] == 2
    # moving a case document elsewhere needs the senior (or the uploader)
    firm.sql("INSERT INTO matters (title, owner_user_id) VALUES ('M', ?)", ravi.uid)
    assert ravi.patch(f"/api/dms/docs/{did}", {"matter_id": 1}).status_code == 403
    # archived case: no new uploads
    a.ok(a.post(f"/cases/{c}/archive", {"archive": True}))
    r = a.upload("late.pdf", make_pdf(["late"]), lpms_case_id=c)
    assert r.status_code == 409 and "archived" in r.get_json()["message"]


def test_restricted_case_documents_are_hidden_from_other_juniors(firm):
    t = firm.team
    a, ravi, kiran, meena = t["asha"], t["ravi"], t["kiran"], t["meena"]
    c = make_case(a, advocate=ravi.member_id, case_no="CS 5/2026", restricted=True)["id"]
    did = ravi.upload("secret.pdf", make_pdf([ORDER_TEXT + "\nrestricted quokka"]), lpms_case_id=c).get_json()["doc"]["id"]
    wait(ravi, did)
    assert a.ok(a.get("/api/dms/docs?q=quokka"))["total"] == 1 and ravi.ok(ravi.get("/api/dms/docs?q=quokka"))["total"] == 1
    for p in (kiran, meena):
        assert p.ok(p.get("/api/dms/docs?q=quokka"))["total"] == 0
        assert p.get(f"/api/dms/docs/{did}").status_code == 404 and p.get(f"/api/dms/docs/{did}/download").status_code == 404
        assert p.upload("x.pdf", make_pdf(["x"]), lpms_case_id=c).status_code == 404
        assert p.ok(p.get("/dashboard"))["documents"] == []
    # un-restricting opens it to the firm
    a.ok(a.patch(f"/cases/{c}", {"restricted": False}))
    assert kiran.ok(kiran.get("/api/dms/docs?q=quokka"))["total"] == 1


def test_a_removed_member_loses_the_documents_too(firm):
    t = firm.team
    a, kiran = t["asha"], t["kiran"]
    c = make_case(a, case_no="CS 6/2026")["id"]
    did = a.upload("a.pdf", make_pdf([ORDER_TEXT + "\nremoval ocelot"]), lpms_case_id=c).get_json()["doc"]["id"]
    wait(a, did)
    assert kiran.ok(kiran.get("/api/dms/docs?q=ocelot"))["total"] == 1
    a.ok(a.patch(f"/members/{kiran.member_id}", {"active": False}))
    assert kiran.ok(kiran.get("/api/dms/docs?q=ocelot"))["total"] == 0 and kiran.get(f"/api/dms/docs/{did}").status_code == 404
