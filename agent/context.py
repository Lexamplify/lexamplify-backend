"""Context-aware auto-fetch (the Auto-Draft Studio pattern, generalised).

Before planning, the engine pulls what is already KNOWN about the current
client workspace — name, court, case type, parties, recent matters, upcoming
events — so the planner pre-fills instead of interrogating the lawyer.
Plain SQL against the consolidated DB; silently degrades to less context
when a table is missing (e.g. minimal test DBs).
"""
import sqlite3


def _rows(c, sql, args=()):
    try:
        return c.execute(sql, args).fetchall()
    except sqlite3.OperationalError:
        return []


def fetch(db_path, user_id, workspace_id):
    """Returns {"note": str, "workspace": dict|None} — note is injected into
    the planner prompt; workspace holds raw fields for tools to pre-fill."""
    if not workspace_id:
        return {"note": "", "workspace": None}
    out = {"workspace": None, "matters": [], "events": [], "recent_actions": []}
    with sqlite3.connect(db_path, timeout=15) as c:
        c.row_factory = sqlite3.Row
        ws = _rows(c, "SELECT id, name, case_no, court, case_type, parties, client_type "
                      "FROM workspaces WHERE id=?", (workspace_id,))
        if ws:
            out["workspace"] = dict(ws[0])
        out["matters"] = [dict(r) for r in _rows(
            c, "SELECT id, title, status FROM matters WHERE workspace_id=? ORDER BY id DESC LIMIT 5",
            (workspace_id,))]
        out["events"] = [dict(r) for r in _rows(
            c, "SELECT event_date, event_type, title FROM calendar_events "
               "WHERE workspace_id=? AND event_date >= date('now') ORDER BY event_date LIMIT 5",
            (workspace_id,))]
        # Level 3: what the agent itself did recently, so follow-up requests
        # ("change the court", "move that hearing") resolve to the right ids.
        for r in _rows(c, "SELECT instruction, result_json FROM agent_tasks "
                          "WHERE user_id=? AND workspace_id=? AND state='COMPLETED' "
                          "ORDER BY updated_at DESC LIMIT 3", (user_id, workspace_id)):
            try:
                import json as _json
                res = _json.loads(r["result_json"] or "{}")
                ids = []
                for out_step in (res.get("steps") or {}).values():
                    for key in ("matter_id", "event_id"):
                        if isinstance(out_step, dict) and out_step.get(key):
                            ids.append(f"{key}={out_step[key]}")
                out["recent_actions"].append(
                    {"instruction": r["instruction"], "ids": ids})
            except Exception:
                pass

    lines = []
    w = out["workspace"]
    if w:
        bits = [f"client workspace: {w['name']}"]
        if w.get("court"):
            bits.append(f"court: {w['court']}")
        if w.get("case_type"):
            bits.append(f"case type: {w['case_type']}")
        if w.get("case_no"):
            bits.append(f"case no: {w['case_no']}")
        lines.append("Known context — " + "; ".join(bits) + ".")
        if w.get("parties"):
            lines.append(f"Known parties (JSON): {w['parties']}")
    if out["matters"]:
        lines.append("Recent matters: " + "; ".join(f"#{m['id']} {m['title']} ({m['status']})" for m in out["matters"]))
    if out["events"]:
        lines.append("Upcoming events: " + "; ".join(f"{e['event_date']} {e['title']}" for e in out["events"]))
    if out["recent_actions"]:
        lines.append("Recent agent actions (use these ids for follow-up changes): " + "; ".join(
            f"“{a['instruction'][:60]}” → {', '.join(a['ids']) or 'no records'}"
            for a in out["recent_actions"]))
    if lines:
        lines.append("Use this known context to pre-fill tool inputs instead of asking the user; "
                     "only ask for what is truly missing. The user can override any pre-filled value.")
    out["note"] = "\n".join(lines)
    return out
