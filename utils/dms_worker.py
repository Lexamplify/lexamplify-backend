"""
utils/dms_worker.py - the background side of the Document Hub.

An upload only stores the bytes and returns; reading the file (text extraction, OCR, classification,
indexing) happens here, so a lawyer can drop 500 files in and keep working while they are processed.

  * The queue is the dms_jobs table, so it survives restarts and deploys.
  * A job is claimed with BEGIN IMMEDIATE, so several threads - or several gunicorn workers - can
    run side by side and never take the same file.
  * A job that was running when the server died is put back in the queue by recover_stale().
  * A file that cannot be read is marked failed / needs_ocr with a plain-language reason. It never
    disappears and never blocks the queue behind it.
  * Extraction runs with no database transaction open, and the result is written in one short
    transaction.
"""
import contextlib
import json
import os
import re
import threading
import time
import traceback

try:
    from utils import dms_classify as C, dms_extract as X, dms_index as I, dms_store as S
except ImportError:  # pragma: no cover
    import dms_classify as C, dms_extract as X, dms_index as I, dms_store as S

MAX_ATTEMPTS = 3
STALE_SECONDS = int(os.getenv("DMS_STALE_JOB_SECONDS", "1200"))
TRASH_DAYS = int(os.getenv("DMS_TRASH_DAYS", "30"))
PROBLEM_STATUSES = ("failed", "needs_ocr", "ready_partial", "empty", "unsupported")


def _now():
    return time.time()


def _iso():
    return time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())


# ── queue ────────────────────────────────────────────────────────────────────────────
def enqueue(conn, doc_id, kind="extract", commit=True):
    already = conn.execute("SELECT 1 FROM dms_jobs WHERE doc_id = ? AND status IN ('queued','running')", (doc_id,)).fetchone()
    if not already:
        conn.execute("INSERT INTO dms_jobs(doc_id, kind, status, run_after, created_at) VALUES (?, ?, 'queued', 0, ?)",
                     (doc_id, kind, _now()))
    conn.execute("UPDATE dms_docs SET status = 'queued', status_note = NULL WHERE doc_id = ? AND status != 'processing'", (doc_id,))
    if commit:
        conn.commit()


def claim_job(conn, worker_id):
    conn.execute("BEGIN IMMEDIATE")
    try:
        row = conn.execute(
            "SELECT id, doc_id, kind, attempts FROM dms_jobs WHERE status = 'queued' AND run_after <= ? ORDER BY id LIMIT 1",
            (_now(),)).fetchone()
        if not row:
            conn.commit()
            return None
        conn.execute("UPDATE dms_jobs SET status = 'running', locked_by = ?, locked_at = ?, attempts = attempts + 1 WHERE id = ?",
                     (worker_id, _now(), row["id"]))
        conn.execute("UPDATE dms_docs SET status = 'processing' WHERE doc_id = ?", (row["doc_id"],))
        conn.commit()
        return dict(row, attempts=row["attempts"] + 1)
    except Exception:
        conn.rollback()
        raise


def finish_job(conn, job_id, error=None):
    conn.execute("UPDATE dms_jobs SET status = ?, error = ?, finished_at = ?, locked_by = NULL WHERE id = ?",
                 ("failed" if error else "done", (error or "")[:400] or None, _now(), job_id))
    conn.commit()


def recover_stale(conn):
    """Jobs whose worker vanished (deploy, crash, OOM kill) go back in the queue, or fail after 3 tries."""
    cutoff = _now() - STALE_SECONDS
    stale = conn.execute("SELECT id, doc_id, attempts FROM dms_jobs WHERE status = 'running' AND locked_at < ?", (cutoff,)).fetchall()
    for j in stale:
        if j["attempts"] >= MAX_ATTEMPTS:
            conn.execute("UPDATE dms_jobs SET status = 'failed', error = 'Processing was interrupted repeatedly.' WHERE id = ?", (j["id"],))
            conn.execute("UPDATE dms_docs SET status = 'failed', status_note = ? WHERE doc_id = ?",
                         ("Processing was interrupted repeatedly (the file may be too heavy). Try Reprocess, or upload a smaller file.", j["doc_id"]))
        else:
            conn.execute("UPDATE dms_jobs SET status = 'queued', locked_by = NULL WHERE id = ?", (j["id"],))
            conn.execute("UPDATE dms_docs SET status = 'queued' WHERE doc_id = ?", (j["doc_id"],))
    conn.commit()
    return len(stale)


