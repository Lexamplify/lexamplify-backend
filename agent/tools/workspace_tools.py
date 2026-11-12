"""Workspace information + calendar read/delete tools.
workspace_summary answers "tell me about this client/workspace" from the
same auto-fetch the planner uses, plus live counts."""
import sqlite3

from agent import context
from agent.tools.registry import Tool, register, VERIFIED_SUCCESS, VERIFIED_FAILURE


def _conn(db_path):
    c = sqlite3.connect(db_path, timeout=15)
    c.row_factory = sqlite3.Row
    return c


def _count(c, sql, args):
    try:
        return c.execute(sql, args).fetchone()[0]
    except sqlite3.OperationalError:
        return 0


def _summary(ctx, inputs):
    data = context.fetch(ctx["db_path"], ctx["user_id"], ctx["workspace_id"])
    with _conn(ctx["db_path"]) as c:
        open_matters = _count(c, "SELECT COUNT(*) FROM lpms_cases WHERE workspace_id=? AND status='Active' "
                                 "AND archived_at IS NULL", (ctx["workspace_id"],))
        upcoming = _count(c, "SELECT COUNT(*) FROM calendar_events WHERE workspace_id=? AND event_date>=date('now')",
                          (ctx["workspace_id"],))
        vault_docs = _count(c, "SELECT COUNT(*) FROM case_vault WHERE workspace_id=?", (ctx["workspace_id"],))
    return {"workspace": data["workspace"], "recent_matters": data["matters"],
            "upcoming_events": data["events"],
            "counts": {"open_matters": open_matters, "upcoming_events": upcoming, "vault_documents": vault_docs}}


def _verify_summary(ctx, i, out):
    if out.get("workspace") is None:
        return (VERIFIED_FAILURE, f"workspace {ctx['workspace_id']} not found")
    return (VERIFIED_SUCCESS, f"summary built from workspaces row id={out['workspace']['id']} + live counts")


register(Tool(
    name="workspace_summary",
    description="General information about the current client workspace: client details, court, case type, "
                "parties, open matters, upcoming hearings, vault document count.",
    required_inputs=[], risk="A",
    run=_summary, verify=_verify_summary,
))


def _list_events(ctx, inputs):
    with _conn(ctx["db_path"]) as c:
        rows = c.execute("SELECT id, event_date, event_type, title, location FROM calendar_events "
                         "WHERE workspace_id=? AND event_date>=date('now','-7 day') ORDER BY event_date LIMIT 30",
                         (ctx["workspace_id"],)).fetchall()
    return {"events": [dict(r) for r in rows], "count": len(rows)}


register(Tool(
    name="list_calendar_events",
    description="List this workspace's calendar events (last week onward).",
    required_inputs=[], risk="A",
    run=_list_events,
    verify=lambda c, i, o: (VERIFIED_SUCCESS, f"query returned {o['count']} events"),
))


def _delete_event(ctx, inputs):
    eid = int(inputs["event_id"])
    with _conn(ctx["db_path"]) as c:
        row = c.execute("SELECT id, title FROM calendar_events WHERE id=? AND workspace_id=?",
                        (eid, ctx["workspace_id"])).fetchone()
        if not row:
            raise LookupError(f"event {eid} not found in this workspace")
        c.execute("DELETE FROM calendar_events WHERE id=?", (eid,))
        return {"deleted_event_id": eid, "title": row["title"]}


def _verify_delete(ctx, i, out):
    eid = (out or {}).get("deleted_event_id")
    with _conn(ctx["db_path"]) as c:
        row = c.execute("SELECT id FROM calendar_events WHERE id=?", (eid,)).fetchone()
    return ((VERIFIED_SUCCESS, f"event {eid} no longer in calendar_events") if not row
            else (VERIFIED_FAILURE, f"event {eid} still exists"))


register(Tool(
    name="delete_calendar_event",
    description="Permanently remove a calendar event from this workspace. Requires event_id. "
                "This is consequential and always asks the user for approval.",
    required_inputs=["event_id"], risk="C",
    run=_delete_event, verify=_verify_delete,
))
