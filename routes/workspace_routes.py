"""Workspace API — /api/workspaces/*

Phase 2 of the workspaces-refactor. Registered only when WORKSPACES_ENABLED
is true. Every write uses SQLAlchemy against the single consolidated DB.

Endpoints:
  GET    /api/workspaces                        → workspaces this user can see
  POST   /api/workspaces                        → create (creator becomes owner)
  GET    /api/workspaces/<id>                   → single workspace + members
  PATCH  /api/workspaces/<id>                   → rename / update facts / parties / case meta
  POST   /api/workspaces/<id>/archive           → archive
  POST   /api/workspaces/<id>/unarchive         → unarchive
  POST   /api/workspaces/<id>/members           → invite a firm member
  DELETE /api/workspaces/<id>/members/<mid>     → revoke a firm member

Access rules:
  * Reading/listing: workspace member OR firm owner.
  * Creating: user must have a firm membership (lpms_members).
  * Modifying: workspace owner OR firm owner.
"""
from __future__ import annotations
from datetime import datetime

from flask import Blueprint, g, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from sqlalchemy.exc import IntegrityError

import sqlite3

from flask import current_app
from database import db
from models.workspace import Workspace, WorkspaceMember
from utils.workspace_access import (
    E_FORBIDDEN, E_NOT_FOUND, E_NO_FIRM, E_INVALID,
    current_firm_member, _err, can_access,
)


def _lpms_conn():
    """Open a raw sqlite3 connection to the LPMS db path (which the shim
    redirects to the consolidated file). Centralises the pattern so the
    few remaining LPMS reads here share it."""
    db_path = current_app.extensions.get("lpms_db_path") or "lex_assistant.db"
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


workspace_bp = Blueprint("workspace_bp", __name__, url_prefix="/api/workspaces")


# ──────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────
def _uid() -> int:
    return int(get_jwt_identity())


def _load_ws(wid: int) -> Workspace | None:
    return db.session.get(Workspace, wid)


def _is_ws_owner(user_id: int, ws: Workspace) -> bool:
    """True if user is workspace creator, firm owner, or has role in (owner,editor)."""
    if ws.created_by == user_id:
        return True
    conn = _lpms_conn()
    try:
        firm = conn.execute("SELECT owner_user_id FROM lpms_firms WHERE id = ?", (ws.firm_id,)).fetchone()
        if firm and firm["owner_user_id"] == user_id:
            return True
        mem = conn.execute(
            "SELECT id FROM lpms_members WHERE firm_id = ? AND user_id = ? AND active = 1",
            (ws.firm_id, user_id),
        ).fetchone()
        if not mem:
            return False
    finally:
        conn.close()
    row = (
        db.session.query(WorkspaceMember)
        .filter(WorkspaceMember.workspace_id == ws.id,
                WorkspaceMember.firm_member_id == mem["id"],
                WorkspaceMember.role.in_(["owner", "editor"]))
        .first()
    )
    return row is not None


def _members_payload(ws: Workspace) -> list[dict]:
    """Hydrate workspace_members with their LPMS member details (name,
    email, user_id). Reads workspace_members via SQLA, enriches each row
    with a raw sqlite3 lookup against lpms_members."""
    wms = db.session.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == ws.id
    ).all()
    if not wms:
        return []
    conn = _lpms_conn()
    try:
        placeholders = ",".join("?" for _ in wms)
        ids = [wm.firm_member_id for wm in wms]
        rows = conn.execute(
            f"SELECT id, name, email, user_id FROM lpms_members WHERE id IN ({placeholders})",
            ids,
        ).fetchall()
        by_id = {r["id"]: r for r in rows}
    finally:
        conn.close()
    out = []
    for wm in wms:
        fm = by_id.get(wm.firm_member_id)
        d = wm.to_dict()
        d["name"] = fm["name"] if fm else None
        d["email"] = fm["email"] if fm else None
        d["user_id"] = fm["user_id"] if fm else None
        out.append(d)
    return out


