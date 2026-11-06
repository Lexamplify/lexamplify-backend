"""Workspace context builder — turns a workspace_id into a markdown brief
that every AI entry point prepends to its system prompt.

Phase 5 of the workspaces-refactor. The AI never has to be re-briefed on
who the client is or what the papers say — the active workspace carries
the case facts, parties, prior drafts, prior analyses and prior vault
documents, and this helper walks them into a compact prompt block.

Design:
  * One function, build_workspace_context(workspace_id) → str.
  * Reads via raw sqlite3 through the shim so stale-cache issues between
    SQLA and raw-SQL writes don't bite (same pattern we use for LPMS reads
    in utils/workspace_access.py).
  * Caps every section so the block fits inside a modest token budget;
    hard limit ≈ 1800 chars (≈450 tokens) of actual content.
  * Returns an empty string when workspace_id is None or the workspace is
    missing — callers can safely do `system_prompt = ctx + system_prompt`.
"""
from __future__ import annotations
import sqlite3
from flask import current_app

# Max characters per section — trimmed on word boundaries where possible.
MAX_FACTS_CHARS = 1200
MAX_PARTIES_CHARS = 400
MAX_PER_ITEM_TITLE = 90
N_DOCS = 5
N_DRAFTS = 5
N_ANALYSES = 5


def _lpms_db_path() -> str:
    return current_app.extensions.get("lpms_db_path") or "lex_assistant.db"


def _trim(s: str | None, limit: int) -> str:
    if not s:
        return ""
    s = str(s).strip()
    if len(s) <= limit:
        return s
    cut = s[:limit]
    # Try to end on a word boundary.
    last = cut.rfind(" ")
    if last > limit * 0.6:
        cut = cut[:last]
    return cut.rstrip() + " …"


