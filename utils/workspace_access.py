"""Workspace access control + request helpers.

Phase 2 of the workspaces-refactor. Everything in this module is a
read-only helper used by routes/workspace_routes.py and (later) by every
feature route that becomes workspace-scoped. Nothing here mutates data.

Design (from fix_bug/Sociovia reference — stateless on the server):
  * The client sends X-Workspace-Id on every request. No "current workspace"
    row per user on the server.
  * `requires_workspace(fn)` is a decorator that resolves the header, loads
    the workspace, checks membership, pins it on `flask.g.current_workspace`,
    and returns one of the explicit error codes below on failure.
  * `register_access_check(fn)` lets each product (Firm Library, Matters, …)
    add its own "yes this user can see that workspace" check at import time
    without touching core.
  * `WORKSPACE_ISOLATION_MODE=observe` logs forbidden crossings but still
    returns the data (safe retrofit). `enforce` hard-blocks. Flip from
    observe to enforce AFTER every page has been verified.
"""
from __future__ import annotations
from functools import wraps
from typing import Callable, Optional

from flask import current_app, g, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required


# ──────────────────────────────────────────────────────────────────
# Explicit error-code vocabulary (frontend branches on `code`)
# ──────────────────────────────────────────────────────────────────
E_INVALID = ("invalid_workspace_id", 400, "X-Workspace-Id must be a positive integer.")
E_MISSING = ("workspace_required", 400, "No workspace was selected for this request.")
E_NOT_FOUND = ("workspace_not_found", 404, "This workspace does not exist.")
E_FORBIDDEN = ("forbidden_workspace", 403, "You do not have access to this workspace.")
E_NO_FIRM = ("no_firm", 400, "You must belong to a firm before creating a workspace.")


def _err(code_tuple, extra: Optional[dict] = None):
    code, http, msg = code_tuple
    body = {"error": True, "code": code, "message": msg}
    if extra:
        body.update(extra)
    return jsonify(body), http


# ──────────────────────────────────────────────────────────────────
# Access-check registry (pluggable). Core always checks firm ownership
# first; each product plugs in its own membership check if it has one.
# ──────────────────────────────────────────────────────────────────
_access_checks: list[Callable[[int, int], bool]] = []


def register_access_check(fn: Callable[[int, int], bool]) -> None:
    """Register `fn(user_id, workspace_id) -> bool`. If any registered
    check returns True, access is granted. Checks that raise are logged
    and treated as False (fail-closed)."""
    _access_checks.append(fn)


def _firm_owner_access(user_id: int, workspace_id: int) -> bool:
    """Default check: workspace creator, firm owner, or workspace member
    can access. Workspace table is queried via SQLA (we own it); LPMS
    firm/member tables are queried via raw sqlite3 to avoid cross-engine
    stale-cache issues (LPMS writes are raw sqlite today)."""
    import sqlite3
    from flask import current_app
    from models.workspace import Workspace, WorkspaceMember
    from database import db

    ws = db.session.get(Workspace, workspace_id)
    if not ws:
        return False
    if ws.created_by == user_id:
        return True

    db_path = current_app.extensions.get("lpms_db_path") or "lex_assistant.db"
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        try:
            # Firm owner?
            firm = conn.execute(
                "SELECT owner_user_id FROM lpms_firms WHERE id = ?", (ws.firm_id,)
            ).fetchone()
            if firm and firm["owner_user_id"] == user_id:
                return True
            # Member of the workspace (via lpms_members → workspace_members)?
            mem = conn.execute(
                "SELECT id FROM lpms_members WHERE firm_id = ? AND user_id = ? AND active = 1",
                (ws.firm_id, user_id),
            ).fetchone()
            if not mem:
                return False
            wm = (
                db.session.query(WorkspaceMember)
                .filter(
                    WorkspaceMember.workspace_id == workspace_id,
                    WorkspaceMember.firm_member_id == mem["id"],
                ).first()
            )
            return wm is not None
        finally:
            conn.close()
    except Exception as e:  # noqa: BLE001
        current_app.logger.warning(f"_firm_owner_access: {type(e).__name__}: {e}")
        return False


register_access_check(_firm_owner_access)


def can_access(user_id: int, workspace_id: int) -> bool:
    for check in _access_checks:
        try:
            if check(user_id, workspace_id):
                return True
        except Exception as e:  # noqa: BLE001 — fail closed
            current_app.logger.warning(f"workspace access check raised: {e}")
    return False