# ──────────────────────────────────────────────────────────────────
# Endpoints
# ──────────────────────────────────────────────────────────────────
@workspace_bp.route("", methods=["GET"])
@jwt_required()
def list_workspaces():
    """List workspaces this user can see.
    Includes: workspaces of firms the user owns, plus workspaces they are
    a member of in any firm."""
    uid = _uid()
    # Firms the user owns + firms they are a member of — both via raw sqlite3
    # for the LPMS side (writes happen outside SQLA).
    conn = _lpms_conn()
    try:
        owned_firm_ids = {
            r["id"] for r in conn.execute(
                "SELECT id FROM lpms_firms WHERE owner_user_id = ?", (uid,)
            ).fetchall()
        }
        my_member_ids = [
            r["id"] for r in conn.execute(
                "SELECT id FROM lpms_members WHERE user_id = ? AND active = 1", (uid,)
            ).fetchall()
        ]
    finally:
        conn.close()
    wm_ws_ids = {
        r.workspace_id for r in db.session.query(WorkspaceMember.workspace_id)
        .filter(WorkspaceMember.firm_member_id.in_(my_member_ids)).all()
    } if my_member_ids else set()

    q = db.session.query(Workspace).filter(
        (Workspace.firm_id.in_(owned_firm_ids)) | (Workspace.id.in_(wm_ws_ids)) | (Workspace.created_by == uid)
    ).order_by(Workspace.updated_at.desc())
    show_archived = request.args.get("archived") in ("1", "true", "yes")
    if not show_archived:
        q = q.filter(Workspace.status == "active")
    return jsonify({"workspaces": [w.to_dict() for w in q.all()]})


@workspace_bp.route("", methods=["POST"])
@jwt_required()
def create_workspace():
    uid = _uid()
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    if not name:
        return _err(E_INVALID, {"message": "`name` is required."})

    me = current_firm_member(uid)
    if not me:
        # Diagnostic to find why — remove after debugging.
        from models.legacy_a import LpmsMember, LpmsCurrent, LpmsFirm
        all_m = db.session.query(LpmsMember).all()
        from flask import current_app
        current_app.logger.warning(
            f"workspace create: no_firm for uid={uid} "
            f"members_total={len(all_m)} "
            f"members_for_user={[m.id for m in all_m if m.user_id == uid]} "
            f"active_for_user={[m.id for m in all_m if m.user_id == uid and m.active == 1]} "
            f"current_row={db.session.get(LpmsCurrent, uid)}"
        )
        return _err(E_NO_FIRM)

    ws = Workspace(
        firm_id=me.firm_id,
        name=name[:200],
        case_no=(body.get("case_no") or None),
        court=(body.get("court") or None),
        case_type=(body.get("case_type") or None),
        client_id=body.get("client_id"),
        lead_counsel_user_id=body.get("lead_counsel_user_id") or uid,
        facts=(body.get("facts") or None),
        parties=(body.get("parties") or None),
        created_by=uid,
    )
    db.session.add(ws)
    db.session.flush()  # need ws.id for member row

    db.session.add(WorkspaceMember(
        workspace_id=ws.id,
        firm_member_id=me.id,
        role="owner",
        added_by=uid,
    ))
    db.session.commit()
    return jsonify({"workspace": ws.to_dict(with_members=_members_payload(ws))}), 201


@workspace_bp.route("/<int:wid>", methods=["GET"])
@jwt_required()
def get_workspace(wid: int):
    ws = _load_ws(wid)
    if ws is None:
        return _err(E_NOT_FOUND)
    uid = _uid()
    if not can_access(uid, wid):
        return _err(E_FORBIDDEN)
    return jsonify({"workspace": ws.to_dict(with_members=_members_payload(ws))})


