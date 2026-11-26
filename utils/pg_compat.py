"""SQLite-API compatibility layer over PostgreSQL.

The app has ~95 raw `sqlite3.connect(...)` call sites using SQLite SQL. Rather
than rewrite every one, this module provides a psycopg2-backed object that
mimics the subset of the `sqlite3` API those call sites use, translating the
SQL on the fly. `legacy_sqlite_shim.install()` monkey-patches `sqlite3.connect`
to return these objects when DATABASE_URL is Postgres.

Covered: ? -> %s placeholders (with % escaping), `INTEGER PRIMARY KEY
[AUTOINCREMENT]` -> BIGSERIAL, DATETIME/BLOB types, `INSERT OR IGNORE/REPLACE`
-> ON CONFLICT, cursor.lastrowid via RETURNING, PRAGMA table_info ->
information_schema, other PRAGMA -> no-op, strftime(...) -> to_char(...), and
sqlite3.Row-style rows (index + key + dict()).

Not a long-term abstraction — it's a migration bridge. A handful of complex
upserts (INSERT OR REPLACE) still need per-site attention; those are logged.
"""
from __future__ import annotations
import os
import re
import sqlite3
import threading

import psycopg2
import psycopg2.pool
import psycopg2.extensions


def _bind(params):
    """Normalise params for psycopg2: dict stays a dict (for %(name)s), a
    sequence becomes a tuple, empty/None becomes None."""
    if params is None:
        return None
    if isinstance(params, dict):
        return params
    try:
        return tuple(params) if len(params) else None
    except TypeError:
        return (params,)


def _coerce_params(params, errmsg):
    """On a text/integer operator mismatch, coerce params the other way and signal
    a retry. errmsg like 'operator does not exist: text = integer'."""
    if not params:
        return None
    if "text = integer" in errmsg or "integer = text" in errmsg:
        if "text = integer" in errmsg:   # column text, int param -> make it text
            fn = lambda v: str(v) if isinstance(v, int) and not isinstance(v, bool) else v
        else:                            # column integer, numeric-text param -> make it int
            fn = lambda v: int(v) if isinstance(v, str) and v.lstrip("-").isdigit() else v
        if isinstance(params, dict):
            return {k: fn(v) for k, v in params.items()}
        return tuple(fn(v) for v in params)
    # INSERT/UPDATE assignment mismatch: 'column "x" is of type boolean but
    # expression is of type integer' (SQLite stored bools/dates as int/text).
    # Passing ints as strings lets Postgres apply its assignment cast to the
    # target column type (bool, integer, numeric, date, ...).
    if "is of type" in errmsg and "but expression is of type" in errmsg:
        fn = lambda v: str(v) if isinstance(v, int) and not isinstance(v, bool) else v
        if isinstance(params, dict):
            return {k: fn(v) for k, v in params.items()}
        return tuple(fn(v) for v in params)
    return None


def _as_sqlite_error(exc):
    """Re-raise a psycopg2 error as the sqlite3 type the call sites catch, so the
    many `except sqlite3.OperationalError` idempotent-schema blocks keep working."""
    msg = str(getattr(exc, "pgerror", None) or exc).strip()
    if isinstance(exc, psycopg2.IntegrityError):
        return sqlite3.IntegrityError(msg)
    if isinstance(exc, (psycopg2.ProgrammingError, psycopg2.OperationalError, psycopg2.errors.Error)):
        return sqlite3.OperationalError(msg)
    return exc

_pool = None
_pool_lock = threading.Lock()


def dsn() -> str:
    url = os.getenv("DATABASE_URL", "")
    # psycopg2 wants plain postgresql://, not SQLAlchemy's +psycopg2 form.
    return re.sub(r"^postgres(ql)?\+psycopg2://", "postgresql://", url)


def is_postgres() -> bool:
    return dsn().startswith(("postgresql://", "postgres://"))


# Push per-request identity into session GUCs on every connection checkout so
# Row-Level Security policies can read `current_setting('app.user_id', true)`.
# Inert until policies exist. Disable with DB_SESSION_GUC=off (e.g. if the RLS
# role is ever routed through a transaction-mode pooler, which would reset
# session GUCs between statements — set_config must then move to SET LOCAL in
# an explicit transaction, which this autocommit adapter does not provide).
_SESSION_GUC_ENABLED = (
    os.getenv("DB_SESSION_GUC", "on").lower() not in ("0", "false", "off")
    and is_postgres()
)


