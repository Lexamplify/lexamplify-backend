"""Case endpoints.

Moved verbatim out of app.py's create_app() (step 3c): GET /api/cases/autocomplete.
The module does not import app at the top; the handler imports it locally as app_module,
so the thread-local SQLite handle (app.db) and _current_vault_user_id remain the app's own.
No url_prefix: the path is written in full, exactly as it was in app.py.
"""
from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

cases_bp = Blueprint('cases', __name__)


@cases_bp.route('/api/cases/autocomplete', methods=['GET', 'OPTIONS'])
@jwt_required()
def api_cases_autocomplete():
    import app as app_module
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = app_module._current_vault_user_id()
    q = request.args.get('q', '').strip()
    if not q:
        return jsonify([]), 200
    try:
        conn = app_module.db
        c = conn.cursor()
        # Parameterized placeholder — the LIKE wildcard is built into the
        # bound value, never concatenated into the SQL string itself.
        c.execute(
            "SELECT id, title FROM case_vault WHERE title LIKE ? AND user_id = ? "
            "ORDER BY created_at DESC LIMIT 10",
            (f'%{q}%', uid)
        )
        rows = c.fetchall()
        return jsonify([{"id": r[0], "title": r[1]} for r in rows]), 200
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": True, "message": str(e)}), 500
