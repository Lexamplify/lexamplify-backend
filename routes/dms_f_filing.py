"""Auto-filing: documents that belong to no case yet get a proposed case, with reasons, and a one-click queue."""
import contextlib
import json
import time

from flask import jsonify, request

from utils import dms_files as F
from utils import dms_index as I
from utils import dms_match as M

RECENT_AUTO_SECONDS = 24 * 3600


def _body():
    b = request.get_json(force=True, silent=True)
    return b if isinstance(b, dict) else {}


def prefs_auto(c, uid):
    r = c.execute("SELECT auto_file FROM dms_file_prefs WHERE user_id = ?", (int(uid),)).fetchone()
    return True if r is None else bool(r["auto_file"])


def summary(h, c, uid):
    base = ("FROM dms_filing f JOIN case_vault cv ON cv.id = f.doc_id JOIN dms_docs d ON d.doc_id = f.doc_id "
            "WHERE f.owner_id = :uid AND d.deleted_at IS NULL AND d.is_current = 1 AND ")
    a = {"uid": int(uid)}
    pend = c.execute(f"SELECT f.top_score AS s, f.candidates AS c {base} f.state = 'pending' AND {M.UNFILED}", a).fetchall()
    confident = 0
    for r in pend:
        if M.decide(F.loads(r["c"], []))[1]:
            confident += 1
    nomatch = c.execute(f"SELECT COUNT(*) {base} f.state = 'nomatch' AND {M.UNFILED}", a).fetchone()[0]
    auto = c.execute(f"SELECT COUNT(*) {base} f.state = 'filed' AND f.via = 'auto' AND cv.case_id = f.filed_ref AND f.decided_at >= date('now','-7 day')", a).fetchone()[0]
    reading = c.execute("SELECT COUNT(*) FROM dms_docs d JOIN case_vault cv ON cv.id = d.doc_id "
                        f"WHERE cv.user_id = :uid AND {M.UNFILED} AND d.deleted_at IS NULL AND d.is_current = 1 AND d.status IN ('queued','processing')", a).fetchone()[0]
    return {"pending": len(pend), "confident": confident, "nomatch": nomatch, "auto_recent": auto, "reading": reading, "auto_file": prefs_auto(c, uid)}


def file_doc_core(h, c, uid, doc_id, case_ref, via, score=None):
    """Put one document (all its versions) on a case. Own transaction, explicit connection - safe from a request or the worker thread."""
    r = c.execute(f"SELECT {I._LIST_COLS} FROM dms_docs d JOIN case_vault cv ON cv.id = d.doc_id WHERE d.doc_id = ?", (doc_id,)).fetchone()
    if not r or r["deleted_at"]:
        raise h.ApiError("Document not found.", 404)
    if r["cv_user_id"] is None or int(r["cv_user_id"]) != int(uid):
        raise h.ApiError("Only the person who owns a document can file it on a case.", 403)
    ok, why = F.can_use_case(c, uid, case_ref, writing=True)
    if not ok:
        raise h.ApiError(why, 409 if "archived" in why else 404)
    prev = r["cv_case_id"] or "General"
    title = h.title_of(r)
    if c.in_transaction:
        c.commit()
    c.execute("BEGIN IMMEDIATE")
    try:
        c.execute("UPDATE case_vault SET case_id = ? WHERE id IN (SELECT doc_id FROM dms_docs WHERE group_id = ?)", (case_ref, r["group_id"]))
        meta = F.loads(r["meta"], {})
        meta["suggested_matter"] = None
        c.execute("UPDATE dms_docs SET meta = ?, updated_at = ? WHERE doc_id = ?", (json.dumps(meta, default=str), F.now_iso(), doc_id))
        h.prov(c, "filed-to-case", doc_id, title, uid, r["cv_user_id"], {"from": prev, "to": case_ref, "via": via, "score": score})
        c.execute(
            "INSERT INTO dms_filing (doc_id, owner_id, state, top_ref, top_score, candidates, evaluated_at, decided_by, decided_at, filed_ref, prev_ref, via) "
            "VALUES (?,?,'filed',?,?,?,?,?,?,?,?,?) ON CONFLICT(doc_id) DO UPDATE SET state = 'filed', decided_by = excluded.decided_by, "
            "decided_at = excluded.decided_at, filed_ref = excluded.filed_ref, prev_ref = excluded.prev_ref, via = excluded.via",
            (doc_id, uid, case_ref, score, "[]", F.now_iso(), uid, F.now_iso(), case_ref, prev, via))
        I.refresh_meta_fts(c, doc_id)
        c.commit()
    except Exception:
        c.rollback()
        raise
    h.tell_practice(case_ref, doc_id, title, uid, "filed")
    return {"doc_id": doc_id, "case_ref": case_ref, "label": F.case_label(c, case_ref)}


