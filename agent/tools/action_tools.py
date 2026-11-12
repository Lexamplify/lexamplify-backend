"""Phase 3 action modules: calendar events, conflict check, vault search,
and smart navigation. Same contract as core_tools — ctx-scoped, verified.
"""
import json
import re
import sqlite3

from agent.tools.registry import (Tool, register, VERIFIED_SUCCESS, VERIFIED_FAILURE,
                                  PARTIALLY_VERIFIED)


def _conn(db_path):
    c = sqlite3.connect(db_path, timeout=15)
    c.row_factory = sqlite3.Row
    return c


# ── create_calendar_event (B) ───────────────────────────────────────────────

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _create_event(ctx, inputs):
    date = (inputs.get("event_date") or "").strip()
    if not _DATE_RE.match(date):
        raise ValueError(f"event_date must be YYYY-MM-DD, got '{date}'")
    title = (inputs.get("title") or "").strip()
    with _conn(ctx["db_path"]) as c:
        dup = c.execute("SELECT id FROM calendar_events WHERE workspace_id=? AND event_date=? AND title=?",
                        (ctx["workspace_id"], date, title)).fetchone()
        if dup:
            return {"duplicate": True, "event_id": dup["id"],
                    "note": f"'{title}' on {date} already exists (id {dup['id']})."}
        cur = c.execute(
            "INSERT INTO calendar_events (event_date, event_type, title, related_case_id, location, "
            "opposing_counsel, google_event_id, owner_user_id, workspace_id) VALUES (?,?,?,?,?,?,?,?,?)",
            (date, inputs.get("event_type") or "hearing", title, inputs.get("related_case_id"),
             inputs.get("location"), inputs.get("opposing_counsel"), None, ctx["user_id"], ctx["workspace_id"]))
        event_id = cur.lastrowid
    return {"event_id": event_id, "title": title, "event_date": date}


def _verify_event(ctx, inputs, output):
    eid = (output or {}).get("event_id")
    if not eid:
        return (VERIFIED_FAILURE, "no event_id returned")
    with _conn(ctx["db_path"]) as c:
        row = c.execute("SELECT id, event_date, workspace_id FROM calendar_events WHERE id=?", (eid,)).fetchone()
    if not row:
        return (VERIFIED_FAILURE, f"event {eid} not found after insert")
    if row["workspace_id"] != ctx["workspace_id"]:
        return (VERIFIED_FAILURE, f"event {eid} in wrong workspace")
    return (VERIFIED_SUCCESS, f"calendar_events row id={eid} on {row['event_date']} exists")


register(Tool(
    name="create_calendar_event",
    description="Add a hearing/deadline/meeting to the legal calendar of the current workspace. "
                "Requires title and event_date (YYYY-MM-DD).",
    required_inputs=["title", "event_date"],
    optional_inputs=["event_type", "location", "opposing_counsel", "related_case_id"],
    risk="B", run=_create_event, verify=_verify_event,
))


# ── run_conflict_check (A) ──────────────────────────────────────────────────

def _conflict_check(ctx, inputs):
    name = (inputs.get("party_name") or "").strip()
    pat = f"%{name}%"
    hits = []
    with _conn(ctx["db_path"]) as c:
        try:
            for r in c.execute("SELECT id, title, workspace_id FROM lpms_cases "
                               "WHERE (title LIKE ? OR opposite_party LIKE ?)", (pat, pat)).fetchall():
                hits.append({"kind": "matter", "id": r["id"], "title": r["title"],
                             "same_workspace": r["workspace_id"] == ctx["workspace_id"]})
        except sqlite3.OperationalError:
            pass
        try:
            for r in c.execute("SELECT id, name, parties FROM workspaces WHERE parties LIKE ? OR name LIKE ?",
                               (pat, pat)).fetchall():
                hits.append({"kind": "workspace", "id": r["id"], "title": r["name"],
                             "same_workspace": r["id"] == ctx["workspace_id"]})
        except sqlite3.OperationalError:
            pass
    conflict = any(not h["same_workspace"] for h in hits)
    return {"party_name": name, "hits": hits, "conflict": conflict,
            "note": (f"Potential conflict: '{name}' appears in {sum(1 for h in hits if not h['same_workspace'])} "
                     f"other client matter(s)/workspace(s)." if conflict else f"No conflict found for '{name}'.")}


