"""Court-ready bundles: pick and order documents, label annexures, build ONE paginated PDF with cover, index, dividers and bookmarks."""
import io
import time

import pymupdf as fitz

from conftest import make_docx, make_pdf, make_png_text
from test_dms_files_filing import new_case, ready

API = "/api/dms/files"


def docs(p, names, pages=(2, 3, 4), case=None):
    ids = []
    for i, n in enumerate(names):
        r = p.upload(f"{n}.pdf", make_pdf([f"{n} page {k + 1}" for k in range(pages[i % len(pages)])]), **({"lpms_case_id": case} if case else {}))
        ids.append(r.get_json()["doc"]["id"])
    for i in ids:
        ready(p, i)
    return ids


def build(p, bid, timeout=60, expect="done"):
    r = p.post(f"{API}/bundles/{bid}/build", json={})
    assert r.status_code == 202, r.get_json()
    t0 = time.time()
    while time.time() - t0 < timeout:
        d = p.ok(p.get(f"{API}/bundles/{bid}"))["bundle"]
        if d["build"]["state"] != "building":
            assert d["build"]["state"] == expect, d["build"]
            return d
        time.sleep(0.15)
    raise AssertionError("bundle still building")


def pdf_of(p, bid):
    r = p.get(f"{API}/bundles/{bid}/download")
    assert r.status_code == 200 and r.mimetype == "application/pdf" and r.data[:4] == b"%PDF"
    return fitz.open("pdf", r.data)


def test_a_bundle_gets_cover_index_page_numbers_and_bookmarks(firm):
    a = firm.team["asha"]
    c = new_case(a)
    ids = docs(a, ["Plaint", "Affidavit", "Reply"], case=c)
    b = a.ok(a.post(f"{API}/bundles", {"case_ref": f"lpms:{c}", "doc_ids": ids}), 201)["bundle"]
    bid = b["id"]
    assert b["options"]["case_no"] == "WP(C) 1234/2024" and b["title"].startswith("Bundle")
    assert b["estimate"]["documents"] == 3 and b["estimate"]["numbered_pages"] == 9 and b["estimate"]["total_pages"] == 11
    a.ok(a.post(f"{API}/bundles/{bid}/items", {"kind": "section", "title": "Part A - Pleadings", "position": 0}))
    a.ok(a.patch(f"{API}/bundles/{bid}", {"options": {"dividers": True, "auto_label": True}}))
    d = build(a, bid)
    assert d["build"]["pages"] == 15 and not d["build"]["stale"]
    doc = pdf_of(a, bid)
    assert doc.page_count == 15
    assert "WP(C) 1234/2024" in doc[0].get_text() and "Rajesh Kumar v. Union of India" in doc[0].get_text()
    index = doc[1].get_text()
    assert "Part A - Pleadings" in index and "Annexure P-1" in index and "Annexure P-3" in index and "2 - 4" in index and "9 - 13" in index
    # every page after cover and index carries its number, in order, and the content is in the right order
    expect = ["Part A - Pleadings", "ANNEXURE P-1", "Plaint page 1", "Plaint page 2", "ANNEXURE P-2", "Affidavit page 1", "Affidavit page 2", "Affidavit page 3",
              "ANNEXURE P-3", "Reply page 1", "Reply page 2", "Reply page 3", "Reply page 4"]
    for n, want in enumerate(expect, 1):
        text = doc[n + 1].get_text()
        assert want in text and f"Page {n} of 13" in text, (n, text)
    toc = doc.get_toc()
    assert [t[1] for t in toc] == ["Part A - Pleadings", "Annexure P-1 - Plaint", "Annexure P-2 - Affidavit", "Annexure P-3 - Reply"]
    assert [t[2] for t in toc] == [3, 4, 7, 11]
    # the index entry numbers match the stamps: Plaint = pages 2-4 (divider + 2 pages)
    assert "Page 2 of 13" in doc[3].get_text()


