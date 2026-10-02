"""
utils/dms_paper.py - the register of PHYSICAL files: where is the paper, who has it, when is it due back.

  * Locations form a tree (Room > Almirah 3 > Shelf B). A file has a "home" location and a status:
        in        on its shelf              out       with someone (holder, due date)
        lost      cannot be found           archived  retired from the active register
  * Every change is a line in dms_pfile_moves - who, what, when, from where, to whom - and is never edited afterwards.
  * File numbers (PF-0042) count up per firm; each file also has a random token that goes into its QR label.
  * Functions here assume the caller already holds a write transaction (BEGIN IMMEDIATE) and has checked the person's scope.
"""
import re
import secrets
import sqlite3

try:
    from utils import dms_files as F, dms_index as I, dms_pdftext as T
except ImportError:  # pragma: no cover
    import dms_files as F, dms_index as I, dms_pdftext as T

try:
    import pymupdf as fitz
except ImportError:  # pragma: no cover
    import fitz

MAX_DEPTH = 4
STATUSES = ("in", "out", "lost", "archived")


class PaperError(Exception):
    def __init__(self, message, status=400, **extra):
        super().__init__(message)
        self.message, self.status, self.extra = message, status, extra


# ── locations ────────────────────────────────────────────────────────────────────────
def location_map(conn, scope):
    """{id: {id, parent_id, name, kind, code, notes, archived, path}} - paths like 'Record room › Almirah 3 › Shelf B'."""
    rows = {r["id"]: dict(r) for r in conn.execute("SELECT * FROM dms_locations WHERE scope = ?", (scope,))}
    for r in rows.values():
        path, cur, guard = [], r, 0
        while cur and guard < 12:
            path.insert(0, cur["name"])
            cur = rows.get(cur["parent_id"])
            guard += 1
        r["path"] = " › ".join(path)
    return rows


def _depth(rows, pid):
    d, guard = 0, 0
    while pid and guard < 12:
        d += 1
        pid = (rows.get(pid) or {}).get("parent_id")
        guard += 1
    return d


def _loc_name(name):
    name = F.clip(name, 60)
    if not name:
        raise PaperError("A location needs a name, for example “Almirah 3”.")
    return name


def create_location(conn, scope, uid, name, kind="almirah", parent_id=None, code=None, notes=None):
    name = _loc_name(name)
    if kind not in F.LOCATION_KINDS:
        raise PaperError("Unknown kind of location.")
    rows = location_map(conn, scope)
    if parent_id is not None:
        p = rows.get(parent_id)
        if not p or p["archived"]:
            raise PaperError("That parent location does not exist.", 404)
        if _depth(rows, parent_id) >= MAX_DEPTH:
            raise PaperError(f"Locations can be nested {MAX_DEPTH} levels deep at most (room › almirah › shelf › box).")
    if any(r["parent_id"] == parent_id and r["name"].lower() == name.lower() and not r["archived"] for r in rows.values()):
        raise PaperError(f"“{name}” already exists in that place.", 409)
    cur = conn.execute("INSERT INTO dms_locations (scope, parent_id, name, kind, code, notes, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)",
                       (scope, parent_id, name, kind, F.clip(code, 20) or None, F.clip(notes, 300) or None, uid, F.now_iso()))
    return cur.lastrowid


