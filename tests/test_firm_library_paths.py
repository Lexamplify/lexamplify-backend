"""
tests/test_firm_library_paths.py

Regression tests pinning the exact paths and status codes of GET/POST
/api/firm-library (and the trailing-slash /api/firm-library/ route) on the
real Flask app with an isolated temporary database.
"""
import importlib
import os
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

PASSWORD = "TestPass123!"
REDIRECT_STATUSES = (301, 302, 307, 308)


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 't.db'}")
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret-key-for-firm-library-paths")
    monkeypatch.setenv("GROQ_API_KEY", "dummy")

    import app as app_module
    importlib.reload(app_module)

    from tests.helpers_app import create_app_here
    flask_app = create_app_here(app_module, monkeypatch)
    flask_app.config.update(TESTING=True)
    with flask_app.test_client() as test_client:
        yield test_client


def _register(client, email="advocate@example.com"):
    resp = client.post(
        "/api/auth/register",
        json={"email": email, "password": PASSWORD, "name": email.split("@")[0]},
    )
    assert resp.status_code == 201, resp.get_json()
    return resp.get_json()["user"]["id"]


def _mutating(client, method, url, **kwargs):
    headers = kwargs.pop("headers", {})
    cookie = client.get_cookie("csrf_access_token")
    if cookie:
        headers["X-CSRF-TOKEN"] = cookie.value
    return getattr(client, method)(url, headers=headers, **kwargs)


def test_get_firm_library_without_login(client):
    resp = client.get("/api/firm-library")
    assert resp.status_code not in REDIRECT_STATUSES
    assert resp.status_code == 401


def test_get_firm_library_with_login(client):
    _register(client, "reader@example.com")
    resp = client.get("/api/firm-library")
    assert resp.status_code not in REDIRECT_STATUSES
    assert resp.status_code == 200
    assert isinstance(resp.get_json(), list)


def test_post_firm_library_with_login(client, monkeypatch):
    indexed_calls = []
    monkeypatch.setattr(
        "utils.local_search.index_document",
        lambda doc_id, title, content: indexed_calls.append((doc_id, title, content)),
    )
    _register(client, "writer@example.com")
    resp = _mutating(
        client,
        "post",
        "/api/firm-library",
        json={"title": "Lease Deed Draft", "html": "<p>Lease terms</p>", "category": "Deed"},
    )
    assert resp.status_code not in REDIRECT_STATUSES
    assert resp.status_code == 201
    body = resp.get_json()
    assert body["title"] == "Lease Deed Draft"
    assert len(indexed_calls) == 1
    assert indexed_calls[0][1] == "Lease Deed Draft"


def test_get_firm_library_trailing_slash(client):
    _register(client, "slash@example.com")
    resp = client.get("/api/firm-library/")
    assert resp.status_code not in REDIRECT_STATUSES
    assert resp.status_code == 404
