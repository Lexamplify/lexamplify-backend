"""
Tests for Part 2, Batch 5 of the Case Vault privacy fix:
Provenance feed (GET /api/vault/provenance) and audit threads (GET /api/vault/audit-trail)
show only the owner's records (plus provenance entries where the signed-in user was the actor);
deleted-document threads and unowned rows are hidden.
"""
import json
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from tests.test_vault_workspace import Browser, fresh_allowances as _fresh_allowances, real as _real_fixture  # noqa: E402

pytest_plugins = ("tests.test_vault_workspace",)
_ = (_fresh_allowances, _real_fixture)


def _ensure_tables(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS vault_provenance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            node_type TEXT NOT NULL,
            node_id INTEGER,
            node_name TEXT,
            action TEXT NOT NULL,
            actor_user_id INTEGER,
            owner_user_id INTEGER,
            detail TEXT,
            content_hash TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS vault_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            folder_id INTEGER,
            vault_doc_id INTEGER,
            session_title TEXT,
            messages_json TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.commit()


def test_provenance_and_audit_feeds_enforce_owner_and_actor_privacy(real):  # noqa: F811
    flask_app, app_module = real
    conn = app_module.db
    _ensure_tables(conn)

    user_a = Browser(flask_app, name="Advocate Alice")
    user_b = Browser(flask_app, name="Advocate Bob")
    uid_a = user_a.uid
    uid_b = user_b.uid

    # Create folders for A and B via the API
    fa_resp = user_a.send("post", "/api/vault/folders", {"name": "Alice Audit Folder"})
    assert fa_resp.status_code == 201, fa_resp.get_json()
    folder_a = fa_resp.get_json()["id"]

    fb_resp = user_b.send("post", "/api/vault/folders", {"name": "Bob Audit Folder"})
    assert fb_resp.status_code == 201, fb_resp.get_json()
    folder_b = fb_resp.get_json()["id"]

    # Clean tables after folder creation so only our controlled test rows exist
    conn.execute("DELETE FROM vault_provenance")
    conn.execute("DELETE FROM vault_audit")
    conn.execute("DELETE FROM case_vault")
    conn.commit()

    cur = conn.cursor()

    # Insert case_vault documents: A's doc, B's doc, and an unowned doc (user_id IS NULL)
    cur.execute(
        "INSERT INTO case_vault (case_id, title, smart_title, doc_type, content, folder_id, user_id) "
        "VALUES ('CASE-A', 'Alice Doc', 'Alice Doc', 'Draft', 'Alice secret content', ?, ?)",
        (folder_a, uid_a),
    )
    doc_a = cur.lastrowid

    cur.execute(
        "INSERT INTO case_vault (case_id, title, smart_title, doc_type, content, folder_id, user_id) "
        "VALUES ('CASE-B', 'Bob Doc', 'Bob Doc', 'Draft', 'Bob secret content', ?, ?)",
        (folder_b, uid_b),
    )
    doc_b = cur.lastrowid

    cur.execute(
        "INSERT INTO case_vault (case_id, title, smart_title, doc_type, content, folder_id, user_id) "
        "VALUES ('CASE-NULL', 'Unowned Doc', 'Unowned Doc', 'Draft', 'Legacy unowned content', ?, NULL)",
        (folder_a,),
    )
    doc_unowned = cur.lastrowid

    # A vault_doc_id that points to a deleted document (no case_vault row)
    deleted_doc_id = max(doc_a, doc_b, doc_unowned) + 9999

    # Insert the 5 required vault_provenance rows:
    # 1. owned by A
    # 2. owned by B
    # 3. owner NULL with actor A
    # 4. owner NULL with actor B
    # 5. owner B with actor A
    def add_prov(node_type, node_id, node_name, action, actor_id, owner_id):
        cur.execute(
            "INSERT INTO vault_provenance "
            "(node_type, node_id, node_name, action, actor_user_id, owner_user_id, detail, content_hash, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-10-25 10:00:00')",
            (node_type, node_id, node_name, action, actor_id, owner_id, json.dumps({"node": node_name}), "f" * 64),
        )
        return f"prov-{cur.lastrowid}"

    prov_owned_a = add_prov("document", doc_a, "Owned by A", "created", uid_a, uid_a)
    prov_owned_b = add_prov("document", doc_b, "Owned by B", "created", uid_b, uid_b)
    prov_null_actor_a = add_prov("document", doc_unowned, "Owner NULL Actor A", "renamed", uid_a, None)
    prov_null_actor_b = add_prov("document", doc_unowned, "Owner NULL Actor B", "renamed", uid_b, None)
    prov_owner_b_actor_a = add_prov("document", doc_b, "Owner B Actor A", "renamed", uid_a, uid_b)

    # Insert the 4 required vault_audit rows:
    # 1. joined to A's doc
    # 2. joined to B's doc
    # 3. joined to an unowned doc
    # 4. joined to a deleted document (no case_vault row)
    def add_audit(folder_id, vault_doc_id, session_title):
        cur.execute(
            "INSERT INTO vault_audit (folder_id, vault_doc_id, session_title, messages_json, created_at) "
            "VALUES (?, ?, ?, ?, '2026-10-25 11:00:00')",
            (folder_id, vault_doc_id, session_title, json.dumps([{"role": "assistant", "text": session_title}])),
        )
        return cur.lastrowid

    audit_a = add_audit(folder_a, doc_a, "Alice AI Session")
    audit_b = add_audit(folder_b, doc_b, "Bob AI Session")
    audit_unowned = add_audit(folder_a, doc_unowned, "Unowned AI Session")
    audit_deleted = add_audit(folder_a, deleted_doc_id, "Deleted Doc AI Session")
    conn.commit()

    # ── Checks for User A ─────────────────────────────────────────────────────
    prov_resp_a = user_a.get("/api/vault/provenance")
    assert prov_resp_a.status_code == 200, prov_resp_a.get_json()
    entries_a = prov_resp_a.get_json()["entries"]
    prov_ids_a = {e["id"] for e in entries_a if e["source"] == "provenance"}
    audit_fold_ids_a = {e["id"] for e in entries_a if e["source"] == "audit"}

    assert prov_ids_a == {prov_owned_a, prov_null_actor_a, prov_owner_b_actor_a}
    assert prov_owned_b not in prov_ids_a
    assert prov_null_actor_b not in prov_ids_a
    assert audit_fold_ids_a == {f"audit-{audit_a}"}

    # Audit threads for User A: without folder_id
    threads_a_all = user_a.get("/api/vault/audit-trail").get_json()["threads"]
    assert [t["id"] for t in threads_a_all] == [audit_a]
    assert {t["vault_doc_id"] for t in threads_a_all} == {doc_a}

    # Audit threads for User A: with A's folder_id
    threads_a_folder = user_a.get(f"/api/vault/audit-trail?folder_id={folder_a}").get_json()["threads"]
    assert [t["id"] for t in threads_a_folder] == [audit_a]

    # ATTACK CASES for User A:
    # 1. A passes B's folder_id to audit-trail and provenance
    attack_a_audit_folder_b = user_a.get(f"/api/vault/audit-trail?folder_id={folder_b}").get_json()["threads"]
    assert attack_a_audit_folder_b == []

    attack_a_prov_folder_b = user_a.get(
        f"/api/vault/provenance?node_type=folder&node_id={folder_b}"
    ).get_json()["entries"]
    assert attack_a_prov_folder_b == []

    # 2. A passes B's node_type/node_id (where A was neither owner nor actor)
    prov_b_private_folder = add_prov("folder", folder_b, "Bob Folder Created", "created", uid_b, uid_b)
    conn.commit()
    attack_a_prov_node_b = user_a.get(
        f"/api/vault/provenance?node_type=folder&node_id={folder_b}"
    ).get_json()["entries"]
    assert attack_a_prov_node_b == []
    assert all(e["id"] != prov_b_private_folder for e in attack_a_prov_node_b)

    # When A filters by B's doc_b, A never sees prov_owned_b or audit_b (only A's own actor record)
    attack_a_prov_doc_b = user_a.get(
        f"/api/vault/provenance?node_type=document&node_id={doc_b}"
    ).get_json()["entries"]
    attack_a_doc_b_ids = {e["id"] for e in attack_a_prov_doc_b}
    assert prov_owned_b not in attack_a_doc_b_ids
    assert f"audit-{audit_b}" not in attack_a_doc_b_ids
    assert attack_a_doc_b_ids == {prov_owner_b_actor_a}

    # ── Checks for User B ─────────────────────────────────────────────────────
    prov_resp_b = user_b.get("/api/vault/provenance")
    assert prov_resp_b.status_code == 200, prov_resp_b.get_json()
    entries_b = prov_resp_b.get_json()["entries"]
    prov_ids_b = {e["id"] for e in entries_b if e["source"] == "provenance"}
    audit_fold_ids_b = {e["id"] for e in entries_b if e["source"] == "audit"}

    assert prov_ids_b == {prov_owned_b, prov_null_actor_b, prov_owner_b_actor_a, prov_b_private_folder}
    assert prov_owned_a not in prov_ids_b
    assert prov_null_actor_a not in prov_ids_b
    assert audit_fold_ids_b == {f"audit-{audit_b}"}

    # Audit threads for User B: without folder_id
    threads_b_all = user_b.get("/api/vault/audit-trail").get_json()["threads"]
    assert [t["id"] for t in threads_b_all] == [audit_b]
    assert {t["vault_doc_id"] for t in threads_b_all} == {doc_b}
    assert audit_a not in {t["id"] for t in threads_b_all}
    assert audit_unowned not in {t["id"] for t in threads_b_all}
    assert audit_deleted not in {t["id"] for t in threads_b_all}

    # Audit threads for User B: with B's folder_id
    threads_b_folder = user_b.get(f"/api/vault/audit-trail?folder_id={folder_b}").get_json()["threads"]
    assert [t["id"] for t in threads_b_folder] == [audit_b]

    # ATTACK CASES for User B: B passes A's folder_id and A's node_type/node_id
    attack_b_audit_folder_a = user_b.get(f"/api/vault/audit-trail?folder_id={folder_a}").get_json()["threads"]
    assert attack_b_audit_folder_a == []

    attack_b_prov_doc_a = user_b.get(
        f"/api/vault/provenance?node_type=document&node_id={doc_a}"
    ).get_json()["entries"]
    assert attack_b_prov_doc_a == []

    attack_b_prov_folder_a = user_b.get(
        f"/api/vault/provenance?node_type=folder&node_id={folder_a}"
    ).get_json()["entries"]
    assert attack_b_prov_folder_a == []
