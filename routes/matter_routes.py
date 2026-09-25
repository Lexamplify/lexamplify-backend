"""
routes/matter_routes.py
Home Gateway v4 — real Matter/Team backend, replacing the old client-only
Zustand+localStorage "organization" store. Lives in lex_assistant.db (same
file as Case Vault's case_vault/vault_folders/etc.), NOT
instance/client_data.db — the most recent, most structurally similar
precedent in this app, and Matter Documents deliberately reuse case_vault
directly (case_id = 'matter:<id>') rather than a parallel storage table.

Every matters/teams row gets a real owner_user_id from creation onward —
unlike Case Vault's legacy NULL-is-shared carve-out (which exists only for
pre-existing rows that predate any ownership boundary), there is no such
legacy data here, so access is a plain owner-or-team-member check
(_matter_access_ok, defined in app.py alongside _vault_access_ok).
"""
import sqlite3
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity

matter_bp = Blueprint('matter', __name__)


def get_db():
    # Bare relative path — resolves transparently through app.py's
    # Persistent Disk symlink workaround, exactly like every other
    # sqlite3.connect('lex_assistant.db') call in this app.
    conn = sqlite3.connect('lex_assistant.db')
    conn.row_factory = sqlite3.Row
    return conn


def _uid():
    return int(get_jwt_identity())


def _matter_access_ok(conn, matter_row, current_user_id, require_owner=False):
    """Mirrors app.py's _matter_access_ok — duplicated here (not imported)
    to avoid a routes.matter_routes <-> app circular import, the same
    reason routes/team_routes.py duplicates _resolve_team_member_user_ids
    instead of importing it from app.py."""
    if int(matter_row['owner_user_id']) == int(current_user_id):
        return True
    if require_owner:
        return False
    if matter_row['team_id'] is not None:
        return conn.execute(
            'SELECT 1 FROM team_memberships WHERE team_id = ? AND user_id = ?',
            (matter_row['team_id'], current_user_id)
        ).fetchone() is not None
    return False


def _log_activity(conn, matter_id, text):
    conn.execute('INSERT INTO matter_activity (matter_id, text) VALUES (?, ?)', (matter_id, text))


def _get_matter_or_404(conn, matter_id, uid, require_owner=False):
    """Returns (row, error_response_or_None). Deliberately 404s (not 403)
    on an access-denied matter, same convention as Case Vault's
    authorization guards — don't disclose that a resource exists to a
    caller who can't see it."""
    row = conn.execute('SELECT * FROM matters WHERE id = ?', (matter_id,)).fetchone()
    if not row or not _matter_access_ok(conn, row, uid, require_owner=require_owner):
        return None, (jsonify({'error': True, 'message': 'Matter not found.'}), 404)
    return row, None


# ── Teams ────────────────────────────────────────────────────────────────
@matter_bp.route('/api/teams', methods=['GET', 'OPTIONS'])
@jwt_required()
def list_teams():
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = _uid()
    conn = get_db()
    try:
        rows = conn.execute('''
            SELECT DISTINCT t.* FROM teams t
            LEFT JOIN team_memberships tm ON tm.team_id = t.id
            WHERE t.owner_user_id = ? OR tm.user_id = ?
            ORDER BY t.created_at ASC
        ''', (uid, uid)).fetchall()
        return jsonify({'teams': [dict(r) for r in rows]}), 200
    finally:
        conn.close()


@matter_bp.route('/api/teams', methods=['POST', 'OPTIONS'])
@jwt_required()
def create_team():
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = _uid()
    data = request.get_json(force=True, silent=True) or {}
    name = (data.get('name') or '').strip()
    description = (data.get('description') or '').strip() or None
    if not name:
        return jsonify({'error': True, 'message': 'Team name is required.'}), 400
    conn = get_db()
    try:
        cur = conn.execute(
            'INSERT INTO teams (name, description, is_private, owner_user_id) VALUES (?, ?, 0, ?)',
            (name, description, uid)
        )
        team_id = cur.lastrowid
        conn.execute(
            "INSERT INTO team_memberships (team_id, user_id, role) VALUES (?, ?, 'owner')",
            (team_id, uid)
        )
        conn.commit()
        return jsonify({'success': True, 'id': team_id, 'name': name, 'description': description}), 201
    finally:
        conn.close()


