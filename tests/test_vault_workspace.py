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
    body = "\n".join(p.text for p in Document(io.BytesIO(dl.data)).paragraphs)
    assert "Revised bold and italic text." in body and "• one" in body
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