def queue_depth(conn, uid=None):
    """(waiting, running) for everyone, or only for documents the user uploaded."""
    if uid is None:
        r = conn.execute("SELECT SUM(status='queued'), SUM(status='running') FROM dms_jobs WHERE status IN ('queued','running')").fetchone()
    else:
        r = conn.execute(
            "SELECT SUM(j.status='queued'), SUM(j.status='running') FROM dms_jobs j JOIN dms_docs d ON d.doc_id = j.doc_id "
            "WHERE j.status IN ('queued','running') AND d.uploaded_by = ?", (uid,)).fetchone()
    return int(r[0] or 0), int(r[1] or 0)


# ── what the reader found -> database ───────────────────────────────────────────────
def _case_keys(shown_list):
    keys = []
    for shown in shown_list:
        m = C.CASE_RE.search(shown)
        if m:
            keys.append(C.case_key(m.group("type"), m.group("num"), m.group("year")))
        elif re.match(r"FIR \d+/\d{4}$", shown):
            keys.append(shown.upper())
    return list(dict.fromkeys(keys))


_PARTY_STOP = {"state", "union", "india", "limited", "company", "pvt", "ltd", "bank", "others", "another", "versus", "government",
               "department", "office", "officer", "commissioner", "authority", "board", "corporation", "through", "represented",
               "secretary", "ministry", "district", "court", "smt", "shri", "mrs", "mister"}


def _party_tokens(parties):
    return {w for w in re.findall(r"[a-z]{4,}", (parties or "").lower()) if w not in _PARTY_STOP}


def suggest_matter(conn, owner_id, case_keys, parties, exclude_doc=None):
    """A SUGGESTION, never an automatic link. Strongest signal first: other documents that carry the
    same case number and already sit in a matter this person can work in."""
    matters = {m["id"]: m for m in I.matter_ids_for(conn, owner_id)}
    if not matters:
        return None
    if case_keys:
        counts = {}
        for k in case_keys[:3]:
            for r in conn.execute(
                    "SELECT cv.case_id AS cid FROM dms_docs d JOIN case_vault cv ON cv.id = d.doc_id "
                    "WHERE d.case_keys LIKE ? AND cv.case_id LIKE 'matter:%' AND d.deleted_at IS NULL AND d.doc_id != ? LIMIT 50",
                    (f"%|{k}|%", exclude_doc or -1)):
                try:
                    mid = int(r["cid"].split(":", 1)[1])
                except (ValueError, IndexError):
                    continue
                if mid in matters:
                    counts[mid] = counts.get(mid, 0) + 1
        if counts:
            mid = max(counts, key=counts.get)
            return {"id": mid, "title": matters[mid]["title"], "reason": f"{counts[mid]} other document(s) with the same case number are in this matter"}
        toks = [C.case_token(k) for k in case_keys]
        for mid, m in matters.items():
            flat = re.sub(r"[^a-z0-9ऀ-෿]", "", (m["title"] or "").lower())
            if any(t and t in flat for t in toks):
                return {"id": mid, "title": m["title"], "reason": "The matter title contains this case number"}
    ptoks = _party_tokens(parties)
    if len(ptoks) >= 2:
        best, best_n = None, 0
        for mid, m in matters.items():
            words = set(re.findall(r"[a-z]{4,}", (m["title"] or "").lower()))
            n = len(ptoks & words)
            if n > best_n:
                best, best_n = mid, n
        if best is not None and best_n >= 2:
            return {"id": best, "title": matters[best]["title"], "reason": "The matter title matches the party names"}
    return None


def _blueprint_folder(conn, owner_id, name):
    r = conn.execute("SELECT id FROM vault_folders WHERE name = ? AND parent_id IS NULL AND user_id = ? LIMIT 1", (name, owner_id)).fetchone()
    return r["id"] if r else None


