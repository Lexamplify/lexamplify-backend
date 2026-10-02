"""Scan intake: a pile of paper (phone photos or a scanner's PDF) becomes separate, clean, named documents filed on the right cases.

    POST   /files/scan                            start a scan session (optionally for one case)
    GET    /files/scan                            my unfinished scans
    GET    /files/scan/<sid>                      the session: pages (with progress), the document layout, defaults
    DELETE /files/scan/<sid>                      throw it away
    POST   /files/scan/<sid>/pages                add ONE picture or ONE PDF (a PDF becomes one page per sheet)
    GET    /files/scan/<sid>/pages/<pid>/<thumb|view|full>
    GET    /files/scan/<sid>/pages/<pid>/text     what was read from the page
    POST   /files/scan/<sid>/pages/<pid>/rotate   turn a page 90 / 180 / 270 degrees
    POST   /files/scan/<sid>/pages/<pid>/retry    run a failed page again
    DELETE /files/scan/<sid>/pages/<pid>
    PUT    /files/scan/<sid>/layout               save which pages make which document, with names / types / cases
    POST   /files/scan/<sid>/suggest              propose the split, names, types and cases
    POST   /files/scan/<sid>/finalize             build one PDF per document and put it in the library (in small batches)
    GET    /files/scan/separator.pdf              printable separator sheets
"""
import contextlib
import hashlib
import json
import os
import re
import secrets
import threading

from flask import jsonify, request, send_file

from utils import dms_classify as C
from utils import dms_files as F
from utils import dms_index as I
from utils import dms_match as M
from utils import dms_paper as PF
from utils import dms_scan as SC

MAX_PDF_MB = int(os.getenv("DMS_SCAN_MAX_PDF_MB", "100"))
MAX_DOCS = 300
OPEN_SESSIONS_PER_USER = 20
IMG_KIND = "image"

_BUSY = set()
_BUSY_LOCK = threading.Lock()


def _body():
    b = request.get_json(force=True, silent=True)
    return b if isinstance(b, dict) else {}


class _Upload:
    """What the hub's ingest() reads from: a name and a stream."""

    def __init__(self, name, path):
        self.filename, self.stream = name, open(path, "rb")