def update_location(conn, scope, loc_id, fields):
    rows = location_map(conn, scope)
    r = rows.get(loc_id)
    if not r:
        raise PaperError("Location not found.", 404)
    sets, vals = [], []
    if "name" in fields:
        name = _loc_name(fields["name"])
        pid = fields.get("parent_id", r["parent_id"])
        if any(o["id"] != loc_id and o["parent_id"] == pid and o["name"].lower() == name.lower() and not o["archived"] for o in rows.values()):
            raise PaperError(f"“{name}” already exists in that place.", 409)
        sets.append("name = ?"); vals.append(name)
    if "kind" in fields:
        if fields["kind"] not in F.LOCATION_KINDS:
            raise PaperError("Unknown kind of location.")
        sets.append("kind = ?"); vals.append(fields["kind"])
    if "code" in fields:
        sets.append("code = ?"); vals.append(F.clip(fields["code"], 20) or None)
    if "notes" in fields:
        sets.append("notes = ?"); vals.append(F.clip(fields["notes"], 300) or None)
    if "parent_id" in fields and fields["parent_id"] != r["parent_id"]:
        pid = fields["parent_id"]
        if pid is not None:
            if pid not in rows or rows[pid]["archived"]:
                raise PaperError("That parent location does not exist.", 404)
            cur, guard = pid, 0
            while cur and guard < 12:                      # a place cannot sit inside itself
                if cur == loc_id:
                    raise PaperError("A location cannot be moved inside itself.")
                cur = rows[cur]["parent_id"]
                guard += 1
            if _depth(rows, pid) + 1 + _subtree_height(rows, loc_id) > MAX_DEPTH:
                raise PaperError(f"That would nest locations deeper than {MAX_DEPTH} levels.")
        sets.append("parent_id = ?"); vals.append(pid)
    if "archived" in fields:
        sets.append("archived = ?"); vals.append(1 if fields["archived"] else 0)
    if sets:
        conn.execute(f"UPDATE dms_locations SET {', '.join(sets)} WHERE id = ? AND scope = ?", (*vals, loc_id, scope))


def _subtree_height(rows, loc_id):
    kids = [k["id"] for k in rows.values() if k["parent_id"] == loc_id]
    return 0 if not kids else 1 + max(_subtree_height(rows, k) for k in kids)


def delete_location(conn, scope, loc_id):
    rows = location_map(conn, scope)
    if loc_id not in rows:
        raise PaperError("Location not found.", 404)
    if any(r["parent_id"] == loc_id for r in rows.values()):
        raise PaperError("This location has locations inside it. Move or delete those first.", 409)
    n = conn.execute("SELECT COUNT(*) FROM dms_pfiles WHERE location_id = ? AND scope = ?", (loc_id, scope)).fetchone()[0]
    if n:
        raise PaperError(f"{n} paper file{'s are' if n != 1 else ' is'} kept here. Move {'them' if n != 1 else 'it'} first, or retire the location instead.", 409)
    conn.execute("DELETE FROM dms_locations WHERE id = ? AND scope = ?", (loc_id, scope))


def locations_payload(conn, scope):
    rows = location_map(conn, scope)
    counts = {r["location_id"]: r["n"] for r in conn.execute(
        "SELECT location_id, COUNT(*) AS n FROM dms_pfiles WHERE scope = ? AND status IN ('in','out') AND location_id IS NOT NULL GROUP BY location_id", (scope,))}
    out = [{**r, "files": counts.get(r["id"], 0)} for r in rows.values()]
    out.sort(key=lambda r: r["path"].lower())
    return out


# ── files ────────────────────────────────────────────────────────────────────────────
def visible_sql(conn):
    """Predicate over `pf` (dms_pfiles): same scope, and - when it is linked to a case - a case this person may see."""
    parts = ["pf.case_ref IS NULL", "pf.created_by = :uid"]
    if I._has_lpms_tables(conn):
        parts.append("pf.case_ref IN (SELECT 'lpms:' || c.id FROM lpms_cases c " + F._LPMS_ACCESS + ")")
    if I._has_matter_tables(conn):
        parts.append("pf.case_ref IN (SELECT 'matter:' || m.id FROM matters m WHERE m.owner_user_id = :uid OR m.team_id IN "
                     "(SELECT team_id FROM team_memberships WHERE user_id = :uid) OR m.team_id IN (SELECT id FROM teams WHERE owner_user_id = :uid))")
    return "(pf.scope = :scope AND (" + " OR ".join(parts) + "))"