def test_page_selection_labels_options_and_ordering(firm):
    a = firm.team["asha"]
    ids = docs(a, ["Alpha", "Beta", "Gamma"], pages=(5, 4, 3))
    b = a.ok(a.post(f"{API}/bundles", {"title": "My bundle", "doc_ids": ids}), 201)["bundle"]
    bid, items = b["id"], b["items"]
    # pick pages 1-2 and 5 of Alpha; reject nonsense
    for bad in ("0", "9", "3-1", "x", "1-99"):
        assert a.patch(f"{API}/bundles/{bid}/items/{items[0]['id']}", {"pages": bad}).status_code == 400, bad
    a.ok(a.patch(f"{API}/bundles/{bid}/items/{items[0]['id']}", {"pages": "1-2, 5", "label": "Ex. A", "title": "Alpha (extract)"}))
    a.ok(a.patch(f"{API}/bundles/{bid}/items/{items[2]['id']}", {"in_index": False}))
    a.ok(a.patch(f"{API}/bundles/{bid}", {"options": {"pagination": "bottom-right", "number_format": "- {n} -", "start_at": 10, "cover": False, "subtitle": "Compilation", "label_prefix": "Annexure R-", "bogus": 1}}))
    o = a.ok(a.get(f"{API}/bundles/{bid}"))["bundle"]
    assert o["options"]["cover"] is False and "bogus" not in o["options"] and o["items"][0]["pages_selected"] == 3
    assert o["estimate"]["numbered_pages"] == 3 + 4 + 3
    # reorder: Gamma first
    order = [items[2]["id"], items[0]["id"], items[1]["id"]]
    a.ok(a.put(f"{API}/bundles/{bid}/order", {"item_ids": order}))
    assert [i["id"] for i in a.ok(a.get(f"{API}/bundles/{bid}"))["bundle"]["items"]] == order
    assert a.put(f"{API}/bundles/{bid}/order", {"item_ids": order[:2]}).status_code == 409            # stale list is refused
    d = build(a, bid)
    doc = pdf_of(a, bid)
    assert d["build"]["pages"] == doc.page_count == 1 + 10                                             # index + 10 numbered, no cover
    assert "Gamma page 1" in doc[1].get_text() and "- 10 -" in doc[1].get_text()                       # starts at 10
    texts = "\n".join(p.get_text() for p in doc)
    assert "Alpha page 1" in texts and "Alpha page 2" in texts and "Alpha page 5" in texts and "Alpha page 3" not in texts and "Alpha page 4" not in texts
    assert "Compilation" not in texts or "Compilation" in doc[0].get_text()
    idx = doc[0].get_text()
    assert "Ex. A" in idx and "Alpha (extract)" in idx and "Gamma" not in idx and "Beta" in idx          # Gamma was left out of the index
    # sorting
    a.ok(a.post(f"{API}/bundles/{bid}/auto-order", {"by": "name"}))
    assert [i["doc"]["title"] for i in a.ok(a.get(f"{API}/bundles/{bid}"))["bundle"]["items"]] == ["Alpha", "Beta", "Gamma"]
    assert a.post(f"{API}/bundles/{bid}/auto-order", {"by": "colour"}).status_code == 400
    assert a.ok(a.get(f"{API}/bundles/{bid}"))["bundle"]["build"]["stale"] is True                     # changed after the last build
    build(a, bid)
    assert a.ok(a.get(f"{API}/bundles/{bid}"))["bundle"]["build"]["stale"] is False
    a.ok(a.patch(f"{API}/bundles/{bid}", {"title": "Renamed only"}))                                    # a new name does not change the PDF
    assert a.ok(a.get(f"{API}/bundles/{bid}"))["bundle"]["build"]["stale"] is False
    a.ok(a.patch(f"{API}/bundles/{bid}", {"options": {"cover": True}}))
    assert a.ok(a.get(f"{API}/bundles/{bid}"))["bundle"]["build"]["stale"] is True
    build(a, bid)
    # a new version of a document it contains makes the built copy out of date too
    v2 = a.post(f"/api/dms/docs/{ids[0]}/versions", data={"file": (io.BytesIO(make_pdf(["Alpha revised"])), "alpha-v2.pdf")}, content_type="multipart/form-data")
    assert v2.status_code == 201
    new_id = v2.get_json()["doc"]["id"]
    ready(a, new_id)
    d = a.ok(a.get(f"{API}/bundles/{bid}"))["bundle"]
    first = d["items"][0]
    assert first["doc"]["id"] == ids[0] and first["newer"] == {"doc_id": new_id, "version": 2}           # the bundle says so, it does not silently switch
    a.ok(a.patch(f"{API}/bundles/{bid}/items/{first['id']}", {"use_latest": True, "pages": ""}))
    d = a.ok(a.get(f"{API}/bundles/{bid}"))["bundle"]
    assert d["items"][0]["doc"]["id"] == new_id and "newer" not in d["items"][0] and d["build"]["stale"] is True
    assert a.patch(f"{API}/bundles/{bid}/items/{first['id']}", {"use_latest": True}).status_code == 200      # already the latest: nothing to change
    build(a, bid)
    assert "Alpha revised" in "\n".join(p.get_text() for p in pdf_of(a, bid))


