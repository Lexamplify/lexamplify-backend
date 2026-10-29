"""
tests/test_account_settings.py

Regression suite for the global Account Settings backend surface added to
routes/auth_routes.py:
  GET   /api/auth/me              (extended to also return phone/role/created_at)
  PATCH /api/auth/me              (update display name / phone)
  POST  /api/auth/change-password (in-session password change)

Drives the real Flask app through app.test_client(), exactly like
tests/test_vault_authorization.py, so the real JWT cookie + CSRF
double-submit protection is exercised rather than mocked away.
"""
import importlib
import os
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

PASSWORD = "TestPass123!"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret-key-for-account-settings-tests")
    monkeypatch.setenv("GROQ_API_KEY", "dummy")
    # Isolated database - re-runs must not collide with users left in the dev DB.
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'acct_test.db'}")

    import app as app_module
    importlib.reload(app_module)

    from tests.helpers_app import create_app_here
    flask_app = create_app_here(app_module, monkeypatch)
    flask_app.config.update(TESTING=True)
    with flask_app.test_client() as test_client:
        yield test_client


def _csrf_from_cookie_jar(client):
    cookie = client.get_cookie("csrf_access_token")
    return cookie.value if cookie else None


def _mutating(client, method, url, **kwargs):
    headers = kwargs.pop("headers", {})
    csrf = _csrf_from_cookie_jar(client)
    if csrf:
        headers["X-CSRF-TOKEN"] = csrf
    return getattr(client, method)(url, headers=headers, **kwargs)


def _register(client, email, name="Original Name"):
    resp = client.post(
        "/api/auth/register",
        json={"email": email, "password": PASSWORD, "name": name},
    )
    assert resp.status_code == 201, resp.get_json()
    return resp.get_json()["user"]["id"]


class TestMeExtended:
    def test_me_includes_phone_role_created_at(self, client):
        _register(client, "profile@example.com")
        resp = client.get("/api/auth/me")
        assert resp.status_code == 200
        user = resp.get_json()["user"]
        assert set(["id", "email", "name", "phone", "role", "created_at"]).issubset(user.keys())
        assert user["phone"] is None

    def test_me_requires_auth(self, client):
        resp = client.get("/api/auth/me")
        assert resp.status_code == 401


class TestProfileUpdate:
    def test_can_update_name_and_phone(self, client):
        _register(client, "edit@example.com")
        resp = _mutating(client, "patch", "/api/auth/me", json={"name": "Updated Name", "phone": "9876543210"})
        assert resp.status_code == 200, resp.get_json()
        user = resp.get_json()["user"]
        assert user["name"] == "Updated Name"
        assert user["phone"] == "9876543210"

        # Persisted, not just echoed back.
        again = client.get("/api/auth/me")
        assert again.get_json()["user"]["name"] == "Updated Name"
        assert again.get_json()["user"]["phone"] == "9876543210"

    def test_empty_name_is_rejected(self, client):
        _register(client, "emptyname@example.com")
        resp = _mutating(client, "patch", "/api/auth/me", json={"name": "   "})
        assert resp.status_code == 400

    def test_email_field_is_ignored_not_changed(self, client):
        """Email is the sign-in identity and intentionally not editable
        through this endpoint — a PATCH attempting one must not change it."""
        _register(client, "stable@example.com")
        resp = _mutating(client, "patch", "/api/auth/me", json={"email": "different@example.com", "name": "Still Me"})
        assert resp.status_code == 200
        assert resp.get_json()["user"]["email"] == "stable@example.com"

    def test_update_requires_auth(self, client):
        resp = client.patch("/api/auth/me", json={"name": "Nope"})
        assert resp.status_code == 401

    def test_update_requires_csrf_header(self, client):
        """A cookie-only request (no X-CSRF-TOKEN) must be rejected —
        otherwise a cross-site form could silently edit the profile."""
        _register(client, "csrfcheck@example.com")
        resp = client.patch("/api/auth/me", json={"name": "No CSRF"})
        assert resp.status_code in (400, 401)


class TestChangePassword:
    def test_can_change_password_with_correct_current_password(self, client):
        _register(client, "pwchange@example.com")
        resp = _mutating(
            client, "post", "/api/auth/change-password",
            json={"current_password": PASSWORD, "new_password": "NewPass456!"},
        )
        assert resp.status_code == 200, resp.get_json()

        # Old password no longer works; new one does.
        client.post("/api/auth/logout")
        bad = client.post("/api/auth/login", json={"email": "pwchange@example.com", "password": PASSWORD})
        assert bad.status_code == 401
        good = client.post("/api/auth/login", json={"email": "pwchange@example.com", "password": "NewPass456!"})
        assert good.status_code == 200

    def test_wrong_current_password_is_rejected(self, client):
        _register(client, "wrongpw@example.com")
        resp = _mutating(
            client, "post", "/api/auth/change-password",
            json={"current_password": "NotTheRealPassword!", "new_password": "NewPass456!"},
        )
        assert resp.status_code == 401

    def test_short_new_password_is_rejected(self, client):
        _register(client, "shortpw@example.com")
        resp = _mutating(
            client, "post", "/api/auth/change-password",
            json={"current_password": PASSWORD, "new_password": "short"},
        )
        assert resp.status_code == 400

    def test_change_password_requires_auth(self, client):
        resp = client.post(
            "/api/auth/change-password",
            json={"current_password": PASSWORD, "new_password": "NewPass456!"},
        )
        assert resp.status_code == 401
