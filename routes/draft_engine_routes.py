"""
routes/draft_engine_routes.py
Blueprint: /api/drafts   (every route needs a signed-in user: the app-wide gate enforces it)

  GET    /api/drafts/types              document types the wizard can draft
  GET    /api/drafts/types/<id>         the questions (slots) and statutory notes for one type
  POST   /api/drafts/extract            read facts out of pasted/extracted source text, with provenance
  POST   /api/drafts/render             facts -> structured document + missing details + warnings
  POST   /api/drafts/verify             check any generated text against the confirmed facts
  POST   /api/drafts/export             structured document -> .docx or .pdf
  GET    /api/drafts/sessions           my unfinished and finished drafts
  POST   /api/drafts/sessions           start one
  GET    /api/drafts/sessions/<id>      open one (with its versions)
  PUT    /api/drafts/sessions/<id>      autosave facts / step / status / a new version
  DELETE /api/drafts/sessions/<id>
  GET/PUT /api/drafts/flags/<key>       small per-user flags (first-run guide)

Every saved row belongs to one user; a draft id that is not yours answers 404, same as one that does not exist.
"""
import json
import os
import re
import sqlite3
import time

from flask import Blueprint, Response, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from database import db
from models.draft_session import DraftSession, DraftVersion, UserFlag
from utils.draft_engine import export as exporter
from utils.draft_engine import extract as extractor
from utils.draft_engine import verifier
from utils.draft_engine.registry import get_type, list_types, public_definition
from utils.draft_engine.render import blocks_to_text, fixed_text, render
from utils.limiter import limiter

drafts_bp = Blueprint("drafts", __name__, url_prefix="/api/drafts")

MAX_SOURCE_CHARS = 400_000
MAX_VERIFY_CHARS = 200_000
MAX_FACTS = 120
MAX_FACTS_JSON = 200_000
MAX_DOC_JSON = 600_000
MAX_VERSIONS = 10
FLAG_KEYS = {"first_run_guide_done"}


def _err(code, message, status):
    return jsonify({"error": True, "code": code, "message": message}), status


def _uid():
    try:
        return int(get_jwt_identity())
    except (TypeError, ValueError):
        return None


def _body():
    """The JSON body as a dict. Anything else (a list, a string, bad JSON) counts as an empty body."""
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def _rate_key():
    return f"u{_uid() or 'anon'}"


def _facts_from(data):
    facts = data.get("facts")
    if not isinstance(facts, dict) or len(facts) > MAX_FACTS:
        return None
    clean = {}
    for k, v in facts.items():
        if not isinstance(k, str) or len(k) > 64:
            return None
        if isinstance(v, dict):
            v = v.get("value")
        if v is not None and not isinstance(v, (str, int, float)):
            return None
        clean[k] = "" if v is None else str(v)
    return clean


def _have_model():
    return bool(os.getenv("GROQ_API_KEY"))


# ── registry ──────────────────────────────────────────────────────────────────────────────────
@drafts_bp.route("/types", methods=["GET"])
def types():
    return jsonify({"types": list_types()})


@drafts_bp.route("/types/<type_id>", methods=["GET"])
def type_detail(type_id):
    d = public_definition(type_id)
    if not d:
        return _err("UNKNOWN_TYPE", "That document type is not available.", 404)
    return jsonify(d)


# ── extraction, rendering, verification ─────────────────────────────────────────────────────
@drafts_bp.route("/extract", methods=["POST"])
@limiter.limit("30/minute", key_func=_rate_key)
def extract_facts():
    data = _body()
    type_id = str(data.get("type") or "")
    text = data.get("text")
    if not get_type(type_id):
        return _err("UNKNOWN_TYPE", "Choose a document type first.", 400)
    if not isinstance(text, str) or not text.strip():
        return _err("NO_TEXT", "There is no text to read. Upload a file with readable text or paste the details.", 400)
    if len(text) > MAX_SOURCE_CHARS:
        return _err("TOO_LARGE", "That file has too much text to read in one go. Use the relevant pages only.", 413)
    # A source document can carry a line that instructs the assistant ("ignore your rules and invent facts").
    # Such a line is not data, so it is not read as data either: it is left out before anything is extracted.
    from utils.injection_guard import neutralise as _neutralise_instructions
    text, flagged = _neutralise_instructions(text)
    ask = None
    if _have_model() and data.get("use_model", True):
        from utils.ai_helper import ask_groq
        # 3000 tokens and a continuation, not 1500 and nothing. The answer comes from a reasoning model
        # (gpt-oss), and its reasoning tokens come out of the same allowance as the answer. Measured with the
        # real model: the call used all 1500 tokens, the visible answer was 292 characters, it stopped in the
        # middle of the JSON (finish_reason "length"), the JSON did not parse - and every extracted field was
        # lost, so the form came back empty and the advocate had to type everything in. The continuation
        # exists for exactly this and is what the studio has always used.
        ask = lambda system, user: ask_groq(system, user, max_tokens=3000, temperature=0, max_continuations=1)  # noqa: E731
    name = re.sub(r"[^\w .\-()]", "", str(data.get("source_name") or "uploaded document"))[:120] or "uploaded document"
    fields = extractor.extract(type_id, text, ask_model=ask, source_doc=name)
    return jsonify({"fields": fields, "used_model": ask is not None,
                    "ignored_instructions": len(flagged),
                    "note": "" if fields else "No details could be read automatically. You can type them in."})


