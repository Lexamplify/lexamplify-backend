"""
utils/lpms_store.py - the data layer of the Practice module (Legal Practice Management).

Everything here is plain functions over a sqlite3 connection, so the routes stay thin and the rules can be
tested without a web server:

  * the schema (all tables are prefixed lpms_ and live next to the Case Vault in lex_assistant.db)
  * dates in India time, case-number normalisation, JSON helpers
  * the tamper-evident audit log (a hash chain per firm) and the case timeline
  * in-app notifications + an e-mail outbox, and the reminder engine (7 / 3 / 1 / 0 days, de-duplicated)
  * real TOTP (RFC 6238) for two-step sign-in, with recovery codes and a lock-out after repeated misses
  * the IP allow-list check, and the hooks the login route and the Document Hub call

Nothing in here talks to a paid service. E-mail goes through utils.mailer (or whatever sender is injected),
WhatsApp is a wa.me link built for a person to press, and TOTP is done with hmac/hashlib only.
"""
import base64
import contextlib
import hashlib
import hmac
import ipaddress
import json
import os
import re
import secrets
import sqlite3
import struct
import threading
import time
import unicodedata
from datetime import date, datetime, timedelta, timezone

try:
    from utils.dms_index import connect as _connect
except ImportError:  # pragma: no cover
    from dms_index import connect as _connect

# ── vocabulary ───────────────────────────────────────────────────────────────────────
ROLES = ("senior", "junior", "staff")
ROLE_LABEL = {"senior": "Senior Advocate", "junior": "Junior Advocate", "staff": "Office Staff"}
CASE_TYPES = ["Civil", "Criminal", "MCOP", "RTI", "Family", "Corporate", "Consumer", "Other"]
STATUSES = ["Active", "Awaiting Orders", "Stayed", "Disposed", "Withdrawn", "Settled"]
CLOSED_STATUSES = ("Disposed", "Withdrawn", "Settled")
PRIORITIES = ["low", "normal", "high", "urgent"]
HEARING_STATUSES = ["scheduled", "heard", "adjourned", "cancelled"]
OUTCOMES = ["heard", "adjourned", "reserved", "disposed", "other"]
PARTY_ROLES = ["petitioner", "respondent", "opposing_counsel", "witness", "other"]
COMM_CHANNELS = ["email", "whatsapp", "call", "meeting", "note"]
COMM_PREFS = ["whatsapp", "email", "phone", "in_person"]
RTI_STATUSES = ["draft", "filed", "replied", "partial", "rejected", "appeal1", "appeal2", "closed"]
EVENT_KINDS = ["meeting", "appointment", "deadline", "holiday"]
ID_TYPES = ["Aadhaar", "PAN", "Voter ID", "Passport", "Driving Licence", "Other"]
LIMITED_CASE_FIELDS = ("status", "next_action", "next_action_due", "remarks", "hall_no", "judge")

DEFAULT_SETTINGS = {
    "reminder_days": [7, 3, 1, 0],
    "channels": {"inapp": True, "email": True, "whatsapp": True},
    "triggers": {"hearing": True, "case_update": True, "document": True, "assignment": True, "deadline": True, "pending": True},
    "recipients": "advocate_and_seniors",
    "client_email_reminders": False,
    "junior_create_cases": False,
    "junior_scope": "assigned",
    "mfa_required": False,
    "ip_enabled": False,
    "ip_allow": [],
    "default_court": "",
}

TZ = timezone(timedelta(minutes=int(os.getenv("LPMS_TZ_OFFSET_MIN", "330"))))   # India Standard Time unless told otherwise


def now_dt():
    return datetime.now(TZ)


def today_ist():
    return now_dt().date()


def now_iso():
    return time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())


def iso(d):
    return d.isoformat() if isinstance(d, (date, datetime)) else d


_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


# 'YYYY-MM-DD', optionally followed by a time ('2026-11-03T10:30', '2026-11-03 10:30:00', with seconds / fraction / Z / +05:30) - nothing else.
_DATE_FULL_RE = re.compile(r"^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?\s?(?:Z|[+-]\d{2}:?\d{2})?)?$")
DATE_MIN_YEAR, DATE_MAX_YEAR = 1900, 2200          # a 9999-12-31 date overflows every "+30 days" calculation downstream


def parse_date(v):
    """'YYYY-MM-DD' (or an ISO date-time, whose time is ignored) -> date, or None for empty. Raises ValueError for anything else."""
    if v in (None, ""):
        return None
    s = str(v).strip()
    if not _DATE_FULL_RE.match(s):
        raise ValueError("bad date")
    d = date.fromisoformat(s[:10])
    if not DATE_MIN_YEAR <= d.year <= DATE_MAX_YEAR:
        raise ValueError("date out of range")
    return d


def norm_key(s):
    """Case numbers are typed a hundred ways: 'WP(C) 1234 / 2023' = 'wpc1234/2023' = 'WPC-1234-2023'.
    ASCII text gives exactly the key it always did; letters and digits of other scripts (Tamil, Hindi ...) are kept too."""
    s = (s or "").lower()
    if s.isascii():
        return re.sub(r"[^0-9a-z]+", "", s)
    s = unicodedata.normalize("NFKC", s).lower()
    return "".join(ch for ch in s if ("0" <= ch <= "9" or "a" <= ch <= "z") or (ord(ch) > 127 and unicodedata.category(ch)[0] in "LNM"))


def case_key(case_no):
    """The de-duplication key stored with a case: norm_key, or - when the number has no letters or digits at all ('///') - a key derived from the
    typed text, so unrelated odd numbers never collide with each other (the same text twice still does)."""
    k = norm_key(case_no)
    if k:
        return k
    raw = re.sub(r"\s+", "", unicodedata.normalize("NFKC", str(case_no or "")).strip().lower())
    return "~" + hashlib.sha1(raw.encode("utf-8")).hexdigest()[:20] if raw else ""


def jloads(s, default=None):
    if s in (None, ""):
        return default
    try:
        return json.loads(s)
    except (TypeError, ValueError):
        return default


def jdump(o):
    return json.dumps(o, sort_keys=True, default=str, ensure_ascii=False)


def rows(c, sql, params=()):
    return [dict(r) for r in c.execute(sql, params).fetchall()]


def one(c, sql, params=()):
    r = c.execute(sql, params).fetchone()
    return dict(r) if r else None


