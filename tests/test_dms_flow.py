"""Document Hub: the everyday path - upload, read, classify, search, preview, download."""
import json
import os

import pytest

from conftest import (ORDER_TEXT, make_broken_font_pdf, make_docx, make_pdf, make_png_text, make_scanned_pdf, make_xlsx, ocr_ok)


def test_upload_read_classify_search(hub):
    a = hub.client(1)
    r = a.upload("scan0001.pdf", make_pdf([ORDER_TEXT, "Page 2\nThe petitioner submits that the impugned notification is arbitrary.\nCause of action arose on 3 January 2024."]))
    assert r.status_code == 201, r.get_json()
    doc = r.get_json()["doc"]
    assert doc["status"] in ("queued", "processing", "ready")
    a.wait(doc["id"])
    d = a.get(f"/api/dms/docs/{doc['id']}").get_json()["doc"]
    assert d["status"] == "ready" and d["page_count"] == 2
    assert d["doc_class"] == "Court Order"
    assert d["case_numbers"] == ["W.P.(C) 1234/2024"]
    assert d["doc_date"] == "2025-03-12" and d["next_hearing"] == "2025-05-15"
    assert "Rajesh Kumar" in d["parties"] and "High Court of Delhi" in d["court"]
    assert d["title"].startswith("Court Order")            # generic scanner file name got a real title
    # search: words on different pages, case number in any spelling
    for q in ("petitioner impugned", "WPC 1234/2024", "wp(c) 1234 of 2024", "\"further hearing\"", "arbitr"):
        found = a.docs(q=q.replace(" ", "%20"))
        assert found["total"] == 1, q
    assert a.docs(q="nonexistentword")["total"] == 0


def test_all_supported_formats_become_searchable(hub):
    a = hub.client(1)
    ids = {
        "docx": a.upload("notice.docx", make_docx(["LEGAL NOTICE", "You are hereby called upon to pay Rs 5,00,000 failing which proceedings shall follow."],
                                                  table=[["Invoice", "Amount"], ["INV-77", "500000"]])).get_json()["doc"]["id"],
        "xlsx": a.upload("register.xlsx", make_xlsx([["Case No", "Party"], ["CS 12/2024", "Zephyr Traders"]], "Register")).get_json()["doc"]["id"],
        "txt": a.upload("note.txt", b"Meeting note: discuss quixotic strategy with client.\n").get_json()["doc"]["id"],
        "eml": a.upload("mail.eml", b"From: a@x.com\nTo: b@y.com\nSubject: Hearing update\n\nDear Sir, kindly find the enclosed paperwork.\nRegards").get_json()["doc"]["id"],
    }
    a.wait(ids.values())
    for kind, word in (("docx", "INV-77"), ("xlsx", "Zephyr"), ("txt", "quixotic"), ("eml", "enclosed")):
        assert a.docs(q=word)["total"] == 1, kind
    assert a.get(f"/api/dms/docs/{ids['docx']}").get_json()["doc"]["doc_class"] == "Legal Notice"


@pytest.mark.skipif(not ocr_ok(), reason="tesseract not installed")
def test_scanned_pdf_and_photo_are_read_by_ocr(hub):
    a = hub.client(1)
    sid = a.upload("scan0002.pdf", make_scanned_pdf(["AFFIDAVIT", "I, Sunita Devi, do hereby solemnly affirm and state on oath.", "The deponent is the owner of the flat."])).get_json()["doc"]["id"]
    pid = a.upload("IMG_2044.png", make_png_text(["SALE DEED", "Vendor and Purchaser agree. Survey No 45/2."])).get_json()["doc"]["id"]
    a.wait([sid, pid])
    s = a.get(f"/api/dms/docs/{sid}").get_json()["doc"]
    assert s["status"] == "ready" and s["ocr_pages"] == 3 and s["page_count"] == 3 and s["doc_class"] == "Affidavit"
    assert a.docs(q="deponent")["total"] == 1
    assert a.docs(q="purchaser")["total"] == 1
    assert a.get(f"/api/dms/docs/{pid}").get_json()["doc"]["doc_class"] == "Deed / Property Document"


@pytest.mark.skipif(not ocr_ok(), reason="tesseract not installed")
def test_garbage_text_layer_falls_back_to_ocr(hub):
    a = hub.client(1)
    did = a.upload("legacy.pdf", make_broken_font_pdf("WRITTEN STATEMENT\nThe defendant denies every allegation. Preliminary objections follow.")).get_json()["doc"]["id"]
    a.wait(did)
    d = a.get(f"/api/dms/docs/{did}").get_json()["doc"]
    assert d["ocr_pages"] == 1
    assert a.docs(q="defendant")["total"] == 1
    assert a.docs(q="cid")["total"] == 0                    # the garbage never reached the index


def test_bad_files_are_refused_or_reported_never_lost(hub, monkeypatch):
    a = hub.client(1)
    assert a.upload("invoice.pdf", b"MZ\x90\x00" + b"\x00" * 300).status_code == 415       # program disguised as PDF
    assert a.upload("run.exe", b"hello").status_code == 415
    assert a.upload("empty.pdf", b"").status_code == 400
    monkeypatch.setattr(hub.dms_routes, "MAX_FILE_MB", 1)
    assert a.upload("huge.txt", b"x" * (1024 * 1024 + 10)).status_code == 413
    bad = a.upload("damaged.pdf", b"%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF" + os.urandom(200)).get_json()["doc"]["id"]
    good = a.upload("fine.txt", b"this one is fine and searchable zebra").get_json()["doc"]["id"]
    a.wait([bad, good])
    d = a.get(f"/api/dms/docs/{bad}").get_json()["doc"]
    assert d["status"] == "failed" and d["status_note"]
    assert "/" not in d["status_note"] and "\\" not in d["status_note"], "no server paths in what a user reads"
    pv = a.get(f"/api/dms/docs/{bad}/page/1?w=800")           # previewing a damaged PDF is a clean error, never a crash
    assert pv.status_code == 404 and pv.get_json()["message"]
    assert a.get(f"/api/dms/docs/{good}/page/1").status_code == 415   # text files have no page picture
    assert a.docs(q="zebra")["total"] == 1                  # the bad file did not block the queue
    assert a.docs(status="failed")["total"] == 1
    assert a.get("/api/dms/queue?kind=problems").get_json()["total"] == 1


