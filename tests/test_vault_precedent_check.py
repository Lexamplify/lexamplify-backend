"""
Batch 7: tasks.contract_tasks.check_case_in_vault must only match public judgments
(is_public = 1). It opens "lex_assistant.db" from the current folder, so every test
chdirs into tmp_path and builds that database there.
"""
import os
import sqlite3
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from tasks.contract_tasks import check_case_in_vault  # noqa: E402


@pytest.fixture
def seeded(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    conn = sqlite3.connect(os.path.join(str(tmp_path), "lex_assistant.db"))
    conn.execute(
        "CREATE TABLE case_vault (id INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT, "
        "title TEXT, user_id INTEGER, is_public INTEGER NOT NULL DEFAULT 0)"
    )
    cur = conn.cursor()
    cur.execute("INSERT INTO case_vault (case_id, title, user_id, is_public) VALUES (?, ?, ?, ?)",
                ("PRIV-A-1", "Alpha Private v. Secret Holdings", 1, 0))
    priv_a = cur.lastrowid
    cur.execute("INSERT INTO case_vault (case_id, title, user_id, is_public) VALUES (?, ?, ?, ?)",
                ("UNOWNED-PRIV-1", "Legacy Unowned v. Hidden Note", None, 0))
    unowned = cur.lastrowid
    cur.execute("INSERT INTO case_vault (case_id, title, user_id, is_public) VALUES (?, ?, ?, ?)",
                ("2025INSC900", "Public Petitioner v. Union of India", None, 1))
    pub = cur.lastrowid
    conn.commit()
    conn.close()
    return {"priv_a": priv_a, "unowned": unowned, "pub": pub}


def test_private_row_by_case_id_not_matched(seeded):
    assert check_case_in_vault(None, "PRIV-A-1") == (False, None)


def test_private_row_by_title_not_matched(seeded):
    assert check_case_in_vault("Alpha Private v. Secret Holdings", None) == (False, None)


def test_unowned_private_row_not_matched(seeded):
    assert check_case_in_vault("Legacy Unowned v. Hidden Note", "UNOWNED-PRIV-1") == (False, None)


def test_public_row_by_case_id_matched(seeded):
    assert check_case_in_vault(None, "2025INSC900") == (True, str(seeded["pub"]))


def test_public_row_by_title_matched(seeded):
    assert check_case_in_vault("Public Petitioner v. Union of India", None) == (True, str(seeded["pub"]))