def _today():
    return F.today_iso()


def pfile_dict(r, locs, labels=None):
    today = _today()
    loc = locs.get(r["location_id"]) if r["location_id"] else None
    overdue = r["status"] == "out" and bool(r["due_at"]) and r["due_at"] < today
    days = None
    if r["status"] == "out" and r["due_at"]:
        import datetime
        days = (datetime.date.fromisoformat(r["due_at"]) - datetime.date.fromisoformat(today)).days
    label = (labels or {}).get(r["case_ref"]) if r["case_ref"] else None
    return {
        "id": r["id"], "file_no": r["file_no"], "token": r["token"], "title": r["title"], "kind": r["kind"], "case_ref": r["case_ref"],
        "case_label": label or r["case_label"], "client": r["client"], "location_id": r["location_id"], "location": loc["path"] if loc else None,
        "location_note": r["location_note"], "status": r["status"], "holder": r["holder"], "holder_user_id": r["holder_user_id"],
        "issued_at": r["issued_at"], "due_at": r["due_at"], "overdue": overdue, "days_to_due": days, "pages_est": r["pages_est"],
        "notes": r["notes"], "created_at": r["created_at"], "updated_at": r["updated_at"], "archived_at": r["archived_at"],
    }


def _log(conn, pf_id, action, uid, actor, **kw):
    conn.execute(
        "INSERT INTO dms_pfile_moves (pfile_id, action, actor_id, actor_name, from_holder, to_holder, from_loc, to_loc, due_at, note, at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (pf_id, action, uid, actor, kw.get("from_holder"), kw.get("to_holder"), kw.get("from_loc"), kw.get("to_loc"), kw.get("due_at"),
         F.clip(kw.get("note"), 300) or None, F.now_iso()))


def _check_location(conn, scope, loc_id):
    if loc_id is None:
        return None
    rows = location_map(conn, scope)
    if loc_id not in rows or rows[loc_id]["archived"]:
        raise PaperError("That location does not exist (or has been retired).", 404)
    return rows[loc_id]["path"]


def get_pfile(conn, scope, pf_id, uid):
    """The row, or PaperError 404 - the same answer for 'does not exist' and 'not yours to see'."""
    r = conn.execute(f"SELECT * FROM dms_pfiles pf WHERE pf.id = :id AND {visible_sql(conn)}", {"id": pf_id, "uid": int(uid), "scope": scope}).fetchone()
    if not r:
        raise PaperError("Paper file not found.", 404)
    return r


def create_pfile(conn, scope, uid, actor, f, case_label=None):
    title = F.clip(f.get("title"), 160)
    if not title:
        raise PaperError("Give the file a name, for example “Sharma v. Verma - Vol. 1”.")
    kind = f.get("kind") or "file"
    if kind not in F.PFILE_KINDS:
        raise PaperError("Unknown kind of file.")
    loc_path = _check_location(conn, scope, f.get("location_id"))
    pages = f.get("pages_est")
    if pages not in (None, ""):
        try:
            pages = int(pages)
        except (TypeError, ValueError):
            raise PaperError("Pages must be a number.")
        if not 0 <= pages <= 100000:
            raise PaperError("Pages must be between 0 and 100000.")
    else:
        pages = None
    for _ in range(5):                                  # the (scope, seq) key makes a lost race a retry, never a duplicate number
        seq = (conn.execute("SELECT COALESCE(MAX(seq), 0) FROM dms_pfiles WHERE scope = ?", (scope,)).fetchone()[0] or 0) + 1
        file_no = f"PF-{seq:04d}"
        now = F.now_iso()
        try:
            cur = conn.execute(
                "INSERT INTO dms_pfiles (scope, seq, file_no, token, title, kind, case_ref, case_label, client, location_id, location_note, status, pages_est, notes, "
                "created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?, 'in', ?,?,?,?,?)",
                (scope, seq, file_no, secrets.token_urlsafe(9), title, kind, f.get("case_ref") or None, case_label, F.clip(f.get("client"), 120) or None,
                 f.get("location_id"), F.clip(f.get("location_note"), 120) or None, pages, F.clip(f.get("notes"), 500) or None, uid, now, now))
            break
        except sqlite3.IntegrityError:
            continue
    else:
        raise PaperError("Could not allocate a file number. Please try again.", 503)
    _log(conn, cur.lastrowid, "created", uid, actor, to_loc=loc_path, note=f.get("note"))
    return cur.lastrowid


