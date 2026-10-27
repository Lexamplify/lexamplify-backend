"""POST /api/vault/save has exactly one handler.

It used to be registered twice (vault_workspace.save_vault_document and a dead copy in the argument blueprint). Flask
served the first one, so the second never ran. This test keeps a second copy from creeping back in.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from helpers_app import make_app     # noqa: E402

LIVE_ENDPOINT = "vault_workspace.save_vault_document"


@pytest.fixture()
def app(tmp_path, monkeypatch):
    monkeypatch.setenv("DMS_STRICT_MOUNT", "1")
    return make_app(tmp_path, monkeypatch, name="vault_save_single.db")


def test_vault_save_has_exactly_one_post_handler(app):
    rules = [
        rule for rule in app.url_map.iter_rules()
        if rule.rule == "/api/vault/save" and "POST" in rule.methods
    ]
    endpoints = [rule.endpoint for rule in rules]
    assert len(rules) == 1, f"POST /api/vault/save is registered {len(rules)} times: {endpoints}"
    assert endpoints[0] == LIVE_ENDPOINT
    assert endpoints[0] != "argument.save_vault"
