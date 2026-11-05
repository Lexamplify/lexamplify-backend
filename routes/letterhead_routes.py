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
TEMPLATE_DIR = os.path.join('instance', 'letterhead_templates')
ALLOWED_LOGO_EXT = {'.png', '.jpg', '.jpeg', '.svg'}
ALLOWED_HEADER_EXT = {'.png', '.jpg', '.jpeg'}
ALLOWED_TEMPLATE_EXT = {'.docx'}
MAX_LOGO_SIZE = 2 * 1024 * 1024  # 2 MB
MAX_HEADER_SIZE = 5 * 1024 * 1024  # 5 MB
MAX_TEMPLATE_SIZE = 10 * 1024 * 1024  # 10 MB


def _db_path():
    from flask import current_app
    return current_app.extensions.get('lpms_db_path') or 'instance/database.db'

def get_db():
    conn = sqlite3.connect(_db_path())
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
            'template_docx': 'TEXT', 'design': 'TEXT',
        }
        for col, typedef in _new.items():
            if col not in cols:
                conn.execute(f'ALTER TABLE letterheads ADD COLUMN {col} {typedef}')
        conn.commit()
    except Exception:
        pass
    _SCHEMA_CHECKED = True

_EXTRA_FIELDS = ('enrolment_number', 'bar_council', 'courts',
                 'qualifications', 'gstin', 'ref_format', 'accent_color', 'design')

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


# ── DOCX letterhead template: one upload carrying BOTH header & footer ──
# The firm designs their letterhead once in Word (header, footer, logo,
# colours, page numbers) and uploads that .docx. On export we open their
# file as the base document and inject the drafted body, so the whole
# letterhead renders exactly as designed — no separate header/footer
# images, no auto-recognition guesswork.
def _validate_docx(f):
    """Confirm an uploaded file is a real .docx (a ZIP whose contents
    look like a WordprocessingML package), not just a renamed file."""
    import zipfile
    try:
        f.seek(0)
        with zipfile.ZipFile(f) as zf:
            names = set(zf.namelist())
            ok = '[Content_Types].xml' in names and any(
                n.startswith('word/') for n in names)
        f.seek(0)
        return ok
    except Exception:
        f.seek(0)
        return False


@letterhead_bp.route('/api/letterheads/<int:letterhead_id>/template-docx', methods=['POST', 'OPTIONS'])
@jwt_required()
def upload_template_docx(letterhead_id):
    """Upload a full Word letterhead template (.docx, max 10 MB)."""
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = _uid()
    conn = get_db()
    try:
        row = conn.execute('SELECT * FROM letterheads WHERE id = ?', (letterhead_id,)).fetchone()
        if not row or int(row['owner_user_id']) != uid:
            return jsonify({'error': True, 'message': 'Letterhead not found.'}), 404
        f = request.files.get('template')
        if not f or not f.filename:
            return jsonify({'error': True, 'message': 'No file uploaded.'}), 400
        ext = os.path.splitext(f.filename)[1].lower()
        if ext not in ALLOWED_TEMPLATE_EXT:
            return jsonify({'error': True, 'message': 'Only Word .docx templates are allowed.'}), 400
        f.seek(0, 2)
        if f.tell() > MAX_TEMPLATE_SIZE:
            return jsonify({'error': True, 'message': 'Template must be under 10 MB.'}), 400
        f.seek(0)
        if not _validate_docx(f):
            return jsonify({'error': True, 'message': 'That file is not a valid Word .docx document.'}), 400
        os.makedirs(TEMPLATE_DIR, exist_ok=True)
        fname = f'{letterhead_id}_{secure_filename(f.filename)}'
        path = os.path.join(TEMPLATE_DIR, fname)
        f.save(path)
        conn.execute('UPDATE letterheads SET template_docx = ? WHERE id = ?', (path, letterhead_id))
        conn.commit()
        updated = conn.execute('SELECT * FROM letterheads WHERE id = ?', (letterhead_id,)).fetchone()
        return jsonify({'letterhead': dict(updated)}), 200
    finally:
        conn.close()


@letterhead_bp.route('/api/letterheads/<int:letterhead_id>/template-docx', methods=['GET'])
@jwt_required()
def get_template_docx(letterhead_id):
    uid = _uid()
    conn = get_db()
    try:
        row = conn.execute('SELECT * FROM letterheads WHERE id = ?', (letterhead_id,)).fetchone()
        if not row or int(row['owner_user_id']) != uid:
            return jsonify({'error': True, 'message': 'Not found.'}), 404
        tpl = row['template_docx']
        if not tpl or not os.path.isfile(tpl):
            return jsonify({'error': True, 'message': 'No template.'}), 404
        return send_file(os.path.abspath(tpl),
                         download_name=os.path.basename(tpl), as_attachment=True)
    finally:
        conn.close()