def connect(db_path):
    conn = _connect(db_path)
    conn.execute("PRAGMA foreign_keys=OFF")        # history rows keep pointing at people who later leave; nothing cascades
    return conn


# ── schema ───────────────────────────────────────────────────────────────────────────
DDL = """
CREATE TABLE IF NOT EXISTS lpms_firms (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, owner_user_id INTEGER NOT NULL,
    settings TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lpms_members (
    id INTEGER PRIMARY KEY, firm_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    role TEXT NOT NULL, name TEXT NOT NULL, email TEXT, phone TEXT,
    active INTEGER NOT NULL DEFAULT 1, email_notify INTEGER NOT NULL DEFAULT 1, managed INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER, created_at TEXT NOT NULL, last_seen TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS lpms_members_user_active ON lpms_members(user_id) WHERE active = 1;
CREATE INDEX IF NOT EXISTS lpms_members_firm ON lpms_members(firm_id);

CREATE TABLE IF NOT EXISTS lpms_clients (
    id INTEGER PRIMARY KEY, firm_id INTEGER NOT NULL, name TEXT NOT NULL, phone TEXT, email TEXT, address TEXT,
    id_type TEXT, id_number TEXT, occupation TEXT, comm_pref TEXT, notes TEXT,
    archived INTEGER NOT NULL DEFAULT 0, created_by INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS lpms_clients_firm ON lpms_clients(firm_id, archived);

CREATE TABLE IF NOT EXISTS lpms_cases (
    id INTEGER PRIMARY KEY, firm_id INTEGER NOT NULL, case_no TEXT NOT NULL, case_key TEXT NOT NULL,
    court TEXT NOT NULL, title TEXT NOT NULL, category TEXT, case_type TEXT NOT NULL DEFAULT 'Civil',
    filing_date TEXT, reg_no TEXT, hall_no TEXT, judge TEXT, opposite_party TEXT,
    client_id INTEGER, advocate_id INTEGER, priority TEXT NOT NULL DEFAULT 'normal',
    status TEXT NOT NULL DEFAULT 'Active', next_action TEXT, next_action_due TEXT, remarks TEXT,
    restricted INTEGER NOT NULL DEFAULT 0, outcome TEXT, closed_at TEXT, archived_at TEXT,
    created_by INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS lpms_cases_firm ON lpms_cases(firm_id, archived_at);
CREATE INDEX IF NOT EXISTS lpms_cases_key ON lpms_cases(firm_id, case_key);
CREATE INDEX IF NOT EXISTS lpms_cases_adv ON lpms_cases(firm_id, advocate_id);
CREATE INDEX IF NOT EXISTS lpms_cases_client ON lpms_cases(client_id);

CREATE TABLE IF NOT EXISTS lpms_parties (
    id INTEGER PRIMARY KEY, case_id INTEGER NOT NULL, role TEXT NOT NULL, name TEXT NOT NULL, contact TEXT, notes TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS lpms_parties_case ON lpms_parties(case_id);

CREATE TABLE IF NOT EXISTS lpms_hearings (
    id INTEGER PRIMARY KEY, firm_id INTEGER NOT NULL, case_id INTEGER NOT NULL,
    hearing_date TEXT NOT NULL, hearing_time TEXT, court TEXT, hall_no TEXT, judge TEXT, purpose TEXT,
    serial_no TEXT, advocate_id INTEGER, status TEXT NOT NULL DEFAULT 'scheduled', note TEXT,
    created_by INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS lpms_hearings_date ON lpms_hearings(firm_id, hearing_date);
CREATE INDEX IF NOT EXISTS lpms_hearings_case ON lpms_hearings(case_id, hearing_date);

CREATE TABLE IF NOT EXISTS lpms_proceedings (
    id INTEGER PRIMARY KEY, firm_id INTEGER NOT NULL, case_id INTEGER NOT NULL, hearing_id INTEGER,
    proc_date TEXT NOT NULL, outcome TEXT, notes TEXT, observations TEXT, orders TEXT,
    next_date TEXT, next_purpose TEXT, author_id INTEGER, created_at TEXT NOT NULL, edited_at TEXT
);
CREATE INDEX IF NOT EXISTS lpms_proc_case ON lpms_proceedings(case_id, proc_date);

CREATE TABLE IF NOT EXISTS lpms_timeline (
    id INTEGER PRIMARY KEY, firm_id INTEGER NOT NULL, case_id INTEGER NOT NULL, kind TEXT NOT NULL,
    title TEXT NOT NULL, detail TEXT, actor_id INTEGER, ref_id INTEGER, at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS lpms_timeline_case ON lpms_timeline(case_id, id);

CREATE TABLE IF NOT EXISTS lpms_notes (
    id INTEGER PRIMARY KEY, firm_id INTEGER NOT NULL, case_id INTEGER, client_id INTEGER, author_id INTEGER,
    body TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, edited_at TEXT
);
CREATE INDEX IF NOT EXISTS lpms_notes_case ON lpms_notes(case_id);

CREATE TABLE IF NOT EXISTS lpms_comms (
    id INTEGER PRIMARY KEY, firm_id INTEGER NOT NULL, case_id INTEGER, client_id INTEGER,
    channel TEXT NOT NULL, direction TEXT NOT NULL DEFAULT 'out', subject TEXT, body TEXT,
    status TEXT NOT NULL DEFAULT 'logged', to_addr TEXT, created_by INTEGER, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS lpms_comms_case ON lpms_comms(case_id);
CREATE INDEX IF NOT EXISTS lpms_comms_client ON lpms_comms(client_id);

CREATE TABLE IF NOT EXISTS lpms_followups (
    id INTEGER PRIMARY KEY, firm_id INTEGER NOT NULL, client_id INTEGER, case_id INTEGER, due_date TEXT NOT NULL,
    note TEXT NOT NULL, channel TEXT, assignee_id INTEGER, status TEXT NOT NULL DEFAULT 'open',
    created_by INTEGER, created_at TEXT NOT NULL, done_at TEXT
);
CREATE INDEX IF NOT EXISTS lpms_followups_due ON lpms_followups(firm_id, status, due_date);

CREATE TABLE IF NOT EXISTS lpms_rti (
    id INTEGER PRIMARY KEY, firm_id INTEGER NOT NULL, case_id INTEGER, client_id INTEGER, subject TEXT NOT NULL,
    department TEXT NOT NULL, pio TEXT, reference_no TEXT, filing_date TEXT, mode TEXT, fee TEXT,
    response_due TEXT, response_date TEXT, appeal_due TEXT, appeal1_date TEXT, appeal2_due TEXT, appeal2_date TEXT,
    status TEXT NOT NULL DEFAULT 'draft', outcome TEXT, assignee_id INTEGER, notes TEXT,
    created_by INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS lpms_rti_firm ON lpms_rti(firm_id, status);

CREATE TABLE IF NOT EXISTS lpms_rti_events (
    id INTEGER PRIMARY KEY, rti_id INTEGER NOT NULL, kind TEXT NOT NULL, note TEXT, actor_id INTEGER, at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS lpms_rti_events_rti ON lpms_rti_events(rti_id, id);

CREATE TABLE IF NOT EXISTS lpms_events (
    id INTEGER PRIMARY KEY, firm_id INTEGER NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
    start_date TEXT NOT NULL, end_date TEXT, start_time TEXT, end_time TEXT, location TEXT, notes TEXT,
    case_id INTEGER, client_id INTEGER, member_id INTEGER, created_by INTEGER, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS lpms_events_date ON lpms_events(firm_id, start_date);

CREATE TABLE IF NOT EXISTS lpms_notifications (
    id INTEGER PRIMARY KEY, firm_id INTEGER NOT NULL, user_id INTEGER NOT NULL, kind TEXT NOT NULL,
    title TEXT NOT NULL, body TEXT, link TEXT, case_id INTEGER, dedupe_key TEXT,
    created_at TEXT NOT NULL, read_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS lpms_notif_dedupe ON lpms_notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS lpms_notif_user ON lpms_notifications(user_id, read_at, id);

CREATE TABLE IF NOT EXISTS lpms_outbox (
    id INTEGER PRIMARY KEY, firm_id INTEGER NOT NULL, to_user_id INTEGER, to_name TEXT, to_email TEXT NOT NULL,
    subject TEXT NOT NULL, body TEXT NOT NULL, kind TEXT, dedupe_key TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, error TEXT,
    created_at TEXT NOT NULL, sent_at TEXT
);
CREATE INDEX IF NOT EXISTS lpms_outbox_status ON lpms_outbox(status, id);

CREATE TABLE IF NOT EXISTS lpms_audit (
    id INTEGER PRIMARY KEY, firm_id INTEGER NOT NULL, user_id INTEGER, actor TEXT, action TEXT NOT NULL,
    entity TEXT, entity_id INTEGER, summary TEXT, detail TEXT, ip TEXT, at TEXT NOT NULL,
    prev_hash TEXT NOT NULL, hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS lpms_audit_firm ON lpms_audit(firm_id, id);

CREATE TABLE IF NOT EXISTS lpms_mfa (
    user_id INTEGER PRIMARY KEY, secret TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, last_step INTEGER NOT NULL DEFAULT 0,
    recovery TEXT NOT NULL DEFAULT '[]', failures INTEGER NOT NULL DEFAULT 0, locked_until REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, enabled_at TEXT
);

CREATE TABLE IF NOT EXISTS lpms_reminder_runs (
    firm_id INTEGER PRIMARY KEY, ran_at REAL NOT NULL, summary TEXT
);
"""


