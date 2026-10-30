"""
scripts/seed_test_firm.py — populate a 5-person firm with sample matters so you
can test the shared/private visibility model end-to-end.

What it adds (assumes you're already logged in once as the Senior Advocate):
  • 3 extra users: rahul@test.com, meera@test.com, sameer@test.com (password: 12345678)
  • Adds them + the existing test@lexamplify2.com (Test Two) to the firm
  • Creates team "Corporate" (if missing)
  • Adds Test Two + Rahul to team "Litigation"
  • Adds Meera + Sameer to team "Corporate"
  • Creates 4 test matters with different visibility:
      Case A — team=Litigation, advocate=Priyam    (Test Two, Rahul see)
      Case B — team=Corporate, advocate=Priyam     (Meera, Sameer see)
      Case C — no team, no shared advocate         (only Priyam sees)
      Case D — team=Litigation, restricted=1       (Priyam only — team can't see confidential)

Run from the backend root:
    python scripts/seed_test_firm.py

Idempotent: re-running won't duplicate users/teams/cases.
"""
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

LPMS_DB   = str(ROOT / 'lex_assistant.db')
USERS_DB  = str(ROOT / 'instance' / 'database.db')

# Fake test accounts — created in the SQLAlchemy users table
FAKE_USERS = [
    ('rahul@test.com',   'Rahul Kumar',  'junior'),
    ('meera@test.com',   'Meera Shah',   'junior'),
    ('sameer@test.com',  'Sameer Rao',   'staff'),
]
PASSWORD_PLAIN = '12345678'


def _bcrypt_hash(pw):
    """Match the Flask app's password hashing (werkzeug — see routes/auth_routes.py)."""
    from werkzeug.security import generate_password_hash
    return generate_password_hash(pw)


def ensure_users():
    """Create the fake accounts in the SQLAlchemy users database."""
    pw_hash = _bcrypt_hash(PASSWORD_PLAIN)
    conn = sqlite3.connect(USERS_DB)
    conn.row_factory = sqlite3.Row
    created = {}
    try:
        for email, name, _ in FAKE_USERS:
            row = conn.execute('SELECT id FROM users WHERE email = ?', (email,)).fetchone()
            if row:
                created[email] = row['id']
                print(f'  user exists: {email} (id={row["id"]})')
                continue
            now = datetime.utcnow().isoformat()
            cur = conn.execute(
                'INSERT INTO users (name, email, password, created_at) VALUES (?, ?, ?, ?)',
                (name, email, pw_hash, now),
            )
            created[email] = cur.lastrowid
            print(f'  created user: {email} (id={cur.lastrowid})')
        conn.commit()
    finally:
        conn.close()
    return created


def get_senior_firm():
    """Find the first firm (we assume Priyam's — single-firm testing)."""
    conn = sqlite3.connect(LPMS_DB)
    conn.row_factory = sqlite3.Row
    try:
        firm = conn.execute('SELECT * FROM lpms_firms ORDER BY id LIMIT 1').fetchone()
        if not firm:
            print('✗ No practice/firm exists yet. Log in as Priyam, go to Matters, '
                  "create a practice first, then re-run this script.")
            sys.exit(1)
        senior = conn.execute(
            "SELECT * FROM lpms_members WHERE firm_id = ? AND role = 'senior' LIMIT 1",
            (firm['id'],),
        ).fetchone()
        if not senior:
            print('✗ No Senior Advocate in that firm — unexpected. Aborting.')
            sys.exit(1)
        return dict(firm), dict(senior)
    finally:
        conn.close()


def add_firm_members(firm, senior, user_ids):
    """Add the fake users to the firm (lpms_members)."""
    conn = sqlite3.connect(LPMS_DB)
    conn.row_factory = sqlite3.Row
    added = {}
    try:
        now = datetime.utcnow().isoformat()
        for email, name, role in FAKE_USERS:
            uid = user_ids.get(email)
            if not uid:
                continue
            row = conn.execute(
                'SELECT id FROM lpms_members WHERE firm_id = ? AND user_id = ?',
                (firm['id'], uid),
            ).fetchone()
            if row:
                added[email] = row['id']
                print(f'  member exists: {email} (member_id={row["id"]})')
                continue
            cur = conn.execute(
                'INSERT INTO lpms_members (firm_id, user_id, role, name, email, managed, created_by, created_at) '
                'VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
                (firm['id'], uid, role, name, email, senior['id'], now),
            )
            added[email] = cur.lastrowid
            print(f'  added as {role}: {email} (member_id={cur.lastrowid})')
        conn.commit()
    finally:
        conn.close()
    return added


