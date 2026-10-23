"""Calendar, eCourts sync and district lookups.

Moved verbatim out of ``app.py``'s ``create_app()`` (step 3, the calendar group):
``/api/calendar/save``, ``/api/calendar/events``, ``/api/ecourts/sync`` and ``/api/districts``.
Handler names, decorator order, logic and messages are unchanged.

The module deliberately does not import ``app`` at the top (there is no import cycle today and
none is introduced). Each handler that needs an app-level object imports it locally as
``app_module`` and reaches it as ``app_module.<name>``: ``app_module.db`` is the thread-local
SQLite handle that the tests point at a temporary file (patching ``app.db`` therefore still
reaches these handlers), ``app_module.sqlite3`` is the stdlib module, and
``app_module.__file__`` keeps ``/api/districts`` looking in the repository's ``data/`` folder.
``app.logger`` became ``current_app.logger`` — the same logger during a request — because the
Flask instance is local to ``create_app()`` and is not a module attribute.
"""
import json
import os

from flask import Blueprint, current_app, jsonify, request

calendar_bp = Blueprint('calendar', __name__)


@calendar_bp.route('/api/calendar/save', methods=['POST'])
def save_calendar_events():
    import app as app_module
    try:
        data = request.get_json(force=True, silent=True) or {}
        events = data.get('events', [])
        
        from utils import tenancy
        conn = app_module.db
        tenancy.prepare(conn, "calendar", ("calendar_events",), tenancy.current_uid())
        me = tenancy.current_uid()
        c = conn.cursor()
        for event in events:
            event_date = event.get('event_date')
            event_type = event.get('event_type')
            title = event.get('title')
            related_case_id = event.get('related_case_id')
            location = event.get('location', '')
            opposing_counsel = event.get('opposing_counsel', '')
            google_event_id = event.get('google_event_id')
            c.execute('''
                INSERT INTO calendar_events (event_date, event_type, title, related_case_id, location, opposing_counsel, google_event_id, owner_user_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (event_date, event_type, title, related_case_id, location, opposing_counsel, google_event_id, me))
        
        conn.commit()
        return jsonify({"success": True, "message": "Events successfully saved."}), 200
    except Exception as e:
        current_app.logger.error(f"calendar save failed: {e}")
        return jsonify({"error": True, "message": "The events could not be saved. Please try again."}), 500


@calendar_bp.route('/api/calendar/events', methods=['GET'])
def get_calendar_events_all():
    import app as app_module
    try:
        from utils import tenancy
        conn = app_module.db
        conn.row_factory = app_module.sqlite3.Row
        tenancy.prepare(conn, "calendar", ("calendar_events",), tenancy.current_uid())
        c = conn.cursor()
        c.execute("SELECT * FROM calendar_events WHERE owner_user_id=? ORDER BY event_date ASC", (tenancy.current_uid(),))
        rows = c.fetchall()
        dict_rows = [dict(row) for row in rows]
        return jsonify({"events": dict_rows}), 200
    except Exception as e:
        current_app.logger.error(f"calendar list failed: {e}")
        return jsonify({"error": True, "message": "Your calendar could not be loaded. Please try again."}), 500


@calendar_bp.route('/api/ecourts/sync', methods=['POST'])
def sync_ecourts_cnr():
    # No live eCourts integration is configured. Report that honestly rather
    # than returning a fabricated "3 hearings added" for a limitation-date tool.
    return jsonify({
        "success": False,
        "error": True,
        "message": "Automatic eCourts sync is not connected yet. Add the hearing dates to your calendar manually.",
    }), 501


@calendar_bp.route('/api/districts', methods=['GET'])
def get_districts():
    import app as app_module
    try:
        base_dir = os.path.dirname(os.path.abspath(app_module.__file__))
        primary_path = os.path.join(base_dir, 'data', 'districts.json')
        backup_path  = os.path.join(base_dir, 'data', 'districts_backup.json')
        target_file  = primary_path if os.path.exists(primary_path) else backup_path
        with open(target_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return jsonify(data)
    except FileNotFoundError:
        return jsonify({"error": "Database not found. Please run scraper.py first."}), 404
