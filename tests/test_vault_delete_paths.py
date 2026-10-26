"""
Tests for Part 2, Batch 6 of the Case Vault privacy fix (delete paths):
- Old route DELETE /api/documents/<id> is owner-only (deletes document + RAG chunks for owner;
  returns 404 for other user's doc, unowned is_public=0 doc, and unowned is_public=1 doc,
  leaving those rows and their document_chunks untouched).
- Vault routes DELETE /api/vault/documents/<id> and DELETE /api/vault/folders/<id>
  reject cross-user and unowned rows (404, leaving rows intact) while allowing the owner.
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


def _seed_doc_with_chunks(conn, *, case_id, title, doc_type, content, user_id, is_public, chunk_user_id, folder_id=None):
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO case_vault (case_id, title, smart_title, doc_type, content, folder_id, user_id, is_public) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (case_id, title, title, doc_type, content, folder_id, user_id, is_public),
    )
    doc_id = cur.lastrowid
    for idx in range(2):
        cur.execute(
            "INSERT INTO document_chunks (user_id, case_id, document_id, chunk_index, chunk_text, embedding) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (chunk_user_id, case_id, doc_id, idx, f"{title} chunk {idx}", "[]"),
        )
    conn.commit()
    return doc_id


def _doc_exists(conn, doc_id):
    return conn.execute("SELECT 1 FROM case_vault WHERE id = ?", (doc_id,)).fetchone() is not None


def _chunk_count(conn, doc_id):
    return conn.execute("SELECT COUNT(*) FROM document_chunks WHERE document_id = ?", (doc_id,)).fetchone()[0]


def _folder_exists(conn, folder_id):
    return conn.execute("SELECT 1 FROM vault_folders WHERE id = ?", (folder_id,)).fetchone() is not None


def test_old_documents_delete_is_owner_only_and_preserves_chunks(real):
    flask_app, app_module = real
    conn = app_module.db
    _ensure_is_public(conn)

    conn.execute("DELETE FROM document_vault_shares")
    conn.execute("DELETE FROM document_chunks")
    conn.execute("DELETE FROM case_vault")
    conn.execute("DELETE FROM vault_folders")
    conn.commit()

    user_a = Browser(flask_app, name="Advocate Alice")
    user_b = Browser(flask_app, name="Advocate Bob")

    doc_a = _seed_doc_with_chunks(
        conn,
        case_id="DEL-ALICE-1",
        title="Alice Own Doc",
        doc_type="Draft",
        content="Alice private content",
        user_id=user_a.uid,
        is_public=0,
        chunk_user_id=user_a.uid,
    )
    doc_b = _seed_doc_with_chunks(
        conn,
        case_id="DEL-BOB-1",
        title="Bob Own Doc",
        doc_type="Draft",
        content="Bob private content",
        user_id=user_b.uid,
        is_public=0,
        chunk_user_id=user_b.uid,
    )
    doc_unowned_priv = _seed_doc_with_chunks(
        conn,
        case_id="DEL-NULL-PRIV",
        title="Unowned Private Doc",
        doc_type="Draft",
        content="Legacy unowned content",
        user_id=None,
        is_public=0,
        chunk_user_id=0,
    )
    doc_unowned_pub = _seed_doc_with_chunks(
        conn,
        case_id="DEL-NULL-PUB",
        title="Unowned Public Judgment",
        doc_type="Judgment",
        content="Public SC judgment text",
        user_id=None,
        is_public=1,
        chunk_user_id=0,
    )

    # A gets 404 for B's doc, unowned private doc, and unowned public doc; rows + chunks stay intact
    for target_id in (doc_b, doc_unowned_priv, doc_unowned_pub):
        resp = user_a.send("delete", f"/api/documents/{target_id}")
        assert resp.status_code == 404
        assert resp.get_json() == {"error": "Document not found."}
        assert _doc_exists(conn, target_id)
        assert _chunk_count(conn, target_id) == 2

    # A can delete A's own doc (200) and its chunks are removed
    resp_own = user_a.send("delete", f"/api/documents/{doc_a}")
    assert resp_own.status_code == 200
    assert not _doc_exists(conn, doc_a)
    assert _chunk_count(conn, doc_a) == 0

    # Other rows and chunks still exist after A's delete
    for target_id in (doc_b, doc_unowned_priv, doc_unowned_pub):
        assert _doc_exists(conn, target_id)
        assert _chunk_count(conn, target_id) == 2


def test_vault_document_and_folder_delete_routes_are_owner_only(real):
    flask_app, app_module = real
    conn = app_module.db
    _ensure_is_public(conn)

    conn.execute("DELETE FROM document_vault_shares")
    conn.execute("DELETE FROM document_chunks")
    conn.execute("DELETE FROM case_vault")
    conn.execute("DELETE FROM vault_folders")
    conn.commit()

    user_a = Browser(flask_app, name="Advocate Alice Vault")
    user_b = Browser(flask_app, name="Advocate Bob Vault")

    # Seed documents for DELETE /api/vault/documents/<id>
    vdoc_a = _seed_doc_with_chunks(
        conn,
        case_id="VDEL-ALICE-1",
        title="Alice Vault Doc",
        doc_type="Draft",
        content="Alice vault content",
        user_id=user_a.uid,
        is_public=0,
        chunk_user_id=user_a.uid,
    )
    vdoc_b = _seed_doc_with_chunks(
        conn,
        case_id="VDEL-BOB-1",
        title="Bob Vault Doc",
        doc_type="Draft",
        content="Bob vault content",
        user_id=user_b.uid,
        is_public=0,
        chunk_user_id=user_b.uid,
    )
    vdoc_unowned_priv = _seed_doc_with_chunks(
        conn,
        case_id="VDEL-NULL-PRIV",
        title="Unowned Private Vault Doc",
        doc_type="Draft",
        content="Unowned private vault content",
        user_id=None,
        is_public=0,
        chunk_user_id=0,
    )
    vdoc_unowned_pub = _seed_doc_with_chunks(
        conn,
        case_id="VDEL-NULL-PUB",
        title="Unowned Public Vault Judgment",
        doc_type="Judgment",
        content="Unowned public judgment content",
        user_id=None,
        is_public=1,
        chunk_user_id=0,
    )

    # A gets 404 for B's doc, unowned private doc, and unowned public doc on /api/vault/documents/<id>
    for target_id in (vdoc_b, vdoc_unowned_priv, vdoc_unowned_pub):
        r = user_a.send("delete", f"/api/vault/documents/{target_id}")
        assert r.status_code == 404
        assert _doc_exists(conn, target_id)

    # A can delete A's own vault doc
    r_own_doc = user_a.send("delete", f"/api/vault/documents/{vdoc_a}")
    assert r_own_doc.status_code == 200
    assert not _doc_exists(conn, vdoc_a)

    # Seed folders + nested docs for DELETE /api/vault/folders/<id>
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO vault_folders (name, parent_id, protected, user_id) VALUES (?, NULL, 0, ?)",
        ("Alice Folder", user_a.uid),
    )
    folder_a = cur.lastrowid
    doc_in_folder_a = _seed_doc_with_chunks(
        conn,
        case_id="FDEL-ALICE",
        title="Doc Inside Alice Folder",
        doc_type="Draft",
        content="Alice folder doc",
        user_id=user_a.uid,
        is_public=0,
        chunk_user_id=user_a.uid,
        folder_id=folder_a,
    )

    cur.execute(
        "INSERT INTO vault_folders (name, parent_id, protected, user_id) VALUES (?, NULL, 0, ?)",
        ("Bob Folder", user_b.uid),
    )
    folder_b = cur.lastrowid
    doc_in_folder_b = _seed_doc_with_chunks(
        conn,
        case_id="FDEL-BOB",
        title="Doc Inside Bob Folder",
        doc_type="Draft",
        content="Bob folder doc",
        user_id=user_b.uid,
        is_public=0,
        chunk_user_id=user_b.uid,
        folder_id=folder_b,
    )

    cur.execute(
        "INSERT INTO vault_folders (name, parent_id, protected, user_id) VALUES (?, NULL, 0, NULL)",
        ("Unowned Legacy Folder",),
    )
    folder_null = cur.lastrowid
    doc_in_folder_null = _seed_doc_with_chunks(
        conn,
        case_id="FDEL-NULL",
        title="Doc Inside Unowned Folder",
        doc_type="Draft",
        content="Unowned folder doc",
        user_id=None,
        is_public=0,
        chunk_user_id=0,
        folder_id=folder_null,
    )
    conn.commit()

    # A gets 404 for B's folder and for a folder with user_id NULL; folder and docs still exist
    for fid, did in ((folder_b, doc_in_folder_b), (folder_null, doc_in_folder_null)):
        rf = user_a.send("delete", f"/api/vault/folders/{fid}")
        assert rf.status_code == 404
        assert _folder_exists(conn, fid)
        assert _doc_exists(conn, did)

    # A can delete A's own folder (and its nested doc is deleted)
    rf_own = user_a.send("delete", f"/api/vault/folders/{folder_a}")
    assert rf_own.status_code == 200
    assert not _folder_exists(conn, folder_a)
    assert not _doc_exists(conn, doc_in_folder_a)
