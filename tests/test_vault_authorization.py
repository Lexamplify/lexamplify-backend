"""
tests/test_vault_authorization.py

IDOR/BOLA regression suite for the Case Vault authorization boundary.

Exercises the REAL Flask app (routes, JWT cookie auth, CSRF, and the real
sqlite schema/migrations in app.py) through app.test_client() — no route
handlers or SQL are called directly, and no ownership logic is re-verified
by calling helper functions in isolation. Every test creates two distinct,
separately-registered users (User A / User B) via the real
POST /api/auth/register endpoint and drives every subsequent request
through their real cookie session, exactly as the browser would.

Isolation: app.py's `db = sqlite3.connect('lex_assistant.db', ...)` is a
module-level global bound at import time to whatever the process's CWD
resolves that relative path to. Each test chdirs into a fresh pytest
tmp_path and reloads the `app` module so that global (and every other
`sqlite3.connect('lex_assistant.db')` call across the codebase) binds to a
throwaway database instead of the real, 912-row production-shaped
lex_assistant.db at the repo root. Nothing here ever opens that file.
"""
import importlib
import os
import re
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

PASSWORD = "TestPass123!"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret-key-for-vault-authz-tests")
    monkeypatch.setenv("GROQ_API_KEY", "dummy")

    import app as app_module
    importlib.reload(app_module)  # rebind app.py's module-level `db` to this tmp_path

    flask_app = app_module.create_app()
    flask_app.config.update(TESTING=True)
    with flask_app.test_client() as test_client:
        yield test_client


def _csrf_from_cookie_jar(client):
    """Pulls the non-HttpOnly csrf_access_token cookie's current value out
    of the test client's cookie jar, exactly as authFetch.js's
    getCsrfToken() does from document.cookie in the browser."""
    cookie = client.get_cookie("csrf_access_token")
    return cookie.value if cookie else None


def _register(client, email):
    """Registers a brand-new user through the real endpoint and returns
    their user id — the client's cookie jar now holds their real session,
    identical to what a browser would hold after signup."""
    resp = client.post(
        "/api/auth/register",
        json={"email": email, "password": PASSWORD, "name": email.split("@")[0]},
    )
    assert resp.status_code == 201, resp.get_json()
    return resp.get_json()["user"]["id"]


def _mutating(client, method, url, **kwargs):
    """Attaches the X-CSRF-TOKEN header every mutating request needs (the
    double-submit cookie check app.py's JWT_COOKIE_CSRF_PROTECT enforces)."""
    headers = kwargs.pop("headers", {})
    csrf = _csrf_from_cookie_jar(client)
    if csrf:
        headers["X-CSRF-TOKEN"] = csrf
    return getattr(client, method)(url, headers=headers, **kwargs)


def _save_document(client, title="Confidential Draft", content="Privileged content.", **extra):
    payload = {"case_id": "CASE-A-1", "title": title, "content": content, **extra}
    resp = _mutating(client, "post", "/api/vault/save", json=payload)
    assert resp.status_code == 200, resp.get_json()
    return resp.get_json()["id"]


class TestOwnVaultAccess:
    def test_authenticated_user_can_access_own_vault(self, client):
        """#1 — a logged-in user can save and then see their own document."""
        _register(client, "owner@example.com")
        doc_id = _save_document(client)

        resp = client.get("/api/vault/documents")
        assert resp.status_code == 200
        ids = [d["id"] for d in resp.get_json()["documents"]]
        assert doc_id in ids

    def test_unauthenticated_user_cannot_access_vault(self, client):
        """#2 — no session at all must be rejected, not silently return data."""
        resp = client.get("/api/vault/documents")
        assert resp.status_code == 401

    def test_malformed_token_is_rejected(self, client):
        """Authentication-failure case: a garbage cookie value must not be
        treated as a valid or missing session — it must fail closed."""
        client.set_cookie("access_token_cookie", "not-a-real-jwt")
        resp = client.get("/api/vault/documents")
        assert resp.status_code in (401, 422)  # flask-jwt-extended: 422 for a malformed (undecodable) token

    def test_nonexistent_document_is_404_for_its_own_owner(self, client):
        """A user querying an id that was never created gets the same 404
        as a real IDOR rejection — no separate 'invalid id' code path."""
        _register(client, "solo@example.com")
        resp = _mutating(client, "put", "/api/vault/documents/999999", json={"content": "x"})
        assert resp.status_code == 404


