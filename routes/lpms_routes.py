"""
routes/lpms_routes.py - Blueprint /api/practice : Legal Practice Management ("Practice" in the app).

Built to be mounted from app.py with create_lpms_blueprint(deps). deps supplies what lives elsewhere in the app:
  db_path        the SQLite file the Case Vault / Document Hub already use (required)
  get_user       uid -> {id, name, email, phone}          find_user    email -> {id, name} | None
  create_user    (name, email, password, phone) -> uid     set_password (uid, password)
  send_email     (to, subject, body) -> bool               email_configured () -> bool
  log            print-like logger
The module keeps its own tables (all lpms_*), so it can be exercised without the rest of the application.

Rules it keeps:
  * every route needs a signed-in user who belongs to a practice (firm); a person is in one practice at a time
  * roles: Senior Advocate (everything), Junior Advocate (their cases, daily proceedings, documents, clients),
    Office Staff (clients, calendar, documents, RTI, reports) - enforced here, not in the browser
  * a "restricted" case is visible only to Senior Advocates and its lead advocate - in lists, search, reports and its documents
  * every change writes to a per-firm tamper-evident audit chain in the same transaction
  * optional IP allow-list and firm-wide two-step sign-in are enforced on every route
"""
import os

from flask import Blueprint

from routes import lpms_cases, lpms_core, lpms_more
from routes.lpms_common import ApiError, Env, err
from utils import lpms_store as L


def create_lpms_blueprint(deps):
    if not deps.get("db_path"):
        raise RuntimeError("create_lpms_blueprint: deps.db_path is required")
    bp = Blueprint("lpms", __name__, url_prefix="/api/practice")
    log = deps.get("log") or (lambda m: None)

    boot = L.connect(deps["db_path"])
    try:
        L.ensure_schema(boot)
    finally:
        boot.close()

    env = Env(bp, deps)
    bp.env = env

    @bp.teardown_request
    def _close(_exc):
        env.close()

    @bp.errorhandler(ApiError)
    def _api_error(e):
        return err(e.message, e.status, **e.extra)

    lpms_core.register(env)
    lpms_cases.register(env)
    lpms_more.register(env)

    sender = deps.get("send_email")
    bp.scheduler = L.Scheduler(deps["db_path"], sender if (deps.get("email_configured") and deps["email_configured"]()) else None,
                               interval=int(os.getenv("LPMS_REMINDER_INTERVAL", "600")), log=log)
    if os.getenv("LPMS_SCHEDULER", "1") != "0" and not deps.get("no_scheduler"):
        bp.scheduler.start()
    return bp