def build_workspace_context(workspace_id: int | None, *, for_drafting: bool = False) -> str:
    """Return a markdown block summarising the active workspace, or ''.

    Includes case metadata, free-text facts, parties, N most recent
    vault documents, N most recent drafts, N most recent contract
    analyses. Entirely optional context — any AI route that doesn't want
    workspace context can simply not call this.

    `for_drafting=True`: callers that produce a FINISHED legal document
    (notice, letter, draft) pass this. The partisan impact tags
    ([Favors us], [Harms us], [Missing — would favor us]) make sense for
    Contract Analyzer findings but are poison inside a draft — the model
    cheerfully appends '[Favors us]' to the body of the notice itself.
    Drafting mode replaces rules 1/2 with a strict 'produce only the
    document body, never meta-commentary or impact tags' rule.
    """
    if workspace_id is None:
        return ""
    try:
        wid = int(workspace_id)
    except (TypeError, ValueError):
        return ""

    conn = sqlite3.connect(_lpms_db_path())
    conn.row_factory = sqlite3.Row
    try:
        # SECURITY: workspace_id originates from the client-supplied
        # X-Workspace-Id header. Scope the read to the caller's own firm so a
        # user cannot inject another firm's privileged matter brief (facts,
        # parties, client contacts) into the AI prompt — and, via /ai-edit,
        # read it straight back out. Resolve the caller's firm and require the
        # workspace to belong to it; otherwise return no context.
        try:
            from flask_jwt_extended import get_jwt_identity
            uid = int(get_jwt_identity())
        except Exception:
            return ""
        firm = conn.execute(
            "SELECT firm_id FROM lpms_members WHERE user_id = ? AND active = 1 LIMIT 1",
            (uid,),
        ).fetchone()
        if not firm:
            return ""
        ws = conn.execute(
            "SELECT id, name, case_no, court, case_type, facts, parties, "
            "client_type, client_contact_email, client_contact_phone, "
            "client_address, client_notes "
            "FROM workspaces WHERE id = ? AND firm_id = ?", (wid, firm["firm_id"]),
        ).fetchone()
        if not ws:
            return ""

        parts: list[str] = []
        # Pipeline item 2 (full version): the workspace brief forces every
        # downstream AI call to think and write as this client's own
        # counsel. The old version was a single polite sentence; this one
        # mandates partisan framing + impact tags + missing-protection
        # hunting on every output. See plans/compiled-scribbling-scott.md
        # discussion thread for the rationale.
        client_name = ws["name"]
        parts.append(f"## Client brief: {client_name}")
        if for_drafting:
            parts.append(
                f"**You are {client_name}'s own counsel. You represent {client_name}. "
                f"You are not a neutral referee.**\n\n"
                f"**How you must frame every output:**\n"
                f"1. **Produce only the document body.** When you are asked to draft, "
                f"edit, rewrite or add to a legal document, your reply IS that text, "
                f"ready to paste into the file. Never append meta-commentary, "
                f"explanations, headings like 'Here is the draft', or impact tags "
                f"such as `[Favors us]` / `[Harms us]` / `[Neutral]`. Those tags are "
                f"for review tools, NOT for the body of a notice, letter or pleading.\n"
                f"2. **Draft in {client_name}'s own voice and interest** — first "
                f"person where appropriate, assertive where the law allows, defensive "
                f"where the facts require. The reader of the draft is the opposing "
                f"party or the court; nothing in the output may give away our strategy.\n"
                f"3. **Partisan phrasing, not neutral phrasing.** Say *\"You failed "
                f"to…\"* not *\"The parties may have differed on…\"*. Say *\"Our client "
                f"demands…\"* not *\"It is suggested that…\"*.\n"
                f"4. **Admit no weakness in the draft.** A fact that hurts us is "
                f"handled by careful phrasing or omission — never a confession in the "
                f"body of the document itself.\n"
                f"5. **Never draft, propose, or advise for the opposing side.**"
            )
        else:
            parts.append(
                f"**You are {client_name}'s own counsel. You represent {client_name}. "
                f"You are not a neutral referee.**\n\n"
                f"**How you must frame every output:**\n"
                f"1. **Every finding ends with an impact tag.** For every clause, risk, "
                f"suggestion, or paragraph you produce, close with one of: `[Favors us]`, "
                f"`[Harms us]`, `[Neutral — monitor]`. No neutral silence allowed; if you "
                f"are unsure, mark it `[Harms us — needs human check]` and err on the side "
                f"of flagging.\n"
                f"2. **Hunt for what is MISSING.** A clause that would protect {client_name} "
                f"but is absent from the document is itself a finding. Flag it with "
                f"`[Missing — would favor us]`. The opposing side benefits every time a "
                f"protective clause for {client_name} is left out.\n"
                f"3. **Partisan phrasing, not neutral phrasing.** Say *\"This clause is bad "
                f"for us because…\"* not *\"This clause is one-sided.\"* Say *\"We should "
                f"push for…\"* not *\"The parties could consider…\"*. The reader is the "
                f"senior advocate for {client_name}, briefing their junior.\n"
                f"4. **Admit genuine weakness.** When a fact in the brief genuinely hurts "
                f"{client_name}'s position, say so bluntly and recommend a defensive move — "
                f"do not pretend the fact doesn't exist. Partisan ≠ dishonest.\n"
                f"5. **Never draft, propose, or advise for the opposing side.** If asked "
                f"for \"a balanced view,\" refuse — point back to the standard that applies "
                f"and say what it means for {client_name} specifically."
            )

        client_bits: list[str] = []
        if ws["client_type"]: client_bits.append(f"**Client type** {ws['client_type']}")
        if ws["client_contact_email"]: client_bits.append(f"**Email** {ws['client_contact_email']}")
        if ws["client_contact_phone"]: client_bits.append(f"**Phone** {ws['client_contact_phone']}")
        if client_bits:
            parts.append("  ·  ".join(client_bits))
        if ws["client_address"]:
            parts.append(f"**Address.** {_trim(ws['client_address'], 400)}")

        # Legacy case metadata (set only on single-case workspaces from
        # the pre-redesign era). New per-client workspaces leave these
        # NULL — case details live on each lpms_cases row.
        meta_bits: list[str] = []
        if ws["case_no"]:  meta_bits.append(f"**Case no.** {ws['case_no']}")
        if ws["court"]:    meta_bits.append(f"**Court** {ws['court']}")
        if ws["case_type"]:meta_bits.append(f"**Type** {ws['case_type']}")
        if meta_bits:
            parts.append("  ·  ".join(meta_bits))

        # Pipeline item 1: list all open cases for this client.
        try:
            cases = conn.execute(
                "SELECT title, case_no, court, case_type, status "
                "FROM lpms_cases WHERE workspace_id = ? AND archived_at IS NULL "
                "ORDER BY updated_at DESC LIMIT 10",
                (wid,),
            ).fetchall()
            if cases:
                lines = []
                for cs in cases:
                    bits = [cs["title"] or "(untitled)"]
                    if cs["case_no"]: bits.append(f"({cs['case_no']})")
                    if cs["court"]: bits.append(f"— {cs['court']}")
                    lines.append("  - " + " ".join(bits))
                parts.append("**Cases on file for this client:**\n" + "\n".join(lines))
        except Exception:
            pass  # lpms_cases.workspace_id may not exist yet on a fresh DB

        facts = _trim(ws["facts"], MAX_FACTS_CHARS)
        if facts:
            parts.append(f"**Client / matter facts.** {facts}")

        parties = _trim(ws["parties"], MAX_PARTIES_CHARS)
        if parties:
            # Explicitly tag the opposing parties so the AI knows who to
            # push against — this is what "represent {client}" cashes out
            # to in a contract or filing.
            parts.append(f"**Parties on this matter (opposing / counterparty included).** {parties}")

        # Prior vault documents — most recent N, titles only.
        docs = conn.execute(
            "SELECT id, COALESCE(smart_title, title, doc_type) AS t, created_at "
            "FROM case_vault WHERE workspace_id = ? "
            "ORDER BY created_at DESC, id DESC LIMIT ?", (wid, N_DOCS),
        ).fetchall()
        doc_lines = [f"  - {_trim(d['t'], MAX_PER_ITEM_TITLE)}" for d in docs if d["t"]]
        if doc_lines:
            parts.append("**Documents on file:**\n" + "\n".join(doc_lines))

        # Prior drafts — most recent N.
        drafts = conn.execute(
            "SELECT id, title, doc_type, updated_at "
            "FROM draft_sessions WHERE workspace_id = ? "
            "ORDER BY updated_at DESC, id DESC LIMIT ?", (wid, N_DRAFTS),
        ).fetchall()
        draft_lines = [
            f"  - {_trim(d['title'], MAX_PER_ITEM_TITLE)} ({d['doc_type']})"
            for d in drafts if d["title"]
        ]
        if draft_lines:
            parts.append("**Prior drafts:**\n" + "\n".join(draft_lines))

        # Prior contract analyses — most recent N.
        analyses = conn.execute(
            "SELECT id, document_name, created_at "
            "FROM contract_analyses WHERE workspace_id = ? "
            "ORDER BY created_at DESC, id DESC LIMIT ?", (wid, N_ANALYSES),
        ).fetchall()
        ana_lines = [f"  - {_trim(a['document_name'], MAX_PER_ITEM_TITLE)}"
                     for a in analyses if a["document_name"]]
        if ana_lines:
            parts.append("**Prior contract analyses:**\n" + "\n".join(ana_lines))

        parts.append(
            f"_Use the brief above as ground truth. Do not invent facts, dates "
            f"or amounts that are not in the brief or the user's current input. "
            f"When this brief and the user's immediate input conflict, treat the "
            f"user's input as the newer fact pattern, but still write from "
            f"{client_name}'s side._"
        )
        return "\n\n".join(parts) + "\n\n---\n\n"
    except Exception as e:  # noqa: BLE001
        current_app.logger.warning(f"build_workspace_context failed: {e}")
        return ""
    finally:
        conn.close()


__all__ = ["build_workspace_context"]