@matter_bp.route('/api/teams/<int:team_id>/roster', methods=['GET', 'OPTIONS'])
@jwt_required()
def team_roster(team_id):
    """Python-side join against the User SQLAlchemy model, same pattern as
    app.py's _resolve_team_member_user_ids — team_memberships.user_id and
    users.id both refer to the same real accounts, but live in different
    physical databases in production (sqlite vs Postgres/Neon), so there
    is no SQL JOIN available here."""
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = _uid()
    conn = get_db()
    try:
        team = conn.execute('SELECT * FROM teams WHERE id = ?', (team_id,)).fetchone()
        if not team:
            return jsonify({'error': True, 'message': 'Team not found.'}), 404
        is_member = conn.execute(
            'SELECT 1 FROM team_memberships WHERE team_id = ? AND user_id = ?', (team_id, uid)
        ).fetchone() is not None
        if not is_member and int(team['owner_user_id']) != uid:
            return jsonify({'error': True, 'message': 'Team not found.'}), 404
        memberships = conn.execute(
            'SELECT user_id, role, created_at FROM team_memberships WHERE team_id = ? ORDER BY created_at ASC',
            (team_id,)
        ).fetchall()
    finally:
        conn.close()

    from models.user import User
    user_ids = [m['user_id'] for m in memberships]
    users_by_id = {u.id: u for u in User.query.filter(User.id.in_(user_ids)).all()} if user_ids else {}
    roster = []
    for m in memberships:
        u = users_by_id.get(m['user_id'])
        roster.append({
            'user_id': m['user_id'],
            'role': m['role'],
            'name': u.name if u else None,
            'email': u.email if u else None,
        })
    return jsonify({'roster': roster}), 200


# ── Matters ──────────────────────────────────────────────────────────────
@matter_bp.route('/api/matters', methods=['GET', 'OPTIONS'])
@jwt_required()
def list_matters():
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = _uid()
    team_id_filter = request.args.get('team_id', type=int)
    unassigned_only = request.args.get('unassigned') == '1'
    conn = get_db()
    try:
        rows = conn.execute('''
            SELECT DISTINCT m.* FROM matters m
            LEFT JOIN team_memberships tm ON tm.team_id = m.team_id
            WHERE m.owner_user_id = ? OR tm.user_id = ?
            ORDER BY m.created_at DESC
        ''', (uid, uid)).fetchall()
        matters = [dict(r) for r in rows]
        if unassigned_only:
            matters = [m for m in matters if m['team_id'] is None]
        elif team_id_filter is not None:
            matters = [m for m in matters if m['team_id'] == team_id_filter]
        return jsonify({'matters': matters}), 200
    finally:
        conn.close()


@matter_bp.route('/api/matters', methods=['POST', 'OPTIONS'])
@jwt_required()
def create_matter():
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = _uid()
    data = request.get_json(force=True, silent=True) or {}
    title = (data.get('title') or '').strip()
    team_id = data.get('team_id')
    lead_counsel = (data.get('lead_counsel') or '').strip() or None
    if not title:
        return jsonify({'error': True, 'message': 'Matter title is required.'}), 400

    conn = get_db()
    try:
        if team_id is not None:
            team = conn.execute('SELECT * FROM teams WHERE id = ?', (team_id,)).fetchone()
            if not team:
                return jsonify({'error': True, 'message': 'Team not found.'}), 404
            is_member = conn.execute(
                'SELECT 1 FROM team_memberships WHERE team_id = ? AND user_id = ?', (team_id, uid)
            ).fetchone() is not None
            if not is_member and int(team['owner_user_id']) != uid:
                return jsonify({'error': True, 'message': 'Team not found.'}), 404

        cur = conn.execute(
            "INSERT INTO matters (title, status, team_id, lead_counsel, opened_date, owner_user_id) "
            "VALUES (?, 'open', ?, ?, date('now'), ?)",
            (title, team_id, lead_counsel, uid)
        )
        matter_id = cur.lastrowid
        _log_activity(
            conn, matter_id,
            f'Matter created' + (' and added to a team' if team_id else ' — not yet on a team')
        )
        conn.commit()
        row = conn.execute('SELECT * FROM matters WHERE id = ?', (matter_id,)).fetchone()
        return jsonify({'success': True, 'matter': dict(row)}), 201
    finally:
        conn.close()


