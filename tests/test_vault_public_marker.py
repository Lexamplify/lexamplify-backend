"""
Tests for Part 2, Batch 1 of the Case Vault privacy fix:
- `is_public` marker column and one-time `_backfill_public_vault_rows` function
- `_vault_owner_ok` strict owner-only behavior (NULL is never owned)
- `_vault_access_ok` read-only access for `is_public = 1` documents (and refusal for edits, non-public NULL rows, folders, and missing column resilience)
- `mass_ingestion.save_case_to_vault` setting `is_public = 1` and never overwriting owned rows with the same `case_id`
"""
import ast
import os
import sqlite3

import pytest

from conftest import VAULT_SCHEMA

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_PY = os.path.join(ROOT, "app.py")
MASS_INGESTION_PY = os.path.join(ROOT, "mass_ingestion.py")


def _load_app_functions(conn, member_ids=None):
    src = open(APP_PY, encoding="utf-8").read()
    tree = ast.parse(src)
    wanted_funcs = {
        "_backfill_public_vault_rows",
        "_vault_owner_ok",
        "_get_ancestor_folder_ids",
        "_effective_permission",
        "_vault_access_ok",
    }
    wanted_assigns = {"_PERMISSION_RANK"}
    members = member_ids or {}
    ns = {
        "sqlite3": sqlite3,
        "db": conn,
        "_current_user_team_member_ids": lambda uid: list(members.get(uid, [])),
    }
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in wanted_funcs:
            seg = ast.get_source_segment(src, node)
            exec(compile(ast.parse(seg), APP_PY, "exec"), ns)
        elif isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id in wanted_assigns for t in node.targets
        ):
            seg = ast.get_source_segment(src, node)
            exec(compile(ast.parse(seg), APP_PY, "exec"), ns)
    assert wanted_funcs <= set(ns), f"Missing functions: {wanted_funcs - set(ns)}"
    return ns


def _load_save_case_to_vault():
    """Load `save_case_to_vault` and `FORCE_UPDATE_MIN_CHAR_DELTA` from mass_ingestion.py
    via AST so tests do not trigger top-level Pinecone env assertions or heavy imports."""
    src = open(MASS_INGESTION_PY, encoding="utf-8").read()
    tree = ast.parse(src)
    ns = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == "FORCE_UPDATE_MIN_CHAR_DELTA" for t in node.targets
        ):
            seg = ast.get_source_segment(src, node)
            exec(compile(ast.parse(seg), MASS_INGESTION_PY, "exec"), ns)
        elif isinstance(node, ast.FunctionDef) and node.name == "save_case_to_vault":
            seg = ast.get_source_segment(src, node)
            exec(compile(ast.parse(seg), MASS_INGESTION_PY, "exec"), ns)
    assert "save_case_to_vault" in ns and "FORCE_UPDATE_MIN_CHAR_DELTA" in ns
    return ns["save_case_to_vault"], ns["FORCE_UPDATE_MIN_CHAR_DELTA"]


@pytest.fixture
def vault_conn(tmp_path):
    conn = sqlite3.connect(str(tmp_path / "vault_marker.db"))
    conn.executescript(VAULT_SCHEMA)
    conn.execute("ALTER TABLE case_vault ADD COLUMN ratio_headnote TEXT")
    conn.commit()
    yield conn
    conn.close()