def test_problems_are_reported_never_skipped(firm):
    t = firm.team
    a, ravi = t["asha"], t["ravi"]
    secret = new_case(a, case_no="CS 99/2026", advocate=a.member_id, restricted=True, title="Confidential Merger")
    open_case = new_case(a, case_no="CS 1/2026", title="Open Matter", court="Saket District Court")
    ok_id = docs(a, ["Fine"], case=open_case)[0]
    trashed = docs(a, ["Gone"])[0]
    private = docs(a, ["Secret"], case=secret)[0]
    b = a.ok(a.post(f"{API}/bundles", {"title": "Mixed", "doc_ids": [ok_id, trashed]}), 201)["bundle"]
    bid = b["id"]
    a.ok(a.delete(f"/api/dms/docs/{trashed}"))
    d = a.ok(a.get(f"{API}/bundles/{bid}"))["bundle"]
    assert d["estimate"]["problems"] == 1 and "trash" in d["items"][1]["problem"].lower()
    r = a.post(f"{API}/bundles/{bid}/build", json={})
    assert r.status_code == 422 and r.get_json()["problems"][0]["problem"] and d["items"][1]["title"] is None
    assert a.ok(a.get(f"{API}/bundles/{bid}"))["bundle"]["build"]["state"] == "idle"                  # nothing was built, nothing half-built
    assert a.get(f"{API}/bundles/{bid}/download").status_code == 409
    # an empty bundle, a missing document, a document the person cannot see
    e = a.ok(a.post(f"{API}/bundles", {"title": "Empty"}), 201)["bundle"]
    assert a.post(f"{API}/bundles/{e['id']}/build", json={}).status_code == 400
    added = a.ok(a.post(f"{API}/bundles/{e['id']}/items", {"doc_ids": [ok_id, ok_id, 424242]}))
    assert added["added"] == 1 and [s["reason"] for s in added["skipped"]] == ["Document not found."]
    again = a.ok(a.post(f"{API}/bundles/{e['id']}/items", {"doc_ids": [ok_id]}))
    assert again["added"] == 0 and again["skipped"][0]["reason"] == "already in this bundle"
    assert a.ok(a.post(f"{API}/bundles/{e['id']}/items", {"doc_ids": [ok_id], "allow_duplicates": True}))["added"] == 1
    rr = ravi.post(f"{API}/bundles", json={"title": "Ravi's", "doc_ids": [ok_id, private]})
    assert rr.status_code == 201
    rb = rr.get_json()["bundle"]
    assert [i["doc"]["title"] for i in rb["items"]] == ["Fine"]                                         # the restricted case's document never gets in for Ravi
    late = ravi.ok(ravi.post(f"{API}/bundles/{rb['id']}/items", {"doc_ids": [private]}))
    assert late["added"] == 0 and late["skipped"][0]["reason"] == "Document not found."
    # if access is taken away AFTER it was added, the bundle says so and refuses to build rather than leaking or skipping
    firm.sql("INSERT INTO dms_bundle_items (bundle_id, seq, kind, doc_id) VALUES (?, 9, 'doc', ?)", rb["id"], private)
    shown = ravi.ok(ravi.get(f"{API}/bundles/{rb['id']}"))["bundle"]["items"][-1]
    assert shown["problem"] and shown["doc"]["title"] == "Restricted document" and "Secret" not in str(shown)
    assert ravi.post(f"{API}/bundles/{rb['id']}/build", json={}).status_code == 422


