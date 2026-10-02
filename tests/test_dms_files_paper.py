"""The physical file register: shelves, numbered paper files, who has what, overdue, lost/found, printable QR labels, and who may see what."""
import datetime
import threading

import pymupdf as fitz

from conftest import make_pdf
from test_dms_files_filing import new_case, ready

API = "/api/dms/files"


def today(delta=0):
    return (datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30) + datetime.timedelta(days=delta)).strftime("%Y-%m-%d")


def mk(p, title="Sharma v. Verma - Vol. 1", **kw):
    return p.ok(p.post(f"{API}/paper", {"title": title, **kw}), 201)["file"]


def loc(p, name, kind="almirah", parent=None):
    return p.ok(p.post(f"{API}/locations", {"name": name, "kind": kind, "parent_id": parent}), 201)["id"]


def test_shelves_nest_and_have_readable_paths(firm):
    a = firm.team["asha"]
    room = loc(a, "Record room", "room")
    alm = loc(a, "Almirah 3", "almirah", room)
    shelf = loc(a, "Shelf B", "shelf", alm)
    paths = {l["id"]: l["path"] for l in a.ok(a.get(f"{API}/locations"))["locations"]}
    assert paths[shelf].replace(" › ", ">").replace(" > ", ">") == "Record room>Almirah 3>Shelf B"
    assert a.post(f"{API}/locations", {"name": "almirah 3", "parent_id": room}).status_code == 409        # same name in the same place
    assert a.post(f"{API}/locations", {"name": " "}).status_code == 400
    assert a.post(f"{API}/locations", {"name": "X", "kind": "spaceship"}).status_code == 400
    assert a.post(f"{API}/locations", {"name": "Y", "parent_id": 9999}).status_code == 404
    # a place cannot move inside itself or its own contents
    assert a.patch(f"{API}/locations/{room}", {"parent_id": shelf}).status_code == 400
    assert a.patch(f"{API}/locations/{room}", {"parent_id": room}).status_code == 400
    # nesting is limited
    deep = shelf
    codes = []
    for i in range(4):
        r = a.post(f"{API}/locations", {"name": f"Box {i}", "kind": "box", "parent_id": deep})
        codes.append(r.status_code)
        if r.status_code == 201:
            deep = r.get_json()["id"]
    assert 400 in codes
    # cannot delete a place with places or files inside; can once they are gone
    f = mk(a, location_id=shelf)
    assert a.delete(f"{API}/locations/{alm}").status_code == 409
    assert a.delete(f"{API}/locations/{shelf}").status_code == 409
    a.ok(a.post(f"{API}/paper/{f['id']}/move", {"location_id": room}))
    # empty it from the inside out: boxes first, then the shelf, the almirah and the room
    boxes = sorted((l for l in a.ok(a.get(f"{API}/locations"))["locations"] if l["name"].startswith("Box")), key=lambda l: -len(l["path"]))
    for b in boxes:
        a.ok(a.delete(f"{API}/locations/{b['id']}"))
    for lid in (shelf, alm):
        a.ok(a.delete(f"{API}/locations/{lid}"))
    assert a.delete(f"{API}/locations/{room}").status_code == 409                    # the file was moved to the room, so it stays
    assert [l["id"] for l in a.ok(a.get(f"{API}/locations"))["locations"]] == [room]
    a.ok(a.patch(f"{API}/locations/{room}", {"archived": True}))                     # retire instead of delete
    assert a.post(f"{API}/paper", {"title": "x", "location_id": room}).status_code == 404


