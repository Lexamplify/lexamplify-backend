"""
utils/dms_files.py - shared ground for the Document Hub's "paper to digital" tools.

Four features sit on this module (each in its own file):

    dms_match.py   auto-filing: which case does this document belong to?   (dms_filing, dms_file_prefs)
    dms_paper.py   the physical file register: where is the paper file?    (dms_locations, dms_pfiles, ...)
    dms_bundle.py  court-ready bundles: one paginated PDF with an index     (dms_bundles, dms_bundle_items)
    dms_scan.py    scan intake: photos / scanned stacks -> clean documents  (dms_scan_sessions, dms_scan_pages)

Everything is NEW tables in the same lex_assistant.db; nothing that already exists is altered.

Who sees what ("scope"): a lawyer who belongs to a Practice firm shares the register, bundles and scan sessions with
that firm; anyone else has a private scope of their own. The scope is just a string ('firm:3' / 'user:17').
"""
import contextlib
import json
import re
import sqlite3
import time

try:
    from utils import dms_index as I
except ImportError:  # pragma: no cover
    import dms_index as I

LOCATION_KINDS = ("room", "almirah", "rack", "shelf", "box", "drawer", "other")
PFILE_KINDS = ("file", "bundle", "box", "register", "original")

_DDL = """
CREATE TABLE IF NOT EXISTS dms_locations (
    id          INTEGER PRIMARY KEY,
    scope       TEXT NOT NULL,
    parent_id   INTEGER,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'almirah',
    code        TEXT,
    notes       TEXT,
    archived    INTEGER NOT NULL DEFAULT 0,
    created_by  INTEGER,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_dms_loc_scope ON dms_locations(scope, parent_id);

CREATE TABLE IF NOT EXISTS dms_pfiles (
    id            INTEGER PRIMARY KEY,
    scope         TEXT NOT NULL,
    seq           INTEGER NOT NULL,
    file_no       TEXT NOT NULL,
    token         TEXT NOT NULL UNIQUE,
    title         TEXT NOT NULL,
    kind          TEXT NOT NULL DEFAULT 'file',
    case_ref      TEXT,
    case_label    TEXT,
    client        TEXT,
    location_id   INTEGER,
    location_note TEXT,
    status        TEXT NOT NULL DEFAULT 'in',
    holder        TEXT,
    holder_user_id INTEGER,
    issued_at     TEXT,
    due_at        TEXT,
    pages_est     INTEGER,
    notes         TEXT,
    created_by    INTEGER,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    archived_at   TEXT,
    UNIQUE(scope, seq)
);
CREATE INDEX IF NOT EXISTS ix_dms_pf_scope  ON dms_pfiles(scope, status);
CREATE INDEX IF NOT EXISTS ix_dms_pf_case   ON dms_pfiles(case_ref);
CREATE INDEX IF NOT EXISTS ix_dms_pf_loc    ON dms_pfiles(location_id);
CREATE INDEX IF NOT EXISTS ix_dms_pf_due    ON dms_pfiles(status, due_at);

CREATE TABLE IF NOT EXISTS dms_pfile_moves (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    pfile_id    INTEGER NOT NULL,
    action      TEXT NOT NULL,
    actor_id    INTEGER,
    actor_name  TEXT,
    from_holder TEXT,
    to_holder   TEXT,
    from_loc    TEXT,
    to_loc      TEXT,
    due_at      TEXT,
    note        TEXT,
    at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_dms_pfm_file ON dms_pfile_moves(pfile_id, id);

CREATE TABLE IF NOT EXISTS dms_pfile_docs (
    pfile_id  INTEGER NOT NULL,
    doc_id    INTEGER NOT NULL,
    linked_by INTEGER,
    linked_at TEXT NOT NULL,
    PRIMARY KEY (pfile_id, doc_id)
);
CREATE INDEX IF NOT EXISTS ix_dms_pfd_doc ON dms_pfile_docs(doc_id);

CREATE TABLE IF NOT EXISTS dms_filing (
    doc_id       INTEGER PRIMARY KEY,
    owner_id     INTEGER NOT NULL,
    state        TEXT NOT NULL,
    top_ref      TEXT,
    top_score    REAL,
    candidates   TEXT,
    note         TEXT,
    sig          TEXT,
    evaluated_at TEXT,
    decided_by   INTEGER,
    decided_at   TEXT,
    filed_ref    TEXT,
    prev_ref     TEXT,
    via          TEXT
);
CREATE INDEX IF NOT EXISTS ix_dms_filing_owner ON dms_filing(owner_id, state);

CREATE TABLE IF NOT EXISTS dms_file_prefs (
    user_id   INTEGER PRIMARY KEY,
    auto_file INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS dms_bundles (
    id          INTEGER PRIMARY KEY,
    scope       TEXT NOT NULL,
    owner_id    INTEGER NOT NULL,
    title       TEXT NOT NULL,
    case_ref    TEXT,
    options     TEXT NOT NULL DEFAULT '{}',
    status      TEXT NOT NULL DEFAULT 'draft',
    build_state TEXT NOT NULL DEFAULT 'idle',
    build_note  TEXT,
    progress    REAL NOT NULL DEFAULT 0,
    built_at    TEXT,
    built_pages INTEGER,
    built_size  INTEGER,
    built_sha   TEXT,
    built_key   TEXT,
    built_enc   INTEGER NOT NULL DEFAULT 0,
    built_warnings TEXT,
    built_fp    TEXT,
    saved_doc_id INTEGER,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_dms_bundles_scope ON dms_bundles(scope, updated_at);

CREATE TABLE IF NOT EXISTS dms_bundle_items (
    id        INTEGER PRIMARY KEY,
    bundle_id INTEGER NOT NULL,
    seq       INTEGER NOT NULL,
    kind      TEXT NOT NULL DEFAULT 'doc',
    doc_id    INTEGER,
    title     TEXT,
    label     TEXT,
    pages     TEXT,
    note      TEXT,
    in_index  INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_dms_bi_bundle ON dms_bundle_items(bundle_id, seq);
CREATE INDEX IF NOT EXISTS ix_dms_bi_doc    ON dms_bundle_items(doc_id);

CREATE TABLE IF NOT EXISTS dms_scan_sessions (
    id         TEXT PRIMARY KEY,
    scope      TEXT NOT NULL,
    owner_id   INTEGER NOT NULL,
    status     TEXT NOT NULL DEFAULT 'open',
    state      TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_dms_scan_owner ON dms_scan_sessions(owner_id, status);

CREATE TABLE IF NOT EXISTS dms_scan_pages (
    id         INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL,
    seq        INTEGER NOT NULL,
    src_name   TEXT,
    src_kind   TEXT,
    status     TEXT NOT NULL DEFAULT 'queued',
    error      TEXT,
    w          INTEGER,
    h          INTEGER,
    text       TEXT,
    info       TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_dms_scanp_sess ON dms_scan_pages(session_id, seq);
CREATE INDEX IF NOT EXISTS ix_dms_scanp_q    ON dms_scan_pages(status, id);
"""

