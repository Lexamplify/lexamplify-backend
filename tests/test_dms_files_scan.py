"""Scan intake: phone photos or a scanner's PDF become clean, separate, named, searchable documents on the right cases."""
import io
import os
import threading
import time

import pymupdf as fitz
import pytest

from conftest import make_pdf, make_scanned_pdf, ocr_ok
from scan_helpers import AFFIDAVIT, PLAINT, PLAINT_P2, VAKALATNAMA, blank_photo, desk_photo, jpeg, page_image, photo_of, rotated, separator_photo
from test_dms_files_filing import case_of, new_case, ready

API = "/api/dms/files"
needs_ocr = pytest.mark.skipif(not ocr_ok(), reason="Tesseract is not installed here")


def start(p, **body):
    return p.ok(p.post(f"{API}/scan", body), 201)["scan"]["id"]


def add(p, sid, data, name="page.jpg", expect=201):
    r = p.post(f"{API}/scan/{sid}/pages", data={"file": (io.BytesIO(data), name)}, content_type="multipart/form-data")
    assert r.status_code == expect, r.get_json()
    return r.get_json()


def settled(p, sid, timeout=120):
    t0 = time.time()
    while time.time() - t0 < timeout:
        s = p.ok(p.get(f"{API}/scan/{sid}"))["scan"]
        if s["counts"]["working"] == 0:
            return s
        time.sleep(0.3)
    raise AssertionError("pages are still being cleaned")


def suggest(p, sid, **body):
    return p.ok(p.post(f"{API}/scan/{sid}/suggest", body))


def save_layout(p, sid, docs, removed=(), **extra):
    r = p.put(f"{API}/scan/{sid}/layout", {"layout": {"docs": docs, "removed": list(removed)}, **extra})
    return r


@pytest.fixture(scope="module")
def photos():
    return {"plaint1": photo_of(PLAINT, angle=3), "plaint2": photo_of(PLAINT_P2, angle=-4), "aff": photo_of(AFFIDAVIT, angle=5), "vak": photo_of(VAKALATNAMA, angle=2),
            "blank": blank_photo(angle=2), "sep": separator_photo(angle=1)}


# ── starting, uploading, validation ──────────────────────────────────────────────────
def test_upload_validation(firm, photos):
    a = firm.team["asha"]
    sid = start(a)
    add(a, sid, b"", "empty.jpg", expect=400)
    add(a, sid, b"this is not a picture at all", "fake.jpg", expect=415)
    add(a, sid, photos["plaint1"], "scan.heic", expect=415)
    add(a, sid, b"PK\x03\x04" + b"\0" * 50, "x.zip", expect=415)
    add(a, sid, b"%PDF-1.4 garbage", "broken.pdf", expect=415)
    r = a.post(f"{API}/scan/{sid}/pages", data={}, content_type="multipart/form-data")
    assert r.status_code == 400
    # a password-protected PDF is refused with a clear reason
    d = fitz.open("pdf", make_pdf(["secret"]))
    locked = d.tobytes(encryption=fitz.PDF_ENCRYPT_AES_256, user_pw="pw", owner_pw="pw")
    r = add(a, sid, locked, "locked.pdf", expect=415)
    assert "password" in r["message"].lower()
    assert a.ok(a.get(f"{API}/scan/{sid}"))["scan"]["counts"]["total"] == 0                       # nothing was left behind
    assert [f for f in os.listdir(__import__("utils.dms_scan", fromlist=["x"]).session_dir(sid))] == []
    # a 14-page scanner PDF becomes 14 pages
    ok = add(a, sid, make_pdf([f"Sheet {i}" for i in range(14)]), "scanner.pdf")
    assert len(ok["pages"]) == 14 and [p["seq"] for p in ok["pages"]] == list(range(1, 15))
    # per-session limit
    from utils import dms_scan as SC
    old = SC.MAX_PAGES_PER_SESSION
    SC.MAX_PAGES_PER_SESSION = 15
    try:
        r = add(a, sid, make_pdf(["a", "b"]), "more.pdf", expect=409)
        assert "up to 15" in r["message"]
    finally:
        SC.MAX_PAGES_PER_SESSION = old
    assert a.ok(a.get(f"{API}/scan/{sid}"))["scan"]["counts"]["total"] == 14