def ensure_schema(conn):
    conn.executescript(DDL)
    conn.commit()


# ── firm / member lookups ────────────────────────────────────────────────────────────
def firm_settings(conn, firm_id):
    r = conn.execute("SELECT settings FROM lpms_firms WHERE id = ?", (firm_id,)).fetchone()
    return merge_settings(jloads(r[0], {}) if r else {})


def merge_settings(stored):
    out = json.loads(json.dumps(DEFAULT_SETTINGS))
    for k, v in (stored or {}).items():
        if k in ("channels", "triggers") and isinstance(v, dict):
            out[k].update({kk: bool(vv) for kk, vv in v.items() if kk in out[k]})
        elif k in out:
            out[k] = v
    return out


def member_for_user(conn, user_id):
    return one(conn, "SELECT m.*, f.name AS firm_name FROM lpms_members m JOIN lpms_firms f ON f.id = m.firm_id "
                     "WHERE m.user_id = ? AND m.active = 1", (int(user_id),))


def members_of(conn, firm_id, active_only=True):
    return rows(conn, "SELECT * FROM lpms_members WHERE firm_id = ?" + (" AND active = 1" if active_only else "") +
                " ORDER BY CASE role WHEN 'senior' THEN 0 WHEN 'junior' THEN 1 ELSE 2 END, name COLLATE NOCASE", (firm_id,))


def seniors_of(conn, firm_id):
    return rows(conn, "SELECT * FROM lpms_members WHERE firm_id = ? AND role = 'senior' AND active = 1", (firm_id,))


def lpms_case_role(conn, uid, case_id):
    """The role this user holds in the firm that owns the case - or None when they may not see it
    (not a member, or a restricted case they are not on). Used by the Document Hub for 'lpms:<id>' documents."""
    r = conn.execute(
        "SELECT me.role FROM lpms_cases c JOIN lpms_members me ON me.firm_id = c.firm_id AND me.user_id = ? AND me.active = 1 "
        "WHERE c.id = ? AND (c.restricted = 0 OR me.role = 'senior' OR c.advocate_id = me.id)", (int(uid), int(case_id))).fetchone()
    return r[0] if r else None


def case_visible_sql(member, alias="c"):
    """SQL predicate (and params) for the cases this member may see. Restricted cases: senior advocates and the lead only."""
    p = {"fid": member["firm_id"], "mid": member["id"]}
    if member["role"] == "senior":
        return f"{alias}.firm_id = :fid", p
    return f"({alias}.firm_id = :fid AND ({alias}.restricted = 0 OR {alias}.advocate_id = :mid))", p


# ── permissions ──────────────────────────────────────────────────────────────────────
def permissions(member, settings):
    role = member["role"]
    senior, junior = role == "senior", role == "junior"
    return {
        "role": role,
        "manage_team": senior, "manage_settings": senior, "view_audit": senior, "export_backup": senior,
        "create_case": senior or (junior and bool(settings.get("junior_create_cases"))),
        "archive_case": senior, "assign_case": senior,
        "update_cases": senior or junior,
        "manage_clients": True, "manage_calendar": True, "manage_rti": True, "log_comms": True, "upload_documents": True,
        "write_all_cases": senior or (junior and settings.get("junior_scope") == "all"),
        "reports": REPORT_ACCESS[role],
        "add_holidays": senior,
    }


