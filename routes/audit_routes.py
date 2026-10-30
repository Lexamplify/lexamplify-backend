"""
routes/audit_routes.py
  GET /api/audit/me          the signed-in advocate's own activity (sign-ins, drafts, uploads, deletions)
  GET /api/audit/me.csv      the same as a spreadsheet file
Everyone sees only their own events. (A firm-wide trail for Senior Advocates lives in Practice, /api/practice/audit.)
"""
from flask import Blueprint, Response, jsonify, request
from flask_jwt_extended import get_jwt_identity

from utils import audit_log

audit_bp = Blueprint("audit", __name__, url_prefix="/api/audit")


def _uid():
    try:
        return int(get_jwt_identity())
    except (TypeError, ValueError):
        return None


@audit_bp.route("/me", methods=["GET"])
def my_events():
    try:
        limit = int(request.args.get("limit", 200))
    except ValueError:
        limit = 200
    return jsonify({"events": audit_log.events_for(_uid(), limit)})


@audit_bp.route("/me.csv", methods=["GET"])
def my_events_csv():
    body = audit_log.to_csv(audit_log.events_for(_uid(), 5000))
    resp = Response("﻿" + body, mimetype="text/csv")
    resp.headers["Content-Disposition"] = 'attachment; filename="my_activity.csv"'
    return resp
