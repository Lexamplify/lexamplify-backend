"""SSO must find and create users in the SQLAlchemy User table (Neon), never in lex_assistant.db."""
import importlib
import os
import sqlite3
import uuid

import pytest
from flask_jwt_extended import decode_token
from werkzeug.security import check_password_hash, generate_password_hash

from database import db
from models.user import User
from routes import sso_routes
from test_lpms_real_app import Browser
from utils import lpms_store as L

PASSWORD = "TestPass123!"


@pytest.fixture(scope="module")
def real(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("sso_neon")
    mp = pytest.MonkeyPatch()
    old_cwd = os.getcwd()
    os.chdir(tmp)
    mp.setenv("JWT_SECRET_KEY", "test-secret-key-for-the-sso-neon-tests")
    mp.setenv("GROQ_API_KEY", "dummy")
    mp.setenv("DATABASE_URL", f"sqlite:///{tmp}/users.db")
    mp.setenv("DMS_STORAGE_DIR", str(tmp / "files"))
    mp.setenv("DMS_WORKERS", "1")
    mp.setenv("DMS_RATE_LIMIT", "5000 per minute")
    mp.setenv("LPMS_RATE_LIMIT", "70 per minute")
    mp.setenv("LPMS_SCHEDULER", "0")
    import app as app_module
    importlib.reload(app_module)
    from utils.limiter import limiter
    limiter.enabled = True
    flask_app = app_module.create_app()
    flask_app.config.update(TESTING=True)
    yield flask_app, app_module
    try:
        app_module._DMS_BP.worker.stop(timeout=10)
    finally:
        os.chdir(old_cwd)
        mp.undo()


def _email(prefix="sso"):
    return f"{prefix}-{uuid.uuid4().hex[:10]}@example.com"


@pytest.fixture(autouse=True)
def _isolated_test(real):
    from utils.limiter import limiter
    limiter.reset()
    yield
    with real[0].app_context():
        db.session.remove()


class _FakeClient:
    def __init__(self, claims):
        self.claims = claims

    def authorize_access_token(self):
        return {"userinfo": self.claims}

    def parse_id_token(self, token):
        return self.claims


class _FakeOAuth:
    def __init__(self, provider, claims):
        self._clients = {provider: object()}
        setattr(self, provider, _FakeClient(claims))


def _callback(flask_app, monkeypatch, provider, claims):
    monkeypatch.setattr(sso_routes, "oauth", _FakeOAuth(provider, claims))
    client = flask_app.test_client()
    response = client.get(f"/api/auth/sso/{provider}/callback")
    return client, response


def _mfa_user(flask_app, name):
    b = Browser(flask_app, name=name)
    b.ok(b.send("post", "/firm", {"name": name + " Chambers"}), 201)
    secret = b.ok(b.send("post", "/mfa/setup"))["secret"].replace(" ", "")
    b.ok(b.send("post", "/mfa/enable", {"code": L.totp_at(secret)}))
    return b


def test_new_email_creates_a_neon_user_with_an_unusable_password(real):
    flask_app, _ = real
    email = _email("new")
    with flask_app.app_context():
        user_id = sso_routes._find_or_create_sso_user(f"  {email.upper()}  ", "New Person")
        user = User.query.filter_by(email=email).first()
        assert user is not None
        assert user.id == user_id
        assert user.name == "New Person"
        assert user.role == "Lawyer"
        assert check_password_hash(user.password, "not-the-password") is False
    assert flask_app.test_client().post(
        "/api/auth/login", json={"email": email, "password": "not-the-password"}
    ).status_code == 401


def test_same_email_is_reused_with_case_and_space_normalization(real):
    flask_app, _ = real
    email = _email("same")
    with flask_app.app_context():
        first = sso_routes._find_or_create_sso_user(email, "First Name")
        second = sso_routes._find_or_create_sso_user(f"  {email.upper()}  ", "Second Name")
        assert first == second
        assert User.query.filter_by(email=email).count() == 1
        assert User.query.filter_by(email=email).first().name == "First Name"


def test_existing_neon_user_is_returned_unchanged(real):
    flask_app, _ = real
    email = _email("existing")
    with flask_app.app_context():
        user = User(email=email, password=generate_password_hash(PASSWORD), name="Real Person", role="Senior")
        db.session.add(user)
        db.session.commit()
        before = (user.id, user.name, user.email, user.password, user.role, user.phone, user.phone_verified)
        found = sso_routes._find_or_create_sso_user(f" {email.upper()} ", "SSO Name")
        db.session.expire_all()
        after_user = User.query.filter_by(email=email).first()
        after = (after_user.id, after_user.name, after_user.email, after_user.password,
                 after_user.role, after_user.phone, after_user.phone_verified)
        assert found == before[0]
        assert after == before
    assert flask_app.test_client().post(
        "/api/auth/login", json={"email": email, "password": PASSWORD}
    ).status_code == 200


def test_sso_never_writes_to_a_sqlite_users_table(real):
    flask_app, _ = real
    email = _email("sqlite")
    legacy_path = os.path.join(os.getcwd(), "lex_assistant.db")
    conn = sqlite3.connect(legacy_path)
    try:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, "
            "email TEXT UNIQUE NOT NULL, password TEXT NOT NULL)"
        )
        conn.execute("INSERT OR IGNORE INTO users (email, password) VALUES (?, ?)",
                     ("sentinel@example.com", "sentinel"))
        conn.commit()
        before = conn.execute("SELECT id, email, password FROM users ORDER BY id").fetchall()
    finally:
        conn.close()

    with flask_app.app_context():
        user_id = sso_routes._find_or_create_sso_user(email, "Neon Only")
        assert User.query.filter_by(email=email).first().id == user_id

    conn = sqlite3.connect(legacy_path)
    try:
        after = conn.execute("SELECT id, email, password FROM users ORDER BY id").fetchall()
    finally:
        conn.close()
    assert after == before
    assert all(row[1] != email for row in after)