REPORT_ACCESS = {
    "senior": ["monthly_summary", "advocate_performance", "case_status", "upcoming_hearings", "closed_cases", "client_activity", "cause_list"],
    "junior": ["monthly_summary", "case_status", "upcoming_hearings", "closed_cases", "cause_list"],
    "staff": ["case_status", "upcoming_hearings", "client_activity", "cause_list"],
}


def case_write_level(member, settings, case, conn=None):
    """'full' (senior), 'limited' (junior on their own matter - or any, if the firm allows - or covering one of its hearings), else None."""
    if member["role"] == "senior":
        return "full"
    if member["role"] != "junior":
        return None
    if settings.get("junior_scope") == "all" or case.get("advocate_id") == member["id"]:
        return "limited"
    if conn is not None and conn.execute("SELECT 1 FROM lpms_hearings WHERE case_id = ? AND advocate_id = ? LIMIT 1",
                                         (case["id"], member["id"])).fetchone():
        return "limited"
    return None


# ── audit + timeline ─────────────────────────────────────────────────────────────────
def audit(c, firm_id, user_id, actor, action, entity=None, entity_id=None, summary=None, detail=None, ip=None):
    """One entry on the firm's hash chain. The caller commits - write it in the same transaction as the change."""
    prev = c.execute("SELECT hash FROM lpms_audit WHERE firm_id = ? ORDER BY id DESC LIMIT 1", (firm_id,)).fetchone()
    prev_hash = prev[0] if prev else "0" * 64
    at = now_iso()
    d = jdump(detail) if detail is not None else ""
    summary = (summary or "")[:300]
    payload = "|".join(str(x) for x in (prev_hash, firm_id, user_id, actor, action, entity, entity_id, summary, d, at))
    h = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    c.execute("INSERT INTO lpms_audit (firm_id, user_id, actor, action, entity, entity_id, summary, detail, ip, at, prev_hash, hash) "
              "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", (firm_id, user_id, actor, action, entity, entity_id, summary, d, ip, at, prev_hash, h))


def verify_audit(c, firm_id):
    prev, n = "0" * 64, 0
    for r in c.execute("SELECT * FROM lpms_audit WHERE firm_id = ? ORDER BY id", (firm_id,)):
        payload = "|".join(str(x) for x in (prev, r["firm_id"], r["user_id"], r["actor"], r["action"], r["entity"], r["entity_id"],
                                            r["summary"], r["detail"] or "", r["at"]))
        if r["prev_hash"] != prev or hashlib.sha256(payload.encode("utf-8")).hexdigest() != r["hash"]:
            return {"ok": False, "broken_at": r["id"], "checked": n}
        prev, n = r["hash"], n + 1
    return {"ok": True, "checked": n}


def timeline(c, firm_id, case_id, kind, title, detail=None, actor_id=None, ref_id=None):
    c.execute("INSERT INTO lpms_timeline (firm_id, case_id, kind, title, detail, actor_id, ref_id, at) VALUES (?,?,?,?,?,?,?,?)",
              (firm_id, case_id, kind, title[:300], detail, actor_id, ref_id, now_iso()))
    c.execute("UPDATE lpms_cases SET updated_at = ? WHERE id = ?", (now_iso(), case_id))


# ── notifications + outbox ───────────────────────────────────────────────────────────
def notify(c, firm_id, user_id, kind, title, body=None, link=None, case_id=None, dedupe_key=None, email=False, settings=None):
    """In-app notification for a user; optionally an e-mail through the outbox. Returns True when it was NEW
    (the same dedupe key never produces a second one)."""
    settings = settings or firm_settings(c, firm_id)
    if not settings["channels"].get("inapp", True) and not (email and settings["channels"].get("email", True)):
        return False
    cur = c.execute("INSERT OR IGNORE INTO lpms_notifications (firm_id, user_id, kind, title, body, link, case_id, dedupe_key, created_at) "
                    "VALUES (?,?,?,?,?,?,?,?,?)", (firm_id, user_id, kind, title[:200], (body or "")[:600], link, case_id, dedupe_key, now_iso()))
    if cur.rowcount == 0:
        return False
    if not settings["channels"].get("inapp", True):
        c.execute("DELETE FROM lpms_notifications WHERE id = ?", (cur.lastrowid,))     # e-mail only
    if email and settings["channels"].get("email", True):
        m = one(c, "SELECT * FROM lpms_members WHERE user_id = ? AND firm_id = ? AND active = 1", (user_id, firm_id))
        if m and m["email"] and m["email_notify"]:
            c.execute("INSERT OR IGNORE INTO lpms_outbox (firm_id, to_user_id, to_name, to_email, subject, body, kind, dedupe_key, created_at) "
                      "VALUES (?,?,?,?,?,?,?,?,?)",
                      (firm_id, user_id, m["name"], m["email"], title[:200], (body or title)[:2000], kind,
                       f"n:{user_id}:{dedupe_key or cur.lastrowid}", now_iso()))
    return True


_OUTBOX_LOCK = threading.Lock()


def flush_outbox(db_path, sender, limit=50):
    """Send pending e-mails. sender(to, subject, body) -> bool. Three tries per message; a server with no SMTP settings
    marks them 'skipped' (the in-app notification is still there) rather than retrying forever."""
    if not _OUTBOX_LOCK.acquire(blocking=False):
        return 0
    sent = 0
    try:
        c = connect(db_path)
        try:
            pending = rows(c, "SELECT * FROM lpms_outbox WHERE status = 'pending' ORDER BY id LIMIT ?", (limit,))
            for m in pending:
                try:
                    ok = bool(sender(m["to_email"], m["subject"], m["body"]))
                    err = None if ok else "not delivered"
                except Exception as exc:                # never let one bad address stop the rest
                    ok, err = False, str(exc)[:200]
                attempts = m["attempts"] + 1
                status = "sent" if ok else ("pending" if attempts < 3 else "failed")
                c.execute("UPDATE lpms_outbox SET status = ?, attempts = ?, error = ?, sent_at = ? WHERE id = ?",
                          (status, attempts, err, now_iso() if ok else None, m["id"]))
                sent += 1 if ok else 0
                c.commit()
        finally:
            c.close()
    finally:
        _OUTBOX_LOCK.release()
    return sent


def mark_unconfigured_outbox(db_path):
    c = connect(db_path)
    try:
        c.execute("UPDATE lpms_outbox SET status = 'skipped', error = 'E-mail is not set up on this server' WHERE status = 'pending'")
        c.commit()
    finally:
        c.close()