@matter_bp.route('/api/matters/<int:matter_id>', methods=['GET', 'OPTIONS'])
@jwt_required()
def get_matter(matter_id):
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = _uid()
    conn = get_db()
    try:
        row, err = _get_matter_or_404(conn, matter_id, uid)
        if err:
            return err
        return jsonify({'matter': dict(row)}), 200
    finally:
        conn.close()


@matter_bp.route('/api/matters/<int:matter_id>', methods=['PATCH', 'OPTIONS'])
@jwt_required()
def update_matter(matter_id):
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = _uid()
    data = request.get_json(force=True, silent=True) or {}
    conn = get_db()
    try:
        row, err = _get_matter_or_404(conn, matter_id, uid)
        if err:
            return err
        if 'status' in data:
            conn.execute('UPDATE matters SET status = ? WHERE id = ?', (data['status'], matter_id))
        if 'lead_counsel' in data:
            conn.execute('UPDATE matters SET lead_counsel = ? WHERE id = ?', (data['lead_counsel'], matter_id))
        conn.commit()
        updated = conn.execute('SELECT * FROM matters WHERE id = ?', (matter_id,)).fetchone()
        return jsonify({'success': True, 'matter': dict(updated)}), 200
    finally:
        conn.close()


@matter_bp.route('/api/matters/<int:matter_id>/team', methods=['PATCH', 'OPTIONS'])
@jwt_required()
def assign_matter_team(matter_id):
    """Powers the 'add an existing (incl. unassigned) matter to a team'
    flow — the piece that didn't exist anywhere before this round."""
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = _uid()
    data = request.get_json(force=True, silent=True) or {}
    team_id = data.get('team_id')
    if not team_id:
        return jsonify({'error': True, 'message': 'team_id is required.'}), 400
    conn = get_db()
    try:
        row, err = _get_matter_or_404(conn, matter_id, uid, require_owner=True)
        if err:
            return err
        team = conn.execute('SELECT * FROM teams WHERE id = ?', (team_id,)).fetchone()
        if not team:
            return jsonify({'error': True, 'message': 'Team not found.'}), 404
        is_member = conn.execute(
            'SELECT 1 FROM team_memberships WHERE team_id = ? AND user_id = ?', (team_id, uid)
        ).fetchone() is not None
        if not is_member and int(team['owner_user_id']) != uid:
            return jsonify({'error': True, 'message': 'Team not found.'}), 404

        conn.execute('UPDATE matters SET team_id = ? WHERE id = ?', (team_id, matter_id))
        _log_activity(conn, matter_id, f"Added to team: {team['name']}")
        conn.commit()
        updated = conn.execute('SELECT * FROM matters WHERE id = ?', (matter_id,)).fetchone()
        return jsonify({'success': True, 'matter': dict(updated)}), 200
    finally:
        conn.close()


# ── Deadlines ────────────────────────────────────────────────────────────
@matter_bp.route('/api/matters/<int:matter_id>/deadlines', methods=['GET', 'OPTIONS'])
@jwt_required()
def list_deadlines(matter_id):
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = _uid()
    conn = get_db()
    try:
        _, err = _get_matter_or_404(conn, matter_id, uid)
        if err:
            return err
        rows = conn.execute(
            'SELECT * FROM deadlines WHERE matter_id = ? ORDER BY date ASC', (matter_id,)
        ).fetchall()
        return jsonify({'deadlines': [dict(r) for r in rows]}), 200
    finally:
        conn.close()


