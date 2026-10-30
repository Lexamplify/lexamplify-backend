"""
tests/test_auth_redteam.py - adversarial checks on phone sign-in.
Each test is an attack that must fail.
"""
from datetime import datetime, timedelta

from test_auth_otp import client, _signup_with_otp, PASSWORD, PHONE, E164  # noqa: F401


def _mk_user(email, phone, verified):
    from database import db
    from models.user import User
    from werkzeug.security import generate_password_hash
    u = User(name="X", email=email, password=generate_password_hash(PASSWORD), phone=phone, phone_verified=verified)
    db.session.add(u)
    db.session.commit()
    return u


def _app_ctx(client):
    return client.application.app_context()


def test_unverified_number_cannot_be_used_to_sign_in(client):
    """A number an admin typed for a teammate proves nothing: whoever holds that SIM must not get in."""
    with _app_ctx(client):
        _mk_user("team@example.com", E164, verified=False)
    client.post("/api/auth/otp/send", json={"phone": PHONE, "purpose": "login"})
    assert E164 not in client.sent                      # nothing was even sent
    r = client.post("/api/auth/otp/login", json={"phone": PHONE, "code": "123456"})
    assert r.status_code == 401


def test_verified_number_signs_in_once_and_code_is_single_use(client):
    assert _signup_with_otp(client).status_code == 201
    client.post("/api/auth/logout")
    client.sent.clear()
    client.post("/api/auth/otp/send", json={"phone": PHONE, "purpose": "login"})
    code = client.sent[E164]
    assert client.post("/api/auth/otp/login", json={"phone": PHONE, "code": code}).status_code == 200
    assert client.post("/api/auth/otp/login", json={"phone": PHONE, "code": code}).status_code == 401


def test_phone_code_does_not_bypass_two_step_sign_in(client):
    assert _signup_with_otp(client).status_code == 201
    client.post("/api/auth/logout")
    client.sent.clear()
    client.application.extensions["lpms_login_gate"] = lambda user, totp: (
        ({"error": "Enter the 6-digit code from your authenticator app.", "code": "MFA_REQUIRED"}, 401)
        if totp != "654321" else None)
    client.post("/api/auth/otp/send", json={"phone": PHONE, "purpose": "login"})
    code = client.sent[E164]
    r = client.post("/api/auth/otp/login", json={"phone": PHONE, "code": code})
    assert r.status_code == 401 and r.get_json()["code"] == "MFA_REQUIRED"
    assert "Set-Cookie" not in r.headers                # no session issued
    step = r.get_json()["login_token"]
    # the SMS code is spent: replaying it gets nothing
    assert client.post("/api/auth/otp/login", json={"phone": PHONE, "code": code}).status_code == 401
    # wrong authenticator code with a valid step token: still no session
    bad = client.post("/api/auth/otp/login", json={"phone": PHONE, "login_token": step, "totp": "000000"})
    assert bad.status_code == 401 and "Set-Cookie" not in bad.headers
    # a step token is bound to the number it was issued for
    other = client.post("/api/auth/otp/login", json={"phone": "9123456780", "login_token": step, "totp": "654321"})
    assert other.status_code == 401
    ok = client.post("/api/auth/otp/login", json={"phone": PHONE, "login_token": step, "totp": "654321"})
    assert ok.status_code == 200 and "Set-Cookie" in ok.headers


def test_forged_step_token_is_rejected(client):
    assert _signup_with_otp(client).status_code == 201
    r = client.post("/api/auth/otp/login", json={"phone": PHONE, "login_token": "not-a-token", "totp": "1"})
    assert r.status_code == 401


def test_changing_profile_phone_clears_verification(client):
    assert _signup_with_otp(client).status_code == 201
    from models.user import User
    with _app_ctx(client):
        assert User.query.filter_by(email="otp@example.com").first().phone_verified is True
    cookie = client.get_cookie("csrf_access_token")
    csrf = cookie.value if cookie else ""
    r = client.patch("/api/auth/me", json={"phone": "9123456780"}, headers={"X-CSRF-TOKEN": csrf})
    assert r.status_code == 200, r.get_json()
    with _app_ctx(client):
        assert User.query.filter_by(email="otp@example.com").first().phone_verified is False


def test_per_number_send_cap_stops_sms_bombing(client):
    from database import db
    from models.phone_otp import PhoneOtp
    for _ in range(8):
        client.post("/api/auth/otp/send", json={"phone": PHONE, "purpose": "signup"})
        with _app_ctx(client):                          # skip the 30s cooldown, keep the hourly count
            PhoneOtp.query.update({"created_at": datetime.utcnow() - timedelta(seconds=45)})
            db.session.commit()
    with _app_ctx(client):
        assert PhoneOtp.query.filter_by(phone=E164).count() == 5


def test_guess_budget_is_per_number_not_per_code(client):
    """Requesting fresh codes must not reset the attacker's guess budget."""
    from database import db
    from models.phone_otp import PhoneOtp
    wrong = "000000"
    for _ in range(3):
        client.post("/api/auth/otp/send", json={"phone": PHONE, "purpose": "signup"})
        if client.sent[E164] == wrong:
            wrong = "111111"
        for _ in range(5):
            client.post("/api/auth/otp/verify", json={"phone": PHONE, "code": wrong})
        with _app_ctx(client):
            PhoneOtp.query.update({"created_at": datetime.utcnow() - timedelta(seconds=45)})
            db.session.commit()
    client.post("/api/auth/otp/send", json={"phone": PHONE, "purpose": "signup"})
    good = client.sent[E164]
    assert client.post("/api/auth/otp/verify", json={"phone": PHONE, "code": good}).status_code == 400


def test_proving_a_number_takes_it_from_an_unverified_squatter(client):
    from models.user import User
    with _app_ctx(client):
        _mk_user("squatter@example.com", E164, verified=False)
    r = _signup_with_otp(client, email="owner@example.com")
    assert r.status_code == 201, r.get_json()
    with _app_ctx(client):
        assert User.query.filter_by(email="squatter@example.com").first().phone is None
        assert User.query.filter_by(email="owner@example.com").first().phone == E164


def test_second_account_cannot_reuse_a_proved_number(client):
    assert _signup_with_otp(client).status_code == 201
    client.sent.clear()
    client.post("/api/auth/otp/send", json={"phone": PHONE, "purpose": "signup"})
    assert E164 not in client.sent                      # already owned: no SMS, same generic reply


def test_internal_errors_do_not_leak_exception_text(client, monkeypatch):
    assert _signup_with_otp(client).status_code == 201
    import routes.auth_routes as ar
    class Boom:
        @staticmethod
        def get(_):
            raise RuntimeError("secret-db-dsn postgresql://user:pw@host")
    monkeypatch.setattr(ar.User, "query", Boom, raising=False)
    r = client.get("/api/auth/me")
    assert "secret-db-dsn" not in r.get_data(as_text=True)