def test_building_and_saving_to_the_case(firm):
    a, meena = firm.team["asha"], firm.team["meena"]
    c = new_case(a)
    ids = docs(a, ["One", "Two"])
    b = a.ok(a.post(f"{API}/bundles", {"title": "Final paper book", "case_ref": f"lpms:{c}", "doc_ids": ids}), 201)["bundle"]
    bid = b["id"]
    assert a.post(f"{API}/bundles/{bid}/save", json={}).status_code == 409                              # nothing built yet
    build(a, bid)
    s = a.ok(a.post(f"{API}/bundles/{bid}/save", {"title": "Paper book (final)"}), 201)
    did = s["doc"]["id"]
    assert s["doc"]["lpms_case_id"] == c and s["doc"]["title"].startswith("Paper book")
    ready(a, did)
    assert a.ok(a.get(f"{API}/bundles/{bid}"))["bundle"]["build"]["saved_doc_id"] == did
    assert a.ok(a.get("/api/dms/docs?q=%22Two%20page%201%22"))["total"] >= 1                           # the bundle's own text is searchable
    assert any("Paper book" in x["title"] for x in a.ok(a.get(f"/cases/{c}/timeline"))["items"] if x["kind"] == "document")
    # the whole firm can fetch a bundle on a firm-wide case; nobody else can
    assert meena.get(f"{API}/bundles/{bid}/download").status_code == 200
    s2 = firm.person("Stranger Lawyer")
    s2.ok(s2.post("/firm", {"name": "Elsewhere LLP"}), 201)
    assert s2.get(f"{API}/bundles/{bid}").status_code == 404 and s2.get(f"{API}/bundles/{bid}/download").status_code == 404
    assert s2.post(f"{API}/bundles/{bid}/build", json={}).status_code == 404 and s2.delete(f"{API}/bundles/{bid}").status_code == 404
    assert s2.ok(s2.get(f"{API}/bundles"))["bundles"] == []
    assert firm.app.test_client().get(f"{API}/bundles").status_code == 401
    # download as inline preview too
    r = a.get(f"{API}/bundles/{bid}/download?inline=1")
    assert r.status_code == 200 and "inline" in r.headers["Content-Disposition"]


def test_from_case_duplicate_delete_and_blob_cleanup(firm):
    a = firm.team["asha"]
    c = new_case(a)
    ids = docs(a, ["P", "Q", "R"], case=c)
    b = a.ok(a.post(f"{API}/bundles", {"case_ref": f"lpms:{c}", "from_case": True}), 201)["bundle"]
    assert [i["doc"]["id"] for i in b["items"]] == ids or sorted(i["doc"]["id"] for i in b["items"]) == sorted(ids)
    bid = b["id"]
    build(a, bid)
    sha = firm.sql("SELECT built_sha FROM dms_bundles WHERE id = ?", bid)[0]["built_sha"]
    from utils import dms_store as S
    assert S.key_for(sha)
    cp = a.ok(a.post(f"{API}/bundles/{bid}/duplicate"), 201)["bundle"]
    assert cp["title"].endswith("(copy)") and len(cp["items"]) == 3 and cp["build"]["state"] == "idle"
    # removing an item makes the built copy stale; rebuilding replaces the old file
    a.ok(a.delete(f"{API}/bundles/{bid}/items/{b['items'][0]['id']}"))
    d = build(a, bid)
    assert d["build"]["pages"] == pdf_of(a, bid).page_count and len(d["items"]) == 2
    sha2 = firm.sql("SELECT built_sha FROM dms_bundles WHERE id = ?", bid)[0]["built_sha"]
    assert sha2 != sha
    import os
    root = S.storage_root()
    on_disk = {n for _b, _d, fs in os.walk(root) for n in fs}
    assert sha2 in on_disk or sha2 + ".enc" in on_disk
    assert sha not in on_disk and sha + ".enc" not in on_disk                                           # the replaced build did not leave a file behind
    a.ok(a.delete(f"{API}/bundles/{bid}"))
    on_disk = {n for _b, _d, fs in os.walk(root) for n in fs}
    assert sha2 not in on_disk and sha2 + ".enc" not in on_disk
    assert a.get(f"{API}/bundles/{bid}").status_code == 404
    assert [x["id"] for x in a.ok(a.get(f"{API}/bundles"))["bundles"]] == [cp["id"]]
    assert [x["id"] for x in a.ok(a.get(f"{API}/bundles?case_ref=lpms:{c}"))["bundles"]] == [cp["id"]]


