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

causelist_bp = Blueprint('causelist', __name__)


def get_db():
    return sqlite3.connect(current_app.config['SQLITE_DB_PATH'])


# ── PAGE ──────────────────────────────────────────────────────────────────────

@causelist_bp.route('/case-management')
def case_management():
    return render_template('causelist.html')


# ── CAUSE LIST FETCH ──────────────────────────────────────────────────────────

@causelist_bp.route('/api/causelist/fetch', methods=['POST'])
def fetch_causelist():
    data = request.get_json()
    cnr = (data.get('cnr_number') or '').strip()
    court = (data.get('court') or 'Supreme Court').strip()

    court_urls = {
        'Supreme Court': 'https://sci.gov.in/causelist',
        'Delhi HC': 'https://delhihighcourt.nic.in/causelist',
        'Bombay HC': 'https://bombayhighcourt.nic.in/causelist',
        'Madras HC': 'https://hcmadras.tn.gov.in/causelist',
        'Karnataka HC': 'https://karnatakajudiciary.kar.nic.in',
        'Allahabad HC': 'https://www.allahabadhighcourt.in',
        'District Court': 'https://services.ecourts.gov.in',
    }

    if not cnr:
        return jsonify({'error': 'CNR number is required'}), 400

    # Try eCourts API
    try:
        import requests as req
        api_url = f'https://services.ecourts.gov.in/ecourtindia_v6/cases/case_details_get?cnr_number={cnr}'
        r = req.get(api_url, timeout=8)
        if r.status_code == 200:
            payload = r.json()
            case_details = payload.get('case_details') or payload
            return jsonify({
                'source': 'ecourts',
                'case_title': case_details.get('case_title') or case_details.get('party_name', 'Unknown'),
                'case_number': case_details.get('case_number', cnr),
                'next_hearing': case_details.get('next_hearing_date', '—'),
                'court': court,
                'judge': case_details.get('judge_name', '—'),
                'status': case_details.get('case_status', 'Active'),
            })
    except Exception:
        pass

    # Fallback: return the official court URL for the browser to open
    fallback_url = court_urls.get(court, 'https://services.ecourts.gov.in')
    return jsonify({
        'source': 'fallback',
        'fallback_url': f'{fallback_url}',
        'message': f'eCourts API unavailable. Opening {court} cause list portal.',
        'cnr_number': cnr,
    })


# ── CASE CRUD ─────────────────────────────────────────────────────────────────

@causelist_bp.route('/api/causelist/save', methods=['POST'])
def save_case():
    data = request.get_json()
    required = ['case_name']
    if not data or not data.get('case_name'):
        return jsonify({'error': 'case_name is required'}), 400

    conn = get_db()
    c = conn.cursor()
    c.execute('''INSERT INTO tracked_cases
        (case_name, case_number, cnr_number, court, client_name, case_type,
         next_hearing, last_hearing, status, notes)
        VALUES (?,?,?,?,?,?,?,?,?,?)''', (
        data.get('case_name'),
        data.get('case_number', ''),
        data.get('cnr_number', ''),
        data.get('court', ''),
        data.get('client_name', ''),
        data.get('case_type', ''),
        data.get('next_hearing', None),
        data.get('last_hearing', None),
        data.get('status', 'Active'),
        data.get('notes', ''),
    ))
    conn.commit()
    new_id = c.lastrowid
    conn.close()
    return jsonify({'status': 'success', 'id': new_id})


@causelist_bp.route('/api/causelist/list', methods=['GET'])
def list_cases():
    conn = get_db()
    conn.row_factory = sqlite3.Row
    rows = conn.execute('SELECT * FROM tracked_cases ORDER BY created_at DESC').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@causelist_bp.route('/api/causelist/update/<int:case_id>', methods=['PUT'])
def update_case(case_id):
    data = request.get_json()
    conn = get_db()
    conn.execute('''UPDATE tracked_cases SET
        case_name=?, case_number=?, cnr_number=?, court=?, client_name=?,
        case_type=?, next_hearing=?, last_hearing=?, status=?, notes=?
        WHERE id=?''', (
        data.get('case_name'),
        data.get('case_number', ''),
        data.get('cnr_number', ''),
        data.get('court', ''),
        data.get('client_name', ''),
        data.get('case_type', ''),
        data.get('next_hearing', None),
        data.get('last_hearing', None),
        data.get('status', 'Active'),
        data.get('notes', ''),
        case_id,
    ))
    conn.commit()
    conn.close()
    return jsonify({'status': 'success'})


@causelist_bp.route('/api/causelist/delete/<int:case_id>', methods=['DELETE'])
def delete_case(case_id):
    conn = get_db()
    conn.execute('DELETE FROM tracked_cases WHERE id=?', (case_id,))
    conn.commit()
    conn.close()
    return jsonify({'status': 'deleted'})


# ── ICS EXPORT ────────────────────────────────────────────────────────────────

@causelist_bp.route('/api/causelist/export-ics', methods=['GET'])
def export_ics():
    conn = get_db()
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT * FROM tracked_cases WHERE next_hearing IS NOT NULL AND next_hearing != ''"
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
        try:
            dt = datetime.strptime(str(r['next_hearing']), '%Y-%m-%d')
            dtstr = dt.strftime('%Y%m%d')
        except Exception:
            continue
        uid = f"lexai-{r['id']}@lexai-india.com"
        summary = f"Hearing - {r['case_name']}"
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
    data = request.get_json()
    conn = get_db()
    c = conn.cursor()
    c.execute('''INSERT INTO ip_assets
        (ip_type, title, registration_number, filing_date, renewal_due, status, notes)
        VALUES (?,?,?,?,?,?,?)''', (
        data.get('ip_type', ''),
        data.get('title', ''),
        data.get('registration_number', ''),
        data.get('filing_date', None),
        data.get('renewal_due', None),
        data.get('status', 'Active'),
        data.get('notes', ''),
    ))
    conn.commit()
    new_id = c.lastrowid
    conn.close()
    return jsonify({'status': 'success', 'id': new_id})


@causelist_bp.route('/api/ip/list', methods=['GET'])
def list_ip():
    conn = get_db()
    conn.row_factory = sqlite3.Row
    rows = conn.execute('SELECT * FROM ip_assets ORDER BY renewal_due ASC').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@causelist_bp.route('/api/ip/update/<int:ip_id>', methods=['PUT'])
def update_ip(ip_id):
    data = request.get_json()
    conn = get_db()
    conn.execute('''UPDATE ip_assets SET
        ip_type=?, title=?, registration_number=?, filing_date=?,
        renewal_due=?, status=?, notes=? WHERE id=?''', (
        data.get('ip_type', ''),
        data.get('title', ''),
        data.get('registration_number', ''),
        data.get('filing_date', None),
        data.get('renewal_due', None),
        data.get('status', 'Active'),
        data.get('notes', ''),
        ip_id,
    ))
    conn.commit()
    conn.close()
    return jsonify({'status': 'success'})


@causelist_bp.route('/api/ip/delete/<int:ip_id>', methods=['DELETE'])
def delete_ip(ip_id):
    conn = get_db()
    conn.execute('DELETE FROM ip_assets WHERE id=?', (ip_id,))
    conn.commit()
    conn.close()
    return jsonify({'status': 'deleted'})