register(Tool(
    name="run_conflict_check",
    description="Check whether a party name appears in the firm's other matters or client workspaces "
                "(conflict of interest screen). Requires party_name.",
    required_inputs=["party_name"], risk="A",
    run=_conflict_check,
    verify=lambda ctx, i, out: (VERIFIED_SUCCESS, f"scanned matters+workspaces; {len(out.get('hits', []))} hits"),
))


# ── search_vault (A) ────────────────────────────────────────────────────────
# (Blueprint listed "Upload to Case Vault"; an agent chat has no file stream,
#  so Phase 3 ships vault SEARCH instead — upload stays a UI action.)

def _search_vault(ctx, inputs):
    q = f"%{(inputs.get('query') or '').strip()}%"
    with _conn(ctx["db_path"]) as c:
        try:
            rows = c.execute(
                "SELECT id, title, doc_type, created_at FROM case_vault "
                "WHERE workspace_id=? AND (title LIKE ? OR smart_title LIKE ? OR tags LIKE ?) "
                "ORDER BY id DESC LIMIT 20", (ctx["workspace_id"], q, q, q)).fetchall()
        except sqlite3.OperationalError:
            rows = []
    return {"documents": [dict(r) for r in rows], "count": len(rows)}


register(Tool(
    name="search_vault",
    description="Search the Case Vault documents of the current workspace by title or tag. Requires query.",
    required_inputs=["query"], risk="A",
    run=_search_vault,
    verify=lambda ctx, i, out: (VERIFIED_SUCCESS, f"vault query returned {out.get('count', 0)} documents"),
))


# ── navigate (A) — smart handoff ────────────────────────────────────────────

ROUTES = {
    "matters": "/matters", "matter": "/matters", "calendar": "/calendar",
    "auto_draft": "/auto-draft", "draft": "/auto-draft", "contracts": "/contract-analyzer",
    "contract_analyzer": "/contract-analyzer", "research": "/research", "vault": "/vault",
    "practice": "/practice", "dashboard": "/dashboard", "conflict_engine": "/conflict-engine",
    "settings": "/settings", "start": "/start", "court_resources": "/court-resources",
    "war_room": "/war-room", "virtual_courtroom": "/war-room", "document_hub": "/document-hub",
    "firm_library": "/firm-library", "legal_forms": "/legal-forms", "assistant": "/assistant",
    "clients": "/practice/clients",
}


def _navigate(ctx, inputs):
    dest = (inputs.get("destination") or "").strip().lower().replace(" ", "_").replace("-", "_")
    path = ROUTES.get(dest)
    if not path:
        raise ValueError(f"unknown destination '{dest}'; known: {', '.join(sorted(ROUTES))}")
    out = {"navigate_to": path}
    if inputs.get("entity_id"):
        out["navigate_to"] = f"{path}/{inputs['entity_id']}"
    return out


register(Tool(
    name="navigate",
    description="Open an app page for the user (matters, calendar, auto_draft, contracts, research, vault, "
                "practice, dashboard, conflict_engine, settings). Requires destination; optional entity_id "
                "to open a specific record.",
    required_inputs=["destination"], optional_inputs=["entity_id"], risk="A",
    run=_navigate,
    verify=lambda ctx, i, out: ((VERIFIED_SUCCESS, f"resolved route {out['navigate_to']}")
                                if out.get("navigate_to") else (VERIFIED_FAILURE, "no route resolved")),
))
