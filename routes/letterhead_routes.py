"""
routes/letterhead_routes.py
Auto-Draft Studio — per-user Letterhead persistence with Indian advocate
compliance fields, logo upload, and default-letterhead support.
"""
import os
import sqlite3
from flask import Blueprint, request, jsonify, send_file
from flask_jwt_extended import jwt_required, get_jwt_identity
from werkzeug.utils import secure_filename

letterhead_bp = Blueprint('letterhead', __name__)

LOGO_DIR = os.path.join('instance', 'letterhead_logos')
HEADER_IMG_DIR = os.path.join('instance', 'letterhead_headers')
ALLOWED_LOGO_EXT = {'.png', '.jpg', '.jpeg', '.svg'}
ALLOWED_HEADER_EXT = {'.png', '.jpg', '.jpeg'}
MAX_LOGO_SIZE = 2 * 1024 * 1024  # 2 MB
MAX_HEADER_SIZE = 5 * 1024 * 1024  # 5 MB


def get_db():
    conn = sqlite3.connect('lex_assistant.db')
    conn.row_factory = sqlite3.Row
    _ensure_schema(conn)
    return conn


_SCHEMA_CHECKED = False
def _ensure_schema(conn):
    """Idempotent column add — heals older DB files on first touch."""
    global _SCHEMA_CHECKED
    if _SCHEMA_CHECKED:
        return
    try:
        cols = {r[1] for r in conn.execute('PRAGMA table_info(letterheads)').fetchall()}
        _new = {
            'footer': 'TEXT', 'workspace_id': 'INTEGER',
            'logo_path': 'TEXT', 'header_image': 'TEXT',
            'is_default': 'INTEGER DEFAULT 0',
            'enrolment_number': 'TEXT', 'bar_council': 'TEXT',
            'courts': 'TEXT', 'qualifications': 'TEXT',
            'gstin': 'TEXT', 'ref_format': 'TEXT', 'accent_color': 'TEXT',
        }
        for col, typedef in _new.items():
            if col not in cols:
                conn.execute(f'ALTER TABLE letterheads ADD COLUMN {col} {typedef}')
        conn.commit()
    except Exception:
        pass
    _SCHEMA_CHECKED = True

_EXTRA_FIELDS = ('enrolment_number', 'bar_council', 'courts',
                 'qualifications', 'gstin', 'ref_format', 'accent_color')

