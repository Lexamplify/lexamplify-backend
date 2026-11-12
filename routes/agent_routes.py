"""
routes/agent_routes.py
Executive Assistant — autonomous agent API. Blueprint `agent_bp` at /api/agent
(the name `assistant_bp` is taken by the legacy research chat).
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity

from agent import engine, store
from agent.tools import core_tools, action_tools, intel_tools  # noqa: F401 — importing registers the tools
from utils.workspace_access import request_workspace_id, can_access

agent_bp = Blueprint('agent', __name__)


def _db_path():
    from flask import current_app
    return current_app.extensions.get('lpms_db_path') or 'instance/database.db'


def _ctx():
    uid = int(get_jwt_identity())
    try:
        ws = request_workspace_id()
    except ValueError:
        return uid, None, (jsonify({"error": "invalid workspace id"}), 400)
    if ws is not None and not can_access(uid, ws):
        return uid, None, (jsonify({"error": "workspace access denied"}), 403)
    return uid, ws, None


@agent_bp.route('/api/agent/task', methods=['POST'])
@jwt_required()
def create_task():
    uid, ws, err = _ctx()
    if err:
        return err
    instruction = ((request.get_json(silent=True) or {}).get('instruction') or '').strip()
    if not instruction:
        return jsonify({"error": "instruction is required"}), 400
    if len(instruction) > 4000:
        return jsonify({"error": "instruction too long"}), 400
    task = engine.submit_task(_db_path(), uid, ws, instruction)
    return jsonify({"task": task}), 201


@agent_bp.route('/api/agent/tasks', methods=['GET'])
@jwt_required()
def list_tasks():
    uid, ws, err = _ctx()
    if err:
        return err
    return jsonify({"tasks": store.list_tasks(_db_path(), uid, ws)})


@agent_bp.route('/api/agent/task/<task_id>', methods=['GET'])
@jwt_required()
def get_task(task_id):
    uid, ws, err = _ctx()
    if err:
        return err
    task = store.get_task(_db_path(), task_id)
    if not task or task["user_id"] != uid:
        return jsonify({"error": "not found"}), 404
    return jsonify({"task": task})


@agent_bp.route('/api/agent/task/<task_id>/reply', methods=['POST'])
@jwt_required()
def reply(task_id):
    uid, ws, err = _ctx()
    if err:
        return err
    task = store.get_task(_db_path(), task_id)
    if not task or task["user_id"] != uid:
        return jsonify({"error": "not found"}), 404
    answer = ((request.get_json(silent=True) or {}).get('answer') or '').strip()
    if not answer:
        return jsonify({"error": "answer is required"}), 400
    task = engine.resume_with_answer(_db_path(), uid, task["workspace_id"], task_id, answer)
    return jsonify({"task": task})


@agent_bp.route('/api/agent/task/<task_id>/approve', methods=['POST'])
@jwt_required()
def approve(task_id):
    uid, ws, err = _ctx()
    if err:
        return err
    task = store.get_task(_db_path(), task_id)
    if not task or task["user_id"] != uid:
        return jsonify({"error": "not found"}), 404
    body = request.get_json(silent=True) or {}
    decision = body.get('decision', 'approve')
    step_idx = int(body.get('step_idx', 0))
    task = engine.approve_step(_db_path(), uid, task["workspace_id"], task_id, step_idx, decision)
    return jsonify({"task": task})


@agent_bp.route('/api/agent/task/<task_id>/cancel', methods=['POST'])
@jwt_required()
def cancel(task_id):
    uid, ws, err = _ctx()
    if err:
        return err
    task = store.get_task(_db_path(), task_id)
    if not task or task["user_id"] != uid:
        return jsonify({"error": "not found"}), 404
    if task["state"] in ("COMPLETED", "FAILED", "CANCELLED"):
        return jsonify({"task": task})
    store.set_task_state(_db_path(), task_id, "CANCELLED")
    store.add_message(_db_path(), task_id, "ai", "Task cancelled.")
    return jsonify({"task": store.get_task(_db_path(), task_id)})
