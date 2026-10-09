"""Red-team fixes for the Document Hub: wrong-case auto-filing, restart recovery, bad encryption key, ..."""
from conftest import make_pdf
from test_dms_files_filing import API, case_of, new_case, order, settle


def _pending(a):
    return {i["doc"]["id"]: i for i in a.ok(a.get(f"{API}/filing?state=pending"))["items"]}


def test_document_without_a_court_is_never_auto_filed(firm):
    a = firm.team["asha"]
    c = new_case(a)                                    # Delhi High Court, WP(C) 1234/2024, Rajesh Kumar
    did = a.upload("nocourt.pdf", make_pdf([order(court="", extra="nocourt alpaca")])).get_json()["doc"]["id"]
    settle(a, did)
    assert case_of(a, did) == "General"
    it = _pending(a)[did]
    assert not it["confident"] and it["candidates"][0]["ref"] == f"lpms:{c}"


def test_other_court_same_number_same_party_is_not_auto_filed(firm):
    a = firm.team["asha"]
    c = new_case(a)
    did = a.upload("bom.pdf", make_pdf([order(court="IN THE HIGH COURT OF BOMBAY", extra="bombay alpaca")])).get_json()["doc"]["id"]
    settle(a, did)
    assert case_of(a, did) == "General"
    it = _pending(a)[did]
    assert not it["confident"] and it["candidates"][0]["ref"] == f"lpms:{c}"


def test_a_cited_case_number_does_not_pull_the_document_onto_that_case(firm):
    a = firm.team["asha"]
    cited = new_case(a)                                # WP(C) 1234/2024, Delhi
    own = new_case(a, case_no="WP(C) 4321/2023", title="Meena Rao v. State", opposite_party="State", force=True)
    body = order(number="W.P.(C) 4321/2023", petitioner="Meena Rao", respondent="State of Delhi",
                 extra="Reliance is placed on WP(C) 1234/2024 decided earlier. citedcase alpaca")
    did = a.upload("cite.pdf", make_pdf([body])).get_json()["doc"]["id"]
    settle(a, did)
    assert case_of(a, did) == f"lpms:{own}"
    # and when only the cited case exists, it is not filed there
    a2 = firm.team["asha"]
    did2 = a2.upload("cite2.pdf", make_pdf([order(number="W.P.(C) 9999/2022", petitioner="Zed Qux", respondent="Wen Lar",
                                                  extra="Compare WP(C) 1234/2024 cited. citedcase2 alpaca")])).get_json()["doc"]["id"]
    settle(a2, did2)
    assert case_of(a2, did2) != f"lpms:{cited}"


# ── restart while processing ─────────────────────────────────────────────────────────
import os
import subprocess
import sys
import time

from test_dms_rules import up


def _dead_pid():
    p = subprocess.Popen([sys.executable, "-c", "pass"])
    p.wait()
    return p.pid


def test_restart_requeues_a_job_left_running_by_a_dead_process_but_not_a_live_one(hub):
    from utils import dms_index as I, dms_worker as W
    a = hub.client(1)
    did = up(a, "n.txt", b"resilient text words")
    c = I.connect(hub.db_path)
    try:
        def claim_as(wid):          # "claimed 3 seconds ago" - far younger than any stale window
            c.execute("UPDATE dms_jobs SET status='running', locked_by=?, locked_at=?, attempts=1 WHERE doc_id=?", (wid, time.time() - 3, did))
            c.execute("UPDATE dms_docs SET status='processing' WHERE doc_id=?", (did,))
            c.commit()
        claim_as(f"{W._HOST}:{os.getpid()}-7")                    # a live worker of this very process
        assert W.recover_stale(c) == 0
        claim_as(f"{W._HOST}:{os.getpid() + 0}-7".replace(str(os.getpid()), str(_dead_pid())))    # its process died in the restart
        assert W.recover_stale(c) == 1
        assert c.execute("SELECT status FROM dms_jobs WHERE doc_id=?", (did,)).fetchone()[0] == "queued"
        claim_as("otherhost:1-0")                                  # unknown machine: only its heartbeat can tell
        assert W.recover_stale(c) == 0
        c.execute("UPDATE dms_jobs SET locked_at=? WHERE doc_id=?", (time.time() - W.STALE_SECONDS - 5, did))
        c.commit()
        assert W.recover_stale(c) == 1
    finally:
        c.close()
    t0 = time.time()
    hub.bp.worker.kick()
    a.wait(did)
    assert a.get(f"/api/dms/docs/{did}").get_json()["doc"]["status"] == "ready" and time.time() - t0 < 30


