"""Matters sub-feature tools: details, deadlines, tasks, notes.
Column lists mirror routes/matter_routes.py exactly (deadlines :477,
tasks_matter :523, handoff_notes :603). Every write is guarded by the
matter belonging to the current workspace."""
import sqlite3

from agent.tools.registry import Tool, register, VERIFIED_SUCCESS, VERIFIED_FAILURE


def _conn(db_path):
    c = sqlite3.connect(db_path, timeout=15)
    c.row_factory = sqlite3.Row
    return c


def _own_matter(c, ctx, matter_id):
    row = c.execute("SELECT id, title FROM matters WHERE id=? AND workspace_id=?",
                    (int(matter_id), ctx["workspace_id"])).fetchone()
    if not row:
        raise LookupError(f"matter {matter_id} not found in this workspace")
    return row


def _q(c, sql, args):
    try:
        return [dict(r) for r in c.execute(sql, args).fetchall()]
    except sqlite3.OperationalError:
        return []


def _details(ctx, inputs):
    with _conn(ctx["db_path"]) as c:
        m = _own_matter(c, ctx, inputs["matter_id"])
        mid = m["id"]
        return {
            "matter": dict(m),
            "deadlines": _q(c, "SELECT id, title, date, description FROM deadlines WHERE matter_id=? ORDER BY date", (mid,)),
            "tasks": _q(c, "SELECT id, title, done FROM tasks_matter WHERE matter_id=?", (mid,)),
            "notes": _q(c, "SELECT id, text, created_at FROM handoff_notes WHERE matter_id=? ORDER BY id DESC LIMIT 10", (mid,)),
        }


register(Tool(
    name="get_matter_details",
    description="Full picture of one matter: its deadlines, tasks and handoff notes. Requires matter_id.",
    required_inputs=["matter_id"], risk="A",
    run=_details,
    verify=lambda c, i, o: (VERIFIED_SUCCESS, f"matter {o['matter']['id']} read with "
                                              f"{len(o['deadlines'])} deadlines/{len(o['tasks'])} tasks/{len(o['notes'])} notes"),
))


def _add_deadline(ctx, inputs):
    import re
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", str(inputs.get("date") or "")):
        raise ValueError("date must be YYYY-MM-DD")
    with _conn(ctx["db_path"]) as c:
        _own_matter(c, ctx, inputs["matter_id"])
        cur = c.execute("INSERT INTO deadlines (matter_id, title, date, description, ai_extracted) VALUES (?,?,?,?,0)",
                        (int(inputs["matter_id"]), inputs["title"], inputs["date"], inputs.get("description")))
        return {"deadline_id": cur.lastrowid, "title": inputs["title"], "date": inputs["date"]}


def _verify_row(table, id_key):
    def v(ctx, i, out):
        rid = (out or {}).get(id_key)
        if not rid:
            return (VERIFIED_FAILURE, f"no {id_key} returned")
        with _conn(ctx["db_path"]) as c:
            row = c.execute(f"SELECT id FROM {table} WHERE id=?", (rid,)).fetchone()
        return ((VERIFIED_SUCCESS, f"{table} row id={rid} exists") if row
                else (VERIFIED_FAILURE, f"{table} row {rid} not found after insert"))
    return v


register(Tool(
    name="add_matter_deadline",
    description="Add a deadline to a matter. Requires matter_id, title, date (YYYY-MM-DD).",
    required_inputs=["matter_id", "title", "date"], optional_inputs=["description"], risk="B",
    run=_add_deadline, verify=_verify_row("deadlines", "deadline_id"),
))


def _add_task(ctx, inputs):
    with _conn(ctx["db_path"]) as c:
        _own_matter(c, ctx, inputs["matter_id"])
        cur = c.execute("INSERT INTO tasks_matter (matter_id, title) VALUES (?,?)",
                        (int(inputs["matter_id"]), inputs["title"]))
        return {"task_id": cur.lastrowid, "title": inputs["title"]}


register(Tool(
    name="add_matter_task",
    description="Add a to-do task to a matter. Requires matter_id and title.",
    required_inputs=["matter_id", "title"], risk="B",
    run=_add_task, verify=_verify_row("tasks_matter", "task_id"),
))


def _add_note(ctx, inputs):
    with _conn(ctx["db_path"]) as c:
        _own_matter(c, ctx, inputs["matter_id"])
        cur = c.execute("INSERT INTO handoff_notes (matter_id, author_user_id, text) VALUES (?,?,?)",
                        (int(inputs["matter_id"]), ctx["user_id"], inputs["text"]))
        return {"note_id": cur.lastrowid}


register(Tool(
    name="add_matter_note",
    description="Add a handoff note to a matter. Requires matter_id and text.",
    required_inputs=["matter_id", "text"], risk="B",
    run=_add_note, verify=_verify_row("handoff_notes", "note_id"),
))
