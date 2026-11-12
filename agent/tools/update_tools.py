"""Phase 7 (Level 3 recovery) tools: modify things the agent already made.
Post-completion changes become ordinary planned steps against these tools —
the planner sees recent agent actions in context, so "change the title"
resolves to the right record id."""
import sqlite3

from agent.tools.registry import Tool, register, VERIFIED_SUCCESS, VERIFIED_FAILURE


def _conn(db_path):
    c = sqlite3.connect(db_path, timeout=15)
    c.row_factory = sqlite3.Row
    return c

_MATTER_FIELDS = ("title", "status", "lead_counsel")
_EVENT_FIELDS = ("title", "event_date", "event_type", "location", "opposing_counsel")


def _update_matter(ctx, inputs):
    mid = int(inputs.get("matter_id"))
    changes = {k: inputs[k] for k in _MATTER_FIELDS if inputs.get(k)}
    if not changes:
        raise ValueError(f"nothing to change — give one of: {', '.join(_MATTER_FIELDS)}")
    with _conn(ctx["db_path"]) as c:
        row = c.execute("SELECT id FROM matters WHERE id=? AND workspace_id=? AND owner_user_id=?",
                        (mid, ctx["workspace_id"], ctx["user_id"])).fetchone()
        if not row:
            raise LookupError(f"matter {mid} not found in this workspace")
        c.execute(f"UPDATE matters SET {', '.join(f'{k}=?' for k in changes)} WHERE id=?",
                  (*changes.values(), mid))
    return {"matter_id": mid, "updated": changes}


def _verify_update_matter(ctx, inputs, output):
    mid = (output or {}).get("matter_id")
    changes = (output or {}).get("updated") or {}
    with _conn(ctx["db_path"]) as c:
        row = c.execute("SELECT * FROM matters WHERE id=?", (mid,)).fetchone()
    if not row:
        return (VERIFIED_FAILURE, f"matter {mid} vanished")
    wrong = [k for k, v in changes.items() if row[k] != v]
    if wrong:
        return (VERIFIED_FAILURE, f"fields not persisted: {wrong}")
    return (VERIFIED_SUCCESS, f"matter {mid} now has {changes}")


register(Tool(
    name="update_matter",
    description="Change an existing matter in this workspace (title, status, lead_counsel). Requires matter_id.",
    required_inputs=["matter_id"], optional_inputs=list(_MATTER_FIELDS), risk="B",
    run=_update_matter, verify=_verify_update_matter,
))


def _update_event(ctx, inputs):
    eid = int(inputs.get("event_id"))
    changes = {k: inputs[k] for k in _EVENT_FIELDS if inputs.get(k)}
    if not changes:
        raise ValueError(f"nothing to change — give one of: {', '.join(_EVENT_FIELDS)}")
    with _conn(ctx["db_path"]) as c:
        row = c.execute("SELECT id FROM calendar_events WHERE id=? AND workspace_id=?",
                        (eid, ctx["workspace_id"])).fetchone()
        if not row:
            raise LookupError(f"calendar event {eid} not found in this workspace")
        c.execute(f"UPDATE calendar_events SET {', '.join(f'{k}=?' for k in changes)} WHERE id=?",
                  (*changes.values(), eid))
    return {"event_id": eid, "updated": changes}


def _verify_update_event(ctx, inputs, output):
    eid = (output or {}).get("event_id")
    changes = (output or {}).get("updated") or {}
    with _conn(ctx["db_path"]) as c:
        row = c.execute("SELECT * FROM calendar_events WHERE id=?", (eid,)).fetchone()
    if not row:
        return (VERIFIED_FAILURE, f"event {eid} vanished")
    wrong = [k for k, v in changes.items() if row[k] != v]
    if wrong:
        return (VERIFIED_FAILURE, f"fields not persisted: {wrong}")
    return (VERIFIED_SUCCESS, f"event {eid} now has {changes}")


register(Tool(
    name="update_calendar_event",
    description="Change an existing calendar event in this workspace (title, event_date, event_type, "
                "location, opposing_counsel). Requires event_id.",
    required_inputs=["event_id"], optional_inputs=list(_EVENT_FIELDS), risk="B",
    run=_update_event, verify=_verify_update_event,
))