def test_numbering_case_link_and_validation(firm):
    a, ravi = firm.team["asha"], firm.team["ravi"]
    c = new_case(a)
    f1 = mk(a)
    f2 = a.ok(a.post(f"{API}/paper", {"case_ref": f"lpms:{c}", "pages_est": 240, "kind": "bundle"}), 201)["file"]
    assert f1["file_no"] == "PF-0001" and f2["file_no"] == "PF-0002"
    assert f2["title"] and f2["case_label"] and f2["pages_est"] == 240 and f2["status"] == "in"
    assert ravi.ok(ravi.get(f"{API}/paper/{f1['id']}"))["file"]["file_no"] == "PF-0001"                   # the firm shares one register
    assert a.post(f"{API}/paper", {"title": " "}).status_code == 400
    assert a.post(f"{API}/paper", {"title": "x", "kind": "weird"}).status_code == 400
    assert a.post(f"{API}/paper", {"title": "x", "pages_est": "many"}).status_code == 400
    assert a.post(f"{API}/paper", {"title": "x", "pages_est": -4}).status_code == 400
    assert a.post(f"{API}/paper", {"title": "x", "case_ref": "lpms:99999"}).status_code == 404
    assert a.post(f"{API}/paper", {"title": "x", "location_id": 4242}).status_code == 404
    e = a.ok(a.patch(f"{API}/paper/{f1['id']}", {"title": "Sharma v. Verma - Vol. 2", "notes": "red tag", "case_ref": f"lpms:{c}"}))
    assert e["file"]["title"].endswith("Vol. 2") and e["file"]["case_label"] and any(m["action"] == "edited" for m in e["history"])
    assert a.patch(f"{API}/paper/{f1['id']}", {"title": ""}).status_code == 400
    assert a.get(f"{API}/paper/9999").status_code == 404