def process_document(conn, doc_id, use_ocr=None):
    """Read one stored file, classify it and write the result. Returns a short dict for logs/tests."""
    if use_ocr is None:
        use_ocr = os.getenv("DMS_OCR_ENABLED", "1") != "0"
    d = conn.execute(
        "SELECT d.*, cv.title AS cv_title, cv.smart_title AS cv_smart, cv.case_id AS cv_case, cv.folder_id AS cv_folder, cv.user_id AS cv_owner "
        "FROM dms_docs d JOIN case_vault cv ON cv.id = d.doc_id WHERE d.doc_id = ?", (doc_id,)).fetchone()
    if not d:
        return {"doc_id": doc_id, "result": "gone"}
    old_meta = I._loads(d["meta"], {})
    # notes recorded when the file arrived (e.g. "named .docx but really a PDF") survive re-reading
    upload_warnings = [w for w in I._loads(d["warnings"], []) if w.startswith("The file is named")]
    started = time.time()

    # ---- read the file (no DB transaction open while this runs) ----
    try:
        with S.open_plain(d["store_key"], bool(d["enc"])) as path:
            sn = X.sniff(path, d["original_name"] or "")
            res = X.extract(path, sn, use_ocr=use_ocr)
    except S.StoreError as exc:
        conn.execute("UPDATE dms_docs SET status = 'failed', status_note = ?, processed_at = ?, updated_at = ? WHERE doc_id = ?",
                     (str(exc)[:300], _iso(), _iso(), doc_id))
        conn.commit()
        return {"doc_id": doc_id, "result": "failed", "error": str(exc)}

    text = res.text
    sample = text if len(text) <= 64000 else text[:60000] + "\n" + text[-4000:]
    an = C.analyse(sample, d["original_name"] or "", sn.kind)
    cls, meta = an["class"], an["meta"]
    keys = _case_keys(meta.get("case_numbers", []))
    fir_keys = _case_keys(meta.get("fir_numbers", []))

    user_fields = set(old_meta.get("user_fields") or [])
    class_user = d["class_src"] == "user"
    doc_class = d["doc_class"] if class_user else cls["doc_class"]
    class_conf = d["class_conf"] if class_user else cls["confidence"]
    needs_review = (not class_user) and (cls["doc_class"] == "Unclassified" or cls["confidence"] < C.AUTO_CONFIDENCE)
    if class_user:
        review = "reviewed"                                   # a person chose the class: nothing left to review
    elif needs_review:
        # a person already accepted this exact label once -> do not nag again after a re-read
        review = "reviewed" if (d["review"] == "reviewed" and d["doc_class"] == doc_class) else "needs_review"
    else:
        review = None

    out_meta = {k: v for k, v in meta.items() if k not in ("scripts",)}
    out_meta["scripts"] = meta.get("scripts") or []
    out_meta["alternatives"] = cls.get("alternatives") or []
    out_meta["user_fields"] = sorted(user_fields)
    for f in user_fields:                           # corrections a person made survive a re-read
        if f in old_meta:
            out_meta[f] = old_meta[f]
    doc_date = old_meta.get("doc_date") if "doc_date" in user_fields else meta.get("doc_date")
    next_hearing = old_meta.get("next_hearing") if "next_hearing" in user_fields else meta.get("next_hearing")
    parties = old_meta.get("parties") if "parties" in user_fields else meta.get("parties")
    court = old_meta.get("court") if "court" in user_fields else meta.get("court")
    if "case_numbers" in user_fields:
        out_meta["case_numbers"] = old_meta.get("case_numbers") or []
        keys = _case_keys(out_meta["case_numbers"])
    case_keys = "|" + "|".join(keys + fir_keys) + "|" if (keys or fir_keys) else None
    out_meta["doc_date"], out_meta["next_hearing"], out_meta["parties"], out_meta["court"] = doc_date, next_hearing, parties, court

    # ---- suggestions (never applied silently, except the reversible filing) ----
    owner = d["cv_owner"]
    matter_hint = None
    if owner is not None and not (d["cv_case"] or "").startswith("matter:"):
        with contextlib.suppress(Exception):
            matter_hint = suggest_matter(conn, owner, keys + fir_keys, parties, exclude_doc=doc_id)
    out_meta["suggested_matter"] = matter_hint

    new_folder = d["cv_folder"]
    if (new_folder is None and owner is not None and not class_user and an["suggested_folder"] and not old_meta.get("adopted")
            and cls["confidence"] >= C.AUTO_CONFIDENCE and doc_class != "Unclassified"):
        fid = _blueprint_folder(conn, owner, an["suggested_folder"])
        if fid:
            new_folder = fid
            out_meta["auto_filed"] = {"folder_id": fid, "folder": an["suggested_folder"]}
    elif old_meta.get("auto_filed") and d["cv_folder"] == (old_meta["auto_filed"] or {}).get("folder_id"):
        out_meta["auto_filed"] = old_meta["auto_filed"]

    smart = d["cv_smart"]
    title_auto = bool(old_meta.get("title_auto"))
    cv_title = d["cv_title"] or ""
    stem = cv_title.rsplit(".", 1)[0] if "." in cv_title else cv_title
    if an["suggested_title"] and (not smart or smart in (cv_title, stem) or title_auto):
        smart, title_auto = an["suggested_title"], True
    out_meta["title_auto"] = title_auto

    status = res.status
    note = res.error
    if not note and res.warnings:
        note = res.warnings[0]
    tags_keep = d["tags"]

    # ---- write everything in one short transaction ----
    try:
        conn.execute("BEGIN IMMEDIATE")
        I.set_doc_pages(conn, doc_id, res.pages)
        conn.execute(
            "UPDATE dms_docs SET status=?, status_note=?, warnings=?, page_count=?, page_kind=?, method=?, ocr_pages=?, ocr_conf=?, "
            "doc_class=?, class_conf=?, class_evidence=?, review=?, meta=?, doc_date=?, next_hearing=?, parties=?, court=?, case_keys=?, "
            "text_hash=?, kind=?, ext=?, mime=?, processed_at=?, updated_at=?, tags=? WHERE doc_id=?",
            (status, (note or None), json.dumps(upload_warnings + res.warnings), res.page_count or len(res.pages), res.page_kind, res.method, res.ocr_pages,
             res.ocr_confidence, doc_class, class_conf, json.dumps(cls.get("evidence") or []), review, json.dumps(out_meta, default=str),
             doc_date, next_hearing, parties, court, case_keys, X.text_hash(text), sn.kind, sn.ext, sn.mime, _iso(), _iso(), tags_keep, doc_id))
        conn.execute("UPDATE case_vault SET doc_type = ?, folder_id = ?, smart_title = ?, file_format = ? WHERE id = ?",
                     (doc_class if doc_class != "Unclassified" else (d["ext"] or "file"), new_folder, smart, sn.ext, doc_id))
        I.refresh_meta_fts(conn, doc_id)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return {"doc_id": doc_id, "result": status, "class": doc_class, "conf": class_conf, "pages": len(res.pages),
            "seconds": round(time.time() - started, 2)}