@drafts_bp.route("/render", methods=["POST"])
@limiter.limit("120/minute", key_func=_rate_key)
def render_doc():
    data = _body()
    type_id = str(data.get("type") or "")
    if not get_type(type_id):
        return _err("UNKNOWN_TYPE", "Choose a document type first.", 400)
    facts = _facts_from(data)
    if facts is None:
        return _err("BAD_FACTS", "The details could not be read. Please re-enter them.", 400)
    return jsonify(render(type_id, facts))


@drafts_bp.route("/verify", methods=["POST"])
@limiter.limit("60/minute", key_func=_rate_key)
def verify_text():
    data = _body()
    text = data.get("text")
    if not isinstance(text, str) or not text.strip():
        return _err("NO_TEXT", "There is no text to check.", 400)
    if len(text) > MAX_VERIFY_CHARS:
        return _err("TOO_LARGE", "That text is too long to check in one go.", 413)
    facts = _facts_from(data)
    if facts is None:
        return _err("BAD_FACTS", "The details could not be read. Please re-enter them.", 400)
    type_id = str(data.get("type") or "")
    tpl = fixed_text(type_id) if get_type(type_id) else ""
    result = verifier.verify(text, facts, tpl)
    result["unverified_count"] = len(result["issues"])
    return jsonify(result)


@drafts_bp.route("/export", methods=["POST"])
@limiter.limit("30/minute", key_func=_rate_key)
def export_doc():
    data = _body()
    doc = data.get("document") or {}
    fmt = str(data.get("format") or "docx").lower()
    if fmt not in ("docx", "pdf"):
        return _err("BAD_FORMAT", "Choose Word or PDF.", 400)
    blocks = doc.get("blocks") if isinstance(doc, dict) else None
    title = str((doc or {}).get("title") or "Document")[:120] if isinstance(doc, dict) else "Document"
    letterhead = data.get("letterhead")
    lh = [str(x)[:200] for x in letterhead[:8]] if isinstance(letterhead, list) else None
    try:
        if fmt == "docx":
            payload = exporter.to_docx(blocks, title, lh)
            mime, ext, notes = "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx", []
        else:
            payload, notes = exporter.to_pdf(blocks, title, lh)
            mime, ext = "application/pdf", "pdf"
    except ValueError:
        return _err("BAD_DOCUMENT", "This document could not be exported. Please generate it again.", 400)
    text = blocks_to_text(blocks) if isinstance(blocks, list) else ""
    unresolved = len(re.findall(r"\[Bracketed Field:", text))
    safe = re.sub(r"[^A-Za-z0-9_\-]+", "_", title).strip("_")[:60] or "document"
    resp = Response(payload, mimetype=mime)
    resp.headers["Content-Disposition"] = f'attachment; filename="{safe}.{ext}"'
    resp.headers["X-Unresolved-Count"] = str(unresolved)
    if notes:
        resp.headers["X-Export-Notes"] = " ".join(notes)[:300]
    return resp


# ── saved sessions (autosave, "finish later", version history) ──────────────────────────────────
def _own(session_id):
    uid = _uid()
    return DraftSession.query.filter_by(id=session_id, user_id=uid).first() if uid else None


def _row(s, versions=False):
    out = {"id": s.id, "type": s.doc_type, "title": s.title, "case_ref": s.case_ref, "step": s.step,
           "status": s.status, "updated_at": s.updated_at.isoformat() if s.updated_at else None}
    if versions:
        out["facts"] = json.loads(s.facts_json or "{}")
        vs = DraftVersion.query.filter_by(session_id=s.id, user_id=s.user_id).order_by(DraftVersion.id.desc()).limit(MAX_VERSIONS).all()
        out["versions"] = [{"id": v.id, "facts_hash": v.facts_hash, "note": v.note,
                            "created_at": v.created_at.isoformat() if v.created_at else None} for v in vs]
    return out