def test_numbers_stay_unique_when_people_create_files_at_the_same_time(firm):
    a, ravi, kiran = firm.team["asha"], firm.team["ravi"], firm.team["kiran"]
    got, errs = [], []

    def work(p, n):
        for i in range(n):
            try:
                r = p.post(f"{API}/paper", {"title": f"File {p.uid}-{i}"})
                got.append((r.status_code, (r.get_json().get("file") or {}).get("file_no")))
            except Exception as exc:       # pragma: no cover
                errs.append(exc)
    ts = [threading.Thread(target=work, args=(p, 6)) for p in (a, ravi, kiran)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert not errs
    nos = [n for s, n in got if s == 201]
    assert len(nos) == len(set(nos)) and len(nos) + sum(1 for s, _ in got if s != 201) == 18
    assert all(s in (201, 503) for s, _ in got) and len(nos) >= 15


def test_issue_return_transfer_and_history(firm):
    a, ravi, kiran = firm.team["asha"], firm.team["ravi"], firm.team["kiran"]
    shelf = loc(a, "Almirah 1")
    other = loc(a, "Almirah 2")
    f = mk(a, location_id=shelf)
    fid = f["id"]
    # must say who and give a sensible due date
    assert a.post(f"{API}/paper/{fid}/issue", {}).status_code == 400
    assert a.post(f"{API}/paper/{fid}/issue", {"to_name": "Clerk Mohan", "due_at": "tomorrow"}).status_code == 400
    assert a.post(f"{API}/paper/{fid}/issue", {"to_name": "Clerk Mohan", "due_at": today(-2)}).status_code == 400
    assert a.post(f"{API}/paper/{fid}/issue", {"to_user_id": 9999}).status_code == 404
    r = a.ok(a.post(f"{API}/paper/{fid}/issue", {"to_user_id": ravi.uid, "due_at": today(3), "note": "for the hearing"}))
    assert r["file"]["status"] == "out" and r["file"]["holder"] == "Ravi Nair" and r["file"]["days_to_due"] == 3 and not r["file"]["overdue"]
    assert r["stats"]["out"] == 1
    # issuing again is refused with the holder named, unless it is a direct hand-over
    x = a.post(f"{API}/paper/{fid}/issue", {"to_name": "Someone"})
    assert x.status_code == 409 and x.get_json()["code"] == "ALREADY_OUT" and "Ravi" in x.get_json()["message"]
    t = a.ok(a.post(f"{API}/paper/{fid}/issue", {"to_user_id": kiran.uid, "transfer": True}))
    assert t["file"]["holder"] == "Kiran Shah" and t["file"]["due_at"] is None
    # nothing to return when it is on the shelf; return puts it back (optionally somewhere else)
    ret = a.ok(a.post(f"{API}/paper/{fid}/return", {"location_id": other, "note": "re-shelved"}))
    assert ret["file"]["status"] == "in" and ret["file"]["holder"] is None and ret["file"]["location_id"] == other
    assert a.post(f"{API}/paper/{fid}/return", {}).status_code == 409
    assert a.post(f"{API}/paper/{fid}/move", {}).status_code == 400
    a.ok(a.post(f"{API}/paper/{fid}/move", {"location_id": shelf, "location_note": "top row"}))
    d = a.ok(a.get(f"{API}/paper/{fid}"))
    acts = [m["action"] for m in d["history"]]
    assert acts[0] == "moved" and acts[-1] == "created" and {"issued", "handed-over", "returned"} <= set(acts)
    assert d["file"]["location_note"] == "top row"
    # the history names who did it
    assert {m["actor_name"] for m in d["history"]} == {"Asha Rao"}


def test_overdue_lost_found_archive_and_the_summary(firm):
    a = firm.team["asha"]
    f1, f2, f3 = mk(a, "One"), mk(a, "Two"), mk(a, "Three")
    for f in (f1, f2):
        a.ok(a.post(f"{API}/paper/{f['id']}/issue", {"to_name": "Court clerk", "due_at": today(1)}))
    firm.sql("UPDATE dms_pfiles SET due_at = ? WHERE id = ?", today(-3), f1["id"])               # time passes
    s = a.ok(a.get(f"{API}/paper/summary"))
    assert s["stats"]["out"] == 2 and s["stats"]["overdue"] == 1
    assert [o["id"] for o in s["overdue"]] == [f1["id"]] and s["overdue"][0]["overdue"] and s["overdue"][0]["days_to_due"] == -3
    assert s["holders"] == [{"holder": "Court clerk", "n": 2, "overdue": 1}]
    assert [f["id"] for f in a.ok(a.get(f"{API}/paper?overdue=1"))["files"]] == [f1["id"]]
    assert {f["id"] for f in a.ok(a.get(f"{API}/paper?holder=Court%20clerk"))["files"]} == {f1["id"], f2["id"]}
    # lost: cannot be issued; found brings it back to the shelf
    a.ok(a.post(f"{API}/paper/{f1['id']}/lost", {"note": "not at the clerk's table"}))
    assert a.post(f"{API}/paper/{f1['id']}/lost").status_code == 409
    assert a.post(f"{API}/paper/{f1['id']}/issue", {"to_name": "X"}).status_code == 409
    assert a.post(f"{API}/paper/{f1['id']}/archive").status_code == 409
    assert a.ok(a.get(f"{API}/paper/summary"))["stats"]["overdue"] == 0                           # lost is not "overdue", it is lost
    assert a.ok(a.get(f"{API}/paper/summary"))["stats"]["lost"] == 1
    a.ok(a.post(f"{API}/paper/{f1['id']}/found"))
    assert a.post(f"{API}/paper/{f1['id']}/found").status_code == 409
    assert a.ok(a.get(f"{API}/paper/{f1['id']}"))["file"]["status"] == "in"
    # archive only when it is on the shelf
    assert a.post(f"{API}/paper/{f2['id']}/archive").status_code == 409                           # still out
    a.ok(a.post(f"{API}/paper/{f3['id']}/archive"))
    assert a.post(f"{API}/paper/{f3['id']}/issue", {"to_name": "X"}).status_code == 409
    assert [f["id"] for f in a.ok(a.get(f"{API}/paper?status=archived"))["files"]] == [f3["id"]]
    assert f3["id"] not in [f["id"] for f in a.ok(a.get(f"{API}/paper"))["files"]]
    a.ok(a.post(f"{API}/paper/{f3['id']}/restore"))
    assert a.post(f"{API}/paper/{f3['id']}/restore").status_code == 409
    # search and sort
    assert [f["title"] for f in a.ok(a.get(f"{API}/paper?q=two"))["files"]] == ["Two"]
    assert [f["file_no"] for f in a.ok(a.get(f"{API}/paper?sort=number"))["files"]] == ["PF-0001", "PF-0002", "PF-0003"]
    assert a.ok(a.get(f"{API}/paper?q=PF-0003"))["total"] == 1


def test_lookup_by_number_code_and_scanned_link(firm):
    a = firm.team["asha"]
    f = mk(a)
    tok = firm.sql("SELECT token FROM dms_pfiles WHERE id = ?", f["id"])[0]["token"]
    for code in (f["file_no"], f["file_no"].lower(), "PF-1", "1", tok, f"https://test.lexamplify.com/document-hub?pf={tok}", f"  {tok}  "):
        r = a.get(f"{API}/paper/lookup?code={code.replace(' ', '%20').replace('#', '')}")
        assert r.status_code == 200 and r.get_json()["file"]["id"] == f["id"], code
    assert a.get(f"{API}/paper/lookup?code=PF-9999").status_code == 404
    assert a.get(f"{API}/paper/lookup?code=").status_code in (400, 404)
    stranger = firm.person("Stranger Lawyer")
    stranger.ok(stranger.post("/firm", {"name": "Elsewhere LLP"}), 201)
    assert stranger.get(f"{API}/paper/lookup?code={tok}").status_code == 404                       # a label found by a stranger opens nothing


def test_labels_are_real_pdfs_and_qr_codes_point_at_the_hub(firm):
    a = firm.team["asha"]
    ids = [mk(a, f"File {i}")["id"] for i in range(30)]
    r = a.post(f"{API}/paper/labels.pdf", json={"ids": ids, "layout": "a4-24", "base": "https://test.lexamplify.com"})
    assert r.status_code == 200 and r.mimetype == "application/pdf" and r.data[:4] == b"%PDF"
    doc = fitz.open("pdf", r.data)
    assert doc.page_count == 2
    assert "PF-0001" in doc[0].get_text() and "PF-0030" in doc[1].get_text()
    assert len(doc[0].get_images()) == 24                                                       # a QR code on every label
    # ... and a phone would read it: the first label's QR decodes to a link that opens that file in the Hub
    import cv2
    import numpy as np
    info = doc.extract_image(doc[0].get_images()[0][0])
    img = cv2.imdecode(np.frombuffer(info["image"], np.uint8), cv2.IMREAD_GRAYSCALE)
    img = cv2.copyMakeBorder(cv2.resize(img, None, fx=4, fy=4, interpolation=cv2.INTER_NEAREST), 40, 40, 40, 40, cv2.BORDER_CONSTANT, value=255)
    text, _pts, _ = cv2.QRCodeDetector().detectAndDecode(img)
    tok = firm.sql("SELECT token FROM dms_pfiles WHERE file_no = 'PF-0001'")[0]["token"]
    assert text == f"https://test.lexamplify.com/document-hub?pf={tok}"
    for layout, pages in (("a4-12", 3), ("a4-6", 5), ("roll", 30)):
        rr = a.post(f"{API}/paper/labels.pdf", json={"ids": ids, "layout": layout})
        assert rr.status_code == 200 and fitz.open("pdf", rr.data).page_count == pages, layout
    one = a.get(f"{API}/paper/{ids[0]}/label.pdf")
    assert one.status_code == 200 and one.data[:4] == b"%PDF"
    assert a.post(f"{API}/paper/labels.pdf", json={"ids": []}).status_code == 400
    assert a.post(f"{API}/paper/labels.pdf", json={"ids": [999999]}).status_code == 404
    assert a.post(f"{API}/paper/labels.pdf", json={"ids": list(range(1, 300))}).status_code == 400
    # a hostile "base" falls back to this server instead of ending up in the QR code
    bad = a.post(f"{API}/paper/labels.pdf", json={"ids": ids[:1], "base": "javascript:alert(1)"})
    assert bad.status_code == 200
    # titles in Hindi (needs a font) never crash the print
    h = mk(a, "शर्मा बनाम वर्मा - खंड 1")
    assert a.post(f"{API}/paper/labels.pdf", json={"ids": [h["id"]]}).status_code == 200


def test_export_csv_neutralises_formulas(firm):
    a = firm.team["asha"]
    mk(a, "=HYPERLINK(\"http://evil\",\"x\")")
    mk(a, "Plain file", client="@SUM(1+1)")
    r = a.get(f"{API}/paper/export.csv")
    text = r.data.decode("utf-8-sig")
    assert r.status_code == 200 and r.mimetype == "text/csv" and text.splitlines()[0].startswith("File no.")
    for line in text.splitlines()[1:]:
        for cell in line.split(","):
            assert not cell.startswith(("=", "@", "+")), line


def test_scans_link_to_the_paper_original_and_show_on_the_document(firm):
    a = firm.team["asha"]
    f = mk(a)
    did = a.upload("scan.pdf", make_pdf(["Affidavit text for linking"])).get_json()["doc"]["id"]
    ready(a, did)
    assert a.post(f"{API}/paper/{f['id']}/docs", {"doc_ids": []}).status_code == 400
    r = a.ok(a.post(f"{API}/paper/{f['id']}/docs", {"doc_ids": [did, did, 9999]}))
    assert r["added"] == 1 and r["skipped"] == 1 and [d["id"] for d in r["docs"]] == [did]
    d = a.ok(a.get(f"/api/dms/docs/{did}"))["doc"]
    assert [p["file_no"] for p in d["paper"]] == ["PF-0001"] and d["paper"][0]["status"] == "in"
    a.ok(a.delete(f"{API}/paper/{f['id']}/docs/{did}"))
    assert a.ok(a.get(f"/api/dms/docs/{did}"))["doc"]["paper"] == []


def test_who_may_see_which_paper_file(firm):
    t = firm.team
    a, ravi = t["asha"], t["ravi"]
    secret = new_case(a, case_no="CS 99/2026", advocate=a.member_id, restricted=True, title="Confidential Merger")
    sf = a.ok(a.post(f"{API}/paper", {"title": "Secret volume", "case_ref": f"lpms:{secret}"}), 201)["file"]
    open_f = mk(a, "Open volume")
    assert [f["id"] for f in ravi.ok(ravi.get(f"{API}/paper"))["files"]] == [open_f["id"]]
    assert ravi.get(f"{API}/paper/{sf['id']}").status_code == 404
    assert ravi.post(f"{API}/paper/{sf['id']}/issue", {"to_name": "x"}).status_code == 404
    assert ravi.post(f"{API}/paper/labels.pdf", json={"ids": [sf["id"]]}).status_code == 404
    assert ravi.post(f"{API}/paper", {"title": "Sneaky", "case_ref": f"lpms:{secret}"}).status_code == 404
    assert ravi.ok(ravi.get(f"{API}/paper/summary"))["stats"]["in"] == 1
    assert "Secret" not in ravi.get(f"{API}/paper/export.csv").data.decode("utf-8-sig")
    # the senior's own register shows both
    assert a.ok(a.get(f"{API}/paper"))["total"] == 2
    # another practice sees nothing and has its own numbering
    s = firm.person("Stranger Lawyer")
    s.ok(s.post("/firm", {"name": "Elsewhere LLP"}), 201)
    assert s.ok(s.get(f"{API}/paper"))["total"] == 0
    assert s.ok(s.post(f"{API}/paper", {"title": "Theirs"}), 201)["file"]["file_no"] == "PF-0001"
    assert s.get(f"{API}/paper/{open_f['id']}").status_code == 404
    assert s.get(f"{API}/locations").get_json()["locations"] == []
    # nobody without a login
    assert firm.app.test_client().get("/api/dms/files/paper").status_code == 401

