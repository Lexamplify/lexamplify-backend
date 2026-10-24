"""
routes/causelist_routes.py
Case Management — Cause List, Case Tracker, Hearing Calendar, ICS Export, IP Assets
"""
import os
import json
import sqlite3
from datetime import datetime, date
from flask import Blueprint, request, jsonify, render_template, current_app, send_file
import io
from utils import tenancy

causelist_bp = Blueprint('causelist', __name__)


OWNED_TABLES = ('tracked_cases', 'ip_assets')


def get_db():
    conn = sqlite3.connect(current_app.config['SQLITE_DB_PATH'])
    tenancy.prepare(conn, 'causelist', OWNED_TABLES, tenancy.current_uid())
    return conn


def owner():
    return tenancy.current_uid()


# ── PAGE ──────────────────────────────────────────────────────────────────────

@causelist_bp.route('/case-management')
def case_management():
    return render_template('causelist.html')


# ── CAUSE LIST FETCH ──────────────────────────────────────────────────────────

# CNR → the right court's official status/cause-list portal. India has no public
# eCourts JSON API (the real CNR service is a CAPTCHA-gated POST), so we never
# claim to have fetched a case — we resolve the CNR to the correct portal and let
# the advocate open it. Nothing about a case is ever invented on eCourts' behalf.
_CNR_PORTALS = (
    ("DLHC", "Delhi High Court", "https://delhihighcourt.nic.in/case-status"),
    ("MUBH", "Bombay High Court", "https://bombayhighcourt.nic.in/casestatus.php"),
    ("BOM", "Bombay High Court", "https://bombayhighcourt.nic.in/casestatus.php"),
    ("MDR", "Madras High Court", "https://www.mhc.tn.gov.in/judis"),
    ("MAD", "Madras High Court", "https://www.mhc.tn.gov.in/judis"),
    ("KAR", "Karnataka High Court", "https://karnatakajudiciary.kar.nic.in"),
    ("ALL", "Allahabad High Court", "https://www.allahabadhighcourt.in/apps/casestatus"),
    ("GJHC", "Gujarat High Court", "https://gujarathighcourt.nic.in/casestatus"),
    ("APHC", "Andhra Pradesh High Court", "https://aphc.gov.in"),
    ("TLHC", "Telangana High Court", "https://tshc.gov.in"),
    ("KLHC", "Kerala High Court", "https://highcourtofkerala.nic.in"),
    ("PBHC", "Punjab & Haryana High Court", "https://highcourtchd.gov.in"),
    ("CGHC", "Chhattisgarh High Court", "https://highcourt.cg.gov.in"),
    ("INSC", "Supreme Court of India", "https://www.sci.gov.in/case-status-case-no/"),
    ("SC", "Supreme Court of India", "https://www.sci.gov.in/case-status-case-no/"),
)


@causelist_bp.route('/api/causelist/fetch', methods=['POST'])
def fetch_causelist():
    data = request.get_json() or {}
    cnr = (data.get('cnr_number') or data.get('cnr') or '').strip()

    if not cnr:
        return jsonify({'error': 'CNR number is required'}), 400

    cnr_upper = cnr.upper()
    court_name = "District / Subordinate Courts"
    portal_url = "https://services.ecourts.gov.in/ecourtindia_v6/"
    for marker, name, url in _CNR_PORTALS:
        if marker in cnr_upper or cnr_upper.startswith(marker):
            court_name, portal_url = name, url
            break

    # Honest response: we resolved the portal, we did NOT fetch the case.
    return jsonify({
        'source': 'portal',
        'cnr_number': cnr,
        'court': court_name,
        'portal_url': portal_url,
        'message': (
            f'Automated status lookup isn’t available for Indian courts. '
            f'Open the {court_name} portal to check this CNR, or add the matter '
            f'to your tracker manually.'
        ),
    }), 200


# ── CASE CRUD ─────────────────────────────────────────────────────────────────

@causelist_bp.route('/api/causelist/save', methods=['POST'])
def save_case():
    data = request.get_json() or {}
    case_name = data.get('case_name') or data.get('title')
    if not case_name:
        return jsonify({'error': 'case_name is required'}), 400

    conn = get_db()
    c = conn.cursor()
    
    cnr_val = data.get('cnr_number') or data.get('cnr') or ''
    next_hearing_val = data.get('next_hearing') or data.get('next_hearing_date')

    c.execute('''INSERT INTO tracked_cases
        (case_name, case_number, cnr_number, court, client_name, case_type,
         next_hearing, last_hearing, status, notes, cnr, title, next_hearing_date, owner_user_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)''', (
        case_name,
        data.get('case_number', ''),
        cnr_val,
        data.get('court', ''),
        data.get('client_name', ''),
        data.get('case_type', ''),
        next_hearing_val,
        data.get('last_hearing', None),
        data.get('status', 'Active'),
        data.get('notes', ''),
        cnr_val,
        case_name,
        next_hearing_val,
        owner(),
    ))
    conn.commit()
    new_id = c.lastrowid
    conn.close()
    return jsonify({'status': 'success', 'id': new_id}), 200