@letterhead_bp.route('/api/letterheads/<int:letterhead_id>/template-docx', methods=['DELETE'])
@jwt_required()
def delete_template_docx(letterhead_id):
    uid = _uid()
    conn = get_db()
    try:
        row = conn.execute('SELECT * FROM letterheads WHERE id = ?', (letterhead_id,)).fetchone()
        if not row or int(row['owner_user_id']) != uid:
            return jsonify({'error': True, 'message': 'Not found.'}), 404
        tpl = row['template_docx']
        if tpl and os.path.isfile(tpl):
            os.remove(tpl)
        conn.execute('UPDATE letterheads SET template_docx = NULL WHERE id = ?', (letterhead_id,))
        conn.commit()
        return jsonify({'success': True}), 200
    finally:
        conn.close()


@letterhead_bp.route('/api/letterheads/<int:letterhead_id>/template-preview.png', methods=['GET'])
@jwt_required()
def get_template_preview_png(letterhead_id):
    """Render the first page of the uploaded Word template as a PNG so the
    editor can show a real visual preview (not just 'template.docx uploaded').
    Uses MS Word COM on Windows first, LibreOffice headless as a fallback."""
    from flask import Response
    from utils.docx_preview import render_docx_first_page_png, preview_available
    uid = _uid()
    conn = get_db()
    try:
        row = conn.execute('SELECT * FROM letterheads WHERE id = ?', (letterhead_id,)).fetchone()
        if not row or int(row['owner_user_id']) != uid:
            return jsonify({'error': True, 'message': 'Not found.'}), 404
        tpl = row['template_docx']
        if not tpl or not os.path.isfile(tpl):
            return jsonify({'error': True, 'message': 'No template uploaded.'}), 404
    finally:
        conn.close()
    png = render_docx_first_page_png(os.path.abspath(tpl), dpi=150)
    if png is None:
        avail = preview_available()
        return jsonify({
            'error': True,
            'message': 'Preview backend unavailable. Install LibreOffice or MS Word.',
            'available': avail,
        }), 501
    resp = Response(png, mimetype='image/png')
    # Cache for 10 minutes — the file is content-hashed in docx_preview too,
    # so a re-upload invalidates the backend cache on its own.
    resp.headers['Cache-Control'] = 'private, max-age=600'
    return resp


@letterhead_bp.route('/api/letterheads/template-preview.png', methods=['POST', 'OPTIONS'])
@jwt_required()
def post_template_preview_png():
    """Render the first page of a JUST-SELECTED .docx template that has NOT
    been saved yet. The editor posts the file here so the user sees a preview
    immediately, before clicking Save. Renders to a scratch temp file, never
    touches the DB."""
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    from flask import Response
    import tempfile
    from utils.docx_preview import render_docx_first_page_png, preview_available
    f = request.files.get('template')
    if not f or not f.filename:
        return jsonify({'error': True, 'message': 'No file uploaded.'}), 400
    if os.path.splitext(f.filename)[1].lower() not in ALLOWED_TEMPLATE_EXT:
        return jsonify({'error': True, 'message': 'Only Word .docx templates are allowed.'}), 400
    f.seek(0, 2)
    if f.tell() > MAX_TEMPLATE_SIZE:
        return jsonify({'error': True, 'message': 'Template must be under 10 MB.'}), 400
    f.seek(0)
    if not _validate_docx(f):
        return jsonify({'error': True, 'message': 'That file is not a valid Word .docx document.'}), 400
    tmpdir = tempfile.mkdtemp(prefix='lh_prev_up_')
    tmp = os.path.join(tmpdir, 'preview.docx')
    try:
        f.save(tmp)
        png = render_docx_first_page_png(os.path.abspath(tmp), dpi=150)
    finally:
        try:
            os.remove(tmp)
            os.rmdir(tmpdir)
        except Exception:
            pass
    if png is None:
        return jsonify({
            'error': True,
            'message': 'Preview backend unavailable. Install LibreOffice or MS Word on the server.',
            'available': preview_available(),
        }), 501
    resp = Response(png, mimetype='image/png')
    resp.headers['Cache-Control'] = 'no-store'
    return resp


@letterhead_bp.route('/api/letterheads/preview-capabilities', methods=['GET'])
@jwt_required()
def get_preview_capabilities():
    """Lets the frontend know whether a visual preview will work at all,
    so the Word-template tab can show a helpful install hint when it won't."""
    from utils.docx_preview import preview_available
    return jsonify(preview_available()), 200