def _str_field(data, key, current=None):
    val = data.get(key) if key in data else (current or '')
    return (val or '').strip() or None


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
    extras = {k: _str_field(data, k) for k in _EXTRA_FIELDS}
    conn = get_db()
    try:
        cols = 'owner_user_id, name, tagline, address, contact, footer, auto_detected, workspace_id'
        vals = [uid, name, tagline, address, contact, footer, auto_detected, _ws]
        for k in _EXTRA_FIELDS:
            cols += f', {k}'
            vals.append(extras[k])
        placeholders = ', '.join(['?'] * len(vals))
        cur = conn.execute(
            f'INSERT INTO letterheads ({cols}) VALUES ({placeholders})',
            vals
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
        extras = {k: _str_field(data, k, current.get(k)) for k in _EXTRA_FIELDS}
        set_clause = 'name = ?, tagline = ?, address = ?, contact = ?, footer = ?'
        params = [new_name, new_tagline, new_address, new_contact, new_footer]
        for k in _EXTRA_FIELDS:
            set_clause += f', {k} = ?'
            params.append(extras[k])
        params.append(letterhead_id)
        conn.execute(f'UPDATE letterheads SET {set_clause} WHERE id = ?', params)
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


@letterhead_bp.route('/api/letterheads/<int:letterhead_id>/logo', methods=['POST', 'OPTIONS'])
@jwt_required()
def upload_logo(letterhead_id):
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = _uid()
    conn = get_db()
    try:
        row = conn.execute('SELECT * FROM letterheads WHERE id = ?', (letterhead_id,)).fetchone()
        if not row or int(row['owner_user_id']) != uid:
            return jsonify({'error': True, 'message': 'Letterhead not found.'}), 404
        f = request.files.get('logo')
        if not f or not f.filename:
            return jsonify({'error': True, 'message': 'No file uploaded.'}), 400
        ext = os.path.splitext(f.filename)[1].lower()
        if ext not in ALLOWED_LOGO_EXT:
            return jsonify({'error': True, 'message': f'Only PNG, JPG, SVG allowed.'}), 400
        f.seek(0, 2)
        if f.tell() > MAX_LOGO_SIZE:
            return jsonify({'error': True, 'message': 'Logo must be under 2 MB.'}), 400
        f.seek(0)
        os.makedirs(LOGO_DIR, exist_ok=True)
        fname = f'{letterhead_id}_{secure_filename(f.filename)}'
        path = os.path.join(LOGO_DIR, fname)
        f.save(path)
        conn.execute('UPDATE letterheads SET logo_path = ? WHERE id = ?', (path, letterhead_id))
        conn.commit()
        updated = conn.execute('SELECT * FROM letterheads WHERE id = ?', (letterhead_id,)).fetchone()
        return jsonify({'letterhead': dict(updated)}), 200
    finally:
        conn.close()


@letterhead_bp.route('/api/letterheads/<int:letterhead_id>/logo', methods=['GET'])
@jwt_required()
def get_logo(letterhead_id):
    uid = _uid()
    conn = get_db()
    try:
        row = conn.execute('SELECT * FROM letterheads WHERE id = ?', (letterhead_id,)).fetchone()
        if not row or int(row['owner_user_id']) != uid:
            return jsonify({'error': True, 'message': 'Not found.'}), 404
        logo = row['logo_path']
        if not logo or not os.path.isfile(logo):
            return jsonify({'error': True, 'message': 'No logo.'}), 404
        return send_file(os.path.abspath(logo))
    finally:
        conn.close()


@letterhead_bp.route('/api/letterheads/<int:letterhead_id>/default', methods=['PUT', 'OPTIONS'])
@jwt_required()
def set_default(letterhead_id):
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = _uid()
    conn = get_db()
    try:
        row = conn.execute('SELECT * FROM letterheads WHERE id = ?', (letterhead_id,)).fetchone()
        if not row or int(row['owner_user_id']) != uid:
            return jsonify({'error': True, 'message': 'Letterhead not found.'}), 404
        conn.execute('UPDATE letterheads SET is_default = 0 WHERE owner_user_id = ?', (uid,))
        conn.execute('UPDATE letterheads SET is_default = 1 WHERE id = ?', (letterhead_id,))
        conn.commit()
        updated = conn.execute('SELECT * FROM letterheads WHERE id = ?', (letterhead_id,)).fetchone()
        return jsonify({'letterhead': dict(updated)}), 200
    finally:
        conn.close()


@letterhead_bp.route('/api/letterheads/<int:letterhead_id>/header-image', methods=['POST', 'OPTIONS'])
@jwt_required()
def upload_header_image(letterhead_id):
    """Upload a full letterhead header image (PNG/JPG, max 5 MB)."""
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = _uid()
    conn = get_db()
    try:
        row = conn.execute('SELECT * FROM letterheads WHERE id = ?', (letterhead_id,)).fetchone()
        if not row or int(row['owner_user_id']) != uid:
            return jsonify({'error': True, 'message': 'Letterhead not found.'}), 404
        f = request.files.get('header_image')
        if not f or not f.filename:
            return jsonify({'error': True, 'message': 'No file uploaded.'}), 400
        ext = os.path.splitext(f.filename)[1].lower()
        if ext not in ALLOWED_HEADER_EXT:
            return jsonify({'error': True, 'message': 'Only PNG and JPG allowed.'}), 400
        f.seek(0, 2)
        if f.tell() > MAX_HEADER_SIZE:
            return jsonify({'error': True, 'message': 'Header image must be under 5 MB.'}), 400
        f.seek(0)
        os.makedirs(HEADER_IMG_DIR, exist_ok=True)
        fname = f'{letterhead_id}_{secure_filename(f.filename)}'
        path = os.path.join(HEADER_IMG_DIR, fname)
        f.save(path)
        conn.execute('UPDATE letterheads SET header_image = ? WHERE id = ?', (path, letterhead_id))
        conn.commit()
        updated = conn.execute('SELECT * FROM letterheads WHERE id = ?', (letterhead_id,)).fetchone()
        return jsonify({'letterhead': dict(updated)}), 200
    finally:
        conn.close()


@letterhead_bp.route('/api/letterheads/<int:letterhead_id>/header-image', methods=['GET'])
@jwt_required()
def get_header_image(letterhead_id):
    uid = _uid()
    conn = get_db()
    try:
        row = conn.execute('SELECT * FROM letterheads WHERE id = ?', (letterhead_id,)).fetchone()
        if not row or int(row['owner_user_id']) != uid:
            return jsonify({'error': True, 'message': 'Not found.'}), 404
        img = row['header_image']
        if not img or not os.path.isfile(img):
            return jsonify({'error': True, 'message': 'No header image.'}), 404
        return send_file(os.path.abspath(img))
    finally:
        conn.close()


@letterhead_bp.route('/api/letterheads/<int:letterhead_id>/header-image', methods=['DELETE'])
@jwt_required()
def delete_header_image(letterhead_id):
    uid = _uid()
    conn = get_db()
    try:
        row = conn.execute('SELECT * FROM letterheads WHERE id = ?', (letterhead_id,)).fetchone()
        if not row or int(row['owner_user_id']) != uid:
            return jsonify({'error': True, 'message': 'Not found.'}), 404
        img = row['header_image']
        if img and os.path.isfile(img):
            os.remove(img)
        conn.execute('UPDATE letterheads SET header_image = NULL WHERE id = ?', (letterhead_id,))
        conn.commit()
        return jsonify({'success': True}), 200
    finally:
        conn.close()