class TestBackfillPublicVaultRows:
    def test_backfill_marks_only_exact_fingerprint_and_is_idempotent(self, vault_conn):
        ns = _load_app_functions(vault_conn)
        backfill = ns["_backfill_public_vault_rows"]

        # 1. Exact public fingerprint (NULL user_id, doc_type='Judgment', all user/upload cols NULL)
        vault_conn.execute(
            "INSERT INTO case_vault (id, case_id, title, doc_type, content, user_id) "
            "VALUES (1, 'SC-2025-1', 'State v. Rao', 'Judgment', 'Full judgment text', NULL)"
        )
        # 2. Owned row matching all other columns -> must stay 0
        vault_conn.execute(
            "INSERT INTO case_vault (id, case_id, title, doc_type, content, user_id) "
            "VALUES (2, 'SC-2025-2', 'Owned Judgment', 'Judgment', 'Owned text', 42)"
        )
        # 3. NULL owner but non-Judgment doc_type -> must stay 0
        vault_conn.execute(
            "INSERT INTO case_vault (id, case_id, title, doc_type, content, user_id) "
            "VALUES (3, 'DRAFT-1', 'Old Draft', 'Draft', 'Private draft', NULL)"
        )
        # 4. NULL owner, Judgment, but has folder_id -> must stay 0
        vault_conn.execute(
            "INSERT INTO case_vault (id, case_id, title, doc_type, content, user_id, folder_id) "
            "VALUES (4, 'C-4', 'Foldered', 'Judgment', 'text', NULL, 10)"
        )
        # 5. NULL owner, Judgment, but has smart_title -> must stay 0
        vault_conn.execute(
            "INSERT INTO case_vault (id, case_id, title, doc_type, content, user_id, smart_title) "
            "VALUES (5, 'C-5', 'Smart', 'Judgment', 'text', NULL, 'Custom Smart Title')"
        )
        # 6. NULL owner, Judgment, but has tags -> must stay 0
        vault_conn.execute(
            "INSERT INTO case_vault (id, case_id, title, doc_type, content, user_id, tags) "
            "VALUES (6, 'C-6', 'Tagged', 'Judgment', 'text', NULL, '[\"urgent\"]')"
        )
        # 7. NULL owner, Judgment, but has file_blob -> must stay 0
        vault_conn.execute(
            "INSERT INTO case_vault (id, case_id, title, doc_type, content, user_id, file_blob) "
            "VALUES (7, 'C-7', 'Uploaded Blob', 'Judgment', 'text', NULL, X'25504446')"
        )
        # 8. NULL owner, Judgment, but has file_format -> must stay 0
        vault_conn.execute(
            "INSERT INTO case_vault (id, case_id, title, doc_type, content, user_id, file_format) "
            "VALUES (8, 'C-8', 'Formatted', 'Judgment', 'text', NULL, 'pdf')"
        )
        # 9. NULL owner, Judgment, but has ratio_headnote -> must stay 0
        vault_conn.execute(
            "INSERT INTO case_vault (id, case_id, title, doc_type, content, user_id, ratio_headnote) "
            "VALUES (9, 'C-9', 'Headnoted', 'Judgment', 'text', NULL, 'Ratio decidendi')"
        )
        vault_conn.commit()

        marked, hidden = backfill(vault_conn)
        assert marked == 1
        assert hidden == 7  # rows 3..9 are NULL-owner and stay is_public = 0

        rows = dict(vault_conn.execute("SELECT id, is_public FROM case_vault ORDER BY id").fetchall())
        assert rows == {1: 1, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0}

        # Running a second time changes nothing further
        vault_conn.execute(
            "INSERT INTO case_vault (id, case_id, title, doc_type, content, user_id) "
            "VALUES (10, 'OWNED-NEW', 'Another Owned', 'Judgment', 'text', 7)"
        )
        vault_conn.commit()
        marked2, hidden2 = backfill(vault_conn)
        assert hidden2 == 7
        rows_after = dict(vault_conn.execute("SELECT id, is_public FROM case_vault ORDER BY id").fetchall())
        assert rows_after == {1: 1, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0}


