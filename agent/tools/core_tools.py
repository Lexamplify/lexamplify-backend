"""Phase 2 core tools: one read (Category A) and one write (Category B).
Both operate strictly inside (user_id, workspace_id) from ctx — a tool can
never reach another workspace's rows.
"""
import sqlite3

from agent.tools.registry import (Tool, register, VERIFIED_SUCCESS, VERIFIED_FAILURE)


def _conn(db_path):
    c = sqlite3.connect(db_path, timeout=15)
    c.row_factory = sqlite3.Row
    return c


# ── list_matters (A: read-only) ────────────────────────────────────────────

def _list_matters(ctx, inputs):
    with _conn(ctx["db_path"]) as c:
        rows = c.execute(
            "SELECT id, title, status, opened_date FROM matters "
            "WHERE workspace_id=? AND owner_user_id=? ORDER BY id DESC LIMIT 50",
            (ctx["workspace_id"], ctx["user_id"])).fetchall()
    return {"matters": [dict(r) for r in rows], "count": len(rows)}


register(Tool(
    name="list_matters",
    description="List the matters (cases) in the current client workspace.",
    required_inputs=[], risk="A",
    run=_list_matters,
    verify=lambda ctx, i, out: (VERIFIED_SUCCESS, f"query returned {out.get('count', 0)} rows"),
))


# ── create_matter (B: reversible create) ───────────────────────────────────

def _create_matter(ctx, inputs):
    title = (inputs.get("title") or "").strip()
    with _conn(ctx["db_path"]) as c:
        dup = c.execute("SELECT id FROM matters WHERE workspace_id=? AND owner_user_id=? AND title=? AND status='open'",
                        (ctx["workspace_id"], ctx["user_id"], title)).fetchone()
        if dup:
            return {"duplicate": True, "matter_id": dup["id"],
                    "note": f"An open matter titled '{title}' already exists (id {dup['id']}); not creating a second one."}
        cur = c.execute(
            "INSERT INTO matters (title, status, team_id, lead_counsel, opened_date, owner_user_id, workspace_id) "
            "VALUES (?, 'open', ?, ?, date('now'), ?, ?)",
            (title, inputs.get("team_id"), inputs.get("lead_counsel"), ctx["user_id"], ctx["workspace_id"]))
        matter_id = cur.lastrowid
    return {"matter_id": matter_id, "title": title}


def _verify_create_matter(ctx, inputs, output):
    mid = (output or {}).get("matter_id")
    if not mid:
        return (VERIFIED_FAILURE, "tool returned no matter_id")
    with _conn(ctx["db_path"]) as c:
        row = c.execute("SELECT id, title, workspace_id FROM matters WHERE id=?", (mid,)).fetchone()
    if not row:
        return (VERIFIED_FAILURE, f"matter {mid} not found in DB after create")
    if row["workspace_id"] != ctx["workspace_id"]:
        return (VERIFIED_FAILURE, f"matter {mid} landed in wrong workspace {row['workspace_id']}")
    return (VERIFIED_SUCCESS, f"matters row id={mid} title='{row['title']}' exists in workspace {row['workspace_id']}")


register(Tool(
    name="create_matter",
    description="Create a new matter (case) in the current client workspace. Requires a title.",
    required_inputs=["title"], optional_inputs=["lead_counsel", "team_id"], risk="B",
    run=_create_matter,
    verify=_verify_create_matter,
))
