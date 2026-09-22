"""
routes/team_routes.py
Team Management — members CRUD and task board.
"""
import sqlite3
from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required

team_bp = Blueprint('team', __name__)


def get_db():
    return sqlite3.connect(current_app.config['SQLITE_DB_PATH'])


# ── TEAM MEMBERS ──────────────────────────────────────────────────────────────

def _resolve_member_user_ids(conn):
    """Case-insensitive email match of every team_members row against the
    real `users` table, caching the result in team_members.user_id. Mirrors
    app.py's _resolve_team_member_user_ids (duplicated rather than imported
    to avoid a routes.team_routes <-> app circular import — app.py already
    imports team_bp from this module at blueprint-registration time). Used
    by Case Vault v2's sharing feature (Phase 2), which made this roster
    load-bearing for real access control rather than a display-only list."""
    from models.user import User
    rows = conn.execute(
        "SELECT id, email FROM team_members WHERE email IS NOT NULL AND email != ''"
    ).fetchall()
    if not rows:
        return
    users = User.query.filter(User.email.isnot(None)).all()
    by_email = {u.email.strip().lower(): u.id for u in users if u.email}
    for member_id, email in rows:
        resolved_uid = by_email.get((email or '').strip().lower())
        conn.execute('UPDATE team_members SET user_id = ? WHERE id = ?', (resolved_uid, member_id))
    conn.commit()


# Authenticated as of Case Vault v2 Phase 2 — the Share modal's people-
# picker now reads this roster to decide who can be granted real document/
# folder access, so an unauthenticated caller enumerating it is no longer
# just a display-only leak. The other team routes (add/delete/tasks) are
# unchanged/still open — flagged separately, not silently expanded here.
@team_bp.route('/api/team/members', methods=['GET'])
@jwt_required()
def list_members():
    try:
        conn = get_db()
        conn.row_factory = sqlite3.Row
        try:
            conn.execute('ALTER TABLE team_members ADD COLUMN user_id INTEGER')
            conn.commit()
        except sqlite3.OperationalError:
            pass
        _resolve_member_user_ids(conn)
        members = conn.execute('SELECT * FROM team_members ORDER BY name ASC').fetchall()
        result = []
        for m in members:
            row = dict(m)
            count = conn.execute(
                "SELECT COUNT(*) FROM tasks WHERE assigned_to=? AND status!='done'",
                (row['id'],)
            ).fetchone()[0]
            row['active_tasks'] = count
            row['matched'] = row.get('user_id') is not None
            result.append(row)
        conn.close()
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500


@team_bp.route('/api/team/members/add', methods=['POST'])
def add_member():
    try:
        data = request.get_json(silent=True) or {}
        if not data or not data.get('name'):
            return jsonify({'error': 'name is required'}), 400
        conn = get_db()
        c = conn.cursor()
        c.execute('INSERT INTO team_members (name, email, role) VALUES (?,?,?)', (
            data['name'], data.get('email', ''), data.get('role', 'Junior')
        ))
        conn.commit()
        new_id = c.lastrowid
        conn.close()
        return jsonify({'status': 'success', 'id': new_id})
    except Exception as e:
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500


@team_bp.route('/api/team/members/delete/<int:member_id>', methods=['DELETE'])
def delete_member(member_id):
    try:
        conn = get_db()
        conn.execute('DELETE FROM team_members WHERE id=?', (member_id,))
        conn.commit()
        conn.close()
        return jsonify({'status': 'deleted'})
    except Exception as e:
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500


# ── TASKS ─────────────────────────────────────────────────────────────────────

@team_bp.route('/api/team/tasks', methods=['GET'])
def list_tasks():
    try:
        conn = get_db()
        conn.row_factory = sqlite3.Row
        rows = conn.execute('''
            SELECT t.*, m.name as assignee_name, tc.case_name
            FROM tasks t
            LEFT JOIN team_members m ON t.assigned_to = m.id
            LEFT JOIN tracked_cases tc ON t.case_id = tc.id
            ORDER BY t.due_date ASC
        ''').fetchall()
        conn.close()
        return jsonify([dict(r) for r in rows])
    except Exception as e:
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500


@team_bp.route('/api/team/tasks/add', methods=['POST'])
def add_task():
    try:
        data = request.get_json(silent=True) or {}
        if not data or not data.get('title'):
            return jsonify({'error': 'title is required'}), 400
        conn = get_db()
        c = conn.cursor()
        c.execute('''INSERT INTO tasks (title, assigned_to, case_id, due_date, priority, status, notes)
                     VALUES (?,?,?,?,?,?,?)''', (
            data['title'],
            data.get('assigned_to'),
            data.get('case_id'),
            data.get('due_date', None),
            data.get('priority', 'Normal'),
            data.get('status', 'todo'),
            data.get('notes', ''),
        ))
        conn.commit()
        new_id = c.lastrowid
        conn.close()
        return jsonify({'status': 'success', 'id': new_id})
    except Exception as e:
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500


@team_bp.route('/api/team/tasks/update/<int:task_id>', methods=['PUT'])
def update_task(task_id):
    try:
        data = request.get_json(silent=True) or {}
        conn = get_db()
        conn.execute('''UPDATE tasks SET title=?, assigned_to=?, case_id=?, due_date=?,
                        priority=?, status=?, notes=? WHERE id=?''', (
            data.get('title', ''),
            data.get('assigned_to'),
            data.get('case_id'),
            data.get('due_date', None),
            data.get('priority', 'Normal'),
            data.get('status', 'todo'),
            data.get('notes', ''),
            task_id,
        ))
        conn.commit()
        conn.close()
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500


@team_bp.route('/api/team/tasks/status/<int:task_id>', methods=['PUT'])
def update_task_status(task_id):
    try:
        data = request.get_json(silent=True) or {}
        status = data.get('status', 'todo')
        if status not in ('todo', 'inprogress', 'done'):
            return jsonify({'error': 'Invalid status'}), 400
        conn = get_db()
        conn.execute('UPDATE tasks SET status=? WHERE id=?', (status, task_id))
        conn.commit()
        conn.close()
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500


@team_bp.route('/api/team/tasks/delete/<int:task_id>', methods=['DELETE'])
def delete_task(task_id):
    try:
        conn = get_db()
        conn.execute('DELETE FROM tasks WHERE id=?', (task_id,))
        conn.commit()
        conn.close()
        return jsonify({'status': 'deleted'})
    except Exception as e:
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500