class TestVaultOwnerAndAccessOk:
    def test_vault_owner_ok_strict_equality(self, vault_conn):
        ns = _load_app_functions(vault_conn)
        owner_ok = ns["_vault_owner_ok"]

        assert owner_ok(None, 1) is False
        assert owner_ok(None, 99) is False
        assert owner_ok(2, 1) is False
        assert owner_ok(1, 1) is True
        assert owner_ok("1", 1) is True

    def test_vault_access_ok_public_document_and_restrictions(self, vault_conn):
        ns = _load_app_functions(vault_conn)
        access_ok = ns["_vault_access_ok"]

        # Seed a public NULL-owner document (#1), a non-public NULL-owner document (#2),
        # an owned document (#3), and a NULL-owner folder (#10).
        vault_conn.execute(
            "INSERT INTO case_vault (id, case_id, title, doc_type, content, user_id, is_public) "
            "VALUES (1, 'PUB-1', 'Public Judgment', 'Judgment', 'text', NULL, 1), "
            "       (2, 'PRIV-NULL', 'Unowned Legacy Doc', 'Draft', 'text', NULL, 0), "
            "       (3, 'OWNED-1', 'Alice Doc', 'Draft', 'text', 1, 0)"
        )
        vault_conn.execute(
            "INSERT INTO vault_folders (id, name, parent_id, user_id) VALUES (10, 'Unowned Folder', NULL, NULL)"
        )
        vault_conn.commit()

        # Public document (#1): any user can read (require_edit=False), nobody can edit/delete (require_edit=True)
        assert access_ok("document", 1, None, 2, require_edit=False) is True
        assert access_ok("document", 1, None, 2, require_edit=True) is False
        assert access_ok("document", 1, None, 1, require_edit=True) is False

        # Non-public NULL-owner document (#2): refused for both read and edit
        assert access_ok("document", 2, None, 1, require_edit=False) is False
        assert access_ok("document", 2, None, 2, require_edit=False) is False
        assert access_ok("document", 2, None, 2, require_edit=True) is False

        # Owned document (#3): owner passes both, second user refused
        assert access_ok("document", 3, 1, 1, require_edit=False) is True
        assert access_ok("document", 3, 1, 1, require_edit=True) is True
        assert access_ok("document", 3, 1, 2, require_edit=False) is False
        assert access_ok("document", 3, 1, 2, require_edit=True) is False

        # Folders are never public, even if a folder id matches a public document id (#1) or has NULL user_id (#10)
        assert access_ok("folder", 1, None, 2, require_edit=False) is False
        assert access_ok("folder", 10, None, 2, require_edit=False) is False
        assert access_ok("folder", 10, None, 2, require_edit=True) is False

    def test_vault_access_ok_table_without_is_public_column_does_not_crash(self, tmp_path):
        conn = sqlite3.connect(str(tmp_path / "legacy_no_is_public.db"))
        try:
            conn.execute(
                "CREATE TABLE case_vault (id INTEGER PRIMARY KEY, title TEXT, folder_id INTEGER, user_id INTEGER)"
            )
            conn.execute(
                "CREATE TABLE vault_folders (id INTEGER PRIMARY KEY, name TEXT, parent_id INTEGER, user_id INTEGER)"
            )
            conn.execute(
                "CREATE TABLE document_vault_shares ("
                "id INTEGER PRIMARY KEY, node_type TEXT, node_id INTEGER, team_member_id INTEGER, permission TEXT)"
            )
            conn.execute("INSERT INTO case_vault (id, title, user_id) VALUES (1, 'Legacy Row', NULL)")
            conn.commit()

            ns = _load_app_functions(conn)
            access_ok = ns["_vault_access_ok"]

            assert access_ok("document", 1, None, 2, require_edit=False) is False
            assert access_ok("document", 1, None, 2, require_edit=True) is False
        finally:
            conn.close()


class TestMassIngestionPublicMarker:
    def test_save_case_to_vault_sets_is_public_and_protects_owned_rows(self, tmp_path):
        save_case_to_vault, min_delta = _load_save_case_to_vault()

        # Start with a minimal table without is_public to also verify add-if-missing
        conn = sqlite3.connect(str(tmp_path / "ingest.db"))
        try:
            conn.execute(
                "CREATE TABLE case_vault ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT, title TEXT, "
                "doc_type TEXT, content TEXT, user_id INTEGER)"
            )
            # Seed a user-owned row that happens to share case_id 'CASE-COLLIDE'
            conn.execute(
                "INSERT INTO case_vault (case_id, title, doc_type, content, user_id) "
                "VALUES ('CASE-COLLIDE', 'Lawyer Private Notes', 'Judgment', 'short private note', 99)"
            )
            conn.commit()

            cur = conn.cursor()
            long_public_text = "Public Supreme Court judgment text. " * ((min_delta // 20) + 20)

            # 1. Ingesting 'CASE-COLLIDE' must NOT overwrite the owned row (which has is_public=0);
            #    it inserts a separate public row with is_public=1.
            state1 = save_case_to_vault(cur, "CASE-COLLIDE", "Public SC Judgment", "Initial public text")
            conn.commit()
            assert state1 == "inserted"

            rows = conn.execute(
                "SELECT user_id, is_public, title, content FROM case_vault WHERE case_id = 'CASE-COLLIDE' ORDER BY id"
            ).fetchall()
            assert len(rows) == 2
            assert rows[0] == (99, 0, "Lawyer Private Notes", "short private note")
            assert rows[1] == (None, 1, "Public SC Judgment", "Initial public text")

            # 2. Re-running with much longer content updates ONLY the public row, never the owned row.
            state2 = save_case_to_vault(cur, "CASE-COLLIDE", "Public SC Judgment Full", long_public_text)
            conn.commit()
            assert state2 == "updated"

            rows_after = conn.execute(
                "SELECT user_id, is_public, title, content FROM case_vault WHERE case_id = 'CASE-COLLIDE' ORDER BY id"
            ).fetchall()
            assert len(rows_after) == 2
            assert rows_after[0] == (99, 0, "Lawyer Private Notes", "short private note")
            assert rows_after[1] == (None, 1, "Public SC Judgment Full", long_public_text)

            # 3. Re-running with same/shorter content is skipped.
            state3 = save_case_to_vault(cur, "CASE-COLLIDE", "Public SC Judgment Full", long_public_text)
            assert state3 == "skipped"
        finally:
            conn.close()
