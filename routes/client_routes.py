"""
routes/client_routes.py
Client Management — full CRUD with linked cases and documents.
"""
import sqlite3
from flask import Blueprint, request, jsonify, render_template, current_app
from utils import tenancy

client_bp = Blueprint('client', __name__)


OWNED_TABLES = ('clients', 'tracked_cases')


def get_db():
    conn = sqlite3.connect(current_app.config['SQLITE_DB_PATH'])
    tenancy.prepare(conn, 'client', OWNED_TABLES, tenancy.current_uid())
    return conn


def owner():
    return tenancy.current_uid()


@client_bp.route('/clients')
def clients_page():
    return render_template('clients.html')


@client_bp.route('/api/clients/add', methods=['POST'])
def add_client():
    data = request.get_json()
    if not data or not data.get('name'):
        return jsonify({'error': 'name is required'}), 400
    conn = get_db()
    c = conn.cursor()
    c.execute('''INSERT INTO clients (name, phone, email, address, client_type, notes, owner_user_id)
                 VALUES (?,?,?,?,?,?,?)''', (
        data['name'],
        data.get('phone', ''),
        data.get('email', ''),
        data.get('address', ''),
        data.get('client_type', 'Individual'),
        data.get('notes', ''),
        owner(),
    ))
    conn.commit()
    new_id = c.lastrowid
    conn.close()
    return jsonify({'status': 'success', 'id': new_id})


@client_bp.route('/api/clients/list', methods=['GET'])
def list_clients():
    conn = get_db()
    conn.row_factory = sqlite3.Row
    clients = conn.execute('SELECT * FROM clients WHERE owner_user_id=? ORDER BY name ASC', (owner(),)).fetchall()
    result = []
    for cl in clients:
        row = dict(cl)
        count = conn.execute(
            "SELECT COUNT(*) FROM tracked_cases WHERE client_name=? AND status='Active' AND owner_user_id=?",
            (row['name'], owner())
        ).fetchone()[0]
        row['active_case_count'] = count
        result.append(row)
    conn.close()
    return jsonify(result)


@client_bp.route('/api/clients/<int:client_id>', methods=['GET'])
def get_client(client_id):
    conn = get_db()
    conn.row_factory = sqlite3.Row
    cl = conn.execute('SELECT * FROM clients WHERE id=? AND owner_user_id=?', (client_id, owner())).fetchone()
    if not cl:
        conn.close()
        return jsonify({'error': 'not found'}), 404
    client = dict(cl)
    cases = conn.execute(
        'SELECT * FROM tracked_cases WHERE client_name=? AND owner_user_id=? ORDER BY next_hearing ASC',
        (client['name'], owner())
    ).fetchall()
    client['cases'] = [dict(r) for r in cases]
    conn.close()
    return jsonify(client)


@client_bp.route('/api/clients/update/<int:client_id>', methods=['PUT'])
def update_client(client_id):
    data = request.get_json(silent=True) or {}
    try:
        conn = get_db()
        conn.execute('''UPDATE clients SET name=?, phone=?, email=?, address=?, client_type=?, notes=?
                        WHERE id=? AND owner_user_id=?''', (
            data.get('name', ''),
            data.get('phone', ''),
            data.get('email', ''),
            data.get('address', ''),
            data.get('client_type', 'Individual'),
            data.get('notes', ''),
            client_id,
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


@client_bp.route('/api/clients/delete/<int:client_id>', methods=['DELETE'])
def delete_client(client_id):
    conn = get_db()
    conn.execute('DELETE FROM clients WHERE id=? AND owner_user_id=?', (client_id, owner()))
    changed = conn.total_changes
    conn.commit()
    conn.close()
    if not changed:
        return jsonify({'error': 'not found'}), 404
    return jsonify({'status': 'deleted'})