@workspace_bp.route("/<int:wid>", methods=["PATCH"])
@jwt_required()
def patch_workspace(wid: int):
    ws = _load_ws(wid)
    if ws is None:
        return _err(E_NOT_FOUND)
    uid = _uid()
    if not _is_ws_owner(uid, ws):
        return _err(E_FORBIDDEN)
    body = request.get_json(silent=True) or {}
    for field in ("name", "case_no", "court", "case_type", "client_id",
                  "lead_counsel_user_id", "facts", "parties"):
        if field in body:
            setattr(ws, field, body[field])
    ws.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify({"workspace": ws.to_dict(with_members=_members_payload(ws))})


@workspace_bp.route("/<int:wid>/archive", methods=["POST"])
@jwt_required()
def archive_workspace(wid: int):
    ws = _load_ws(wid)
    if ws is None:
        return _err(E_NOT_FOUND)
    uid = _uid()
    if not _is_ws_owner(uid, ws):
        return _err(E_FORBIDDEN)
    ws.status = "archived"
    ws.archived_at = datetime.utcnow()
    ws.updated_at = ws.archived_at
    db.session.commit()
    return jsonify({"workspace": ws.to_dict()})


@workspace_bp.route("/<int:wid>/unarchive", methods=["POST"])
@jwt_required()
def unarchive_workspace(wid: int):
    ws = _load_ws(wid)
    if ws is None:
        return _err(E_NOT_FOUND)
    uid = _uid()
    if not _is_ws_owner(uid, ws):
        return _err(E_FORBIDDEN)
    ws.status = "active"
    ws.archived_at = None
    ws.updated_at = datetime.utcnow()
    db.session.commit()
    return jsonify({"workspace": ws.to_dict()})


@workspace_bp.route("/<int:wid>/members", methods=["POST"])
@jwt_required()
def add_member(wid: int):
    ws = _load_ws(wid)
    if ws is None:
        return _err(E_NOT_FOUND)
    uid = _uid()
    if not _is_ws_owner(uid, ws):
        return _err(E_FORBIDDEN)
    body = request.get_json(silent=True) or {}
    fm_id = body.get("firm_member_id")
    role = (body.get("role") or "member").strip().lower()
    if role not in ("owner", "editor", "member", "viewer"):
        return _err(E_INVALID, {"message": "role must be owner|editor|member|viewer"})
    if not isinstance(fm_id, int):
        return _err(E_INVALID, {"message": "firm_member_id (int) is required"})

    conn = _lpms_conn()
    try:
        fm = conn.execute(
            "SELECT firm_id, active FROM lpms_members WHERE id = ?", (fm_id,)
        ).fetchone()
    finally:
        conn.close()
    if not fm or fm["firm_id"] != ws.firm_id or fm["active"] != 1:
        return _err(E_INVALID, {"message": "firm_member_id does not belong to this workspace's firm"})

    try:
        db.session.add(WorkspaceMember(
            workspace_id=ws.id, firm_member_id=fm_id, role=role, added_by=uid,
        ))
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        # Already a member — treat as idempotent success.
        pass
    return jsonify({"workspace": ws.to_dict(with_members=_members_payload(ws))})


@workspace_bp.route("/<int:wid>/members/<int:mid>", methods=["DELETE"])
@jwt_required()
def remove_member(wid: int, mid: int):
    ws = _load_ws(wid)
    if ws is None:
        return _err(E_NOT_FOUND)
    uid = _uid()
    if not _is_ws_owner(uid, ws):
        return _err(E_FORBIDDEN)
    # mid is firm_member_id, matches column directly.
    # Never allow removing the last remaining owner.
    all_owners = (
        db.session.query(WorkspaceMember)
        .filter(WorkspaceMember.workspace_id == ws.id, WorkspaceMember.role == "owner")
        .all()
    )
    if len(all_owners) == 1 and all_owners[0].firm_member_id == mid:
        return _err(E_INVALID, {"message": "cannot remove the last owner"})
    db.session.query(WorkspaceMember).filter(
        WorkspaceMember.workspace_id == ws.id,
        WorkspaceMember.firm_member_id == mid,
    ).delete()
    db.session.commit()
    return jsonify({"workspace": ws.to_dict(with_members=_members_payload(ws))})