def mount(bp, h, api):
    from routes.dms_files import actor_name

    scan_worker = SC.ScanWorker(h.db_path, log=h.log)
    h.scan_worker = scan_worker

    @bp.errorhandler(SC.ScanError)
    def _scan_error(e):
        return h.err(e.message, e.status)

    # stopping the hub's worker (tests, shutdown) stops this one too
    hub_stop = h.worker.stop

    def stop_both(*a, **k):
        scan_worker.stop()
        return hub_stop(*a, **k)

    with contextlib.suppress(Exception):
        h.worker.stop = stop_both

    boot = I.connect(h.db_path)
    try:
        SC.sweep_old(boot)
        boot.execute("UPDATE dms_scan_pages SET status = 'queued' WHERE status = 'processing'")
        boot.commit()
        waiting = boot.execute("SELECT COUNT(*) FROM dms_scan_pages WHERE status = 'queued'").fetchone()[0]
    finally:
        boot.close()
    if waiting:
        scan_worker.kick()

    def me(c):
        uid = h.uid_now()
        return uid, F.scope_of(c, uid)

    def own(c, uid, sid):
        SC.session_dir(sid)
        r = c.execute("SELECT * FROM dms_scan_sessions WHERE id = ? AND owner_id = ?", (sid, uid)).fetchone()
        if not r:
            raise h.ApiError("This scan was not found. It may already have been filed or discarded.", 404)
        return r

    def save_state(c, sid, state):
        c.execute("UPDATE dms_scan_sessions SET state = ?, updated_at = ? WHERE id = ?", (json.dumps(state), F.now_iso(), sid))

    # ── describing ───────────────────────────────────────────────────────────────────
    def page_dict(r):
        info = F.loads(r["info"], {})
        d = {"id": r["id"], "seq": r["seq"], "name": r["src_name"], "kind": r["src_kind"], "status": r["status"], "error": r["error"],
             "w": r["w"], "h": r["h"]}
        if r["status"] == "ready":
            d.update({"blank": bool(info.get("blank")), "separator": bool(info.get("separator")), "rot": int(info.get("rot_manual") or 0),
                      "ocr": bool(info.get("ocr") or info.get("native")), "v": info.get("done") or 0,
                      "notes": [str(n)[:80] for n in (info.get("notes") or [])[:3]],
                      "chars": int((info.get("f") or {}).get("chars") or 0)})
        elif r["status"] == "queued" and info.get("done"):
            d["v"] = info.get("done")
        return d

    def labels_for(c, layout, defaults):
        refs = {d.get("case_ref") for d in layout.get("docs", [])} | {defaults.get("case_ref")}
        out = {}
        for ref in refs:
            if ref:
                out[ref] = F.case_label(c, ref)
        return out

    def session_payload(c, r):
        rows = c.execute("SELECT id, seq, src_name, src_kind, status, error, w, h, info FROM dms_scan_pages WHERE session_id = ? ORDER BY seq, id", (r["id"],)).fetchall()
        pages = [page_dict(p) for p in rows]
        state = F.loads(r["state"], {})
        layout = state.get("layout")
        defaults = state.get("defaults") or {}
        counts = {"total": len(pages), "ready": sum(1 for p in pages if p["status"] == "ready"),
                  "working": sum(1 for p in pages if p["status"] in ("queued", "processing")), "failed": sum(1 for p in pages if p["status"] == "failed")}
        placed = set()
        if layout:
            for d in layout["docs"]:
                placed.update(d["pages"])
            placed.update(layout.get("removed") or [])
        unplaced = [p["id"] for p in pages if p["status"] == "ready" and layout and p["id"] not in placed]
        labels = labels_for(c, layout or {"docs": []}, defaults)
        pf_label = None
        if defaults.get("pfile_id"):
            with contextlib.suppress(Exception):
                scope = F.scope_of(c, r["owner_id"])
                pf = PF.get_pfile(c, scope, defaults["pfile_id"], r["owner_id"])
                pf_label = f"{pf['file_no']} - {pf['title']}"
        filed = {k: v.get("doc_id") for k, v in (state.get("filed") or {}).items()}
        filed_docs = {}                                     # layout key -> what was made, so a reload shows which documents are already done
        if layout:
            for d in layout["docs"]:
                res = (state.get("filed") or {}).get(sig_of(d["pages"]))
                if res:
                    filed_docs[d["key"]] = res
        return {"id": r["id"], "created_at": r["created_at"], "updated_at": r["updated_at"], "pages": pages, "counts": counts, "layout": layout,
                "defaults": defaults, "unplaced": unplaced, "case_labels": labels, "pfile_label": pf_label, "filed": filed, "filed_docs": filed_docs}

    # ── sessions ─────────────────────────────────────────────────────────────────────
    @api("/files/scan/separator.pdf", ["GET"])
    def scan_separator():
        n = h.int_(request.args.get("count"), 1) or 1
        pdf = SC.separator_pdf(max(1, min(n, 20)))
        from io import BytesIO
        return send_file(BytesIO(pdf), mimetype="application/pdf", as_attachment=True, download_name="separator-sheets.pdf", max_age=0)

    @api("/files/scan", ["GET", "POST"])
    def scan_sessions():
        c = h.conn()
        uid, scope = me(c)
        if request.method == "POST":
            b = _body()
            n_open = c.execute("SELECT COUNT(*) FROM dms_scan_sessions WHERE owner_id = ? AND status = 'open'", (uid,)).fetchone()[0]
            if n_open >= OPEN_SESSIONS_PER_USER:
                raise h.ApiError("You have many unfinished scans. File or discard some before starting another.", 409)
            defaults = {}
            ref = (b.get("case_ref") or "").strip()
            if ref:
                ok, why = F.can_use_case(c, uid, ref, writing=True)
                if not ok:
                    raise h.ApiError(why, 404)
                defaults["case_ref"] = ref
            pfid = h.int_(b.get("pfile_id"))
            if pfid:
                PF.get_pfile(c, scope, pfid, uid)
                defaults["pfile_id"] = pfid
            sid = secrets.token_urlsafe(12)
            with h.Tx() as tx:
                SC.sweep_old(tx)
                tx.execute("INSERT INTO dms_scan_sessions (id, scope, owner_id, status, state, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
                           (sid, scope, uid, "open", json.dumps({"defaults": defaults} if defaults else {}), F.now_iso(), F.now_iso()))
            os.makedirs(SC.session_dir(sid), exist_ok=True)
            return jsonify({"ok": True, "scan": session_payload(c, own(c, uid, sid))}), 201
        rows = c.execute("SELECT s.*, (SELECT COUNT(*) FROM dms_scan_pages p WHERE p.session_id = s.id) AS n, "
                         "(SELECT COUNT(*) FROM dms_scan_pages p WHERE p.session_id = s.id AND p.status IN ('queued','processing')) AS working "
                         "FROM dms_scan_sessions s WHERE s.owner_id = ? AND s.status = 'open' ORDER BY s.updated_at DESC LIMIT 30", (uid,)).fetchall()
        out = []
        for r in rows:
            st = F.loads(r["state"], {})
            case_ref = (st.get("defaults") or {}).get("case_ref")
            out.append({"id": r["id"], "created_at": r["created_at"], "updated_at": r["updated_at"], "pages": r["n"], "working": r["working"],
                        "documents": len((st.get("layout") or {}).get("docs") or []), "case_label": F.case_label(c, case_ref) if case_ref else None})
        return jsonify({"scans": out})

    @api("/files/scan/<sid>", ["GET", "DELETE"])
    def scan_one(sid):
        c = h.conn()
        uid, _scope = me(c)
        r = own(c, uid, sid)
        if request.method == "DELETE":
            with _BUSY_LOCK:
                if sid in _BUSY:
                    raise h.ApiError("This scan is being filed right now.", 409)
            with h.Tx() as tx:
                tx.execute("DELETE FROM dms_scan_pages WHERE session_id = ?", (sid,))
                tx.execute("DELETE FROM dms_scan_sessions WHERE id = ?", (sid,))
            SC.discard_files(sid)
            return jsonify({"ok": True})
        return jsonify({"scan": session_payload(c, r)})

    # ── pages ────────────────────────────────────────────────────────────────────────
    def clean_name(name):
        base = os.path.basename(str(name or "").replace("\\", "/"))
        base = re.sub(r"[\x00-\x1f]", "", base).strip()
        return base[:120] or "scan"

    @api("/files/scan/<sid>/pages", ["POST"])
    def scan_add_page(sid):
        c = h.conn()
        uid, _scope = me(c)
        own(c, uid, sid)
        fs = request.files.get("file")
        if not fs or not getattr(fs, "filename", ""):
            raise h.ApiError("No picture or file was sent.", 400)
        name = clean_name(fs.filename)
        ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
        if ext in ("heic", "heif"):
            raise h.ApiError("HEIC photos are not supported. On an iPhone choose Settings > Camera > Formats > Most Compatible, or share the photo as JPEG.", 415)
        if ext in SC.IMAGE_EXT:
            kind = "image"
        elif ext == "pdf":
            kind = "pdf"
        else:
            raise h.ApiError("Add photos (JPG, PNG, WebP, TIFF) or a scanned PDF.", 415)
        d = SC.session_dir(sid)
        os.makedirs(d, exist_ok=True)
        src_file = f"src{secrets.token_hex(5)}.{ext}"
        dest = os.path.join(d, src_file)
        limit = (SC.MAX_IMAGE_BYTES if kind == "image" else MAX_PDF_MB * 1024 * 1024)
        keep = False
        try:
            fs.save(dest)
            size = os.path.getsize(dest)
            if size > limit:
                raise h.ApiError(f"That file is larger than {limit // (1024 * 1024)} MB.", 413)
            if size == 0:
                raise h.ApiError("That file is empty.", 400)
            n_pages = 1
            if kind == "image":
                from PIL import Image
                try:
                    with Image.open(dest) as im:
                        im.verify()
                except Exception:
                    raise h.ApiError("That does not look like a readable picture.", 415)
            else:
                try:
                    import pymupdf as fitz
                except ImportError:  # pragma: no cover
                    import fitz
                try:
                    doc = fitz.open(dest)
                except Exception:
                    raise h.ApiError("That PDF could not be opened.", 415)
                try:
                    if doc.needs_pass or doc.is_encrypted:
                        raise h.ApiError("That PDF is password protected. Remove the password and try again.", 415)
                    n_pages = doc.page_count
                finally:
                    doc.close()
                if n_pages < 1:
                    raise h.ApiError("That PDF has no pages.", 400)
            with h.Tx() as tx:
                have = tx.execute("SELECT COUNT(*), COALESCE(MAX(seq), 0) FROM dms_scan_pages WHERE session_id = ?", (sid,)).fetchone()
                if have[0] + n_pages > SC.MAX_PAGES_PER_SESSION:
                    raise h.ApiError(f"One scan holds up to {SC.MAX_PAGES_PER_SESSION} pages. File this one first, then start another.", 409)
                if not tx.execute("SELECT 1 FROM dms_scan_sessions WHERE id = ?", (sid,)).fetchone():
                    raise h.ApiError("This scan was discarded.", 404)
                new_ids = []
                for i in range(n_pages):
                    info = {"src_file": src_file}
                    if kind == "pdf":
                        info["pdf_page"] = i
                    cur = tx.execute("INSERT INTO dms_scan_pages (session_id, seq, src_name, src_kind, status, info, created_at) VALUES (?,?,?,?,?,?,?)",
                                     (sid, have[1] + 1 + i, name, kind, "queued", json.dumps(info), F.now_iso()))
                    new_ids.append(cur.lastrowid)
                tx.execute("UPDATE dms_scan_sessions SET updated_at = ? WHERE id = ?", (F.now_iso(), sid))
            keep = True
        finally:
            if not keep:
                with contextlib.suppress(OSError):
                    os.remove(dest)
        scan_worker.kick()
        rows = c.execute(f"SELECT id, seq, src_name, src_kind, status, error, w, h, info FROM dms_scan_pages WHERE id IN ({','.join('?' * len(new_ids))}) ORDER BY seq", new_ids).fetchall()
        return jsonify({"ok": True, "pages": [page_dict(p) for p in rows]}), 201

    def get_page(c, uid, sid, pid):
        own(c, uid, sid)
        r = c.execute("SELECT * FROM dms_scan_pages WHERE id = ? AND session_id = ?", (pid, sid)).fetchone()
        if not r:
            raise h.ApiError("That page was not found.", 404)
        return r

    @api("/files/scan/<sid>/pages/<int:pid>/<which>", ["GET"])
    def scan_page_image(sid, pid, which):
        c = h.conn()
        uid, _scope = me(c)
        r = get_page(c, uid, sid, pid)
        if which == "text":
            return jsonify({"text": (r["text"] or "")[:20000], "status": r["status"]})
        key = {"thumb": "thumb", "view": "view", "full": "clean"}.get(which)
        if not key:
            raise h.ApiError("Not found.", 404)
        path = SC.page_paths(sid, pid)[key]
        if r["status"] != "ready" and not os.path.exists(path):
            raise h.ApiError("This page is not ready yet.", 404)
        if not os.path.exists(path):
            raise h.ApiError("The picture of this page is no longer available.", 404)
        resp = send_file(path, mimetype="image/jpeg", max_age=3600, conditional=True)
        resp.headers["Cache-Control"] = "private, max-age=3600"
        return resp

    @api("/files/scan/<sid>/pages/<int:pid>/rotate", ["POST"])
    def scan_rotate(sid, pid):
        c = h.conn()
        uid, _scope = me(c)
        r = get_page(c, uid, sid, pid)
        deg = h.int_(_body().get("deg"), 90)
        if deg not in (90, 180, 270):
            raise h.ApiError("Rotate by 90, 180 or 270 degrees.", 400)
        if r["status"] != "ready":
            raise h.ApiError("Wait until this page has been cleaned, then rotate it.", 409)
        info = F.loads(r["info"], {})
        info["reprocess"] = {"rot": deg}
        with h.Tx() as tx:
            n = tx.execute("UPDATE dms_scan_pages SET status = 'queued', info = ? WHERE id = ? AND status = 'ready'", (json.dumps(info), pid)).rowcount
            if not n:
                raise h.ApiError("This page is busy. Try again in a moment.", 409)
            tx.execute("UPDATE dms_scan_sessions SET updated_at = ? WHERE id = ?", (F.now_iso(), sid))
        scan_worker.kick()
        row = c.execute("SELECT id, seq, src_name, src_kind, status, error, w, h, info FROM dms_scan_pages WHERE id = ?", (pid,)).fetchone()
        return jsonify({"ok": True, "page": page_dict(row)})

    @api("/files/scan/<sid>/pages/<int:pid>/retry", ["POST"])
    def scan_retry(sid, pid):
        c = h.conn()
        uid, _scope = me(c)
        r = get_page(c, uid, sid, pid)
        if r["status"] != "failed":
            raise h.ApiError("Only a page that failed can be run again.", 409)
        with h.Tx() as tx:
            tx.execute("UPDATE dms_scan_pages SET status = 'queued', error = NULL WHERE id = ? AND status = 'failed'", (pid,))
        scan_worker.kick()
        row = c.execute("SELECT id, seq, src_name, src_kind, status, error, w, h, info FROM dms_scan_pages WHERE id = ?", (pid,)).fetchone()
        return jsonify({"ok": True, "page": page_dict(row)})

    @api("/files/scan/<sid>/pages/<int:pid>", ["DELETE"])
    def scan_delete_page(sid, pid):
        c = h.conn()
        uid, _scope = me(c)
        r = get_page(c, uid, sid, pid)
        info = F.loads(r["info"], {})
        with h.Tx() as tx:
            tx.execute("DELETE FROM dms_scan_pages WHERE id = ?", (pid,))
            s = tx.execute("SELECT state FROM dms_scan_sessions WHERE id = ?", (sid,)).fetchone()
            state = F.loads(s["state"], {}) if s else {}
            lay = state.get("layout")
            if lay:
                for d in lay["docs"]:
                    d["pages"] = [p for p in d["pages"] if p != pid]
                lay["docs"] = [d for d in lay["docs"] if d["pages"]]
                lay["removed"] = [p for p in (lay.get("removed") or []) if p != pid]
                save_state(tx, sid, state)
            others = [F.loads(x["info"], {}).get("src_file") for x in tx.execute("SELECT info FROM dms_scan_pages WHERE session_id = ?", (sid,))]
        paths = SC.page_paths(sid, pid)
        for k in ("clean", "view", "thumb", "pdf"):
            with contextlib.suppress(OSError):
                os.remove(paths[k])
        src = info.get("src_file")
        if src and src not in others:
            with contextlib.suppress(OSError):
                os.remove(os.path.join(SC.session_dir(sid), src))
        return jsonify({"ok": True})

    # ── layout ───────────────────────────────────────────────────────────────────────
    def sig_of(pids):
        return hashlib.sha1(",".join(str(p) for p in pids).encode()).hexdigest()[:16]

    def check_pfile(c, scope, uid, pfid):
        try:
            return PF.get_pfile(c, scope, pfid, uid)
        except PF.PaperError as exc:
            raise h.ApiError(exc.message, exc.status)

    def norm_layout(c, uid, scope, raw, valid_ids, filed=()):
        docs_in = raw.get("docs") if isinstance(raw, dict) else None
        if not isinstance(docs_in, list):
            raise h.ApiError("The layout is missing.", 400)
        if len(docs_in) > MAX_DOCS:
            raise h.ApiError(f"One scan can hold up to {MAX_DOCS} documents.", 400)
        seen, docs, case_ok, pf_ok, keys = set(), [], {}, set(), set()
        for i, d in enumerate(docs_in):
            if not isinstance(d, dict):
                continue
            pids = []
            for x in d.get("pages") or []:
                pid = h.int_(x)
                if pid not in valid_ids:
                    raise h.ApiError("A page in this layout does not belong to this scan.", 400)
                if pid in seen:
                    raise h.ApiError("A page appears in two documents.", 400)
                seen.add(pid)
                pids.append(pid)
            if not pids:
                continue
            cls = (d.get("doc_class") or "").strip() or None
            if cls and cls not in C.CLASS_NAMES:
                raise h.ApiError("Unknown document type.", 400)
            done = sig_of(pids) in filed                       # already in the library: its case is history, not something to check again
            ref = (d.get("case_ref") or "").strip() or None
            if ref and not done:
                if ref not in case_ok:
                    case_ok[ref] = F.can_use_case(c, uid, ref, writing=True)
                if not case_ok[ref][0]:
                    raise h.ApiError(case_ok[ref][1], 404)
            pfid = h.int_(d.get("pfile_id"))
            if pfid and not done and pfid not in pf_ok:
                check_pfile(c, scope, uid, pfid)
                pf_ok.add(pfid)
            fid = h.int_(d.get("folder_id"))
            key = re.sub(r"[^A-Za-z0-9_\-]", "", str(d.get("key") or ""))[:40] or f"d{i + 1}"
            while key in keys:
                key += "x"
            keys.add(key)
            hint = d.get("hint") if isinstance(d.get("hint"), dict) else None
            if hint:
                hint = {"ref": str(hint.get("ref") or "")[:40], "label": F.clip(hint.get("label"), 160), "score": float(hint.get("score") or 0) if isinstance(hint.get("score"), (int, float)) else 0,
                        "reasons": [F.clip(x, 160) for x in (hint.get("reasons") or [])[:3]], "confident": bool(hint.get("confident"))}
            docs.append({"key": key, "pages": pids, "title": F.clip(d.get("title"), 180) or None, "doc_class": cls, "case_ref": ref, "pfile_id": pfid or None,
                         "folder_id": fid or None, "reasons": [F.clip(x, 160) for x in (d.get("reasons") or [])[:3]], "hint": hint})
        removed = []
        for x in raw.get("removed") or []:
            pid = h.int_(x)
            if pid in valid_ids and pid not in seen and pid not in removed:
                removed.append(pid)
        return {"docs": docs, "removed": removed}

    def valid_page_ids(c, sid):
        return {r[0] for r in c.execute("SELECT id FROM dms_scan_pages WHERE session_id = ?", (sid,))}

    def norm_defaults(c, uid, scope, raw):
        out = {}
        if not isinstance(raw, dict):
            return out
        ref = (raw.get("case_ref") or "").strip()
        if ref:
            ok, why = F.can_use_case(c, uid, ref, writing=True)
            if not ok:
                raise h.ApiError(why, 404)
            out["case_ref"] = ref
        pfid = h.int_(raw.get("pfile_id"))
        if pfid:
            check_pfile(c, scope, uid, pfid)
            out["pfile_id"] = pfid
        fid = h.int_(raw.get("folder_id"))
        if fid:
            h.check_folder(uid, fid, c)
            out["folder_id"] = fid
        return out

    @api("/files/scan/<sid>/layout", ["PUT"])
    def scan_layout(sid):
        c = h.conn()
        uid, scope = me(c)
        r = own(c, uid, sid)
        b = _body()
        state = F.loads(r["state"], {})
        layout = norm_layout(c, uid, scope, b.get("layout") if "layout" in b else b, valid_page_ids(c, sid), set(state.get("filed") or {}))
        state["layout"] = layout
        if "defaults" in b:
            state["defaults"] = norm_defaults(c, uid, scope, b.get("defaults"))
        with h.Tx() as tx:
            save_state(tx, sid, state)
        return jsonify({"ok": True})

    # ── suggestions ──────────────────────────────────────────────────────────────────
    @api("/files/scan/<sid>/suggest", ["POST"])
    def scan_suggest(sid):
        c = h.conn()
        uid, scope = me(c)
        r = own(c, uid, sid)
        b = _body()
        state = F.loads(r["state"], {})
        defaults = state.get("defaults") or {}
        only = {h.int_(x) for x in (b.get("page_ids") or [])} if b.get("page_ids") else None
        rows = c.execute("SELECT id, seq, status, text, info FROM dms_scan_pages WHERE session_id = ? ORDER BY seq, id", (sid,)).fetchall()
        ready = [x for x in rows if x["status"] == "ready" and (only is None or x["id"] in only)]
        skipped = sum(1 for x in rows if x["status"] != "ready" and (only is None or x["id"] in only))
        pages = []
        by_id = {}
        for x in ready:
            info = F.loads(x["info"], {})
            pages.append({"id": x["id"], "info": info, "f": info.get("f") or SC.read_page(x["text"] or "")})
            by_id[x["id"]] = x["text"] or ""
        proposed, removed = SC.split_pages(pages)
        index = M.CaseIndex(c, uid)
        out = []
        for d in proposed:
            texts = [by_id[p] for p in d["pages"]]
            a = SC.analyse_texts(texts)
            facts = M.facts_from_analysis(a, "\n".join(texts))
            cands = []
            if facts["own_keys"] or facts["parties"] or facts["mention_tokens"] or facts["text_tokens"]:
                cands = M.score(facts, index, M.siblings(c, None, facts["own_keys"]))
            state_m, confident = M.decide(cands)
            top = cands[0] if cands and state_m == "pending" else None
            hint = None
            if top:
                hint = {"ref": top["ref"], "label": top.get("label"), "score": top["score"], "reasons": (top.get("reasons") or [])[:3], "confident": bool(confident)}
            case_ref = defaults.get("case_ref") or (top["ref"] if top and confident else None)
            out.append({"key": secrets.token_hex(3), "pages": d["pages"], "title": a["title"], "doc_class": a["doc_class"] if a["doc_class"] != "Unclassified" else None,
                        "class_conf": a["class_conf"], "reasons": d["reasons"][:3], "case_ref": case_ref, "case_label": F.case_label(c, case_ref) if case_ref else None,
                        "hint": hint if not defaults.get("case_ref") else None,
                        "candidates": [{"ref": x["ref"], "label": x.get("label"), "score": x["score"], "reasons": (x.get("reasons") or [])[:2]} for x in cands[:3]],
                        "doc_date": a["doc_date"], "parties": a["parties"], "court": a["court"], "readable": a["readable"],
                        "pfile_id": defaults.get("pfile_id"), "folder_id": defaults.get("folder_id")})
        return jsonify({"docs": out, "removed": removed, "skipped": skipped})

    # ── filing ───────────────────────────────────────────────────────────────────────
    def safe_stub(title):
        t = re.sub(r"[^A-Za-z0-9]+", "-", str(title or "")).strip("-")[:40]
        return t or "scan"

    def file_one(c, uid, scope, actor, sid, d, defaults, state, rows):
        """One finished document: build the PDF, put it in the library, set its type, link it to the paper file. Raises ApiError."""
        pdfs = []
        for pid in d["pages"]:
            row = rows.get(pid)
            if not row or row["status"] != "ready":
                raise h.ApiError("Some pages are not ready yet.", 409)
            path = SC.page_paths(sid, pid)["pdf"]
            if not os.path.exists(path):
                raise h.ApiError("A page's file is missing. Rotate or retry that page, then file again.", 410)
            pdfs.append(path)
        ref = d.get("case_ref") or defaults.get("case_ref")
        pfid = d.get("pfile_id") or defaults.get("pfile_id")
        pf = None
        if pfid:
            pf = check_pfile(c, scope, uid, pfid)
            if not ref and pf["case_ref"]:
                ref = pf["case_ref"]                  # the paper file already belongs to a case: its scans go there too
        folder_id = d.get("folder_id") or defaults.get("folder_id")
        h.check_folder(uid, folder_id, c)
        matter_id, lpms_ref = None, None
        if ref:
            ok, why = F.can_use_case(c, uid, ref, writing=True)
            if not ok:
                raise h.ApiError(why, 409 if "archived" in why else 404)
            if ref.startswith("lpms:"):
                lpms_ref = ref
            elif ref.startswith("matter:"):
                matter_id = int(ref.split(":")[1])
        title = F.clip(d.get("title"), 180) or None
        stamp = F.now_iso().replace("-", "").replace(":", "").replace(" ", "-")[:13]
        name = f"scan-{stamp}-{safe_stub(title)}-{secrets.token_hex(2)}.pdf"
        out_path = os.path.join(SC.session_dir(sid), f"out{secrets.token_hex(4)}.pdf")
        try:
            n = SC.assemble_pdf(pdfs, out_path, title=title)
            up = _Upload(name, out_path)
            try:
                dup, row = h.ingest(c, h.ctx_now(), up, folder_id, matter_id, f"scan-{sid[:8]}", None, True, note=f"Scanned, {n} page{'s' if n != 1 else ''}",
                                    title=title, case_ref=lpms_ref)
            finally:
                with contextlib.suppress(Exception):
                    up.stream.close()
        finally:
            with contextlib.suppress(OSError):
                os.remove(out_path)
        if dup or row is None:
            raise h.ApiError("This document could not be saved (it looks like a duplicate).", 409)
        doc_id = row["doc_id"]
        cls = d.get("doc_class")
        with h.Tx() as tx:
            if cls and cls in C.CLASS_NAMES:
                tx.execute("UPDATE dms_docs SET doc_class = ?, class_src = 'user', class_conf = 1.0, review = 'reviewed' WHERE doc_id = ?", (cls, doc_id))
                tx.execute("UPDATE case_vault SET doc_type = ? WHERE id = ?", (cls if cls != "Unclassified" else "uploaded", doc_id))
            if pf:
                tx.execute("INSERT OR IGNORE INTO dms_pfile_docs (pfile_id, doc_id, linked_by, linked_at) VALUES (?,?,?,?)", (pf["id"], doc_id, uid, F.now_iso()))
                PF._log(tx, pf["id"], "linked-docs", uid, actor, note=f"Scanned: {title or name}"[:300])
            h.prov(tx, "scan-filed", doc_id, title or name, uid, uid, {"pages": n, "case": ref, "paper_file": pf["file_no"] if pf else None})
            I.refresh_meta_fts(tx, doc_id)
        if lpms_ref:
            h.tell_practice(lpms_ref, doc_id, title or name, uid, "upload")
        return {"doc_id": doc_id, "case_ref": ref, "case_label": F.case_label(c, ref) if ref else None, "pages": n, "title": title or name,
                "paper_file": pf["file_no"] if pf else None}

    @api("/files/scan/<sid>/finalize", ["POST"])
    def scan_finalize(sid):
        c = h.conn()
        uid, scope = me(c)
        r = own(c, uid, sid)
        b = _body()
        actor = actor_name(h, c, uid)
        state = F.loads(r["state"], {})
        if "layout" in b:
            state["layout"] = norm_layout(c, uid, scope, b["layout"], valid_page_ids(c, sid), set(state.get("filed") or {}))
        if "defaults" in b:
            state["defaults"] = norm_defaults(c, uid, scope, b.get("defaults"))
        layout = state.get("layout")
        if not layout or not layout["docs"]:
            raise h.ApiError("There is nothing to file yet. Add pages and check the documents first.", 400)
        defaults = state.get("defaults") or {}
        only = {str(k) for k in b["only"]} if isinstance(b.get("only"), list) else None
        with _BUSY_LOCK:
            if sid in _BUSY:
                raise h.ApiError("This scan is already being filed.", 409)
            _BUSY.add(sid)
        try:
            rows = {p["id"]: p for p in c.execute("SELECT id, status FROM dms_scan_pages WHERE session_id = ?", (sid,))}
            state.setdefault("filed", {})
            results = []
            for d in layout["docs"]:
                if only is not None and d["key"] not in only:
                    continue
                sig = sig_of(d["pages"])
                prior = state["filed"].get(sig)
                if prior:
                    alive = c.execute("SELECT 1 FROM dms_docs WHERE doc_id = ? AND deleted_at IS NULL", (prior.get("doc_id"),)).fetchone()
                    if alive:
                        results.append({"key": d["key"], "ok": True, "already": True, **prior})
                        continue
                try:
                    res = file_one(c, uid, scope, actor, sid, d, defaults, state, rows)
                except (h.ApiError, PF.PaperError, SC.ScanError) as exc:
                    results.append({"key": d["key"], "ok": False, "error": getattr(exc, "message", None) or str(exc)})
                    continue
                except Exception as exc:  # a page file that cannot be merged, a full disk ...
                    h.log(f"[scan] filing {sid}/{d['key']} failed: {exc}")
                    results.append({"key": d["key"], "ok": False, "error": "This document could not be built. Try again; if it keeps failing, re-add its pages."})
                    continue
                state["filed"][sig] = res
                with h.Tx() as tx:
                    save_state(tx, sid, state)
                results.append({"key": d["key"], "ok": True, **res})
            with h.Tx() as tx:
                save_state(tx, sid, state)
            all_filed = all(sig_of(d["pages"]) in state["filed"] for d in layout["docs"])
            closed = False
            if all_filed:
                with h.Tx() as tx:
                    tx.execute("DELETE FROM dms_scan_pages WHERE session_id = ?", (sid,))
                    tx.execute("DELETE FROM dms_scan_sessions WHERE id = ?", (sid,))
                SC.discard_files(sid)
                closed = True
        finally:
            with _BUSY_LOCK:
                _BUSY.discard(sid)
        ok_n = sum(1 for x in results if x["ok"])
        return jsonify({"ok": all(x["ok"] for x in results), "filed": ok_n, "failed": len(results) - ok_n, "results": results, "closed": closed,
                        "remaining": sum(1 for d in layout["docs"] if sig_of(d["pages"]) not in state["filed"])})
