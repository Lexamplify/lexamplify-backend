"""
utils/dms_index.py - schema, full-text index and search for the Document Hub.

Everything lives in the same lex_assistant.db as Case Vault, in NEW tables only:

    dms_docs       one row per stored file (1:1 with a case_vault row): hash, status,
                   classification, extracted facts, version chain, soft-delete, legal hold
    dms_pages      the extracted text, one row per page / sheet / section
    dms_fts        FTS5 index over dms_pages (external content, kept in sync by triggers)
    dms_meta_fts   FTS5 index over titles, case numbers, parties, court, class
    dms_jobs       the extraction queue (survives restarts)

case_vault itself is untouched apart from one clean-up trigger, so nothing that already reads
it can break.

Search semantics (why it is built this way):
  * Every word must be present in the DOCUMENT, but not necessarily on the same page - a
    lawyer searching "arbitration delhi" wants the contract where they appear on different
    pages. Ranking then prefers pages that contain more of the words together.
  * Case numbers are matched however they are written: W.P.(C) 1234/2024, WPC No. 1234 of
    2024 and wp(c) 1234/2024 are the same search.
  * Hindi and other Indian scripts are indexed as whole words (matras and viramas kept).
  * Nothing is decided by an AI model; results are deterministic and explainable.
"""
import contextlib
import json
import re
import sqlite3
import unicodedata

try:
    from utils import dms_classify as C
except ImportError:  # pragma: no cover
    import dms_classify as C

HL_OPEN, HL_CLOSE = "\x02", "\x03"          # highlight markers in snippets - never HTML
MAX_TERMS = 12

