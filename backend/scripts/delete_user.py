"""Delete a user by email from ALL databases. Run from repo root:
   python -I backend/scripts/delete_user.py test@lexamplify.com
"""
import sqlite3, json, sys, os, glob

if len(sys.argv) < 2:
    print("Usage: python delete_user.py <email>")
    sys.exit(1)

email = sys.argv[1]
base = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Find ALL .db files in the project
db_files = []
for root, dirs, files in os.walk(base):
    dirs[:] = [d for d in dirs if d not in ('.venv', 'node_modules', '__pycache__')]
    for f in files:
        if f.endswith('.db'):
            db_files.append(os.path.join(root, f))

print(f"Target email: {email}")
print(f"Scanning {len(db_files)} database files...\n")

user_ids = set()

# Pass 1: find user IDs from any users table
for db_path in db_files:
    try:
        conn = sqlite3.connect(db_path)
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
        if 'users' in tables:
            rows = conn.execute("SELECT id FROM users WHERE email=?", (email,)).fetchall()
            for r in rows:
                user_ids.add(r[0])
                print(f"  Found user id={r[0]} in {os.path.relpath(db_path, base)}")
        conn.close()
    except Exception as e:
        pass

if not user_ids:
    print(f"\nNo user found with email '{email}' in any database.")
    sys.exit(0)

print(f"\nUser IDs to delete: {user_ids}")
print()

# Pass 2: delete from every table that has user_id or id columns
for db_path in db_files:
    try:
        conn = sqlite3.connect(db_path)
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
        deleted_any = False
        for t in tables:
            cols = [r[1] for r in conn.execute(f"PRAGMA table_info('{t}')").fetchall()]
            for uid in user_ids:
                if 'user_id' in cols:
                    n = conn.execute(f"DELETE FROM {t} WHERE user_id=?", (uid,)).rowcount
                    if n:
                        print(f"  {os.path.relpath(db_path, base)} → {t} (user_id={uid}): {n} rows")
                        deleted_any = True
                if t == 'users' and 'id' in cols:
                    n = conn.execute(f"DELETE FROM {t} WHERE id=?", (uid,)).rowcount
                    if n:
                        print(f"  {os.path.relpath(db_path, base)} → users (id={uid}): {n} rows")
                        deleted_any = True
                # owner_user_id in lpms_firms — don't delete the firm, just note it
                if 'owner_user_id' in cols and t != 'users':
                    r = conn.execute(f"SELECT COUNT(*) FROM {t} WHERE owner_user_id=?", (uid,)).fetchone()
                    if r[0]:
                        print(f"  {os.path.relpath(db_path, base)} → {t} has {r[0]} rows with owner_user_id={uid}")
        conn.commit()
        conn.close()
    except Exception as e:
        pass

# Pass 3: reset onboarding on all firms
for db_path in db_files:
    try:
        conn = sqlite3.connect(db_path)
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
        if 'lpms_firms' in tables:
            for row in conn.execute("SELECT id, settings FROM lpms_firms").fetchall():
                s = json.loads(row[1] or '{}')
                s['onboarding'] = {
                    'wizard_completed': False,
                    'wizard_step': 0,
                    'tour_completed': False,
                    'tours_seen': []
                }
                conn.execute("UPDATE lpms_firms SET settings=? WHERE id=?", (json.dumps(s), row[0]))
                print(f"\n  Reset onboarding on firm {row[0]} in {os.path.relpath(db_path, base)}")
        conn.commit()
        conn.close()
    except:
        pass

print("\n✓ Done. Restart the backend server for changes to take effect.")