def test_photos_are_straightened_and_read(firm, photos):
    a = firm.team["asha"]
    sid = start(a)
    add(a, sid, photos["plaint1"])
    s = settled(a, sid)
    p = s["pages"][0]
    assert p["status"] == "ready" and not p["blank"] and not p["separator"] and (p["ocr"] or not ocr_ok())
    assert p["h"] > p["w"] and 0.68 < p["w"] / p["h"] < 0.76                                         # cropped out of the desk into an A4 page
    for kind in ("thumb", "view", "full"):
        r = a.get(f"{API}/scan/{sid}/pages/{p['id']}/{kind}")
        assert r.status_code == 200 and r.mimetype == "image/jpeg" and r.data[:2] == b"\xff\xd8", kind
    if ocr_ok():
        txt = a.ok(a.get(f"{API}/scan/{sid}/pages/{p['id']}/text"))["text"]
        assert "PLAINT" in txt and "CS 10/2026" in txt


@needs_ocr
def test_sideways_and_upside_down_photos_are_turned_upright_and_pages_can_be_rotated_by_hand(firm):
    a = firm.team["asha"]
    sid = start(a)
    base = page_image(PLAINT)
    for deg in (90, 180, 270):
        add(a, sid, jpeg(desk_photo(rotated(base, deg), angle=2)), f"r{deg}.jpg")
    s = settled(a, sid)
    for p in s["pages"]:
        txt = a.ok(a.get(f"{API}/scan/{sid}/pages/{p['id']}/text"))["text"]
        assert "PLAINT" in txt and "Saket" in txt.title() or "SAKET" in txt, p["name"]
    # a hand rotation re-reads the page, and the picture URL changes so it is not shown from cache
    pid = s["pages"][0]["id"]
    v0 = s["pages"][0]["v"]
    r = a.ok(a.post(f"{API}/scan/{sid}/pages/{pid}/rotate", {"deg": 90}))
    assert r["page"]["status"] == "queued"
    assert a.post(f"{API}/scan/{sid}/pages/{pid}/rotate", {"deg": 90}).status_code == 409           # busy until re-read
    s2 = settled(a, sid)
    p2 = next(p for p in s2["pages"] if p["id"] == pid)
    assert p2["v"] > v0 and p2["rot"] % 360 == 90
    assert a.post(f"{API}/scan/{sid}/pages/{pid}/rotate", {"deg": 45}).status_code == 400
    assert a.post(f"{API}/scan/{sid}/pages/{pid}/retry").status_code == 409                           # only failed pages are retried


def test_blank_backs_and_separator_sheets_are_set_aside_but_a_sparse_page_is_kept(firm, photos):
    a = firm.team["asha"]
    sid = start(a)
    sparse = photo_of("Dated: 12-03-2025\nSd/-\nAdvocate", angle=2)
    for k in ("plaint1", "blank", "sep", "aff", "blank"):
        add(a, sid, photos[k])
    add(a, sid, sparse)
    s = settled(a, sid)
    flags = [(p["blank"], p["separator"]) for p in s["pages"]]
    assert flags == [(False, False), (True, False), (False, True), (False, False), (True, False), (False, False)]
    j = suggest(a, sid)
    why = {x["id"]: x["why"] for x in j["removed"]}
    ids = [p["id"] for p in s["pages"]]
    assert why == {ids[1]: "blank page", ids[2]: "separator sheet", ids[4]: "blank page"}
    assert [d["pages"] for d in j["docs"]] == [[ids[0]], [ids[3], ids[5]]] or [d["pages"] for d in j["docs"]] == [[ids[0]], [ids[3]], [ids[5]]]
    assert sum(len(d["pages"]) for d in j["docs"]) == 3                                                 # the sparse last page is NOT dropped
    assert j["docs"][1]["reasons"] and "separator" in j["docs"][1]["reasons"][0]


