"""
routes/team_routes.py
Team Management — members CRUD and task board.
"""
import sqlite3
from flask import Blueprint, request, jsonify, current_app

team_bp = Blueprint('team', __name__)


def get_db():
    return sqlite3.connect(current_app.config['SQLITE_DB_PATH'])


# ── TEAM MEMBERS ──────────────────────────────────────────────────────────────

@team_bp.route('/api/team/members', methods=['GET'])
def list_members():
    conn = get_db()
    conn.row_factory = sqlite3.Row
    members = conn.execute('SELECT * FROM team_members ORDER BY name ASC').fetchall()
    result = []
    for m in members:
        row = dict(m)
        count = conn.execute(
            "SELECT COUNT(*) FROM tasks WHERE assigned_to=? AND status!='done'",
            (row['id'],)
        ).fetchone()[0]
        row['active_tasks'] = count
        result.append(row)
    conn.close()
    return jsonify(result)


@team_bp.route('/api/team/members/add', methods=['POST'])
def add_member():
    data = request.get_json()
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


@team_bp.route('/api/team/members/delete/<int:member_id>', methods=['DELETE'])
def delete_member(member_id):
    conn = get_db()
    conn.execute('DELETE FROM team_members WHERE id=?', (member_id,))
    conn.commit()
    conn.close()
    return jsonify({'status': 'deleted'})


# ── TASKS ─────────────────────────────────────────────────────────────────────

@team_bp.route('/api/team/tasks', methods=['GET'])
def list_tasks():
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


@team_bp.route('/api/team/tasks/add', methods=['POST'])
def add_task():
    data = request.get_json()
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


@team_bp.route('/api/team/tasks/update/<int:task_id>', methods=['PUT'])
def update_task(task_id):
    data = request.get_json()
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


@team_bp.route('/api/team/tasks/status/<int:task_id>', methods=['PUT'])
def update_task_status(task_id):
    data = request.get_json()
    status = data.get('status', 'todo')
    if status not in ('todo', 'inprogress', 'done'):
        return jsonify({'error': 'Invalid status'}), 400
    conn = get_db()
    conn.execute('UPDATE tasks SET status=? WHERE id=?', (status, task_id))
    conn.commit()
    conn.close()
    return jsonify({'status': 'success'})


@team_bp.route('/api/team/tasks/delete/<int:task_id>', methods=['DELETE'])
def delete_task(task_id):
    conn = get_db()
    conn.execute('DELETE FROM tasks WHERE id=?', (task_id,))
    conn.commit()
    conn.close()
    return jsonify({'status': 'deleted'})