def _recipients(c, firm_id, case, settings, include_advocate=True, extra_user_ids=()):
    """Who hears about something on a case: the lead advocate, the seniors (by policy), and anyone named explicitly -
    never someone who may not see the case."""
    ids, out = [], []
    if include_advocate and case.get("advocate_id"):
        m = one(c, "SELECT * FROM lpms_members WHERE id = ? AND active = 1", (case["advocate_id"],))
        if m:
            ids.append(m)
    if settings.get("recipients") == "advocate_and_seniors":
        ids.extend(seniors_of(c, firm_id))
    for uid in extra_user_ids:
        m = one(c, "SELECT * FROM lpms_members WHERE user_id = ? AND firm_id = ? AND active = 1", (uid, firm_id))
        if m:
            ids.append(m)
    seen = set()
    for m in ids:
        if m["user_id"] in seen:
            continue
        seen.add(m["user_id"])
        if case.get("restricted") and m["role"] != "senior" and case.get("advocate_id") != m["id"]:
            continue
        out.append(m)
    return out


def notify_case(c, firm_id, case, actor, kind, trigger, title, body, dedupe=None, email=False, extra_user_ids=(), include_advocate=True):
    """Tell the right people about a case event. `actor` (a member dict) is never notified about their own action."""
    st = firm_settings(c, firm_id)
    if not st["triggers"].get(trigger, True):
        return 0
    n = 0
    for m in _recipients(c, firm_id, case, st, include_advocate, extra_user_ids):
        if actor and m["user_id"] == actor["user_id"]:
            continue
        if notify(c, firm_id, m["user_id"], kind, title, body, f"/practice/cases/{case['id']}", case["id"],
                  f"{dedupe}:{m['user_id']}" if dedupe else None, email=email, settings=st):
            n += 1
    return n


# ── reminders (7 / 3 / 1 / 0 days) ───────────────────────────────────────────────────
def _days_phrase(d):
    return "today" if d == 0 else ("tomorrow" if d == 1 else f"in {d} days")


def _offset_for(days_left, days):
    """The smallest configured offset that is still ahead of (or equal to) the days left: with 7/3/1/0 configured, a hearing
    5 days away is in the '7' window, 2 days away in the '3' window. Each window fires once per hearing date."""
    ahead = [x for x in days if x >= days_left]
    return min(ahead) if ahead else None


