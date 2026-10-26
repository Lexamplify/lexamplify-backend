"""
Tests for Part 2, Batch 4 of the Case Vault privacy fix (chat and AI reads):
- `POST /api/ai/simulate` (`routes/ai_routes.py` Pass 1 `document_reference` lookup and Pass 3 most-recent fallback):
  strictly owner-only (`user_id = ?`).
- `POST /api/chat` (`routes/assistant_routes.py`):
  - `run_courtroom_simulation` tool: strictly owner-only (`user_id = ?`).
  - `search_case_vault` tool by `case_id`: caller's own rows + public judgments (`(user_id = ? OR is_public = 1)`).
  - `search_case_vault` tool by `search_query`: caller's own rows + public judgments (`(user_id = ? OR is_public = 1)`).
  - `search_case_vault` tool fallback (no `case_id` and no `search_query`): strictly owner-only (`user_id = ?`).
"""
import json
import os
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from tests.test_vault_workspace import Browser, fresh_allowances as _fresh_allowances, real as _real_fixture  # noqa: E402

pytest_plugins = ("tests.test_vault_workspace",)
_ = (_fresh_allowances, _real_fixture)


def _ensure_is_public(conn):
    try:
        conn.execute("ALTER TABLE case_vault ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0")
        conn.commit()
    except Exception:
        pass


def _make_chat_response(content="", tool_calls=None):
    msg = SimpleNamespace(
        role="assistant",
        content=content,
        tool_calls=tool_calls,
        model_dump=lambda: {
            "role": "assistant",
            "content": content,
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments,
                    },
                }
                for tc in (tool_calls or [])
            ],
        },
    )
    return SimpleNamespace(choices=[SimpleNamespace(message=msg)])


def _make_tool_call(name, arguments_dict):
    return SimpleNamespace(
        id="call_test_1",
        type="function",
        function=SimpleNamespace(
            name=name,
            arguments=json.dumps(arguments_dict),
        ),
    )


