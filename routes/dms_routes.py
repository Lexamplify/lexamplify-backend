"""
routes/dms_routes.py - Blueprint /api/dms : the Document Hub.

Built to be mounted from app.py with create_dms_blueprint(deps), where deps supplies the few things
that already live in app.py (the database path, vault sharing, folder access). Everything else - the
tables, the search index, the file store, the extraction workers, the audit trail entries - is
self-contained, so the whole feature can be exercised without the rest of the application.

Rules this file keeps:
  * Every route needs a logged-in user, and every document is checked individually: owner, member
    of the matter's team, or an explicit vault share. Legacy unowned rows are never exposed here.
  * Files are stored under their SHA-256; the browser is only ever given an attachment, an image
    of a page, or plain text - never a file it could execute.
  * Deleting is a move to the trash for 30 days. Legal hold blocks delete and purge outright.
  * Every change writes an entry to the vault's tamper-evident provenance chain, in the SAME
    transaction as the change, so the audit trail can never say something the data does not.
"""
import calendar
import contextlib
import csv
import hashlib
import io
import json
import os
import re
import tempfile
import threading
import time
import zipfile

from flask import Blueprint, Response, g, jsonify, request, send_file, stream_with_context
from flask_jwt_extended import get_jwt_identity, jwt_required

from utils import dms_classify as C
from utils import dms_extract as X
from utils import dms_index as I
from utils import dms_preview as P
from utils import dms_store as S
from utils import dms_worker as W

MAX_FILE_MB = int(os.getenv("DMS_MAX_FILE_MB", "95"))
BULK_LIMIT = 500
ZIP_MAX_DOCS, ZIP_MAX_BYTES = 200, int(os.getenv("DMS_ZIP_MAX_MB", "500")) * 1024 * 1024
TEXT_PAGE_CAP = 30000


class ApiError(Exception):
    def __init__(self, message, status=400, **extra):
        super().__init__(message)
        self.message, self.status, self.extra = message, status, extra


def _err(message, status=400, **extra):
    return jsonify({"error": True, "message": message, **extra}), status


def _int(v, default=None):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _truthy(v):
    return str(v).lower() in ("1", "true", "yes", "on")


def _safe_name(name, fallback="document"):
    name = os.path.basename((name or "").replace("\\", "/"))
    name = re.sub(r"[\x00-\x1f\x7f<>:\"|?*]+", " ", name).strip(" .")
    return (name[:180] or fallback)


def _csv_safe(v):
    s = "" if v is None else str(v)
    return ("'" + s) if s[:1] in ("=", "+", "-", "@", "\t", "\r") else s


def _now_iso():
    return time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())


def _need(deps, name):
    v = deps.get(name) if isinstance(deps, dict) else getattr(deps, name, None)
    if v is None:
        raise RuntimeError(f"create_dms_blueprint: deps.{name} is required")
    return v


def _opt(deps, name, default=None):
    return deps.get(name, default) if isinstance(deps, dict) else getattr(deps, name, default)


# Uploads of identical bytes that arrive at the same instant (a folder with two copies of a file, dropped
# and sent 4 at a time) must end up as ONE stored document. The lookup + insert for a given content hash is
# serialised on one of these locks, and the lookup is repeated inside the write transaction so that it also
# holds when the server runs several processes.
_DEDUPE_LOCKS = [threading.Lock() for _ in range(64)]


class _Dup(Exception):
    """Raised inside the write transaction when the same bytes turned out to be stored already."""


