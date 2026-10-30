"""Per-user ownership for the older sqlite tables (clients, billing, tracked cases, IP assets, calendar events, team tasks).

Those tables were created before accounts were scoped, so every signed-in advocate could read and change every other
advocate's rows. Each table now has an `owner_user_id` column; routes filter on it. Rows that existed before this change
have no owner: they are claimed, once, by the earliest registered account (the firm's original user), and are never shown
to anyone else. Nothing is deleted.
"""
import sqlite3

from flask_jwt_extended import get_jwt_identity

OWNER_COL = "owner_user_id"
_prepared = set()


def current_uid():
    try:
        return int(get_jwt_identity())
    except (TypeError, ValueError):
        return None


_legacy_cache = {"id": None, "at": 0.0}


def legacy_owner_id():
    """The earliest registered account. Rows with no owner belong to it. Cached for a minute: it is read on every request."""
    import time
    now = time.time()
    if now - _legacy_cache["at"] < 60 and _legacy_cache["id"] is not None:
        return _legacy_cache["id"]
    try:
        from models.user import User
        u = User.query.order_by(User.id.asc()).first()
        _legacy_cache.update(id=(u.id if u else None), at=now)
    except Exception:  # noqa: BLE001 - if users cannot be read nobody claims legacy rows, which is the safe outcome
        _legacy_cache.update(id=None, at=0.0)
    return _legacy_cache["id"]


def reset_cache():
    _legacy_cache.update(id=None, at=0.0)


def prepare(conn: sqlite3.Connection, db_key: str, tables, uid) -> None:
    """Make sure every table has the owner column and that the legacy owner has claimed the unowned rows."""
    for table in tables:
        cols = [r[1] for r in conn.execute(f"PRAGMA table_info({table})")]
        if not cols:
            continue          # the table does not exist yet (created lazily elsewhere)
        if OWNER_COL not in cols:
            try:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {OWNER_COL} INTEGER")
                conn.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_{OWNER_COL} ON {table}({OWNER_COL})")
                conn.commit()
            except sqlite3.OperationalError:
                pass      # another worker added it first
        key = (db_key, table)
        if key not in _prepared:
            _prepared.add(key)
    if uid is not None and uid == legacy_owner_id():
        for table in tables:
            if [r for r in conn.execute(f"PRAGMA table_info({table})") if r[1] == OWNER_COL]:
                conn.execute(f"UPDATE {table} SET {OWNER_COL} = ? WHERE {OWNER_COL} IS NULL", (uid,))
        conn.commit()