def edit_pfile(conn, scope, uid, actor, pf_id, f, case_label=None, case_changed=False):
    r = get_pfile(conn, scope, pf_id, uid)
    sets, vals, changed = [], [], []
    if "title" in f:
        t = F.clip(f["title"], 160)
        if not t:
            raise PaperError("A file needs a name.")
        sets.append("title = ?"); vals.append(t); changed.append("name")
    if "kind" in f:
        if f["kind"] not in F.PFILE_KINDS:
            raise PaperError("Unknown kind of file.")
        sets.append("kind = ?"); vals.append(f["kind"]); changed.append("kind")
    for k, n in (("client", 120), ("location_note", 120), ("notes", 500)):
        if k in f:
            sets.append(f"{k} = ?"); vals.append(F.clip(f[k], n) or None); changed.append(k.replace("_", " "))
    if "pages_est" in f:
        v = f["pages_est"]
        if v in (None, ""):
            v = None
        else:
            try:
                v = int(v)
            except (TypeError, ValueError):
                raise PaperError("Pages must be a number.")
            if not 0 <= v <= 100000:
                raise PaperError("Pages must be between 0 and 100000.")
        sets.append("pages_est = ?"); vals.append(v); changed.append("pages")
    if case_changed:
        sets.append("case_ref = ?"); vals.append(f.get("case_ref") or None)
        sets.append("case_label = ?"); vals.append(case_label)
        changed.append("case")
    if "location_id" in f and f["location_id"] != r["location_id"]:
        path = _check_location(conn, scope, f["location_id"])
        old = location_map(conn, scope).get(r["location_id"])
        sets.append("location_id = ?"); vals.append(f["location_id"])
        _log(conn, pf_id, "moved", uid, actor, from_loc=old["path"] if old else None, to_loc=path, note=f.get("note"))
        changed.append("location")
    if sets:
        sets.append("updated_at = ?"); vals.append(F.now_iso())
        conn.execute(f"UPDATE dms_pfiles SET {', '.join(sets)} WHERE id = ?", (*vals, pf_id))
        if set(changed) - {"location"}:
            _log(conn, pf_id, "edited", uid, actor, note=", ".join(sorted(set(changed) - {"location"})))
    return changed


def issue(conn, scope, uid, actor, pf_id, to_name=None, to_user_id=None, due_at=None, note=None, transfer=False):
    r = get_pfile(conn, scope, pf_id, uid)
    if r["status"] == "out" and not transfer:
        raise PaperError(f"This file is already with {r['holder']} (since {r['issued_at'][:10]}). Return it first, or hand it over directly.", 409,
                         code="ALREADY_OUT", holder=r["holder"])
    if r["status"] in ("lost", "archived"):
        raise PaperError("This file is marked " + ("lost" if r["status"] == "lost" else "archived") + ". Mark it found / restore it before issuing it.", 409)
    if r["status"] == "in" and transfer:
        transfer = False
    name = F.clip(to_name, 80)
    holder_uid = None
    if to_user_id:
        members = F.scope_member_names(conn, uid)
        if int(to_user_id) not in members:
            raise PaperError("That person is not in your firm.", 404)
        holder_uid, name = int(to_user_id), members[int(to_user_id)]
    if not name:
        raise PaperError("Say who is taking the file.")
    if due_at:
        if not F.valid_date(due_at):
            raise PaperError("The due date must look like 2026-10-15.")
        if due_at < _today():
            raise PaperError("The due date cannot be in the past.")
    n = conn.execute("UPDATE dms_pfiles SET status = 'out', holder = ?, holder_user_id = ?, issued_at = ?, due_at = ?, updated_at = ? "
                     "WHERE id = ? AND status IN ('in','out')", (name, holder_uid, F.now_iso(), due_at or None, F.now_iso(), pf_id)).rowcount
    if not n:
        raise PaperError("The file changed while you were working. Reload and try again.", 409)
    _log(conn, pf_id, "handed-over" if transfer else "issued", uid, actor, from_holder=r["holder"] if transfer else None, to_holder=name, due_at=due_at, note=note)
    return name