_TRIGGER = """CREATE TRIGGER IF NOT EXISTS dms_files_cv_cleanup AFTER DELETE ON case_vault BEGIN
     DELETE FROM dms_filing WHERE doc_id = old.id;
     DELETE FROM dms_pfile_docs WHERE doc_id = old.id;
   END"""


def ensure_schema(conn):
    """Idempotent. Safe on every start."""
    conn.executescript(_DDL)
    if "built_fp" not in {r[1] for r in conn.execute("PRAGMA table_info(dms_bundles)")}:      # a table created before this column existed
        conn.execute("ALTER TABLE dms_bundles ADD COLUMN built_fp TEXT")
    if I._table_exists(conn, "case_vault"):
        conn.execute(_TRIGGER)
    conn.commit()


# ── small helpers ────────────────────────────────────────────────────────────────────
def now_iso():
    return time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())


def today_iso():
    """Today's date in India (UTC+5:30) - a due date means a calendar day on the lawyer's clock, not the server's."""
    return time.strftime("%Y-%m-%d", time.gmtime(time.time() + 19800))


def loads(s, default=None):
    if s in (None, ""):
        return default
    try:
        v = json.loads(s)
        return v if v is not None else default
    except (TypeError, ValueError):
        return default


def clip(v, n):
    return re.sub(r"\s+", " ", str(v or "")).strip()[:n]


def valid_date(s):
    if not s or not re.match(r"^\d{4}-\d{2}-\d{2}$", str(s)):
        return False
    try:
        time.strptime(str(s), "%Y-%m-%d")
        return True
    except ValueError:
        return False


def scope_of(conn, uid):
    """'firm:<id>' for a member of a Practice firm (they share one register), else 'user:<id>'."""
    if I._has_lpms_tables(conn):
        with contextlib.suppress(sqlite3.DatabaseError):
            r = conn.execute("SELECT firm_id FROM lpms_members WHERE user_id = ? AND active = 1 ORDER BY id LIMIT 1", (int(uid),)).fetchone()
            if r:
                return f"firm:{r[0]}"
    return f"user:{int(uid)}"