def run_reminders(c, firm_id, today=None):
    """Create every reminder that is due for one firm. Safe to call as often as you like (and from several processes):
    each reminder carries a de-duplication key. The caller commits. Returns counts."""
    today = today or today_ist()
    st = firm_settings(c, firm_id)
    days = sorted({int(x) for x in st.get("reminder_days") or [] if str(x).lstrip("-").isdigit() and 0 <= int(x) <= 60})
    counts = {"hearings": 0, "deadlines": 0, "pending": 0, "client_emails": 0}
    if not days:
        return counts
    horizon = max(days)
    end = (today + timedelta(days=horizon)).isoformat()
    today_s = today.isoformat()
    firm = one(c, "SELECT name FROM lpms_firms WHERE id = ?", (firm_id,)) or {"name": "your firm"}

    # hearings
    if st["triggers"].get("hearing", True):
        for h in rows(c, "SELECT h.*, c.title, c.case_no, c.court AS case_court, c.advocate_id AS case_advocate, c.restricted, c.client_id, c.id AS cid "
                         "FROM lpms_hearings h JOIN lpms_cases c ON c.id = h.case_id "
                         "WHERE h.firm_id = ? AND h.status = 'scheduled' AND c.archived_at IS NULL AND h.hearing_date BETWEEN ? AND ?",
                      (firm_id, today_s, end)):
            d = (date.fromisoformat(h["hearing_date"]) - today).days
            o = _offset_for(d, days)
            if o is None:
                continue
            case = {"id": h["cid"], "advocate_id": h["advocate_id"] or h["case_advocate"], "restricted": h["restricted"]}
            where = " · ".join(x for x in (h["court"] or h["case_court"], f"Hall {h['hall_no']}" if h["hall_no"] else None, h["hearing_time"]) if x)
            title = f"Hearing {_days_phrase(d)}: {h['title']}"
            body = f"{h['case_no']} is listed {_days_phrase(d)} ({nice_date(h['hearing_date'])})" + (f" — {where}" if where else "") + \
                   (f". Purpose: {h['purpose']}" if h["purpose"] else ".")
            key = f"hearing:{h['id']}:{h['hearing_date']}:{o}"
            counts["hearings"] += notify_case(c, firm_id, case, None, "hearing_reminder", "hearing", title, body, dedupe=key, email=True)
            if st.get("client_email_reminders") and o == 1 and h["client_id"]:
                cl = one(c, "SELECT * FROM lpms_clients WHERE id = ?", (h["client_id"],))
                if cl and cl["email"] and cl["comm_pref"] != "in_person":
                    cur = c.execute("INSERT OR IGNORE INTO lpms_outbox (firm_id, to_name, to_email, subject, body, kind, dedupe_key, created_at) VALUES (?,?,?,?,?,?,?,?)",
                                    (firm_id, cl["name"], cl["email"], f"Reminder: your hearing {_days_phrase(d)}",
                                     client_reminder_text(cl["name"], firm["name"], h["title"], h["case_no"], h["hearing_date"], h["hearing_time"],
                                                          h["court"] or h["case_court"], h["hall_no"]), "client_reminder",
                                     f"chearing:{h['id']}:{h['hearing_date']}", now_iso()))
                    if cur.rowcount:
                        counts["client_emails"] += 1
                        c.execute("INSERT INTO lpms_comms (firm_id, case_id, client_id, channel, direction, subject, body, status, to_addr, created_by, created_at) "
                                  "VALUES (?,?,?,?,?,?,?,?,?,?,?)", (firm_id, h["cid"], cl["id"], "email", "out", "Automatic hearing reminder",
                                                                      f"Hearing on {nice_date(h['hearing_date'])}", "queued", cl["email"], None, now_iso()))

    # case next-action deadlines
    if st["triggers"].get("deadline", True):
        for cs in rows(c, "SELECT * FROM lpms_cases WHERE firm_id = ? AND archived_at IS NULL AND closed_at IS NULL AND next_action IS NOT NULL "
                          "AND next_action != '' AND next_action_due BETWEEN ? AND ?", (firm_id, today_s, end)):
            d = (date.fromisoformat(cs["next_action_due"]) - today).days
            o = _offset_for(d, days)
            if o is None:
                continue
            counts["deadlines"] += notify_case(c, firm_id, cs, None, "deadline", "deadline", f"Action due {_days_phrase(d)}: {cs['title']}",
                                               f"{cs['next_action']} (due {cs['next_action_due']}) — {cs['case_no']}",
                                               dedupe=f"action:{cs['id']}:{cs['next_action_due']}:{o}", email=True)
        # RTI deadlines
        for r in rows(c, "SELECT * FROM lpms_rti WHERE firm_id = ? AND status NOT IN ('closed','draft')", (firm_id,)):
            for field, label, applies in (("response_due", "RTI reply due", r["status"] == "filed"),
                                          ("appeal_due", "First appeal deadline", r["status"] in ("replied", "partial", "rejected")),
                                          ("appeal2_due", "Second appeal deadline", r["status"] == "appeal1")):
                if not applies or not r[field]:
                    continue
                try:
                    d = (date.fromisoformat(r[field]) - today).days
                except ValueError:
                    continue
                if d < 0 or d > horizon:
                    continue
                o = _offset_for(d, days)
                if o is None:
                    continue
                rcase = {"id": r["case_id"] or 0, "advocate_id": r["assignee_id"], "restricted": 0}
                st2 = st
                for m in _recipients(c, firm_id, rcase, st2):
                    if notify(c, firm_id, m["user_id"], "deadline", f"{label} {_days_phrase(d)}: {r['subject']}",
                              f"{r['department']} — {r[field]}", "/practice/rti", r["case_id"], f"rti:{r['id']}:{field}:{r[field]}:{o}:{m['user_id']}",
                              email=True, settings=st2):
                        counts["deadlines"] += 1
        # calendar deadlines / meetings
        for ev in rows(c, "SELECT * FROM lpms_events WHERE firm_id = ? AND kind IN ('deadline','meeting','appointment') AND start_date BETWEEN ? AND ?",
                       (firm_id, today_s, end)):
            d = (date.fromisoformat(ev["start_date"]) - today).days
            use = days if ev["kind"] == "deadline" else [x for x in days if x <= 1] or [0]
            o = _offset_for(d, use)
            if o is None:
                continue
            who = []
            if ev["member_id"]:
                m = one(c, "SELECT * FROM lpms_members WHERE id = ? AND active = 1", (ev["member_id"],))
                who = [m] if m else []
            elif ev["kind"] == "deadline":
                who = seniors_of(c, firm_id)
            for m in who:
                if notify(c, firm_id, m["user_id"], "deadline", f"{ev['kind'].title()} {_days_phrase(d)}: {ev['title']}",
                          f"{ev['start_date']} {ev['start_time'] or ''}".strip(), "/practice/calendar", ev["case_id"],
                          f"event:{ev['id']}:{ev['start_date']}:{o}:{m['user_id']}", email=True, settings=st):
                    counts["deadlines"] += 1
        # client follow-ups due
        for f in rows(c, "SELECT * FROM lpms_followups WHERE firm_id = ? AND status = 'open' AND due_date BETWEEN ? AND ?", (firm_id, today_s, today_s)):
            who = one(c, "SELECT * FROM lpms_members WHERE id = ? AND active = 1", (f["assignee_id"],)) if f["assignee_id"] else None
            for m in ([who] if who else seniors_of(c, firm_id)):
                if notify(c, firm_id, m["user_id"], "deadline", "Client follow-up due today", f["note"], "/practice/clients", f["case_id"],
                          f"followup:{f['id']}:{f['due_date']}:{m['user_id']}", settings=st):
                    counts["deadlines"] += 1

    # a once-a-day nudge about things that were never updated
    if st["triggers"].get("pending", True):
        for m in members_of(c, firm_id):
            if m["role"] == "staff":
                continue
            cnt = pending_counts(c, m, st, today)
            total = cnt["hearings"] + cnt["actions"]
            parts = []
            if cnt["hearings"]:
                parts.append(f"{cnt['hearings']} past hearing{'s' if cnt['hearings'] != 1 else ''} with no record of what happened")
            if cnt["actions"]:
                parts.append(f"{cnt['actions']} overdue action{'s' if cnt['actions'] != 1 else ''}")
            if total and notify(c, firm_id, m["user_id"], "pending", f"{total} item{'s need' if total != 1 else ' needs'} your attention",
                                " · ".join(parts), "/practice",
                                None, f"pending:{today_s}:{m['user_id']}", settings=st):
                counts["pending"] += 1
    c.execute("INSERT INTO lpms_reminder_runs (firm_id, ran_at, summary) VALUES (?,?,?) ON CONFLICT(firm_id) DO UPDATE SET ran_at = excluded.ran_at, summary = excluded.summary",
              (firm_id, time.time(), jdump(counts)))
    return counts


def pending_counts(c, member, settings, today=None):
    """Past hearings still marked 'scheduled' and overdue next-actions - on the matters this member answers for."""
    today_s = (today or today_ist()).isoformat()
    vis, p = case_visible_sql(member, "c")
    mine = "" if member["role"] == "senior" or settings.get("junior_scope") == "all" else \
        " AND (c.advocate_id = :mid OR EXISTS (SELECT 1 FROM lpms_hearings hh WHERE hh.case_id = c.id AND hh.advocate_id = :mid))"
    p = {**p, "today": today_s}
    h = c.execute(f"SELECT COUNT(*) FROM lpms_hearings h JOIN lpms_cases c ON c.id = h.case_id WHERE {vis}{mine} AND c.archived_at IS NULL "
                  f"AND h.status = 'scheduled' AND h.hearing_date < :today", p).fetchone()[0]
    a = c.execute(f"SELECT COUNT(*) FROM lpms_cases c WHERE {vis}{mine} AND c.archived_at IS NULL AND c.closed_at IS NULL "
                  f"AND c.next_action IS NOT NULL AND c.next_action != '' AND c.next_action_due < :today", p).fetchone()[0]
    return {"hearings": h, "actions": a}


def nice_date(iso):
    """2026-09-29 -> 29 Sep 2026 (the text it was given if it is not a date)."""
    try:
        d = date.fromisoformat(str(iso)[:10])
        return f"{d.day} {d.strftime('%b %Y')}"
    except Exception:
        return str(iso)