def return_file(conn, scope, uid, actor, pf_id, location_id=None, location_note=None, note=None):
    r = get_pfile(conn, scope, pf_id, uid)
    if r["status"] != "out":
        raise PaperError("This file is not issued to anyone." if r["status"] == "in" else "Mark the file as found first.", 409)
    sets, vals = ["status = 'in'", "holder = NULL", "holder_user_id = NULL", "issued_at = NULL", "due_at = NULL", "updated_at = ?"], [F.now_iso()]
    to_loc = None
    locs = location_map(conn, scope)
    if location_id is not None and location_id != r["location_id"]:
        to_loc = _check_location(conn, scope, location_id)
        sets.append("location_id = ?"); vals.append(location_id)
    if location_note is not None:
        sets.append("location_note = ?"); vals.append(F.clip(location_note, 120) or None)
    n = conn.execute(f"UPDATE dms_pfiles SET {', '.join(sets)} WHERE id = ? AND status = 'out'", (*vals, pf_id)).rowcount
    if not n:
        raise PaperError("The file changed while you were working. Reload and try again.", 409)
    home = locs.get(location_id if location_id is not None else r["location_id"])
    _log(conn, pf_id, "returned", uid, actor, from_holder=r["holder"], to_loc=to_loc or (home["path"] if home else None), note=note)


def move_file(conn, scope, uid, actor, pf_id, location_id, location_note=None, note=None):
    r = get_pfile(conn, scope, pf_id, uid)
    path = _check_location(conn, scope, location_id)
    if location_id is None:
        raise PaperError("Choose where the file is kept now.")
    old = location_map(conn, scope).get(r["location_id"])
    conn.execute("UPDATE dms_pfiles SET location_id = ?, location_note = ?, updated_at = ? WHERE id = ?",
                 (location_id, F.clip(location_note, 120) if location_note is not None else r["location_note"], F.now_iso(), pf_id))
    _log(conn, pf_id, "moved", uid, actor, from_loc=old["path"] if old else None, to_loc=path, note=note)


def set_status(conn, scope, uid, actor, pf_id, action, note=None):
    """lost | found | archive | restore"""
    r = get_pfile(conn, scope, pf_id, uid)
    st = r["status"]
    if action == "lost":
        if st == "lost":
            raise PaperError("Already marked as lost.", 409)
        if st == "archived":
            raise PaperError("An archived file cannot be marked lost.", 409)
        conn.execute("UPDATE dms_pfiles SET status = 'lost', updated_at = ? WHERE id = ?", (F.now_iso(), pf_id))
        _log(conn, pf_id, "lost", uid, actor, from_holder=r["holder"], note=note)
    elif action == "found":
        if st != "lost":
            raise PaperError("This file is not marked as lost.", 409)
        conn.execute("UPDATE dms_pfiles SET status = 'in', holder = NULL, holder_user_id = NULL, issued_at = NULL, due_at = NULL, updated_at = ? WHERE id = ?",
                     (F.now_iso(), pf_id))
        _log(conn, pf_id, "found", uid, actor, note=note)
    elif action == "archive":
        if st == "out":
            raise PaperError(f"This file is with {r['holder']}. Return it before archiving.", 409)
        if st == "lost":
            raise PaperError("Mark the file as found before archiving it.", 409)
        if st == "archived":
            raise PaperError("Already archived.", 409)
        conn.execute("UPDATE dms_pfiles SET status = 'archived', archived_at = ?, updated_at = ? WHERE id = ?", (F.now_iso(), F.now_iso(), pf_id))
        _log(conn, pf_id, "archived", uid, actor, note=note)
    elif action == "restore":
        if st != "archived":
            raise PaperError("This file is not archived.", 409)
        conn.execute("UPDATE dms_pfiles SET status = 'in', archived_at = NULL, updated_at = ? WHERE id = ?", (F.now_iso(), pf_id))
        _log(conn, pf_id, "restored", uid, actor, note=note)
    else:
        raise PaperError("Unknown action.")


