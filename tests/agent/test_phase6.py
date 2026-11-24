"""Phase 6 gate tests: code index build, evidence-backed answers,
version awareness, secret exclusion, and the ask_codebase tool end-to-end."""
import os
import sqlite3
import textwrap

import pytest

from agent import engine, intel, providers
from agent.tools import core_tools, action_tools, intel_tools  # noqa: F401
from tests.agent.test_phase2 import MATTERS_SQL, fake


@pytest.fixture
def repo(tmp_path):
    """A miniature fake repo with routes/ and utils/."""
    routes = tmp_path / "routes"
    routes.mkdir()
    (routes / "conflict_routes.py").write_text(textwrap.dedent('''
        from flask import Blueprint
        conflict_bp = Blueprint("conflict", __name__)

        @conflict_bp.route("/api/conflict/check", methods=["POST"])
        def run_conflict_check():
            """Screen a party name against existing clients."""
            return "ok"
    '''), encoding="utf-8")
    utils = tmp_path / "utils"
    utils.mkdir()
    (utils / "secrets_mod.py").write_text(textwrap.dedent('''
        def load_keys():
            """Reads the OPENAI api_key = from env."""
            return None

        class ConflictScanner:
            """Scans matters for conflicts of interest."""
    '''), encoding="utf-8")
    return str(tmp_path)


@pytest.fixture
def db(tmp_path):
    path = str(tmp_path / "agent6.db")
    with sqlite3.connect(path) as c:
        c.execute(MATTERS_SQL)
    return path


@pytest.fixture(autouse=True)
def _reset_provider():
    yield
    providers.set_provider(None)


def test_scan_indexes_routes_and_symbols(repo, db):
    res = intel.scan_repo(repo, db)
    assert res["files"] == 2 and res["symbols"] >= 3
    with sqlite3.connect(db) as c:
        kinds = {r[0] for r in c.execute("SELECT kind FROM agent_code_index")}
    assert {"route", "function", "class"} <= kinds


def test_search_answers_with_file_line_evidence(repo, db):
    intel.scan_repo(repo, db)
    res = intel.search_code(db, "which route handles conflict checking?")
    assert res["hits"], "expected hits for 'conflict'"
    top = res["hits"][0]
    assert "conflict" in (top["name"] + top["file"]).lower()
    assert ":" in top["evidence"] and top["evidence"].split(":")[0].endswith(".py")


def test_secret_like_docstrings_excluded(repo, db):
    intel.scan_repo(repo, db)
    with sqlite3.connect(db) as c:
        rows = c.execute("SELECT name, detail FROM agent_code_index WHERE name='load_keys'").fetchall()
    assert rows and all("api_key" not in (r[1] or "") for r in rows)   # function indexed, secretish doc dropped


def test_rescan_replaces_not_duplicates(repo, db):
    intel.scan_repo(repo, db)
    first = intel.search_code(db, "conflict")["hits"]
    intel.scan_repo(repo, db)
    second = intel.search_code(db, "conflict")["hits"]
    assert len(first) == len(second)


def test_search_before_index_is_empty_not_crash(db):
    res = intel.search_code(db, "anything at all")
    assert res["hits"] == [] and res["commit"] is None


def test_ask_codebase_tool_through_engine(repo, db, monkeypatch):
    monkeypatch.chdir(repo)
    intel.scan_repo(repo, db)
    fake([{"plan": [{"tool": "ask_codebase", "inputs": {"question": "conflict check route"}}], "reply": "ok"}])
    t = engine.submit_task(db, 1, 10, "which route handles conflict checking?")
    assert t["state"] == "COMPLETED"
    out = t["steps"][0]["output"]
    assert out["count"] >= 1 and out["commit"]                 # version-aware answer
    assert t["steps"][0]["verification"].startswith("VERIFIED_SUCCESS")


def test_ask_codebase_unbuilt_index_partial(db, tmp_path, monkeypatch):
    monkeypatch.chdir(str(tmp_path))
    fake([{"plan": [{"tool": "ask_codebase", "inputs": {"question": "whatever"}}], "reply": "ok"}])
    t = engine.submit_task(db, 1, 10, "where is x?")
    assert t["state"] == "COMPLETED"                            # degrades, doesn't lie
    assert t["result"]["evidence"][0]["confidence"] == "UNCERTAIN"