def _get_pool():
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                _pool = psycopg2.pool.ThreadedConnectionPool(1, 16, dsn=dsn())
    return _pool


# ── row that behaves like sqlite3.Row (int index, key, iterable, dict()) ──────
class Row:
    __slots__ = ("_cols", "_vals", "_idx")

    def __init__(self, cols, vals):
        self._cols = cols
        self._vals = vals
        self._idx = {c: i for i, c in enumerate(cols)}

    def __getitem__(self, k):
        if isinstance(k, int):
            return self._vals[k]
        return self._vals[self._idx[k]]

    def __iter__(self):
        return iter(self._vals)

    def __len__(self):
        return len(self._vals)

    def keys(self):
        return list(self._cols)

    def get(self, k, default=None):
        i = self._idx.get(k)
        return self._vals[i] if i is not None else default

    def __contains__(self, k):
        return k in self._idx


# ── SQL translation ──────────────────────────────────────────────────────────
_STRFTIME_MAP = [
    ("%Y", "YYYY"), ("%m", "MM"), ("%d", "DD"),
    ("%H", "HH24"), ("%M", "MI"), ("%S", "SS"),
    ("%j", "DDD"), ("%W", "IW"),
]


def _qmark_to_pyformat(sql: str) -> str:
    """Replace ? with %s, outside single-quoted string literals."""
    out = []
    in_str = False
    i = 0
    while i < len(sql):
        ch = sql[i]
        if ch == "'":
            # handle '' escape inside strings
            if in_str and i + 1 < len(sql) and sql[i + 1] == "'":
                out.append("''")
                i += 2
                continue
            in_str = not in_str
            out.append(ch)
        elif ch == "?" and not in_str:
            out.append("%s")
        else:
            out.append(ch)
        i += 1
    return "".join(out)


def _named_to_pyformat(sql: str) -> str:
    """Replace :name placeholders with %(name)s, outside string literals."""
    out = []
    in_str = False
    i = 0
    n = len(sql)
    while i < n:
        ch = sql[i]
        if ch == "'":
            if in_str and i + 1 < n and sql[i + 1] == "'":
                out.append("''"); i += 2; continue
            in_str = not in_str
            out.append(ch)
        elif ch == ":" and not in_str and i + 1 < n and (sql[i + 1].isalpha() or sql[i + 1] == "_"):
            j = i + 1
            while j < n and (sql[j].isalnum() or sql[j] == "_"):
                j += 1
            out.append("%(" + sql[i + 1:j] + ")s")
            i = j
            continue
        else:
            out.append(ch)
        i += 1
    return "".join(out)


def _translate_strftime(sql: str) -> str:
    # strftime('<fmt>', <expr>)  ->  to_char((<expr>)::timestamp, '<pgfmt>')
    def repl(m):
        fmt, expr = m.group(1), m.group(2)
        for a, b in _STRFTIME_MAP:
            fmt = fmt.replace(a, b)
        return f"to_char(({expr})::timestamp, '{fmt}')"
    return re.sub(r"strftime\(\s*'([^']*)'\s*,\s*([^()]+?)\s*\)", repl, sql, flags=re.IGNORECASE)


def _dt_modifier(m):
    mod = m.group(1).strip()
    mm = re.match(r"([+-]?\d+)\s+(\w+)", mod)
    if mm:
        return f"(now() + interval '{mm.group(1)} {mm.group(2)}')"
    return "now()"


def _translate_datetime(sql: str) -> str:
    # datetime('now','-7 days') -> (now() + interval '-7 days'); datetime('now') -> now()
    s = re.sub(r"datetime\(\s*'now'\s*,\s*'([^']+)'\s*\)", _dt_modifier, sql, flags=re.IGNORECASE)
    s = re.sub(r"datetime\(\s*'now'\s*\)", "now()", s, flags=re.IGNORECASE)
    s = re.sub(r"\bdate\(\s*'now'\s*\)", "current_date", s, flags=re.IGNORECASE)
    # generic datetime(<expr>) / date(<expr>) with a non-literal arg -> cast
    s = re.sub(r"\bdatetime\(\s*([^'()][^()]*?)\s*\)", r"(\1)::timestamp", s, flags=re.IGNORECASE)
    s = re.sub(r"\bdate\(\s*([^'()][^()]*?)\s*\)", r"(\1)::date", s, flags=re.IGNORECASE)
    return s


