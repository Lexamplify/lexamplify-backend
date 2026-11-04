"""
routes/clause_routes.py
Reusable clause library — CRUD for per-user legal clauses.
Same pattern as letterhead_routes.py: own get_db() to lex_assistant.db,
owner-only access, idempotent schema creation.
"""
import sqlite3
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity

clause_bp = Blueprint('clause', __name__)


def get_db():
    conn = sqlite3.connect('lex_assistant.db')
    conn.row_factory = sqlite3.Row
    _ensure_schema(conn)
    return conn


_SCHEMA_CHECKED = False
def _ensure_schema(conn):
    global _SCHEMA_CHECKED
    if _SCHEMA_CHECKED:
        return
    conn.execute('''CREATE TABLE IF NOT EXISTS clauses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        category TEXT DEFAULT 'general',
        content TEXT NOT NULL,
        tags TEXT,
        workspace_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    conn.commit()
    _SCHEMA_CHECKED = True


def _uid():
    return int(get_jwt_identity())


@clause_bp.route('/api/clauses', methods=['GET'])
@jwt_required()
def list_clauses():
    uid = _uid()
    from utils.workspace_scope import current_workspace_id as _wsid
    _ws = _wsid()
    conn = get_db()
    try:
        if _ws is not None:
            rows = conn.execute(
                'SELECT * FROM clauses WHERE owner_user_id = ? AND (workspace_id = ? OR workspace_id IS NULL) ORDER BY created_at DESC',
                (uid, _ws)).fetchall()
        else:
            rows = conn.execute(
                'SELECT * FROM clauses WHERE owner_user_id = ? ORDER BY created_at DESC',
                (uid,)).fetchall()
        return jsonify({'clauses': [dict(r) for r in rows]})
    finally:
        conn.close()


@clause_bp.route('/api/clauses', methods=['POST'])
@jwt_required()
def create_clause():
    uid = _uid()
    data = request.get_json(silent=True) or {}
    title = (data.get('title') or '').strip()
    content = (data.get('content') or '').strip()
    if not title or not content:
        return jsonify({'message': 'Title and content are required.'}), 400
    category = (data.get('category') or 'general').strip()
    tags = (data.get('tags') or '').strip()

    from utils.workspace_scope import current_workspace_id as _wsid
    _ws = _wsid()

    conn = get_db()
    try:
        cur = conn.execute(
            'INSERT INTO clauses (owner_user_id, title, category, content, tags, workspace_id) VALUES (?, ?, ?, ?, ?, ?)',
            (uid, title, category, content, tags, _ws))
        conn.commit()
        row = conn.execute('SELECT * FROM clauses WHERE id = ?', (cur.lastrowid,)).fetchone()
        return jsonify({'clause': dict(row)}), 201
    finally:
        conn.close()


@clause_bp.route('/api/clauses/<int:clause_id>', methods=['PUT'])
@jwt_required()
def update_clause(clause_id):
    uid = _uid()
    data = request.get_json(silent=True) or {}
    conn = get_db()
    try:
        existing = conn.execute('SELECT * FROM clauses WHERE id = ? AND owner_user_id = ?', (clause_id, uid)).fetchone()
        if not existing:
            return jsonify({'message': 'Clause not found.'}), 404
        title = (data.get('title') or existing['title']).strip()
        content = (data.get('content') or existing['content']).strip()
        category = (data.get('category') or existing['category']).strip()
        tags = (data.get('tags') or existing['tags'] or '').strip()
        conn.execute('UPDATE clauses SET title=?, category=?, content=?, tags=? WHERE id=? AND owner_user_id=?',
                     (title, category, content, tags, clause_id, uid))
        conn.commit()
        row = conn.execute('SELECT * FROM clauses WHERE id = ?', (clause_id,)).fetchone()
        return jsonify({'clause': dict(row)})
    finally:
        conn.close()


@clause_bp.route('/api/clauses/<int:clause_id>', methods=['DELETE'])
@jwt_required()
def delete_clause(clause_id):
    uid = _uid()
    conn = get_db()
    try:
        existing = conn.execute('SELECT * FROM clauses WHERE id = ? AND owner_user_id = ?', (clause_id, uid)).fetchone()
        if not existing:
            return jsonify({'message': 'Clause not found.'}), 404
        conn.execute('DELETE FROM clauses WHERE id = ? AND owner_user_id = ?', (clause_id, uid))
        conn.commit()
        return jsonify({'ok': True})
    finally:
        conn.close()