@needs_ocr
def test_a_stack_is_split_named_typed_and_matched_to_the_case(firm, photos):
    a = firm.team["asha"]
    c = new_case(a, case_no="CS 10/2026", court="Saket District Court", title="Sharma v. Verma", opposite_party="Verma")
    sid = start(a)
    for k in ("plaint1", "plaint2", "aff", "vak"):
        add(a, sid, photos[k])
    s = settled(a, sid)
    ids = [p["id"] for p in s["pages"]]
    j = suggest(a, sid)
    docs = j["docs"]
    assert [d["pages"] for d in docs] == [ids[:2], [ids[2]], [ids[3]]]
    assert docs[0]["doc_class"] and docs[1]["doc_class"] == "Affidavit" and docs[2]["doc_class"].startswith("Vakalatnama")
    assert docs[0]["case_ref"] == f"lpms:{c}" and docs[1]["case_ref"] == f"lpms:{c}" and docs[0]["case_label"]       # case number + court + parties agree: confident
    assert docs[2]["case_ref"] is None and docs[2]["hint"] is None                                              # a different case number: nothing to suggest
    assert any("Affidavit" in r for r in docs[1]["reasons"]) and any("different case number" in r for r in docs[2]["reasons"])
    assert all(d["title"] for d in docs) and docs[0]["readable"]


def test_layout_is_validated_and_saved(firm, photos):
    a, ravi = firm.team["asha"], firm.team["ravi"]
    secret = new_case(a, case_no="CS 99/2026", advocate=a.member_id, restricted=True, title="Confidential Merger")
    sid, other = start(a), start(a)
    add(a, sid, photos["plaint1"])
    add(a, sid, photos["aff"])
    add(a, other, photos["vak"])
    s, o = settled(a, sid), settled(a, other)
    p1, p2 = [p["id"] for p in s["pages"]]
    foreign = o["pages"][0]["id"]
    assert save_layout(a, sid, [{"pages": [p1, foreign]}]).status_code == 400                           # not this scan's page
    assert save_layout(a, sid, [{"pages": [p1]}, {"pages": [p1]}]).status_code == 400                    # twice
    assert save_layout(a, sid, [{"pages": [p1], "doc_class": "Spaceship"}]).status_code == 400
    assert save_layout(a, sid, [{"pages": [p1], "case_ref": "lpms:424242"}]).status_code == 404
    assert save_layout(a, sid, [{"pages": [p1], "pfile_id": 4242}]).status_code == 404
    assert a.put(f"{API}/scan/{sid}/layout", {"layout": "nope"}).status_code == 400
    assert a.put(f"{API}/scan/{sid}/layout", {"layout": {"docs": [{"pages": [p1]}], "removed": []}, "defaults": {"case_ref": "lpms:424242"}}).status_code == 404
    ok = save_layout(a, sid, [{"key": "x", "pages": [p2, p1], "title": "  Both   pages ", "doc_class": "Affidavit", "case_ref": f"lpms:{secret}"}, {"pages": []}],
                     defaults={"case_ref": f"lpms:{secret}"})
    assert ok.status_code == 200
    back = a.ok(a.get(f"{API}/scan/{sid}"))["scan"]
    assert back["layout"]["docs"][0]["pages"] == [p2, p1] and back["layout"]["docs"][0]["title"] == "Both pages" and len(back["layout"]["docs"]) == 1
    assert back["case_labels"][f"lpms:{secret}"] and back["defaults"]["case_ref"] == f"lpms:{secret}"
    # a page deleted later disappears from the saved layout
    a.ok(a.delete(f"{API}/scan/{sid}/pages/{p1}"))
    back = a.ok(a.get(f"{API}/scan/{sid}"))["scan"]
    assert back["layout"]["docs"][0]["pages"] == [p2] and back["counts"]["total"] == 1
    assert a.get(f"{API}/scan/{sid}/pages/{p1}/thumb").status_code == 404
    # the junior cannot even start a scan for a case they cannot see
    assert ravi.post(f"{API}/scan", json={"case_ref": f"lpms:{secret}"}).status_code == 404