def test_ai_simulate_and_chat_vault_reads_access_rules(real, monkeypatch):
    flask_app, app_module = real
    conn = app_module.db
    _ensure_is_public(conn)

    # Ensure Tavily is not called during simulation tests
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)

    # Clean table rows so assertions are exact
    conn.execute("DELETE FROM document_vault_shares")
    conn.execute("DELETE FROM dms_pages")
    conn.execute("DELETE FROM dms_docs")
    conn.execute("DELETE FROM document_chunks")
    conn.execute("DELETE FROM case_vault")
    conn.execute("DELETE FROM vault_folders")
    conn.commit()

    user_a = Browser(flask_app, name="Advocate Alice")
    user_b = Browser(flask_app, name="Advocate Bob")

    # Seed the 4 required rows:
    # 1) User A's private row
    # 2) User B's private row
    # 3) Unowned row with is_public = 0
    # 4) Unowned row with is_public = 1
    # Give unowned rows and Bob's row newer timestamps so Pass 3 fallback tests prove
    # it does not pick a newer row belonging to someone else or unowned.
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO case_vault (case_id, title, doc_type, content, user_id, is_public, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            "CASE-ALICE-1",
            "Alice bail memo alphaunique",
            "Bail Application",
            "Alice private bail content alphaunique",
            user_a.uid,
            0,
            "2026-01-01 10:00:00",
        ),
    )
    doc_a = cur.lastrowid

    cur.execute(
        "INSERT INTO case_vault (case_id, title, doc_type, content, user_id, is_public, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            "CASE-BOB-1",
            "Bob defense brief bravoouniq",
            "Written Statement",
            "Bob private defense content bravoouniq",
            user_b.uid,
            0,
            "2026-01-02 10:00:00",
        ),
    )
    doc_b = cur.lastrowid

    cur.execute(
        "INSERT INTO case_vault (case_id, title, doc_type, content, user_id, is_public, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            "CASE-NULL-PRIV",
            "Legacy unowned note charlieuniq",
            "Affidavit",
            "Unowned private affidavit content charlieuniq",
            None,
            0,
            "2026-01-03 10:00:00",
        ),
    )
    doc_null_priv = cur.lastrowid

    cur.execute(
        "INSERT INTO case_vault (case_id, title, doc_type, content, user_id, is_public, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            "2025INSC900",
            "Supreme Court precedent deltauniq",
            "Judgment",
            "Public judgment full text deltauniq",
            None,
            1,
            "2026-01-04 10:00:00",
        ),
    )
    doc_null_pub = cur.lastrowid
    conn.commit()
    assert len({doc_a, doc_b, doc_null_priv, doc_null_pub}) == 4

    # ── 1. POST /api/ai/simulate (routes/ai_routes.py:395 Pass 1 & :435 Pass 3) ─
    import utils.rag_pipeline as rag_pipeline

    sim_prompts = []

    def _sim_create(model, messages, **kwargs):
        prompt_text = messages[0]["content"]
        sim_prompts.append(prompt_text)
        if "Extract structured legal case metadata" in prompt_text:
            return _make_chat_response(
                json.dumps(
                    {
                        "ref": "SIM-1",
                        "plaintiff": "P",
                        "defendant": "D",
                        "title": "P v. D",
                        "subtitle": "Sub",
                        "matter_type": "Civil",
                        "summary_columns": [],
                        "facts": "Facts",
                        "extracted_issues": "Core issues",
                        "search_query": "bail precedent",
                    }
                )
            )
        if "opposing_counter_questions" in prompt_text:
            return _make_chat_response(
                json.dumps(
                    {
                        "opposing_counter_questions": [
                            {"question": "Q1", "suggested_rebuttal": "R1"}
                        ]
                    }
                )
            )
        return _make_chat_response("Opening argument text")

    mock_sim_client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=_sim_create))
    )
    monkeypatch.setattr(rag_pipeline, "get_groq_client", lambda: mock_sim_client)

    # Pass 1: User A looks up own document by reference -> uses User A's content
    sim_prompts.clear()
    r_sim_a = user_a.send("post", "/api/ai/simulate", {"document_reference": "Alice bail memo"})
    assert r_sim_a.status_code == 200, r_sim_a.get_json()
    assert any("Alice private bail content alphaunique" in p for p in sim_prompts)

    # Pass 1 + Pass 3: User A references Bob's row, unowned private row, or unowned public row ->
    # Pass 1 refuses all three, and Pass 3 falls back only to User A's own document (never leaking the others).
    for forbidden_ref, forbidden_content in (
        ("Bob defense brief", "Bob private defense content bravoouniq"),
        ("Legacy unowned note", "Unowned private affidavit content charlieuniq"),
        ("Supreme Court precedent", "Public judgment full text deltauniq"),
    ):
        sim_prompts.clear()
        r_ref = user_a.send("post", "/api/ai/simulate", {"document_reference": forbidden_ref})
        assert r_ref.status_code == 200
        assert all(forbidden_content not in p for p in sim_prompts)
        assert any("Alice private bail content alphaunique" in p for p in sim_prompts)

    # Pass 3 with no own rows: if a user has no own rows in case_vault, neither Pass 1 nor Pass 3
    # may return another user's row, the unowned private row, or the unowned public row.
    user_c = Browser(flask_app, name="Advocate Carol")
    for ref in ("", "Bob defense brief", "Legacy unowned note", "Supreme Court precedent"):
        sim_prompts.clear()
        r_c = user_c.send("post", "/api/ai/simulate", {"document_reference": ref})
        assert r_c.status_code == 400
        assert sim_prompts == []

    # Pass 3 for User B (empty document_reference): picks User B's own row even though unowned rows are newer
    sim_prompts.clear()
    r_sim_b = user_b.send("post", "/api/ai/simulate", {"document_reference": ""})
    assert r_sim_b.status_code == 200
    assert any("Bob private defense content bravoouniq" in p for p in sim_prompts)
    assert all("Unowned private affidavit content charlieuniq" not in p for p in sim_prompts)
    assert all("Public judgment full text deltauniq" not in p for p in sim_prompts)

    # ── 2. POST /api/chat: run_courtroom_simulation (routes/assistant_routes.py:713) ─
    chat_recorded_messages = []
    next_tool_call = {"tc": None}

    def _chat_create(model, messages, **kwargs):
        chat_recorded_messages.append(messages)
        if kwargs.get("tools"):
            return _make_chat_response(content="", tool_calls=[next_tool_call["tc"]])
        # For run_courtroom_simulation stages or second chat completion
        prompt_text = messages[-1].get("content", "")
        if "extracted_issues" in prompt_text:
            return _make_chat_response(
                json.dumps(
                    {
                        "extracted_issues": "Extracted issues",
                        "search_query": "supreme court bail",
                    }
                )
            )
        if "opposing_counter_questions" in prompt_text:
            return _make_chat_response(
                json.dumps(
                    {
                        "opposing_counter_questions": [
                            {"question": "Counter Q", "suggested_rebuttal": "Rebuttal"}
                        ]
                    }
                )
            )
        return _make_chat_response(content="Assistant final reply")

    mock_chat_client = SimpleNamespace(
        chat=SimpleNamespace(completions=SimpleNamespace(create=_chat_create))
    )
    monkeypatch.setattr(app_module, "Groq", lambda api_key=None: mock_chat_client)

    def _call_chat_tool(browser, tool_name, tool_args):
        chat_recorded_messages.clear()
        next_tool_call["tc"] = _make_tool_call(tool_name, tool_args)
        return browser.send("post", "/api/chat", {"query": "run tool"})

    # User A can simulate only on CASE-ALICE-1; User B's row, unowned private, and unowned public all return 400
    r_cs_a_own = _call_chat_tool(
        user_a, "run_courtroom_simulation", {"case_id": "CASE-ALICE-1", "client_side": "Appellant"}
    )
    assert r_cs_a_own.status_code == 200, r_cs_a_own.get_json()
    assert r_cs_a_own.get_json()["action"] == "simulate_courtroom"
    assert any(
        "Alice private bail content alphaunique" in m[-1]["content"]
        for m in chat_recorded_messages
    )

    for forbidden_cid in ("CASE-BOB-1", "CASE-NULL-PRIV", "2025INSC900"):
        r_cs_forbidden = _call_chat_tool(
            user_a, "run_courtroom_simulation", {"case_id": forbidden_cid, "client_side": "Appellant"}
        )
        assert r_cs_forbidden.status_code == 400
        assert "not found in the Case Vault" in r_cs_forbidden.get_json()["message"]

    # User B can simulate only on CASE-BOB-1
    r_cs_b_own = _call_chat_tool(
        user_b, "run_courtroom_simulation", {"case_id": "CASE-BOB-1", "client_side": "Respondent"}
    )
    assert r_cs_b_own.status_code == 200
    assert any(
        "Bob private defense content bravoouniq" in m[-1]["content"]
        for m in chat_recorded_messages
    )
    for forbidden_cid in ("CASE-ALICE-1", "CASE-NULL-PRIV", "2025INSC900"):
        r_cs_b_forbidden = _call_chat_tool(
            user_b, "run_courtroom_simulation", {"case_id": forbidden_cid, "client_side": "Respondent"}
        )
        assert r_cs_b_forbidden.status_code == 400

    # ── 3. POST /api/chat: search_case_vault by case_id (routes/assistant_routes.py:858) ─
    def _tool_output():
        # Second call to Groq has the tool output as the last message
        assert len(chat_recorded_messages) >= 2
        second_call_msgs = chat_recorded_messages[-1]
        tool_msgs = [m for m in second_call_msgs if m.get("role") == "tool"]
        assert len(tool_msgs) == 1
        return tool_msgs[0]["content"]

    # User A: sees own row and public judgment; does NOT see User B's row or unowned private row
    r = _call_chat_tool(user_a, "search_case_vault", {"case_id": "CASE-ALICE-1", "search_query": None})
    assert r.status_code == 200
    assert "Alice private bail content alphaunique" in _tool_output()

    r = _call_chat_tool(user_a, "search_case_vault", {"case_id": "2025INSC900", "search_query": None})
    assert r.status_code == 200
    assert "Public judgment full text deltauniq" in _tool_output()

    for hidden_cid in ("CASE-BOB-1", "CASE-NULL-PRIV"):
        r = _call_chat_tool(user_a, "search_case_vault", {"case_id": hidden_cid, "search_query": None})
        assert r.status_code == 200
        assert _tool_output() == "No documents found in the Case Vault."

    # User B: sees own row and public judgment; does NOT see User A's row or unowned private row
    r = _call_chat_tool(user_b, "search_case_vault", {"case_id": "CASE-BOB-1", "search_query": None})
    assert r.status_code == 200
    assert "Bob private defense content bravoouniq" in _tool_output()

    r = _call_chat_tool(user_b, "search_case_vault", {"case_id": "2025INSC900", "search_query": None})
    assert r.status_code == 200
    assert "Public judgment full text deltauniq" in _tool_output()

    for hidden_cid in ("CASE-ALICE-1", "CASE-NULL-PRIV"):
        r = _call_chat_tool(user_b, "search_case_vault", {"case_id": hidden_cid, "search_query": None})
        assert r.status_code == 200
        assert _tool_output() == "No documents found in the Case Vault."

    # ── 4. POST /api/chat: search_case_vault by search_query (routes/assistant_routes.py:865) ─
    # User A: keyword search finds own row and public row, but never User B's row or unowned private row
    r = _call_chat_tool(user_a, "search_case_vault", {"case_id": None, "search_query": "alphaunique"})
    assert r.status_code == 200
    assert "Alice private bail content alphaunique" in _tool_output()

    r = _call_chat_tool(user_a, "search_case_vault", {"case_id": None, "search_query": "deltauniq"})
    assert r.status_code == 200
    assert "Public judgment full text deltauniq" in _tool_output()

    for hidden_kw in ("bravoouniq", "charlieuniq"):
        r = _call_chat_tool(user_a, "search_case_vault", {"case_id": None, "search_query": hidden_kw})
        assert r.status_code == 200
        assert _tool_output() == "No documents found matching this query in the Case Vault."

    # User B: keyword search finds own row and public row, but never User A's row or unowned private row
    r = _call_chat_tool(user_b, "search_case_vault", {"case_id": None, "search_query": "bravoouniq"})
    assert r.status_code == 200
    assert "Bob private defense content bravoouniq" in _tool_output()

    r = _call_chat_tool(user_b, "search_case_vault", {"case_id": None, "search_query": "deltauniq"})
    assert r.status_code == 200
    assert "Public judgment full text deltauniq" in _tool_output()

    for hidden_kw in ("alphaunique", "charlieuniq"):
        r = _call_chat_tool(user_b, "search_case_vault", {"case_id": None, "search_query": hidden_kw})
        assert r.status_code == 200
        assert _tool_output() == "No documents found matching this query in the Case Vault."

    # ── 5. POST /api/chat: search_case_vault fallback list (routes/assistant_routes.py:885) ─
    # No case_id and no search_query -> strictly own documents only (excludes public judgments too)
    r = _call_chat_tool(user_a, "search_case_vault", {"case_id": None, "search_query": None})
    assert r.status_code == 200
    out_a = _tool_output()
    assert "CASE-ALICE-1" in out_a
    assert "CASE-BOB-1" not in out_a
    assert "CASE-NULL-PRIV" not in out_a
    assert "2025INSC900" not in out_a

    r = _call_chat_tool(user_b, "search_case_vault", {"case_id": None, "search_query": None})
    assert r.status_code == 200
    out_b = _tool_output()
    assert "CASE-BOB-1" in out_b
    assert "CASE-ALICE-1" not in out_b
    assert "CASE-NULL-PRIV" not in out_b
    assert "2025INSC900" not in out_b
