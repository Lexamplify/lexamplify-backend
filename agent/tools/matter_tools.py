"""Matters tools — LPMS-backed. The live Matters page reads lpms_cases
(/api/practice/cases), so these tools write to the LPMS tables, mirroring
routes/lpms_cases.py: required fields title+case_no+court (parse_case :51),
case_key stamped like create_case :193, workspace stamped on create, firm
scoping via the user's lpms_members row."""
import re
import sqlite3
from datetime import datetime, timezone

from agent.tools.registry import Tool, register, VERIFIED_SUCCESS, VERIFIED_FAILURE
from agent.tools.practice_tools import _member


def _conn(db_path):
    c = sqlite3.connect(db_path, timeout=15)
    c.row_factory = sqlite3.Row
    return c


def _now():
    return datetime.now(timezone.utc).isoformat()


def _case_key(case_no):
    try:
        from utils.lpms_store import case_key
        return case_key(case_no)
    except Exception:
        return re.sub(r"\W+", "", str(case_no or "")).lower()


def _own_case(c, ctx, case_id):
    m = _member(c, ctx["user_id"])
    row = c.execute("SELECT * FROM lpms_cases WHERE id=? AND firm_id=?", (int(case_id), m["firm_id"])).fetchone()
    if not row:
        raise LookupError(f"matter/case {case_id} not found in your firm")
    if row["workspace_id"] is not None and ctx.get("workspace_id") is not None \
            and int(row["workspace_id"]) != int(ctx["workspace_id"]):
        raise LookupError(f"case {case_id} belongs to a different client workspace")
    return m, row


# ── list (what the Matters page shows) ──────────────────────────────────────

def _list_matters(ctx, inputs):
    with _conn(ctx["db_path"]) as c:
        m = _member(c, ctx["user_id"])
        sql = ("SELECT id, title, case_no, court, status, next_hearing_dateish FROM "
               "(SELECT id, title, case_no, court, status, next_action_due AS next_hearing_dateish, workspace_id "
               "FROM lpms_cases WHERE firm_id=? AND archived_at IS NULL)")
        args = [m["firm_id"]]
        if ctx.get("workspace_id") is not None:
            sql += " WHERE workspace_id=?"
            args.append(ctx["workspace_id"])
        rows = c.execute(sql + " ORDER BY id DESC LIMIT 50", args).fetchall()
    return {"matters": [dict(r) for r in rows], "count": len(rows)}


register(Tool(
    name="list_matters",
    description="List the matters (cases) shown on the Matters page for the current client workspace.",
    required_inputs=[], risk="A",
    run=_list_matters,
    verify=lambda c, i, o: (VERIFIED_SUCCESS, f"lpms_cases query returned {o['count']} rows"),
))


# ── create (lands on the Matters page) ──────────────────────────────────────

def _create_matter(ctx, inputs):
    title = (inputs.get("title") or "").strip()
    case_no = (inputs.get("case_no") or "").strip()
    court = (inputs.get("court") or "").strip()
    with _conn(ctx["db_path"]) as c:
        m = _member(c, ctx["user_id"])
        dup = c.execute("SELECT id FROM lpms_cases WHERE firm_id=? AND case_key=? AND court=? COLLATE NOCASE",
                        (m["firm_id"], _case_key(case_no), court)).fetchone()
        if dup:
            return {"duplicate": True, "case_id": dup["id"], "matter_id": dup["id"],
                    "note": f"A case with number '{case_no}' already exists in {court} (id {dup['id']})."}
        now = _now()
        cur = c.execute(
            "INSERT INTO lpms_cases (firm_id, case_no, case_key, court, title, case_type, priority, status, "
            "restricted, advocate_id, workspace_id, created_by, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (m["firm_id"], case_no, _case_key(case_no), court, title,
             inputs.get("case_type") or "Civil", "normal", "Active", 0,
             m["id"], ctx.get("workspace_id"), m["id"], now, now))
        cid = cur.lastrowid
    return {"case_id": cid, "matter_id": cid, "title": title, "case_no": case_no, "court": court}


def _verify_create(ctx, inputs, output):
    cid = (output or {}).get("case_id")
    if not cid:
        return (VERIFIED_FAILURE, "no case_id returned")
    with _conn(ctx["db_path"]) as c:
        row = c.execute("SELECT id, title, workspace_id FROM lpms_cases WHERE id=?", (cid,)).fetchone()
    if not row:
        return (VERIFIED_FAILURE, f"case {cid} not found after insert")
    want_ws = ctx.get("workspace_id")
    if want_ws is not None and row["workspace_id"] != want_ws:
        return (VERIFIED_FAILURE, f"case {cid} landed in wrong workspace {row['workspace_id']}")
    return (VERIFIED_SUCCESS, f"lpms_cases row id={cid} title='{row['title']}' exists (Matters page will show it)")


register(Tool(
    name="create_matter",
    description="Create a new matter (case) that appears on the Matters page. Requires title, case_no and "
                "court (the workspace context often supplies the court — prefill it when known).",
    required_inputs=["title", "case_no", "court"], optional_inputs=["case_type"], risk="B",
    run=_create_matter, verify=_verify_create,
))


# ── update ──────────────────────────────────────────────────────────────────

_UPDATABLE = ("title", "status", "next_action", "judge", "opposite_party", "remarks")