# ── encryption key problems ──────────────────────────────────────────────────────────
def test_invalid_encryption_key_gives_a_clear_upload_error_not_a_crash(hub, monkeypatch):
    a = hub.client(1)
    monkeypatch.setenv("DMS_ENCRYPTION_KEY", "this-is-not-a-fernet-key")
    r = a.upload("k.pdf", make_pdf(["key doc"]))
    assert r.status_code == 503
    msg = r.get_json()["message"]
    assert "DMS_ENCRYPTION_KEY" in msg and "invalid" in msg.lower()


def test_zip_with_wrong_key_says_the_key_does_not_match(hub_factory, monkeypatch):
    import io
    import zipfile
    from cryptography.fernet import Fernet
    h = hub_factory(encryption_key=Fernet.generate_key().decode())
    a = h.client(1)
    did = up(a, "s.pdf", make_pdf(["enc doc"]))
    monkeypatch.setenv("DMS_ENCRYPTION_KEY", Fernet.generate_key().decode())
    r = a.post("/api/dms/download-zip", json={"ids": [did]})
    assert r.status_code == 200
    z = zipfile.ZipFile(io.BytesIO(r.data))
    note = [n for n in z.namelist() if n.endswith(".MISSING.txt")]
    assert note and "does not match" in z.read(note[0]).decode()


# ── truncated PDFs ───────────────────────────────────────────────────────────────────
def test_truncated_pdf_is_flagged_but_a_whole_one_is_not(hub):
    a = hub.client(1)
    pdf = make_pdf([("Page %d heading text about contract terms and conditions here. " % i) * 20 for i in range(1, 7)])
    whole = up(a, "whole.pdf", pdf)
    cut = up(a, "cut.pdf", pdf[: len(pdf) // 3])
    d_whole = a.get(f"/api/dms/docs/{whole}").get_json()["doc"]
    d_cut = a.get(f"/api/dms/docs/{cut}").get_json()["doc"]
    assert d_whole["status"] == "ready" and not any("damaged" in w for w in d_whole["warnings"])
    assert d_cut["status"] in ("ready_partial", "failed") or any("damaged" in w for w in d_cut["warnings"])
    assert any("damaged" in w for w in d_cut["warnings"]) or d_cut["status"] == "failed"


# ── Indic scans read with an English-only OCR engine ─────────────────────────────────
def test_latin_junk_from_an_indic_scan_is_flagged_and_normal_english_is_not():
    from utils import dms_extract as X
    junk = ("Qw Ge Lo Gis ii a Ly ao tt Bm Cn rs Ul Op ey Lk xt Pz mm Ts Oo Ab Vv Hh 8 Uu fl Dr Wn Qs ii Ge Lo " * 3)
    english = ("The petitioner submits that the order passed by the learned court is contrary to the settled law and the respondent "
               "shall file a reply within four weeks from the date of this order. Learned counsel for the parties were heard at length. ") * 2
    invoice = "Invoice 4411 2024 Qty 12 Rate 450.00 Total 5400.00 GST 18% Net 6372.00 Ref AB 12 Cd 34 " * 6
    assert X.looks_like_latin_garbage(junk)
    assert not X.looks_like_latin_garbage(english)
    assert not X.looks_like_latin_garbage(invoice)
    assert not X.looks_like_latin_garbage("short text")

    def finish(text, langs):
        r = X.Extracted(page_count=1, ocr_pages=1)
        r.pages, r.ocr_texts = [(1, text)], [text]
        X._finish_pages(r, {"available": True, "langs": langs})
        return r
    assert any("gibberish" in w for w in finish(junk, "eng").warnings)
    assert not any("gibberish" in w for w in finish(junk, "eng+hin+tam").warnings)
    assert not any("gibberish" in w for w in finish(english, "eng").warnings)
    assert finish(junk, "eng").status == "ready"          # a warning, not a failure: nothing that worked before breaks