def create_dms_blueprint(deps):
    db_path = _need(deps, "db_path")
    shared_fn = _opt(deps, "shared", lambda uid: (set(), set(), lambda doc_id: None))
    folder_access = _opt(deps, "folder_access", lambda folder_id, uid, require_edit=True: True)
    log = _opt(deps, "log", lambda msg: None)

    bp = Blueprint("dms", __name__, url_prefix="/api/dms")

    boot = I.connect(db_path)
    try:
        I.ensure_schema(boot)
        with contextlib.suppress(Exception):
            W.recover_stale(boot)
    finally:
        boot.close()

    def _on_purge(doc_id, name, owner):
        c = I.connect(db_path)
        try:
            c.execute("BEGIN IMMEDIATE")
            _prov(c, "purge", doc_id, name, None, owner, {"reason": "trash retention period ended"})
            c.commit()
        finally:
            c.close()

    worker = W.Worker(db_path, on_purge=_on_purge, log=log)
    bp.worker = worker
    if os.getenv("DMS_WORKERS", "2") != "0":
        worker.start()

    # ── plumbing ────────────────────────────────────────────────────────────────────
    def conn():
        c = getattr(g, "_dms_conn", None)
        if c is None:
            c = g._dms_conn = I.connect(db_path)
        return c

    @bp.teardown_request
    def _close(_exc):
        c = getattr(g, "_dms_conn", None)
        if c is not None:
            with contextlib.suppress(Exception):
                c.rollback()
                c.close()
            g._dms_conn = None

    @bp.errorhandler(ApiError)
    def _api_error(e):
        return _err(e.message, e.status, **e.extra)

    @bp.errorhandler(413)
    def _too_big(_e):
        return _err(f"That upload is too large for one request (limit {MAX_FILE_MB} MB per file).", 413)

    def uid_now():
        return int(get_jwt_identity())

    def ctx_now():
        uid = uid_now()
        folders, docs, perm_fn = shared_fn(uid)
        return I.Ctx(uid, folders, docs, lambda doc_id: perm_fn(doc_id))

    class Tx:
        """BEGIN IMMEDIATE ... COMMIT, so the change and its audit entry land together or not at all."""
        def __enter__(self):
            c = conn()
            begin(c)
            return c

        def __exit__(self, et, ev, tb):
            c = conn()
            if et is None:
                c.commit()
            else:
                c.rollback()
            return False

    def begin(c):
        """Start a write transaction. Search leaves an implicit transaction open on its temp tables, so end
        that first - BEGIN cannot nest."""
        if c.in_transaction:
            c.commit()
        c.execute("BEGIN IMMEDIATE")

    def _prov(c, action, node_id, node_name, actor, owner, detail=None):
        """One entry on the vault's global hash chain - same payload formula as app.py's
        _write_provenance and /api/vault/provenance/verify, written inside the caller's transaction."""
        detail_json = json.dumps(detail or {}, sort_keys=True, default=str)
        prev = c.execute("SELECT content_hash FROM vault_provenance ORDER BY id DESC LIMIT 1").fetchone()
        prev_hash = prev[0] if prev else "0" * 64
        payload = "|".join(str(x) for x in (prev_hash, "document", node_id, node_name, action, actor, owner, detail_json))
        h = hashlib.sha256(payload.encode("utf-8")).hexdigest()
        c.execute("INSERT INTO vault_provenance (node_type, node_id, node_name, action, actor_user_id, owner_user_id, detail, content_hash) "
                  "VALUES ('document', ?, ?, ?, ?, ?, ?, ?)", (node_id, node_name, action, actor, owner, detail_json, h))

    def fetch_doc(c, ctx, doc_id, need="view", allow_trashed=True):
        r = c.execute(f"SELECT {I._LIST_COLS} FROM dms_docs d JOIN case_vault cv ON cv.id = d.doc_id WHERE d.doc_id = ?", (doc_id,)).fetchone()
        if not r:
            raise ApiError("Document not found.", 404)
        level = I.access_level(c, ctx, {"id": r["doc_id"], "user_id": r["cv_user_id"], "case_id": r["cv_case_id"], "folder_id": r["cv_folder_id"]})
        rank = {"view": 1, "edit": 2, "own": 3}
        if level is None or rank[level] < rank[need]:
            raise ApiError("Document not found." if level is None else "You have view-only access to this document.", 404 if level is None else 403)
        if r["deleted_at"] and not allow_trashed:
            raise ApiError("This document is in the trash. Restore it first.", 409)
        return r, level

    def title_of(r):
        return r["cv_smart_title"] or r["cv_title"] or r["original_name"] or f"Document {r['doc_id']}"

    def check_matter(c, uid, matter_id):
        roles = I.matter_role_map(c, uid)
        if f"matter:{matter_id}" not in roles:
            raise ApiError("Matter not found.", 404)

    def check_folder(uid, folder_id, c=None):
        if folder_id is None:
            return
        c = c or conn()
        row = c.execute("SELECT user_id FROM vault_folders WHERE id = ?", (folder_id,)).fetchone()
        if not row or not folder_access(folder_id, uid, True):
            raise ApiError("Folder not found.", 404)

    def docs_payload(c, ctx, rows, snippets=None):
        roles = I.matter_role_map(c, ctx.uid)
        out = []
        for r in rows:
            level = I.access_level(c, ctx, {"id": r["doc_id"], "user_id": r["cv_user_id"], "case_id": r["cv_case_id"],
                                            "folder_id": r["cv_folder_id"]}, matter_roles=roles)
            d = I.doc_dict(r, level)
            if snippets and r["doc_id"] in snippets:
                d["hit"] = snippets[r["doc_id"]]
            if r["deleted_at"]:
                d["days_left"] = max(0, W.TRASH_DAYS - int((time.time() - calendar.timegm(time.strptime(r["deleted_at"], "%Y-%m-%d %H:%M:%S"))) // 86400))
            out.append(d)
        return out

    def filters_from(args):
        f = {}
        for k in ("folder_id", "matter_id", "date_from", "date_to", "added_from", "added_to", "uploader", "batch_id", "kind", "case", "status", "group_id"):
            v = args.get(k)
            if v not in (None, ""):
                f[k] = v
        if args.get("class"):
            f["doc_class"] = args.get("class")
        for k in ("needs_review", "problems", "include_versions", "legal_hold", "subfolders"):
            if _truthy(args.get(k)):
                f[k] = True
        return f

    # ── config / stats ──────────────────────────────────────────────────────────────
    @bp.route("/config", methods=["GET", "OPTIONS"])
    @jwt_required()
    def config():
        if request.method == "OPTIONS":
            return jsonify({}), 200
        c = conn()
        waiting, running = W.queue_depth(c, uid_now())
        eng = X.ocr_engine()
        return jsonify({
            "max_file_mb": MAX_FILE_MB, "trash_days": W.TRASH_DAYS, "auto_confidence": C.AUTO_CONFIDENCE,
            "blocked_ext": sorted(X.BLOCKED_EXT), "classes": C.CLASS_NAMES, "blueprint_folders": C.ROUGH_FOLDERS,
            "ocr": {"available": bool(eng.get("available")), "langs": eng.get("langs", ""), "installed": eng.get("installed", []),
                    "reason": eng.get("reason", "")},
            "encryption": {"enabled": S.encryption_enabled(), "error": S.encryption_error()},
            "storage": S.storage_info(),
            "search": {"indic": I.indic_search_ok(c)},
            "queue": {"waiting": waiting, "running": running},
        })

    @bp.route("/stats", methods=["GET", "OPTIONS"])
    @jwt_required()
    def stats():
        if request.method == "OPTIONS":
            return jsonify({}), 200
        c, ctx = conn(), ctx_now()
        params = {"uid": ctx.uid}
        vis = I.visibility_sql(c, ctx)
        frm = "FROM dms_docs d JOIN case_vault cv ON cv.id = d.doc_id"
        live = f"{vis} AND d.deleted_at IS NULL AND d.is_current = 1"
        one = lambda sql: c.execute(sql, params).fetchone()
        tot = one(f"SELECT COUNT(*) n, COALESCE(SUM(d.page_count),0) p, COALESCE(SUM(d.size),0) b, COALESCE(SUM(d.ocr_pages),0) o "
                  f"{frm} WHERE {live}")
        by = lambda col: {(r["k"] or "Unclassified"): r["n"] for r in c.execute(
            f"SELECT {col} AS k, COUNT(*) AS n {frm} WHERE {live} GROUP BY k ORDER BY n DESC", params)}
        activity = {r["k"]: r["n"] for r in c.execute(
            f"SELECT date(d.created_at) AS k, COUNT(*) AS n {frm} WHERE {live} AND d.created_at >= date('now','-13 day') GROUP BY k", params)}
        days = []
        for i in range(13, -1, -1):
            day = time.strftime("%Y-%m-%d", time.gmtime(time.time() - i * 86400))
            days.append({"date": day, "n": activity.get(day, 0)})
        waiting, running = W.queue_depth(c, ctx.uid)
        return jsonify({
            "documents": tot["n"], "pages": tot["p"], "bytes": tot["b"], "ocr_pages": tot["o"],
            "review": one(f"SELECT COUNT(*) {frm} WHERE {live} AND d.review = 'needs_review'")[0],
            "problems": one(f"SELECT COUNT(*) {frm} WHERE {live} AND d.status IN ('failed','needs_ocr','ready_partial','empty','unsupported')")[0],
            "processing": one(f"SELECT COUNT(*) {frm} WHERE {live} AND d.status IN ('queued','processing')")[0],
            "trash": one(f"SELECT COUNT(*) {frm} WHERE {vis} AND d.deleted_at IS NOT NULL")[0],
            "added_7d": one(f"SELECT COUNT(*) {frm} WHERE {live} AND d.created_at >= date('now','-6 day')")[0],
            "legal_hold": one(f"SELECT COUNT(*) {frm} WHERE {live} AND d.legal_hold = 1")[0],
            "unadopted": count_unadopted(c, ctx.uid),
            "classes": by("d.doc_class"), "kinds": by("d.kind"), "activity": days,
            "queue": {"waiting": waiting, "running": running},
        })

    @bp.route("/matters", methods=["GET", "OPTIONS"])
    @jwt_required()
    def matters():
        if request.method == "OPTIONS":
            return jsonify({}), 200
        return jsonify({"matters": I.matter_ids_for(conn(), uid_now())})

    # ── bring existing Case Vault files into the hub ────────────────────────────────
    class _BytesFS:
        """Just enough of a werkzeug FileStorage for the store's streaming spool."""
        def __init__(self, name, data):
            self.filename, self.stream = name, io.BytesIO(data)

    _ADOPTABLE = ("cv.user_id = ? AND NOT EXISTS (SELECT 1 FROM dms_docs d WHERE d.doc_id = cv.id) "
                  "AND (cv.file_blob IS NOT NULL OR cv.content != '')")

    def count_unadopted(c, uid):
        return c.execute(f"SELECT COUNT(*) FROM case_vault cv WHERE {_ADOPTABLE}", (uid,)).fetchone()[0]

    def adopt_rows(c, uid, limit=100, only_id=None, batch="adopted"):
        """Register the caller's existing Case Vault documents with the hub: the bytes are copied into the
        disk store (the original row is left exactly as it was, so the old Case Vault screens keep working),
        then read, indexed and classified like any upload. Nothing is moved, renamed or deleted."""
        limit = max(1, min(int(limit), 500))
        if only_id:
            ids = [r[0] for r in c.execute(f"SELECT cv.id FROM case_vault cv WHERE cv.id = ? AND {_ADOPTABLE}", (only_id, uid))]
        else:
            ids = [r[0] for r in c.execute(f"SELECT cv.id FROM case_vault cv WHERE {_ADOPTABLE} ORDER BY cv.id LIMIT ?", (uid, limit))]
        done = failed = 0
        for cv_id in ids:
            row = c.execute("SELECT id, title, smart_title, file_blob, file_format, content, folder_id, created_at FROM case_vault WHERE id = ?", (cv_id,)).fetchone()
            if not row:
                continue
            try:
                data = bytes(row["file_blob"]) if row["file_blob"] else None
                title = row["title"] or row["smart_title"] or f"Document {cv_id}"
                if data is None:
                    text = row["content"] or ""
                    data = text.encode("utf-8", "replace")
                    ext = "html" if text.lstrip()[:1] == "<" else "txt"
                else:
                    ext = (row["file_format"] or "").lower().strip(".")
                    if ext in ("", "native"):
                        ext = os.path.splitext(title)[1].lstrip(".").lower()
                name = _safe_name(title)
                if ext and not name.lower().endswith("." + ext):
                    name = f"{name}.{ext}"
                tmp, sha, size = S.spool_upload(_BytesFS(name, data), MAX_FILE_MB * 1024 * 1024)
                del data
                try:
                    sn = X.sniff(tmp, name)
                    key, enc = S.commit(tmp, sha)
                finally:
                    with contextlib.suppress(OSError):
                        os.remove(tmp)
                shown = f"{name.rsplit('.', 1)[0]}.{sn.ext}" if (sn.mismatch and sn.ext) else name
                begin(c)
                try:
                    c.execute(
                        "INSERT INTO dms_docs (doc_id, sha256, store_key, enc, size, mime, ext, kind, original_name, status, warnings, class_src, "
                        "group_id, version, is_current, batch_id, uploaded_by, meta, created_at, updated_at) "
                        "VALUES (?,?,?,?,?,?,?,?,?, 'queued', '[]', 'auto', ?, 1, 1, ?, ?, ?, ?, ?)",
                        (cv_id, sha, key, int(enc), size, sn.mime, sn.ext, sn.kind, shown, cv_id, batch, uid,
                         json.dumps({"adopted": True}), row["created_at"] or _now_iso(), _now_iso()))
                    W.enqueue(c, cv_id, commit=False)
                    I.refresh_meta_fts(c, cv_id)
                    _prov(c, "adopted", cv_id, (row["smart_title"] or title)[:180], uid, uid, {"file": shown, "sha256": sha[:16], "size": size})
                    c.commit()
                except Exception:
                    c.rollback()
                    raise
                done += 1
            except Exception as exc:                        # one unreadable row must not stop the rest
                failed += 1
                log(f"adopt {cv_id}: {exc}")
        if done:
            worker.kick()
        return done, failed

    def adopt_public(uid, only_id=None, limit=1):
        """For app.py: register one Case Vault row (right after an old-style upload) without a request context."""
        c = I.connect(db_path)
        try:
            return adopt_rows(c, uid, limit=limit, only_id=only_id)
        finally:
            c.close()

    bp.adopt_rows = adopt_public

    @bp.route("/adopt", methods=["POST", "OPTIONS"])
    @jwt_required()
    def adopt():
        if request.method == "OPTIONS":
            return jsonify({}), 200
        c, ctx = conn(), ctx_now()
        done, failed = adopt_rows(c, ctx.uid, limit=_int((request.get_json(silent=True) or {}).get("limit"), 60) or 60)
        return jsonify({"ok": True, "adopted": done, "failed": failed, "remaining": count_unadopted(c, ctx.uid)})

    # ── upload ──────────────────────────────────────────────────────────────────────
    def ingest(c, ctx, fs, folder_id, matter_id, batch_id, rel_path, force, group_of=None, note=None, title=None):
        uid = ctx.uid
        filename = _safe_name(getattr(fs, "filename", ""))
        if not getattr(fs, "filename", ""):
            raise ApiError("No file was selected.", 400)
        try:
            tmp, sha, size = S.spool_upload(fs, MAX_FILE_MB * 1024 * 1024)
        except S.StoreError as exc:
            raise ApiError(str(exc), 413 if "larger" in str(exc) else 400)
        keep = False
        try:
            sn = X.sniff(tmp, filename)
            if sn.blocked:
                raise ApiError(sn.reason, 415, code="blocked_type")
            matter_case = f"matter:{matter_id}" if matter_id else None

            def find_dup():
                if group_of:            # a new version only conflicts with a version of the SAME document
                    same = c.execute("SELECT doc_id FROM dms_docs WHERE group_id = ? AND sha256 = ? AND deleted_at IS NULL LIMIT 1", (group_of, sha)).fetchone()
                    if same:
                        return {"duplicate": True, "in_trash": False, "existing": {"id": same["doc_id"], "title": None, "folder_id": None}}
                elif not force:
                    dup = c.execute(
                        "SELECT d.doc_id, d.deleted_at, cv.smart_title, cv.title, cv.folder_id FROM dms_docs d JOIN case_vault cv ON cv.id = d.doc_id "
                        "WHERE d.sha256 = ? AND d.is_current = 1 AND (cv.user_id = ? OR (? IS NOT NULL AND cv.case_id = ?)) "
                        "ORDER BY (d.deleted_at IS NOT NULL), d.doc_id LIMIT 1", (sha, uid, matter_case, matter_case)).fetchone()
                    if dup:
                        return {"duplicate": True, "in_trash": bool(dup["deleted_at"]),
                                "existing": {"id": dup["doc_id"], "title": dup["smart_title"] or dup["title"], "folder_id": dup["folder_id"]}}
                return None

            try:
                with _DEDUPE_LOCKS[int(sha[:8], 16) % len(_DEDUPE_LOCKS)]:
                    early = find_dup()
                    if early:
                        return early, None
                    real_ext = sn.ext
                    stem = filename.rsplit(".", 1)[0] if "." in filename else filename
                    shown_name = f"{stem}.{real_ext}" if (sn.mismatch and real_ext) else filename
                    warns = []
                    if sn.mismatch:
                        warns.append(f"The file is named .{sn.claimed_ext} but its content is {sn.ext.upper()}; it was stored as {sn.ext.upper()}.")
                    key, enc = S.commit(tmp, sha)
                    keep = True
                    with Tx():
                        again = find_dup()          # re-check under the write lock (covers several server processes)
                        if again:
                            raise _Dup(again)
                        cur = c.execute(
                            "INSERT INTO case_vault (case_id, title, doc_type, content, folder_id, smart_title, tags, file_blob, file_format, user_id) "
                            "VALUES (?, ?, 'uploaded', '', ?, ?, 'UNCLASSIFIED', NULL, ?, ?)",
                            (matter_case or "General", shown_name, folder_id, (title or stem)[:180], sn.ext, uid))
                        doc_id = cur.lastrowid
                        version, gid, cls, csrc, tags, review = 1, doc_id, None, "auto", None, None
                        if group_of:
                            prev = c.execute("SELECT MAX(version) FROM dms_docs WHERE group_id = ?", (group_of,)).fetchone()[0] or 1
                            version, gid = prev + 1, group_of
                            c.execute("UPDATE dms_docs SET is_current = 0, updated_at = ? WHERE group_id = ?", (_now_iso(), group_of))
                            old = c.execute("SELECT doc_class, class_src, tags FROM dms_docs WHERE group_id = ? AND version = ?", (group_of, prev)).fetchone()
                            if old and old["class_src"] == "user":
                                cls, csrc, review = old["doc_class"], "user", "reviewed"
                            tags = old["tags"] if old else None
                        c.execute(
                            "INSERT INTO dms_docs (doc_id, sha256, store_key, enc, size, mime, ext, kind, original_name, rel_path, status, warnings, "
                            "doc_class, class_src, review, group_id, version, is_current, version_note, batch_id, uploaded_by, tags, created_at, updated_at) "
                            "VALUES (?,?,?,?,?,?,?,?,?,?, 'queued', ?, ?,?,?, ?,?,1,?,?,?,?,?,?)",
                            (doc_id, sha, key, int(enc), size, sn.mime, sn.ext, sn.kind, shown_name, (rel_path or "")[:400] or None, json.dumps(warns),
                             cls, csrc, review, gid, version, (note or "")[:300] or None, (batch_id or "")[:64] or None, uid, tags, _now_iso(), _now_iso()))
                        W.enqueue(c, doc_id, commit=False)
                        I.refresh_meta_fts(c, doc_id)
                        _prov(c, "new-version" if group_of else "upload", doc_id, (title or stem)[:180], uid, uid,
                              {"file": shown_name, "sha256": sha[:16], "size": size, "batch": batch_id, "version": version, "matter": matter_id, "folder": folder_id})
                    worker.kick()
                    row = c.execute(f"SELECT {I._LIST_COLS} FROM dms_docs d JOIN case_vault cv ON cv.id = d.doc_id WHERE d.doc_id = ?", (doc_id,)).fetchone()
                    return None, row

            except _Dup as d:
                return d.args[0], None
        finally:
            if not keep:
                with contextlib.suppress(OSError):
                    os.remove(tmp)

    @bp.route("/upload", methods=["POST", "OPTIONS"])
    @jwt_required()
    def upload():
        if request.method == "OPTIONS":
            return jsonify({}), 200
        c, ctx = conn(), ctx_now()
        if "file" not in request.files:
            raise ApiError("No file was sent.", 400)
        folder_id = _int(request.form.get("folder_id"))
        matter_id = _int(request.form.get("matter_id"))
        check_folder(ctx.uid, folder_id, c)
        if matter_id:
            check_matter(c, ctx.uid, matter_id)
        dup, row = ingest(c, ctx, request.files["file"], folder_id, matter_id, request.form.get("batch_id"),
                          request.form.get("rel_path"), _truthy(request.form.get("force")))
        if dup:
            return jsonify({"ok": True, **dup}), 200
        return jsonify({"ok": True, "doc": docs_payload(c, ctx, [row])[0]}), 201

    # ── list / search ───────────────────────────────────────────────────────────────
    @bp.route("/docs", methods=["GET", "OPTIONS"])
    @jwt_required()
    def list_docs():
        if request.method == "OPTIONS":
            return jsonify({}), 200
        c, ctx = conn(), ctx_now()
        q = (request.args.get("q") or "").strip()
        res = I.search_docs(c, ctx, q, filters_from(request.args), request.args.get("sort"),
                            _int(request.args.get("page"), 1), _int(request.args.get("per_page"), 30),
                            want_facets=_truthy(request.args.get("facets", "1")))
        return jsonify({
            "docs": docs_payload(c, ctx, res["rows"], res["snippets"]), "total": res["total"], "facets": res["facets"],
            "terms": I.highlight_words(res["terms"]), "q": q,
            "page": max(1, _int(request.args.get("page"), 1)), "per_page": max(1, min(_int(request.args.get("per_page"), 30), 100)),
        })

    @bp.route("/ids", methods=["GET", "OPTIONS"])
    @jwt_required()
    def matching_ids():
        """Ids of everything matching a search/filter (at most BULK_LIMIT) - what 'select all matching' acts on."""
        if request.method == "OPTIONS":
            return jsonify({}), 200
        c, ctx = conn(), ctx_now()
        q = (request.args.get("q") or "").strip()
        flt = filters_from(request.args)
        ids, total, page = [], 0, 1
        while len(ids) < BULK_LIMIT:
            res = I.search_docs(c, ctx, q, flt, request.args.get("sort"), page, 100, want_facets=False)
            total = res["total"]
            ids += [r["doc_id"] for r in res["rows"]]
            if not res["rows"] or page * 100 >= total:
                break
            page += 1
        return jsonify({"ids": ids[:BULK_LIMIT], "total": total, "capped": total > BULK_LIMIT})

    @bp.route("/docs/<int:doc_id>", methods=["GET", "OPTIONS"])
    @jwt_required()
    def get_doc(doc_id):
        if request.method == "OPTIONS":
            return jsonify({}), 200
        c, ctx = conn(), ctx_now()
        r, level = fetch_doc(c, ctx, doc_id)
        d = I.doc_dict(r, level, detail=True)
        vis = I.visibility_sql(c, ctx)
        vers = c.execute(
            "SELECT d.doc_id, d.version, d.is_current, d.size, d.created_at, d.uploaded_by, d.version_note, d.original_name, d.status "
            "FROM dms_docs d JOIN case_vault cv ON cv.id = d.doc_id WHERE d.group_id = ? AND d.deleted_at IS "
            + ("NOT NULL" if r["deleted_at"] else "NULL") + " ORDER BY d.version DESC", (r["group_id"],)).fetchall()
        d["versions"] = [dict(v) for v in vers]
        # other copies of the same bytes / same text - only ones this person may see
        others = c.execute(
            f"SELECT d.doc_id, d.sha256 = :sha AS same_file, cv.smart_title, cv.title FROM dms_docs d JOIN case_vault cv ON cv.id = d.doc_id "
            f"WHERE {vis} AND d.deleted_at IS NULL AND d.is_current = 1 AND d.doc_id != :id AND d.group_id != :gid AND "
            f"(d.sha256 = :sha OR (d.text_hash IS NOT NULL AND d.text_hash = :th)) LIMIT 10",
            {"uid": ctx.uid, "sha": r["sha256"], "th": r["text_hash"], "id": doc_id, "gid": r["group_id"]}).fetchall()
        d["copies"] = [{"id": o["doc_id"], "title": o["smart_title"] or o["title"], "same_file": bool(o["same_file"])} for o in others]
        path, fid = [], r["cv_folder_id"]
        for _ in range(12):
            if fid is None:
                break
            fr = c.execute("SELECT name, parent_id FROM vault_folders WHERE id = ?", (fid,)).fetchone()
            if not fr:
                break
            path.insert(0, fr["name"])
            fid = fr["parent_id"]
        d["folder_path"] = path
        if d["matter_id"]:
            m = next((m for m in I.matter_ids_for(c, ctx.uid) if m["id"] == d["matter_id"]), None)
            d["matter"] = {"id": m["id"], "title": m["title"]} if m else None
        d["days_left"] = None
        return jsonify({"doc": d})

    @bp.route("/docs/<int:doc_id>/hits", methods=["GET", "OPTIONS"])
    @jwt_required()
    def hits(doc_id):
        if request.method == "OPTIONS":
            return jsonify({}), 200
        c, ctx = conn(), ctx_now()
        fetch_doc(c, ctx, doc_id)
        q = request.args.get("q") or ""
        terms, _ = I.parse_query(q)
        return jsonify({"hits": I.doc_hits(c, doc_id, q), "terms": I.highlight_words(terms)})

    @bp.route("/docs/<int:doc_id>/text", methods=["GET", "OPTIONS"])
    @jwt_required()
    def doc_text(doc_id):
        if request.method == "OPTIONS":
            return jsonify({}), 200
        c, ctx = conn(), ctx_now()
        r, _ = fetch_doc(c, ctx, doc_id)
        start = max(1, _int(request.args.get("from"), 1))
        count = max(1, min(_int(request.args.get("count"), 8), 20))
        rows = c.execute("SELECT page_no, text FROM dms_pages WHERE doc_id = ? AND page_no >= ? ORDER BY page_no LIMIT ?",
                         (doc_id, start, count)).fetchall()
        total = c.execute("SELECT COUNT(*) FROM dms_pages WHERE doc_id = ?", (doc_id,)).fetchone()[0]
        return jsonify({"pages": [{"page": p["page_no"], "text": p["text"][:TEXT_PAGE_CAP], "truncated": len(p["text"]) > TEXT_PAGE_CAP} for p in rows],
                        "total": total, "page_kind": r["page_kind"] or "page"})

    # ── files ───────────────────────────────────────────────────────────────────────
    def serve_blob(r, inline, cache=False):
        cm = S.open_plain(r["store_key"], bool(r["enc"]))
        try:
            path = cm.__enter__()
        except S.StoreError as exc:
            raise ApiError(str(exc), 410)
        safe_inline = inline and (r["ext"] or "") in X.INLINE_SAFE
        mime = X.MIME.get(r["ext"] or "", "application/octet-stream")
        name = _safe_name(r["original_name"] or r["cv_title"] or f"document-{r['doc_id']}")
        resp = send_file(path, mimetype=mime if safe_inline else "application/octet-stream", as_attachment=not safe_inline,
                         download_name=name, conditional=True, etag=r["sha256"][:32], max_age=0)
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["Cache-Control"] = "private, no-store"
        resp.call_on_close(lambda: cm.__exit__(None, None, None))
        return resp

    @bp.route("/docs/<int:doc_id>/file", methods=["GET", "OPTIONS"])
    @jwt_required()
    def doc_file(doc_id):
        if request.method == "OPTIONS":
            return jsonify({}), 200
        c, ctx = conn(), ctx_now()
        r, _ = fetch_doc(c, ctx, doc_id)
        return serve_blob(r, inline=True)

    @bp.route("/docs/<int:doc_id>/download", methods=["GET", "OPTIONS"])
    @jwt_required()
    def doc_download(doc_id):
        if request.method == "OPTIONS":
            return jsonify({}), 200
        c, ctx = conn(), ctx_now()
        r, _ = fetch_doc(c, ctx, doc_id)
        resp = serve_blob(r, inline=False)
        with Tx() as tx:
            _prov(tx, "download", doc_id, title_of(r), ctx.uid, r["cv_user_id"], {"file": r["original_name"]})
        return resp

    @bp.route("/docs/<int:doc_id>/page/<int:page_no>", methods=["GET", "OPTIONS"])
    @jwt_required()
    def doc_page(doc_id, page_no):
        if request.method == "OPTIONS":
            return jsonify({}), 200
        c, ctx = conn(), ctx_now()
        r, _ = fetch_doc(c, ctx, doc_id)
        if r["kind"] not in ("pdf", "image"):
            raise ApiError("There is no page preview for this kind of file. Use the text view.", 415)
        terms = [t for t in re.split(r"[\s,]+", request.args.get("terms", "")) if t][:20]
        width = _int(request.args.get("w"), 900)
        cache_dir = None if r["enc"] else os.path.join(S.storage_root(), "_incoming")
        try:
            with S.open_plain(r["store_key"], bool(r["enc"])) as path:
                data = P.render_page(path, r["kind"], page_no, width, terms, cache_dir, r["sha256"])
        except P.PreviewError as exc:
            raise ApiError(str(exc), 404)
        except S.StoreError as exc:
            raise ApiError(str(exc), 410)
        resp = Response(data, mimetype="image/jpeg")
        resp.headers["Cache-Control"] = "private, max-age=300"
        resp.headers["X-Content-Type-Options"] = "nosniff"
        return resp

    # ── editing ─────────────────────────────────────────────────────────────────────
    def apply_patch(c, ctx, r, level, b):
        """Applies a dict of changes to one document. Returns list of action names performed.
        Raises ApiError for anything not allowed. Caller owns the transaction."""
        uid, did, name = ctx.uid, r["doc_id"], title_of(r)
        done = []
        meta = I._loads(r["meta"], {})
        user_fields = set(meta.get("user_fields") or [])
        if "title" in b:
            t = str(b["title"] or "").strip()[:180]
            if not t:
                raise ApiError("A document needs a name.", 400)
            c.execute("UPDATE case_vault SET smart_title = ? WHERE id = ?", (t, did))
            meta["title_auto"] = False
            _prov(c, "renamed", did, t, uid, r["cv_user_id"], {"from": name})
            done.append("title")
        if "folder_id" in b:
            fid = _int(b["folder_id"])
            check_folder(uid, fid, c)
            c.execute("UPDATE case_vault SET folder_id = ? WHERE id IN (SELECT doc_id FROM dms_docs WHERE group_id = ?)", (fid, r["group_id"]))
            meta.pop("auto_filed", None)
            _prov(c, "moved", did, name, uid, r["cv_user_id"], {"folder_id": fid, "from": r["cv_folder_id"]})
            done.append("folder")
        if "matter_id" in b:
            mid = _int(b["matter_id"])
            if mid:
                check_matter(c, uid, mid)
            c.execute("UPDATE case_vault SET case_id = ? WHERE id IN (SELECT doc_id FROM dms_docs WHERE group_id = ?)",
                      (f"matter:{mid}" if mid else "General", r["group_id"]))
            meta["suggested_matter"] = None
            _prov(c, "matter-linked" if mid else "matter-unlinked", did, name, uid, r["cv_user_id"], {"matter_id": mid, "from": r["cv_case_id"]})
            done.append("matter")
        if "doc_class" in b:
            cls = str(b["doc_class"] or "")
            if cls not in C.CLASS_NAMES:
                raise ApiError("Unknown document type.", 400)
            c.execute("UPDATE dms_docs SET doc_class = ?, class_src = 'user', class_conf = 1.0, review = 'reviewed' WHERE doc_id = ?", (cls, did))
            c.execute("UPDATE case_vault SET doc_type = ? WHERE id = ?", (cls if cls != "Unclassified" else "uploaded", did))
            _prov(c, "reclassified", did, name, uid, r["cv_user_id"], {"to": cls, "from": r["doc_class"], "confidence_before": r["class_conf"]})
            done.append("class")
        if b.get("review") == "reviewed":
            c.execute("UPDATE dms_docs SET review = 'reviewed' WHERE doc_id = ?", (did,))
            _prov(c, "review-accepted", did, name, uid, r["cv_user_id"], {"class": r["doc_class"]})
            done.append("review")
        sets, vals = [], []
        for field, col, maxlen in (("doc_date", "doc_date", 10), ("next_hearing", "next_hearing", 10), ("parties", "parties", 200), ("court", "court", 200)):
            if field in b:
                v = str(b[field] or "").strip()[:maxlen] or None
                if field in ("doc_date", "next_hearing") and v and not re.match(r"^\d{4}-\d{2}-\d{2}$", v):
                    raise ApiError("Dates must look like 2025-03-14.", 400)
                sets.append(f"{col} = ?")
                vals.append(v)
                meta[field] = v
                user_fields.add(field)
        if "case_numbers" in b:
            nums = [str(x).strip()[:60] for x in (b["case_numbers"] or []) if str(x).strip()][:6]
            meta["case_numbers"] = nums
            keys = W._case_keys(nums)
            sets.append("case_keys = ?")
            vals.append(("|" + "|".join(keys) + "|") if keys else None)
            user_fields.add("case_numbers")
        if sets or "case_numbers" in b:
            if sets:
                c.execute(f"UPDATE dms_docs SET {', '.join(sets)} WHERE doc_id = ?", (*vals, did))
            _prov(c, "details-edited", did, name, uid, r["cv_user_id"], {k: b[k] for k in b if k in ("doc_date", "next_hearing", "parties", "court", "case_numbers")})
            done.append("details")
        if "tags" in b:
            tags = []
            for t in (b["tags"] or [])[:20]:
                t = re.sub(r"\s+", " ", str(t)).strip()[:40]
                if t and t.lower() not in [x.lower() for x in tags]:
                    tags.append(t)
            c.execute("UPDATE dms_docs SET tags = ? WHERE doc_id = ?", (json.dumps(tags), did))
            _prov(c, "tags-edited", did, name, uid, r["cv_user_id"], {"tags": tags})
            done.append("tags")
        if "legal_hold" in b:
            if level != "own":
                raise ApiError("Only the owner can place or lift a legal hold.", 403)
            hold = 1 if b["legal_hold"] else 0
            c.execute("UPDATE dms_docs SET legal_hold = ? WHERE group_id = ?", (hold, r["group_id"]))
            _prov(c, "legal-hold-on" if hold else "legal-hold-off", did, name, uid, r["cv_user_id"], {})
            done.append("legal_hold")
        if done:
            meta["user_fields"] = sorted(user_fields)
            c.execute("UPDATE dms_docs SET meta = ?, updated_at = ? WHERE doc_id = ?", (json.dumps(meta, default=str), _now_iso(), did))
            I.refresh_meta_fts(c, did)
        return done

    @bp.route("/docs/<int:doc_id>", methods=["PATCH", "OPTIONS"])
    @jwt_required()
    def patch_doc(doc_id):
        if request.method == "OPTIONS":
            return jsonify({}), 200
        c, ctx = conn(), ctx_now()
        r, level = fetch_doc(c, ctx, doc_id, need="edit", allow_trashed=False)
        b = request.get_json(force=True, silent=True) or {}
        with Tx():
            done = apply_patch(c, ctx, r, level, b)
        r2 = c.execute(f"SELECT {I._LIST_COLS} FROM dms_docs d JOIN case_vault cv ON cv.id = d.doc_id WHERE d.doc_id = ?", (doc_id,)).fetchone()
        return jsonify({"ok": True, "changed": done, "doc": docs_payload(c, ctx, [r2])[0]})

    @bp.route("/docs/<int:doc_id>/reprocess", methods=["POST", "OPTIONS"])
    @jwt_required()
    def reprocess(doc_id):
        if request.method == "OPTIONS":
            return jsonify({}), 200
        c, ctx = conn(), ctx_now()
        r, _ = fetch_doc(c, ctx, doc_id, need="edit", allow_trashed=False)
        if r["status"] == "processing":
            raise ApiError("This document is being read right now.", 409)
        with Tx():
            W.enqueue(c, doc_id, "reprocess", commit=False)
            _prov(c, "reprocessed", doc_id, title_of(r), ctx.uid, r["cv_user_id"], {})
        worker.kick()
        return jsonify({"ok": True, "status": "queued"})

    # ── versions ────────────────────────────────────────────────────────────────────
    @bp.route("/docs/<int:doc_id>/versions", methods=["POST", "OPTIONS"])
    @jwt_required()
    def new_version(doc_id):
        if request.method == "OPTIONS":
            return jsonify({}), 200
        c, ctx = conn(), ctx_now()
        r, _ = fetch_doc(c, ctx, doc_id, need="edit", allow_trashed=False)
        if "file" not in request.files:
            raise ApiError("No file was sent.", 400)
        matter_id = None
        if (r["cv_case_id"] or "").startswith("matter:"):
            matter_id = _int(r["cv_case_id"].split(":", 1)[1])
        cur = c.execute("SELECT doc_id FROM dms_docs WHERE group_id = ? AND is_current = 1", (r["group_id"],)).fetchone()
        base = c.execute(f"SELECT {I._LIST_COLS} FROM dms_docs d JOIN case_vault cv ON cv.id = d.doc_id WHERE d.doc_id = ?", (cur["doc_id"],)).fetchone() or r
        dup, row = ingest(c, ctx, request.files["file"], base["cv_folder_id"], matter_id, None, None, True, group_of=r["group_id"],
                          note=request.form.get("note"), title=title_of(base))
        if dup:
            raise ApiError("That file is identical to a version that already exists.", 409, code="identical_version")
        return jsonify({"ok": True, "doc": docs_payload(c, ctx, [row])[0]}), 201

    @bp.route("/docs/<int:doc_id>/promote", methods=["POST", "OPTIONS"])
    @jwt_required()
    def promote(doc_id):
        if request.method == "OPTIONS":
            return jsonify({}), 200
        c, ctx = conn(), ctx_now()
        r, _ = fetch_doc(c, ctx, doc_id, need="edit", allow_trashed=False)
        with Tx():
            c.execute("UPDATE dms_docs SET is_current = 0 WHERE group_id = ?", (r["group_id"],))
            c.execute("UPDATE dms_docs SET is_current = 1, updated_at = ? WHERE doc_id = ?", (_now_iso(), doc_id))
            _prov(c, "version-restored", doc_id, title_of(r), ctx.uid, r["cv_user_id"], {"version": r["version"]})
        return jsonify({"ok": True})

    # ── trash ───────────────────────────────────────────────────────────────────────
    def group_rows(c, r):
        return c.execute("SELECT d.doc_id, d.legal_hold FROM dms_docs d WHERE d.group_id = ?", (r["group_id"],)).fetchall()

    def do_trash(c, ctx, r):
        rows = group_rows(c, r)
        if any(x["legal_hold"] for x in rows):
            return "Under legal hold - lift the hold before deleting."
        c.execute("UPDATE dms_docs SET deleted_at = ?, deleted_by = ? WHERE group_id = ?", (_now_iso(), ctx.uid, r["group_id"]))
        _prov(c, "trashed", r["doc_id"], title_of(r), ctx.uid, r["cv_user_id"], {"versions": len(rows)})
        return None

    def do_restore(c, ctx, r):
        c.execute("UPDATE dms_docs SET deleted_at = NULL, deleted_by = NULL WHERE group_id = ?", (r["group_id"],))
        _prov(c, "restored", r["doc_id"], title_of(r), ctx.uid, r["cv_user_id"], {})
        return None

    def do_purge(c, ctx, r, level):
        if level != "own":
            return "Only the owner can delete permanently."
        rows = group_rows(c, r)
        if any(x["legal_hold"] for x in rows):
            return "Under legal hold - lift the hold before deleting."
        _prov(c, "purged", r["doc_id"], title_of(r), ctx.uid, r["cv_user_id"], {"versions": len(rows), "file": r["original_name"], "sha256": r["sha256"][:16]})
        c.commit()
        for x in rows:
            W.purge_document(c, x["doc_id"])
        return None

    @bp.route("/docs/<int:doc_id>", methods=["DELETE", "OPTIONS"])
    @jwt_required()
    def trash_doc(doc_id):
        if request.method == "OPTIONS":
            return jsonify({}), 200
        c, ctx = conn(), ctx_now()
        r, _ = fetch_doc(c, ctx, doc_id, need="edit", allow_trashed=False)
        with Tx():
            msg = do_trash(c, ctx, r)
        if msg:
            raise ApiError(msg, 409, code="legal_hold")
        return jsonify({"ok": True})

    @bp.route("/docs/<int:doc_id>/restore", methods=["POST", "OPTIONS"])
    @jwt_required()
    def restore_doc(doc_id):
        if request.method == "OPTIONS":
            return jsonify({}), 200
        c, ctx = conn(), ctx_now()
        r, _ = fetch_doc(c, ctx, doc_id, need="edit")
        with Tx():
            do_restore(c, ctx, r)
        return jsonify({"ok": True})

    @bp.route("/docs/<int:doc_id>/purge", methods=["DELETE", "OPTIONS"])
    @jwt_required()
    def purge_doc(doc_id):
        if request.method == "OPTIONS":
            return jsonify({}), 200
        c, ctx = conn(), ctx_now()
        r, level = fetch_doc(c, ctx, doc_id, need="edit")
        if not r["deleted_at"]:
            raise ApiError("Move it to the trash first.", 409)
        begin(c)
        msg = do_purge(c, ctx, r, level)
        if msg:
            c.rollback()
            raise ApiError(msg, 409 if "hold" in msg else 403, code="legal_hold" if "hold" in msg else None)
        return jsonify({"ok": True})

    @bp.route("/trash", methods=["GET", "OPTIONS"])
    @jwt_required()
    def trash_list():
        if request.method == "OPTIONS":
            return jsonify({}), 200
        c, ctx = conn(), ctx_now()
        flt = filters_from(request.args)
        flt["trash"] = True
        res = I.search_docs(c, ctx, request.args.get("q") or "", flt, request.args.get("sort") or "newest",
                            _int(request.args.get("page"), 1), _int(request.args.get("per_page"), 50), want_facets=False)
        return jsonify({"docs": docs_payload(c, ctx, res["rows"], res["snippets"]), "total": res["total"], "days": W.TRASH_DAYS})

    @bp.route("/trash/empty", methods=["POST", "OPTIONS"])
    @jwt_required()
    def trash_empty():
        if request.method == "OPTIONS":
            return jsonify({}), 200
        c, ctx = conn(), ctx_now()
        res = I.search_docs(c, ctx, "", {"trash": True}, "oldest", 1, 100, want_facets=False)
        purged = skipped = 0
        seen_groups = set()
        for r in res["rows"]:
            if r["group_id"] in seen_groups:
                continue
            seen_groups.add(r["group_id"])
            r2, level = fetch_doc(c, ctx, r["doc_id"], need="view")
            begin(c)
            msg = do_purge(c, ctx, r2, level)
            if msg:
                c.rollback()
                skipped += 1
            else:
                purged += 1
        return jsonify({"ok": True, "purged": purged, "skipped": skipped, "more": res["total"] > 100})

    # ── bulk ────────────────────────────────────────────────────────────────────────
    @bp.route("/bulk", methods=["POST", "OPTIONS"])
    @jwt_required()
    def bulk():
        if request.method == "OPTIONS":
            return jsonify({}), 200
        c, ctx = conn(), ctx_now()
        b = request.get_json(force=True, silent=True) or {}
        ids = [i for i in (_int(x) for x in (b.get("ids") or [])) if i][:BULK_LIMIT]
        action = str(b.get("action") or "")
        if not ids:
            raise ApiError("Nothing selected.", 400)
        if action not in ("move", "classify", "trash", "restore", "purge", "link_matter", "tag_add", "tag_remove", "reprocess", "hold", "accept"):
            raise ApiError("Unknown action.", 400)
        done, skipped = 0, []
        seen_groups = set()
        for did in ids:
            try:
                r, level = fetch_doc(c, ctx, did, need="edit")
            except ApiError as e:
                skipped.append({"id": did, "reason": e.message})
                continue
            if action not in ("purge",) and r["group_id"] in seen_groups and action in ("trash", "restore"):
                continue
            seen_groups.add(r["group_id"])
            try:
                begin(c)
                msg = None
                if action == "trash":
                    msg = "Already in the trash." if r["deleted_at"] else do_trash(c, ctx, r)
                elif action == "restore":
                    msg = None if r["deleted_at"] else "Not in the trash."
                    if not msg:
                        do_restore(c, ctx, r)
                elif action == "purge":
                    if not r["deleted_at"]:
                        msg = "Move it to the trash first."
                    else:
                        msg = do_purge(c, ctx, r, level)
                        if not msg:
                            done += 1
                            continue
                elif r["deleted_at"]:
                    msg = "In the trash."
                elif action == "move":
                    apply_patch(c, ctx, r, level, {"folder_id": b.get("folder_id")})
                elif action == "classify":
                    apply_patch(c, ctx, r, level, {"doc_class": b.get("doc_class")})
                elif action == "link_matter":
                    apply_patch(c, ctx, r, level, {"matter_id": b.get("matter_id")})
                elif action == "accept":
                    apply_patch(c, ctx, r, level, {"review": "reviewed"})
                elif action == "hold":
                    apply_patch(c, ctx, r, level, {"legal_hold": bool(b.get("hold", True))})
                elif action in ("tag_add", "tag_remove"):
                    cur = I._loads(r["tags"], [])
                    tags = [str(t).strip()[:40] for t in (b.get("tags") or []) if str(t).strip()]
                    new = cur + [t for t in tags if t.lower() not in [x.lower() for x in cur]] if action == "tag_add" \
                        else [t for t in cur if t.lower() not in [x.lower() for x in tags]]
                    apply_patch(c, ctx, r, level, {"tags": new})
                elif action == "reprocess":
                    if r["status"] == "processing":
                        msg = "Being read right now."
                    else:
                        W.enqueue(c, did, "reprocess", commit=False)
                        _prov(c, "reprocessed", did, title_of(r), ctx.uid, r["cv_user_id"], {})
                if msg:
                    c.rollback()
                    skipped.append({"id": did, "reason": msg})
                else:
                    c.commit()
                    done += 1
            except ApiError as e:
                c.rollback()
                skipped.append({"id": did, "reason": e.message})
        if action == "reprocess":
            worker.kick()
        return jsonify({"ok": True, "done": done, "skipped": skipped})

    # ── queues / duplicates / batches ───────────────────────────────────────────────
    @bp.route("/queue", methods=["GET", "OPTIONS"])
    @jwt_required()
    def queue():
        if request.method == "OPTIONS":
            return jsonify({}), 200
        c, ctx = conn(), ctx_now()
        kind = request.args.get("kind", "review")
        flt = {"needs_review": True} if kind == "review" else {"problems": True}
        res = I.search_docs(c, ctx, "", flt, "newest", _int(request.args.get("page"), 1), _int(request.args.get("per_page"), 40), want_facets=False)
        return jsonify({"docs": docs_payload(c, ctx, res["rows"]), "total": res["total"], "kind": kind})

    @bp.route("/duplicates", methods=["GET", "OPTIONS"])
    @jwt_required()
    def duplicates():
        if request.method == "OPTIONS":
            return jsonify({}), 200
        c, ctx = conn(), ctx_now()
        vis = I.visibility_sql(c, ctx)
        frm = "FROM dms_docs d JOIN case_vault cv ON cv.id = d.doc_id"
        live = f"{vis} AND d.deleted_at IS NULL AND d.is_current = 1"
        params = {"uid": ctx.uid}
        groups = []
        for kind, col, having in (("same file", "d.sha256", "COUNT(*) > 1"),
                                  ("same text", "d.text_hash", "COUNT(*) > 1 AND COUNT(DISTINCT d.sha256) > 1")):
            keys = [r[0] for r in c.execute(
                f"SELECT {col} {frm} WHERE {live} AND {col} IS NOT NULL GROUP BY {col} HAVING {having} ORDER BY COUNT(*) DESC LIMIT 100", params)]
            for k in keys:
                rows = c.execute(f"SELECT {I._LIST_COLS} {frm} WHERE {live} AND {col} = :k ORDER BY d.created_at ASC LIMIT 12", {**params, "k": k}).fetchall()
                groups.append({"kind": kind, "key": str(k)[:12], "docs": docs_payload(c, ctx, rows)})
        return jsonify({"groups": groups, "count": len(groups), "extra_docs": sum(len(g_["docs"]) - 1 for g_ in groups)})

    @bp.route("/batches/<string:batch_id>", methods=["GET", "OPTIONS"])
    @jwt_required()
    def batch(batch_id):
        if request.method == "OPTIONS":
            return jsonify({}), 200
        c, ctx = conn(), ctx_now()
        rows = c.execute("SELECT d.status AS s, d.review AS rv, COUNT(*) AS n FROM dms_docs d JOIN case_vault cv ON cv.id = d.doc_id "
                         "WHERE d.batch_id = ? AND d.uploaded_by = ? AND d.deleted_at IS NULL GROUP BY d.status, d.review", (batch_id[:64], ctx.uid)).fetchall()
        by = {}
        review = 0
        for r in rows:
            by[r["s"]] = by.get(r["s"], 0) + r["n"]
            if r["rv"] == "needs_review":
                review += r["n"]
        total = sum(by.values())
        working = by.get("queued", 0) + by.get("processing", 0)
        return jsonify({"total": total, "working": working, "done": total - working, "review": review,
                        "problems": sum(by.get(k, 0) for k in W.PROBLEM_STATUSES), "by_status": by})

    # ── exports ─────────────────────────────────────────────────────────────────────
    @bp.route("/export.csv", methods=["GET", "OPTIONS"])
    @jwt_required()
    def export_csv():
        if request.method == "OPTIONS":
            return jsonify({}), 200
        ctx = ctx_now()
        flt = filters_from(request.args)
        q = request.args.get("q") or ""
        with Tx() as tx:
            _prov(tx, "exported", None, "Document inventory (CSV)", ctx.uid, ctx.uid, {"filters": flt, "q": q})
        header = ["ID", "Title", "File name", "Type", "Document class", "Case numbers", "Parties", "Court", "Document date", "Next hearing",
                  "Folder", "Matter", "Pages", "Size (KB)", "Status", "Uploaded", "Version", "Legal hold", "SHA-256"]

        def rows():
            c = I.connect(db_path)
            try:
                folders = {r["id"]: r["name"] for r in c.execute("SELECT id, name FROM vault_folders")}
                matters_ = {f"matter:{m['id']}": m["title"] for m in I.matter_ids_for(c, ctx.uid)}
                buf = io.StringIO()
                w = csv.writer(buf)
                w.writerow(header)
                yield "﻿" + buf.getvalue()
                page = 1
                while page <= 500:
                    res = I.search_docs(c, ctx, q, flt, request.args.get("sort") or "newest", page, 100, want_facets=False)
                    if not res["rows"]:
                        break
                    buf = io.StringIO()
                    w = csv.writer(buf)
                    for r in res["rows"]:
                        d = I.doc_dict(r)
                        w.writerow([_csv_safe(x) for x in (
                            d["id"], d["title"], d["original_name"], d["ext"], d["doc_class"], "; ".join(d["case_numbers"] + d["fir_numbers"]),
                            d["parties"], d["court"], d["doc_date"], d["next_hearing"], folders.get(d["folder_id"], ""),
                            matters_.get(r["cv_case_id"], ""), d["page_count"], round((d["size"] or 0) / 1024, 1), d["status"],
                            d["created_at"], d["version"], "yes" if d["legal_hold"] else "", r["sha256"])])
                    yield buf.getvalue()
                    if page * 100 >= res["total"]:
                        break
                    page += 1
            finally:
                c.close()

        return Response(stream_with_context(rows()), mimetype="text/csv",
                        headers={"Content-Disposition": 'attachment; filename="document-inventory.csv"', "X-Content-Type-Options": "nosniff"})

    @bp.route("/download-zip", methods=["POST", "OPTIONS"])
    @jwt_required()
    def download_zip():
        if request.method == "OPTIONS":
            return jsonify({}), 200
        c, ctx = conn(), ctx_now()
        b = request.get_json(force=True, silent=True) or {}
        ids = [i for i in (_int(x) for x in (b.get("ids") or [])) if i]
        if not ids:
            raise ApiError("Nothing selected.", 400)
        if len(ids) > ZIP_MAX_DOCS:
            raise ApiError(f"Select at most {ZIP_MAX_DOCS} documents per download.", 400)
        rows = [fetch_doc(c, ctx, i, allow_trashed=False)[0] for i in ids]
        if sum(r["size"] or 0 for r in rows) > ZIP_MAX_BYTES:
            raise ApiError("That selection is too large for one download. Choose fewer documents.", 413)
        zdir = os.path.join(S.storage_root(), "_incoming")
        os.makedirs(zdir, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix="zip_", suffix=".zip", dir=zdir)
        os.close(fd)
        used = set()
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
            for r in rows:
                base = _safe_name(r["original_name"] or title_of(r))
                name, n = base, 1
                while name.lower() in used:
                    n += 1
                    stem, dot, ext = base.rpartition(".")
                    name = f"{stem or base} ({n}){dot}{ext}" if dot else f"{base} ({n})"
                used.add(name.lower())
                try:
                    with S.open_plain(r["store_key"], bool(r["enc"])) as path:
                        zf.write(path, name, compress_type=zipfile.ZIP_STORED if r["ext"] in ("pdf", "jpg", "png", "docx", "xlsx", "pptx") else zipfile.ZIP_DEFLATED)
                except S.StoreError:
                    zf.writestr(name + ".MISSING.txt", "This file is missing from the server's storage.")
        with Tx() as tx:
            for r in rows:
                _prov(tx, "download", r["doc_id"], title_of(r), ctx.uid, r["cv_user_id"], {"via": "zip"})
        resp = send_file(tmp, mimetype="application/zip", as_attachment=True, download_name="documents.zip", max_age=0)
        resp.call_on_close(lambda: os.path.exists(tmp) and os.remove(tmp))
        resp.headers["X-Content-Type-Options"] = "nosniff"
        return resp

    return bp