def history(conn, pf_id, limit=200):
    return [dict(r) for r in conn.execute("SELECT * FROM dms_pfile_moves WHERE pfile_id = ? ORDER BY id DESC LIMIT ?", (pf_id, limit))]


SORTS = {
    "recent": "pf.updated_at DESC, pf.id DESC",
    "number": "pf.seq ASC",
    "name": "LOWER(pf.title) ASC, pf.id ASC",
    "due": "(pf.due_at IS NULL), pf.due_at ASC, pf.id ASC",
}


def list_pfiles(conn, scope, uid, status=None, q="", location_id=None, case_ref=None, holder=None, overdue=False, page=1, per_page=30, sort="recent"):
    where, args = [visible_sql(conn)], {"uid": int(uid), "scope": scope}
    if status == "active":
        where.append("pf.status IN ('in','out','lost')")
    elif status in STATUSES:
        where.append("pf.status = :status"); args["status"] = status
    if overdue:
        where.append("pf.status = 'out' AND pf.due_at IS NOT NULL AND pf.due_at < :today"); args["today"] = _today()
    if case_ref:
        where.append("pf.case_ref = :case"); args["case"] = case_ref
    if holder:
        where.append("LOWER(pf.holder) = LOWER(:holder)"); args["holder"] = holder
    if location_id:
        rows = location_map(conn, scope)
        ids, stack = set(), [location_id]
        while stack:                                    # a shelf search includes everything inside that shelf
            x = stack.pop()
            if x in ids:
                continue
            ids.add(x)
            stack += [k["id"] for k in rows.values() if k["parent_id"] == x]
        where.append(f"pf.location_id IN ({','.join(str(int(i)) for i in ids)})")
    q = F.clip(q, 80)
    if q:
        for i, w in enumerate(q.split(" ")[:6]):
            key = f"q{i}"
            args[key] = f"%{w.lower().replace('%', '').replace('_', '')}%"
            where.append(f"(LOWER(pf.title) LIKE :{key} OR LOWER(pf.file_no) LIKE :{key} OR LOWER(COALESCE(pf.client,'')) LIKE :{key} OR "
                         f"LOWER(COALESCE(pf.case_label,'')) LIKE :{key} OR LOWER(COALESCE(pf.holder,'')) LIKE :{key} OR LOWER(COALESCE(pf.notes,'')) LIKE :{key} "
                         f"OR LOWER(COALESCE(pf.location_note,'')) LIKE :{key})")
    w = " AND ".join(where)
    total = conn.execute(f"SELECT COUNT(*) FROM dms_pfiles pf WHERE {w}", args).fetchone()[0]
    per_page = max(1, min(int(per_page), 100))
    page = max(1, int(page))
    order = SORTS.get(sort) or SORTS["recent"]
    rows = conn.execute(f"SELECT pf.* FROM dms_pfiles pf WHERE {w} ORDER BY {order} LIMIT :lim OFFSET :off", {**args, "lim": per_page, "off": (page - 1) * per_page}).fetchall()
    return rows, total


