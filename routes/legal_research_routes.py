"""
routes/legal_research_routes.py - Dual-Brain legal research and the
case-vault document read path.

Blueprint: no prefix (the public paths are absolute and stay byte-identical)
  POST /api/legal-research
  GET  /api/legal-research/document/<string:case_id>
"""
import os

from flask import Blueprint, g, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required, verify_jwt_in_request

from utils.limiter import limiter

legal_research_bp = Blueprint("legal_research", __name__)

# Each answer costs Pinecone and Groq calls, so one person (not one office IP) gets a limit. Over it: HTTP 429, code RATE_LIMITED.
_RATE = os.getenv("RESEARCH_RATE_LIMIT", "20 per minute")


def _user_key():
    """Rate-limit bucket: the signed-in user, else the address (the limiter runs before the sign-in gate, so read the cookie here)."""
    try:
        verify_jwt_in_request(optional=True)
        ident = get_jwt_identity()
    except Exception:  # noqa: BLE001
        ident = None
    return f"research-user:{ident}" if ident else f"research-ip:{request.remote_addr}"


@legal_research_bp.route('/api/legal-research', methods=['POST', 'OPTIONS'])
@limiter.limit(_RATE, key_func=_user_key, exempt_when=lambda: request.method == 'OPTIONS')
def api_legal_research():
    if request.method == 'OPTIONS':
        return jsonify({}), 200

    from utils.research_service import MAX_QUESTION_CHARS, research

    data = request.get_json(force=True, silent=True) or {}
    lawyer_question = str(data.get('question', '')).strip()

    if not lawyer_question:
        return jsonify({"error": True, "message": "Question cannot be empty."}), 400
    if len(lawyer_question) > MAX_QUESTION_CHARS:
        return jsonify({"error": True, "message": f"Please keep the question under {MAX_QUESTION_CHARS} characters."}), 400

    # Success keeps its original shape ({status, answer, sources}); a failure is a real error status with a specific code,
    # never a 200 carrying a made-up answer. See utils/research_service.py for the outcomes.
    http, body = research(lawyer_question, request_id=getattr(g, 'request_id', None))
    resp = jsonify(body)
    resp.status_code = http
    if http in (503, 504) and body.get("retryable"):
        resp.headers['Retry-After'] = '30'
    return resp


@legal_research_bp.route('/api/legal-research/document/<string:case_id>', methods=['GET', 'OPTIONS'])
@jwt_required()
def api_legal_research_document(case_id):
    import app as app_module

    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = app_module._current_vault_user_id()

    # Strict allow-list validation — case_id arrives as a raw URL path
    # segment, so this is the only thing standing between an attacker and
    # a crafted "../" or SQL-metacharacter payload reaching the query.
    if not app_module.CASE_ID_RE.match(case_id):
        return jsonify({"error": True, "message": "Invalid case_id format."}), 400

    try:
        conn = app_module.db
        c = conn.cursor()
        c.execute(
            "SELECT title, content FROM case_vault WHERE case_id = ? AND (user_id = ? OR is_public = 1) "
            "ORDER BY created_at DESC LIMIT 1",
            (case_id, uid)
        )
        row = c.fetchone()

        if not row:
            return jsonify({"error": True, "message": f"Document with case_id '{case_id}' not found."}), 404

        title, content = row
        return jsonify({"title": title, "full_text": content}), 200

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": True, "message": str(e)}), 500