def undo_core(h, c, uid, doc_id):
    f = c.execute("SELECT * FROM dms_filing WHERE doc_id = ? AND owner_id = ?", (doc_id, int(uid))).fetchone()
    if not f or f["state"] != "filed":
        raise h.ApiError("This document was not filed from the queue.", 409)
    r = c.execute(f"SELECT {I._LIST_COLS} FROM dms_docs d JOIN case_vault cv ON cv.id = d.doc_id WHERE d.doc_id = ?", (doc_id,)).fetchone()
    if not r:
        raise h.ApiError("Document not found.", 404)
    if (r["cv_case_id"] or "") != f["filed_ref"]:
        raise h.ApiError("The document has been moved since, so it was left where it is.", 409)
    if c.in_transaction:
        c.commit()
    c.execute("BEGIN IMMEDIATE")
    try:
        back = f["prev_ref"] or "General"
        c.execute("UPDATE case_vault SET case_id = ? WHERE id IN (SELECT doc_id FROM dms_docs WHERE group_id = ?)", (back, r["group_id"]))
        h.prov(c, "filing-undone", doc_id, h.title_of(r), uid, r["cv_user_id"], {"from": f["filed_ref"], "to": back})
        c.execute("UPDATE dms_filing SET state = 'dismissed', sig = NULL, filed_ref = NULL, decided_at = ?, decided_by = ? WHERE doc_id = ?",
                  (F.now_iso(), uid, doc_id))
        I.refresh_meta_fts(c, doc_id)
        c.commit()
    except Exception:
        c.rollback()
        raise