# ── permanent removal ───────────────────────────────────────────────────────────────
def blob_referenced(conn, sha, enc, except_doc=None):
    return conn.execute("SELECT 1 FROM dms_docs WHERE sha256 = ? AND enc = ? AND doc_id != ? LIMIT 1",
                        (sha, int(bool(enc)), except_doc or -1)).fetchone() is not None


def purge_document(conn, doc_id):
    """Irreversible. Removes the vault row, its text and index entries, its shares, and the stored
    file itself when no other document points at the same bytes. Legal hold is enforced by callers."""
    d = conn.execute("SELECT sha256, store_key, enc FROM dms_docs WHERE doc_id = ?", (doc_id,)).fetchone()
    if I._table_exists(conn, "document_vault_shares"):
        conn.execute("DELETE FROM document_vault_shares WHERE node_type = 'document' AND node_id = ?", (doc_id,))
    conn.execute("DELETE FROM case_vault WHERE id = ?", (doc_id,))            # trigger clears dms_* rows
    conn.execute("DELETE FROM dms_pages WHERE doc_id = ?", (doc_id,))
    conn.execute("DELETE FROM dms_meta_fts WHERE rowid = ?", (doc_id,))
    conn.execute("DELETE FROM dms_jobs WHERE doc_id = ?", (doc_id,))
    conn.execute("DELETE FROM dms_docs WHERE doc_id = ?", (doc_id,))
    conn.commit()
    if d and not blob_referenced(conn, d["sha256"], d["enc"]):
        S.remove(d["store_key"], bool(d["enc"]))
    return True


def purge_expired_trash(conn, days=None, on_purge=None):
    days = TRASH_DAYS if days is None else days
    cutoff = time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(_now() - days * 86400))
    rows = conn.execute(
        "SELECT d.doc_id, cv.smart_title, cv.title, cv.user_id FROM dms_docs d JOIN case_vault cv ON cv.id = d.doc_id "
        "WHERE d.deleted_at IS NOT NULL AND d.deleted_at < ? AND d.legal_hold = 0 LIMIT 500", (cutoff,)).fetchall()
    n = 0
    for r in rows:
        name = r["smart_title"] or r["title"] or f"Document {r['doc_id']}"
        purge_document(conn, r["doc_id"])
        if on_purge:
            with contextlib.suppress(Exception):
                on_purge(r["doc_id"], name, r["user_id"])
        n += 1
    return n


