"""
Practice inside the REAL Flask app: registration in create_app(), real accounts in the users database, cookie login + CSRF,
two-step sign-in through the real /api/auth/login route, the login history, CORS, the per-user rate limit, documents.

One app for the whole module (flask-limiter keeps a process-wide registry).
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
from utils import lpms_store as L  # noqa: E402

PASSWORD = "TestPass123!"
LIMIT = 70


@pytest.fixture(scope="module")
def real(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("real_lpms")
    mp = pytest.MonkeyPatch()
    old_cwd = os.getcwd()
    os.chdir(tmp)
    mp.setenv("JWT_SECRET_KEY", "test-secret-key-for-the-real-app-practice-tests")
    mp.setenv("GROQ_API_KEY", "dummy")
    mp.setenv("DATABASE_URL", f"sqlite:///{tmp}/users.db")
    mp.setenv("DMS_STORAGE_DIR", str(tmp / "files"))
    mp.setenv("DMS_WORKERS", "1")
    mp.setenv("DMS_RATE_LIMIT", "5000 per minute")
    mp.setenv("LPMS_RATE_LIMIT", f"{LIMIT} per minute")
    mp.setenv("LPMS_SCHEDULER", "0")
    import app as app_module
    importlib.reload(app_module)
    flask_app = app_module.create_app()
    flask_app.config.update(TESTING=True)
    yield flask_app, app_module
    try:
        app_module._DMS_BP.worker.stop(timeout=10)
    finally:
        os.chdir(old_cwd)
        mp.undo()


@pytest.fixture(autouse=True)
def fresh_allowances(real):
    """The login route allows 10 attempts a minute per address; this module signs in far more often than a person would."""
    from utils.limiter import limiter
    limiter.reset()


class Browser:
    """A browser: cookie jar, CSRF header on writes."""
    def __init__(self, flask_app, email=None, register=True, name="Test Advocate"):
        self.app = flask_app
        self.c = flask_app.test_client()
        self.email = email or f"{uuid.uuid4().hex[:10]}@example.com"
        if register:
            r = self.c.post("/api/auth/register", json={"email": self.email, "password": PASSWORD, "name": name})
            assert r.status_code == 201, r.get_json()
            self.uid = r.get_json()["user"]["id"]

    def login(self, password=PASSWORD, **extra):
        return self.c.post("/api/auth/login", json={"email": self.email, "password": password, **extra})

    def csrf(self):
        ck = self.c.get_cookie("csrf_access_token")
        return {"X-CSRF-TOKEN": ck.value} if ck else {}

    def get(self, url, **kw):
        return self.c.get("/api/practice" + url, **kw)

    def send(self, method, url, json=None, **kw):
        headers = {**self.csrf(), **kw.pop("headers", {})}
        return getattr(self.c, method)("/api/practice" + url, headers=headers, json=json if json is not None else {}, **kw)

    def ok(self, resp, status=200):
        assert resp.status_code == status, (resp.status_code, resp.get_json())
        return resp.get_json()


@pytest.fixture(scope="module")
def asha(real):
    b = Browser(real[0], name="Asha Rao")
    b.ok(b.send("post", "/firm", {"name": "Rao & Associates"}), 201)
    return b


def test_practice_is_mounted_needs_a_login_and_a_csrf_header(real, asha):
    flask_app, _ = real
    assert "lpms" in flask_app.blueprints
    assert flask_app.test_client().get("/api/practice/me").status_code == 401
    assert flask_app.test_client().get("/api/practice/cases").status_code == 401
    me = asha.ok(asha.get("/me"))
    assert me["member"]["role"] == "senior" and me["meta"]["case_types"] and me["email_configured"] is False
    # a cookie-authenticated write without the CSRF header is refused
    r = asha.c.post("/api/practice/cases", json={"case_no": "X 1", "court": "C", "title": "t"})
    assert r.status_code in (401, 422)
    assert asha.send("post", "/cases", {"case_no": "X 1", "court": "C", "title": "t"}).status_code == 201


def test_senior_creates_a_real_junior_account_who_can_log_in(real, asha):
    flask_app, _ = real
    email = f"junior-{uuid.uuid4().hex[:6]}@example.com"
    r = asha.ok(asha.send("post", "/members", {"name": "Ravi Nair", "email": email, "role": "junior", "password": "FirstPass123"}), 201)
    assert r["managed"] is True
    ravi = Browser(flask_app, email=email, register=False)
    bad = ravi.login(password="wrong-password")
    assert bad.status_code == 401
    ok = ravi.login(password="FirstPass123")
    assert ok.status_code == 200, ok.get_json()
    me = ravi.ok(ravi.get("/me"))
    assert me["member"]["role"] == "junior" and me["member"]["name"] == "Ravi Nair" and me["perms"]["manage_team"] is False
    # the junior cannot do senior things, with the real CSRF flow
    assert ravi.send("post", "/members", {"name": "Z", "email": "z@example.com", "password": "TempPass123!"}).status_code == 403
    # the senior resets the password; the old one stops working, the new one works
    mid = r["member"]["id"]
    asha.ok(asha.send("post", f"/members/{mid}/password", {"password": "SecondPass123"}))
    again = Browser(flask_app, email=email, register=False)
    assert again.login(password="FirstPass123").status_code == 401 and again.login(password="SecondPass123").status_code == 200
    # the login history shows both the failed attempt and the sign-ins (visible to the senior)
    log = asha.ok(asha.get("/audit?group=sign-in&per_page=100"))["items"]
    actions = [x["action"] for x in log]
    assert actions.count("login") >= 2 and "login_failed" in actions
    assert any(x["ip"] for x in log)
    assert asha.ok(asha.get("/audit/verify"))["ok"] is True


def test_two_step_sign_in_through_the_real_login_route(real):
    flask_app, _ = real
    b = Browser(flask_app, name="Mfa Advocate")
    b.ok(b.send("post", "/firm", {"name": "MFA Chambers"}), 201)
    setup = b.ok(b.send("post", "/mfa/setup"))
    secret = setup["secret"].replace(" ", "")
    assert b.send("post", "/mfa/enable", {"code": "000000"}).status_code == 400
    codes = b.ok(b.send("post", "/mfa/enable", {"code": L.totp_at(secret)}))["recovery_codes"]
    fresh = Browser(flask_app, email=b.email, register=False)
    r = fresh.login()
    assert r.status_code == 401 and r.get_json()["code"] == "MFA_REQUIRED" and fresh.c.get_cookie("access_token_cookie") is None
    r = fresh.login(otp="123456")
    assert r.status_code == 401 and r.get_json()["code"] == "MFA_INVALID" and fresh.c.get_cookie("access_token_cookie") is None
    assert fresh.login(password="wrong", otp=L._hotp(secret, int(time.time() // 30) + 1)).status_code == 401     # right code, wrong password: still no
    r = fresh.login(otp=L._hotp(secret, int(time.time() // 30) + 1))
    assert r.status_code == 200 and fresh.c.get_cookie("access_token_cookie") is not None
    assert fresh.ok(fresh.get("/me"))["mfa"]["enabled"] is True
    # recovery code: once
    other = Browser(flask_app, email=b.email, register=False)
    assert other.login(otp=codes[0]).status_code == 200
    assert Browser(flask_app, email=b.email, register=False).login(otp=codes[0]).status_code == 401
    # a person without it is never asked
    plain = Browser(flask_app)
    assert plain.login().status_code == 200


def test_cors_preflight_for_practice_writes(real, asha):
    flask_app, app_module = real
    origin = "https://test.lexamplify.com"
    assert origin in app_module.PROD_ORIGINS
    pre = flask_app.test_client().open("/api/practice/cases/1", method="OPTIONS", headers={
        "Origin": origin, "Access-Control-Request-Method": "PATCH", "Access-Control-Request-Headers": "content-type,x-csrf-token"})
    assert pre.status_code == 200
    assert {"PATCH", "DELETE", "PUT", "POST", "GET"} <= {m.strip() for m in pre.headers["Access-Control-Allow-Methods"].split(",")}
    assert pre.headers["Access-Control-Allow-Origin"] == origin and pre.headers["Access-Control-Allow-Credentials"] == "true"
    evil = flask_app.test_client().open("/api/practice/me", method="OPTIONS", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert "Access-Control-Allow-Origin" not in evil.headers
    # downloads expose their file name to the page
    d = asha.c.get("/api/practice/reports/case_status?format=pdf", headers={"Origin": origin})
    assert d.status_code == 200 and "Content-Disposition" in d.headers and "Content-Disposition" in d.headers["Access-Control-Expose-Headers"]


def test_case_documents_through_cookies_and_csrf(real, asha):
    c = asha.ok(asha.send("post", "/cases", {"case_no": "WP(C) 77/2026", "court": "Delhi High Court", "title": "Docs Matter"}), 201)["case"]["id"]
    pdf = make_pdf([ORDER_TEXT + "\nreal practice platypus"])
    refused = asha.c.post("/api/dms/upload", data={"file": (io.BytesIO(pdf), "o.pdf"), "lpms_case_id": str(c)}, content_type="multipart/form-data")
    assert refused.status_code in (401, 422)
    r = asha.c.post("/api/dms/upload", data={"file": (io.BytesIO(pdf), "o.pdf"), "lpms_case_id": str(c)}, content_type="multipart/form-data", headers=asha.csrf())
    assert r.status_code == 201, r.get_json()
    did = r.get_json()["doc"]["id"]
    t0 = time.time()
    while time.time() - t0 < 60 and asha.c.get(f"/api/dms/docs/{did}").get_json()["doc"]["status"] in ("queued", "processing"):
        time.sleep(0.2)
    assert asha.c.get("/api/dms/docs?q=platypus").get_json()["total"] == 1
    assert asha.c.get(f"/api/dms/docs?lpms_case_id={c}").get_json()["total"] == 1
    assert any(x["kind"] == "document" for x in asha.ok(asha.get(f"/cases/{c}/timeline"))["items"])
    # the old Case Vault list does not choke on practice documents either
    assert asha.c.get("/api/vault/documents?limit=50").status_code == 200


def test_the_practice_limit_is_per_user_and_ignores_preflights(real):
    flask_app, _ = real
    heavy = Browser(flask_app)
    codes = [heavy.get("/me").status_code for _ in range(LIMIT + 15)]
    assert codes[0] == 200 and codes.count(429) >= 10 and codes.index(429) <= LIMIT
    pre = flask_app.test_client().open("/api/practice/me", method="OPTIONS", headers={"Origin": "https://test.lexamplify.com", "Access-Control-Request-Method": "GET"})
    assert pre.status_code == 200
    assert heavy.get("/me", headers={"Origin": "https://test.lexamplify.com"}).headers.get("Access-Control-Allow-Origin") == "https://test.lexamplify.com"
    assert Browser(flask_app).get("/me").status_code == 200


def test_old_screens_still_work_next_to_practice(real, asha):
    assert asha.c.get("/api/dms/config").status_code == 200
    assert asha.c.get("/api/ping").get_json()["ok"] is True
