"""Practice (LPMS) tools: firm overview, team, clients, cases, profile and
chamber settings. Practice is FIRM-scoped (by the user's lpms_members row),
not workspace-scoped — every tool resolves membership first and respects
roles: team/settings management needs role owner or senior
(simplified from lpms perm strings; see build log decision)."""
import sqlite3
from datetime import datetime, timezone

from agent.tools.registry import Tool, register, VERIFIED_SUCCESS, VERIFIED_FAILURE

_MANAGE_ROLES = ("owner", "senior")


def _conn(db_path):
    c = sqlite3.connect(db_path, timeout=15)
    c.row_factory = sqlite3.Row
    return c


def _member(c, user_id):
    try:
        row = c.execute("SELECT * FROM lpms_members WHERE user_id=? AND active=1", (user_id,)).fetchone()
    except sqlite3.OperationalError:
        row = None
    if not row:
        raise LookupError("you are not part of a Practice firm yet — create one on the Practice page first")
    return row


def _now():
    return datetime.now(timezone.utc).isoformat()


# ── firm overview ───────────────────────────────────────────────────────────

def _my_practice(ctx, inputs):
    with _conn(ctx["db_path"]) as c:
        m = _member(c, ctx["user_id"])
        firm = c.execute("SELECT id, name FROM lpms_firms WHERE id=?", (m["firm_id"],)).fetchone()
        members = c.execute("SELECT COUNT(*) FROM lpms_members WHERE firm_id=? AND active=1", (m["firm_id"],)).fetchone()[0]
        try:
            clients = c.execute("SELECT COUNT(*) FROM lpms_clients WHERE firm_id=?", (m["firm_id"],)).fetchone()[0]
        except sqlite3.OperationalError:
            clients = 0
        try:
            cases = c.execute("SELECT COUNT(*) FROM lpms_cases WHERE firm_id=?", (m["firm_id"],)).fetchone()[0]
        except sqlite3.OperationalError:
            cases = 0
    return {"firm": dict(firm) if firm else None, "my_role": m["role"], "members": members,
            "clients": clients, "cases": cases}


register(Tool(
    name="get_my_practice",
    description="Overview of the user's Practice firm: chamber name, their role, team size, client and case counts.",
    required_inputs=[], risk="A",
    run=_my_practice,
    verify=lambda c, i, o: ((VERIFIED_SUCCESS, f"firm row id={o['firm']['id']} read") if o.get("firm")
                            else (VERIFIED_FAILURE, "no firm row")),
))


def _list_members(ctx, inputs):
    with _conn(ctx["db_path"]) as c:
        m = _member(c, ctx["user_id"])
        rows = c.execute("SELECT id, name, email, role, active FROM lpms_members WHERE firm_id=? ORDER BY id",
                         (m["firm_id"],)).fetchall()
    return {"members": [dict(r) for r in rows], "count": len(rows)}


register(Tool(
    name="list_team_members",
    description="List the Practice firm's team members with their roles.",
    required_inputs=[], risk="A",
    run=_list_members,
    verify=lambda c, i, o: (VERIFIED_SUCCESS, f"query returned {o['count']} members"),
))


# ── clients ─────────────────────────────────────────────────────────────────

def _list_clients(ctx, inputs):
    with _conn(ctx["db_path"]) as c:
        m = _member(c, ctx["user_id"])
        try:
            rows = c.execute("SELECT id, name, phone, email FROM lpms_clients WHERE firm_id=? ORDER BY id DESC LIMIT 50",
                             (m["firm_id"],)).fetchall()
        except sqlite3.OperationalError:
            rows = []
    return {"clients": [dict(r) for r in rows], "count": len(rows)}


register(Tool(
    name="list_clients",
    description="List the Practice firm's clients.",
    required_inputs=[], risk="A",
    run=_list_clients,
    verify=lambda c, i, o: (VERIFIED_SUCCESS, f"query returned {o['count']} clients"),
))


def _add_client(ctx, inputs):
    name = (inputs.get("name") or "").strip()
    with _conn(ctx["db_path"]) as c:
        m = _member(c, ctx["user_id"])
        dup = c.execute("SELECT id FROM lpms_clients WHERE firm_id=? AND name=?", (m["firm_id"], name)).fetchone()
        if dup:
            return {"duplicate": True, "client_id": dup["id"],
                    "note": f"Client '{name}' already exists (id {dup['id']})."}
        cur = c.execute("INSERT INTO lpms_clients (firm_id, name, phone, email, created_by, created_at, updated_at) "
                        "VALUES (?,?,?,?,?,?,?)",
                        (m["firm_id"], name, inputs.get("phone"), inputs.get("email"), ctx["user_id"], _now(), _now()))
        return {"client_id": cur.lastrowid, "name": name}