def stats(conn, scope, uid):
    base = visible_sql(conn)
    a = {"uid": int(uid), "scope": scope, "today": _today()}
    one = lambda extra: conn.execute(f"SELECT COUNT(*) FROM dms_pfiles pf WHERE {base} AND {extra}", a).fetchone()[0]
    return {
        "in": one("pf.status = 'in'"), "out": one("pf.status = 'out'"), "lost": one("pf.status = 'lost'"), "archived": one("pf.status = 'archived'"),
        "overdue": one("pf.status = 'out' AND pf.due_at IS NOT NULL AND pf.due_at < :today"),
        "due_soon": one("pf.status = 'out' AND pf.due_at IS NOT NULL AND pf.due_at >= :today AND pf.due_at <= date(:today, '+3 day')"),
    }


def holders(conn, scope, uid):
    """[{holder, n, overdue}] - who currently has files."""
    base = visible_sql(conn)
    rows = conn.execute(
        f"SELECT pf.holder AS holder, COUNT(*) AS n, SUM(CASE WHEN pf.due_at IS NOT NULL AND pf.due_at < :today THEN 1 ELSE 0 END) AS overdue "
        f"FROM dms_pfiles pf WHERE {base} AND pf.status = 'out' GROUP BY LOWER(pf.holder) ORDER BY overdue DESC, n DESC",
        {"uid": int(uid), "scope": scope, "today": _today()}).fetchall()
    return [dict(r) for r in rows]


def lookup(conn, scope, uid, code):
    """A file by its number ('PF-0042', 'pf 42', '42') or by the token inside its QR code (or the whole QR address)."""
    code = F.clip(code, 300)
    if not code:
        raise PaperError("Type or scan a file number.")
    m = re.search(r"[?&]pf=([A-Za-z0-9_\-]{6,40})", code)
    cand = m.group(1) if m else code
    a = {"uid": int(uid), "scope": scope}
    base = visible_sql(conn)
    r = conn.execute(f"SELECT pf.* FROM dms_pfiles pf WHERE pf.token = :t AND {base}", {**a, "t": cand}).fetchone()
    if r:
        return r
    n = re.fullmatch(r"(?:pf)?[\s\-_#]*0*(\d{1,7})", cand.strip(), flags=re.I)
    if n:
        r = conn.execute(f"SELECT pf.* FROM dms_pfiles pf WHERE pf.seq = :s AND {base}", {**a, "s": int(n.group(1))}).fetchone()
        if r:
            return r
    raise PaperError("No paper file has that number.", 404)


# ── labels ───────────────────────────────────────────────────────────────────────────
LAYOUTS = {
    # name: (page w mm, page h mm, cols, rows, label w, label h, left margin, top margin, gap x, gap y)
    "a4-24": ("A4, 24 labels (3 × 8, 63.5 × 33.9 mm)", 210, 297, 3, 8, 63.5, 33.9, 7.2, 12.9, 2.5, 0.0),
    "a4-12": ("A4, 12 labels (2 × 6, 99 × 42 mm)", 210, 297, 2, 6, 99.0, 42.3, 4.5, 21.5, 2.5, 0.0),
    "a4-6": ("A4, 6 labels (2 × 3, 99 × 93 mm)", 210, 297, 2, 3, 99.0, 93.1, 4.5, 8.0, 2.5, 0.0),
    "roll": ("Label printer, one label per page (100 × 60 mm)", 100, 60, 1, 1, 100.0, 60.0, 0.0, 0.0, 0.0, 0.0),
}


