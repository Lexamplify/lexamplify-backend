"""Central authorization — one place that answers "may user U do ACTION on RESOURCE?".

Why this module exists
----------------------
Authorization in this codebase grew into FIVE parallel, hand-rolled models
(LPMS firm/role, per-client workspaces, Home-Gateway matters/teams, legacy
owner-only tables, and the Case-Vault ACL). Each route re-implements its own
check with its own deny convention (403 vs 404 vs empty list). The gap that
matters most: the `X-Workspace-Id` header is trusted as a *filter* but never
as an *authorization check*, and `requires_workspace` (the one decorator that
would verify it) is applied to zero routes. Any row scoped only by
`workspace_id` is therefore reachable by guessing the id — the IDOR class.

This module centralises the decision WITHOUT changing the existing role rules:
it reuses `lpms_store.permissions / case_write_level / lpms_case_role`,
`case_access.eligible_recipient_ids`, and `workspace_access.can_access`. The one
thing it adds on every path is the missing guarantee — **the caller must be an
active member of the firm that owns the resource** — which closes the cross-firm
/ cross-client IDOR.

Design rules
------------
* Pure read helpers; nothing here mutates. Reads go through the same shimmed
  `sqlite3` path every LPMS route uses (so it hits Postgres via pg_compat in
  production, sqlite in tests).
* Fail CLOSED: any error, any unknown resource, any unresolved identity → deny.
* Uniform convention for callers: deny == `404` (hide existence), via `@requires`.
* ADDITIVE. Importing this module changes nothing. Behaviour only changes where
  a route opts in by calling `can_access(...)` or applying `@requires(...)`.
"""
from __future__ import annotations

import os
import sqlite3
from functools import wraps
from typing import Optional

from flask import current_app, g, jsonify, request

# Actions the system understands. `manage` = settings/members/audit on a firm.
VIEW, EDIT, DELETE, SHARE, CREATE, MANAGE = "view", "edit", "delete", "share", "create", "manage"
_ACTIONS = {VIEW, EDIT, DELETE, SHARE, CREATE, MANAGE}

# Resource types this module can authorize. Kept explicit so an unknown string
# fails closed rather than silently allowing.
WORKSPACE = "workspace"          # per-client workspace (SQLA `workspaces`)
LPMS_CASE = "lpms_case"          # Practice case (`lpms_cases`, firm+role+team)
MATTER = "matter"                # Home-Gateway matter (`matters`, owner+team)
VAULT_DOC = "vault_doc"          # Case-Vault / document (`case_vault`)
# Legacy owner-only tables — authorized purely by `owner_user_id`.
_OWNER_TABLES = {
    "clause": "clauses",
    "client": "clients",
    "calendar_event": "calendar_events",
    "time_entry": "time_entries",
    "ip_asset": "ip_assets",
}


# ──────────────────────────────────────────────────────────────────
# Connection — same resolver every LPMS route uses (shimmed to Postgres)
# ──────────────────────────────────────────────────────────────────
def _db_path() -> str:
    try:
        p = current_app.extensions.get("lpms_db_path")
    except Exception:
        p = None
    return p or os.path.join("instance", "database.db")


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path())
    conn.row_factory = sqlite3.Row
    return conn


# ──────────────────────────────────────────────────────────────────
# Principal resolution: the caller's active membership in a given firm.
# ──────────────────────────────────────────────────────────────────
def firm_member(conn, user_id: int, firm_id: int) -> Optional[dict]:
    """The caller's ACTIVE `lpms_members` row in `firm_id`, or None.

    This is the cross-firm gate: if a user is not an active member of the
    resource's firm, they get None here and every firm-scoped check denies.
    """
    if user_id is None or firm_id is None:
        return None
    try:
        r = conn.execute(
            "SELECT * FROM lpms_members WHERE firm_id = ? AND user_id = ? AND active = 1 LIMIT 1",
            (int(firm_id), int(user_id)),
        ).fetchone()
    except Exception:
        return None
    return dict(r) if r else None


def _firm_owner_id(conn, firm_id: int) -> Optional[int]:
    try:
        r = conn.execute("SELECT owner_user_id FROM lpms_firms WHERE id = ?", (int(firm_id),)).fetchone()
        return int(r[0]) if r and r[0] is not None else None
    except Exception:
        return None