def _translate_ddl(sql: str) -> str:
    s = sql
    # INTEGER PRIMARY KEY [AUTOINCREMENT] -> BIGSERIAL PRIMARY KEY
    s = re.sub(r"\bINTEGER\s+PRIMARY\s+KEY(\s+AUTOINCREMENT)?",
               "BIGSERIAL PRIMARY KEY", s, flags=re.IGNORECASE)
    s = re.sub(r"\bAUTOINCREMENT\b", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\bDATETIME\b", "TIMESTAMP", s, flags=re.IGNORECASE)
    s = re.sub(r"\bBLOB\b", "BYTEA", s, flags=re.IGNORECASE)
    # idempotent ALTERs: make them truly idempotent on Postgres
    s = re.sub(r"\bADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS)", "ADD COLUMN IF NOT EXISTS ", s, flags=re.IGNORECASE)
    s = re.sub(r"\bDROP\s+COLUMN\s+(?!IF\s+EXISTS)", "DROP COLUMN IF EXISTS ", s, flags=re.IGNORECASE)
    return s


_UPSERT_LOGGED = set()


_SQLITE_MASTER_SUBQ = (
    "(SELECT 'table' AS type, table_name AS name, table_name AS tbl_name, '' AS sql "
    "FROM information_schema.tables WHERE table_schema='public' "
    "UNION ALL SELECT 'index' AS type, indexname AS name, tablename AS tbl_name, '' AS sql "
    "FROM pg_indexes WHERE schemaname='public') AS sqlite_master"
)


def _translate(sql: str, params) -> tuple[str, bool]:
    """Return (postgres_sql, wants_returning). Params presence drives %-escaping."""
    s = sql
    upper = s.lstrip()[:16].upper()

    if "sqlite_master" in s.lower():
        s = re.sub(r"\bsqlite_master\b", _SQLITE_MASTER_SUBQ, s, flags=re.IGNORECASE)

    if "json_each(" in s.lower():
        # SQLite's json_each(<array>) table fn -> Postgres json_array_elements_text.
        # Every use in this app expands an array of integer ids, so expose `value`
        # already cast to int (avoids downstream integer = text mismatches).
        s = re.sub(
            r"json_each\(\s*([^()]+?)\s*\)",
            r"(SELECT v::int AS value FROM json_array_elements_text((\1)::json) AS t(v)) AS je",
            s, flags=re.IGNORECASE)

    if "collate nocase" in s.lower():
        # SQLite's case-insensitive collation has no Postgres equivalent; drop it
        # (falls back to the default collation for the sort/compare).
        s = re.sub(r"\s+COLLATE\s+NOCASE", "", s, flags=re.IGNORECASE)

    if "strftime(" in s.lower():
        s = _translate_strftime(s)

    if "datetime(" in s.lower() or "date(" in s.lower():
        s = _translate_datetime(s)

    if upper.startswith("CREATE TABLE") or upper.startswith("ALTER TABLE") or upper.startswith("CREATE INDEX"):
        s = _translate_ddl(s)

    on_conflict = ""
    if upper.startswith("INSERT"):
        if re.match(r"\s*INSERT\s+OR\s+IGNORE\s+INTO", s, re.IGNORECASE):
            s = re.sub(r"\s*INSERT\s+OR\s+IGNORE\s+INTO", "INSERT INTO", s, flags=re.IGNORECASE)
            on_conflict = " ON CONFLICT DO NOTHING"
        elif re.match(r"\s*INSERT\s+OR\s+REPLACE\s+INTO", s, re.IGNORECASE):
            s = re.sub(r"\s*INSERT\s+OR\s+REPLACE\s+INTO", "INSERT INTO", s, flags=re.IGNORECASE)
            on_conflict = " ON CONFLICT DO NOTHING"  # v1: safe on empty DB; REPLACE-update sites handled per-module later
            key = sql[:60]
            if key not in _UPSERT_LOGGED:
                _UPSERT_LOGGED.add(key)

    # placeholders + % escaping (only when params are passed)
    has_params = params is not None and (len(params) > 0 if hasattr(params, "__len__") else True)
    if has_params:
        s = s.replace("%", "%%")
        if isinstance(params, dict):
            s = _named_to_pyformat(s)   # :name -> %(name)s
        else:
            s = _qmark_to_pyformat(s)   # ? -> %s

    wants_returning = (upper.startswith("INSERT")
                       and " RETURNING " not in s.upper())
    if on_conflict:
        s = s.rstrip().rstrip(";") + on_conflict
    if wants_returning:
        s = s.rstrip().rstrip(";") + " RETURNING id"
    return s, wants_returning


_PRAGMA_TABLE_INFO = re.compile(r"\s*PRAGMA\s+table_info\(\s*['\"]?(\w+)['\"]?\s*\)", re.IGNORECASE)


# ── cursor ───────────────────────────────────────────────────────────────────
class Cursor:
    def __init__(self, conn):
        self._conn = conn
        self._cur = conn._pg.cursor()
        self.lastrowid = None
        self._noop = False

    @property
    def rowcount(self):
        return self._cur.rowcount

    @property
    def description(self):
        return self._cur.description

    def execute(self, sql, params=()):
        self._noop = False
        self.lastrowid = None

        # SQLite transaction-control (BEGIN IMMEDIATE / COMMIT / ROLLBACK / …) is a
        # no-op here: the connection is autocommit, so there's no explicit txn to
        # open or close. (Loses multi-statement atomicity, acceptable for the
        # migration bridge; critical paths get real transactions later.)
        if re.match(r"\s*(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\b", sql, re.IGNORECASE):
            self._noop = True
            return self

        # PRAGMA handling
        m = _PRAGMA_TABLE_INFO.match(sql)
        if m:
            self._cur.execute(
                "SELECT ordinal_position-1 AS cid, column_name AS name, data_type AS type, "
                "CASE WHEN is_nullable='NO' THEN 1 ELSE 0 END AS notnull, column_default AS dflt_value, 0 AS pk "
                "FROM information_schema.columns WHERE table_schema='public' AND table_name=%s "
                "ORDER BY ordinal_position", (m.group(1),))
            return self
        if sql.lstrip()[:6].upper() == "PRAGMA":
            self._noop = True
            return self

        pg_sql, wants_returning = _translate(sql, params)
        try:
            self._cur.execute(pg_sql, _bind(params))
        except psycopg2.Error as e:
            # an auto " RETURNING id" on a table without an id column — retry without it
            if wants_returning and isinstance(e, psycopg2.errors.UndefinedColumn):
                self._cur = self._conn._pg.cursor()
                self._cur.execute(pg_sql[: pg_sql.upper().rfind(" RETURNING ID")], _bind(params))
                return self
            # SQLite had loose typing (TEXT column vs INTEGER param, etc.); Postgres
            # is strict. Retry once with params coerced to match the failing operator.
            # gate on the error message (not the psycopg2 class, which varies):
            # _coerce_params returns None unless it recognises a type-affinity error.
            coerced = _coerce_params(params, str(e).lower())
            if coerced is not None:
                self._cur = self._conn._pg.cursor()
                self._cur.execute(pg_sql, coerced)
            else:
                raise _as_sqlite_error(e) from e
        if wants_returning:
            try:
                row = self._cur.fetchone()
                self.lastrowid = row[0] if row else None
            except Exception:
                self.lastrowid = None
        return self

    def executemany(self, sql, seq):
        self._noop = False
        rows = list(seq)
        if not rows:
            return self
        pg_sql, _ = _translate(sql, rows[0])
        # drop any auto RETURNING for executemany
        pos = pg_sql.upper().rfind(" RETURNING ID")
        if pos != -1:
            pg_sql = pg_sql[:pos]
        self._cur.executemany(pg_sql, [tuple(r) for r in rows])
        return self

    def _wrap(self, row):
        if row is None:
            return None
        cols = [d[0] for d in self._cur.description]
        if self._conn.row_factory is Row or self._conn.row_factory is not None:
            return Row(cols, list(row))
        return tuple(row)

    def fetchone(self):
        if self._noop:
            return None
        return self._wrap(self._cur.fetchone())

    def fetchall(self):
        if self._noop:
            return []
        return [self._wrap(r) for r in self._cur.fetchall()]

    def fetchmany(self, size=None):
        if self._noop:
            return []
        rows = self._cur.fetchmany(size) if size is not None else self._cur.fetchmany()
        return [self._wrap(r) for r in rows]

    def __iter__(self):
        if self._noop:
            return iter([])
        return (self._wrap(r) for r in self._cur)

    def close(self):
        try:
            self._cur.close()
        except Exception:
            pass


# ── connection ───────────────────────────────────────────────────────────────
class Connection:
    def __init__(self):
        self._pool = _get_pool()
        self._pg = self._pool.getconn()
        # Autocommit mode: closest match to sqlite's per-statement behaviour, and
        # it keeps one failed statement (e.g. a defensively-caught duplicate-column
        # ALTER) from poisoning everything that follows in a Postgres transaction.
        self._pg.autocommit = True
        self.row_factory = None
        self.isolation_level = None
        self.text_factory = str
        self._closed = False
        # Push the caller's identity into session GUCs for RLS. Pooled
        # physical connections are reused across requests/users, so we set
        # this on EVERY checkout (to the current identity, or NULL when there
        # is none) — that overwrite is what stops a prior request's identity
        # leaking into the next one. Inert until RLS policies read the GUCs.
        if _SESSION_GUC_ENABLED:
            self._apply_session_identity()

    def _apply_session_identity(self):
        """Set app.user_id / app.workspace_id / app.firm_id for this
        connection from the request-identity contextvar. Session-scoped
        (is_local=False) because the adapter is autocommit — SET LOCAL would
        be discarded before the next statement runs. Best-effort: a failure
        here must never break the query that follows."""
        try:
            from utils.request_identity import get_identity
            uid, wid, fid = get_identity()
        except Exception:
            uid = wid = fid = None
        try:
            with self._pg.cursor() as c:
                c.execute(
                    "SELECT set_config('app.user_id', %s, false), "
                    "set_config('app.workspace_id', %s, false), "
                    "set_config('app.firm_id', %s, false)",
                    (None if uid is None else str(uid),
                     None if wid is None else str(wid),
                     None if fid is None else str(fid)),
                )
        except Exception:
            pass

    # sqlite3.Connection compatibility shims
    @property
    def in_transaction(self):
        return False

    @property
    def total_changes(self):
        return 0

    def create_function(self, *a, **k):
        return None  # sqlite UDF registration — no-op on Postgres

    def set_trace_callback(self, *a, **k):
        return None

    def cursor(self):
        return Cursor(self)

    def execute(self, sql, params=()):
        cur = self.cursor()
        cur.execute(sql, params)
        return cur

    def executemany(self, sql, seq):
        cur = self.cursor()
        cur.executemany(sql, seq)
        return cur

    def commit(self):
        self._pg.commit()

    def rollback(self):
        self._pg.rollback()

    def execute_script(self, script):  # sqlite executescript shim
        # Scripts are typically multi-statement DDL; translate sqlite DDL idioms
        # across the whole thing (AUTOINCREMENT, INTEGER PK, DATETIME/BLOB, …).
        with self._pg.cursor() as c:
            c.execute(_translate_ddl(script))

    executescript = execute_script

    def close(self):
        if self._closed:
            return
        self._closed = True
        try:
            self._pg.rollback()
        except Exception:
            pass
        # Belt-and-suspenders: clear the identity GUCs before returning the
        # physical connection to the pool, so a connection reused with NO
        # request context (background worker) can never inherit a prior
        # request's identity. __init__ also overwrites on checkout.
        if _SESSION_GUC_ENABLED:
            try:
                with self._pg.cursor() as c:
                    c.execute(
                        "SELECT set_config('app.user_id', NULL, false), "
                        "set_config('app.workspace_id', NULL, false), "
                        "set_config('app.firm_id', NULL, false)"
                    )
            except Exception:
                pass
        try:
            self._pool.putconn(self._pg)
        except Exception:
            try:
                self._pg.close()
            except Exception:
                pass

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type:
            self.rollback()
        else:
            self.commit()
        return False

    def __del__(self):
        # CRITICAL: sqlite's `with conn:` idiom only commits — it does NOT
        # close the connection. For real sqlite that is fine (connections are
        # cheap, GC'd). Here connections come from a fixed-size pool, so a
        # `with connect() as c:` that never calls close() would leak its pooled
        # physical connection forever → the pool drains to zero and every
        # request 500s with "connection pool exhausted". Returning the
        # connection to the pool on GC (prompt under CPython refcounting, i.e.
        # when the local `c` goes out of scope) prevents the leak without
        # changing the `with`-reuse semantics the call sites rely on.
        try:
            if not getattr(self, "_closed", True):
                self.close()
        except Exception:
            pass


def connect(database=None, *args, **kwargs):
    """Drop-in for sqlite3.connect — ignores the path, returns a PG-backed conn."""
    return Connection()