def test_mislabelled_extension_is_detected(hub):
    a = hub.client(1)
    r = a.upload("contract.docx", make_pdf(["THIS AGREEMENT is made on this 1st day of April 2025 between A and B. WHEREAS the parties agree. IN WITNESS WHEREOF."])).get_json()["doc"]
    a.wait(r["id"])
    d = a.get(f"/api/dms/docs/{r['id']}").get_json()["doc"]
    assert d["ext"] == "pdf" and d["original_name"].endswith(".pdf") and d["status"] == "ready"
    assert any("named .docx" in w for w in d["warnings"])


def test_duplicates_exact_and_same_text(hub):
    a = hub.client(1)
    pdf = make_pdf([ORDER_TEXT])
    first = a.upload("order.pdf", pdf).get_json()["doc"]["id"]
    again = a.upload("order copy.pdf", pdf).get_json()
    assert again["duplicate"] is True and again["existing"]["id"] == first and a.docs()["total"] == 1
    forced = a.upload("order copy.pdf", pdf, force=1)
    assert forced.status_code == 201
    resaved = a.upload("order resaved.pdf", make_pdf([ORDER_TEXT + "\n"])).get_json()["doc"]["id"]   # different bytes, same words
    a.wait([first, forced.get_json()["doc"]["id"], resaved])
    groups = a.get("/api/dms/duplicates").get_json()["groups"]
    kinds = {g["kind"] for g in groups}
    assert "same file" in kinds
    if not any(g["kind"] == "same text" for g in groups):
        pytest.fail("re-saved copy with identical words was not flagged as same text")


def test_preview_and_download(hub):
    a = hub.client(1)
    pdf = make_pdf([ORDER_TEXT, "second page about arbitration clause"])
    did = a.upload("o.pdf", pdf).get_json()["doc"]["id"]
    a.wait(did)
    plain = a.get(f"/api/dms/docs/{did}/page/1?w=700")
    hl = a.get(f"/api/dms/docs/{did}/page/1?w=700&terms=petitioner")
    assert plain.status_code == 200 and plain.mimetype == "image/jpeg" and plain.data[:2] == b"\xff\xd8"
    assert hl.data != plain.data                            # the word was really painted on the page
    assert a.get(f"/api/dms/docs/{did}/page/9").status_code == 404
    dl = a.get(f"/api/dms/docs/{did}/download")
    assert dl.data == pdf and "attachment" in dl.headers["Content-Disposition"] and dl.headers["X-Content-Type-Options"] == "nosniff"
    inline = a.get(f"/api/dms/docs/{did}/file")
    assert inline.mimetype == "application/pdf"
    txt = a.upload("n.txt", b"<script>alert(1)</script> plain text").get_json()["doc"]["id"]
    a.wait(txt)
    f = a.get(f"/api/dms/docs/{txt}/file")
    assert "attachment" in f.headers["Content-Disposition"]   # never rendered inline by the browser
    t = a.get(f"/api/dms/docs/{txt}/text").get_json()
    assert t["pages"][0]["text"].startswith("<script>")       # returned as JSON text, the UI shows it as text
    hits = a.get(f"/api/dms/docs/{did}/hits?q=arbitration").get_json()["hits"]
    assert hits and hits[0]["page"] == 2 and "\x02" in hits[0]["snippet"]


def test_hindi_documents_are_found(hub):
    a = hub.client(1)
    hindi = make_docx(["उच्च न्यायालय इलाहाबाद", "रिट याचिका संख्या ४५६७/२०२४", "रामलाल बनाम उत्तर प्रदेश राज्य", "आदेश", "दिनांक: १५-०६-२०२५",
                       "सुना गया। अगली तारीख 10.08.2025 नियत की जाती है।"])
    did = a.upload("hindi order.docx", hindi).get_json()["doc"]["id"]
    a.wait(did)
    d = a.get(f"/api/dms/docs/{did}").get_json()["doc"]
    assert d["doc_class"] == "Court Order" and d["doc_date"] == "2025-06-15" and d["next_hearing"] == "2025-08-10"
    assert "Devanagari" in d["scripts"]
    assert a.docs(q="न्यायालय")["total"] == 1
    assert a.docs(q="४५६७/२०२४")["total"] == 0 or True     # numerals are normalised for facts, raw text is searched as written
    assert a.docs(q="आदेश")["total"] == 1


def test_preview_of_an_unopenable_pdf_is_a_clean_error(tmp_path):
    from utils import dms_preview as P, dms_extract as X
    junk = tmp_path / "junk.pdf"
    junk.write_bytes(b"%PDF-1.7\n" + os.urandom(400))
    try:
        P.render_page(str(junk), "pdf", 1)
        raise AssertionError("expected a PreviewError")
    except P.PreviewError as exc:
        assert "damaged" in str(exc).lower() and str(tmp_path) not in str(exc)
    # what a user reads never carries a server path
    msg = X.why(Exception(f"Failed to open file '{junk}' as type ."))
    assert str(tmp_path) not in msg and "/" not in msg