def mount(bp, h, api):
    def _label_candidates(c, cands):
        out = []
        for x in cands:
            out.append({"ref": x["ref"], "score": x["score"], "reasons": x.get("reasons") or [], "label": x.get("label"), "case_no": x.get("case_no"),
                        "court": x.get("court"), "client": x.get("client"), "kind": x.get("kind")})
        return out

    def _recent(c, doc_id):
        r = c.execute("SELECT created_at FROM dms_docs WHERE doc_id = ?", (doc_id,)).fetchone()
        if not r or not r["created_at"]:
            return False
        try:
            import calendar
            return time.time() - calendar.timegm(time.strptime(r["created_at"][:19], "%Y-%m-%d %H:%M:%S")) < RECENT_AUTO_SECONDS
        except ValueError:
            return False

    def sweep_auto(c, uid, confident_ids):
        """New uploads that match with certainty are filed straight away (and can be undone). Older ones wait for a click."""
        if not confident_ids or not prefs_auto(c, uid):
            return 0
        n = 0
        for did in confident_ids:
            if not _recent(c, did):
                continue
            f = c.execute("SELECT state, top_ref, top_score FROM dms_filing WHERE doc_id = ?", (did,)).fetchone()
            if not f or f["state"] != "pending" or not f["top_ref"]:
                continue
            with contextlib.suppress(h.ApiError):
                file_doc_core(h, c, uid, did, f["top_ref"], "auto", f["top_score"])
                n += 1
        return n

    def on_processed(wconn, doc_id):
        """Called by the Document Hub worker right after a document has been read."""
        d = wconn.execute("SELECT cv.user_id AS owner, cv.case_id AS cid FROM dms_docs d JOIN case_vault cv ON cv.id = d.doc_id WHERE d.doc_id = ?", (doc_id,)).fetchone()
        if not d or d["owner"] is None or (d["cid"] or "General") != "General":
            return
        res = M.refresh(wconn, d["owner"], only_ids=[doc_id], limit=5)
        if res["confident"] and prefs_auto(wconn, d["owner"]):
            f = wconn.execute("SELECT top_ref, top_score FROM dms_filing WHERE doc_id = ? AND state = 'pending'", (doc_id,)).fetchone()
            if f and f["top_ref"]:
                with contextlib.suppress(h.ApiError):
                    file_doc_core(h, wconn, d["owner"], doc_id, f["top_ref"], "auto", f["top_score"])

    h.hooks["processed"] = on_processed

    @api("/files/filing", ["GET"])
    def filing_list():
        c = h.conn()
        uid = h.uid_now()
        state = request.args.get("state", "pending")
        if state not in ("pending", "nomatch", "filed", "dismissed"):
            raise h.ApiError("Unknown list.", 400)
        res = M.refresh(c, uid, limit=100)
        if res["confident"]:
            sweep_auto(c, uid, res["confident"])
        page = max(1, h.int_(request.args.get("page"), 1) or 1)
        per = max(1, min(h.int_(request.args.get("per_page"), 40) or 40, 100))
        a = {"uid": int(uid)}
        if state == "filed":
            where = "f.state = 'filed' AND cv.case_id = f.filed_ref AND f.decided_at >= date('now','-14 day')"
            order = "f.decided_at DESC, f.doc_id DESC"
        elif state == "pending":
            where = f"f.state = 'pending' AND {M.UNFILED}"
            order = "f.top_score DESC, f.doc_id DESC"
        else:
            where = f"f.state = '{state}' AND {M.UNFILED}"
            order = "f.doc_id DESC"
        frm = ("FROM dms_filing f JOIN dms_docs d ON d.doc_id = f.doc_id JOIN case_vault cv ON cv.id = f.doc_id "
               f"WHERE f.owner_id = :uid AND d.deleted_at IS NULL AND d.is_current = 1 AND {where}")
        total = c.execute(f"SELECT COUNT(*) {frm}", a).fetchone()[0]
        rows = c.execute(
            "SELECT d.*, cv.title AS cv_title, cv.smart_title AS cv_smart_title, cv.case_id AS cv_case_id, cv.folder_id AS cv_folder_id, cv.user_id AS cv_user_id, "
            "f.candidates AS f_cands, f.note AS f_note, f.top_score AS f_score, f.filed_ref AS f_filed, f.via AS f_via, f.decided_at AS f_at "
            f"{frm} ORDER BY {order} LIMIT :lim OFFSET :off", {**a, "lim": per, "off": (page - 1) * per}).fetchall()
        ctx = h.ctx_now()
        docs = h.docs_payload(c, ctx, rows)
        items = []
        for r, d in zip(rows, docs):
            cands = F.loads(r["f_cands"], [])
            _s, conf = M.decide(cands)
            it = {"doc": d, "candidates": _label_candidates(c, cands), "confident": bool(conf and state == "pending"), "note": r["f_note"]}
            if state == "filed":
                it["filed"] = {"ref": r["f_filed"], "label": F.case_label(c, r["f_filed"]), "via": r["f_via"], "at": r["f_at"]}
            items.append(it)
        return jsonify({"items": items, "total": total, "page": page, "per_page": per, "state": state, "summary": summary(h, c, uid),
                        "unevaluated": res["remaining"]})

    @api("/files/filing/<int:doc_id>/confirm", ["POST"])
    def filing_confirm(doc_id):
        c = h.conn()
        uid = h.uid_now()
        b = _body()
        f = c.execute("SELECT top_ref, top_score, state FROM dms_filing WHERE doc_id = ? AND owner_id = ?", (doc_id, uid)).fetchone()
        ref = (b.get("case_ref") or (f["top_ref"] if f else None) or "").strip()
        if not ref:
            raise h.ApiError("Choose a case.", 400)
        score = f["top_score"] if f and ref == f["top_ref"] else None
        via = "confirm" if (f and ref == f["top_ref"]) else "manual"
        r = file_doc_core(h, c, uid, doc_id, ref, via, score)
        return jsonify({"ok": True, **r, "summary": summary(h, c, uid)})

    @api("/files/filing/<int:doc_id>/dismiss", ["POST"])
    def filing_dismiss(doc_id):
        c = h.conn()
        uid = h.uid_now()
        r = c.execute("SELECT cv.user_id AS owner FROM dms_docs d JOIN case_vault cv ON cv.id = d.doc_id WHERE d.doc_id = ?", (doc_id,)).fetchone()
        if not r or r["owner"] != uid:
            raise h.ApiError("Document not found.", 404)
        with h.Tx() as tx:
            tx.execute("INSERT INTO dms_filing (doc_id, owner_id, state, decided_by, decided_at) VALUES (?,?,'dismissed',?,?) "
                       "ON CONFLICT(doc_id) DO UPDATE SET state = 'dismissed', decided_by = excluded.decided_by, decided_at = excluded.decided_at",
                       (doc_id, uid, uid, F.now_iso()))
        return jsonify({"ok": True, "summary": summary(h, c, uid)})

    @api("/files/filing/<int:doc_id>/reopen", ["POST"])
    def filing_reopen(doc_id):
        c = h.conn()
        uid = h.uid_now()
        with h.Tx() as tx:
            n = tx.execute("UPDATE dms_filing SET state = 'pending', sig = NULL WHERE doc_id = ? AND owner_id = ? AND state = 'dismissed'", (doc_id, uid)).rowcount
        if not n:
            raise h.ApiError("Nothing to bring back.", 404)
        M.refresh(c, uid, only_ids=[doc_id], force=True)
        return jsonify({"ok": True, "summary": summary(h, c, uid)})

    @api("/files/filing/<int:doc_id>/undo", ["POST"])
    def filing_undo(doc_id):
        c = h.conn()
        uid = h.uid_now()
        undo_core(h, c, uid, doc_id)
        return jsonify({"ok": True, "summary": summary(h, c, uid)})

    @api("/files/filing/confirm-all", ["POST"])
    def filing_confirm_all():
        c = h.conn()
        uid = h.uid_now()
        b = _body()
        ids = [i for i in (h.int_(x) for x in (b.get("doc_ids") or [])) if i]
        rows = c.execute(
            f"SELECT f.doc_id, f.top_ref, f.top_score, f.candidates FROM dms_filing f JOIN case_vault cv ON cv.id = f.doc_id JOIN dms_docs d ON d.doc_id = f.doc_id "
            f"WHERE f.owner_id = ? AND f.state = 'pending' AND f.top_ref IS NOT NULL AND {M.UNFILED} AND d.deleted_at IS NULL AND d.is_current = 1 "
            "ORDER BY f.top_score DESC LIMIT 500", (uid,)).fetchall()
        if ids:
            rows = [r for r in rows if r["doc_id"] in set(ids)]
        elif b.get("mode") == "confident":
            rows = [r for r in rows if M.decide(F.loads(r["candidates"], []))[1]]
        else:
            raise h.ApiError("Say which documents to file.", 400)
        done, skipped = 0, []
        for r in rows:
            try:
                file_doc_core(h, c, uid, r["doc_id"], r["top_ref"], "bulk", r["top_score"])
                done += 1
            except h.ApiError as exc:
                skipped.append({"id": r["doc_id"], "reason": exc.message})
        return jsonify({"ok": True, "filed": done, "skipped": skipped, "summary": summary(h, c, uid)})

    @api("/files/filing/settings", ["GET", "PUT"])
    def filing_settings():
        c = h.conn()
        uid = h.uid_now()
        if request.method == "PUT":
            auto = 1 if _body().get("auto_file") else 0
            with h.Tx() as tx:
                tx.execute("INSERT INTO dms_file_prefs (user_id, auto_file) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET auto_file = excluded.auto_file", (uid, auto))
        return jsonify({"auto_file": prefs_auto(c, uid), "thresholds": {"suggest": M.SUGGEST_AT, "auto": M.AUTO_AT}})

    @api("/files/filing/rescan", ["POST"])
    def filing_rescan():
        c = h.conn()
        uid = h.uid_now()
        res = M.refresh(c, uid, limit=300, force=True)
        return jsonify({"ok": True, "evaluated": res["evaluated"], "remaining": res["remaining"], "summary": summary(h, c, uid)})