@drafts_bp.route("/sessions", methods=["GET"])
def sessions_list():
    rows = DraftSession.query.filter_by(user_id=_uid()).order_by(DraftSession.updated_at.desc()).limit(50).all()
    return jsonify({"sessions": [_row(s) for s in rows]})


@drafts_bp.route("/sessions", methods=["POST"])
@limiter.limit("60/hour", key_func=_rate_key)
def sessions_create():
    data = _body()
    type_id = str(data.get("type") or "")
    if not get_type(type_id):
        return _err("UNKNOWN_TYPE", "Choose a document type first.", 400)
    facts = _facts_from({"facts": data.get("facts") or {}})
    if facts is None:
        return _err("BAD_FACTS", "The details could not be read.", 400)
    s = DraftSession(user_id=_uid(), doc_type=type_id, title=str(data.get("title") or get_type(type_id)["short"])[:200],
                     case_ref=(str(data.get("case_ref"))[:64] if data.get("case_ref") else None),
                     facts_json=json.dumps(facts, ensure_ascii=False))
    db.session.add(s)
    db.session.commit()
    return jsonify(_row(s, versions=True)), 201


@drafts_bp.route("/sessions/<int:session_id>", methods=["GET"])
def sessions_get(session_id):
    s = _own(session_id)
    if not s:
        return _err("NOT_FOUND", "That draft was not found.", 404)
    return jsonify(_row(s, versions=True))


@drafts_bp.route("/sessions/<int:session_id>", methods=["PUT"])
@limiter.limit("600/hour", key_func=_rate_key)
def sessions_update(session_id):
    s = _own(session_id)
    if not s:
        return _err("NOT_FOUND", "That draft was not found.", 404)
    data = _body()
    if "facts" in data:
        facts = _facts_from(data)
        if facts is None:
            return _err("BAD_FACTS", "The details could not be read.", 400)
        blob = json.dumps(facts, ensure_ascii=False)
        if len(blob) > MAX_FACTS_JSON:
            return _err("TOO_LARGE", "That is too much text to save.", 413)
        s.facts_json = blob
    if isinstance(data.get("step"), str):
        s.step = data["step"][:24]
    if data.get("status") in ("draft", "done"):
        s.status = data["status"]
    if isinstance(data.get("title"), str) and data["title"].strip():
        s.title = data["title"].strip()[:200]
    doc = data.get("document")
    if isinstance(doc, dict):
        blob = json.dumps(doc, ensure_ascii=False)
        if len(blob) > MAX_DOC_JSON:
            return _err("TOO_LARGE", "That document is too large to keep a version of.", 413)
        db.session.add(DraftVersion(session_id=s.id, user_id=s.user_id, facts_hash=str(doc.get("facts_hash") or "")[:32],
                                    document_json=blob, note=str(data.get("note") or "")[:120]))
        db.session.flush()
        keep = [v.id for v in DraftVersion.query.filter_by(session_id=s.id, user_id=s.user_id).order_by(DraftVersion.id.desc()).limit(MAX_VERSIONS)]
        if keep:
            DraftVersion.query.filter(DraftVersion.session_id == s.id, DraftVersion.user_id == s.user_id,
                                      ~DraftVersion.id.in_(keep)).delete(synchronize_session=False)
    db.session.commit()
    return jsonify(_row(s, versions=True))


@drafts_bp.route("/sessions/<int:session_id>/versions/<int:version_id>", methods=["GET"])
def version_get(session_id, version_id):
    s = _own(session_id)
    v = DraftVersion.query.filter_by(id=version_id, session_id=s.id, user_id=s.user_id).first() if s else None
    if not v:
        return _err("NOT_FOUND", "That version was not found.", 404)
    return jsonify({"id": v.id, "document": json.loads(v.document_json), "created_at": v.created_at.isoformat() if v.created_at else None})


@drafts_bp.route("/sessions/<int:session_id>", methods=["DELETE"])
def sessions_delete(session_id):
    s = _own(session_id)
    if not s:
        return _err("NOT_FOUND", "That draft was not found.", 404)
    DraftVersion.query.filter_by(session_id=s.id, user_id=s.user_id).delete(synchronize_session=False)
    db.session.delete(s)
    db.session.commit()
    return jsonify({"ok": True})


# ── per-user flags ───────────────────────────────────────────────────────────────────────────
@drafts_bp.route("/flags/<key>", methods=["GET"])
def flag_get(key):
    if key not in FLAG_KEYS:
        return _err("UNKNOWN_FLAG", "Unknown setting.", 404)
    f = UserFlag.query.filter_by(user_id=_uid(), key=key).first()
    return jsonify({"key": key, "value": f.value if f else None})