def nice_time(hhmm):
    """14:30 -> 2:30 pm"""
    try:
        h, m = (int(x) for x in str(hhmm)[:5].split(":"))
        return f"{(h % 12) or 12}:{m:02d} {'am' if h < 12 else 'pm'}"
    except Exception:
        return str(hhmm)


def client_reminder_text(client_name, firm_name, title, case_no, hearing_date, hearing_time, court, hall):
    when = nice_date(hearing_date) + (f" at {nice_time(hearing_time)}" if hearing_time else "")
    where = ", ".join(x for x in (court, f"Hall {hall}" if hall else None) if x)
    return (f"Dear {client_name},\n\nThis is a reminder from {firm_name}: your matter \"{title}\" ({case_no}) is listed on {when}"
            + (f" before {where}" if where else "") + ".\n\nPlease be available, and reach out if you have any questions.\n\nRegards,\n" + firm_name)


def whatsapp_url(phone, text, default_cc=None):
    """wa.me link for a number typed any way. 10-digit Indian numbers get the country code. None if the number is unusable."""
    digits = re.sub(r"\D+", "", phone or "")
    cc = default_cc or os.getenv("LPMS_DEFAULT_CC", "91")
    if digits.startswith("00"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = cc + digits[1:]
    elif len(digits) == 10:
        digits = cc + digits
    if not 8 <= len(digits) <= 15:
        return None
    from urllib.parse import quote
    return f"https://wa.me/{digits}?text={quote(text)}"


# ── TOTP (RFC 6238) ──────────────────────────────────────────────────────────────────
def new_totp_secret():
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _hotp(secret, counter, digits=6):
    key = base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)
    mac = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    off = mac[-1] & 0x0F
    code = (struct.unpack(">I", mac[off:off + 4])[0] & 0x7FFFFFFF) % (10 ** digits)
    return str(code).zfill(digits)


