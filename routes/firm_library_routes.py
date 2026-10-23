"""
routes/firm_library_routes.py - the two Firm Library extras.

The core list/create handlers (GET/POST /api/firm-library) stay inline in
app.py because tests/test_app_vault_patch.py pins them there. These two
handlers are the non-core additions: the user's saved drafts and the
Pinecone-backed external case-law search.

Blueprint: /api/firm-library
  GET /api/firm-library/saved
  GET /api/firm-library/external-search
"""
import os
import sqlite3

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

firm_library_bp = Blueprint("firm_library", __name__, url_prefix="/api/firm-library")


@firm_library_bp.route("/saved", methods=["GET", "OPTIONS"])
@jwt_required()
def get_saved_firm_library_drafts():
    """The documents this user filed into the Firm Library (from the editor's Save a copy, Legal Forms or
    Auto-Draft Studio). The Firm Library page lists these under "Your entries"."""
    import app as app_module

    if request.method == "OPTIONS":
        return jsonify({}), 200
    uid = app_module._current_vault_user_id()
    try:
        from utils.vault_docs_convert import html_to_text
        conn = app_module.db
        old_rf = conn.row_factory
        conn.row_factory = sqlite3.Row
        try:
            rows = conn.execute(
                "SELECT id, case_id, title, smart_title, doc_type, content, created_at FROM case_vault "
                "WHERE user_id = ? AND case_id LIKE 'draft\\_%' ESCAPE '\\' AND doc_type LIKE 'Firm Library Draft%' "
                "ORDER BY created_at DESC, id DESC", (uid,)).fetchall()
        finally:
            conn.row_factory = old_rf
        out = []
        for r in rows:
            dt = r["doc_type"] or ""
            category = dt.split("\u2014", 1)[1].strip() if "\u2014" in dt else "Draft"
            html = r["content"] or ""
            out.append({"id": r["id"], "case_id": r["case_id"], "title": r["smart_title"] or r["title"] or "Untitled draft",
                        "category": category or "Draft", "timestamp": r["created_at"], "text": html_to_text(html)[:30000], "html": html[:200000]})
        return jsonify(out), 200
    except Exception as e:
        return jsonify({"error": True, "message": str(e)}), 500


@firm_library_bp.route("/external-search", methods=["GET", "OPTIONS"])
def firm_library_external_search():
    """LLM-free semantic lookup over the Pinecone-backed case-law index,
    for the Firm Library's 'External Database' toggle. Deliberately
    never touches Groq — this is a fast browse/search grid, not the
    AI-synthesized Dual-Brain research dossier (/api/legal-research)."""
    import app as app_module

    if request.method == "OPTIONS":
        return jsonify({}), 200

    # Accept `q` as a defensive alias — the Firm Library UI's own
    # fetch call is the canonical caller and always sends `query`,
    # but this keeps any other/future caller from silently 400ing
    # the way the UI once did over a param-name mismatch.
    query = (request.args.get("query") or request.args.get("q") or "").strip()
    if not query:
        return jsonify({"error": True, "message": "Query cannot be empty."}), 400
    if len(query) < 3:
        return jsonify({
            "error": True,
            "success": False,
            "message": "Search query must be at least 3 characters.",
        }), 400

    try:
        pc = app_module.Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
        index = app_module._get_pinecone_index(pc)
        # Hardcoded, not read from PINECONE_NAMESPACE — this route only
        # ever targets one namespace, and reading it from an env var
        # that could be unset-to-empty-string in some deployment would
        # silently query Pinecone's separate default namespace instead
        # (empty string is itself a valid, DIFFERENT namespace, not
        # "unset") and return zero results with no error.
        namespace = "legal-cases"

        embed_response = pc.inference.embed(
            model=app_module.EMBED_MODEL,
            inputs=[query],
            parameters={"input_type": "query", "truncate": "END"},
        )
        query_vector = embed_response[0].values

        # top_k deliberately high (45, not the 10 we actually return) —
        # a single case can contribute dozens of chunks, so a small
        # top_k would rarely survive dedup as more than one or two
        # distinct cases; over-fetching lets the loop below collect 10
        # actually-DIFFERENT cases instead of 10 near-duplicate chunks
        # of the same one or two. No score-threshold filtering — every
        # match is a dedup/formatting candidate regardless of score.
        pinecone_results = index.query(
            vector=query_vector,
            top_k=45,
            include_metadata=True,
            namespace=namespace,
        )

        results = []
        seen_cases = set()
        for match in (pinecone_results.matches or []):
            meta = match.metadata or {}
            case_id = meta.get("case_id") or match.id
            # CRITICAL DEDUPLICATION — same as /api/legal-research: a
            # case can have hundreds of chunks, so without this the
            # first case in the ranking would flood the grid with N
            # identical-looking rows.
            if case_id in seen_cases:
                continue
            seen_cases.add(case_id)

            # worker.py's actual ingested metadata is only ever
            # {case_id, year, chunk_index, text} — title/case_name/
            # citation/etc. below are NOT present today. The extra
            # fallback keys are deliberate future-proofing (bulletproof
            # against the metadata schema gaining fields later), not
            # evidence they exist now; the real, working fallback is
            # format_case_title(case_id), not a flat placeholder string
            # that would otherwise render identically for every row.
            resolved_title = (
                meta.get("title") or meta.get("case_name") or meta.get("doc_title")
                or app_module.format_case_title(case_id)
            )
            text = meta.get("snippet") or meta.get("text") or meta.get("chunk_text") or ""
            year = meta.get("year") or meta.get("date") or ""

            results.append({
                # case_id, not match.id (a raw per-CHUNK vector hash) —
                # this is what /api/document/<id> and Pin-to-Vault
                # expect, and what the dedup above is keyed on; using
                # the chunk id here would silently break both.
                "id": case_id,
                "case_id": case_id,
                "title": resolved_title,
                "case_title": resolved_title,
                "case_name": resolved_title,
                "snippet": text[:200],
                "text": text[:200],
                "citation": meta.get("citation") or meta.get("reporter") or "Supreme Court of India",
                "year": str(year) if year else "N/A",
                "score": round(float(match.score), 4) if match.score is not None else None,
                # Fallback values so this ALSO still maps onto the
                # {id, title, category, updated, author} schema the
                # Firm Library table's shared rows already render for
                # internal entries — no real category/author exists
                # for a raw Pinecone chunk.
                "category": "Case Law",
                "updated": f"{year}-01-01" if year else "",
                "author": "External Case Law DB",
                "tags": [],
            })
            if len(results) >= 10:
                break

        return jsonify({"status": "success", "results": results, "data": results}), 200
    except Exception as e:
        print(f"[PINECONE ERROR] {e}")
        return jsonify({"status": "error", "message": "Vector database unavailable.", "results": []}), 200
