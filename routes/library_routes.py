"""
routes/library_routes.py
Blueprint: /api/library
  GET  /api/library/search                    — local hybrid (vector + BM25) search, zero LLM/cloud calls
  POST /api/library/<id>/verify-status         — deterministic (non-LLM) validity re-check
  POST /api/library/<id>/generate-headnote     — dispatches the async Celery headnote job
  GET  /api/library/headnote/stream/<job_id>   — SSE progress for the headnote job
"""
import json
import sqlite3
import time

from flask import Blueprint, request, jsonify, current_app, Response, stream_with_context

from utils.local_search import hybrid_search
from utils.citation_verifier import verify_citation_status

library_bp = Blueprint("library", __name__, url_prefix="/api/library")
DB_PATH = "lex_assistant.db"


def _get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


@library_bp.route("/search", methods=["GET", "OPTIONS"])
def search_library():
    if request.method == "OPTIONS":
        return jsonify({}), 200

    query = (request.args.get("query") or "").strip()
    if not query:
        return jsonify({"error": True, "message": "Query cannot be empty."}), 400

    conn = None
    try:
        conn = _get_db()
        rows = conn.execute(
            "SELECT id, case_id, title, content FROM case_vault ORDER BY created_at DESC LIMIT 500"
        ).fetchall()
        candidates = [
            {"id": r["id"], "title": r["title"] or r["case_id"] or "", "content": r["content"] or ""}
            for r in rows
        ]
        results = hybrid_search(query, candidates, top_k=10)
        return jsonify({"status": "success", "results": results, "data": results}), 200
    except Exception as e:
        # Local search unavailable (e.g. embedding model failed to load)
        # degrades to an empty-but-labeled result, not a 500 — the Firm
        # Library table still renders, it just has nothing to show.
        print(f"[library_search] error: {e}")
        return jsonify({"status": "error", "message": "Local search unavailable.", "results": []}), 200
    finally:
        if conn:
            conn.close()


@library_bp.route("/<int:doc_id>/verify-status", methods=["POST"])
def verify_status(doc_id):
    conn = None
    try:
        conn = _get_db()
        row = conn.execute("SELECT id, title, case_id FROM case_vault WHERE id = ?", (doc_id,)).fetchone()
        if not row:
            return jsonify({"error": True, "message": "Document not found."}), 404

        citation_string = row["title"] or row["case_id"] or ""
        status = verify_citation_status(citation_string)

        conn.execute("UPDATE case_vault SET validity_status = ? WHERE id = ?", (status, doc_id))
        conn.commit()
        return jsonify({"id": doc_id, "validity_status": status}), 200
    except Exception as e:
        return jsonify({"error": True, "message": str(e), "code": "INTERNAL_ERROR"}), 500
    finally:
        if conn:
            conn.close()


@library_bp.route("/<int:doc_id>/generate-headnote", methods=["POST"])
def generate_headnote(doc_id):
    try:
        from tasks.library_tasks import generate_headnote_task
        task = generate_headnote_task.delay(doc_id)
        return jsonify({"job_id": task.id, "status_url": f"/api/library/headnote/stream/{task.id}"}), 202
    except Exception as e:
        print(f"[generate_headnote] Failed to dispatch Celery task: {e}")
        return jsonify({
            "error": "Failed to start headnote job. Is the Celery worker running?",
            "code": "JOB_DISPATCH_ERROR",
        }), 503


@library_bp.route("/headnote/stream/<job_id>", methods=["GET"])
def stream_headnote_job(job_id):
    """Same polling-SSE shape as /api/contract/stream/<job_id> — kept as a
    direct sibling rather than a shared abstraction so this endpoint can't
    be destabilized by a future change aimed at the contract-analysis job
    stream, or vice versa."""
    from celery.result import AsyncResult

    celery_app = current_app.extensions.get("celery")
    app_ctx = current_app._get_current_object()

    def event_stream():
        with app_ctx.app_context():
            result = AsyncResult(job_id, app=celery_app)
            last_payload = None
            while True:
                if result.state == 'PROGRESS':
                    meta = result.info if isinstance(result.info, dict) else {}
                    payload = {
                        "state": "PROGRESS",
                        "status": meta.get("status", "Working..."),
                        "progress": meta.get("progress", 0),
                    }
                elif result.state == 'PENDING':
                    payload = {"state": "PENDING", "status": "Queued...", "progress": 0}
                elif result.state == 'SUCCESS':
                    payload = {"state": "SUCCESS", "status": "Complete", "progress": 100, "result": result.result}
                elif result.state == 'FAILURE':
                    payload = {"state": "FAILURE", "status": "Headnote generation failed.", "error": str(result.info)}
                else:
                    payload = {"state": result.state, "status": result.state, "progress": 0}

                if payload != last_payload:
                    yield f"data: {json.dumps(payload)}\n\n"
                    last_payload = payload

                if result.ready():
                    break
                time.sleep(0.6)

    return Response(
        stream_with_context(event_stream()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