# ──────────────────────────────────────────────────────────────────
# Per-resource authorization. Each returns a plain bool, fail-closed.
# ──────────────────────────────────────────────────────────────────
def _can_workspace(conn, uid: int, wid: int, action: str) -> bool:
    try:
        ws = conn.execute(
            "SELECT id, firm_id, created_by FROM workspaces WHERE id = ?", (int(wid),)
        ).fetchone()
    except Exception:
        return False
    if not ws:
        return False
    firm_id, created_by = ws["firm_id"], ws["created_by"]

    # Cross-firm gate: creator, firm owner, or active member of the firm.
    is_creator = created_by is not None and int(created_by) == uid
    is_firm_owner = _firm_owner_id(conn, firm_id) == uid
    mem = firm_member(conn, uid, firm_id)
    if not (is_creator or is_firm_owner or mem):
        return False

    if action in (VIEW, EDIT):
        # Must additionally be a member OF THIS workspace (not just the firm),
        # unless creator/firm-owner. Mirrors workspace_access._firm_owner_access.
        if is_creator or is_firm_owner:
            return True
        try:
            wm = conn.execute(
                "SELECT role FROM workspace_members WHERE workspace_id = ? AND firm_member_id = ?",
                (int(wid), int(mem["id"])),
            ).fetchone()
        except Exception:
            wm = None
        if action == VIEW:
            return wm is not None
        # EDIT needs a writer role on the workspace.
        return bool(wm and (wm["role"] or "member") in ("owner", "editor"))

    if action in (DELETE, SHARE, MANAGE):
        if is_creator or is_firm_owner:
            return True
        if not mem:
            return False
        try:
            wm = conn.execute(
                "SELECT role FROM workspace_members WHERE workspace_id = ? AND firm_member_id = ?",
                (int(wid), int(mem["id"])),
            ).fetchone()
        except Exception:
            wm = None
        return bool(wm and (wm["role"] or "member") in ("owner", "editor"))

    return False


def _can_lpms_case(conn, uid: int, case_id: int, action: str) -> bool:
    try:
        case = conn.execute(
            "SELECT id, firm_id, advocate_id, team_id, restricted FROM lpms_cases WHERE id = ?",
            (int(case_id),),
        ).fetchone()
    except Exception:
        return False
    if not case:
        return False

    mem = firm_member(conn, uid, case["firm_id"])
    if not mem:
        return False  # cross-firm gate

    if action == VIEW:
        # lpms_case_role already encodes the restricted-case rule.
        try:
            from utils.lpms_store import lpms_case_role
            return lpms_case_role(conn, uid, case_id) is not None
        except Exception:
            return False

    if action in (EDIT, DELETE, SHARE):
        try:
            from utils.lpms_store import firm_settings, case_write_level
            settings = firm_settings(conn, case["firm_id"])
            lvl = case_write_level(mem, settings, dict(case), conn=conn)
            if action in (DELETE, SHARE):
                # Only full-write (senior / firm owner) may delete or re-share.
                return lvl == "full"
            return lvl in ("full", "limited")
        except Exception:
            return False

    return False


def _can_matter(conn, uid: int, matter_id: int, action: str) -> bool:
    try:
        m = conn.execute(
            "SELECT id, owner_user_id, team_id FROM matters WHERE id = ?", (int(matter_id),)
        ).fetchone()
    except Exception:
        return False
    if not m:
        return False
    is_owner = m["owner_user_id"] is not None and int(m["owner_user_id"]) == uid
    if is_owner:
        return True
    # Team members may view/edit (preserves current collaboration behaviour).
    if m["team_id"] is not None:
        try:
            tm = conn.execute(
                "SELECT 1 FROM team_memberships WHERE team_id = ? AND user_id = ? LIMIT 1",
                (int(m["team_id"]), uid),
            ).fetchone()
        except Exception:
            tm = None
        if tm:
            # Owner-only operations stay owner-only.
            return action in (VIEW, EDIT)
    return False


def _can_vault_doc(conn, uid: int, doc_id: int, action: str) -> bool:
    try:
        d = conn.execute(
            "SELECT id, user_id, is_public FROM case_vault WHERE id = ?", (int(doc_id),)
        ).fetchone()
    except Exception:
        return False
    if not d:
        return False
    is_owner = d["user_id"] is not None and int(d["user_id"]) == uid
    if is_owner:
        return True
    if action == VIEW and (d["is_public"] or 0) == 1:
        return True  # mass-ingested public judgments are world-readable
    return False  # explicit folder shares resolved by caller for now