def scope_member_names(conn, uid):
    """{user_id: name} of the people sharing this person's scope - used for the 'who has the file' picker."""
    sc = scope_of(conn, uid)
    if sc.startswith("firm:"):
        rows = conn.execute("SELECT user_id, name FROM lpms_members WHERE firm_id = ? AND active = 1 ORDER BY name", (int(sc.split(":")[1]),)).fetchall()
        return {r["user_id"]: r["name"] for r in rows}
    return {}


# ── cases a person can file into ─────────────────────────────────────────────────────
_LPMS_ACCESS = ("JOIN lpms_members me ON me.firm_id = c.firm_id AND me.user_id = :uid AND me.active = 1 "
                "WHERE (c.restricted = 0 OR me.role = 'senior' OR c.advocate_id = me.id)")


def accessible_cases(conn, uid, q="", limit=40, include_archived=False, refs=None):
    """Every case this person may put a document or a paper file on - Practice cases and Matters - as
    [{ref, kind, title, case_no, court, client, status, archived}] (best matches first)."""
    out = []
    q = clip(q, 80).lower()
    if I._has_lpms_tables(conn):
        sql = (f"SELECT c.id, c.case_no, c.court, c.title, c.opposite_party, c.status, c.archived_at, cl.name AS client "
               f"FROM lpms_cases c LEFT JOIN lpms_clients cl ON cl.id = c.client_id {_LPMS_ACCESS}")
        if not include_archived:
            sql += " AND c.archived_at IS NULL"
        sql += " ORDER BY c.updated_at DESC LIMIT 3000"
        for r in conn.execute(sql, {"uid": int(uid)}):
            out.append({"ref": f"lpms:{r['id']}", "kind": "practice", "title": r["title"], "case_no": r["case_no"], "court": r["court"],
                        "client": r["client"], "opposite": r["opposite_party"], "status": r["status"], "archived": bool(r["archived_at"])})
    if I._has_matter_tables(conn):
        for m in I.matter_ids_for(conn, uid):
            out.append({"ref": f"matter:{m['id']}", "kind": "matter", "title": m["title"], "case_no": None, "court": None, "client": None,
                        "opposite": None, "status": m["status"], "archived": False})
    if refs is not None:
        refs = set(refs)
        out = [c for c in out if c["ref"] in refs]
    if q:
        words = [w for w in re.split(r"\s+", q) if w]
        flat = lambda c: re.sub(r"[^a-z0-9ऀ-෿ ]", "", " ".join(str(c.get(k) or "") for k in ("title", "case_no", "court", "client", "opposite")).lower())
        flat_nopunct = lambda c: re.sub(r"[^a-z0-9]", "", flat(c))
        scored = []
        for c in out:
            f, fn = flat(c), flat_nopunct(c)
            if all((w in f) or (re.sub(r"[^a-z0-9]", "", w) and re.sub(r"[^a-z0-9]", "", w) in fn) for w in words):
                scored.append((0 if (c["case_no"] or "").lower().startswith(q) else 1, c))
        out = [c for _s, c in sorted(scored, key=lambda t: t[0])]
    return out[:max(1, min(int(limit), 500))]


def case_label(conn, ref):
    """'Sharma v. Verma · CS 10/2026' for a case reference, or None when it no longer exists."""
    if not ref:
        return None
    try:
        kind, n = str(ref).split(":", 1)
        n = int(n)
    except (ValueError, TypeError):
        return None
    if kind == "lpms" and I._has_lpms_tables(conn):
        r = conn.execute("SELECT title, case_no FROM lpms_cases WHERE id = ?", (n,)).fetchone()
        return f"{r['title']} · {r['case_no']}" if r else None
    if kind == "matter" and I._has_matter_tables(conn):
        r = conn.execute("SELECT title FROM matters WHERE id = ?", (n,)).fetchone()
        return r["title"] if r else None
    return None


def can_use_case(conn, uid, ref, writing=True):
    """(ok, reason). Practice cases follow Practice access rules; Matters follow team membership."""
    try:
        kind, n = str(ref).split(":", 1)
        n = int(n)
    except (ValueError, TypeError):
        return False, "That case could not be found."
    if kind == "lpms":
        if I.lpms_case_role(conn, uid, n) is None:
            return False, "That case could not be found."
        if writing:
            r = conn.execute("SELECT archived_at FROM lpms_cases WHERE id = ?", (n,)).fetchone()
            if r and r[0]:
                return False, "That case is archived. Restore it before filing documents to it."
        return True, ""
    if kind == "matter":
        if f"matter:{n}" not in I.matter_role_map(conn, uid):
            return False, "That matter could not be found."
        return True, ""
    return False, "That case could not be found."
