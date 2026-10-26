"""
Tests for Part 2, Batch 3 of the Case Vault privacy fix:
- Public judgments (`is_public = 1`) remain readable on `GET /api/firm-library` and `GET /api/legal-research/document/<case_id>`
- Non-public unowned rows (`user_id IS NULL, is_public = 0`) disappear from all of these
- `GET /api/documents` (with and without `case_id`), `GET /api/documents/<id>`,
  `GET /api/matters/<id>/documents`, and `GET /api/cases/autocomplete` are strictly owner-only
"""
import os
import sys

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


def test_public_reads_and_owner_only_document_matter_autocomplete_routes(real):
    flask_app, app_module = real
    conn = app_module.db
    _ensure_is_public(conn)

    # Clean table rows so assertions are exact
    conn.execute("DELETE FROM document_vault_shares")
    conn.execute("DELETE FROM dms_pages")
    conn.execute("DELETE FROM dms_docs")
    conn.execute("DELETE FROM document_chunks")
    conn.execute("DELETE FROM case_vault")
    conn.execute("DELETE FROM vault_folders")
    conn.execute("DELETE FROM matters")
    conn.commit()

    user_a = Browser(flask_app, name="Advocate Alice")
    user_b = Browser(flask_app, name="Advocate Bob")

    # Seed 4 main rows with CASE_ID_RE-compliant case_ids (^[A-Za-z0-9_-]+$):
    # 1) User A's own document
    # 2) User B's own document
    # 3) No-owner, non-public document (user_id IS NULL, is_public = 0)
    # 4) No-owner, public judgment (user_id IS NULL, is_public = 1)
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO case_vault (case_id, title, smart_title, doc_type, content, user_id, is_public) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("CASE-ALICE-1", "SharedPrefix Alice Strategy Memo", "SharedPrefix Alice Strategy Memo", "Draft", "Alice private content", user_a.uid, 0),
    )
    doc_a = cur.lastrowid

    cur.execute(
        "INSERT INTO case_vault (case_id, title, smart_title, doc_type, content, user_id, is_public) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("CASE-BOB-1", "SharedPrefix Bob Defense Brief", "SharedPrefix Bob Defense Brief", "Draft", "Bob private content", user_b.uid, 0),
    )
    doc_b = cur.lastrowid

    cur.execute(
        "INSERT INTO case_vault (case_id, title, smart_title, doc_type, content, user_id, is_public) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("CASE-NULL-PRIV", "SharedPrefix Unowned Legacy Note", "SharedPrefix Unowned Legacy Note", "Draft", "Unowned non-public content", None, 0),
    )
    doc_null_priv = cur.lastrowid

    cur.execute(
        "INSERT INTO case_vault (case_id, title, smart_title, doc_type, content, user_id, is_public) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        ("2025INSC900", "SharedPrefix Public SC Judgment", "SharedPrefix Public SC Judgment", "Judgment", "Public Supreme Court judgment full text", None, 1),
    )
    doc_null_pub = cur.lastrowid
    conn.commit()

    # ── 1. GET /api/legal-research/document/<case_id> ─────────────────────────
    # Owner reads own; other user gets 404
    r_a_own = user_a.get("/api/legal-research/document/CASE-ALICE-1")
    assert r_a_own.status_code == 200
    assert r_a_own.get_json()["title"] == "SharedPrefix Alice Strategy Memo"
    assert user_b.get("/api/legal-research/document/CASE-ALICE-1").status_code == 404

    r_b_own = user_b.get("/api/legal-research/document/CASE-BOB-1")
    assert r_b_own.status_code == 200
    assert r_b_own.get_json()["title"] == "SharedPrefix Bob Defense Brief"
    assert user_a.get("/api/legal-research/document/CASE-BOB-1").status_code == 404

    # No-owner non-public row gives 404 to both users
    assert user_a.get("/api/legal-research/document/CASE-NULL-PRIV").status_code == 404
    assert user_b.get("/api/legal-research/document/CASE-NULL-PRIV").status_code == 404

    # Public row is readable by both users
    for u in (user_a, user_b):
        r_pub = u.get("/api/legal-research/document/2025INSC900")
        assert r_pub.status_code == 200
        assert r_pub.get_json()["title"] == "SharedPrefix Public SC Judgment"

    # ── 2. GET /api/firm-library ──────────────────────────────────────────────
    fl_a_ids = {d["id"] for d in user_a.get("/api/firm-library").get_json()}
    fl_b_ids = {d["id"] for d in user_b.get("/api/firm-library").get_json()}

    assert fl_a_ids == {doc_a, doc_null_pub}
    assert fl_b_ids == {doc_b, doc_null_pub}
    assert doc_null_priv not in fl_a_ids and doc_null_priv not in fl_b_ids
    assert doc_b not in fl_a_ids and doc_a not in fl_b_ids

    # ── 3. GET /api/documents (with and without case_id) & GET /api/documents/<id> ─
    # Without case_id: only own rows
    docs_a_all = [d["id"] for d in user_a.get("/api/documents").get_json()]
    docs_b_all = [d["id"] for d in user_b.get("/api/documents").get_json()]
    assert docs_a_all == [doc_a]
    assert docs_b_all == [doc_b]

    # With case_id: own case_id returns own row; other user's or NULL-owner (public or not) returns []
    assert [d["id"] for d in user_a.get("/api/documents?case_id=CASE-ALICE-1").get_json()] == [doc_a]
    assert user_a.get("/api/documents?case_id=CASE-BOB-1").get_json() == []
    assert user_a.get("/api/documents?case_id=CASE-NULL-PRIV").get_json() == []
    assert user_a.get("/api/documents?case_id=2025INSC900").get_json() == []

    assert [d["id"] for d in user_b.get("/api/documents?case_id=CASE-BOB-1").get_json()] == [doc_b]
    assert user_b.get("/api/documents?case_id=CASE-ALICE-1").get_json() == []
    assert user_b.get("/api/documents?case_id=CASE-NULL-PRIV").get_json() == []
    assert user_b.get("/api/documents?case_id=2025INSC900").get_json() == []

    # GET /api/documents/<id>: owner gets 200; other user and NULL-owner rows (public or not) give 404
    assert user_a.get(f"/api/documents/{doc_a}").status_code == 200
    assert user_a.get(f"/api/documents/{doc_b}").status_code == 404
    assert user_a.get(f"/api/documents/{doc_null_priv}").status_code == 404
    assert user_a.get(f"/api/documents/{doc_null_pub}").status_code == 404

    assert user_b.get(f"/api/documents/{doc_b}").status_code == 200
    assert user_b.get(f"/api/documents/{doc_a}").status_code == 404
    assert user_b.get(f"/api/documents/{doc_null_priv}").status_code == 404
    assert user_b.get(f"/api/documents/{doc_null_pub}").status_code == 404

    # ── 4. GET /api/matters/<id>/documents ────────────────────────────────────
    m_resp = user_a.send("post", "/api/matters", {"title": "Alice v. Acme"})
    assert m_resp.status_code == 201, m_resp.get_json()
    matter_id = m_resp.get_json()["matter"]["id"]
    matter_case_id = f"matter:{matter_id}"

    cur.execute(
        "INSERT INTO case_vault (case_id, title, doc_type, content, user_id, is_public) "
        "VALUES (?, 'Alice Matter Doc', 'Draft', 'owned matter doc', ?, 0)",
        (matter_case_id, user_a.uid),
    )
    matter_doc_own = cur.lastrowid
    cur.execute(
        "INSERT INTO case_vault (case_id, title, doc_type, content, user_id, is_public) "
        "VALUES (?, 'Unowned Matter Doc Priv', 'Draft', 'unowned priv', NULL, 0), "
        "       (?, 'Unowned Matter Doc Pub', 'Judgment', 'unowned pub', NULL, 1), "
        "       (?, 'Bob Matter Doc', 'Draft', 'bob doc', ?, 0)",
        (matter_case_id, matter_case_id, matter_case_id, user_b.uid),
    )
    conn.commit()

    m_docs_resp = user_a.get(f"/api/matters/{matter_id}/documents")
    assert m_docs_resp.status_code == 200
    m_doc_ids = [d["id"] for d in m_docs_resp.get_json()["documents"]]
    assert m_doc_ids == [matter_doc_own]

    # ── 5. GET /api/cases/autocomplete ────────────────────────────────────────
    ac_a = user_a.get("/api/cases/autocomplete?q=SharedPrefix").get_json()
    ac_b = user_b.get("/api/cases/autocomplete?q=SharedPrefix").get_json()
    assert [r["id"] for r in ac_a] == [doc_a]
    assert [r["title"] for r in ac_a] == ["SharedPrefix Alice Strategy Memo"]
    assert [r["id"] for r in ac_b] == [doc_b]
    assert [r["title"] for r in ac_b] == ["SharedPrefix Bob Defense Brief"]