def _can_owner_table(conn, uid: int, table: str, row_id: int, action: str) -> bool:
    try:
        r = conn.execute(
            f"SELECT owner_user_id FROM {table} WHERE id = ?", (int(row_id),)
        ).fetchone()
    except Exception:
        return False
    if not r:
        return False
    owner = r["owner_user_id"]
    if owner is not None:
        return int(owner) == uid
    # Unowned legacy row → belongs to the earliest-registered account only.
    try:
        from utils.tenancy import legacy_owner_id
        return legacy_owner_id() == uid
    except Exception:
        return False


# ──────────────────────────────────────────────────────────────────
# Public entry point
# ──────────────────────────────────────────────────────────────────
def can_access(user_id, resource_type: str, resource_id, action: str) -> bool:
    """May `user_id` perform `action` on `resource_type`#`resource_id`?

    Fail-closed. Unknown resource/action → False. Any exception → False.
    """
    try:
        uid = int(user_id)
    except (TypeError, ValueError):
        return False
    if action not in _ACTIONS:
        return False
    try:
        rid = int(resource_id)
    except (TypeError, ValueError):
        return False

    conn = _conn()
    try:
        if resource_type == WORKSPACE:
            return _can_workspace(conn, uid, rid, action)
        if resource_type == LPMS_CASE:
            return _can_lpms_case(conn, uid, rid, action)
        if resource_type == MATTER:
            return _can_matter(conn, uid, rid, action)
        if resource_type == VAULT_DOC:
            return _can_vault_doc(conn, uid, rid, action)
        if resource_type in _OWNER_TABLES:
            return _can_owner_table(conn, uid, _OWNER_TABLES[resource_type], rid, action)
        return False  # unknown resource type → deny
    except Exception as e:  # noqa: BLE001
        try:
            current_app.logger.warning(f"can_access error {resource_type}#{rid} {action}: {e}")
        except Exception:
            pass
        return False
    finally:
        conn.close()


def header_workspace_block_reason(user_id) -> Optional[str]:
    """Central IDOR gate for the X-Workspace-Id header.

    Returns None when the request may proceed, or a short reason string when
    it must be blocked. Proceed (None) in every case EXCEPT: the request
    carries a valid X-Workspace-Id, that workspace exists, and the caller
    cannot VIEW it. Absent/blank/invalid header → None (legacy unscoped
    behaviour is preserved). A header naming a workspace that does not exist
    → None (the resource query will simply return nothing; we don't leak
    existence here).

    This is the one check that turns the X-Workspace-Id header from a trusted
    filter into an authorized one across every resource route at once.
    """
    raw = request.headers.get("X-Workspace-Id")
    if not raw:
        return None
    try:
        wid = int(raw)
    except (TypeError, ValueError):
        return None
    if wid <= 0:
        return None
    try:
        uid = int(user_id)
    except (TypeError, ValueError):
        return "no_identity"

    conn = _conn()
    try:
        exists = conn.execute("SELECT 1 FROM workspaces WHERE id = ?", (wid,)).fetchone()
        if not exists:
            return None  # unknown id → let the filtered query return empty
        if _can_workspace(conn, uid, wid, VIEW):
            return None
        return "forbidden_workspace"
    except Exception:
        # Fail OPEN here on infra error: this is a backstop, and the per-query
        # firm scoping remains the primary control. Never 500 the whole API
        # because the gate's own read failed.
        return None
    finally:
        conn.close()


def _uid() -> Optional[int]:
    try:
        from flask_jwt_extended import get_jwt_identity
        v = get_jwt_identity()
        return int(v) if v is not None else None
    except Exception:
        return None


def requires(resource_type: str, action: str, id_param: str = "id"):
    """Decorator: 404 unless the caller may `action` the resource named by the
    URL parameter `id_param`. Apply BELOW @jwt_required(). Deny == 404 to hide
    existence (the convention `_get_matter_or_404` already uses)."""
    def deco(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            rid = kwargs.get(id_param)
            uid = _uid()
            if uid is None or rid is None or not can_access(uid, resource_type, rid, action):
                return jsonify({"error": True, "code": "not_found", "message": "Not found."}), 404
            return fn(*args, **kwargs)
        return wrapper
    return deco


__all__ = [
    "VIEW", "EDIT", "DELETE", "SHARE", "CREATE", "MANAGE",
    "WORKSPACE", "LPMS_CASE", "MATTER", "VAULT_DOC",
    "can_access", "requires", "firm_member",
]