@needs_ocr
def test_filing_builds_one_searchable_pdf_per_document_on_the_right_case(firm, photos):
    a = firm.team["asha"]
    c = new_case(a, case_no="CS 10/2026", court="Saket District Court", title="Sharma v. Verma", opposite_party="Verma")
    sid = start(a)
    for k in ("plaint1", "plaint2", "aff"):
        add(a, sid, photos[k])
    settled(a, sid)
    docs = suggest(a, sid)["docs"]
    docs[0]["title"] = "Plaint (as filed)"
    assert save_layout(a, sid, docs).status_code == 200
    r = a.ok(a.post(f"{API}/scan/{sid}/finalize", {}))
    assert r["ok"] and r["filed"] == 2 and r["closed"] and r["remaining"] == 0
    first = next(x for x in r["results"] if x["pages"] == 2)
    assert first["case_ref"] == f"lpms:{c}" and first["title"] == "Plaint (as filed)"
    for x in r["results"]:
        ready(a, x["doc_id"])
        assert case_of(a, x["doc_id"]) == f"lpms:{c}"
    d = a.ok(a.get(f"/api/dms/docs/{first['doc_id']}"))["doc"]
    assert d["title"] == "Plaint (as filed)" and d["page_count"] == 2 and d["practice_case"]["id"] == c and d["ext"] == "pdf" and d["status"] == "ready"
    assert a.ok(a.get("/api/dms/docs?q=Defendant%20owes"))["total"] >= 1                              # the text layer is searchable
    dl = a.get(f"/api/dms/docs/{first['doc_id']}/download")
    assert dl.status_code == 200 and fitz.open("pdf", dl.data).page_count == 2
    assert any(t["kind"] == "document" for t in a.ok(a.get(f"/cases/{c}/timeline"))["items"])
    # the scan is gone: no session, no pictures left on the server
    assert a.get(f"{API}/scan/{sid}").status_code == 404
    assert not os.path.exists(__import__("utils.dms_scan", fromlist=["x"]).session_dir(sid))
    assert a.ok(a.get(f"{API}/summary"))["scans"] == 0


def test_filing_in_batches_is_idempotent_and_reports_failures_per_document(firm, photos):
    a = firm.team["asha"]
    c = new_case(a)
    sid = start(a)
    for k in ("plaint1", "aff", "vak"):
        add(a, sid, photos[k])
    s = settled(a, sid)
    ids = [p["id"] for p in s["pages"]]
    docs = [{"key": f"d{i}", "pages": [pid], "title": f"Document {i}", "doc_class": "Court Order", "case_ref": f"lpms:{c}"} for i, pid in enumerate(ids)]
    assert save_layout(a, sid, docs).status_code == 200
    r1 = a.ok(a.post(f"{API}/scan/{sid}/finalize", {"only": ["d0", "d1"]}))
    assert r1["filed"] == 2 and not r1["closed"] and r1["remaining"] == 1
    again = a.ok(a.post(f"{API}/scan/{sid}/finalize", {"only": ["d0", "d1"]}))                          # a double click files nothing twice
    assert all(x.get("already") for x in again["results"]) and again["filed"] == 2
    # the open scan tells the page which documents are already filed, so it can lock them
    fd = a.ok(a.get(f"{API}/scan/{sid}"))["scan"]["filed_docs"]
    assert set(fd) == {"d0", "d1"} and all(v.get("doc_id") for v in fd.values())
    assert firm.sql("SELECT COUNT(*) AS n FROM dms_docs WHERE original_name LIKE 'scan-%'")[0]["n"] == 2
    # the third one fails (its case was archived): the first two stay filed, the scan stays open, and the reason is shown
    a.ok(a.post(f"/cases/{c}/archive", {"archive": True}))
    r3 = a.ok(a.post(f"{API}/scan/{sid}/finalize", {}))
    assert not r3["ok"] and r3["failed"] == 1 and not r3["closed"] and "archived" in next(x for x in r3["results"] if not x["ok"])["error"].lower()
    assert a.ok(a.get(f"{API}/scan/{sid}"))["scan"]["counts"]["total"] == 3
    # fix it (file the last one without a case) and finish
    docs[2]["case_ref"] = None
    assert save_layout(a, sid, docs).status_code == 200
    r4 = a.ok(a.post(f"{API}/scan/{sid}/finalize", {}))
    assert r4["ok"] and r4["closed"] and r4["remaining"] == 0
    assert firm.sql("SELECT COUNT(*) AS n FROM dms_docs WHERE original_name LIKE 'scan-%'")[0]["n"] == 3
    assert a.post(f"{API}/scan/{sid}/finalize", {}).status_code == 404                                 # it is finished