def ensure_team(firm, senior_user_id, name, members_user_ids):
    """Create a team if missing + add members."""
    conn = sqlite3.connect(LPMS_DB)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            'SELECT * FROM teams WHERE owner_user_id = ? AND name = ?',
            (senior_user_id, name),
        ).fetchone()
        if row:
            team_id = row['id']
            print(f'  team exists: {name} (id={team_id})')
        else:
            now = datetime.utcnow().isoformat()
            cur = conn.execute(
                'INSERT INTO teams (name, description, is_private, owner_user_id, created_at) '
                'VALUES (?, ?, 0, ?, ?)',
                (name, None, senior_user_id, now),
            )
            team_id = cur.lastrowid
            conn.execute(
                "INSERT INTO team_memberships (team_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)",
                (team_id, senior_user_id, now),
            )
            print(f'  created team: {name} (id={team_id})')
        # Add members (skip if already in)
        for uid in members_user_ids:
            if not uid:
                continue
            row = conn.execute(
                'SELECT 1 FROM team_memberships WHERE team_id = ? AND user_id = ?',
                (team_id, uid),
            ).fetchone()
            if row:
                continue
            conn.execute(
                "INSERT INTO team_memberships (team_id, user_id, role, created_at) VALUES (?, ?, 'member', ?)",
                (team_id, uid, datetime.utcnow().isoformat()),
            )
            print(f'    added user_id={uid} to team "{name}"')
        conn.commit()
        return team_id
    finally:
        conn.close()


def ensure_case(firm, senior, title, team_id, advocate_member_id, restricted=0):
    """Create a case if one with the same title doesn't already exist in this firm."""
    conn = sqlite3.connect(LPMS_DB)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            'SELECT id FROM lpms_cases WHERE firm_id = ? AND title = ?',
            (firm['id'], title),
        ).fetchone()
        if row:
            print(f'  case exists: "{title}" (id={row["id"]})')
            return row['id']
        now = datetime.utcnow().isoformat()
        case_no = 'TEST-' + str(abs(hash(title)) % 10000)
        from utils.lpms_store import case_key
        key = case_key(case_no)
        cur = conn.execute(
            'INSERT INTO lpms_cases (firm_id, case_no, case_key, court, title, case_type, advocate_id, team_id, '
            'restricted, status, priority, created_by, created_at, updated_at) '
            "VALUES (?, ?, ?, 'Delhi High Court', ?, 'Civil', ?, ?, ?, 'Active', 'normal', ?, ?, ?)",
            (firm['id'], case_no, key, title, advocate_member_id, team_id, restricted, senior['id'], now, now),
        )
        print(f'  created case: "{title}" (id={cur.lastrowid}, team_id={team_id}, '
              f'advocate_id={advocate_member_id}, restricted={restricted})')
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def main():
    print('── Seeding fake test firm ──')
    print()

    print('1. Creating fake user accounts…')
    user_ids = ensure_users()
    print()

    print('2. Finding your firm…')
    firm, senior = get_senior_firm()
    print(f'  firm: {firm["name"]} (id={firm["id"]})  senior: {senior["name"]}')
    print()

    print('3. Adding users to firm as members…')
    member_ids = add_firm_members(firm, senior, user_ids)
    print()

    # Collect test@lexamplify2.com member id (should already exist from your earlier add)
    conn = sqlite3.connect(USERS_DB)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute("SELECT id FROM users WHERE email = 'test@lexamplify2.com'").fetchone()
        test2_uid = row['id'] if row else None
    finally:
        conn.close()
    user_ids['test@lexamplify2.com'] = test2_uid

    print('4. Setting up teams…')
    senior_uid = senior['user_id']
    litigation_id = ensure_team(firm, senior_uid, 'Litigation',
                                [test2_uid, user_ids['rahul@test.com']])
    corporate_id = ensure_team(firm, senior_uid, 'Corporate',
                               [user_ids['meera@test.com'], user_ids['sameer@test.com']])
    print()

    print('5. Creating test cases with different visibility…')
    ensure_case(firm, senior, 'Case A — Litigation team case', litigation_id, senior['id'], restricted=0)
    ensure_case(firm, senior, 'Case B — Corporate team case', corporate_id, senior['id'], restricted=0)
    ensure_case(firm, senior, 'Case C — Private to Priyam only', None, senior['id'], restricted=0)
    ensure_case(firm, senior, 'Case D — Confidential Litigation', litigation_id, senior['id'], restricted=1)
    print()

    print('✓ Seed complete.')
    print()
    print('Test these accounts (password: 12345678 for all):')
    print('  • test@lexamplify2.com  → Litigation member → should see Case A only')
    print('  • rahul@test.com        → Litigation member → should see Case A only')
    print('  • meera@test.com        → Corporate member  → should see Case B only')
    print('  • sameer@test.com       → Corporate staff   → should see Case B only')
    print('  Priyam (Senior)         → sees A, B, C, D (all)')
    print()
    print('Case D is Confidential → even Litigation members can\'t see it. Only Priyam does.')


if __name__ == '__main__':
    main()