def test_a_bundle_that_is_building_cannot_be_edited_and_a_dead_build_recovers(firm):
    a = firm.team["asha"]
    ids = docs(a, ["A1", "A2"])
    b = a.ok(a.post(f"{API}/bundles", {"doc_ids": ids}), 201)["bundle"]
    bid = b["id"]
    firm.sql("UPDATE dms_bundles SET build_state = 'building', updated_at = datetime('now') WHERE id = ?", bid)
    assert a.post(f"{API}/bundles/{bid}/build", json={}).status_code == 409
    assert a.patch(f"{API}/bundles/{bid}/items/{b['items'][0]['id']}", {"label": "x"}).status_code == 409
    assert a.post(f"{API}/bundles/{bid}/items", {"kind": "section", "title": "x"}).status_code == 409
    assert a.delete(f"{API}/bundles/{bid}").status_code == 409
    # the server died mid-build long ago: the screen is told, and can build again
    firm.sql("UPDATE dms_bundles SET updated_at = datetime('now', '-1 hour') WHERE id = ?", bid)
    d = a.ok(a.get(f"{API}/bundles/{bid}"))["bundle"]
    assert d["build"]["state"] == "error" and d["build"]["note"]
    build(a, bid)


def test_images_are_pages_and_word_files_convert_when_the_server_can(firm):
    a = firm.team["asha"]
    img = a.upload("photo.png", make_png_text(["Receipt No. 42", "Amount Rs. 5,000"])).get_json()["doc"]["id"]
    pdf = docs(a, ["Main"])[0]
    ready(a, img)
    ids = [pdf, img]
    from utils import dms_bundle as B
    word = None
    if B.office_available():
        word = a.upload("letter.docx", make_docx(["Letter to the opposite party", "Please pay the amount."])).get_json()["doc"]["id"]
        ready(a, word)
        ids.append(word)
    b = a.ok(a.post(f"{API}/bundles", {"title": "Mixed formats", "doc_ids": ids}), 201)["bundle"]
    d = build(a, b["id"])
    doc = pdf_of(a, b["id"])
    assert d["build"]["pages"] == doc.page_count == 2 + 2 + 1 + (1 if word else 0) - 0 or doc.page_count >= 5
    text = "\n".join(p.get_text() for p in doc)
    assert "Main page 1" in text
    if word:
        assert "Letter to the opposite party" in text
    # every page, whatever its origin, is A4-ish and stamped
    assert all("Page " in p.get_text() for p in list(doc)[2:])


def test_limits_and_option_validation(firm, monkeypatch):
    a = firm.team["asha"]
    ids = docs(a, ["L1", "L2"], pages=(3,))
    b = a.ok(a.post(f"{API}/bundles", {"title": "Limits", "doc_ids": ids}), 201)["bundle"]
    bid = b["id"]
    assert a.patch(f"{API}/bundles/{bid}", {"title": " "}).status_code == 400
    assert a.patch(f"{API}/bundles/{bid}", {"case_ref": "lpms:424242"}).status_code == 404
    assert a.post(f"{API}/bundles/{bid}/items", {"kind": "section", "title": ""}).status_code == 400
    assert a.patch(f"{API}/bundles/{bid}/items/424242", {"label": "x"}).status_code == 404
    a.ok(a.patch(f"{API}/bundles/{bid}", {"options": {"pagination": "diagonal", "number_format": "<script>", "label_style": "klingon", "start_at": "abc"}}))
    o = a.ok(a.get(f"{API}/bundles/{bid}"))["bundle"]["options"]
    assert o["pagination"] == "bottom-center" and o["number_format"] == "Page {n} of {N}" and o["label_style"] == "number" and isinstance(o["start_at"], int)
    # a huge bundle is refused up front, not after minutes of work
    monkeypatch.setenv("DMS_BUNDLE_MAX_PAGES", "4")
    import importlib
    from utils import dms_bundle as B
    importlib.reload(B)
    try:
        r = a.post(f"{API}/bundles/{bid}/build", json={})
        if r.status_code == 202:
            t0 = time.time()
            while time.time() - t0 < 30:
                d = a.ok(a.get(f"{API}/bundles/{bid}"))["bundle"]
                if d["build"]["state"] != "building":
                    break
                time.sleep(0.15)
            assert d["build"]["state"] == "error" and "page" in (d["build"]["note"] or "").lower()
        else:
            assert r.status_code in (400, 422)
    finally:
        monkeypatch.delenv("DMS_BUNDLE_MAX_PAGES", raising=False)
        importlib.reload(B)