def totp_at(secret, t=None, step=30):
    return _hotp(secret, int((t if t is not None else time.time()) // step))


def totp_check(secret, code, last_step=0, t=None, window=1, step=30):
    """-> the time-step that matched (so it can be remembered and never accepted twice), or None."""
    code = re.sub(r"\s+", "", str(code or ""))
    if not re.fullmatch(r"\d{6}", code):
        return None
    now_step = int((t if t is not None else time.time()) // step)
    for s in range(now_step - window, now_step + window + 1):
        if s > last_step and hmac.compare_digest(_hotp(secret, s), code):
            return s
    return None


def otpauth_uri(secret, account, issuer="LexAmplify"):
    from urllib.parse import quote
    return f"otpauth://totp/{quote(issuer)}:{quote(account)}?secret={secret}&issuer={quote(issuer)}&algorithm=SHA1&digits=6&period=30"


def qr_svg(text):
    """An inline SVG QR code, or None when the optional `segno` package is not installed (the key is shown instead)."""
    try:
        import io
        import segno
        buf = io.BytesIO()
        segno.make(text, error="m").save(buf, kind="svg", scale=5, border=2, xmldecl=False, nl=False, svgns=True)
        return buf.getvalue().decode()
    except Exception:
        return None


def _fernet():
    try:
        from cryptography.fernet import Fernet
    except ImportError:  # pragma: no cover
        return None
    seed = os.getenv("LPMS_SECRET_KEY") or os.getenv("JWT_SECRET_KEY") or "lexamplify-dev-key"
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(("lpms-mfa|" + seed).encode()).digest()))


def seal(secret):
    f = _fernet()
    return "f:" + f.encrypt(secret.encode()).decode() if f else "p:" + secret


def unseal(s):
    if s.startswith("f:"):
        f = _fernet()
        return f.decrypt(s[2:].encode()).decode()
    return s[2:] if s.startswith("p:") else s


def _recovery_hash(code):
    return hashlib.sha256(("lpms-recovery|" + re.sub(r"[^0-9a-z]", "", code.lower())).encode()).hexdigest()


def make_recovery_codes(n=8):
    codes = [f"{secrets.token_hex(2)}-{secrets.token_hex(2)}".upper() for _ in range(n)]
    return codes, [_recovery_hash(x) for x in codes]


MFA_MAX_FAILURES, MFA_LOCK_SECONDS = 5, 300


def mfa_row(c, user_id):
    return one(c, "SELECT * FROM lpms_mfa WHERE user_id = ?", (int(user_id),))


def mfa_enabled(c, user_id):
    r = mfa_row(c, user_id)
    return bool(r and r["enabled"])


def mfa_verify(c, user_id, code, t=None):
    """Check a 6-digit code or a recovery code for a user with MFA on. -> ('ok'|'bad'|'locked', detail). Caller commits."""
    r = mfa_row(c, user_id)
    if not r or not r["enabled"]:
        return "ok", None
    now = t if t is not None else time.time()
    if r["locked_until"] > now:
        return "locked", int(r["locked_until"] - now)
    code = str(code or "").strip()
    step = totp_check(unseal(r["secret"]), code, r["last_step"], t=now)
    if step:
        c.execute("UPDATE lpms_mfa SET last_step = ?, failures = 0, locked_until = 0 WHERE user_id = ?", (step, user_id))
        return "ok", "totp"
    hashes = jloads(r["recovery"], [])
    hh = _recovery_hash(code) if len(re.sub(r"[^0-9a-z]", "", code.lower())) == 8 else None
    if hh and hh in hashes:
        hashes.remove(hh)
        c.execute("UPDATE lpms_mfa SET recovery = ?, failures = 0, locked_until = 0 WHERE user_id = ?", (jdump(hashes), user_id))
        return "ok", "recovery"
    fails = r["failures"] + 1
    if fails >= MFA_MAX_FAILURES:
        c.execute("UPDATE lpms_mfa SET failures = 0, locked_until = ? WHERE user_id = ?", (now + MFA_LOCK_SECONDS, user_id))
        return "locked", MFA_LOCK_SECONDS
    c.execute("UPDATE lpms_mfa SET failures = ? WHERE user_id = ?", (fails, user_id))
    return "bad", MFA_MAX_FAILURES - fails


# ── IP allow-list ────────────────────────────────────────────────────────────────────
def parse_ip_entry(s):
    s = (s or "").strip()
    if not s:
        raise ValueError("empty")
    if "/" in s:
        return ipaddress.ip_network(s, strict=False)
    return ipaddress.ip_network(s + ("/32" if ":" not in s else "/128"), strict=False)


def ip_allowed(ip, allow):
    try:
        addr = ipaddress.ip_address((ip or "").strip())
    except ValueError:
        return False
    if addr.version == 6 and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    for e in allow or []:
        try:
            if addr in parse_ip_entry(e):
                return True
        except ValueError:
            continue
    return False


# ── hooks: sign-in and the Document Hub ──────────────────────────────────────────────
MFA_UNAVAILABLE = {"error": "Two-step sign-in could not be checked. Please contact your administrator.", "code": "MFA_UNAVAILABLE"}


def mfa_probe(db_path, user_id):
    """True when this account has two-step sign-in switched on, False when it has not (or the Practice tables do not exist yet).
    Any other failure raises - the caller must treat 'cannot tell' as 'on'."""
    c = connect(db_path)
    try:
        try:
            r = mfa_row(c, user_id)
        except sqlite3.OperationalError as exc:
            if "no such table" in str(exc):
                return False
            raise
        return bool(r and r["enabled"])
    finally:
        c.close()


def login_gate(db_path, user_id, otp, ip=None):
    """Called by the login route once the password is right. -> None to let the person in, or (payload, http_status) to stop them.
    For an account WITHOUT two-step a problem here never blocks sign-in (the caller decides). For an account WITH two-step, a code that cannot be
    checked (secret will not decrypt, database error) is a refusal, never a free pass."""
    c = connect(db_path)
    enabled = False
    try:
        r = mfa_row(c, user_id)
        if not r or not r["enabled"]:
            return None
        enabled = True
        if not str(otp or "").strip():
            return {"error": "Enter the 6-digit code from your authenticator app.", "code": "MFA_REQUIRED"}, 401
        c.execute("BEGIN IMMEDIATE")
        res, detail = mfa_verify(c, user_id, otp)
        m = member_for_user(c, user_id)
        if m:
            audit(c, m["firm_id"], user_id, m["name"],
                  {"ok": "mfa_ok", "bad": "mfa_failed", "locked": "mfa_locked"}[res], "user", user_id,
                  {"ok": "Two-step code accepted" + (" (recovery code used)" if detail == "recovery" else ""),
                   "bad": "Wrong two-step code", "locked": "Two-step sign-in locked after repeated wrong codes"}[res], ip=ip)
        c.commit()
        if res == "ok":
            return None
        if res == "locked":
            return {"error": f"Too many wrong codes. Try again in {max(1, detail // 60)} minute(s).", "code": "MFA_LOCKED"}, 429
        return {"error": "That code is not right. Check the app and try again.", "code": "MFA_INVALID"}, 401
    except Exception as exc:
        if not enabled:
            raise
        print(f"[login] TWO-STEP CHECK FAILED for user {user_id}: {type(exc).__name__}: {exc} - sign-in refused")
        with contextlib.suppress(Exception):
            c.rollback()
        return dict(MFA_UNAVAILABLE), 401
    finally:
        c.close()


def login_event(db_path, user_id, email, ok, reason=None, ip=None, agent=None):
    """Record a sign-in (or a failed one for a known account) on the firm's audit log."""
    if not user_id:
        return
    c = connect(db_path)
    try:
        m = member_for_user(c, user_id)
        if not m:
            return
        c.execute("BEGIN IMMEDIATE")
        audit(c, m["firm_id"], user_id, m["name"], "login" if ok else "login_failed", "user", user_id,
              "Signed in" if ok else (reason or "Failed sign-in attempt"), {"agent": (agent or "")[:160]}, ip=ip)
        if ok:
            c.execute("UPDATE lpms_members SET last_seen = ? WHERE id = ?", (now_iso(), m["id"]))
        c.commit()
    finally:
        c.close()


def record_document_event(db_path, case_id, doc_id, title, uid, action="upload", detail=None):
    """The Document Hub calls this after a file lands on (or changes in) a Practice case: timeline, audit, and a note to the lead."""
    c = connect(db_path)
    try:
        case = one(c, "SELECT * FROM lpms_cases WHERE id = ?", (int(case_id),))
        m = member_for_user(c, uid)
        if not case or not m or m["firm_id"] != case["firm_id"]:
            return
        c.execute("BEGIN IMMEDIATE")
        verb = {"upload": "Document uploaded", "version": "New version uploaded", "filed": "Document filed"}.get(action, "Document updated")
        timeline(c, case["firm_id"], case["id"], "document", f"{verb}: {title}", None, m["id"], doc_id)
        audit(c, case["firm_id"], uid, m["name"], "document_upload", "case", case["id"], f"{verb}: {title}", {"doc_id": doc_id, **(detail or {})})
        notify_case(c, case["firm_id"], case, m, "document", "document", f"{verb} on {case['title']}",
                    f"{m['name']} added “{title}” to {case['case_no']}.", dedupe=f"doc:{doc_id}:{action}")
        c.commit()
    finally:
        c.close()


# ── scheduler ────────────────────────────────────────────────────────────────────────
class Scheduler:
    """A background thread that sweeps every firm for due reminders and sends the e-mail outbox. Starts only when asked;
    the same sweep also runs on demand (see throttled_sweep) so a sleeping host catches up the moment anyone opens the app."""

    def __init__(self, db_path, sender=None, interval=600, log=None):
        self.db_path, self.sender, self.interval = db_path, sender, interval
        self.log = log or (lambda m: None)
        self._stop = threading.Event()
        self._t = None

    def sweep(self):
        c = connect(self.db_path)
        try:
            total = {}
            for f in rows(c, "SELECT id FROM lpms_firms"):
                c.execute("BEGIN IMMEDIATE")
                try:
                    counts = run_reminders(c, f["id"])
                    c.commit()
                except Exception:
                    c.rollback()
                    raise
                for k, v in counts.items():
                    total[k] = total.get(k, 0) + v
        finally:
            c.close()
        if self.sender:
            flush_outbox(self.db_path, self.sender)
        return total

    def _loop(self):
        time.sleep(20)
        while not self._stop.is_set():
            try:
                self.sweep()
            except Exception as exc:                    # a bad sweep must never kill the thread
                self.log(f"reminder sweep failed: {exc}")
            self._stop.wait(self.interval)

    def start(self):
        if self._t and self._t.is_alive():
            return
        self._t = threading.Thread(target=self._loop, name="lpms-reminders", daemon=True)
        self._t.start()

    def stop(self, timeout=5):
        self._stop.set()
        if self._t:
            self._t.join(timeout)
