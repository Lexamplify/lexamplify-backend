"""
routes/letterhead_routes.py
Auto-Draft Studio v1 — real per-user Letterhead persistence, replacing the
old localStorage-only `userLetterheads` array in AutoDraftWorkspace.jsx.
Lives in lex_assistant.db, same pattern as routes/matter_routes.py: own
get_db(), owner-only access (no team-sharing concept for letterheads).
"""
import sqlite3
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity

letterhead_bp = Blueprint('letterhead', __name__)


def get_db():
    conn = sqlite3.connect('lex_assistant.db')
    conn.row_factory = sqlite3.Row
    return conn


def _uid():
    return int(get_jwt_identity())


@letterhead_bp.route('/api/letterheads', methods=['GET', 'OPTIONS'])
@jwt_required()
def list_letterheads():
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = _uid()
    conn = get_db()
    try:
        rows = conn.execute(
            'SELECT * FROM letterheads WHERE owner_user_id = ? ORDER BY created_at ASC',
            (uid,)
        ).fetchall()
        return jsonify({'letterheads': [dict(r) for r in rows]}), 200
    finally:
        conn.close()


@letterhead_bp.route('/api/letterheads', methods=['POST', 'OPTIONS'])
@jwt_required()
def create_letterhead():
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = _uid()
    data = request.get_json(force=True, silent=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': True, 'message': 'Firm name is required.'}), 400
    tagline = (data.get('tagline') or '').strip() or None
    address = (data.get('address') or '').strip() or None
    contact = (data.get('contact') or '').strip() or None
    auto_detected = 1 if data.get('autoDetected') else 0
    conn = get_db()
    try:
        cur = conn.execute(
            'INSERT INTO letterheads (owner_user_id, name, tagline, address, contact, auto_detected) VALUES (?, ?, ?, ?, ?, ?)',
            (uid, name, tagline, address, contact, auto_detected)
        )
        conn.commit()
        row = conn.execute('SELECT * FROM letterheads WHERE id = ?', (cur.lastrowid,)).fetchone()
        return jsonify({'letterhead': dict(row)}), 201
    finally:
        conn.close()


@letterhead_bp.route('/api/letterheads/<int:letterhead_id>', methods=['DELETE', 'OPTIONS'])
@jwt_required()
def delete_letterhead(letterhead_id):
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = _uid()
    conn = get_db()
    try:
        row = conn.execute('SELECT * FROM letterheads WHERE id = ?', (letterhead_id,)).fetchone()
        if not row or int(row['owner_user_id']) != uid:
            return jsonify({'error': True, 'message': 'Letterhead not found.'}), 404
        conn.execute('DELETE FROM letterheads WHERE id = ?', (letterhead_id,))
        conn.commit()
        return jsonify({'success': True}), 200
    finally:
        conn.close()