def labels_pdf(files, locs, base_url, layout="a4-24", cut_marks=False):
    """files: dms_pfiles rows. Returns (pdf_bytes, warnings). Each label: a QR code that opens the file in the Document Hub,
    the big file number, the title, the case and the shelf."""
    if layout not in LAYOUTS:
        raise PaperError("Unknown label layout.")
    _name, pw, ph, cols, rows, lw, lh, ml, mt, gx, gy = LAYOUTS[layout]
    face = T.Face()
    doc = fitz.open()
    per = cols * rows
    mm = T.MM
    base = (base_url or "").rstrip("/")
    for i, r in enumerate(files):
        if i % per == 0:
            page = doc.new_page(width=pw * mm, height=ph * mm)
            names = face.register(page)
        k = i % per
        cx, cy = k % cols, k // cols
        x0, y0 = (ml + cx * (lw + gx)) * mm, (mt + cy * (lh + gy)) * mm
        w, h = lw * mm, lh * mm
        if cut_marks or layout == "roll":
            page.draw_rect(fitz.Rect(x0 + 1, y0 + 1, x0 + w - 1, y0 + h - 1), color=(0.6, 0.6, 0.6), width=0.4, dashes="[2 2] 0")
        pad = 3.2 * mm
        qs = min(h - 2 * pad, 30 * mm if layout != "roll" else 34 * mm)
        url = f"{base}/document-hub?pf={r['token']}" if base else r["token"]
        page.insert_image(fitz.Rect(x0 + pad, y0 + pad, x0 + pad + qs, y0 + pad + qs), stream=T.qr_png(url, scale=8, border=0))
        tx = x0 + pad + qs + 3 * mm
        tw = x0 + w - pad - tx
        big = 15 if layout in ("a4-24",) else 19 if layout != "roll" else 24
        small = 6.8 if layout == "a4-24" else 8 if layout != "roll" else 9.5
        y = y0 + pad + big * 0.85
        face.text(page, names, (tx, y), r["file_no"], big, "bold")
        y += big * 0.55
        body = [(r["title"], "bold", small + 0.8, 3 if layout != "a4-24" else 2)]
        loc = locs.get(r["location_id"]) if r["location_id"] else None
        case = r["case_label"] or r["client"]
        if case:
            body.append((case, "reg", small, 2 if layout != "a4-24" else 1))
        if loc or r["location_note"]:
            where = (loc["path"] if loc else "") + (f" ({r['location_note']})" if (loc and r["location_note"]) else (r["location_note"] or "") if not loc else "")
            body.append((where, "reg", small, 2 if layout != "a4-24" else 1))
        for text, kind, size, mx in body:
            for ln in face.wrap(text, size, tw, kind, max_lines=mx):
                y += size * 1.22
                if y > y0 + h - pad * 0.6:
                    break
                face.text(page, names, (tx, y), ln, size, kind, color=(0.1, 0.1, 0.1) if kind == "bold" else (0.28, 0.28, 0.28))
            y += size * 0.35
    if not len(doc):
        doc.new_page(width=pw * mm, height=ph * mm)
    buf = doc.tobytes(garbage=4, deflate=True)
    doc.close()
    warns = ["Some characters in a title could not be printed with the fonts on this server and were shown as “?”."] if face.lost else []
    return buf, warns


def for_doc(conn, scope, uid, doc_id):
    """The physical original(s) of a document (paper files it is linked to), for its detail panel: [{id, file_no, title, status, holder, due_at, overdue, location}]."""
    rows = conn.execute(
        "SELECT pf.* FROM dms_pfile_docs pd JOIN dms_pfiles pf ON pf.id = pd.pfile_id "
        f"WHERE pd.doc_id = :doc AND {visible_sql(conn)} ORDER BY pf.id LIMIT 10", {"doc": int(doc_id), "uid": int(uid), "scope": scope}).fetchall()
    if not rows:
        return []
    locs = location_map(conn, scope)
    out = []
    for r in rows:
        d = pfile_dict(r, locs)
        out.append({k: d[k] for k in ("id", "file_no", "title", "status", "holder", "due_at", "overdue", "location", "location_note")})
    return out
