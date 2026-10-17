"""tests/test_redteam_gate.py - default-deny API gate, upload and export robustness."""
import io
from tests.test_usable_flow import anon, client, _Client  # noqa: F401  (fixtures)


def test_private_routes_need_sign_in(anon):
    for path in ("/api/clients/list", "/api/documents/draft", "/api/contract/extract-text"):
        r = anon.get(path)
        assert r.status_code in (401, 405), (path, r.status_code)
        if r.status_code == 401:
            assert r.get_json()["code"] == "AUTH_REQUIRED"


def test_public_routes_stay_public(anon):
    assert anon.get("/api/ping").status_code != 401
    assert anon.get("/api/auth/config").status_code != 401


def test_preflight_is_not_blocked(anon):
    r = anon.open("/api/clients/list", method="OPTIONS", headers={"Origin": "https://test.lexamplify.com", "Access-Control-Request-Method": "GET"})
    assert r.status_code != 401


def _up(c, data, name):
    return c.post("/api/contract/extract-text", data={"file": (io.BytesIO(data), name)}, content_type="multipart/form-data")


def test_upload_txt_ok_and_empty_and_corrupt(client):
    r = _up(client, "Sale deed between A and B".encode(), "a.txt")
    assert r.status_code == 200
    assert _up(client, b"", "a.txt").status_code == 422
    assert _up(client, b"not a real pdf", "a.pdf").status_code == 422
    assert _up(client, b"x", "a.exe").status_code in (400, 415, 422)


def test_export_rejects_hostile_input(client):
    assert client.post("/api/contract/export-form-docx", json={"html": 123}).status_code == 400
    r = client.post("/api/contract/export-form-docx", json={"html": "<p>Hi\x00\x07 there</p>", "title": "T"})
    assert r.status_code == 200
    assert client.post("/api/contract/export-form-docx", json={"html": "x" * 2_000_001}).status_code == 413
