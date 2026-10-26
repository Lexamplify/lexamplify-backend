"""Central audit trail. One place decides which requests are worth recording, so no route can forget.

Nothing here can break a request: recording failures are logged and swallowed. Secrets are never recorded: only the
e-mail typed at sign-in, file names and sizes, document types and formats.
"""
import csv
import io
import re

from flask import request

# endpoint -> (action, success statuses)
WATCHED = {
    "auth.login_user": ("login", (200,)),
    "auth.register_user": ("register", (200, 201)),
    "auth.signup": ("register", (200, 201)),
    "auth.logout_user": ("logout", (200,)),
    "auth.change_password": ("password_changed", (200,)),
    "auth.reset_password": ("password_reset", (200,)),
    "auth.otp_login": ("login", (200,)),
    "drafts.export_doc": ("draft_exported", (200,)),
    "drafts.sessions_create": ("draft_started", (200, 201)),
    "drafts.sessions_delete": ("draft_deleted", (200,)),
    "contract.analyze": ("analysis_started", (200, 202)),
    "contract.extract_text": ("file_read", (200,)),
    "document.upload_document": ("document_uploaded", (200, 201)),
    "document.delete_document": ("document_deleted", (200,)),
    "vault_files.upload_vault_document": ("vault_uploaded", (200, 201)),
    "vault_files.delete_vault_document": ("vault_deleted", (200,)),
    "vault_files.delete_vault_folder": ("vault_folder_deleted", (200,)),
    "vault_workspace.delete_vault_share": ("vault_share_removed", (200,)),
}
_EMAIL = re.compile(r"[^\s@]{1,64}@[^\s@]{1,120}")


def _detail(endpoint, resp):
    try:
        if endpoint.startswith("auth."):
            body = request.get_json(silent=True)
            email = str((body or {}).get("email") or "")[:120]
            return email if _EMAIL.fullmatch(email) else ""
        if endpoint == "drafts.export_doc":
            body = request.get_json(silent=True) or {}
            return f"{str((body.get('document') or {}).get('title') or '')[:80]} as {str(body.get('format') or '')[:8]}"
        if endpoint in ("contract.extract_text", "contract.analyze", "document.upload_document", "vault_files.upload_vault_document"):
            f = request.files.get("file")
            return f"{(f.filename or '')[:120]}" if f else "pasted text"
    except Exception:  # noqa: BLE001
        pass
    return ""


def _user_id(endpoint, resp):
    from flask_jwt_extended import get_jwt_identity
    try:
        uid = get_jwt_identity()
        if uid is not None:
            return int(uid)
    except Exception:  # noqa: BLE001
        pass
    if endpoint.startswith("auth."):
        try:
            data = resp.get_json(silent=True) or {}
            return int((data.get("user") or {}).get("id"))
        except Exception:  # noqa: BLE001
            return None
    return None


def after_request(resp):
    """Registered once in app.py. Records watched endpoints, and failed sign-ins."""
    try:
        endpoint = request.endpoint or ""
        spec = WATCHED.get(endpoint)
        if not spec or request.method == "OPTIONS":
            return resp
        action, ok = spec
        if resp.status_code in ok:
            record(action, _user_id(endpoint, resp), _detail(endpoint, resp))
        elif endpoint in ("auth.login_user", "auth.otp_login") and resp.status_code in (400, 401, 403, 423, 429):
            record("login_failed", None, _detail(endpoint, resp))
    except Exception as exc:  # noqa: BLE001
        print(f"[audit] could not record: {exc}")
    return resp


def record(action, user_id=None, detail=""):
    try:
        from database import db
        from models.audit_event import AuditEvent
        db.session.add(AuditEvent(user_id=user_id, action=action[:40], detail=(detail or "")[:300],
                                  ip=(request.headers.get("X-Forwarded-For", "") or request.remote_addr or "").split(",")[0].strip()[:64]))
        db.session.commit()
    except Exception as exc:  # noqa: BLE001
        try:
            from database import db
            db.session.rollback()
        except Exception:  # noqa: BLE001
            pass
        print(f"[audit] could not record {action}: {exc}")


def events_for(user_id, limit=200):
    from models.audit_event import AuditEvent
    rows = AuditEvent.query.filter_by(user_id=user_id).order_by(AuditEvent.id.desc()).limit(max(1, min(int(limit), 5000))).all()
    return [{"id": r.id, "action": r.action, "detail": r.detail or "", "ip": r.ip or "", "at": r.at.isoformat() + "Z" if r.at else ""} for r in rows]


def to_csv(rows) -> str:
    """CSV that a spreadsheet will not run as a formula (a leading = + - @ is neutralised)."""
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["when (UTC)", "what", "detail", "ip address"])
    for r in rows:
        w.writerow([_safe(r["at"]), _safe(r["action"]), _safe(r["detail"]), _safe(r["ip"])])
    return buf.getvalue()


def _safe(v):
    v = str(v or "")
    return "'" + v if v[:1] in ("=", "+", "-", "@", "\t", "\r") else v
