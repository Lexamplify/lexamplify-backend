"""
routes/firm_library_routes.py - Firm Library routes.

Houses the core list/create handlers (GET/POST /api/firm-library) as well as
the user's saved drafts and the Pinecone-backed external case-law search.

Blueprint: /api/firm-library
  GET  /api/firm-library
  POST /api/firm-library
  GET  /api/firm-library/saved
  GET  /api/firm-library/external-search
"""
import os
import sqlite3
import time
import uuid

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

firm_library_bp = Blueprint("firm_library", __name__, url_prefix="/api/firm-library")


@firm_library_bp.route("", methods=["GET", "OPTIONS"])
@jwt_required()
def get_firm_library():
    import app as app_module
    # Needs a login and is scoped like the rest of the vault: a user's own entries plus the legacy
    # (unowned) precedents. It used to be open to anyone and returned every user's saved documents.
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = app_module._current_vault_user_id()
    try:
        conn = app_module.db
        old_rf = conn.row_factory
        conn.row_factory = sqlite3.Row
        try:
            # Schema inspection rather than a hardcoded column list — if
            # case_vault is ever migrated to rename/drop a column, this
            # route degrades to the case_id fallback below instead of
            # 500ing on "no such column".
            table_cols = {row[1] for row in conn.execute("PRAGMA table_info('case_vault')").fetchall()}
            descriptive_col = next(
                (c for c in ('case_name', 'description', 'title', 'smart_title') if c in table_cols),
                None
            )

            select_cols = ['id', 'case_id', 'created_at']
            if descriptive_col and descriptive_col not in select_cols:
                select_cols.append(descriptive_col)
            for optional_col in ('validity_status', 'ratio_headnote', 'content'):
                if optional_col in table_cols:
                    select_cols.append(optional_col)
            where, params = [app_module._dms_hidden_sql('case_vault')], []
            if 'user_id' in table_cols:
                if 'is_public' in table_cols:
                    where.append('(user_id = ? OR is_public = 1)')
                else:
                    where.append('user_id = ?')
                params.append(uid)
            if app_module._dms_present() and 'file_blob' in table_cols:
                # Files that went in through the Document Hub have no text or blob in this row, so
                # there is nothing to read here - they live in the Document Hub, not the Firm Library.
                where.append("NOT (file_blob IS NULL AND COALESCE(content, '') = '' AND EXISTS "
                             "(SELECT 1 FROM dms_docs _dd WHERE _dd.doc_id = case_vault.id))")
            query = f"SELECT {', '.join(select_cols)} FROM case_vault WHERE {' AND '.join(where)} ORDER BY created_at DESC"
            rows = conn.execute(query, params).fetchall()

            docs = []
            for r in rows:
                raw_title = r[descriptive_col] if descriptive_col else None
                timestamp = r['created_at']
                row_keys = r.keys()
                docs.append({
                    'id': r['id'],
                    'case_id': r['case_id'],
                    'title': app_module.format_vault_title(raw_title, r['case_id']),
                    'timestamp': timestamp,
                    'last_updated': timestamp,
                    'updated': timestamp and str(timestamp).split(' ')[0] or '',
                    'type': 'Precedent',
                    'category': 'Precedent',
                    'author': 'Internal Vault',
                    'validity_status': (r['validity_status'] if 'validity_status' in row_keys else None) or 'Green',
                    'ratio_headnote': (r['ratio_headnote'] if 'ratio_headnote' in row_keys else None) or '',
                    # Truncated — this is a list endpoint returning every
                    # entry at once; the accordion reader only needs a
                    # preview, not the full document (a large judgment's
                    # full text here would bloat every single list
                    # fetch, not just the one row someone expands).
                    'content': ((r['content'] if 'content' in row_keys else None) or '')[:4000],
                })
        finally:
            conn.row_factory = old_rf
        return jsonify(docs), 200
    except Exception as e:
        return jsonify({'error': True, 'message': str(e)}), 500


@firm_library_bp.route("", methods=["POST"])
@jwt_required()
def create_firm_library_entry():
    """Legal Forms Library -> Firm Library persistence ("Save to Library
    & Exit"). Writes the drafted TipTap HTML into case_vault — the same
    table GET /api/firm-library already reads from — so a saved draft
    shows up in the Firm Library list on the very next fetch, no
    separate storage concept required. Needs a login; the entry belongs
    to the user who saved it."""
    import app as app_module
    uid = app_module._current_vault_user_id()
    try:
        data = request.get_json(silent=True) or {}
        title = (data.get('title') or '').strip()
        html = data.get('html') or ''
        category = (data.get('category') or 'Draft').strip()

        if not title:
            return jsonify({'error': True, 'message': 'Title is required.'}), 400
        if not html.strip():
            return jsonify({'error': True, 'message': 'No document content provided.'}), 400

        case_id = f"draft_{int(time.time())}_{uuid.uuid4().hex[:6]}"
        conn = app_module.db
        c = conn.cursor()
        c.execute(
            'INSERT INTO case_vault (case_id, title, doc_type, content, user_id) VALUES (?, ?, ?, ?, ?)',
            (case_id, title, f'Firm Library Draft — {category}', html, uid),
        )
        conn.commit()
        inserted_id = c.lastrowid

        # Best-effort local index write — never blocks/fails the save
        # itself (index_document already swallows its own errors), so
        # a slow-to-load embedding model can't turn a document save
        # into a 500.
        try:
            from utils.local_search import index_document
            index_document(inserted_id, title, html)
        except Exception as e:
            print(f"[create_firm_library_entry] indexing skipped: {e}")

        row = conn.execute(
            'SELECT id, case_id, title, created_at FROM case_vault WHERE id = ?', (inserted_id,)
        ).fetchone()
        timestamp = row[3] if row else None
        return jsonify({
            'id': inserted_id,
            'case_id': case_id,
            'title': title,
            'timestamp': timestamp,
            'last_updated': timestamp,
            'updated': timestamp and str(timestamp).split(' ')[0] or '',
            'type': category,
            'category': category,
            'author': 'Internal Vault',
            'validity_status': 'Green',
            'ratio_headnote': '',
        }), 201
    except Exception as e:
        return jsonify({'error': True, 'message': str(e)}), 500


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
