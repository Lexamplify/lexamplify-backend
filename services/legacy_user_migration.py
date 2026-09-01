"""
services/legacy_user_migration.py
One-time (safe to re-run) carry-over of users from the old raw-sqlite3
`lex_assistant.db` file — what routes/auth_routes.py's register/login/me/
forgot-password/reset-password used EXCLUSIVELY before they were switched
to the real SQLAlchemy User model (and therefore to whatever DATABASE_URL
actually points at — Neon in production). Registration was never failing
to reach Neon; it was never trying to. This exists so cutting over to the
real model doesn't lock out anyone who already registered through the old
path — matched and skipped by email, so re-running this is a no-op once a
user has been carried over (or if a real Neon signup already claimed that
email in the meantime).

lex_assistant.db is gitignored and lives on whatever filesystem the
process happens to be running on. It will often simply not exist — most
notably right after a Render redeploy, since Render's disk is ephemeral
unless a persistent Disk add-on is attached, so a real user who registered
against the old code on a live deployment may already have been lost on a
prior redeploy before this migration ever got a chance to run against it.
Both "file present" and "file absent" are treated as normal outcomes here,
not a failure — there is nothing this function can do about data that's
already gone.
"""
import os
import sqlite3

_LEGACY_DB_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "lex_assistant.db"
)


def migrate_legacy_sqlite_users(db, User) -> int:
    if not os.path.exists(_LEGACY_DB_PATH):
        print("[legacy_user_migration] no lex_assistant.db found at this path — nothing to migrate.")
        return 0

    conn = sqlite3.connect(_LEGACY_DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        try:
            rows = conn.execute("SELECT email, password, name, phone FROM users").fetchall()
        except sqlite3.OperationalError as e:
            print(f"[legacy_user_migration] legacy users table unreadable ({e}) — nothing to migrate.")
            return 0
    finally:
        conn.close()

    migrated = 0
    for row in rows:
        email = (row["email"] or "").strip().lower()
        if not email:
            continue
        if User.query.filter_by(email=email).first():
            continue  # already carried over, or a real signup already claimed this email
        db.session.add(User(
            email=email,
            password=row["password"],  # already a werkzeug hash — copied as-is, never re-hashed
            name=row["name"] or email.split("@")[0],
            phone=row["phone"] or None,
        ))
        migrated += 1

    if migrated:
        db.session.commit()
    print(f"[legacy_user_migration] migrated {migrated} legacy user(s) from lex_assistant.db.")
    return migrated