# ──────────────────────────────────────────────────────────────────
# Request-side helpers
# ──────────────────────────────────────────────────────────────────
def request_workspace_id() -> Optional[int]:
    """Extract the workspace id from the request. Order: header, query, body.
    Returns None if nothing is set, raises ValueError if it's not a positive int."""
    raw = request.headers.get("X-Workspace-Id") or request.args.get("workspace_id")
    if raw is None and request.is_json:
        try:
            body = request.get_json(silent=True) or {}
            raw = body.get("workspace_id")
        except Exception:
            raw = None
    if raw is None or raw == "":
        return None
    try:
        n = int(raw)
    except (TypeError, ValueError):
        raise ValueError("not_integer")
    if n <= 0:
        raise ValueError("not_positive")
    return n


def _current_user_id() -> Optional[int]:
    try:
        v = get_jwt_identity()
        return int(v) if v is not None else None
    except Exception:
        return None


def requires_workspace(fn):
    """Decorator: resolve X-Workspace-Id, verify access, pin workspace on g.
    Must be applied BELOW @jwt_required()."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            wid = request_workspace_id()
        except ValueError:
            return _err(E_INVALID)
        if wid is None:
            return _err(E_MISSING)

        from models.workspace import Workspace
        from database import db
        ws = db.session.get(Workspace, wid)
        if ws is None:
            return _err(E_NOT_FOUND)

        uid = _current_user_id()
        if uid is None or not can_access(uid, wid):
            # Observe vs enforce — see WORKSPACE_ISOLATION_MODE.
            mode = (current_app.config.get("WORKSPACE_ISOLATION_MODE") or "observe").lower()
            if mode == "enforce":
                current_app.logger.warning(
                    f"workspace access DENIED: user={uid} ws={wid}"
                )
                return _err(E_FORBIDDEN)
            current_app.logger.warning(
                f"workspace access would be denied (observe mode): user={uid} ws={wid}"
            )

        g.current_workspace = ws
        g.current_workspace_id = ws.id
        return fn(*args, **kwargs)
    return wrapper


# ──────────────────────────────────────────────────────────────────
# Convenience: user's firm membership (needed for workspace create / list)
# ──────────────────────────────────────────────────────────────────
class _MemberRow:
    """Lightweight stand-in for an LpmsMember row — just the fields the
    workspace routes read. Returned from current_firm_member() so callers
    don't care whether we read via raw sqlite or SQLA."""
    __slots__ = ("id", "firm_id", "user_id", "active", "role", "name", "email")

    def __init__(self, **kw):
        for k in self.__slots__:
            setattr(self, k, kw.get(k))


def current_firm_member(user_id: int):
    """Return the firm member row (with .firm_id) the user is currently
    operating under, or None if the user has no firm membership yet.

    LPMS data is written through raw sqlite3 (via legacy_sqlite_shim). To
    avoid stale-cache issues when SQLA and raw sqlite3 share a file we
    read the row through raw sqlite3 too — one SQL round-trip against the
    same connection path. Keeps workspace_routes.py simple while behaving
    correctly under both production and tests.

    Preference order: lpms_current.member_id, then the user's first active
    membership."""
    import sqlite3
    from flask import current_app
    # Resolve the actual sqlite file path. Prefer the LPMS extension path
    # (what the LPMS writes used); fall back to the SQLA URI.
    db_path = current_app.extensions.get("lpms_db_path") or "lex_assistant.db"
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        try:
            row = conn.execute(
                "SELECT m.* FROM lpms_members m "
                "JOIN lpms_current c ON c.member_id = m.id "
                "WHERE c.user_id = ? AND m.active = 1",
                (user_id,),
            ).fetchone()
            if row is None:
                row = conn.execute(
                    "SELECT * FROM lpms_members WHERE user_id = ? AND active = 1 "
                    "ORDER BY id ASC LIMIT 1",
                    (user_id,),
                ).fetchone()
            if row is None:
                return None
            return _MemberRow(
                id=row["id"], firm_id=row["firm_id"], user_id=row["user_id"],
                active=row["active"], role=row["role"], name=row["name"],
                email=row["email"],
            )
        finally:
            conn.close()
    except Exception as e:  # noqa: BLE001
        current_app.logger.warning(f"current_firm_member: {type(e).__name__}: {e}")
        return None


__all__ = [
    "E_INVALID", "E_MISSING", "E_NOT_FOUND", "E_FORBIDDEN", "E_NO_FIRM",
    "register_access_check", "can_access",
    "request_workspace_id", "requires_workspace",
    "current_firm_member",
]