@matter_bp.route('/api/matters/<int:matter_id>/deadlines', methods=['POST', 'OPTIONS'])
@jwt_required()
def create_deadline(matter_id):
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = _uid()
    data = request.get_json(force=True, silent=True) or {}
    title = (data.get('title') or '').strip()
    date = data.get('date')
    description = (data.get('description') or '').strip() or None
    ai_extracted = bool(data.get('ai_extracted'))
    if not title or not date:
        return jsonify({'error': True, 'message': 'A deadline needs a title and a date.'}), 400
    conn = get_db()
    try:
        _, err = _get_matter_or_404(conn, matter_id, uid, require_owner=False)
        if err:
            return err
        cur = conn.execute(
            'INSERT INTO deadlines (matter_id, title, date, description, ai_extracted) VALUES (?, ?, ?, ?, ?)',
            (matter_id, title, date, description, 1 if ai_extracted else 0)
        )
        _log_activity(conn, matter_id, f'Added deadline: {title}')
        conn.commit()
        row = conn.execute('SELECT * FROM deadlines WHERE id = ?', (cur.lastrowid,)).fetchone()
        return jsonify({'success': True, 'deadline': dict(row)}), 201
    finally:
        conn.close()


# ── Tasks ────────────────────────────────────────────────────────────────
@matter_bp.route('/api/matters/<int:matter_id>/tasks', methods=['GET', 'OPTIONS'])
@jwt_required()
def list_matter_tasks(matter_id):
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = _uid()
    conn = get_db()
    try:
        _, err = _get_matter_or_404(conn, matter_id, uid)
        if err:
            return err
        rows = conn.execute(
            'SELECT * FROM tasks_matter WHERE matter_id = ? ORDER BY created_at ASC', (matter_id,)
        ).fetchall()
        return jsonify({'tasks': [dict(r) for r in rows]}), 200
    finally:
        conn.close()


@matter_bp.route('/api/matters/<int:matter_id>/tasks', methods=['POST', 'OPTIONS'])
@jwt_required()
def create_matter_task(matter_id):
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = _uid()
    data = request.get_json(force=True, silent=True) or {}
    title = (data.get('title') or '').strip()
    if not title:
        return jsonify({'error': True, 'message': 'Give the task a title.'}), 400
    conn = get_db()
    try:
        _, err = _get_matter_or_404(conn, matter_id, uid)
        if err:
            return err
        cur = conn.execute('INSERT INTO tasks_matter (matter_id, title) VALUES (?, ?)', (matter_id, title))
        conn.commit()
        row = conn.execute('SELECT * FROM tasks_matter WHERE id = ?', (cur.lastrowid,)).fetchone()
        return jsonify({'success': True, 'task': dict(row)}), 201
    finally:
        conn.close()


@matter_bp.route('/api/matters/<int:matter_id>/tasks/<int:task_id>', methods=['PATCH', 'OPTIONS'])
@jwt_required()
def toggle_matter_task(matter_id, task_id):
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = _uid()
    data = request.get_json(force=True, silent=True) or {}
    conn = get_db()
    try:
        _, err = _get_matter_or_404(conn, matter_id, uid)
        if err:
            return err
        task = conn.execute('SELECT * FROM tasks_matter WHERE id = ? AND matter_id = ?', (task_id, matter_id)).fetchone()
        if not task:
            return jsonify({'error': True, 'message': 'Task not found.'}), 404
        done = bool(data.get('done', not task['done']))
        conn.execute('UPDATE tasks_matter SET done = ? WHERE id = ?', (1 if done else 0, task_id))
        if done:
            _log_activity(conn, matter_id, f"Completed task: {task['title']}")
        conn.commit()
        updated = conn.execute('SELECT * FROM tasks_matter WHERE id = ?', (task_id,)).fetchone()
        return jsonify({'success': True, 'task': dict(updated)}), 200
    finally:
        conn.close()