class TestCrossUserDocumentIDOR:
    """#3, #4, #5 — the exact IDOR/BOLA drill: create data as User A, then
    attempt every read/write/delete against it as a distinct, separately
    authenticated User B."""

    def _two_users_with_a_doc(self, client):
        _register(client, "alice@example.com")
        doc_id = _save_document(client, title="Alice's Merger Memo", content="Client-privileged terms.")
        # Switch sessions: clear A's cookies, register/login as B.
        client.delete_cookie("access_token_cookie")
        client.delete_cookie("csrf_access_token")
        _register(client, "bob@example.com")
        return doc_id

    def test_user_b_cannot_read_user_a_document(self, client):
        doc_id = self._two_users_with_a_doc(client)
        resp = client.get(f"/api/documents/{doc_id}")
        assert resp.status_code == 404
        assert "Client-privileged" not in resp.get_data(as_text=True)

    def test_user_b_cannot_read_user_a_document_via_legal_research_endpoint(self, client):
        """A second, separate read path onto the same table
        (/api/legal-research/document/<case_id>) — found while searching
        the backend for every case_vault access point, not just the ones
        the original report named. Must be scoped the same way."""
        _register(client, "carol@example.com")
        _save_document(
            client, title="Carol's Settlement Terms", content="Confidential settlement figure.",
            case_id="CASE-CAROL-77",
        )
        client.delete_cookie("access_token_cookie")
        client.delete_cookie("csrf_access_token")
        _register(client, "dave@example.com")

        resp = client.get("/api/legal-research/document/CASE-CAROL-77")
        assert resp.status_code == 404
        assert "settlement figure" not in resp.get_data(as_text=True).lower()

    def test_user_b_cannot_update_user_a_document(self, client):
        doc_id = self._two_users_with_a_doc(client)
        resp = _mutating(client, "put", f"/api/vault/documents/{doc_id}", json={"content": "TAMPERED BY BOB"})
        assert resp.status_code == 404

        # Prove the rejection was real, not just a misleading status code —
        # log back in as Alice and confirm her content is untouched.
        client.delete_cookie("access_token_cookie")
        client.delete_cookie("csrf_access_token")
        client.post("/api/auth/login", json={"email": "alice@example.com", "password": PASSWORD})
        resp = client.get("/api/vault/documents?q=Merger")
        docs = resp.get_json()["documents"]
        assert any(d["id"] == doc_id for d in docs)
        assert "TAMPERED" not in next(d["content"] for d in docs if d["id"] == doc_id)

    def test_user_b_cannot_delete_user_a_document(self, client):
        doc_id = self._two_users_with_a_doc(client)
        resp = _mutating(client, "delete", f"/api/vault/documents/{doc_id}")
        assert resp.status_code == 404

        client.delete_cookie("access_token_cookie")
        client.delete_cookie("csrf_access_token")
        client.post("/api/auth/login", json={"email": "alice@example.com", "password": PASSWORD})
        resp = client.get(f"/api/documents/{doc_id}")
        assert resp.status_code == 200  # still there — Bob's delete never touched it


