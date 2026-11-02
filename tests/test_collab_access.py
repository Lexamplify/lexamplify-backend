"""Integration tests for utils.case_access.eligible_recipient_ids.

Covers the critical union — assigned advocate + matter team membership
+ firm seniors — so a regression there (which would silently widen OR
narrow who gets a share) fails loudly.

Uses a throwaway SQLite file wired into Flask's current_app.extensions
so case_access._conn() can find it, matching the production resolver
in utils/case_access.py:_lpms_db_path.
"""
import os
import sqlite3

import pytest
from flask import Flask


@pytest.fixture
def app_with_db(tmp_path):
    db = tmp_path / "lex.db"
    conn = sqlite3.connect(str(db))
    conn.executescript("""
        CREATE TABLE lpms_cases (
            id INTEGER PRIMARY KEY, firm_id INTEGER, advocate_id INTEGER,
            team_id INTEGER, restricted INTEGER DEFAULT 0, title TEXT
        );
        CREATE TABLE lpms_members (
            id INTEGER PRIMARY KEY, firm_id INTEGER, user_id INTEGER,
            role TEXT, active INTEGER DEFAULT 1, name TEXT, email TEXT, email_notify INTEGER DEFAULT 1
        );
        CREATE TABLE team_memberships (
            id INTEGER PRIMARY KEY, team_id INTEGER, user_id INTEGER, role TEXT
        );
    """)
    # Firm 1 roster:
    #   user 10 = advocate (lpms_members.id = 1)
    #   user 20 = team member on team_id 100
    #   user 30 = team member on team_id 100
    #   user 40 = senior partner (role includes 'senior')
    #   user 50 = outsider (not on team, not senior)
    conn.executemany(
        "INSERT INTO lpms_members (id, firm_id, user_id, role, name) VALUES (?, ?, ?, ?, ?)",
        [(1, 1, 10, 'advocate', 'Advocate A'),
         (2, 1, 20, 'junior', 'Junior B'),
         (3, 1, 30, 'junior', 'Junior C'),
         (4, 1, 40, 'senior partner', 'Senior D'),
         (5, 1, 50, 'junior', 'Outsider E')],
    )
    conn.executemany(
        "INSERT INTO team_memberships (team_id, user_id, role) VALUES (?, ?, ?)",
        [(100, 20, 'member'), (100, 30, 'member')],
    )
    # Case 1 on team 100 (open) and case 2 on team 100 (restricted).
    conn.executemany(
        "INSERT INTO lpms_cases (id, firm_id, advocate_id, team_id, restricted, title) VALUES (?, ?, ?, ?, ?, ?)",
        [(1, 1, 1, 100, 0, 'Open case'),
         (2, 1, 1, 100, 1, 'Restricted case')],
    )
    conn.commit()
    conn.close()

    app = Flask("test-collab-access")
    app.extensions["lpms_db_path"] = str(db)
    return app


def test_eligible_includes_advocate_team_and_seniors(app_with_db):
    from utils.case_access import eligible_recipient_ids
    with app_with_db.app_context():
        ids = eligible_recipient_ids(1)
    # Advocate (10) + team (20, 30) + senior (40) = 4 users. Outsider (50)
    # is NOT in any of the three sources, so must stay out.
    assert ids == {10, 20, 30, 40}


def test_restricted_case_excludes_seniors(app_with_db):
    """A restricted case is visible only to the advocate + team — seniors
    don't get the firm-wide auto-visibility they get on open cases."""
    from utils.case_access import eligible_recipient_ids
    with app_with_db.app_context():
        ids = eligible_recipient_ids(2)
    assert ids == {10, 20, 30}
    assert 40 not in ids


def test_unknown_case_returns_empty(app_with_db):
    from utils.case_access import eligible_recipient_ids
    with app_with_db.app_context():
        assert eligible_recipient_ids(999) == set()


def test_require_case_access_predicate(app_with_db):
    from utils.case_access import require_case_access
    with app_with_db.app_context():
        assert require_case_access(10, 1) is True   # advocate
        assert require_case_access(20, 1) is True   # team
        assert require_case_access(40, 1) is True   # senior
        assert require_case_access(50, 1) is False  # outsider
        assert require_case_access(40, 2) is False  # senior blocked by restricted