def gc_blobs(conn, min_age_seconds=86400):
    """Delete stored files that no document references any more (e.g. after the old vault route
    hard-deleted a row). Files younger than a day are never touched: an upload may be mid-flight."""
    referenced = {(r[0], r[1]) for r in conn.execute("SELECT sha256, enc FROM dms_docs")}
    if I._table_exists(conn, "dms_bundles"):                      # court bundles built but not (yet) saved to the library
        referenced |= {(r[0], r[1]) for r in conn.execute("SELECT built_sha, COALESCE(built_enc, 0) FROM dms_bundles WHERE built_sha IS NOT NULL")}
    root, removed, now = S.storage_root(), 0, _now()
    for base, dirs, files in os.walk(root):
        if os.path.basename(base) == "_incoming":
            dirs[:] = []
            continue
        for name in files:
            if ".part" in name:
                continue
            enc = name.endswith(".enc")
            sha = name[:-4] if enc else name
            if len(sha) != 64:
                continue
            p = os.path.join(base, name)
            with contextlib.suppress(OSError):
                if (sha, int(enc)) not in referenced and now - os.path.getmtime(p) > min_age_seconds:
                    os.remove(p)
                    removed += 1
    return removed


# ── the threads ─────────────────────────────────────────────────────────────────────
class Worker:
    def __init__(self, db_path, threads=None, on_purge=None, log=None, hooks=None):
        self.db_path = db_path
        self.n = int(threads if threads is not None else os.getenv("DMS_WORKERS", "2"))
        self.on_purge = on_purge
        self.hooks = hooks if hooks is not None else {}         # e.g. hooks["processed"](conn, doc_id) - set by the hub's extensions
        self.log = log or (lambda msg: None)
        self._threads = []
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._lock = threading.Lock()

    def start(self):
        with self._lock:
            if self._threads or self.n <= 0:
                return
            for i in range(self.n):
                t = threading.Thread(target=self._loop, args=(i,), name=f"dms-worker-{i}", daemon=True)
                t.start()
                self._threads.append(t)

    def stop(self, timeout=5):
        self._stop.set()
        self._wake.set()
        for t in self._threads:
            t.join(timeout)
        self._threads = []

    def kick(self):
        self._wake.set()
        if not self._threads and self.n > 0:
            self.start()

    def _maintenance(self, conn, state):
        now = _now()
        if now - state.get("stale", 0) > 60:
            state["stale"] = now
            with contextlib.suppress(Exception):
                recover_stale(conn)
        if now - state.get("hour", 0) > 3600:
            state["hour"] = now
            with contextlib.suppress(Exception):
                S.sweep_incoming()
                purge_expired_trash(conn, on_purge=self.on_purge)
        if now - state.get("day", 0) > 6 * 3600:
            state["day"] = now
            with contextlib.suppress(Exception):
                gc_blobs(conn)
                I.optimize(conn)

    def _loop(self, idx):
        wid = f"{os.getpid()}-{idx}"
        with contextlib.suppress(Exception):
            os.nice(8)                     # OCR must not starve the web requests sharing this machine
        conn = I.connect(self.db_path)
        state = {}
        while not self._stop.is_set():
            job = None
            try:
                if idx == 0:
                    self._maintenance(conn, state)
                job = claim_job(conn, wid)
            except Exception as exc:
                self.log(f"[dms] claim failed: {exc}")
                self._stop.wait(2)
                continue
            if not job:
                self._wake.wait(timeout=4)
                self._wake.clear()
                continue
            try:
                process_document(conn, job["doc_id"])
                finish_job(conn, job["id"])
                after = self.hooks.get("processed")
                if after:
                    try:
                        after(conn, job["doc_id"])
                    except Exception as exc:                      # an extension must never fail the document it follows
                        self.log(f"[dms] after-process hook failed for {job['doc_id']}: {exc}")
                        with contextlib.suppress(Exception):
                            conn.rollback()
            except Exception as exc:
                self.log(f"[dms] job {job['id']} failed: {exc}\n{traceback.format_exc()}")
                with contextlib.suppress(Exception):
                    conn.rollback()
                    if job["attempts"] < MAX_ATTEMPTS:
                        conn.execute("UPDATE dms_jobs SET status='queued', locked_by=NULL, run_after=?, error=? WHERE id=?",
                                     (_now() + 20 * job["attempts"], str(exc)[:300], job["id"]))
                        conn.execute("UPDATE dms_docs SET status='queued' WHERE doc_id=?", (job["doc_id"],))
                    else:
                        conn.execute("UPDATE dms_jobs SET status='failed', error=?, finished_at=? WHERE id=?",
                                     (str(exc)[:300], _now(), job["id"]))
                        conn.execute("UPDATE dms_docs SET status='failed', status_note=? WHERE doc_id=?",
                                     ("Could not be processed after several tries. Use Reprocess to try again.", job["doc_id"]))
                    conn.commit()
        conn.close()