class TestCrossUserFolderIDOR:
    """#6, #7, #9 — folder listing, saving into another user's folder, and
    nested-folder ownership can't be bypassed by guessing a parent_id."""

    def test_user_b_cannot_access_user_a_folder(self, client):
        _register(client, "alice2@example.com")
        resp = _mutating(client, "post", "/api/vault/folders", json={"name": "Alice Private Matters"})
        assert resp.status_code == 201
        folder_id = resp.get_json()["id"]

        client.delete_cookie("access_token_cookie")
        client.delete_cookie("csrf_access_token")
        _register(client, "bob2@example.com")

        resp = client.get("/api/vault/folders")
        flat_ids = [f["id"] for f in resp.get_json()["flat"]]
        assert folder_id not in flat_ids

    def test_user_b_cannot_save_into_user_a_folder(self, client):
        """#7 — the exact scenario the audit calls out: User A's folder id
        + User B's session + POST /api/vault/save must fail safely."""
        _register(client, "alice3@example.com")
        resp = _mutating(client, "post", "/api/vault/folders", json={"name": "Alice's Case Files"})
        alice_folder_id = resp.get_json()["id"]

        client.delete_cookie("access_token_cookie")
        client.delete_cookie("csrf_access_token")
        _register(client, "bob3@example.com")

        resp = _mutating(
            client, "post", "/api/vault/save",
            json={"case_id": "BOB-1", "title": "Bob's doc", "content": "x", "folder_id": alice_folder_id},
        )
        assert resp.status_code == 404
        assert resp.get_json().get("error") is True

        # The document must not have been silently saved to root either.
        resp = client.get("/api/vault/documents")
        titles = [d["title"] for d in resp.get_json()["documents"]]
        assert "Bob's doc" not in titles

    def test_nested_folder_ownership_cannot_be_bypassed(self, client):
        """#9 — neither creating a folder under someone else's folder, nor
        moving a folder underneath one via PATCH, may succeed."""
        _register(client, "alice4@example.com")
        parent_resp = _mutating(client, "post", "/api/vault/folders", json={"name": "Alice Root"})
        alice_parent_id = parent_resp.get_json()["id"]

        client.delete_cookie("access_token_cookie")
        client.delete_cookie("csrf_access_token")
        _register(client, "bob4@example.com")

        # Bob tries to create a subfolder under Alice's folder.
        resp = _mutating(
            client, "post", "/api/vault/folders",
            json={"name": "Bob Nested", "parent_id": alice_parent_id},
        )
        assert resp.status_code == 404

        # Bob tries to move one of his OWN folders to become a child of
        # Alice's folder via PATCH — must fail the same way.
        bob_folder = _mutating(client, "post", "/api/vault/folders", json={"name": "Bob's Own Folder"})
        bob_folder_id = bob_folder.get_json()["id"]
        resp = _mutating(
            client, "patch", f"/api/vault/folders/{bob_folder_id}",
            json={"parent_id": alice_parent_id},
        )
        assert resp.status_code == 404


class TestAuditTrailIDOR:
    def test_user_b_cannot_access_user_a_audit_trail(self, client):
        """#8 — audit_trail rows carry no user_id of their own; ownership
        must resolve transitively through the vault document they document,
        not be spoofable and not leak across users."""
        _register(client, "alice5@example.com")
        _save_document(
            client, title="Alice AI Draft", content="secret",
            audit_messages='[{"role": "user", "text": "draft an NDA"}]',
            session_title="Alice's AI session",
        )

        client.delete_cookie("access_token_cookie")
        client.delete_cookie("csrf_access_token")
        _register(client, "bob5@example.com")

        resp = client.get("/api/vault/audit-trail")
        assert resp.status_code == 200
        titles = [t["session_title"] for t in resp.get_json()["threads"]]
        assert "Alice's AI session" not in titles


class TestLegitimateFlowStillWorks:
    def test_existing_legitimate_vault_flow_still_works(self, client):
        """#10 — full save → list → folder → filter → update → delete round
        trip for a single user must work exactly as before the auth boundary
        was added; this is the regression check that the fix didn't lock
        legitimate owners out of their own data."""
        _register(client, "regression@example.com")

        folder_resp = _mutating(client, "post", "/api/vault/folders", json={"name": "My Matters"})
        assert folder_resp.status_code == 201
        folder_id = folder_resp.get_json()["id"]

        doc_id = _save_document(client, title="My Own NDA", content="Draft v1", folder_id=folder_id)

        listed = client.get(f"/api/vault/documents?folder_id={folder_id}")
        assert listed.status_code == 200
        assert any(d["id"] == doc_id for d in listed.get_json()["documents"])

        updated = _mutating(client, "put", f"/api/vault/documents/{doc_id}", json={"content": "Draft v2"})
        assert updated.status_code == 200

        fetched = client.get(f"/api/documents/{doc_id}")
        assert fetched.status_code == 200
        assert fetched.get_json()["text"] == "Draft v2"

        deleted = _mutating(client, "delete", f"/api/vault/documents/{doc_id}")
        assert deleted.status_code == 200

        gone = client.get(f"/api/documents/{doc_id}")
        assert gone.status_code == 404