# ── Handoff notes ────────────────────────────────────────────────────────
@matter_bp.route('/api/matters/<int:matter_id>/notes', methods=['GET', 'OPTIONS'])
@jwt_required()
def list_notes(matter_id):
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = _uid()
    conn = get_db()
    try:
        _, err = _get_matter_or_404(conn, matter_id, uid)
        if err:
            return err
        rows = conn.execute(
            'SELECT * FROM handoff_notes WHERE matter_id = ? ORDER BY created_at DESC', (matter_id,)
        ).fetchall()
    finally:
        conn.close()

    from models.user import User
    author_ids = list({r['author_user_id'] for r in rows})
    users_by_id = {u.id: u for u in User.query.filter(User.id.in_(author_ids)).all()} if author_ids else {}
    notes = []
    for r in rows:
        d = dict(r)
        author = users_by_id.get(r['author_user_id'])
        d['author_name'] = author.name if author else 'Unknown'
        notes.append(d)
    return jsonify({'notes': notes}), 200


@matter_bp.route('/api/matters/<int:matter_id>/notes', methods=['POST', 'OPTIONS'])
@jwt_required()
def create_note(matter_id):
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = _uid()
    data = request.get_json(force=True, silent=True) or {}
    text = (data.get('text') or '').strip()
    if not text:
        return jsonify({'error': True, 'message': 'Write a note first.'}), 400
    conn = get_db()
    try:
        _, err = _get_matter_or_404(conn, matter_id, uid)
        if err:
            return err
        cur = conn.execute(
            'INSERT INTO handoff_notes (matter_id, author_user_id, text) VALUES (?, ?, ?)',
            (matter_id, uid, text)
        )
        _log_activity(conn, matter_id, 'Posted a handoff note')
        conn.commit()
        row = conn.execute('SELECT * FROM handoff_notes WHERE id = ?', (cur.lastrowid,)).fetchone()
        return jsonify({'success': True, 'note': dict(row)}), 201
    finally:
        conn.close()


# ── Documents (reuses case_vault directly — see module docstring) ────────
@matter_bp.route('/api/matters/<int:matter_id>/documents', methods=['GET', 'OPTIONS'])
@jwt_required()
def list_matter_documents(matter_id):
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = _uid()
    conn = get_db()
    try:
        _, err = _get_matter_or_404(conn, matter_id, uid)
        if err:
            return err
        case_id = f'matter:{matter_id}'
        rows = conn.execute(
            "SELECT id, COALESCE(smart_title, title) AS title, file_format, tags, "
            "LENGTH(file_blob) AS size_bytes, created_at "
            "FROM case_vault WHERE case_id = ? AND (user_id IS NULL OR user_id = ?) "
            "ORDER BY created_at DESC",
            (case_id, uid)
        ).fetchall()
        return jsonify({'documents': [dict(r) for r in rows]}), 200
    finally:
        conn.close()


# ── Activity ─────────────────────────────────────────────────────────────
@matter_bp.route('/api/matters/<int:matter_id>/activity', methods=['GET', 'OPTIONS'])
@jwt_required()
def list_activity(matter_id):
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = _uid()
    conn = get_db()
    try:
        _, err = _get_matter_or_404(conn, matter_id, uid)
        if err:
            return err
        rows = conn.execute(
            'SELECT * FROM matter_activity WHERE matter_id = ? ORDER BY id DESC LIMIT 100', (matter_id,)
        ).fetchall()
        return jsonify({'activity': [dict(r) for r in rows]}), 200
    finally:
        conn.close()


@matter_bp.route('/api/matters/<int:matter_id>/activity', methods=['POST', 'OPTIONS'])
@jwt_required()
def append_activity(matter_id):
    """Rarely needed directly from the frontend (mutation routes above
    already log their own activity server-side) — kept for any future
    action that has no other natural endpoint of its own."""
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = _uid()
    data = request.get_json(force=True, silent=True) or {}
    text = (data.get('text') or '').strip()
    if not text:
        return jsonify({'error': True, 'message': 'Activity text is required.'}), 400
    conn = get_db()
    try:
        _, err = _get_matter_or_404(conn, matter_id, uid)
        if err:
            return err
        _log_activity(conn, matter_id, text)
        conn.commit()
        return jsonify({'success': True}), 201
    finally:
        conn.close()
