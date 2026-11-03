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
    # Phase 6: letterheads filtered by active workspace (NULL = firm-wide,
    # visible everywhere).
    from utils.workspace_scope import current_workspace_id as _wsid
    _ws = _wsid()
    conn = get_db()
    try:
        if _ws is not None:
            rows = conn.execute(
                'SELECT * FROM letterheads WHERE owner_user_id = ? '
                'AND (workspace_id = ? OR workspace_id IS NULL) '
                'ORDER BY created_at ASC',
                (uid, _ws),
            ).fetchall()
        else:
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
    # Pipeline item 5: optional dedicated footer so the firm can design
    # footer text separately (confidentiality notice, page numbering
    # directive, etc.) instead of being limited to address + contact.
    footer = (data.get('footer') or '').strip() or None
    auto_detected = 1 if data.get('autoDetected') else 0
    from utils.workspace_scope import current_workspace_id as _wsid
    _ws = _wsid()
    conn = get_db()
    try:
        cur = conn.execute(
            'INSERT INTO letterheads (owner_user_id, name, tagline, address, contact, footer, auto_detected, workspace_id) '
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            (uid, name, tagline, address, contact, footer, auto_detected, _ws)
        )
        conn.commit()
        row = conn.execute('SELECT * FROM letterheads WHERE id = ?', (cur.lastrowid,)).fetchone()
        return jsonify({'letterhead': dict(row)}), 201
    except sqlite3.Error as e:
        # Surface the real DB error so the frontend can show something
        # better than a bare 500. Also log for the backend tail.
        import traceback
        traceback.print_exc()
        return jsonify({'error': True, 'message': f'Database error: {e}'}), 500
    finally:
        conn.close()


@letterhead_bp.route('/api/letterheads/<int:letterhead_id>', methods=['PUT', 'OPTIONS'])
@jwt_required()
def update_letterhead(letterhead_id):
    """Edit an existing letterhead (owner-only). Lawyer can change the
    firm name, tagline, address, contact or footer line without having
    to delete and re-create. Partial updates allowed — any field not in
    the payload keeps its current value."""
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = _uid()
    data = request.get_json(force=True, silent=True) or {}
    conn = get_db()
    try:
        row = conn.execute('SELECT * FROM letterheads WHERE id = ?', (letterhead_id,)).fetchone()
        if not row or int(row['owner_user_id']) != uid:
            return jsonify({'error': True, 'message': 'Letterhead not found.'}), 404
        current = dict(row)
        # Partial update: only overwrite fields present in payload.
        new_name = (data.get('name') if 'name' in data else current['name'] or '').strip()
        if not new_name:
            return jsonify({'error': True, 'message': 'Firm name is required.'}), 400
        new_tagline = (data.get('tagline') if 'tagline' in data else current['tagline'] or '').strip() or None
        new_address = (data.get('address') if 'address' in data else current['address'] or '').strip() or None
        new_contact = (data.get('contact') if 'contact' in data else current['contact'] or '').strip() or None
        new_footer = (data.get('footer') if 'footer' in data else current['footer'] or '').strip() or None
        conn.execute(
            'UPDATE letterheads SET name = ?, tagline = ?, address = ?, contact = ?, footer = ? WHERE id = ?',
            (new_name, new_tagline, new_address, new_contact, new_footer, letterhead_id),
        )
        conn.commit()
        updated = conn.execute('SELECT * FROM letterheads WHERE id = ?', (letterhead_id,)).fetchone()
        return jsonify({'letterhead': dict(updated)}), 200
    except sqlite3.Error as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': True, 'message': f'Database error: {e}'}), 500
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
