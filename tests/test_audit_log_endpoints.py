"""
tests/test_audit_log_endpoints.py

Verifies that every endpoint name referenced in utils/audit_log.py (both in
WATCHED and in _detail / after_request) is registered in the real Flask app's
url_map, and that uploading a vault document through the real app records a
vault_uploaded audit event with the uploaded filename.
"""
import ast
import io
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from tests.helpers_app import make_app, register  # noqa: E402
from utils import audit_log  # noqa: E402


def _collect_audit_log_endpoint_literals():
    """Extract every literal endpoint name mentioned in audit_log._detail and
    audit_log.after_request (in addition to audit_log.WATCHED keys)."""
    src_path = os.path.abspath(audit_log.__file__)
    with open(src_path, encoding="utf-8") as fh:
        tree = ast.parse(fh.read(), filename=src_path)
    names = set()
    for fn_node in tree.body:
        if isinstance(fn_node, ast.FunctionDef) and fn_node.name in ("_detail", "after_request"):
            for node in ast.walk(fn_node):
                if isinstance(node, ast.Compare):
                    left = node.left
                    if isinstance(left, ast.Name) and left.id == "endpoint":
                        for comp in node.comparators:
                            if isinstance(comp, ast.Constant) and isinstance(comp.value, str):
                                names.add(comp.value)
                            elif isinstance(comp, (ast.Tuple, ast.List, ast.Set)):
                                for elt in comp.elts:
                                    if isinstance(elt, ast.Constant) and isinstance(elt.value, str):
                                        names.add(elt.value)
    return names


def test_every_watched_and_referenced_endpoint_is_registered_in_url_map(tmp_path, monkeypatch):
    flask_app = make_app(tmp_path, monkeypatch)
    registered = {rule.endpoint for rule in flask_app.url_map.iter_rules()}

    watched_endpoints = set(audit_log.WATCHED.keys())
    extra_endpoints = _collect_audit_log_endpoint_literals()
    assert extra_endpoints, "expected to find literal endpoint checks in _detail/after_request"

    missing_watched = sorted(watched_endpoints - registered)
    missing_extra = sorted(extra_endpoints - registered)
    assert not missing_watched, f"WATCHED endpoints missing from app.url_map: {missing_watched}"
    assert not missing_extra, f"audit_log endpoint literals missing from app.url_map: {missing_extra}"


def test_vault_upload_and_delete_record_audit_events(tmp_path, monkeypatch):
    flask_app = make_app(tmp_path, monkeypatch)
    user = register(flask_app, "vault_auditor@example.com")

    up_resp = user.post(
        "/api/vault/documents/upload",
        data={"file": (io.BytesIO(b"sample pleading bytes"), "affidavit_v1.txt")},
        content_type="multipart/form-data",
    )
    assert up_resp.status_code == 201, up_resp.get_json()
    doc_id = up_resp.get_json()["id"]

    del_resp = user.delete(f"/api/vault/documents/{doc_id}")
    assert del_resp.status_code == 200, del_resp.get_json()

    folder_resp = user.post("/api/vault/folders", json={"name": "Temp Folder"})
    assert folder_resp.status_code == 201, folder_resp.get_json()
    folder_id = folder_resp.get_json()["id"]
    fdel_resp = user.delete(f"/api/vault/folders/{folder_id}")
    assert fdel_resp.status_code == 200, fdel_resp.get_json()

    events = user.get("/api/audit/me").get_json()["events"]
    by_action = {e["action"]: e for e in events}
    assert "vault_uploaded" in by_action
    assert by_action["vault_uploaded"]["detail"] == "affidavit_v1.txt"
    assert "vault_deleted" in by_action
    assert "vault_folder_deleted" in by_action