def test_unique_key_race_returns_the_existing_user(real, monkeypatch):
    flask_app, _ = real
    email = _email("race")
    with flask_app.app_context():
        winner = User(email=email, password=generate_password_hash(PASSWORD), name="Winner")
        db.session.add(winner)
        db.session.commit()
        winner_id = winner.id

        class MissThenHit:
            def __init__(self):
                self.calls = 0

            def filter_by(self, **kwargs):
                return self

            def first(self):
                self.calls += 1
                return None if self.calls == 1 else winner

        with monkeypatch.context() as m:
            m.setattr(User, "query", MissThenHit())
            found = sso_routes._find_or_create_sso_user(email, "Loser")
        assert found == winner_id
        assert User.query.filter_by(email=email).count() == 1
        assert User.query.filter_by(email=email).first().name == "Winner"


@pytest.mark.parametrize("provider", ["google", "microsoft"])
def test_callback_uses_the_neon_id_in_the_jwt(real, monkeypatch, provider):
    flask_app, _ = real
    email = _email(provider)
    with flask_app.app_context():
        user_id = sso_routes._find_or_create_sso_user(email, "SSO User")
    client, response = _callback(flask_app, monkeypatch, provider, {"email": email, "name": "SSO User"})
    assert response.status_code == 302
    assert "sso_error" not in response.headers["Location"]
    with flask_app.app_context():
        access = decode_token(client.get_cookie("access_token_cookie").value)
        refresh = decode_token(client.get_cookie("refresh_token_cookie").value)
    assert access["sub"] == str(user_id)
    assert refresh["sub"] == str(user_id)


@pytest.mark.parametrize("provider", ["google", "microsoft"])
def test_callback_still_refuses_an_mfa_account(real, monkeypatch, provider):
    flask_app, _ = real
    b = _mfa_user(flask_app, f"MFA {provider}")
    client, response = _callback(flask_app, monkeypatch, provider, {"email": b.email, "name": "MFA User"})
    assert response.status_code == 302
    assert "sso_error=mfa_required" in response.headers["Location"]
    assert client.get_cookie("access_token_cookie") is None


@pytest.mark.parametrize("provider", ["google", "microsoft"])
@pytest.mark.parametrize("value", [False, "false", "FALSE", " false "])
def test_callback_refuses_an_explicitly_unverified_email(real, monkeypatch, provider, value):
    flask_app, _ = real
    email = _email("unverified")
    client, response = _callback(
        flask_app, monkeypatch, provider, {"email": email, "email_verified": value}
    )
    assert response.status_code == 302
    assert "sso_error=email_not_verified" in response.headers["Location"]
    assert client.get_cookie("access_token_cookie") is None
    with flask_app.app_context():
        assert User.query.filter_by(email=email).first() is None


@pytest.mark.parametrize("provider", ["google", "microsoft"])
def test_callback_allows_a_missing_email_verified_claim(real, monkeypatch, provider):
    flask_app, _ = real
    email = _email("missing-claim")
    client, response = _callback(flask_app, monkeypatch, provider, {"email": email, "name": "No Claim"})
    assert response.status_code == 302
    assert "sso_error" not in response.headers["Location"]
    assert client.get_cookie("access_token_cookie") is not None
    with flask_app.app_context():
        assert User.query.filter_by(email=email).first() is not None
