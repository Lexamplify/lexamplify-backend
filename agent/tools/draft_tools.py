"""Auto-Draft Studio tools: saved drafts (list/save) and letterheads
(list / choose active template). saved_drafts columns mirror
routes/draft_engine_routes.py:905; letterheads are per-user
(routes/letterhead_routes.py), not workspace-scoped."""
import sqlite3
import uuid

from agent.tools.registry import Tool, register, VERIFIED_SUCCESS, VERIFIED_FAILURE


def _conn(db_path):
    c = sqlite3.connect(db_path, timeout=15)
    c.row_factory = sqlite3.Row
    return c


def _list_drafts(ctx, inputs):
    with _conn(ctx["db_path"]) as c:
        try:
            rows = c.execute("SELECT id, title, summary FROM saved_drafts WHERE owner_user_id=? "
                             "ORDER BY rowid DESC LIMIT 20", (ctx["user_id"],)).fetchall()
        except sqlite3.OperationalError:
            rows = []
    return {"drafts": [dict(r) for r in rows], "count": len(rows)}


register(Tool(
    name="list_drafts",
    description="List the user's saved drafts from Auto-Draft Studio.",
    required_inputs=[], risk="A",
    run=_list_drafts,
    verify=lambda c, i, o: (VERIFIED_SUCCESS, f"query returned {o['count']} drafts"),
))


def _save_draft(ctx, inputs):
    did = uuid.uuid4().hex
    with _conn(ctx["db_path"]) as c:
        c.execute("INSERT INTO saved_drafts (id, owner_user_id, title, raw_text, clauses_json, summary) "
                  "VALUES (?,?,?,?,?,?)",
                  (did, ctx["user_id"], inputs["title"], inputs["text"], "[]",
                   inputs.get("summary") or inputs["title"]))
    return {"draft_id": did, "title": inputs["title"]}


def _verify_save(ctx, i, out):
    with _conn(ctx["db_path"]) as c:
        row = c.execute("SELECT id FROM saved_drafts WHERE id=? AND owner_user_id=?",
                        ((out or {}).get("draft_id"), ctx["user_id"])).fetchone()
    return ((VERIFIED_SUCCESS, f"saved_drafts row {out['draft_id'][:8]}… exists") if row
            else (VERIFIED_FAILURE, "draft not found after save"))


register(Tool(
    name="save_draft",
    description="Save a piece of drafted text as a named draft the user can open in Auto-Draft Studio. "
                "Requires title and text.",
    required_inputs=["title", "text"], optional_inputs=["summary"], risk="B",
    run=_save_draft, verify=_verify_save,
))


def _list_letterheads(ctx, inputs):
    with _conn(ctx["db_path"]) as c:
        try:
            rows = c.execute("SELECT id, name, is_default, active_template, "
                             "template_docx IS NOT NULL AS has_firm_template, "
                             "counterparty_template_docx IS NOT NULL AS has_counterparty_template "
                             "FROM letterheads WHERE user_id=?", (ctx["user_id"],)).fetchall()
        except sqlite3.OperationalError:
            rows = []
    return {"letterheads": [dict(r) for r in rows], "count": len(rows)}


register(Tool(
    name="list_letterheads",
    description="List the user's letterheads and which template (firm/counterparty) each uses at export.",
    required_inputs=[], risk="A",
    run=_list_letterheads,
    verify=lambda c, i, o: (VERIFIED_SUCCESS, f"query returned {o['count']} letterheads"),
))


def _set_template(ctx, inputs):
    which = (inputs.get("template") or "").strip().lower()
    if which not in ("firm", "counterparty"):
        raise ValueError("template must be 'firm' or 'counterparty'")
    lid = int(inputs["letterhead_id"])
    with _conn(ctx["db_path"]) as c:
        row = c.execute("SELECT id FROM letterheads WHERE id=? AND user_id=?", (lid, ctx["user_id"])).fetchone()
        if not row:
            raise LookupError(f"letterhead {lid} not found")
        c.execute("UPDATE letterheads SET active_template=? WHERE id=?", (which, lid))
    return {"letterhead_id": lid, "active_template": which}


def _verify_template(ctx, i, out):
    with _conn(ctx["db_path"]) as c:
        row = c.execute("SELECT active_template FROM letterheads WHERE id=?",
                        ((out or {}).get("letterhead_id"),)).fetchone()
    want = (out or {}).get("active_template")
    return ((VERIFIED_SUCCESS, f"letterhead {out['letterhead_id']} active_template={want}")
            if row and row["active_template"] == want
            else (VERIFIED_FAILURE, "active_template not persisted"))


register(Tool(
    name="set_letterhead_template",
    description="Choose which template a letterhead uses at export: 'firm' or 'counterparty'. "
                "Requires letterhead_id and template.",
    required_inputs=["letterhead_id", "template"], risk="B",
    run=_set_template, verify=_verify_template,
))