@causelist_bp.route('/api/causelist/list', methods=['GET'])
def list_cases():
    conn = get_db()
    conn.row_factory = sqlite3.Row
    rows = conn.execute('SELECT * FROM tracked_cases WHERE owner_user_id=? ORDER BY created_at DESC', (owner(),)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@causelist_bp.route('/api/causelist/update/<int:case_id>', methods=['PUT'])
def update_case(case_id):
    data = request.get_json() or {}
    case_name = data.get('case_name') or data.get('title')
    conn = get_db()
    
    cnr_val = data.get('cnr_number') or data.get('cnr') or ''
    next_hearing_val = data.get('next_hearing') or data.get('next_hearing_date')

    conn.execute('''UPDATE tracked_cases SET
        case_name=?, case_number=?, cnr_number=?, court=?, client_name=?,
        case_type=?, next_hearing=?, last_hearing=?, status=?, notes=?,
        cnr=?, title=?, next_hearing_date=?
        WHERE id=? AND owner_user_id=?''', (
        case_name,
        data.get('case_number', ''),
        cnr_val,
        data.get('court', ''),
        data.get('client_name', ''),
        data.get('case_type', ''),
        next_hearing_val,
        data.get('last_hearing', None),
        data.get('status', 'Active'),
        data.get('notes', ''),
        cnr_val,
        case_name,
        next_hearing_val,
        case_id,
        owner(),
    ))
    changed = conn.total_changes
    conn.commit()
    conn.close()
    if not changed:
        return jsonify({'error': 'not found'}), 404
    return jsonify({'status': 'success'}), 200


@causelist_bp.route('/api/causelist/delete/<int:case_id>', methods=['DELETE'])
def delete_case(case_id):
    conn = get_db()
    conn.execute('DELETE FROM tracked_cases WHERE id=? AND owner_user_id=?', (case_id, owner()))
    changed = conn.total_changes
    conn.commit()
    conn.close()
    if not changed:
        return jsonify({'error': 'not found'}), 404
    return jsonify({'status': 'deleted'}), 200


# ── ICS EXPORT ────────────────────────────────────────────────────────────────

@causelist_bp.route('/api/causelist/export-ics', methods=['GET'])
def export_ics():
    conn = get_db()
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT id, case_name, title, case_number, court, client_name, next_hearing, next_hearing_date FROM tracked_cases WHERE owner_user_id=?",
        (owner(),)
    ).fetchall()
    conn.close()

    lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//LexAI India//Court Hearings//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
    ]
    for r in rows:
        hearing_date = r['next_hearing'] or r['next_hearing_date']
        if not hearing_date:
            continue
        try:
            dt = datetime.strptime(str(hearing_date), '%Y-%m-%d')
            dtstr = dt.strftime('%Y%m%d')
        except Exception:
            continue
        
        c_name = r['case_name'] or r['title'] or "Unnamed Case"
        uid = f"lexai-{r['id']}@lexai-india.com"
        summary = f"Hearing - {c_name}"
        desc = f"Case: {r['case_number'] or '—'} | Court: {r['court'] or '—'} | Client: {r['client_name'] or '—'}"
        lines += [
            'BEGIN:VEVENT',
            f'UID:{uid}',
            f'DTSTART;VALUE=DATE:{dtstr}',
            f'SUMMARY:{summary}',
            f'DESCRIPTION:{desc}',
            'END:VEVENT',
        ]
    lines.append('END:VCALENDAR')

    ics_content = '\r\n'.join(lines)
    buf = io.BytesIO(ics_content.encode('utf-8'))
    buf.seek(0)
    return send_file(
        buf,
        mimetype='text/calendar',
        as_attachment=True,
        download_name='lexai_hearings.ics',
    )


# ── IP ASSETS ─────────────────────────────────────────────────────────────────

@causelist_bp.route('/api/ip/add', methods=['POST'])
def add_ip():
    data = request.get_json(silent=True) or {}
    try:
        conn = get_db()
        c = conn.cursor()
        c.execute('''INSERT INTO ip_assets
            (ip_type, title, registration_number, filing_date, renewal_due, status, notes, owner_user_id)
            VALUES (?,?,?,?,?,?,?,?)''', (
            data.get('ip_type', ''),
            data.get('title', ''),
            data.get('registration_number', ''),
            data.get('filing_date', None),
            data.get('renewal_due', None),
            data.get('status', 'Active'),
            data.get('notes', ''),
            owner(),
        ))
        conn.commit()
        new_id = c.lastrowid
        conn.close()
        return jsonify({'status': 'success', 'id': new_id})
    except Exception as e:
        return jsonify({"error": "Something went wrong. Please try again.", "code": "INTERNAL_ERROR"}), 500


@causelist_bp.route('/api/ip/list', methods=['GET'])
def list_ip():
    conn = get_db()
    conn.row_factory = sqlite3.Row
    rows = conn.execute('SELECT * FROM ip_assets WHERE owner_user_id=? ORDER BY renewal_due ASC', (owner(),)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@causelist_bp.route('/api/ip/update/<int:ip_id>', methods=['PUT'])
def update_ip(ip_id):
    data = request.get_json(silent=True) or {}
    try:
        conn = get_db()
        conn.execute('''UPDATE ip_assets SET
            ip_type=?, title=?, registration_number=?, filing_date=?,
            renewal_due=?, status=?, notes=? WHERE id=? AND owner_user_id=?''', (
            data.get('ip_type', ''),
            data.get('title', ''),
            data.get('registration_number', ''),
            data.get('filing_date', None),
            data.get('renewal_due', None),
            data.get('status', 'Active'),
            data.get('notes', ''),
            ip_id,
            owner(),
        ))
        changed = conn.total_changes
        conn.commit()
        conn.close()
        if not changed:
            return jsonify({'error': 'not found'}), 404
        return jsonify({'status': 'success'})
    except Exception as e:
        return jsonify({"error": "Something went wrong. Please try again.", "code": "INTERNAL_ERROR"}), 500


@causelist_bp.route('/api/ip/delete/<int:ip_id>', methods=['DELETE'])
def delete_ip(ip_id):
    conn = get_db()
    conn.execute('DELETE FROM ip_assets WHERE id=? AND owner_user_id=?', (ip_id, owner()))
    changed = conn.total_changes
    conn.commit()
    conn.close()
    if not changed:
        return jsonify({'error': 'not found'}), 404
    return jsonify({'status': 'deleted'})
