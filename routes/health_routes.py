"""Health / keep-alive endpoints (/api/ping, /api/status).

Extracted from app.py's create_app() per docs/BACKEND_REFACTOR_PLAN.md.
Closure references were replaced with imports: app -> current_app,
_rid() -> flask.g.request_id (still set by the _assign_request_id
before_request that remains in app.py).
"""
import os
import time
from flask import Blueprint, jsonify, request, current_app, g
from database import db as sqlalchemy_db

health_bp = Blueprint('health', __name__)


@health_bp.route('/api/ping')
def api_ping():
    # Touches the DB so Render + Neon stay warm (a cron hits this every few minutes).
    db_ok = False
    try:
        from sqlalchemy import text as _sql_text
        sqlalchemy_db.session.execute(_sql_text('SELECT 1'))
        db_ok = True
    except Exception as exc:
        print(f'[ping] database not reachable yet: {exc}')
        sqlalchemy_db.session.rollback()
    finally:
        sqlalchemy_db.session.remove()
    return jsonify({'ok': True, 'db': db_ok})


@health_bp.route('/api/status', methods=['GET'])
def api_status():
    from utils import metrics
    rid = getattr(g, 'request_id', '-')
    out = {"ok": True, "time": int(time.time()), "checks": {}}
    try:
        from sqlalchemy import text as _t
        sqlalchemy_db.session.execute(_t('SELECT 1'))
        out["checks"]["database"] = "ok"
    except Exception as exc:
        current_app.logger.error(f"[{rid}] status: database check failed: {exc}")
        out["checks"]["database"] = "down"
        out["ok"] = False
    out["checks"]["practice_module"] = "ok" if current_app.extensions.get('lpms_db_path') else "not available"
    out["checks"]["ai_configured"] = "yes" if os.getenv('GROQ_API_KEY') else "no"
    if request.args.get('deep') == '1' and os.getenv('GROQ_API_KEY'):
        t0 = time.time()
        try:
            from utils.ai_helper import ask_groq
            ask_groq("Reply with the single word OK.", "ping", max_tokens=5)
            out["checks"]["ai_reachable"] = f"ok ({round(time.time() - t0, 2)}s)"
            metrics.observe('ai_ping', time.time() - t0)
        except Exception as exc:
            current_app.logger.error(f"[{rid}] status: AI check failed: {exc}")
            out["checks"]["ai_reachable"] = "down"
            out["ok"] = False
    out["metrics"] = metrics.snapshot()
    out["memory_mb"] = metrics.rss_mb()
    out["note"] = "Counters restart when the server restarts."
    return jsonify(out), (200 if out["ok"] else 503)