def _update_matter(ctx, inputs):
    changes = {k: inputs[k] for k in _UPDATABLE if inputs.get(k)}
    if not changes:
        raise ValueError(f"nothing to change — give one of: {', '.join(_UPDATABLE)}")
    with _conn(ctx["db_path"]) as c:
        m, row = _own_case(c, ctx, inputs["matter_id"])
        c.execute(f"UPDATE lpms_cases SET {', '.join(f'{k}=?' for k in changes)}, updated_at=? WHERE id=?",
                  (*changes.values(), _now(), row["id"]))
    return {"case_id": row["id"], "matter_id": row["id"], "updated": changes}


def _verify_update(ctx, inputs, output):
    cid = (output or {}).get("case_id")
    changes = (output or {}).get("updated") or {}
    with _conn(ctx["db_path"]) as c:
        row = c.execute("SELECT * FROM lpms_cases WHERE id=?", (cid,)).fetchone()
    if not row:
        return (VERIFIED_FAILURE, f"case {cid} vanished")
    wrong = [k for k, v in changes.items() if row[k] != v]
    return ((VERIFIED_SUCCESS, f"case {cid} now has {changes}") if not wrong
            else (VERIFIED_FAILURE, f"fields not persisted: {wrong}"))


register(Tool(
    name="update_matter",
    description="Change an existing matter/case (title, status, next_action, judge, opposite_party, remarks). "
                "Requires matter_id.",
    required_inputs=["matter_id"], optional_inputs=list(_UPDATABLE), risk="B",
    run=_update_matter, verify=_verify_update,
))


# ── details ─────────────────────────────────────────────────────────────────

def _q(c, sql, args):
    try:
        return [dict(r) for r in c.execute(sql, args).fetchall()]
    except sqlite3.OperationalError:
        return []


def _details(ctx, inputs):
    with _conn(ctx["db_path"]) as c:
        m, row = _own_case(c, ctx, inputs["matter_id"])
        cid = row["id"]
        return {
            "matter": {k: row[k] for k in ("id", "title", "case_no", "court", "status", "case_type",
                                           "next_action", "next_action_due", "judge", "opposite_party")},
            "hearings": _q(c, "SELECT hearing_date, hearing_time, purpose, status FROM lpms_hearings "
                              "WHERE case_id=? ORDER BY hearing_date DESC LIMIT 10", (cid,)),
            "notes": _q(c, "SELECT body, created_at FROM lpms_notes WHERE case_id=? ORDER BY id DESC LIMIT 10", (cid,)),
        }


register(Tool(
    name="get_matter_details",
    description="Full picture of one matter/case: status, next action, hearings, notes. Requires matter_id.",
    required_inputs=["matter_id"], risk="A",
    run=_details,
    verify=lambda c, i, o: (VERIFIED_SUCCESS, f"case {o['matter']['id']} read with "
                                              f"{len(o['hearings'])} hearings/{len(o['notes'])} notes"),
))


# ── deadline = the case's next action ───────────────────────────────────────

def _set_deadline(ctx, inputs):
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", str(inputs.get("date") or "")):
        raise ValueError("date must be YYYY-MM-DD")
    with _conn(ctx["db_path"]) as c:
        m, row = _own_case(c, ctx, inputs["matter_id"])
        c.execute("UPDATE lpms_cases SET next_action=?, next_action_due=?, updated_at=? WHERE id=?",
                  (inputs["title"], inputs["date"], _now(), row["id"]))
    return {"case_id": row["id"], "next_action": inputs["title"], "next_action_due": inputs["date"]}


def _verify_deadline(ctx, i, out):
    with _conn(ctx["db_path"]) as c:
        row = c.execute("SELECT next_action, next_action_due FROM lpms_cases WHERE id=?",
                        ((out or {}).get("case_id"),)).fetchone()
    ok = row and row["next_action"] == out["next_action"] and row["next_action_due"] == out["next_action_due"]
    return ((VERIFIED_SUCCESS, f"case {out['case_id']} next action '{out['next_action']}' due {out['next_action_due']}")
            if ok else (VERIFIED_FAILURE, "next action not persisted"))


register(Tool(
    name="add_matter_deadline",
    description="Set a matter's next action and its due date (shown on the Matters page). "
                "Requires matter_id, title, date (YYYY-MM-DD).",
    required_inputs=["matter_id", "title", "date"], risk="B",
    run=_set_deadline, verify=_verify_deadline,
))


# ── notes ───────────────────────────────────────────────────────────────────

def _add_note(ctx, inputs):
    with _conn(ctx["db_path"]) as c:
        m, row = _own_case(c, ctx, inputs["matter_id"])
        cur = c.execute("INSERT INTO lpms_notes (firm_id, case_id, author_id, body, created_at) VALUES (?,?,?,?,?)",
                        (m["firm_id"], row["id"], m["id"], inputs["text"], _now()))
        return {"note_id": cur.lastrowid, "case_id": row["id"]}


def _verify_note(ctx, i, out):
    with _conn(ctx["db_path"]) as c:
        row = c.execute("SELECT id FROM lpms_notes WHERE id=?", ((out or {}).get("note_id"),)).fetchone()
    return ((VERIFIED_SUCCESS, f"lpms_notes row id={out['note_id']} exists") if row
            else (VERIFIED_FAILURE, "note not found after insert"))


register(Tool(
    name="add_matter_note",
    description="Add a note to a matter/case. Requires matter_id and text.",
    required_inputs=["matter_id", "text"], risk="B",
    run=_add_note, verify=_verify_note,
))