def test_filing_refuses_to_run_while_pages_are_not_ready_or_with_nothing_to_file(firm, photos):
    a = firm.team["asha"]
    sid = start(a)
    assert a.post(f"{API}/scan/{sid}/finalize", {}).status_code == 400
    add(a, sid, photos["aff"])
    s = settled(a, sid)
    pid = s["pages"][0]["id"]
    save_layout(a, sid, [{"key": "d", "pages": [pid], "title": "T"}])
    firm.sql("UPDATE dms_scan_pages SET status = 'failed', error = 'bad' WHERE id = ?", pid)
    r = a.ok(a.post(f"{API}/scan/{sid}/finalize", {}))
    assert not r["ok"] and "not ready" in r["results"][0]["error"].lower() and not r["closed"]
    # retry brings it back; a missing page file is explained, not a crash
    a.ok(a.post(f"{API}/scan/{sid}/pages/{pid}/retry"))
    settled(a, sid)
    from utils import dms_scan as SC
    os.remove(SC.page_paths(sid, pid)["pdf"])
    r = a.ok(a.post(f"{API}/scan/{sid}/finalize", {}))
    assert not r["ok"] and "missing" in r["results"][0]["error"].lower()


def test_a_scanner_pdf_is_split_without_any_photo_processing(firm):
    if not ocr_ok():
        pytest.skip("Tesseract is not installed here")
    a = firm.team["asha"]
    c = new_case(a, case_no="CS 10/2026", court="Saket District Court", title="Sharma v. Verma", opposite_party="Verma")
    sid = start(a)
    # a flatbed scanner's output: picture-only pages, plus one page that already has text
    pdf = make_scanned_pdf([PLAINT, PLAINT_P2, AFFIDAVIT])
    add(a, sid, pdf, "scan0001.pdf")
    add(a, sid, make_pdf([VAKALATNAMA]), "typed.pdf")
    s = settled(a, sid)
    assert s["counts"]["ready"] == 4 and [p["kind"] for p in s["pages"]] == ["pdf"] * 4
    ids = [p["id"] for p in s["pages"]]
    docs = suggest(a, sid)["docs"]
    assert [d["pages"] for d in docs] == [ids[:2], [ids[2]], [ids[3]]]
    assert docs[0]["case_ref"] == f"lpms:{c}"
    save_layout(a, sid, docs)
    r = a.ok(a.post(f"{API}/scan/{sid}/finalize", {}))
    assert r["ok"] and r["filed"] == 3


@needs_ocr
def test_documents_filed_without_a_case_are_matched_by_the_filing_queue(firm, photos):
    a = firm.team["asha"]
    c = new_case(a, case_no="CS 10/2026", court="Saket District Court", title="Sharma v. Verma", opposite_party="Verma")
    sid = start(a)
    add(a, sid, photos["aff"])
    s = settled(a, sid)
    save_layout(a, sid, [{"key": "d", "pages": [s["pages"][0]["id"]], "title": "Affidavit of Ramesh Sharma"}])
    r = a.ok(a.post(f"{API}/scan/{sid}/finalize", {}))
    did = r["results"][0]["doc_id"]
    assert r["results"][0]["case_ref"] is None
    ready(a, did)
    t0 = time.time()
    while time.time() - t0 < 20 and case_of(a, did) == "General":
        time.sleep(0.2)
    assert case_of(a, did) == f"lpms:{c}"                                                              # the Hub's reader found the case number and filed it
    assert a.ok(a.get(f"/api/dms/docs/{did}"))["doc"]["title"] == "Affidavit of Ramesh Sharma"          # and kept the name the person chose


