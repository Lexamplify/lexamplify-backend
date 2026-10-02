"""
The Document Hub inside the REAL Flask app: registration in create_app(), login cookies + CSRF, CORS, the
per-user rate limit, and the old Case Vault screens working next to it.

Everything else in tests/test_dms_*.py drives the blueprint on a small app with Bearer tokens. This file is the
one that proves the wiring in app.py itself: it imports the real app, registers real users through the real
endpoint and then talks to /api/dms exactly as the browser does (HttpOnly cookie + X-CSRF-TOKEN header).

One app for the whole module: flask-limiter keeps a process-wide registry, and creating the app again for every
test would stack up copies of the hub's rate limit on it.
"""
import importlib
import io
import os
import sys
import time
import uuid

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from conftest import ORDER_TEXT, make_pdf  # noqa: E402

PASSWORD = "TestPass123!"
LIMIT = 90     # requests per minute, per user, for this module's app


@pytest.fixture(scope="module")
def real(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("real_app")
    mp = pytest.MonkeyPatch()
    old_cwd = os.getcwd()
    os.chdir(tmp)
    mp.setenv("JWT_SECRET_KEY", "test-secret-key-for-the-real-app-hub-tests")
    mp.setenv("GROQ_API_KEY", "dummy")
    mp.setenv("DATABASE_URL", f"sqlite:///{tmp}/users.db")          # accounts get their own throw-away database too
    mp.setenv("DMS_STORAGE_DIR", str(tmp / "files"))
    mp.setenv("DMS_WORKERS", "1")
    mp.setenv("DMS_RATE_LIMIT", f"{LIMIT} per minute")
    import app as app_module
    importlib.reload(app_module)                                     # rebinds app.py's module-level `db` to this folder
    flask_app = app_module.create_app()
    flask_app.config.update(TESTING=True)
    yield flask_app, app_module
    try:
        app_module._DMS_BP.worker.stop(timeout=10)
    finally:
        os.chdir(old_cwd)
        mp.undo()


class Browser:
    """A signed-in browser: cookies in the jar, CSRF header on anything that changes data."""
    def __init__(self, flask_app, email=None):
        self.c = flask_app.test_client()
        self.email = email or f"{uuid.uuid4().hex[:10]}@example.com"
        r = self.c.post("/api/auth/register", json={"email": self.email, "password": PASSWORD, "name": "Test Advocate"})
        assert r.status_code == 201, r.get_json()
        self.uid = r.get_json()["user"]["id"]

    def csrf(self):
        ck = self.c.get_cookie("csrf_access_token")
        return {"X-CSRF-TOKEN": ck.value} if ck else {}

    def get(self, url, **kw):
        return self.c.get(url, **kw)

    def send(self, method, url, **kw):
        headers = {**self.csrf(), **kw.pop("headers", {})}
        return getattr(self.c, method)(url, headers=headers, **kw)

    def upload(self, name, data, url="/api/dms/upload", csrf=True, **fields):
        return self.c.post(url, data={"file": (io.BytesIO(data), name), **fields}, content_type="multipart/form-data",
                           headers=self.csrf() if csrf else {})

    def wait(self, doc_id, timeout=60):
        t0 = time.time()
        while time.time() - t0 < timeout:
            d = self.get(f"/api/dms/docs/{doc_id}").get_json()["doc"]
            if d["status"] not in ("queued", "processing"):
                return d
            time.sleep(0.2)
        raise AssertionError("still processing")


@pytest.fixture(scope="module")
def alice(real):
    return Browser(real[0])


def test_the_hub_is_mounted_and_needs_a_login(real, alice):
    flask_app, _ = real
    assert "dms" in flask_app.blueprints
    assert flask_app.test_client().get("/api/dms/config").status_code == 401
    assert flask_app.test_client().get("/api/dms/docs").status_code == 401
    cfg = alice.get("/api/dms/config")
    assert cfg.status_code == 200 and cfg.get_json()["max_file_mb"] > 0


def test_upload_with_cookie_login_needs_the_csrf_header_and_then_works(real, alice):
    pdf = make_pdf([ORDER_TEXT + "\nreal app upload wombat"])
    refused = alice.upload("no-csrf.pdf", pdf, csrf=False)
    assert refused.status_code in (401, 422), "a cookie-authenticated upload without the CSRF header must be refused"
    r = alice.upload("order.pdf", pdf)
    assert r.status_code == 201, r.get_json()
    did = r.get_json()["doc"]["id"]
    d = alice.wait(did)
    assert d["status"] == "ready" and d["doc_class"] == "Court Order"
    hits = alice.get("/api/dms/docs?q=wombat").get_json()
    assert hits["total"] == 1 and hits["docs"][0]["id"] == did
    # another account sees nothing of it
    bob = Browser(real[0])
    assert bob.get("/api/dms/docs?q=wombat").get_json()["total"] == 0
    assert bob.get(f"/api/dms/docs/{did}").status_code == 404


def test_editing_a_document_uses_patch_and_the_browser_preflight_allows_it(real, alice):
    flask_app, app_module = real
    did = alice.upload("edit-me.pdf", make_pdf([ORDER_TEXT + "\nedit me kestrel"])).get_json()["doc"]["id"]
    alice.wait(did)
    r = alice.send("patch", f"/api/dms/docs/{did}", json={"tags": ["urgent"]})
    assert r.status_code == 200, r.get_json()
    origin = "https://test.lexamplify.com"
    assert origin in app_module.PROD_ORIGINS
    pre = flask_app.test_client().open(f"/api/dms/docs/{did}", method="OPTIONS", headers={
        "Origin": origin, "Access-Control-Request-Method": "PATCH", "Access-Control-Request-Headers": "content-type,x-csrf-token"})
    assert pre.status_code == 200
    allowed = {m.strip() for m in pre.headers["Access-Control-Allow-Methods"].split(",")}
    assert {"PATCH", "DELETE", "POST", "GET"} <= allowed, allowed
    assert pre.headers["Access-Control-Allow-Origin"] == origin and pre.headers["Access-Control-Allow-Credentials"] == "true"
    assert "x-csrf-token" in pre.headers["Access-Control-Allow-Headers"].lower()
    assert int(pre.headers["Access-Control-Max-Age"]) >= 60
    # a page on another site is not told it may read anything
    evil = flask_app.test_client().open(f"/api/dms/docs/{did}", method="OPTIONS", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert "Access-Control-Allow-Origin" not in evil.headers
    # the download's file name has to be readable by the page
    dl = alice.get(f"/api/dms/docs/{did}/download", headers={"Origin": origin})
    assert dl.status_code == 200 and "Content-Disposition" in dl.headers
    assert "Content-Disposition" in dl.headers["Access-Control-Expose-Headers"]


def test_old_case_vault_screens_work_next_to_the_hub(real, alice):
    """The old upload route, list, meta, download and delete - one real session, cookie + CSRF, on the same documents."""
    pdf = make_pdf([ORDER_TEXT + "\nold route ibex"])
    r = alice.upload("legacy-scan.pdf", pdf, url="/api/vault/documents/upload")
    assert r.status_code == 201, r.get_json()
    did = r.get_json()["id"]
    # the old list carries the file's bytes in a column: it must still be valid JSON (it used to be a 500)
    lst = alice.get("/api/vault/documents?limit=100")
    assert lst.status_code == 200, lst.get_json()
    row = next(d for d in lst.get_json()["documents"] if d["id"] == did)
    assert "file_blob" not in row and row["size_bytes"] == len(pdf)
    # ... and the hub picked the new file up by itself
    d = alice.wait(did)
    assert d["status"] == "ready" and alice.get("/api/dms/docs?q=ibex").get_json()["total"] == 1
    # a hub-only upload is listed by the old tree with its real size, and downloads through the old route
    hub_id = alice.upload("hub-only.pdf", make_pdf([ORDER_TEXT + "\nhub only lynx"])).get_json()["doc"]["id"]
    alice.wait(hub_id)
    meta = {m["id"]: m for m in alice.get("/api/vault/meta").get_json()["documents"]}
    assert meta[hub_id]["size_bytes"] > 0 and did in meta
    assert alice.get(f"/api/vault/documents/{hub_id}/download").status_code == 200
    # a document in the hub's trash disappears from the old screens, and comes back on restore
    assert alice.send("delete", f"/api/dms/docs/{hub_id}").status_code == 200
    assert hub_id not in {m["id"] for m in alice.get("/api/vault/meta").get_json()["documents"]}
    assert alice.get(f"/api/vault/documents/{hub_id}/download").status_code == 404
    assert alice.send("post", f"/api/dms/docs/{hub_id}/restore").status_code == 200
    assert hub_id in {m["id"] for m in alice.get("/api/vault/meta").get_json()["documents"]}
    # legal hold stops the OLD delete button too
    assert alice.send("patch", f"/api/dms/docs/{hub_id}", json={"legal_hold": True}).status_code == 200
    r = alice.send("delete", f"/api/vault/documents/{hub_id}")
    assert r.status_code == 409 and "legal hold" in r.get_json()["message"]
    assert alice.send("patch", f"/api/dms/docs/{hub_id}", json={"legal_hold": False}).status_code == 200
    assert alice.send("delete", f"/api/vault/documents/{hub_id}").status_code == 200


def test_firm_library_needs_a_login_and_keeps_each_users_drafts_private(real, alice):
    flask_app, _ = real
    anon = flask_app.test_client()
    assert anon.get("/api/firm-library").status_code == 401
    assert anon.post("/api/firm-library", json={"title": "x", "html": "<p>x</p>"}).status_code == 401
    title = f"Draft {uuid.uuid4().hex[:6]}"
    r = alice.send("post", "/api/firm-library", json={"title": title, "html": "<p>SALE DEED</p>", "category": "Deed"})
    assert r.status_code == 201, r.get_json()
    assert title in {d["title"] for d in alice.get("/api/firm-library").get_json()}
    other = Browser(flask_app)
    assert title not in {d["title"] for d in other.get("/api/firm-library").get_json()}


def test_paper_to_digital_tools_are_wired_into_the_real_app(real, alice):
    """Filing queue, paper register, bundles and scan intake inside the real app: login, CSRF, CORS preflight for PUT, and a full round trip."""
    flask_app, app_module = real
    anon = flask_app.test_client()
    for url in ("/api/dms/files/summary", "/api/dms/files/filing", "/api/dms/files/paper", "/api/dms/files/bundles", "/api/dms/files/scan", "/api/dms/files/cases"):
        assert anon.get(url).status_code == 401, url
        assert alice.get(url).status_code == 200, url
    # changing data needs the CSRF header like everything else
    assert alice.c.post("/api/dms/files/paper", json={"title": "No csrf"}).status_code in (401, 422)
    r = alice.send("post", "/api/dms/files/paper", json={"title": "Real app file"})
    assert r.status_code == 201 and r.get_json()["file"]["file_no"] == "PF-0001"
    # the browser's preflight for PUT (layout, order) is allowed from the real site and refused for others
    origin = "https://test.lexamplify.com"
    pre = flask_app.test_client().open("/api/dms/files/scan/abc/layout", method="OPTIONS", headers={
        "Origin": origin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type,x-csrf-token"})
    assert pre.status_code == 200 and "PUT" in pre.headers["Access-Control-Allow-Methods"] and pre.headers["Access-Control-Allow-Origin"] == origin
    # an upload from the user's own name for the account (no practice) can be put in a bundle, built and downloaded
    did = alice.upload("order.pdf", make_pdf([ORDER_TEXT + "\nreal app bundle ibis"])).get_json()["doc"]["id"]
    alice.wait(did)
    b = alice.send("post", "/api/dms/files/bundles", json={"title": "Real bundle", "doc_ids": [did]})
    assert b.status_code == 201
    bid = b.get_json()["bundle"]["id"]
    assert alice.send("post", f"/api/dms/files/bundles/{bid}/build", json={}).status_code == 202
    t0 = time.time()
    while time.time() - t0 < 30:
        st = alice.get(f"/api/dms/files/bundles/{bid}").get_json()["bundle"]["build"]["state"]
        if st != "building":
            break
        time.sleep(0.2)
    assert st == "done"
    dl = alice.get(f"/api/dms/files/bundles/{bid}/download", headers={"Origin": origin})
    assert dl.status_code == 200 and dl.data[:4] == b"%PDF" and "Content-Disposition" in dl.headers
    # a scan session round trip through the real app's cookie login
    sid = alice.send("post", "/api/dms/files/scan", json={}).get_json()["scan"]["id"]
    up = alice.c.post(f"/api/dms/files/scan/{sid}/pages", data={"file": (io.BytesIO(make_pdf(["scanned sheet one"])), "s.pdf")},
                      content_type="multipart/form-data", headers=alice.csrf())
    assert up.status_code == 201
    assert alice.send("delete", f"/api/dms/files/scan/{sid}").status_code == 200
    # the second account sees none of it
    bob = Browser(flask_app)
    assert bob.get("/api/dms/files/paper").get_json()["total"] == 0 and bob.get("/api/dms/files/bundles").get_json()["bundles"] == []
    assert bob.get(f"/api/dms/files/bundles/{bid}/download").status_code == 404


def test_the_hub_limit_is_per_user_and_never_counts_preflights(real, alice):
    flask_app, _ = real
    heavy = Browser(flask_app)
    codes = [heavy.get("/api/dms/config").status_code for _ in range(LIMIT + 15)]
    assert codes.count(429) >= 10 and codes[0] == 200, "the allowance has to run out for one user ..."
    assert codes.index(429) <= LIMIT
    pre = flask_app.test_client().open("/api/dms/config", method="OPTIONS", headers={"Origin": "https://test.lexamplify.com", "Access-Control-Request-Method": "GET"})
    assert pre.status_code == 200
    assert heavy.get("/api/dms/config", headers={"Origin": "https://test.lexamplify.com"}).headers.get("Access-Control-Allow-Origin") == "https://test.lexamplify.com", \
        "a refused request must still carry the CORS headers, or the browser reports a network error instead of 'too many requests'"
    fresh = Browser(flask_app)
    assert fresh.get("/api/dms/config").status_code == 200, "... without touching anybody else's"
