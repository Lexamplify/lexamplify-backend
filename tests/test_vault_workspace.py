"""
Case Vault workspace inside the REAL Flask app: overview numbers and the timeline come from real rows (zeros for a new user),
Practice cases show up, uploads/folders work, and the in-app viewer (inline file, editable text, save-as-DOCX, AI assistant)
is private to the owner.
"""
import importlib
import io
import os
import sys
import time
import uuid
from datetime import timedelta

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from conftest import ORDER_TEXT, make_pdf  # noqa: E402
from utils import lpms_store as L  # noqa: E402

PASSWORD = "TestPass123!"


@pytest.fixture(scope="module")
def real(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("real_vault_ws")
    mp = pytest.MonkeyPatch()
    old_cwd = os.getcwd()
    os.chdir(tmp)
    mp.setenv("JWT_SECRET_KEY", "test-secret-key-for-the-real-app-vault-workspace")
    mp.setenv("GROQ_API_KEY", "dummy")
    mp.setenv("DATABASE_URL", f"sqlite:///{tmp}/users.db")
    mp.setenv("DMS_STORAGE_DIR", str(tmp / "files"))
    mp.setenv("DMS_WORKERS", "1")
    mp.setenv("DMS_RATE_LIMIT", "5000 per minute")
    mp.setenv("LPMS_RATE_LIMIT", "5000 per minute")
    mp.setenv("LPMS_SCHEDULER", "0")
    import app as app_module
    importlib.reload(app_module)
    flask_app = app_module.create_app()
    flask_app.config.update(TESTING=True)
    # never reach for the network: the AI call fails instantly and the viewer must fall back to a plain read-out
    import utils.ai_helper as ai
    mp.setattr(ai, "ask_groq", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no network in tests")))
    yield flask_app, app_module
    try:
        app_module._DMS_BP.worker.stop(timeout=10)
    finally:
        os.chdir(old_cwd)
        mp.undo()


@pytest.fixture(autouse=True)
def fresh_allowances(real):
    from utils.limiter import limiter
    limiter.reset()


class Browser:
    def __init__(self, flask_app, name="Test Advocate"):
        self.c = flask_app.test_client()
        self.email = f"{uuid.uuid4().hex[:10]}@example.com"
        r = self.c.post("/api/auth/register", json={"email": self.email, "password": PASSWORD, "name": name})
        assert r.status_code == 201, r.get_json()
        self.uid = r.get_json()["user"]["id"]

    def csrf(self):
        ck = self.c.get_cookie("csrf_access_token")
        return {"X-CSRF-TOKEN": ck.value} if ck else {}

    def get(self, url, **kw):
        return self.c.get(url, **kw)

    def send(self, method, url, json=None, **kw):
        return getattr(self.c, method)(url, headers={**self.csrf(), **kw.pop("headers", {})}, json=json if json is not None else {}, **kw)

    def upload(self, name, data, folder_id=None):
        form = {"file": (io.BytesIO(data), name)}
        if folder_id:
            form["folder_id"] = str(folder_id)
        r = self.c.post("/api/vault/documents/upload", data=form, content_type="multipart/form-data", headers=self.csrf())
        assert r.status_code == 201, r.get_json()
        did = r.get_json()["id"]
        t0 = time.time()
        while time.time() - t0 < 60:
            d = self.c.get(f"/api/dms/docs/{did}").get_json()
            if d and d.get("doc") and d["doc"]["status"] not in ("queued", "processing"):
                break
            time.sleep(0.2)
        return did


def test_a_new_user_sees_zeros_and_an_empty_timeline_not_sample_data(real):
    u = Browser(real[0])
    o = u.get("/api/vault/overview").get_json()
    assert o["documents"] == 0 and o["matters"] == 0 and o["categories"] == 0 and o["drafts"] == 0
    assert o["documents_this_week"] == 0 and o["hearings_this_week"] == 0 and o["practice"] is False and o["case_docs"] == {}
    t = u.get("/api/vault/timeline").get_json()
    assert t["events"] == [] and t["practice"] is False


def test_practice_cases_hearings_and_documents_flow_into_the_vault_numbers_and_timeline(real):
    u = Browser(real[0], name="Asha Rao")
    assert u.send("post", "/api/practice/firm", {"name": "Rao & Associates"}).status_code == 201
    assert u.get("/api/vault/overview").get_json()["matters"] == 0
    soon = (L.today_ist() + timedelta(days=3)).isoformat()
    far = (L.today_ist() + timedelta(days=40)).isoformat()
    r = u.send("post", "/api/practice/cases", {"case_no": "OS 123/2025", "court": "City Civil Court, Chennai", "title": "Arun Kumar v. Sundaram Agencies",
                                                 "filing_date": "2025-06-21", "first_hearing": {"date": soon, "purpose": "Evidence"}})
    assert r.status_code == 201, r.get_json()
    cid = r.get_json()["case"]["id"]
    u.send("post", "/api/practice/cases", {"case_no": "OS 9/2026", "court": "City Civil Court, Chennai", "title": "Later Matter", "first_hearing": {"date": far}})
    o = u.get("/api/vault/overview").get_json()
    assert o["practice"] is True and o["matters"] == 2 and o["open_matters"] == 2 and o["hearings_this_week"] == 1 and o["next_hearing"] == soon
    pdf = make_pdf([ORDER_TEXT + "\nAnnexure for the vault"])
    form = {"file": (io.BytesIO(pdf), "order.pdf"), "lpms_case_id": str(cid)}
    d = u.c.post("/api/dms/upload", data=form, content_type="multipart/form-data", headers=u.csrf())
    assert d.status_code == 201, d.get_json()
    did = d.get_json()["doc"]["id"]
    t0 = time.time()
    while time.time() - t0 < 60 and u.c.get(f"/api/dms/docs/{did}").get_json()["doc"]["status"] in ("queued", "processing"):
        time.sleep(0.2)
    o = u.get("/api/vault/overview").get_json()
    assert o["documents"] == 1 and o["documents_this_week"] == 1 and o["case_docs"] == {str(cid): 1} and o["categories"] >= 0
    ev = u.get("/api/vault/timeline").get_json()["events"]
    kinds = {e["kind"] for e in ev}
    assert {"filing", "hearing", "document"} <= kinds, ev
    assert any(e["date"] == "2025-06-21" and e["case_id"] == cid for e in ev)
    deep = u.get("/api/vault/timeline?deep=1").get_json()["events"]
    assert any(e.get("extracted") and e["date"] == "2025-05-15" for e in deep), deep      # "List on 15.05.2025 for further hearing"
    assert [e["date"] for e in deep] == sorted(e["date"] for e in deep)


def test_a_restricted_matter_stays_out_of_a_juniors_timeline_and_numbers(real):
    flask_app, _ = real
    senior = Browser(flask_app, name="Senior")
    senior.send("post", "/api/practice/firm", {"name": "Firm"})
    jr_email = f"jr-{uuid.uuid4().hex[:6]}@example.com"
    assert senior.send("post", "/api/practice/members", {"name": "Junior One", "email": jr_email, "role": "junior", "password": "FirstPass123"}).status_code == 201
    senior.send("post", "/api/practice/cases", {"case_no": "SEC 1/2026", "court": "HC", "title": "Secret", "restricted": True, "filing_date": "2026-01-05"})
    senior.send("post", "/api/practice/cases", {"case_no": "OPEN 1/2026", "court": "HC", "title": "Open", "filing_date": "2026-01-06"})
    jr = flask_app.test_client()
    assert jr.post("/api/auth/login", json={"email": jr_email, "password": "FirstPass123"}).status_code == 200
    o = jr.get("/api/vault/overview").get_json()
    assert o["matters"] == 1
    titles = " ".join(e["label"] for e in jr.get("/api/vault/timeline").get_json()["events"])
    assert "Open" in titles and "Secret" not in titles
    assert senior.get("/api/vault/overview").get_json()["matters"] == 2


def test_folders_uploads_and_the_inline_viewer(real):
    u = Browser(real[0])
    f = u.send("post", "/api/vault/folders", {"name": "Evidence", "parent_id": None})
    assert f.status_code in (200, 201), f.get_json()
    fid = f.get_json().get("id") or f.get_json()["folder"]["id"]
    pdf = make_pdf([ORDER_TEXT])
    did = u.upload("order.pdf", pdf, folder_id=fid)
    v = u.get(f"/api/vault/documents/{did}/view")
    assert v.status_code == 200 and v.mimetype == "application/pdf" and v.headers["Content-Disposition"] == "inline" and v.data[:4] == b"%PDF"
    c = u.get(f"/api/vault/documents/{did}/content").get_json()
    assert c["ext"] == "pdf" and c["previewable"] is True and "Rajesh Kumar" in c["text"] and c["can_edit"] is True
    o = u.get("/api/vault/overview").get_json()
    assert o["documents"] == 1


def test_edit_save_as_docx_export_and_the_original_is_untouched(real):
    from docx import Document
    u = Browser(real[0])
    pdf = make_pdf([ORDER_TEXT])
    did = u.upload("order.pdf", pdf)
    html = "<h2>Order</h2><p>Revised <strong>bold</strong> and <em>italic</em> text.</p><ul><li>one</li><li>two</li></ul>"
    s = u.send("post", f"/api/vault/documents/{did}/save-edit", {"html": html})
    assert s.status_code == 201, s.get_json()
    new_id = s.get_json()["id"]
    assert new_id != did and s.get_json()["title"].endswith("(edited)")
    dl = u.get(f"/api/vault/documents/{new_id}/download")
    assert dl.status_code == 200
    paras = Document(io.BytesIO(dl.data)).paragraphs
    body = "\n".join(p.text for p in paras)
    assert "Revised bold and italic text." in body
    assert [p.text for p in paras if p.style.name == "List Bullet"] == ["one", "two"]          # a real Word list, not typed bullets
    again = u.send("post", f"/api/vault/documents/{did}/save-edit", {"html": "<p>second pass</p>", "target_id": new_id})
    assert again.status_code == 200 and again.get_json()["id"] == new_id and again.get_json()["created"] is False
    back = u.get(f"/api/vault/documents/{new_id}/content").get_json()
    assert back["ext"] == "docx" and "second pass" in back["text"] and back["edited_copy"] is True
    assert u.get(f"/api/vault/documents/{did}/view").data[:4] == b"%PDF"                       # the PDF itself is unchanged
    ex = u.send("post", f"/api/vault/documents/{did}/export-docx", {"html": html, "title": "Order copy"})
    assert ex.status_code == 200 and ex.headers["Content-Disposition"].startswith("attachment") and ex.data[:2] == b"PK"
    assert u.send("post", f"/api/vault/documents/{did}/save-edit", {"html": "  "}).status_code == 400


def test_assistant_answers_or_falls_back_to_a_plain_readout(real):
    u = Browser(real[0])
    did = u.upload("order.pdf", make_pdf([ORDER_TEXT]))
    r = u.send("post", f"/api/vault/documents/{did}/assistant", {"message": "What dates and deadlines are in this order?"})
    assert r.status_code == 200
    j = r.get_json()
    assert j["ai"] is False and "2025-05-15" in j["answer"] and "not reachable" in j["answer"]
    assert u.send("post", f"/api/vault/documents/{did}/assistant", {"message": " "}).status_code == 400


def test_other_users_cannot_open_edit_or_question_someone_elses_document(real):
    owner, other = Browser(real[0]), Browser(real[0])
    did = owner.upload("order.pdf", make_pdf([ORDER_TEXT]))
    for url in (f"/api/vault/documents/{did}/view", f"/api/vault/documents/{did}/content"):
        assert other.get(url).status_code == 404
    for tail, body in (("save-edit", {"html": "<p>x</p>"}), ("assistant", {"message": "hi"}), ("export-docx", {"html": "<p>x</p>"})):
        assert other.send("post", f"/api/vault/documents/{did}/{tail}", body).status_code == 404
    assert real[0].test_client().get(f"/api/vault/documents/{did}/view").status_code == 401
    assert other.get("/api/vault/overview").get_json()["documents"] == 0


# ── layout-faithful editing + Save As (Word / PDF / text) to any destination ─────────────────────────────────────
def _layout_pdf():
    pymupdf = pytest.importorskip("pymupdf")
    html = ('<body><p style="text-align:center"><b>IN THE CITY CIVIL COURT, CHENNAI</b></p>'
            '<p style="text-align:justify">Plaintiff is represented by Tmt. R. Meenakshi, Advocate. Defendant is represented by Thiru V. Karthikeyan, '
            'Advocate. Heard the learned counsel for both sides. The suit is posted today for the evidence of the plaintiff and the matter is part-heard. '
            'Next date: 20.11.2026.</p><p style="text-align:right"><b>XII Assistant Judge</b><br>22.09.2026</p></body>')
    st = pymupdf.Story(html=html, user_css="body{font-family:serif;font-size:12pt}p{margin:0 0 10pt 0}")
    import tempfile
    f = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    f.close()
    w = pymupdf.DocumentWriter(f.name)
    media = pymupdf.paper_rect("a4")
    more = 1
    while more:
        dev = w.begin_page(media)
        more, _ = st.place(media + (72, 72, -72, -72))
        st.draw(dev)
        w.end_page()
    w.close()
    data = open(f.name, "rb").read()
    os.remove(f.name)
    return data


def test_a_pdf_opens_in_the_editor_with_its_layout_not_flattened(real):
    u = Browser(real[0])
    did = u.upload("order.pdf", _layout_pdf())
    c = u.get(f"/api/vault/documents/{did}/content").get_json()
    assert c["source"] == "pdf" and c["has_original"] is True
    assert 'text-align:center' in c["html"] and 'text-align:right' in c["html"] and "<strong>" in c["html"]
    assert 'text-align:justify' not in c["html"] or "Plaintiff is represented" in c["html"]
    assert "XII Assistant Judge" in c["text"] and "20.11.2026" in c["text"]


def test_export_as_word_pdf_and_text(real):
    u = Browser(real[0])
    did = u.upload("n.pdf", make_pdf([ORDER_TEXT]))
    html = '<h2 style="text-align:center">Heading</h2><p>Body <strong>bold</strong> ₹500</p><ul><li><p>one</p></li></ul><table><tbody><tr><td><p>a</p></td><td><p>b</p></td></tr></tbody></table>'
    r = u.send("post", f"/api/vault/documents/{did}/export", {"html": html, "format": "docx", "title": "My: Notice?"})
    assert r.status_code == 200 and r.data[:2] == b"PK" and 'filename="My Notice.docx"' in r.headers["Content-Disposition"]
    r = u.send("post", f"/api/vault/documents/{did}/export", {"html": html, "format": "pdf", "title": "x"})
    assert r.status_code == 200 and r.data[:5] == b"%PDF-" and r.mimetype == "application/pdf"
    r = u.send("post", f"/api/vault/documents/{did}/export", {"html": html, "format": "txt", "title": "x"})
    assert r.status_code == 200 and "Heading" in r.data.decode("utf-8-sig") and "• one" in r.data.decode("utf-8-sig")
    assert u.send("post", f"/api/vault/documents/{did}/export", {"html": html, "format": "exe"}).status_code == 400
    assert u.send("post", f"/api/vault/documents/{did}/export", {"html": " ", "format": "pdf"}).status_code == 400


def test_save_as_to_vault_folder_hub_practice_and_firm_library(real):
    u = Browser(real[0], name="Meera Iyer")
    assert u.send("post", "/api/practice/firm", {"name": "Iyer Chambers"}).status_code == 201
    case = u.send("post", "/api/practice/cases", {"case_no": "OS 9/2026", "court": "City Civil Court, Chennai", "title": "A v. B", "filing_date": "2026-01-02"}).get_json()["case"]
    fid = u.send("post", "/api/vault/folders", {"name": "Drafts 2026"}).get_json()["id"]
    did = u.upload("order.pdf", make_pdf([ORDER_TEXT]))
    dest = u.get("/api/vault/destinations").get_json()
    assert any(f["id"] == fid and f["path"] == "Drafts 2026" for f in dest["folders"])
    assert dest["practice"]["enabled"] and any(c["id"] == case["id"] for c in dest["practice"]["cases"]) and dest["library"]["enabled"]
    html = "<p>Edited <strong>order</strong></p>"
    base = f"/api/vault/documents/{did}/save-as"

    r = u.send("post", base, {"html": html, "format": "pdf", "destination": "vault", "folder_id": fid, "title": "Order v2"})
    assert r.status_code == 201, r.get_json()
    j = r.get_json()
    assert j["filename"] == "Order v2.pdf" and j["location"] == "Case Vault / Drafts 2026" and j["format"] == "pdf"
    first = j["id"]
    raw = u.get(f"/api/vault/documents/{first}/view")
    assert raw.status_code == 200 and raw.data[:5] == b"%PDF-"
    again = u.send("post", base, {"html": "<p>second pass</p>", "format": "docx", "destination": "vault", "folder_id": fid, "target_id": first, "title": "Order v2"})
    assert again.status_code == 200 and again.get_json()["id"] == first and again.get_json()["created"] is False
    assert "second pass" in u.get(f"/api/vault/documents/{first}/content").get_json()["text"]

    h = u.send("post", base, {"html": html, "format": "txt", "destination": "hub", "title": "Hub copy"})
    assert h.status_code == 201 and h.get_json()["location"] == "Document Hub"
    p = u.send("post", base, {"html": html, "format": "docx", "destination": "practice", "practice_case_id": case["id"], "title": "For the matter"})
    assert p.status_code == 201 and p.get_json()["location"].startswith("Practice / A v. B")
    assert u.get("/api/vault/overview").get_json()["case_docs"].get(f"lpms:{case['id']}", u.get("/api/vault/overview").get_json()["case_docs"].get(str(case["id"]))) >= 1
    lib = u.send("post", base, {"html": html, "format": "docx", "destination": "library", "title": "Reusable order", "category": "Order"})
    assert lib.status_code == 201 and lib.get_json()["location"] == "Firm Library"
    titles = [d["title"] for d in u.get("/api/firm-library").get_json()]
    assert any("Reusable order" in t for t in titles)
    # each save lands exactly where it was pointed, and nowhere else
    saved = u.get("/api/firm-library/saved").get_json()
    assert [d["title"] for d in saved] == ["Reusable order"], saved
    assert saved[0]["category"] == "Order" and "Edited" in saved[0]["text"] and saved[0]["id"] == lib.get_json()["id"]
    docs = {d["id"]: d for d in u.get("/api/vault/meta").get_json()["documents"]}
    assert docs[first]["folder_id"] == fid and not docs[first]["doc_type"].startswith("Firm Library Draft")
    assert docs[lib.get_json()["id"]]["doc_type"].startswith("Firm Library Draft") and docs[lib.get_json()["id"]]["folder_id"] is None
    assert docs[p.get_json()["id"]]["folder_id"] is None and docs[h.get_json()["id"]]["folder_id"] is None
    other = Browser(real[0], name="Someone Else")
    assert other.get("/api/firm-library/saved").get_json() == []

    assert u.send("post", base, {"html": html, "format": "docx", "destination": "practice", "practice_case_id": 999999}).status_code == 404
    assert u.send("post", base, {"html": html, "format": "docx", "destination": "nowhere"}).status_code == 400
    assert u.send("post", base, {"html": html, "format": "docx", "destination": "vault", "folder_id": 99999999}).status_code == 403
    assert u.send("post", base, {"html": html, "format": "rtf", "destination": "vault"}).status_code == 400


def test_save_as_cannot_reach_other_users_folders_matters_or_documents(real):
    a, b = Browser(real[0], name="Owner"), Browser(real[0], name="Other")
    assert a.send("post", "/api/practice/firm", {"name": "Owner LLP"}).status_code == 201
    case = a.send("post", "/api/practice/cases", {"case_no": "OS 1/2026", "court": "HC", "title": "Private", "filing_date": "2026-01-02"}).get_json()["case"]
    fid = a.send("post", "/api/vault/folders", {"name": "Mine"}).get_json()["id"]
    did = a.upload("a.pdf", make_pdf([ORDER_TEXT]))
    dest = b.get("/api/vault/destinations").get_json()
    assert dest["folders"] == [] and dest["practice"]["enabled"] is False
    mine = f"/api/vault/documents/{did}/save-as"
    assert b.send("post", mine, {"html": "<p>x</p>", "format": "docx", "destination": "vault"}).status_code == 404
    other_doc = b.upload("b.pdf", make_pdf([ORDER_TEXT]))
    theirs = f"/api/vault/documents/{other_doc}/save-as"
    assert b.send("post", theirs, {"html": "<p>x</p>", "format": "docx", "destination": "vault", "folder_id": fid}).status_code == 403
    assert b.send("post", theirs, {"html": "<p>x</p>", "format": "docx", "destination": "practice", "practice_case_id": case["id"]}).status_code == 404
    assert b.send("post", f"/api/vault/documents/{did}/export", {"html": "<p>x</p>", "format": "pdf"}).status_code == 404


def test_autodraft_assistant_reads_the_canvas_draft_and_degrades_to_a_readout(real, monkeypatch):
    u = Browser(real[0])
    draft = "# MUTUAL NDA\n\n1. DEFINITIONS\n\n1.1 Terms.\n\n2. TERM\n\nThis runs from [Effective Date] for [Number] years."
    # AI down (fixture): honest plain read-out, never a 500
    r = u.send("post", "/api/documents/autodraft-assistant", {"message": "What details are still missing?", "document_text": draft})
    assert r.status_code == 200 and r.get_json()["ai"] is False
    assert "[Effective Date]" in r.get_json()["answer"] and "[Number]" in r.get_json()["answer"]
    # AI up: the draft and the selection reach the model, history is capped
    import utils.ai_helper as ai
    seen = {}
    monkeypatch.setattr(ai, "ask_groq", lambda system, prompt, *a, **k: seen.update(prompt=prompt) or "Add a cure period in clause 2.")
    hist = [{"role": "user" if i % 2 == 0 else "assistant", "content": f"m{i}"} for i in range(10)]
    r = u.send("post", "/api/documents/autodraft-assistant", {"message": "Review", "document_text": draft, "selection": "for [Number] years", "history": hist})
    assert r.json["ai"] is True and r.json["answer"].startswith("Add a cure")
    assert "MUTUAL NDA" in seen["prompt"] and "for [Number] years" in seen["prompt"] and "m9" in seen["prompt"] and "m3" not in seen["prompt"]
    # validation + login required
    assert u.send("post", "/api/documents/autodraft-assistant", {"message": "  "}).status_code == 400
    assert real[0].test_client().post("/api/documents/autodraft-assistant", json={"message": "hi"}).status_code in (401, 403)