@drafts_bp.route("/flags/<key>", methods=["PUT"])
def flag_put(key):
    if key not in FLAG_KEYS:
        return _err("UNKNOWN_FLAG", "Unknown setting.", 404)
    value = str(_body().get("value") or "")[:200]
    f = UserFlag.query.filter_by(user_id=_uid(), key=key).first()
    if f:
        f.value = value
    else:
        db.session.add(UserFlag(user_id=_uid(), key=key, value=value))
    db.session.commit()
    return jsonify({"key": key, "value": value})


# ── Saved drafts (Auto-Draft Studio) ─────────────────────────────────────────────────────────
# Moved verbatim out of app.py's create_app() (step 3c). Paths are relative to this
# blueprint's /api/drafts prefix, so '' is /api/drafts and '/<draft_id>' is
# /api/drafts/<draft_id>. URLs, methods, decorator order, names and logic are unchanged.

@drafts_bp.route("", methods=['GET', 'POST', 'OPTIONS'])
@jwt_required()
def handle_drafts():
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = int(get_jwt_identity())
    conn = sqlite3.connect('lex_assistant.db')
    conn.row_factory = sqlite3.Row
    try:
        if request.method == 'GET':
            rows = conn.execute(
                'SELECT * FROM saved_drafts WHERE owner_user_id = ? ORDER BY created_at DESC',
                (uid,)
            ).fetchall()
            drafts = [{
                'id': r['id'],
                'timestamp': r['created_at'],
                'title': r['title'],
                'rawText': r['raw_text'] or '',
                'clauses': json.loads(r['clauses_json']) if r['clauses_json'] else [],
                'summary': r['summary'] or '',
            } for r in rows]
            return jsonify(drafts), 200

        try:
            data = request.get_json(force=True, silent=True) or {}
            draft_id = data.get('id')
            if draft_id is None:
                draft_id = f"draft_{int(time.time() * 1000)}_{uid}"
            elif not isinstance(draft_id, str) or not draft_id.strip() or len(draft_id) > 120:
                # The id comes from the browser: anything that is not a short piece of text is a bad request,
                # not something to hand to the database.
                return jsonify({'error': True, 'message': 'That draft id is not valid.'}), 400
            draft_id = draft_id.strip()
            # The id is chosen by the browser, so it must never be allowed to reach another advocate's row:
            # "save" writes with an upsert, and without this check a second advocate who guessed (or read) an
            # id could overwrite the first one's draft. A row that belongs to somebody else is not this
            # advocate's to write - and the answer says nothing about what is in it.
            owner_row = conn.execute('SELECT owner_user_id FROM saved_drafts WHERE id = ?', (draft_id,)).fetchone()
            if owner_row is not None and int(owner_row['owner_user_id'] or 0) != uid:
                return jsonify({'error': True, 'message': 'That draft is not yours.'}), 404
            title = data.get('title') or "Untitled Contract Draft"
            raw_text = data.get('rawText') or ""
            clauses_json = json.dumps(data.get('clauses') or [])
            summary = data.get('summary') or ""
            conn.execute(
                '''INSERT INTO saved_drafts (id, owner_user_id, title, raw_text, clauses_json, summary)
                   VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET
                     title=excluded.title, raw_text=excluded.raw_text,
                     clauses_json=excluded.clauses_json, summary=excluded.summary''',
                (draft_id, uid, title, raw_text, clauses_json, summary)
            )
            conn.commit()
            row = conn.execute('SELECT * FROM saved_drafts WHERE id = ?', (draft_id,)).fetchone()
            payload = {
                'id': row['id'],
                'timestamp': row['created_at'],
                'title': row['title'],
                'rawText': row['raw_text'] or '',
                'clauses': json.loads(row['clauses_json']) if row['clauses_json'] else [],
                'summary': row['summary'] or '',
            }
            return jsonify({"status": "success", "draft": payload}), 200
        except Exception as e:
            return jsonify({"error": True, "message": str(e)}), 500
    finally:
        conn.close()


@drafts_bp.route("/<string:draft_id>", methods=['DELETE', 'OPTIONS'])
@jwt_required()
def delete_draft(draft_id):
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    uid = int(get_jwt_identity())
    conn = sqlite3.connect('lex_assistant.db')
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute('SELECT * FROM saved_drafts WHERE id = ?', (draft_id,)).fetchone()
        if not row or int(row['owner_user_id']) != uid:
            return jsonify({"error": True, "message": "Draft not found."}), 404
        conn.execute('DELETE FROM saved_drafts WHERE id = ?', (draft_id,))
        conn.commit()
        return jsonify({"status": "success", "deleted_id": draft_id}), 200
    except Exception as e:
        return jsonify({"error": True, "message": str(e)}), 500
    finally:
        conn.close()
