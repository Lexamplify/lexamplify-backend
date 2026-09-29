"""
routes/dispute_routes.py
Blueprint: /api/disputes
  GET  /api/disputes/catalog  - the curated dispute library (same JSON the frontend bundles)
  POST /api/disputes/draft    - AI narrative slots (facts + grounds), validated + guarded
  POST /api/disputes/ask      - grounded Q&A over the library (refuses to answer from memory)
  POST /api/disputes/match    - matter description -> best library entries (ids validated)
  POST /api/disputes/verify   - look up the draft's statute citations on India Code / Indian Kanoon

All AI endpoints require a logged-in user. The legal skeleton never comes from the model:
see utils/dispute_ai.py for the design and its stated limits.
"""
from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required
from utils import dispute_ai

dispute_bp = Blueprint("disputes", __name__, url_prefix="/api/disputes")


def _body():
    return request.get_json(force=True, silent=True) or {}


def _status(res: dict, ok_code=200):
    if res.get("ok"):
        return ok_code
    return {"unknown_dispute": 404, "not_enough_facts": 422, "empty_question": 400, "empty": 400,
            "ai_unavailable": 503, "bad_model_output": 502}.get(res.get("error"), 400)


@dispute_bp.route("/catalog", methods=["GET", "OPTIONS"])
def catalog():
    if request.method == "OPTIONS":
        return jsonify({}), 200
    return jsonify(dispute_ai.load_catalog())


@dispute_bp.route("/draft", methods=["POST", "OPTIONS"])
@jwt_required()
def draft():
    if request.method == "OPTIONS":
        return jsonify({}), 200
    b = _body()
    res = dispute_ai.draft_slots(str(b.get("dispute_id") or ""), b.get("facts"), str(b.get("instructions") or ""))
    return jsonify(res), _status(res)


@dispute_bp.route("/ask", methods=["POST", "OPTIONS"])
@jwt_required()
def ask():
    if request.method == "OPTIONS":
        return jsonify({}), 200
    b = _body()
    res = dispute_ai.ask_question(str(b.get("question") or ""), str(b.get("dispute_id") or ""), str(b.get("draft_text") or ""))
    return jsonify(res), _status(res)


@dispute_bp.route("/match", methods=["POST", "OPTIONS"])
@jwt_required()
def match():
    if request.method == "OPTIONS":
        return jsonify({}), 200
    res = dispute_ai.match_matter(str(_body().get("description") or ""))
    return jsonify(res), _status(res)


@dispute_bp.route("/verify", methods=["POST", "OPTIONS"])
@jwt_required()
def verify():
    if request.method == "OPTIONS":
        return jsonify({}), 200
    res = dispute_ai.verify_text_citations(str(_body().get("text") or ""))
    return jsonify(res), _status(res)
