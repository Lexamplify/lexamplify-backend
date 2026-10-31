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


def build_workspace_context(workspace_id: int | None) -> str:
    """Return a markdown block summarising the active workspace, or ''.

    Includes case metadata, free-text facts, parties, N most recent
    vault documents, N most recent drafts, N most recent contract
    analyses. Entirely optional context — any AI route that doesn't want
    workspace context can simply not call this."""
    if workspace_id is None:
        return ""
    try:
        wid = int(workspace_id)
    except (TypeError, ValueError):
        return ""

    conn = sqlite3.connect(_lpms_db_path())
    conn.row_factory = sqlite3.Row
    try:
        ws = conn.execute(
            "SELECT id, name, case_no, court, case_type, facts, parties "
            "FROM workspaces WHERE id = ?", (wid,),
        ).fetchone()
        if not ws:
            return ""

        parts: list[str] = []
        parts.append(f"## Workspace brief: {ws['name']}")

        meta_bits: list[str] = []
        if ws["case_no"]:  meta_bits.append(f"**Case no.** {ws['case_no']}")
        if ws["court"]:    meta_bits.append(f"**Court** {ws['court']}")
        if ws["case_type"]:meta_bits.append(f"**Type** {ws['case_type']}")
        if meta_bits:
            parts.append("  ·  ".join(meta_bits))

        facts = _trim(ws["facts"], MAX_FACTS_CHARS)
        if facts:
            parts.append(f"**Case facts.** {facts}")

        parties = _trim(ws["parties"], MAX_PARTIES_CHARS)
        if parties:
            parts.append(f"**Parties.** {parties}")

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
            "_Use the brief above as grounding. Do not invent facts, dates "
            "or amounts that are not in the brief or the user's current input."
        )
        return "\n\n".join(parts) + "\n\n---\n\n"
    except Exception as e:  # noqa: BLE001
        current_app.logger.warning(f"build_workspace_context failed: {e}")
        return ""
    finally:
        conn.close()


__all__ = ["build_workspace_context"]
