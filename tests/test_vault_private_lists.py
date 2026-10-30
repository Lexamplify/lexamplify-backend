"""
Tests for Part 2, Batch 2 of the Case Vault privacy fix:
Private vault lists, counts, overview, timeline, destinations, and blueprint init
show only the signed-in user's own rows (plus rows shared with them).
Unowned rows (user_id IS NULL), whether is_public = 0 or is_public = 1,
never appear in these private views.
"""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from conftest import ORDER_TEXT, make_pdf  # noqa: E402
from tests.test_vault_workspace import Browser, fresh_allowances as _fresh_allowances, real as _real_fixture  # noqa: E402

pytest_plugins = ("tests.test_vault_workspace",)
_ = (_fresh_allowances, _real_fixture)


def _ensure_is_public(conn):
    try:
        conn.execute("ALTER TABLE case_vault ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0")
        conn.commit()
    except Exception:
        pass


def test_private_vault_views_exclude_unowned_rows_and_preserve_shares(real):  # noqa: F811
    flask_app, app_module = real
    conn = app_module.db
    _ensure_is_public(conn)

    # Clean any earlier rows in this module-scoped DB so counts are exact
    conn.execute("DELETE FROM document_vault_shares")
    conn.execute("DELETE FROM dms_pages")
    conn.execute("DELETE FROM dms_docs")
    conn.execute("DELETE FROM case_vault")
    conn.execute("DELETE FROM vault_folders")
    conn.commit()

    user_a = Browser(flask_app, name="Advocate Alice")
    user_b = Browser(flask_app, name="Advocate Bob")

    # 1. User A's own folder + document (uploaded so dms_docs/dms_pages exist for overview + timeline)
    fa_resp = user_a.send("post", "/api/vault/folders", {"name": "Alice Private Folder"})
    assert fa_resp.status_code == 201, fa_resp.get_json()
    folder_a = fa_resp.get_json()["id"]
    doc_a = user_a.upload(
        "alice_order.pdf",
        make_pdf([ORDER_TEXT + "\nAlice private order text"]),
        folder_id=folder_a,
    )

    # 2. User B's own folder + document
    fb_resp = user_b.send("post", "/api/vault/folders", {"name": "Bob Private Folder"})
    assert fb_resp.status_code == 201, fb_resp.get_json()
    folder_b = fb_resp.get_json()["id"]
    doc_b = user_b.upload(
        "bob_order.pdf",
        make_pdf([ORDER_TEXT + "\nBob private order text"]),
        folder_id=folder_b,
    )

    # 3. Document owned by A and shared with B (plus a folder owned by A and shared with B)
    fs_resp = user_a.send("post", "/api/vault/folders", {"name": "Alice Shared Folder"})
    assert fs_resp.status_code == 201, fs_resp.get_json()
    folder_shared = fs_resp.get_json()["id"]
    doc_shared_in_folder = user_a.upload(
        "shared_in_folder.pdf",
        make_pdf([ORDER_TEXT + "\nShared folder document"]),
        folder_id=folder_shared,
    )
    doc_shared_direct = user_a.upload(
        "shared_direct.pdf",
        make_pdf([ORDER_TEXT + "\nDirectly shared document"]),
        folder_id=folder_a,
    )

    # Add User B to User A's team roster and share `doc_shared_direct` + `folder_shared`
    tm_resp = user_a.send(
        "post",
        "/api/team/members/add",
        {"name": "Advocate Bob", "email": user_b.email, "role": "Associate"},
    )
    assert tm_resp.status_code in (200, 201), tm_resp.get_json()
    tm_id = tm_resp.get_json()["id"]

    s1 = user_a.send(
        "post",
        "/api/vault/shares",
        {"node_type": "document", "node_id": doc_shared_direct, "team_member_id": tm_id, "permission": "view"},
    )
    assert s1.status_code in (200, 201), s1.get_json()
    s2 = user_a.send(
        "post",
        "/api/vault/shares",
        {"node_type": "folder", "node_id": folder_shared, "team_member_id": tm_id, "permission": "view"},
    )
    assert s2.status_code in (200, 201), s2.get_json()

    # Clear member-id cache so sharing resolution sees the newly created roster link immediately
    app_module._DMS_MEMBER_CACHE.clear()

    # 4. Seed NULL-owner rows directly:
    #    - one NULL-owner folder
    #    - one NULL-owner non-public document (is_public = 0)
    #    - one NULL-owner public document (is_public = 1)
    #    Also attach dms_docs + dms_pages with dated text to both NULL-owner docs so if _vw_scope
    #    leaked NULL-owner rows, /api/vault/overview and /api/vault/timeline(?deep=1) would expose them.
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO vault_folders (name, parent_id, user_id) VALUES ('Legacy Unowned Folder', NULL, NULL)"
    )
    folder_null = cur.lastrowid

    cur.execute(
        "INSERT INTO case_vault (case_id, title, smart_title, doc_type, content, folder_id, user_id, is_public) "
        "VALUES ('NULL-PRIV-1', 'Unowned Private Draft', 'Unowned Private Draft', 'Draft', "
        "'Filed on 10.02.2025 in unowned private draft.', ?, NULL, 0)",
        (folder_null,),
    )
    doc_null_private = cur.lastrowid

    cur.execute(
        "INSERT INTO case_vault (case_id, title, smart_title, doc_type, content, folder_id, user_id, is_public) "
        "VALUES ('NULL-PUB-1', 'Mass Ingested Public Judgment', 'Mass Ingested Public Judgment', 'Judgment', "
        "'Listed on 18.03.2025 for further hearing in public judgment.', NULL, NULL, 1)"
    )
    doc_null_public = cur.lastrowid

    for did, orig_name, doc_date, next_h, page_text in (
        (doc_null_private, "unowned_private.pdf", "2025-02-10", "2025-02-20", "Filed on 10.02.2025 in unowned private draft."),
        (doc_null_public, "public_judgment.pdf", "2025-03-01", "2025-03-18", "Listed on 18.03.2025 for further hearing in public judgment."),
    ):
        cur.execute(
            "INSERT INTO dms_docs (doc_id, sha256, store_key, size, group_id, status, is_current, doc_class, doc_date, next_hearing, original_name) "
            "VALUES (?, ?, ?, 100, ?, 'ready', 1, 'Judgment', ?, ?, ?)",
            (did, f"sha_{did}", f"key_{did}", did, doc_date, next_h, orig_name),
        )
        cur.execute(
            "INSERT INTO dms_pages (doc_id, page_no, text) VALUES (?, 1, ?)",
            (did, page_text),
        )
    conn.commit()

    unowned_doc_ids = {doc_null_private, doc_null_public}

    # ── Verify as User A ──────────────────────────────────────────────────────
    # GET /api/vault/documents (own rows only; never NULL-owner rows or B's rows)
    docs_a_resp = user_a.get("/api/vault/documents").get_json()
    docs_a_ids = {d["id"] for d in docs_a_resp["documents"]}
    assert docs_a_ids == {doc_a, doc_shared_in_folder, doc_shared_direct}
    assert docs_a_resp["total"] == 3
    assert not (docs_a_ids & unowned_doc_ids)

    # GET /api/vault/meta (own + shared; never NULL-owner rows)
    meta_a_ids = {d["id"] for d in user_a.get("/api/vault/meta").get_json()["documents"]}
    assert meta_a_ids == {doc_a, doc_shared_in_folder, doc_shared_direct}
    assert not (meta_a_ids & unowned_doc_ids)

    # GET /api/vault/folders + doc_counts
    folders_a_resp = user_a.get("/api/vault/folders").get_json()
    folders_a_ids = {f["id"] for f in folders_a_resp["flat"]}
    assert folders_a_ids == {folder_a, folder_shared}
    assert folder_null not in folders_a_ids
    assert folder_b not in folders_a_ids
    counts_a = folders_a_resp["doc_counts"]
    assert counts_a.get(str(folder_a)) == 2  # doc_a + doc_shared_direct
    assert counts_a.get(str(folder_shared)) == 1  # doc_shared_in_folder
    assert counts_a.get("root", 0) == 0  # doc_null_public at root is NOT counted
    assert str(folder_null) not in counts_a

    # GET /api/vault/overview (uses deps['scope'] -> _vw_scope)
    ov_a = user_a.get("/api/vault/overview").get_json()
    assert ov_a["documents"] == 3  # only A's 3 documents, never the 2 NULL-owner docs

    # GET /api/vault/timeline and ?deep=1 (both use deps['scope'] -> _vw_scope)
    tl_a = user_a.get("/api/vault/timeline").get_json()["events"]
    tl_a_doc_ids = {e.get("doc_id") for e in tl_a if e.get("doc_id") is not None}
    assert not (tl_a_doc_ids & unowned_doc_ids)
    assert doc_b not in tl_a_doc_ids

    tl_a_deep = user_a.get("/api/vault/timeline?deep=1").get_json()["events"]
    tl_a_deep_doc_ids = {e.get("doc_id") for e in tl_a_deep if e.get("doc_id") is not None}
    assert not (tl_a_deep_doc_ids & unowned_doc_ids)
    assert not any("unowned" in (e.get("source") or "").lower() or "public_judgment" in (e.get("source") or "").lower() for e in tl_a_deep)

    # GET /api/vault/destinations
    dest_a_ids = {f["id"] for f in user_a.get("/api/vault/destinations").get_json()["folders"]}
    assert dest_a_ids == {folder_a, folder_shared}
    assert folder_null not in dest_a_ids

    # ── Verify as User B ──────────────────────────────────────────────────────
    # GET /api/vault/documents (own rows only; never NULL-owner rows)
    docs_b_resp = user_b.get("/api/vault/documents").get_json()
    docs_b_ids = {d["id"] for d in docs_b_resp["documents"]}
    assert docs_b_ids == {doc_b}
    assert docs_b_resp["total"] == 1
    assert not (docs_b_ids & unowned_doc_ids)

    # GET /api/vault/meta (own + shared from A; never NULL-owner rows or A's unshared doc_a)
    meta_b_ids = {d["id"] for d in user_b.get("/api/vault/meta").get_json()["documents"]}
    assert meta_b_ids == {doc_b, doc_shared_direct, doc_shared_in_folder}
    assert doc_a not in meta_b_ids
    assert not (meta_b_ids & unowned_doc_ids)

    # GET /api/vault/folders + doc_counts (own folder_b, shared folder_shared, nav-only folder_a for doc_shared_direct; never folder_null)
    folders_b_resp = user_b.get("/api/vault/folders").get_json()
    folders_b_ids = {f["id"] for f in folders_b_resp["flat"]}
    assert folders_b_ids == {folder_b, folder_shared, folder_a}
    assert folder_null not in folders_b_ids
    counts_b = folders_b_resp["doc_counts"]
    assert counts_b.get(str(folder_b)) == 1  # doc_b
    assert counts_b.get(str(folder_shared)) == 1  # doc_shared_in_folder
    assert counts_b.get(str(folder_a)) == 1  # only doc_shared_direct, NOT doc_a
    assert counts_b.get("root", 0) == 0  # doc_null_public at root is NOT counted
    assert str(folder_null) not in counts_b

    # GET /api/vault/overview (B's 1 own doc + 2 shared docs = 3; never the 2 NULL-owner docs or A's private doc_a)
    ov_b = user_b.get("/api/vault/overview").get_json()
    assert ov_b["documents"] == 3

    # GET /api/vault/timeline and ?deep=1 for User B
    tl_b = user_b.get("/api/vault/timeline").get_json()["events"]
    tl_b_doc_ids = {e.get("doc_id") for e in tl_b if e.get("doc_id") is not None}
    assert tl_b_doc_ids <= {doc_b, doc_shared_direct, doc_shared_in_folder}
    assert not (tl_b_doc_ids & unowned_doc_ids)
    assert doc_a not in tl_b_doc_ids

    tl_b_deep = user_b.get("/api/vault/timeline?deep=1").get_json()["events"]
    tl_b_deep_doc_ids = {e.get("doc_id") for e in tl_b_deep if e.get("doc_id") is not None}
    assert tl_b_deep_doc_ids <= {doc_b, doc_shared_direct, doc_shared_in_folder}
    assert not (tl_b_deep_doc_ids & unowned_doc_ids)

    # GET /api/vault/destinations (only B's own folders; never folder_null)
    dest_b_ids = {f["id"] for f in user_b.get("/api/vault/destinations").get_json()["folders"]}
    assert dest_b_ids == {folder_b}
    assert folder_null not in dest_b_ids


def test_init_blueprint_ignores_unowned_root_folder_with_blueprint_name(real):  # noqa: F811
    flask_app, app_module = real
    conn = app_module.db

    # Seed an unowned (user_id IS NULL) root folder with one of the canonical blueprint names
    blueprint_name = app_module._BLUEPRINT_FOLDER_NAMES[0]
    conn.execute(
        "INSERT INTO vault_folders (name, parent_id, user_id, protected) VALUES (?, NULL, NULL, 1)",
        (blueprint_name,),
    )
    conn.commit()

    user_c = Browser(flask_app, name="Advocate Carol")
    resp = user_c.send("post", "/api/vault/folders/init-blueprint")
    assert resp.status_code == 201, resp.get_json()
    data = resp.get_json()
    assert data["created"] is True
    assert len(data["folders"]) == 5

    # Calling a second time for the same user now sees their own folders and returns created=False
    second = user_c.send("post", "/api/vault/folders/init-blueprint")
    assert second.status_code == 200
    assert second.get_json()["created"] is False
