"""A fresh database built by create_app() must have chat_history.

This is the regression proof for the missing schema in the app factory: init_db() created
the table, but the create_app() builder did not, so POST /api/ai/chat silently swallowed
the failed INSERT and GET /api/ai/history always returned an empty list on a fresh deploy.

The table DDL is compared with init_db()'s DDL, and a real signed-in call proves the writer
still works and that POST /api/chat (the other assistant endpoint) does not write this table.
"""
import ast
import os
import re
import socket
import sqlite3
import types

from tests.helpers_app import make_app, register

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_PY = os.path.join(HERE, "app.py")
APP_SRC = open(APP_PY, encoding="utf-8").read()
TREE = ast.parse(APP_SRC)

# The 61 raw tables (excluding sqlite_sequence) that create_app() made at 144ecc6,
# before chat_history was added to the factory.  The fresh-database test asserts that
# chat_history is the ONLY addition.
BASELINE_TABLES = {
    "calendar_events", "case_vault", "deadlines",
    "dms_bundle_items", "dms_bundles", "dms_docs", "dms_file_prefs", "dms_filing",
    "dms_fts", "dms_fts_config", "dms_fts_data", "dms_fts_docsize", "dms_fts_idx",
    "dms_jobs", "dms_kv", "dms_locations",
    "dms_meta_fts", "dms_meta_fts_config", "dms_meta_fts_content", "dms_meta_fts_data",
    "dms_meta_fts_docsize", "dms_meta_fts_idx",
    "dms_pages", "dms_pfile_docs", "dms_pfile_moves", "dms_pfiles",
    "dms_scan_pages", "dms_scan_sessions",
    "document_chunks", "document_vault_shares",
    "handoff_notes", "letterheads",
    "lpms_audit", "lpms_cases", "lpms_clients", "lpms_comms", "lpms_current",
    "lpms_events", "lpms_firms", "lpms_followups", "lpms_hearings", "lpms_members",
    "lpms_mfa", "lpms_notes", "lpms_notifications", "lpms_outbox", "lpms_parties",
    "lpms_proceedings", "lpms_reminder_runs", "lpms_rti", "lpms_rti_events",
    "lpms_timeline",
    "matter_activity", "matters", "saved_drafts", "tasks_matter",
    "team_memberships", "teams",
    "vault_audit", "vault_folders", "vault_provenance",
}

FAKE_PROVIDER_KEYS = {
    "GROQ_API_KEY": "test-fake-groq-key",
    "OPENAI_API_KEY": "test-fake-openai-key",
    "PINECONE_API_KEY": "test-fake-pinecone-key",
    "PINECONE_HOST": "https://test-fake-pinecone.invalid",
    "ZENROWS_API_KEY": "test-fake-zenrows-key",
    "TAVILY_API_KEY": "test-fake-tavily-key",
}


def _function(name):
    return next(
        node for node in TREE.body
        if isinstance(node, ast.FunctionDef) and node.name == name
    )


def _chat_ddl(function):
    found = [
        node.value for node in ast.walk(function)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and "CREATE TABLE IF NOT EXISTS chat_history" in node.value
    ]
    assert len(found) == 1, f"expected exactly one chat_history DDL in {function.name}"
    return found[0]


def _normalised(sql):
    return re.sub(r"\s+", " ", sql).strip()


def _set_fake_keys_before_app_import(monkeypatch):
    """The helpers import app; set fake keys first so a local .env can never supply real ones."""
    for key, value in FAKE_PROVIDER_KEYS.items():
        monkeypatch.setenv(key, value)
    # RuntimeSettings/LLM pacing should never make a test wait or sleep.
    monkeypatch.setenv("LLM_TPM_BUDGET", "10000000")


def _restore_fake_keys(monkeypatch):
    # make_app deliberately blanks provider keys after importing app; restore the fakes for
    # the endpoint calls, which are fully mocked below.
    for key, value in FAKE_PROVIDER_KEYS.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setenv("LLM_TPM_BUDGET", "10000000")


def _row_count(db_path):
    con = sqlite3.connect(db_path)
    try:
        return con.execute("SELECT COUNT(*) FROM chat_history").fetchone()[0]
    finally:
        con.close()