def _verify_client(ctx, i, out):
    cid = (out or {}).get("client_id")
    with _conn(ctx["db_path"]) as c:
        row = c.execute("SELECT id, name FROM lpms_clients WHERE id=?", (cid,)).fetchone()
    return ((VERIFIED_SUCCESS, f"lpms_clients row id={cid} name='{row['name']}' exists") if row
            else (VERIFIED_FAILURE, f"client {cid} not found after insert"))


register(Tool(
    name="add_client",
    description="Add a client to the Practice firm. Requires name; optional phone, email.",
    required_inputs=["name"], optional_inputs=["phone", "email"], risk="B",
    run=_add_client, verify=_verify_client,
))


def _list_cases(ctx, inputs):
    with _conn(ctx["db_path"]) as c:
        m = _member(c, ctx["user_id"])
        try:
            rows = c.execute("SELECT id, title, status, case_no FROM lpms_cases WHERE firm_id=? "
                             "ORDER BY id DESC LIMIT 50", (m["firm_id"],)).fetchall()
            rows = [dict(r) for r in rows]
        except sqlite3.OperationalError:
            rows = []
    return {"cases": rows, "count": len(rows)}


register(Tool(
    name="list_practice_cases",
    description="List the Practice firm's cases.",
    required_inputs=[], risk="A",
    run=_list_cases,
    verify=lambda c, i, o: (VERIFIED_SUCCESS, f"query returned {o['count']} cases"),
))


# ── profile & chamber settings ──────────────────────────────────────────────

def _update_profile(ctx, inputs):
    changes = {k: inputs[k] for k in ("name", "phone") if inputs.get(k)}
    if not changes:
        raise ValueError("nothing to change — give name and/or phone")
    with _conn(ctx["db_path"]) as c:
        m = _member(c, ctx["user_id"])
        c.execute(f"UPDATE lpms_members SET {', '.join(f'{k}=?' for k in changes)} WHERE id=?",
                  (*changes.values(), m["id"]))
    return {"member_id": m["id"], "updated": changes}


def _verify_profile(ctx, i, out):
    with _conn(ctx["db_path"]) as c:
        row = c.execute("SELECT * FROM lpms_members WHERE id=?", ((out or {}).get("member_id"),)).fetchone()
    wrong = [k for k, v in (out or {}).get("updated", {}).items() if not row or row[k] != v]
    return ((VERIFIED_SUCCESS, f"member {out['member_id']} profile now {out['updated']}") if not wrong
            else (VERIFIED_FAILURE, f"fields not persisted: {wrong}"))


register(Tool(
    name="update_my_profile",
    description="Change the user's own Practice profile (name, phone).",
    required_inputs=[], optional_inputs=["name", "phone"], risk="B",
    run=_update_profile, verify=_verify_profile,
))


def _rename_chamber(ctx, inputs):
    new_name = (inputs.get("name") or "").strip()
    if not new_name:
        raise ValueError("name is required")
    with _conn(ctx["db_path"]) as c:
        m = _member(c, ctx["user_id"])
        if m["role"] not in _MANAGE_ROLES:
            raise PermissionError(f"your role '{m['role']}' cannot change firm settings")
        c.execute("UPDATE lpms_firms SET name=? WHERE id=?", (new_name, m["firm_id"]))
    return {"firm_id": m["firm_id"], "name": new_name}


def _verify_chamber(ctx, i, out):
    with _conn(ctx["db_path"]) as c:
        row = c.execute("SELECT name FROM lpms_firms WHERE id=?", ((out or {}).get("firm_id"),)).fetchone()
    return ((VERIFIED_SUCCESS, f"lpms_firms {out['firm_id']} renamed to '{out['name']}'")
            if row and row["name"] == (out or {}).get("name")
            else (VERIFIED_FAILURE, "firm name not persisted"))


register(Tool(
    name="rename_chamber",
    description="Rename the firm/chamber (shown across the app). Owner/senior only; consequential, "
                "always asks for approval. Requires name.",
    required_inputs=["name"], risk="C",
    run=_rename_chamber, verify=_verify_chamber,
))