# ── connection ───────────────────────────────────────────────────────────────────────
def connect(db_path):
    conn = sqlite3.connect(db_path, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=30000")
    return conn


# ── schema ───────────────────────────────────────────────────────────────────────────
_DDL = """
CREATE TABLE IF NOT EXISTS dms_docs (
    doc_id        INTEGER PRIMARY KEY,
    sha256        TEXT NOT NULL,
    store_key     TEXT NOT NULL,
    enc           INTEGER NOT NULL DEFAULT 0,
    size          INTEGER NOT NULL DEFAULT 0,
    mime          TEXT,
    ext           TEXT,
    kind          TEXT,
    original_name TEXT,
    rel_path      TEXT,
    status        TEXT NOT NULL DEFAULT 'queued',
    status_note   TEXT,
    warnings      TEXT,
    page_count    INTEGER NOT NULL DEFAULT 0,
    page_kind     TEXT,
    method        TEXT,
    ocr_pages     INTEGER NOT NULL DEFAULT 0,
    ocr_conf      REAL,
    doc_class     TEXT,
    class_conf    REAL,
    class_src     TEXT NOT NULL DEFAULT 'auto',
    class_evidence TEXT,
    review        TEXT,
    meta          TEXT,
    doc_date      TEXT,
    next_hearing  TEXT,
    parties       TEXT,
    court         TEXT,
    case_keys     TEXT,
    text_hash     TEXT,
    group_id      INTEGER NOT NULL,
    version       INTEGER NOT NULL DEFAULT 1,
    is_current    INTEGER NOT NULL DEFAULT 1,
    version_note  TEXT,
    batch_id      TEXT,
    uploaded_by   INTEGER,
    tags          TEXT,
    legal_hold    INTEGER NOT NULL DEFAULT 0,
    deleted_at    TEXT,
    deleted_by    INTEGER,
    created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TEXT,
    processed_at  TEXT
);
CREATE INDEX IF NOT EXISTS ix_dms_sha     ON dms_docs(sha256);
CREATE INDEX IF NOT EXISTS ix_dms_group   ON dms_docs(group_id, version);
CREATE INDEX IF NOT EXISTS ix_dms_status  ON dms_docs(status);
CREATE INDEX IF NOT EXISTS ix_dms_class   ON dms_docs(doc_class);
CREATE INDEX IF NOT EXISTS ix_dms_date    ON dms_docs(doc_date);
CREATE INDEX IF NOT EXISTS ix_dms_batch   ON dms_docs(batch_id);
CREATE INDEX IF NOT EXISTS ix_dms_thash   ON dms_docs(text_hash);
CREATE INDEX IF NOT EXISTS ix_dms_del     ON dms_docs(deleted_at);
CREATE INDEX IF NOT EXISTS ix_dms_review  ON dms_docs(review);
CREATE INDEX IF NOT EXISTS ix_dms_upl     ON dms_docs(uploaded_by);

CREATE TABLE IF NOT EXISTS dms_pages (
    doc_id  INTEGER NOT NULL,
    page_no INTEGER NOT NULL,
    text    TEXT NOT NULL,
    keys    TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (doc_id, page_no)
);

CREATE TABLE IF NOT EXISTS dms_jobs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id      INTEGER NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'extract',
    status      TEXT NOT NULL DEFAULT 'queued',
    attempts    INTEGER NOT NULL DEFAULT 0,
    run_after   REAL NOT NULL DEFAULT 0,
    locked_by   TEXT,
    locked_at   REAL,
    error       TEXT,
    created_at  REAL NOT NULL,
    finished_at REAL
);
CREATE INDEX IF NOT EXISTS ix_dms_jobs_q   ON dms_jobs(status, run_after, id);
CREATE INDEX IF NOT EXISTS ix_dms_jobs_doc ON dms_jobs(doc_id);

CREATE TABLE IF NOT EXISTS dms_kv (k TEXT PRIMARY KEY, v TEXT);

-- same definition app.py uses; created here too so the Document Hub can write its audit entries
-- even if it is mounted before the vault has initialised.
CREATE TABLE IF NOT EXISTS vault_provenance (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    node_type      TEXT NOT NULL CHECK (node_type IN ('folder', 'document')),
    node_id        INTEGER,
    node_name      TEXT NOT NULL,
    action         TEXT NOT NULL,
    actor_user_id  INTEGER,
    owner_user_id  INTEGER,
    detail         TEXT,
    content_hash   TEXT NOT NULL,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);
"""

_TOKENIZERS = (
    "unicode61 remove_diacritics 2 categories 'L* N* Co Mn Mc'",
    "unicode61 remove_diacritics 1 categories 'L* N* Co Mn Mc'",
    "unicode61 remove_diacritics 1",
    "unicode61",
)


def _table_exists(conn, name):
    return conn.execute("SELECT 1 FROM sqlite_master WHERE name = ?", (name,)).fetchone() is not None


def _ensure_fts(conn):
    """Create the two FTS tables with the best tokenizer this SQLite supports. The 'categories'
    option keeps Devanagari/Tamil/... words whole; older SQLite falls back to plain unicode61
    (Indian-script words then match as fragments - less precise, still findable)."""
    if _table_exists(conn, "dms_fts") and _table_exists(conn, "dms_meta_fts"):
        return
    last = None
    for tok in _TOKENIZERS:
        try:
            conn.execute(
                f"CREATE VIRTUAL TABLE IF NOT EXISTS dms_fts USING fts5(text, keys, content='dms_pages', "
                f"content_rowid='rowid', tokenize=\"{tok}\", prefix='2 3')")
            conn.execute(
                f"CREATE VIRTUAL TABLE IF NOT EXISTS dms_meta_fts USING fts5(title, refs, parties, court, cls, "
                f"tokenize=\"{tok}\")")
            conn.execute("INSERT OR REPLACE INTO dms_kv(k, v) VALUES ('fts_tokenizer', ?)", (tok,))
            return
        except sqlite3.OperationalError as exc:
            last = exc
            for t in ("dms_fts", "dms_meta_fts"):
                with contextlib.suppress(sqlite3.OperationalError):
                    conn.execute(f"DROP TABLE IF EXISTS {t}")
    raise RuntimeError(f"This SQLite build has no usable FTS5 ({last}). The Document Hub search needs FTS5.")


_TRIGGERS = (
    """CREATE TRIGGER IF NOT EXISTS dms_pages_ai AFTER INSERT ON dms_pages BEGIN
         INSERT INTO dms_fts(rowid, text, keys) VALUES (new.rowid, new.text, new.keys);
       END""",
    """CREATE TRIGGER IF NOT EXISTS dms_pages_ad AFTER DELETE ON dms_pages BEGIN
         INSERT INTO dms_fts(dms_fts, rowid, text, keys) VALUES ('delete', old.rowid, old.text, old.keys);
       END""",
    """CREATE TRIGGER IF NOT EXISTS dms_pages_au AFTER UPDATE ON dms_pages BEGIN
         INSERT INTO dms_fts(dms_fts, rowid, text, keys) VALUES ('delete', old.rowid, old.text, old.keys);
         INSERT INTO dms_fts(rowid, text, keys) VALUES (new.rowid, new.text, new.keys);
       END""",
)

# When the OLD vault route hard-deletes a case_vault row (it still can), the Document Hub rows
# behind it must go too, or search would return ghosts.
_CV_TRIGGER = """CREATE TRIGGER IF NOT EXISTS dms_cv_cleanup AFTER DELETE ON case_vault BEGIN
     DELETE FROM dms_pages WHERE doc_id = old.id;
     DELETE FROM dms_meta_fts WHERE rowid = old.id;
     DELETE FROM dms_jobs WHERE doc_id = old.id;
     DELETE FROM dms_docs WHERE doc_id = old.id;
   END"""


def ensure_schema(conn):
    """Idempotent. Safe to call on every start."""
    with contextlib.suppress(sqlite3.DatabaseError):
        conn.execute("PRAGMA journal_mode=WAL")      # readers no longer block the extraction workers
    conn.executescript(_DDL)
    _ensure_fts(conn)
    for t in _TRIGGERS:
        conn.execute(t)
    if _table_exists(conn, "case_vault"):
        conn.execute(_CV_TRIGGER)
    conn.commit()


def fts_tokenizer(conn):
    row = conn.execute("SELECT v FROM dms_kv WHERE k = 'fts_tokenizer'").fetchone()
    return row[0] if row else ""


def indic_search_ok(conn):
    return "categories" in fts_tokenizer(conn)


def rebuild_fts(conn):
    conn.execute("INSERT INTO dms_fts(dms_fts) VALUES ('rebuild')")
    for r in conn.execute("SELECT doc_id FROM dms_docs").fetchall():
        refresh_meta_fts(conn, r[0])
    conn.commit()


def optimize(conn):
    conn.execute("INSERT INTO dms_fts(dms_fts) VALUES ('optimize')")
    conn.execute("INSERT INTO dms_meta_fts(dms_meta_fts) VALUES ('optimize')")
    conn.commit()


# ── writing the index ────────────────────────────────────────────────────────────────
def set_doc_pages(conn, doc_id, pages):
    """Replace a document's text. `pages` = [(page_no, text)]. FTS follows through the triggers."""
    conn.execute("DELETE FROM dms_pages WHERE doc_id = ?", (doc_id,))
    rows = []
    for n, text in pages:
        text = unicodedata.normalize("NFC", text or "").replace("\x00", " ").replace(HL_OPEN, " ").replace(HL_CLOSE, " ")
        if not text.strip():
            continue
        rows.append((doc_id, int(n), text, " ".join(sorted(C.case_tokens(text)))))
    conn.executemany("INSERT INTO dms_pages(doc_id, page_no, text, keys) VALUES (?,?,?,?)", rows)
    return len(rows)


def refresh_meta_fts(conn, doc_id):
    row = conn.execute(
        "SELECT cv.title, cv.smart_title, d.original_name, d.meta, d.parties, d.court, d.doc_class, d.tags, d.case_keys "
        "FROM dms_docs d JOIN case_vault cv ON cv.id = d.doc_id WHERE d.doc_id = ?", (doc_id,)).fetchone()
    conn.execute("DELETE FROM dms_meta_fts WHERE rowid = ?", (doc_id,))
    if not row:
        return
    meta = _loads(row["meta"], {})
    refs = []
    for shown in (meta.get("case_numbers") or []) + (meta.get("fir_numbers") or []) + (meta.get("cnr") or []):
        refs.append(shown)
        m = C.CASE_RE.search(shown)
        if m:
            refs.append(C.case_token(C.case_key(m.group("type"), m.group("num"), m.group("year"))))
    for k in (row["case_keys"] or "").split("|"):
        if k.strip():
            refs.append(C.case_token(k))
    for f in meta.get("fir_numbers") or []:
        refs.append(C.case_token(f))
    tags = " ".join(_loads(row["tags"], []))
    title = " ".join(x for x in (row["smart_title"], row["title"], row["original_name"], tags) if x)
    conn.execute(
        "INSERT INTO dms_meta_fts(rowid, title, refs, parties, court, cls) VALUES (?,?,?,?,?,?)",
        (doc_id, title, " ".join(refs), row["parties"] or "", row["court"] or "", row["doc_class"] or ""))


def _loads(s, default):
    if not s:
        return default
    try:
        v = json.loads(s)
        return v if v is not None else default
    except (TypeError, ValueError):
        return default


# ── query parsing ────────────────────────────────────────────────────────────────────
_INDIC_RANGE = "ऀ-෿"
_WORD_RE = re.compile(rf"[\w{_INDIC_RANGE}]+", re.UNICODE)
_QTOKEN = re.compile(r'(-?)"([^"]{1,200})"|(-?)(\S+)')


class Term:
    __slots__ = ("pages", "meta", "words", "exact")

    def __init__(self, pages, meta, words, exact=False):
        self.pages, self.meta, self.words, self.exact = pages, meta, words, exact


def _quote(words):
    return '"' + " ".join(words).replace('"', '""') + '"'


def parse_query(q):
    """-> (terms, excluded). Bare words match as prefixes when they are 4+ letters ("arbitr" finds
    arbitration, arbitrator); "quoted text" is an exact phrase; -word excludes; case numbers in any
    spelling are recognised. Returns FTS5 expressions built ONLY from sanitised words, so user input
    can never inject FTS operators."""
    q = unicodedata.normalize("NFC", (q or "").strip())[:300]
    if not q:
        return [], []
    spans, case_terms = [], []
    for m in C.CASE_RE.finditer(q):
        # (no capital-letters rule here: someone typing "wp(c) 1234/2024" is searching for a case number)
        key = C.case_key(m.group("type"), m.group("num"), m.group("year"))
        tok = C.case_token(key)
        words = _WORD_RE.findall(m.group(0).lower())
        if not words:
            continue
        spans.append((m.start(), m.end()))
        case_terms.append(Term(f'({_quote(words)} OR keys : "{tok}")', f'({_quote(words)} OR refs : "{tok}")', words, exact=True))
    rest = list(q)
    for a, b in spans:
        for i in range(a, b):
            rest[i] = " "
    rest = "".join(rest)
    terms, excluded = list(case_terms), []
    for m in _QTOKEN.finditer(rest):
        neg = bool(m.group(1) or m.group(3))
        if m.group(2) is not None:                      # "quoted phrase"
            words = _WORD_RE.findall(m.group(2).lower())
            if not words:
                continue
            t = Term(_quote(words), _quote(words), words, exact=True)
        else:
            words = _WORD_RE.findall(m.group(4).lower())
            if not words:
                continue
            prefix = (len(words) == 1 and len(words[0]) >= 4 and not any(ch.isdigit() for ch in words[0])
                      and not any("ऀ" <= ch <= "෿" for ch in words[0]))
            explicit_star = m.group(4).endswith("*") and len(words) == 1
            expr = _quote(words) + ("*" if (prefix or explicit_star) else "")
            t = Term(expr, expr, words, exact=not (prefix or explicit_star))
        (excluded if neg else terms).append(t)
    return terms[:MAX_TERMS], excluded[:MAX_TERMS]


def highlight_words(terms):
    seen, out = set(), []
    for t in terms:
        for w in t.words:
            if w not in seen and len(w) >= 2:
                seen.add(w)
                out.append(w)
    return out[:20]


# ── visibility & access ──────────────────────────────────────────────────────────────
class Ctx:
    """Who is asking, and what they may see. Built once per request by the route layer."""

    def __init__(self, uid, shared_folders=(), shared_docs=(), share_perm=None):
        self.uid = int(uid)
        self.shared_folders = set(shared_folders or ())
        self.shared_docs = set(shared_docs or ())
        self.share_perm = share_perm or (lambda doc_id: None)


def _has_matter_tables(conn):
    return _table_exists(conn, "matters") and _table_exists(conn, "team_memberships")


def _has_lpms_tables(conn):
    return _table_exists(conn, "lpms_cases") and _table_exists(conn, "lpms_members")


def lpms_case_role(conn, uid, case_id):
    """Role ('senior'|'junior'|'staff') this user holds in the firm that owns Practice case `case_id`, or None when they
    may not see that case (not a member, or a restricted case they are not on)."""
    if not _has_lpms_tables(conn):
        return None
    r = conn.execute(
        "SELECT me.role FROM lpms_cases c JOIN lpms_members me ON me.firm_id = c.firm_id AND me.user_id = ? AND me.active = 1 "
        "WHERE c.id = ? AND (c.restricted = 0 OR me.role = 'senior' OR c.advocate_id = me.id)", (int(uid), int(case_id))).fetchone()
    return r[0] if r else None


def visibility_sql(conn, ctx):
    """SQL predicate over `cv` (case_vault) for rows this user may see: their own uploads, documents
    shared with them, and documents in matters they own or whose team they belong to. Legacy
    NULL-owner rows are deliberately NOT included - they predate any ownership and stay visible in
    Case Vault only, never in the firm-wide Document Hub."""
    conn.execute("CREATE TEMP TABLE IF NOT EXISTS _dms_vd(id INTEGER PRIMARY KEY)")
    conn.execute("CREATE TEMP TABLE IF NOT EXISTS _dms_vf(id INTEGER PRIMARY KEY)")
    conn.execute("DELETE FROM _dms_vd")
    conn.execute("DELETE FROM _dms_vf")
    conn.executemany("INSERT OR IGNORE INTO _dms_vd(id) VALUES (?)", [(int(i),) for i in ctx.shared_docs])
    conn.executemany("INSERT OR IGNORE INTO _dms_vf(id) VALUES (?)", [(int(i),) for i in ctx.shared_folders])
    parts = ["cv.user_id = :uid", "cv.id IN (SELECT id FROM _dms_vd)", "cv.folder_id IN (SELECT id FROM _dms_vf)"]
    if _has_matter_tables(conn):
        parts.append(
            "cv.case_id IN (SELECT 'matter:' || m.id FROM matters m WHERE m.owner_user_id = :uid OR m.team_id IN "
            "(SELECT team_id FROM team_memberships WHERE user_id = :uid) OR m.team_id IN (SELECT id FROM teams WHERE owner_user_id = :uid))")
    if _has_lpms_tables(conn):
        parts.append(
            "cv.case_id IN (SELECT 'lpms:' || c.id FROM lpms_cases c JOIN lpms_members me ON me.firm_id = c.firm_id AND me.user_id = :uid AND me.active = 1 "
            "WHERE c.restricted = 0 OR me.role = 'senior' OR c.advocate_id = me.id)")
    return "(" + " OR ".join(parts) + ")"


def matter_ids_for(conn, uid):
    """Matters this user can work in: [(id, title, status, team_name, role)]"""
    if not _has_matter_tables(conn):
        return []
    rows = conn.execute(
        "SELECT m.id, m.title, m.status, t.name AS team_name, "
        "CASE WHEN m.owner_user_id = :u OR t.owner_user_id = :u THEN 'owner' ELSE 'member' END AS role "
        "FROM matters m LEFT JOIN teams t ON t.id = m.team_id "
        "WHERE m.owner_user_id = :u OR t.owner_user_id = :u OR m.team_id IN (SELECT team_id FROM team_memberships WHERE user_id = :u) "
        "ORDER BY m.created_at DESC", {"u": int(uid)}).fetchall()
    return [dict(r) for r in rows]


def matter_role_map(conn, uid):
    """{'matter:12': 'owner'|'member'} for every matter this user works in."""
    return {f"matter:{m['id']}": m["role"] for m in matter_ids_for(conn, uid)}


def access_level(conn, ctx, doc_row, matter_roles=None):
    """'own' | 'edit' | 'view' | None for one document row (needs id, user_id, case_id, folder_id).
    A matter's owner and its team's owner get 'own' (the senior advocate); other team members 'edit'."""
    if doc_row["user_id"] is not None and int(doc_row["user_id"]) == ctx.uid:
        return "own"
    cid = doc_row["case_id"] or ""
    if cid.startswith("lpms:"):
        cache = ctx.__dict__.setdefault("_lpms_roles", {})
        if cid not in cache:
            try:
                cache[cid] = lpms_case_role(conn, ctx.uid, int(cid.split(":", 1)[1]))
            except ValueError:
                cache[cid] = None
        if cache[cid]:
            return "own" if cache[cid] == "senior" else "edit"
    if matter_roles is not None and cid in matter_roles:
        return "own" if matter_roles[cid] == "owner" else "edit"
    if matter_roles is None and cid.startswith("matter:") and _has_matter_tables(conn):
        try:
            mid = int(cid.split(":", 1)[1])
        except ValueError:
            mid = None
        if mid is not None:
            r = conn.execute(
                "SELECT m.owner_user_id AS mo, t.owner_user_id AS `to`, "
                "EXISTS(SELECT 1 FROM team_memberships tm WHERE tm.team_id = m.team_id AND tm.user_id = ?) AS member "
                "FROM matters m LEFT JOIN teams t ON t.id = m.team_id WHERE m.id = ?", (ctx.uid, mid)).fetchone()
            if r:
                if r["mo"] == ctx.uid or r["to"] == ctx.uid:
                    return "own"
                if r["member"]:
                    return "edit"
    perm = ctx.share_perm(doc_row["id"] if "id" in doc_row.keys() else doc_row["doc_id"])
    if perm in ("view", "edit"):
        return perm
    if doc_row["folder_id"] is not None and doc_row["folder_id"] in ctx.shared_folders:
        return "view"
    return None


# ── filters ──────────────────────────────────────────────────────────────────────────
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

SORTS = {
    "newest":   "d.created_at DESC, d.doc_id DESC",
    "oldest":   "d.created_at ASC, d.doc_id ASC",
    "doc_date": "(d.doc_date IS NULL), d.doc_date DESC, d.doc_id DESC",
    "doc_date_asc": "(d.doc_date IS NULL), d.doc_date ASC, d.doc_id ASC",
    "name":     "LOWER(COALESCE(cv.smart_title, cv.title, '')) ASC, d.doc_id ASC",
    "size":     "d.size DESC, d.doc_id DESC",
    "pages":    "d.page_count DESC, d.doc_id DESC",
    "hearing":  "(d.next_hearing IS NULL), d.next_hearing ASC, d.doc_id ASC",
}


def _clean_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def build_filters(f, params):
    """-> (base_sql, facet_sql): every filter, split into "scope" filters (folder, dates, matter, file kind, ...) and the
    type / status / review filters. Both narrow the result list; the sidebar counts are worked out separately
    (see _FACET_DROPS) so each one ignores only its own dimension."""
    base, facet = [], []
    trash = bool(f.get("trash"))
    base.append("d.deleted_at IS NOT NULL" if trash else "d.deleted_at IS NULL")
    if not f.get("include_versions") and not trash:
        base.append("d.is_current = 1")
    fid = f.get("folder_id")
    if fid in ("none", "root", "unfiled"):
        base.append("cv.folder_id IS NULL")
    elif _clean_int(fid) is not None:
        params["folder_id"] = _clean_int(fid)
        if f.get("subfolders"):          # a folder "contains" everything nested under it, like the Case Vault tree's own counts
            base.append("cv.folder_id IN (WITH RECURSIVE t(id) AS (SELECT :folder_id UNION ALL "
                        "SELECT vf.id FROM vault_folders vf JOIN t ON vf.parent_id = t.id) SELECT id FROM t)")
        else:
            base.append("cv.folder_id = :folder_id")
    mid = f.get("matter_id")
    if mid in ("none", "unlinked"):
        base.append("(cv.case_id IS NULL OR cv.case_id NOT LIKE 'matter:%')")
    elif _clean_int(mid) is not None:
        base.append("cv.case_id = :matter_case")
        params["matter_case"] = f"matter:{_clean_int(mid)}"
    lpid = _clean_int(f.get("lpms_case_id"))
    if lpid is not None:
        base.append("cv.case_id = :lpms_case")
        params["lpms_case"] = f"lpms:{lpid}"
    for key, col, op in (("date_from", "d.doc_date", ">="), ("date_to", "d.doc_date", "<="),
                         ("added_from", "date(d.created_at)", ">="), ("added_to", "date(d.created_at)", "<=")):
        v = f.get(key)
        if isinstance(v, str) and _DATE_RE.match(v):
            base.append(f"{col} {op} :{key}")
            params[key] = v
    if _clean_int(f.get("uploader")) is not None:
        base.append("d.uploaded_by = :uploader")
        params["uploader"] = _clean_int(f.get("uploader"))
    if f.get("batch_id"):
        base.append("d.batch_id = :batch_id")
        params["batch_id"] = str(f["batch_id"])[:64]
    if f.get("kind"):
        base.append("d.kind = :kind")
        params["kind"] = str(f["kind"])[:16]
    if f.get("case"):
        tok = C.case_token(str(f["case"]))
        base.append("REPLACE(REPLACE(REPLACE(LOWER(d.case_keys), ' ', ''), '/', ''), '|', ' ') LIKE :case_like")
        params["case_like"] = f"%{tok}%"
    if f.get("legal_hold"):
        base.append("d.legal_hold = 1")
    if f.get("group_id") and _clean_int(f.get("group_id")) is not None:
        base.append("d.group_id = :group_id")
        params["group_id"] = _clean_int(f.get("group_id"))
    cls = f.get("doc_class")
    if cls:
        if cls == "Unclassified":
            facet.append("(d.doc_class IS NULL OR d.doc_class = 'Unclassified')")
        else:
            facet.append("d.doc_class = :doc_class")
            params["doc_class"] = str(cls)[:60]
    st = f.get("status")
    if st:
        sts = [s for s in (st if isinstance(st, (list, tuple)) else str(st).split(",")) if s][:10]
        names = []
        for i, s in enumerate(sts):
            params[f"st{i}"] = str(s)[:24]
            names.append(f":st{i}")
        if names:
            facet.append(f"d.status IN ({','.join(names)})")
    if f.get("needs_review"):
        facet.append("d.review = 'needs_review'")
    if f.get("problems"):
        facet.append("d.status IN ('failed','needs_ocr','ready_partial','empty','unsupported')")
    return base, facet


# ── candidate sets ───────────────────────────────────────────────────────────────────
def _fts_docs(conn, table, expr, params_extra=()):
    """Set of doc ids whose pages / metadata match one FTS expression."""
    try:
        if table == "pages":
            rows = conn.execute(
                "SELECT DISTINCT p.doc_id FROM dms_fts JOIN dms_pages p ON p.rowid = dms_fts.rowid WHERE dms_fts MATCH ?", (expr,))
        else:
            rows = conn.execute("SELECT rowid FROM dms_meta_fts WHERE dms_meta_fts MATCH ?", (expr,))
        return {r[0] for r in rows}
    except sqlite3.OperationalError:
        return set()      # malformed expression can only come from a bug; an empty result is the safe answer


def term_docs(conn, term):
    return _fts_docs(conn, "pages", term.pages) | _fts_docs(conn, "meta", term.meta)


def _or_expr(terms, which):
    parts = [getattr(t, which) for t in terms]
    return " OR ".join(parts) if parts else None


def _temp_ids(conn, name, ids):
    conn.execute(f"CREATE TEMP TABLE IF NOT EXISTS {name}(id INTEGER PRIMARY KEY)")
    conn.execute(f"DELETE FROM {name}")
    conn.executemany(f"INSERT OR IGNORE INTO {name}(id) VALUES (?)", [(int(i),) for i in ids])


# ── main search ──────────────────────────────────────────────────────────────────────
_LIST_COLS = (
    "d.*, cv.title AS cv_title, cv.smart_title AS cv_smart_title, cv.case_id AS cv_case_id, cv.folder_id AS cv_folder_id, "
    "cv.user_id AS cv_user_id, cv.created_at AS cv_created_at"
)


# Each sidebar count answers "how many would I get if I picked this?", so it honours every filter EXCEPT the one on its own
# dimension (picking a type must not zero the other types, picking a folder must not zero the other folders).
_FACET_DROPS = {
    "classes": ("doc_class",),
    "statuses": ("status",),
    "kinds": ("kind",),
    "folders": ("folder_id", "subfolders"),
    "review": ("needs_review",),
    "problems": ("problems",),
}


def _facet_variants(vis, flt, uid):
    out = {}
    for name, drop in _FACET_DROPS.items():
        prm = {"uid": uid}
        base, facet = build_filters({k: v for k, v in flt.items() if k not in drop}, prm)
        out[name] = (" AND ".join([vis] + base + facet), prm)
    return out


def search_docs(conn, ctx, q="", flt=None, sort=None, page=1, per_page=30, want_facets=True):
    """Returns dict(rows=[sqlite rows], total, facets, terms, snippets={doc_id: {page, snippet, pages_hit, score}}).
    Pure read; safe to call concurrently."""
    flt = dict(flt or {})
    params = {"uid": ctx.uid}
    vis = visibility_sql(conn, ctx)
    base, facet = build_filters(flt, params)
    terms, excluded = parse_query(q)
    per_page = max(1, min(int(per_page or 30), 100))
    page = max(1, int(page or 1))
    offset = (page - 1) * per_page
    from_sql = "FROM dms_docs d JOIN case_vault cv ON cv.id = d.doc_id"
    base_where = " AND ".join([vis] + base)
    facet_where = " AND ".join(facet)
    out = {"terms": terms, "snippets": {}, "facets": {}}
    variants = _facet_variants(vis, flt, ctx.uid) if want_facets else None

    if not terms and not excluded:
        where_all = base_where + ((" AND " + facet_where) if facet_where else "")
        out["total"] = conn.execute(f"SELECT COUNT(*) {from_sql} WHERE {where_all}", params).fetchone()[0]
        order = SORTS.get(sort or "newest", SORTS["newest"])
        out["rows"] = conn.execute(
            f"SELECT {_LIST_COLS} {from_sql} WHERE {where_all} ORDER BY {order} LIMIT :lim OFFSET :off",
            {**params, "lim": per_page, "off": offset}).fetchall()
        if want_facets:
            out["facets"] = _facets(conn, from_sql, variants, None)
        return out

    # 1. every term must be somewhere in the document (or its title / case numbers / parties); "-word" removes documents
    matched = None
    for t in terms:
        found = term_docs(conn, t)
        matched = found if matched is None else matched & found
        if not matched:
            break
    gone = set()
    for x in excluded:
        if matched is not None and not matched:
            break
        gone |= term_docs(conn, x)
    if matched is not None:
        matched -= gone
    # 2. narrowed by what the user may see and by the filters
    allowed = {r[0] for r in conn.execute(f"SELECT d.doc_id {from_sql} WHERE {base_where}", params)}
    cand = (allowed & matched) if matched is not None else (allowed - gone)
    _temp_ids(conn, "_dms_cand", cand)
    if want_facets:
        if matched is not None:
            _temp_ids(conn, "_dms_matched", matched)
            extra = "d.doc_id IN (SELECT id FROM _dms_matched)"
        else:
            _temp_ids(conn, "_dms_matched", gone)
            extra = "d.doc_id NOT IN (SELECT id FROM _dms_matched)"
        out["facets"] = _facets(conn, from_sql, variants, extra)
    res_where = "d.doc_id IN (SELECT id FROM _dms_cand)" + ((" AND " + facet_where) if facet_where else "")
    ids = [r[0] for r in conn.execute(f"SELECT d.doc_id {from_sql} WHERE {res_where}", params)]
    out["total"] = len(ids)
    scores = {}
    if terms and ids:
        _temp_ids(conn, "_dms_res", ids)
        scores = _score_docs(conn, terms)
    if (sort in (None, "", "relevance")) and terms:
        ids.sort(key=lambda i: (scores.get(i, {}).get("score", 0.0), -i))
        page_ids = ids[offset:offset + per_page]
        order_index = {d: n for n, d in enumerate(page_ids)}
        rows = []
        if page_ids:
            _temp_ids(conn, "_dms_page", page_ids)
            rows = conn.execute(f"SELECT {_LIST_COLS} {from_sql} WHERE d.doc_id IN (SELECT id FROM _dms_page)").fetchall()
            rows.sort(key=lambda r: order_index[r["doc_id"]])
    else:
        order = SORTS.get(sort or "newest", SORTS["newest"])
        rows = conn.execute(
            f"SELECT {_LIST_COLS} {from_sql} WHERE {res_where} ORDER BY {order} LIMIT :lim OFFSET :off",
            {**params, "lim": per_page, "off": offset}).fetchall()
        _temp_ids(conn, "_dms_page", [r["doc_id"] for r in rows])
    out["rows"] = rows
    if terms and rows:
        out["snippets"] = _snippets(conn, terms, scores, [r["doc_id"] for r in rows])
    return out


def _score_docs(conn, terms):
    """{doc_id: {score, page, pages_hit, prow}} - lower score is better (bm25). Page ranking uses
    an OR of the terms so a page holding more of the words together outranks a page with one."""
    expr = _or_expr(terms, "pages")
    scores = {}
    try:
        for r in conn.execute(
                "SELECT p.doc_id AS doc_id, p.page_no AS page_no, p.rowid AS prow, bm25(dms_fts, 1.0, 6.0) AS s "
                "FROM dms_fts JOIN dms_pages p ON p.rowid = dms_fts.rowid "
                "WHERE dms_fts MATCH ? AND p.doc_id IN (SELECT id FROM _dms_res)", (expr,)):
            cur = scores.get(r["doc_id"])
            if cur is None:
                scores[r["doc_id"]] = {"score": r["s"], "page": r["page_no"], "prow": r["prow"], "pages_hit": 1}
            else:
                cur["pages_hit"] += 1
                if r["s"] < cur["score"]:
                    cur["score"], cur["page"], cur["prow"] = r["s"], r["page_no"], r["prow"]
    except sqlite3.OperationalError:
        pass
    mexpr = _or_expr(terms, "meta")
    try:
        for r in conn.execute(
                "SELECT rowid AS doc_id, bm25(dms_meta_fts, 10.0, 12.0, 6.0, 3.0, 2.0) AS s FROM dms_meta_fts "
                "WHERE dms_meta_fts MATCH ? AND rowid IN (SELECT id FROM _dms_res)", (mexpr,)):
            cur = scores.setdefault(r["doc_id"], {"score": 0.0, "page": None, "prow": None, "pages_hit": 0})
            cur["score"] += 2.0 * r["s"]          # a hit in the title / case number counts double
            cur["meta_hit"] = True
    except sqlite3.OperationalError:
        pass
    return scores


def _snippets(conn, terms, scores, doc_ids):
    expr = _or_expr(terms, "pages")
    out = {}
    for did in doc_ids:
        sc = scores.get(did)
        if not sc:
            continue
        info = {"page": sc.get("page"), "pages_hit": sc.get("pages_hit", 0), "snippet": None, "meta_hit": bool(sc.get("meta_hit"))}
        if sc.get("prow") is not None:
            try:
                r = conn.execute(
                    f"SELECT snippet(dms_fts, 0, '{HL_OPEN}', '{HL_CLOSE}', ' … ', 28) AS sn FROM dms_fts "
                    "WHERE dms_fts MATCH ? AND rowid = ?", (expr, sc["prow"])).fetchone()
                info["snippet"] = r["sn"] if r else None
            except sqlite3.OperationalError:
                pass
        out[did] = info
    return out


def doc_hits(conn, doc_id, q, limit=200):
    """Pages of ONE document that match the query, with snippets - drives the in-document hit list."""
    terms, _ = parse_query(q)
    if not terms:
        return []
    expr = _or_expr(terms, "pages")
    try:
        rows = conn.execute(
            f"SELECT p.page_no AS page_no, snippet(dms_fts, 0, '{HL_OPEN}', '{HL_CLOSE}', ' … ', 30) AS sn "
            "FROM dms_fts JOIN dms_pages p ON p.rowid = dms_fts.rowid "
            "WHERE dms_fts MATCH ? AND p.doc_id = ? ORDER BY p.page_no LIMIT ?", (expr, doc_id, limit)).fetchall()
    except sqlite3.OperationalError:
        return []
    return [{"page": r["page_no"], "snippet": r["sn"]} for r in rows]


def _facets(conn, from_sql, variants, extra):
    """variants[name] = (where_sql, params): the filter set for that count (see _FACET_DROPS). `extra` narrows every count
    to the search matches (or None when there is no search)."""
    def where(name):
        w, prm = variants[name]
        return (w + ((" AND " + extra) if extra else "")), prm

    f = {"classes": {}, "statuses": {}, "folders": {}, "kinds": {}, "review": 0, "problems": 0}
    w, prm = where("classes")
    for r in conn.execute(f"SELECT COALESCE(d.doc_class, 'Unclassified') AS k, COUNT(*) AS n {from_sql} WHERE {w} GROUP BY k", prm):
        f["classes"][r["k"]] = r["n"]
    w, prm = where("statuses")
    for r in conn.execute(f"SELECT d.status AS k, COUNT(*) AS n {from_sql} WHERE {w} GROUP BY k", prm):
        f["statuses"][r["k"]] = r["n"]
    w, prm = where("folders")
    for r in conn.execute(f"SELECT COALESCE(cv.folder_id, 0) AS k, COUNT(*) AS n {from_sql} WHERE {w} GROUP BY k", prm):
        f["folders"][str(r["k"])] = r["n"]
    w, prm = where("kinds")
    for r in conn.execute(f"SELECT d.kind AS k, COUNT(*) AS n {from_sql} WHERE {w} GROUP BY k", prm):
        f["kinds"][r["k"] or "other"] = r["n"]
    w, prm = where("review")
    f["review"] = conn.execute(f"SELECT COUNT(*) {from_sql} WHERE {w} AND d.review = 'needs_review'", prm).fetchone()[0]
    w, prm = where("problems")
    f["problems"] = conn.execute(
        f"SELECT COUNT(*) {from_sql} WHERE {w} AND d.status IN ('failed','needs_ocr','ready_partial','empty','unsupported')", prm).fetchone()[0]
    return f


# ── row -> API shape ─────────────────────────────────────────────────────────────────
def doc_dict(r, level=None, detail=False):
    keys = r.keys()
    meta = _loads(r["meta"], {}) if "meta" in keys else {}
    case_id = r["cv_case_id"] if "cv_case_id" in keys else None
    matter_id, lpms_case_id = None, None
    if case_id and str(case_id).startswith("lpms:"):
        with contextlib.suppress(ValueError):
            lpms_case_id = int(str(case_id).split(":", 1)[1])
    if case_id and str(case_id).startswith("matter:"):
        with contextlib.suppress(ValueError):
            matter_id = int(str(case_id).split(":", 1)[1])
    title = (r["cv_smart_title"] or r["cv_title"] or r["original_name"] or f"Document {r['doc_id']}")
    d = {
        "id": r["doc_id"], "title": title, "original_name": r["original_name"], "ext": r["ext"], "kind": r["kind"],
        "mime": r["mime"], "size": r["size"], "status": r["status"], "status_note": r["status_note"],
        "warnings": _loads(r["warnings"], []), "page_count": r["page_count"], "page_kind": r["page_kind"],
        "ocr_pages": r["ocr_pages"], "ocr_conf": r["ocr_conf"], "method": r["method"],
        "doc_class": r["doc_class"] or "Unclassified", "class_conf": r["class_conf"], "class_src": r["class_src"],
        "class_evidence": _loads(r["class_evidence"], []), "review": r["review"],
        "folder_id": r["cv_folder_id"], "matter_id": matter_id, "lpms_case_id": lpms_case_id, "tags": _loads(r["tags"], []),
        "doc_date": r["doc_date"], "next_hearing": r["next_hearing"], "parties": r["parties"], "court": r["court"],
        "case_numbers": meta.get("case_numbers") or [], "fir_numbers": meta.get("fir_numbers") or [],
        "created_at": r["created_at"], "updated_at": r["updated_at"], "version": r["version"], "group_id": r["group_id"],
        "is_current": bool(r["is_current"]), "legal_hold": bool(r["legal_hold"]), "deleted_at": r["deleted_at"],
        "uploaded_by": r["uploaded_by"], "batch_id": r["batch_id"], "owner_id": r["cv_user_id"],
        "inline_ok": (r["ext"] or "") in ("pdf", "png", "jpg", "gif", "bmp", "webp"),
        "auto_filed": bool(meta.get("auto_filed")), "suggested_matter": meta.get("suggested_matter"),
        "pii": meta.get("pii") or [], "scripts": meta.get("scripts") or [],
        "level": level,
    }
    if detail:
        d["case_mentions"] = meta.get("case_mentions") or []
        d["cnr"] = meta.get("cnr") or []
        d["sha256"] = r["sha256"]
        d["rel_path"] = r["rel_path"]
        d["version_note"] = r["version_note"]
        d["alternatives"] = meta.get("alternatives") or []
    return d