def test_fresh_database_adds_only_chat_history(tmp_path, monkeypatch):
    _set_fake_keys_before_app_import(monkeypatch)
    app = make_app(tmp_path, monkeypatch)
    _restore_fake_keys(monkeypatch)
    assert app is not None

    con = sqlite3.connect(tmp_path / "lex_assistant.db")
    try:
        tables = {
            row[0] for row in con.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' "
                "AND name NOT LIKE 'sqlite_%'"
            )
        }
        assert tables - {"chat_history"} == BASELINE_TABLES
        assert "chat_history" in tables

        columns = [
            (row[1], row[2], row[3], row[4], row[5])
            for row in con.execute("PRAGMA table_info('chat_history')")
        ]
        assert columns == [
            ("id", "INTEGER", 0, None, 1),
            ("user_id", "INTEGER", 0, None, 0),
            ("user_message", "TEXT", 1, None, 0),
            ("bot_response", "TEXT", 1, None, 0),
            ("created_at", "DATETIME", 0, "CURRENT_TIMESTAMP", 0),
        ]
        assert con.execute(
            "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'chat_history'"
        ).fetchall() == []
    finally:
        con.close()


def test_chat_history_ddl_matches_init_db():
    init_ddl = _chat_ddl(_function("init_db"))
    factory_ddl = _chat_ddl(_function("create_app"))
    assert _normalised(init_ddl) == _normalised(factory_ddl)
    assert "id INTEGER PRIMARY KEY AUTOINCREMENT" in factory_ddl
    assert "user_id INTEGER" in factory_ddl
    assert "user_message TEXT NOT NULL" in factory_ddl
    assert "bot_response TEXT NOT NULL" in factory_ddl
    assert "created_at DATETIME DEFAULT CURRENT_TIMESTAMP" in factory_ddl
    assert re.search(
        r"CREATE\s+(?:UNIQUE\s+)?INDEX[^;]*chat_history", APP_SRC, re.IGNORECASE
    ) is None


def test_ai_chat_writes_one_row_and_assistant_chat_does_not(tmp_path, monkeypatch):
    _set_fake_keys_before_app_import(monkeypatch)
    # The endpoint paths under test are fully mocked; refusing sockets proves nothing
    # reaches a real provider even if a key were present.
    def deny_network(*_a, **_k):
        raise AssertionError("network access attempted in an offline test")

    monkeypatch.setattr(socket, "create_connection", deny_network)
    app = make_app(tmp_path, monkeypatch)
    _restore_fake_keys(monkeypatch)

    import app as app_module
    from utils import ai_helper

    calls = []

    def fake_completion(**kwargs):
        calls.append(kwargs)
        return types.SimpleNamespace(
            choices=[types.SimpleNamespace(
                message=types.SimpleNamespace(content="Fake Groq reply for chat_history test."),
                finish_reason="stop",
            )],
            usage=types.SimpleNamespace(total_tokens=12),
        )

    class FakeCompletions:
        def create(self, **kwargs):
            return types.SimpleNamespace(
                choices=[types.SimpleNamespace(
                    message=types.SimpleNamespace(
                        content="Fake assistant reply for no-write test.",
                        tool_calls=None,
                    ),
                    finish_reason="stop",
                )],
                usage=types.SimpleNamespace(total_tokens=12),
            )

    class FakeGroq:
        def __init__(self, *a, **k):
            self.chat = types.SimpleNamespace(completions=FakeCompletions())

    monkeypatch.setattr(ai_helper, "completion", fake_completion)
    monkeypatch.setattr(app_module, "Groq", FakeGroq)

    db_path = tmp_path / "lex_assistant.db"
    assert _row_count(db_path) == 0
    client = register(app, "chat-history-test@example.invalid")

    response = client.post("/api/ai/chat", json={"message": "hello chat history"})
    assert response.status_code == 200
    assert response.get_json() == {"response": "Fake Groq reply for chat_history test."}
    assert len(calls) == 1
    assert _row_count(db_path) == 1

    con = sqlite3.connect(db_path)
    try:
        rows = con.execute(
            "SELECT user_id, user_message, bot_response FROM chat_history"
        ).fetchall()
    finally:
        con.close()
    assert len(rows) == 1
    assert isinstance(rows[0][0], int)
    assert rows[0][1:] == (
        "hello chat history",
        "Fake Groq reply for chat_history test.",
    )

    history = client.get("/api/ai/history")
    assert history.status_code == 200
    threads = history.get_json()["threads"]
    assert len(threads) == 1
    assert threads[0]["user_message"] == "hello chat history"
    assert threads[0]["bot_response"] == "Fake Groq reply for chat_history test."

    assistant = client.post("/api/chat", json={"query": "hello assistant"})
    assert assistant.status_code == 200
    assert assistant.get_json()["action"] == "chat"
    assert _row_count(db_path) == 1
