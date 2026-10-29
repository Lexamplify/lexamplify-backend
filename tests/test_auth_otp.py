"""
tests/test_auth_otp.py

Phone-OTP signup/login and the auth hardening done in the same pass:
retired legacy /signup, single-use reset links, reset-link origin allow-list.
Drives the real Flask app through app.test_client().
"""
import importlib
import os
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

PASSWORD = "TestPass123!"
PHONE = "98765 43210"
E164 = "+919876543210"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret-key-for-otp-tests-0123456789")
    monkeypatch.setenv("GROQ_API_KEY", "dummy")
    # Isolated database - never the project's dev database.
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'otp_test.db'}")
    monkeypatch.setenv("PHONE_OTP_REQUIRED", "true")
    monkeypatch.setenv("FRONTEND_URL", "https://app.lexamplify.in")

    import app as app_module
    importlib.reload(app_module)
    from tests.helpers_app import create_app_here
    flask_app = create_app_here(app_module, monkeypatch)
    flask_app.config.update(TESTING=True)

    from utils.limiter import limiter
    limiter.enabled = False

    sent = {}
    import routes.auth_routes as ar
    monkeypatch.setattr(ar, "send_otp_sms", lambda phone, code: sent.__setitem__(phone, code) or True)
    monkeypatch.setattr(ar, "sms_configured", lambda: True)

    with flask_app.test_client() as c:
        c.sent = sent
        yield c


def _signup_with_otp(client, email="otp@example.com", phone=PHONE):
    r = client.post("/api/auth/otp/send", json={"phone": phone, "purpose": "signup"})
    assert r.status_code == 200, r.get_json()
    code = client.sent[E164]
    v = client.post("/api/auth/otp/verify", json={"phone": phone, "code": code})
    assert v.status_code == 200, v.get_json()
    return client.post("/api/auth/register", json={
        "name": "Adv Test", "email": email, "password": PASSWORD,
        "phone": phone, "phone_token": v.get_json()["phone_token"],
    })


def test_config_reports_otp_state(client):
    r = client.get("/api/auth/config")
    assert r.status_code == 200
    assert r.get_json() == {"phone_otp_required": True, "sms_enabled": True, "otp_mode": "api"}


def test_register_requires_verified_phone(client):
    r = client.post("/api/auth/register", json={"name": "A", "email": "a@example.com", "password": PASSWORD, "phone": PHONE})
    assert r.status_code == 400
    assert r.get_json()["code"] == "PHONE_NOT_VERIFIED"


def test_signup_with_otp_stores_normalised_phone(client):
    r = _signup_with_otp(client)
    assert r.status_code == 201, r.get_json()
    assert r.get_json()["user"]["phone"] == E164


def test_phone_token_is_bound_to_the_number(client):
    client.post("/api/auth/otp/send", json={"phone": PHONE, "purpose": "signup"})
    v = client.post("/api/auth/otp/verify", json={"phone": PHONE, "code": client.sent[E164]})
    r = client.post("/api/auth/register", json={
        "name": "A", "email": "b@example.com", "password": PASSWORD,
        "phone": "9123456780", "phone_token": v.get_json()["phone_token"],
    })
    assert r.status_code == 400


def test_wrong_code_locks_after_five_attempts(client):
    client.post("/api/auth/otp/send", json={"phone": PHONE, "purpose": "signup"})
    real = client.sent[E164]
    wrong = "000000" if real != "000000" else "111111"
    for _ in range(5):
        assert client.post("/api/auth/otp/verify", json={"phone": PHONE, "code": wrong}).status_code == 400
    # even the right code is dead now
    assert client.post("/api/auth/otp/verify", json={"phone": PHONE, "code": real}).status_code == 400


def test_code_is_single_use(client):
    client.post("/api/auth/otp/send", json={"phone": PHONE, "purpose": "signup"})
    code = client.sent[E164]
    assert client.post("/api/auth/otp/verify", json={"phone": PHONE, "code": code}).status_code == 200
    assert client.post("/api/auth/otp/verify", json={"phone": PHONE, "code": code}).status_code == 400


def test_login_with_otp(client):
    assert _signup_with_otp(client).status_code == 201
    client.post("/api/auth/logout")
    client.sent.clear()
    r = client.post("/api/auth/otp/send", json={"phone": PHONE, "purpose": "login"})
    assert r.status_code == 200
    r = client.post("/api/auth/otp/login", json={"phone": PHONE, "code": client.sent[E164]})
    assert r.status_code == 200, r.get_json()
    assert r.get_json()["user"]["email"] == "otp@example.com"
    assert client.get("/api/auth/me").status_code == 200


def test_otp_send_does_not_reveal_registered_numbers(client):
    unknown = client.post("/api/auth/otp/send", json={"phone": "9000000001", "purpose": "login"})
    assert unknown.status_code == 200
    assert "+919000000001" not in client.sent  # nothing was sent
    assert _signup_with_otp(client).status_code == 201
    known = client.post("/api/auth/otp/send", json={"phone": PHONE, "purpose": "login"})
    assert known.status_code == 200
    assert unknown.get_json().keys() == known.get_json().keys()


def test_login_otp_for_unknown_number_fails_generically(client):
    r = client.post("/api/auth/otp/login", json={"phone": "9000000002", "code": "123456"})
    assert r.status_code == 401


def test_duplicate_phone_rejected(client):
    assert _signup_with_otp(client).status_code == 201
    client.post("/api/auth/logout")
    client.sent.clear()
    # signup OTP is not even sent for a number that already has an account
    client.post("/api/auth/otp/send", json={"phone": PHONE, "purpose": "signup"})
    assert E164 not in client.sent


def test_invalid_phone_rejected(client):
    assert client.post("/api/auth/otp/send", json={"phone": "12345", "purpose": "signup"}).status_code == 400


def test_legacy_signup_retired(client):
    r = client.post("/api/auth/signup", json={"name": "x", "email": "x@example.com", "password": PASSWORD, "role": "Admin"})
    assert r.status_code == 410


def test_reset_link_is_single_use(client, monkeypatch):
    import routes.auth_routes as ar
    mails = []
    monkeypatch.setattr(ar, "send_email", lambda to, subj, body: mails.append(body) or True)
    assert _signup_with_otp(client, email="reset@example.com").status_code == 201
    client.post("/api/auth/forgot-password", json={"email": "reset@example.com"})
    token = mails[-1].split("resetToken=")[1].split()[0]
    r1 = client.post("/api/auth/reset-password", json={"token": token, "password": "BrandNewPass1!"})
    assert r1.status_code == 200
    r2 = client.post("/api/auth/reset-password", json={"token": token, "password": "AnotherPass22!"})
    assert r2.status_code == 400


def test_reset_link_ignores_attacker_origin(client, monkeypatch):
    import routes.auth_routes as ar
    mails = []
    monkeypatch.setattr(ar, "send_email", lambda to, subj, body: mails.append(body) or True)
    assert _signup_with_otp(client, email="victim@example.com").status_code == 201
    client.post("/api/auth/forgot-password", json={"email": "victim@example.com", "frontend_origin": "https://evil.example"})
    assert "evil.example" not in mails[-1]
    assert "https://app.lexamplify.in/login?resetToken=" in mails[-1]


def test_register_rejects_bad_email_and_oversize_password(client, monkeypatch):
    monkeypatch.setenv("PHONE_OTP_REQUIRED", "false")
    assert client.post("/api/auth/register", json={"name": "A", "email": "nope", "password": PASSWORD}).status_code == 400
    assert client.post("/api/auth/register", json={"name": "A", "email": "c@example.com", "password": "x" * 500}).status_code == 400