def test_the_paper_original_and_its_case(firm, photos):
    a = firm.team["asha"]
    c = new_case(a, case_no="CS 10/2026", court="Saket District Court", title="Sharma v. Verma")
    pf = a.ok(a.post(f"{API}/paper", {"title": "Sharma v. Verma - Vol. 1", "case_ref": f"lpms:{c}"}), 201)["file"]
    sid = start(a, pfile_id=pf["id"])
    add(a, sid, photos["aff"])
    s = settled(a, sid)
    save_layout(a, sid, [{"key": "d", "pages": [s["pages"][0]["id"]], "title": "Affidavit"}])
    back = a.ok(a.get(f"{API}/scan/{sid}"))["scan"]
    assert back["pfile_label"].startswith(pf["file_no"])
    r = a.ok(a.post(f"{API}/scan/{sid}/finalize", {}))
    did = r["results"][0]["doc_id"]
    assert r["results"][0]["paper_file"] == pf["file_no"] and r["results"][0]["case_ref"] == f"lpms:{c}"     # no case chosen: it follows the paper file
    assert case_of(a, did) == f"lpms:{c}"
    det = a.ok(a.get(f"{API}/paper/{pf['id']}"))
    assert [d["id"] for d in det["docs"]] == [did] and any(m["action"] == "linked-docs" for m in det["history"])
    assert [p["file_no"] for p in a.ok(a.get(f"/api/dms/docs/{did}"))["doc"]["paper"]] == [pf["file_no"]]


def test_scans_belong_to_their_owner(firm, photos):
    a, ravi = firm.team["asha"], firm.team["ravi"]
    sid = start(a)
    add(a, sid, photos["aff"])
    s = settled(a, sid)
    pid = s["pages"][0]["id"]
    for other in (ravi, firm.person("Stranger Lawyer")):
        assert other.get(f"{API}/scan/{sid}").status_code == 404
        assert other.get(f"{API}/scan/{sid}/pages/{pid}/full").status_code == 404
        assert other.post(f"{API}/scan/{sid}/pages", data={"file": (io.BytesIO(photos["aff"]), "x.jpg")}, content_type="multipart/form-data").status_code == 404
        assert other.delete(f"{API}/scan/{sid}").status_code == 404
        assert other.post(f"{API}/scan/{sid}/finalize", json={}).status_code == 404
        assert other.ok(other.get(f"{API}/scan"))["scans"] == []
    for bad in ("../../etc", "x", "a" * 80, "%2e%2e"):
        assert a.get(f"{API}/scan/{bad}").status_code == 404
    assert firm.app.test_client().get(f"{API}/scan").status_code == 401
    assert [x["id"] for x in a.ok(a.get(f"{API}/scan"))["scans"]] == [sid]
    a.ok(a.delete(f"{API}/scan/{sid}"))
    assert a.get(f"{API}/scan/{sid}").status_code == 404


def test_parallel_uploads_get_distinct_places_and_old_scans_are_swept(firm, photos):
    a = firm.team["asha"]
    sid = start(a)
    out = []

    def go(i):
        r = a.post(f"{API}/scan/{sid}/pages", data={"file": (io.BytesIO(make_pdf([f"p{i}"])), f"p{i}.pdf")}, content_type="multipart/form-data")
        out.append(r.status_code)
    ts = [threading.Thread(target=go, args=(i,)) for i in range(8)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert out == [201] * 8
    seqs = [r["seq"] for r in firm.sql("SELECT seq FROM dms_scan_pages WHERE session_id = ? ORDER BY seq", sid)]
    assert seqs == list(range(1, 9))
    settled(a, sid)
    firm.sql("UPDATE dms_scan_sessions SET updated_at = datetime('now', '-5 days') WHERE id = ?", sid)
    from utils import dms_scan as SC
    c = __import__("utils.dms_index", fromlist=["x"]).connect(firm.db_path)
    SC.sweep_old(c)
    c.commit()
    c.close()
    assert firm.sql("SELECT COUNT(*) AS n FROM dms_scan_sessions")[0]["n"] == 0 and firm.sql("SELECT COUNT(*) AS n FROM dms_scan_pages")[0]["n"] == 0
    assert not os.path.exists(SC.session_dir(sid))


def test_separator_sheet_is_a_real_printable_pdf_with_a_qr(firm):
    a = firm.team["asha"]
    r = a.get(f"{API}/scan/separator.pdf?count=3")
    assert r.status_code == 200 and r.mimetype == "application/pdf"
    d = fitz.open("pdf", r.data)
    assert d.page_count == 3 and "NEW DOCUMENT STARTS" in d[0].get_text()
    assert fitz.open("pdf", a.get(f"{API}/scan/separator.pdf?count=999").data).page_count == 20
    assert fitz.open("pdf", a.get(f"{API}/scan/separator.pdf?count=abc").data).page_count == 1
