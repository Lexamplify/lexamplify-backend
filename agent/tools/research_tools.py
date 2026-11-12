"""Legal Research + firm-grade conflict check.

legal_research delegates to utils/research_service.research() — the same
engine as the Research page, which returns honest error codes when Pinecone
isn't configured instead of fabricating law. firm_conflict_check uses the
REAL conflict engine (utils/conflict_check.run_check) against the Practice
firm's clients/cases/parties."""
import sqlite3

from agent.tools.registry import Tool, register, VERIFIED_SUCCESS, VERIFIED_FAILURE, PARTIALLY_VERIFIED


def _legal_research(ctx, inputs):
    from utils.research_service import research
    status, body = research((inputs.get("question") or "").strip())
    if status == 200:
        return {"ok": True, "answer": body.get("answer"), "sources": body.get("sources") or [],
                "source_count": len(body.get("sources") or [])}
    return {"ok": False, "status": status,
            "error": body.get("message") or body.get("error") or "research service unavailable",
            "note": "Legal Research needs its sources database (Pinecone) configured; I won't invent case law."}


def _verify_research(ctx, i, out):
    if out.get("ok"):
        n = out.get("source_count", 0)
        return ((VERIFIED_SUCCESS, f"answer grounded in {n} retrieved sources") if n
                else (PARTIALLY_VERIFIED, "answer returned without sources — marked unverified"))
    return (PARTIALLY_VERIFIED, f"research unavailable (HTTP {out.get('status')}) — reported honestly, no fabrication")


register(Tool(
    name="legal_research",
    description="Research an Indian legal question with cited sources (Research page engine). Requires question.",
    required_inputs=["question"], risk="A",
    run=_legal_research, verify=_verify_research,
))


def _firm_conflict(ctx, inputs):
    conn = sqlite3.connect(ctx["db_path"], timeout=15)
    conn.row_factory = sqlite3.Row
    try:
        member = conn.execute("SELECT * FROM lpms_members WHERE user_id=? AND active=1",
                              (ctx["user_id"],)).fetchone()
        if not member:
            raise LookupError("no Practice firm — use run_conflict_check for a basic matters scan instead")
        from utils.conflict_check import run_check
        opposing = inputs.get("opposing_party")
        result = run_check(conn, dict(member), inputs.get("client_name") or "",
                           [opposing] if opposing else [])
        return {"status": result.get("status"), "findings": result.get("findings") or [],
                "finding_count": len(result.get("findings") or []), "raw": {k: v for k, v in result.items()
                                                                            if k in ("status", "summary")}}
    finally:
        conn.close()


register(Tool(
    name="firm_conflict_check",
    description="Full conflict-of-interest screen against the Practice firm's clients, cases and parties "
                "(the Conflict Engine). Requires client_name; optional opposing_party.",
    required_inputs=["client_name"], optional_inputs=["opposing_party"], risk="A",
    run=_firm_conflict,
    verify=lambda c, i, o: ((VERIFIED_SUCCESS, f"engine returned status '{o['status']}' with {o['finding_count']} findings")
                            if o.get("status") else (VERIFIED_FAILURE, "engine returned no status")),
))
