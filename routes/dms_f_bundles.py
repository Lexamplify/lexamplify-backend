"""Court-ready bundles: choose documents, order them, label annexures, and build one paginated PDF with cover, index and bookmarks."""
import contextlib
import hashlib
import json
import math
import os
import tempfile
import threading
import time

from flask import jsonify, request, send_file

from utils import dms_bundle as B
from utils import dms_classify as C
from utils import dms_files as F
from utils import dms_index as I
from utils import dms_store as S

MAX_ITEMS = 500
STALE_BUILD_SECONDS = 20 * 60


def _body():
    b = request.get_json(force=True, silent=True)
    return b if isinstance(b, dict) else {}


def mount(bp, h, api):
    boot = I.connect(h.db_path)
    try:
        boot.execute("UPDATE dms_bundles SET build_state = 'error', build_note = 'The build was interrupted by a restart of the server. Build it again.' "
                     "WHERE build_state = 'building'")
        boot.commit()
    finally:
        boot.close()

    def me(c):
        uid = h.uid_now()
        return uid, F.scope_of(c, uid)

    def get_bundle(c, uid, scope, bid):
        r = c.execute("SELECT * FROM dms_bundles WHERE id = ? AND scope = ?", (bid, scope)).fetchone()
        if not r:
            raise h.ApiError("Bundle not found.", 404)
        if r["case_ref"] and r["owner_id"] != uid:
            ok, _why = F.can_use_case(c, uid, r["case_ref"], writing=False)
            if not ok:
                raise h.ApiError("Bundle not found.", 404)
        if r["build_state"] == "building":
            try:
                import calendar
                age = time.time() - calendar.timegm(time.strptime(r["updated_at"][:19], "%Y-%m-%d %H:%M:%S"))
            except ValueError:
                age = 0
            if age > STALE_BUILD_SECONDS:
                c.execute("UPDATE dms_bundles SET build_state = 'error', build_note = 'The build did not finish. Build it again.' WHERE id = ? AND build_state = 'building'", (bid,))
                c.commit()
                r = c.execute("SELECT * FROM dms_bundles WHERE id = ?", (bid,)).fetchone()
        return r

    def touch(c, bid):
        c.execute("UPDATE dms_bundles SET updated_at = ? WHERE id = ?", (F.now_iso(), bid))

    # ── describing a bundle ──────────────────────────────────────────────────────
    def doc_rows(c, ids):
        ids = list({i for i in ids if i})
        out = {}
        for k in range(0, len(ids), 400):
            chunk = ids[k:k + 400]
            for r in c.execute(f"SELECT {I._LIST_COLS} FROM dms_docs d JOIN case_vault cv ON cv.id = d.doc_id WHERE d.doc_id IN ({','.join('?' * len(chunk))})", chunk):
                out[r["doc_id"]] = r
        return out

    def fingerprint(opts, items, rows):
        """What a build is made of: options, the items in order with their settings, and the exact file of every document.
        A built bundle is 'out of date' when this no longer matches the one stored with it."""
        parts = [json.dumps(opts, sort_keys=True)]
        for it in items:
            r = rows.get(it["doc_id"]) if it["kind"] == "doc" else None
            parts.append(json.dumps([it["kind"], it["doc_id"], it["title"], it["label"], it["pages"], int(it["in_index"] or 0), r["sha256"] if r else None]))
        return hashlib.sha1("\n".join(parts).encode("utf-8")).hexdigest()

    def describe(c, uid, items, opts, rows=None):
        """Items for the screen, each with what it is, its labels and any reason it cannot be built."""
        ctx = h.ctx_now()
        if rows is None:
            rows = doc_rows(c, [it["doc_id"] for it in items if it["kind"] == "doc"])
        roles = I.matter_role_map(c, uid)
        labels = B.compute_labels([{"kind": it["kind"], "label": it["label"]} for it in items], opts)
        old_groups = sorted({r["group_id"] for r in rows.values() if not r["is_current"] and not r["deleted_at"]})
        newer = {}
        for k in range(0, len(old_groups), 400):
            chunk = old_groups[k:k + 400]
            for x in c.execute(f"SELECT group_id, doc_id, version FROM dms_docs WHERE group_id IN ({','.join('?' * len(chunk))}) AND is_current = 1 AND deleted_at IS NULL", chunk):
                newer[x["group_id"]] = {"doc_id": x["doc_id"], "version": x["version"]}
        out = []
        for it, auto_label in zip(items, labels):
            d = {"id": it["id"], "seq": it["seq"], "kind": it["kind"], "title": it["title"], "label": it["label"], "auto_label": auto_label if not it["label"] else None,
                 "pages": it["pages"], "in_index": bool(it["in_index"]), "note": it["note"], "doc": None, "problem": None, "page_count": None}
            if it["kind"] == "doc":
                r = rows.get(it["doc_id"])
                if not r:
                    d["problem"] = "This document was removed from the library."
                else:
                    level = I.access_level(c, ctx, {"id": r["doc_id"], "user_id": r["cv_user_id"], "case_id": r["cv_case_id"], "folder_id": r["cv_folder_id"]}, matter_roles=roles)
                    title = r["cv_smart_title"] or r["cv_title"] or r["original_name"] or f"Document {r['doc_id']}"
                    d["doc"] = {"id": r["doc_id"], "title": title, "ext": r["ext"], "kind": r["kind"], "size": r["size"], "status": r["status"], "doc_class": r["doc_class"] or "Unclassified",
                                "page_count": r["page_count"], "doc_date": r["doc_date"], "level": level}
                    if level is None:
                        d["problem"] = "You do not have access to this document."
                        d["doc"] = {"id": r["doc_id"], "title": "Restricted document", "ext": None, "kind": None, "size": None, "status": None, "doc_class": None,
                                    "page_count": None, "doc_date": None, "level": None}
                    elif r["deleted_at"]:
                        d["problem"] = "This document is in the trash."
                    else:
                        if not r["is_current"] and r["group_id"] in newer:
                            d["newer"] = newer[r["group_id"]]
                            d["doc"]["version"] = r["version"]
                        ok, why = B.can_include(r["ext"], r["kind"])
                        if not ok:
                            d["problem"] = why
                        elif r["status"] in ("queued", "processing"):
                            d["warning"] = "Still being read - its page count is not known yet."
                        elif r["status"] == "failed":
                            d["problem"] = "This file could not be read. Try Reprocess in the library, or upload it again."
                        n = r["page_count"] or (1 if r["kind"] == "image" else 0)
                        d["page_count"] = n
                        if it["pages"] and not d["problem"]:
                            try:
                                d["pages_selected"] = len(B.parse_pages(it["pages"], n if n else 100000))
                            except ValueError as exc:
                                d["problem"] = str(exc)
            if d["doc"] and d["doc"]["level"] is not None and not d["title"]:
                d["title_default"] = d["doc"]["title"]
            out.append(d)
        return out

    def estimate(opts, described):
        docs = [d for d in described if d["kind"] == "doc"]
        pages = 0
        for d in described:
            if d["kind"] == "section":
                pages += 1
            else:
                pages += (d.get("pages_selected") or d["page_count"] or 0) + (1 if opts["dividers"] else 0)
        rows = sum(1 for d in described if d["kind"] == "section" or d["in_index"])
        index_pages = max(1, math.ceil(rows / 22)) if opts["index"] else 0
        return {"documents": len(docs), "sections": len(described) - len(docs), "numbered_pages": pages,
                "total_pages": pages + index_pages + (1 if opts["cover"] else 0), "index_pages": index_pages,
                "problems": sum(1 for d in described if d["problem"]), "unknown_pages": sum(1 for d in docs if d["page_count"] is None or (d["doc"] and not d["page_count"]))}

    def case_label_of(c, ref):
        return F.case_label(c, ref) if ref else None

    def detail(c, uid, scope, r):
        items = c.execute("SELECT * FROM dms_bundle_items WHERE bundle_id = ? ORDER BY seq, id", (r["id"],)).fetchall()
        opts = B.clean_options(F.loads(r["options"], {}))
        rows = doc_rows(c, [it["doc_id"] for it in items if it["kind"] == "doc"])
        described = describe(c, uid, items, opts, rows)
        note = r["build_note"]
        problems = []
        if note and note.startswith("{"):
            j = F.loads(note, {})
            note, problems = j.get("message"), j.get("problems") or []
        return {
            "id": r["id"], "title": r["title"], "case_ref": r["case_ref"], "case_label": case_label_of(c, r["case_ref"]), "options": opts,
            "build": {"state": r["build_state"], "progress": r["progress"], "note": note, "problems": problems, "built_at": r["built_at"], "pages": r["built_pages"],
                      "size": r["built_size"], "warnings": F.loads(r["built_warnings"], []), "saved_doc_id": r["saved_doc_id"],
                      "stale": bool(r["build_state"] == "done" and r["built_fp"] != fingerprint(opts, items, rows))},
            "items": described, "estimate": estimate(opts, described), "updated_at": r["updated_at"], "created_at": r["created_at"], "owner_id": r["owner_id"],
            "converter": B.office_available(),
        }

    # ── list / create ────────────────────────────────────────────────────────────
    @api("/files/bundles", ["GET", "POST"])
    def bundles():
        c = h.conn()
        uid, scope = me(c)
        if request.method == "POST":
            b = _body()
            title = F.clip(b.get("title"), 160)
            ref = (b.get("case_ref") or "").strip() or None
            opts = B.clean_options({})
            if ref:
                ok, why = F.can_use_case(c, uid, ref, writing=False)
                if not ok:
                    raise h.ApiError(why, 404)
                if ref.startswith("lpms:"):
                    cs = c.execute("SELECT title, case_no, court FROM lpms_cases WHERE id = ?", (int(ref.split(":")[1]),)).fetchone()
                    if cs:
                        opts.update({"case_title": cs["title"], "case_no": cs["case_no"], "court": cs["court"]})
                        title = title or f"Bundle - {cs['title']}"
                else:
                    title = title or f"Bundle - {F.case_label(c, ref)}"
            title = title or "Untitled bundle"
            doc_ids = [i for i in (h.int_(x) for x in (b.get("doc_ids") or [])) if i]
            if b.get("from_case") and ref:
                ctx = h.ctx_now()
                vis = I.visibility_sql(c, ctx)
                doc_ids += [r[0] for r in c.execute(
                    f"SELECT d.doc_id FROM dms_docs d JOIN case_vault cv ON cv.id = d.doc_id WHERE cv.case_id = :ref AND {vis} AND d.deleted_at IS NULL AND d.is_current = 1 "
                    "ORDER BY (d.doc_date IS NULL), d.doc_date, d.created_at, d.doc_id LIMIT :lim", {"ref": ref, "uid": uid, "lim": MAX_ITEMS})]
            ctx = h.ctx_now()
            good = []
            for did in dict.fromkeys(doc_ids):
                try:
                    h.fetch_doc(c, ctx, did, allow_trashed=False)
                    good.append(did)
                except h.ApiError:
                    continue
            now = F.now_iso()
            with h.Tx() as tx:
                cur = tx.execute("INSERT INTO dms_bundles (scope, owner_id, title, case_ref, options, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
                                 (scope, uid, title, ref, json.dumps(opts), now, now))
                bid = cur.lastrowid
                for seq, did in enumerate(good[:MAX_ITEMS], 1):
                    tx.execute("INSERT INTO dms_bundle_items (bundle_id, seq, kind, doc_id) VALUES (?, ?, 'doc', ?)", (bid, seq, did))
            return jsonify({"ok": True, "bundle": detail(c, uid, scope, get_bundle(c, uid, scope, bid))}), 201
        rows = c.execute(
            "SELECT b.*, (SELECT COUNT(*) FROM dms_bundle_items i WHERE i.bundle_id = b.id AND i.kind = 'doc') AS n_docs FROM dms_bundles b WHERE b.scope = ? "
            + ("AND b.case_ref = ? " if request.args.get("case_ref") else "") + "ORDER BY b.updated_at DESC LIMIT 200",
            (scope, request.args["case_ref"]) if request.args.get("case_ref") else (scope,)).fetchall()
        out = []
        for r in rows:
            if r["case_ref"] and r["owner_id"] != uid and not F.can_use_case(c, uid, r["case_ref"], writing=False)[0]:
                continue
            out.append({"id": r["id"], "title": r["title"], "case_ref": r["case_ref"], "case_label": case_label_of(c, r["case_ref"]), "documents": r["n_docs"],
                        "state": r["build_state"], "built_at": r["built_at"], "built_pages": r["built_pages"], "updated_at": r["updated_at"]})
        return jsonify({"bundles": out})

    @api("/files/bundles/<int:bid>", ["GET", "PATCH", "DELETE"])
    def bundle_item(bid):
        c = h.conn()
        uid, scope = me(c)
        r = get_bundle(c, uid, scope, bid)
        if request.method == "DELETE":
            if r["build_state"] == "building":
                raise h.ApiError("This bundle is being built. Wait for it to finish.", 409)
            with h.Tx() as tx:
                tx.execute("DELETE FROM dms_bundle_items WHERE bundle_id = ?", (bid,))
                tx.execute("DELETE FROM dms_bundles WHERE id = ?", (bid,))
            if r["built_sha"]:
                _drop_blob(c, r["built_sha"], r["built_enc"])
            return jsonify({"ok": True})
        if request.method == "PATCH":
            b = _body()
            sets, vals = [], []
            if "title" in b:
                t = F.clip(b["title"], 160)
                if not t:
                    raise h.ApiError("A bundle needs a name.", 400)
                sets.append("title = ?"); vals.append(t)
            if "case_ref" in b:
                ref = (b["case_ref"] or "").strip() or None
                if ref:
                    ok, why = F.can_use_case(c, uid, ref, writing=False)
                    if not ok:
                        raise h.ApiError(why, 404)
                sets.append("case_ref = ?"); vals.append(ref)
            if "options" in b and isinstance(b["options"], dict):
                merged = {**B.clean_options(F.loads(r["options"], {})), **b["options"]}
                sets.append("options = ?"); vals.append(json.dumps(B.clean_options(merged)))
            if sets:
                with h.Tx() as tx:
                    tx.execute(f"UPDATE dms_bundles SET {', '.join(sets)}, updated_at = ? WHERE id = ?", (*vals, F.now_iso(), bid))
            r = get_bundle(c, uid, scope, bid)
        return jsonify({"bundle": detail(c, uid, scope, r)})

    def _drop_blob(c, sha, enc):
        with contextlib.suppress(Exception):
            n = c.execute("SELECT COUNT(*) FROM dms_bundles WHERE built_sha = ? AND built_enc = ?", (sha, int(bool(enc)))).fetchone()[0]
            m = c.execute("SELECT COUNT(*) FROM dms_docs WHERE sha256 = ? AND enc = ?", (sha, int(bool(enc)))).fetchone()[0]
            if not n and not m:
                S.remove(S.key_for(sha), bool(enc))

    @api("/files/bundles/<int:bid>/duplicate", ["POST"])
    def bundle_duplicate(bid):
        c = h.conn()
        uid, scope = me(c)
        r = get_bundle(c, uid, scope, bid)
        now = F.now_iso()
        with h.Tx() as tx:
            cur = tx.execute("INSERT INTO dms_bundles (scope, owner_id, title, case_ref, options, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
                             (scope, uid, (r["title"] + " (copy)")[:160], r["case_ref"], r["options"], now, now))
            nb = cur.lastrowid
            tx.execute("INSERT INTO dms_bundle_items (bundle_id, seq, kind, doc_id, title, label, pages, note, in_index) "
                       "SELECT ?, seq, kind, doc_id, title, label, pages, note, in_index FROM dms_bundle_items WHERE bundle_id = ?", (nb, bid))
        return jsonify({"ok": True, "bundle": detail(c, uid, scope, get_bundle(c, uid, scope, nb))}), 201

    # ── items ────────────────────────────────────────────────────────────────────
    def _editable(c, uid, scope, bid):
        r = get_bundle(c, uid, scope, bid)
        if r["build_state"] == "building":
            raise h.ApiError("This bundle is being built. Wait for it to finish before changing it.", 409)
        return r

    def _renumber(tx, bid):
        for n, row in enumerate(tx.execute("SELECT id FROM dms_bundle_items WHERE bundle_id = ? ORDER BY seq, id", (bid,)).fetchall(), 1):
            tx.execute("UPDATE dms_bundle_items SET seq = ? WHERE id = ?", (n, row["id"]))

    @api("/files/bundles/<int:bid>/items", ["POST"])
    def items_add(bid):
        c = h.conn()
        uid, scope = me(c)
        _editable(c, uid, scope, bid)
        b = _body()
        n_now = c.execute("SELECT COUNT(*) FROM dms_bundle_items WHERE bundle_id = ?", (bid,)).fetchone()[0]
        pos = h.int_(b.get("position"))
        added, skipped = 0, []
        with h.Tx() as tx:
            if b.get("kind") == "section":
                t = F.clip(b.get("title"), 160)
                if not t:
                    raise h.ApiError("Give the section a heading, for example “Part A - Pleadings”.", 400)
                new = [("section", None, t)]
            else:
                ctx = h.ctx_now()
                have = {x[0] for x in tx.execute("SELECT doc_id FROM dms_bundle_items WHERE bundle_id = ? AND doc_id IS NOT NULL", (bid,))}
                new = []
                for did in dict.fromkeys(i for i in (h.int_(x) for x in (b.get("doc_ids") or [])) if i):
                    if did in have and not b.get("allow_duplicates"):
                        skipped.append({"id": did, "reason": "already in this bundle"})
                        continue
                    try:
                        h.fetch_doc(tx, ctx, did, allow_trashed=False)
                    except h.ApiError as exc:
                        skipped.append({"id": did, "reason": exc.message})
                        continue
                    new.append(("doc", did, None))
            if n_now + len(new) > MAX_ITEMS:
                raise h.ApiError(f"A bundle can hold at most {MAX_ITEMS} items.", 400)
            if pos is not None and 0 <= pos < n_now:
                tx.execute("UPDATE dms_bundle_items SET seq = seq + ? WHERE bundle_id = ? AND seq > ?", (len(new), bid, pos))
                start = pos + 1
            else:
                start = n_now + 1
            for k, (kind, did, title) in enumerate(new):
                tx.execute("INSERT INTO dms_bundle_items (bundle_id, seq, kind, doc_id, title) VALUES (?,?,?,?,?)", (bid, start + k, kind, did, title))
                added += 1
            _renumber(tx, bid)
            touch(tx, bid)
        return jsonify({"ok": True, "added": added, "skipped": skipped, "bundle": detail(c, uid, scope, get_bundle(c, uid, scope, bid))})

    @api("/files/bundles/<int:bid>/items/<int:item_id>", ["PATCH", "DELETE"])
    def item_edit(bid, item_id):
        c = h.conn()
        uid, scope = me(c)
        _editable(c, uid, scope, bid)
        it = c.execute("SELECT * FROM dms_bundle_items WHERE id = ? AND bundle_id = ?", (item_id, bid)).fetchone()
        if not it:
            raise h.ApiError("Item not found.", 404)
        with h.Tx() as tx:
            if request.method == "DELETE":
                tx.execute("DELETE FROM dms_bundle_items WHERE id = ?", (item_id,))
                _renumber(tx, bid)
            else:
                b = _body()
                sets, vals = [], []
                if "title" in b:
                    t = F.clip(b["title"], 200)
                    if it["kind"] == "section" and not t:
                        raise h.ApiError("A section needs a heading.", 400)
                    sets.append("title = ?"); vals.append(t or None)
                if "label" in b:
                    sets.append("label = ?"); vals.append(F.clip(b["label"], 40) or None)
                if "note" in b:
                    sets.append("note = ?"); vals.append(F.clip(b["note"], 300) or None)
                if "in_index" in b:
                    sets.append("in_index = ?"); vals.append(1 if b["in_index"] else 0)
                if b.get("use_latest") and it["kind"] == "doc":
                    cur = tx.execute("SELECT d2.doc_id FROM dms_docs d1 JOIN dms_docs d2 ON d2.group_id = d1.group_id AND d2.is_current = 1 AND d2.deleted_at IS NULL "
                                     "WHERE d1.doc_id = ?", (it["doc_id"],)).fetchone()
                    if not cur:
                        raise h.ApiError("There is no newer version of this document.", 409)
                    if cur[0] != it["doc_id"]:
                        h.fetch_doc(tx, h.ctx_now(), cur[0], allow_trashed=False)
                        sets.append("doc_id = ?"); vals.append(cur[0])
                if "pages" in b and it["kind"] == "doc":
                    spec = F.clip(b["pages"], 200)
                    if spec:
                        n = tx.execute("SELECT page_count FROM dms_docs WHERE doc_id = ?", (it["doc_id"],)).fetchone()
                        try:
                            B.parse_pages(spec, (n[0] if n and n[0] else 100000))
                        except ValueError as exc:
                            raise h.ApiError(str(exc), 400)
                    sets.append("pages = ?"); vals.append(spec or None)
                if sets:
                    tx.execute(f"UPDATE dms_bundle_items SET {', '.join(sets)} WHERE id = ?", (*vals, item_id))
            touch(tx, bid)
        return jsonify({"ok": True, "bundle": detail(c, uid, scope, get_bundle(c, uid, scope, bid))})

    @api("/files/bundles/<int:bid>/order", ["PUT"])
    def items_order(bid):
        c = h.conn()
        uid, scope = me(c)
        _editable(c, uid, scope, bid)
        ids = [h.int_(x) for x in (_body().get("item_ids") or [])]
        have = [r[0] for r in c.execute("SELECT id FROM dms_bundle_items WHERE bundle_id = ?", (bid,))]
        if sorted(ids) != sorted(have):
            raise h.ApiError("The list changed while you were arranging it. Reload and try again.", 409)
        with h.Tx() as tx:
            for n, iid in enumerate(ids, 1):
                tx.execute("UPDATE dms_bundle_items SET seq = ? WHERE id = ? AND bundle_id = ?", (n, iid, bid))
            touch(tx, bid)
        return jsonify({"ok": True, "bundle": detail(c, uid, scope, get_bundle(c, uid, scope, bid))})

    @api("/files/bundles/<int:bid>/auto-order", ["POST"])
    def items_auto_order(bid):
        c = h.conn()
        uid, scope = me(c)
        _editable(c, uid, scope, bid)
        how = _body().get("by") or "date"
        items = c.execute("SELECT * FROM dms_bundle_items WHERE bundle_id = ? ORDER BY seq, id", (bid,)).fetchall()
        rows = doc_rows(c, [i["doc_id"] for i in items if i["kind"] == "doc"])
        if any(i["kind"] == "section" for i in items):
            raise h.ApiError("This bundle has section headings, so it is arranged by hand. Remove the headings to sort it automatically.", 409)
        classes = {n: k for k, n in enumerate(C.CLASS_NAMES)}

        def key(i):
            r = rows.get(i["doc_id"])
            if r is None:
                return (1, "", "", 0)
            title = (r["cv_smart_title"] or r["cv_title"] or "").lower()
            if how == "name":
                return (0, title, "", i["seq"])
            if how == "type":
                return (0, f"{classes.get(r['doc_class'] or 'Unclassified', 99):03d}", r["doc_date"] or "9999", i["seq"])
            if how == "added":
                return (0, r["created_at"] or "", "", i["seq"])
            return (0, r["doc_date"] or "9999-99-99", r["created_at"] or "", i["seq"])
        if how not in ("date", "name", "type", "added"):
            raise h.ApiError("Unknown way to sort.", 400)
        order = [i["id"] for i in sorted(items, key=key)]
        with h.Tx() as tx:
            for n, iid in enumerate(order, 1):
                tx.execute("UPDATE dms_bundle_items SET seq = ? WHERE id = ?", (n, iid))
            touch(tx, bid)
        return jsonify({"ok": True, "bundle": detail(c, uid, scope, get_bundle(c, uid, scope, bid))})

    # ── building ─────────────────────────────────────────────────────────────────
    def _safe_title(t):
        return h.safe_name((t or "bundle")) .rsplit(".pdf", 1)[0] or "bundle"

    def _job(bid, plan, options, prev_blob, fp):
        c = I.connect(h.db_path)
        stack = contextlib.ExitStack()
        out_tmp = None
        last = [0.0]

        def progress(frac, note=""):
            if time.time() - last[0] < 0.4 and frac < 1:
                return
            last[0] = time.time()
            with contextlib.suppress(Exception):
                c.execute("UPDATE dms_bundles SET progress = ?, updated_at = ? WHERE id = ? AND build_state = 'building'", (round(float(frac), 3), F.now_iso(), bid))
                c.commit()

        try:
            items = []
            for p in plan:
                it = dict(p)
                if p["kind"] == "doc":
                    try:
                        it["path"] = stack.enter_context(S.open_plain(p["store_key"], bool(p["enc"])))
                    except S.StoreError as exc:
                        it["path"], it["missing"] = None, str(exc)
                items.append(it)
            tmp_dir = os.path.join(S.storage_root(), "_incoming")
            os.makedirs(tmp_dir, exist_ok=True)
            fd, out_tmp = tempfile.mkstemp(prefix=f"bundle_{bid}_", suffix=".pdf", dir=tmp_dir)
            os.close(fd)
            res = B.build(items, options, out_tmp, progress=progress)
            sha = hashlib.sha256()
            with open(out_tmp, "rb") as fh:
                for block in iter(lambda: fh.read(1 << 20), b""):
                    sha.update(block)
            size = os.path.getsize(out_tmp)
            digest = sha.hexdigest()
            key, enc = S.commit(out_tmp, digest)
            out_tmp = None
            c.execute("UPDATE dms_bundles SET build_state = 'done', progress = 1, build_note = NULL, built_at = ?, built_pages = ?, built_size = ?, built_sha = ?, built_key = ?, "
                      "built_enc = ?, built_warnings = ?, built_fp = ?, updated_at = ? WHERE id = ?",
                      (F.now_iso(), res["pages"], size, digest, key, int(enc), json.dumps(res["warnings"]), fp, F.now_iso(), bid))
            c.commit()
            if prev_blob and prev_blob != (digest, int(enc)):
                _drop_blob(c, prev_blob[0], prev_blob[1])
        except B.BundleError as exc:
            msg = json.dumps({"message": exc.message, "problems": exc.problems}) if exc.problems else exc.message
            with contextlib.suppress(Exception):
                c.rollback()
                c.execute("UPDATE dms_bundles SET build_state = 'error', build_note = ?, updated_at = ? WHERE id = ?", (msg, F.now_iso(), bid))
                c.commit()
        except Exception as exc:
            h.log(f"bundle {bid} build failed: {exc}")
            with contextlib.suppress(Exception):
                c.rollback()
                c.execute("UPDATE dms_bundles SET build_state = 'error', build_note = ?, updated_at = ? WHERE id = ?",
                          ("The bundle could not be built because of a problem on the server. Please try again; if it keeps failing, contact support.", F.now_iso(), bid))
                c.commit()
        finally:
            stack.close()
            if out_tmp:
                with contextlib.suppress(OSError):
                    os.remove(out_tmp)
            with contextlib.suppress(Exception):
                c.close()

    @api("/files/bundles/<int:bid>/build", ["POST"])
    def bundle_build(bid):
        c = h.conn()
        uid, scope = me(c)
        r = get_bundle(c, uid, scope, bid)
        if r["build_state"] == "building":
            raise h.ApiError("This bundle is already being built.", 409)
        opts = B.clean_options(F.loads(r["options"], {}))
        items = c.execute("SELECT * FROM dms_bundle_items WHERE bundle_id = ? ORDER BY seq, id", (bid,)).fetchall()
        if not any(i["kind"] == "doc" for i in items):
            raise h.ApiError("Add at least one document first.", 400)
        rows = doc_rows(c, [i["doc_id"] for i in items if i["kind"] == "doc"])
        described = describe(c, uid, items, opts, rows)
        problems = [{"item": d["title"] or (d["doc"] or {}).get("title") or f"Item {d['seq']}", "problem": d["problem"]} for d in described if d["problem"]]
        if problems:
            return h.err("Some items cannot go in the bundle. Fix or remove them first.", 422, problems=problems)
        plan = []
        for it, d in zip(items, described):
            if it["kind"] == "section":
                plan.append({"kind": "section", "title": it["title"], "label": None, "pages": None, "in_index": 1})
            else:
                row = rows[it["doc_id"]]
                plan.append({"kind": "doc", "title": it["title"] or d["doc"]["title"], "label": it["label"], "pages": it["pages"], "in_index": bool(it["in_index"]),
                             "store_key": row["store_key"], "enc": row["enc"], "ext": row["ext"]})
        prev = (r["built_sha"], r["built_enc"]) if r["built_sha"] else None
        fp = fingerprint(opts, items, rows)
        with h.Tx() as tx:
            tx.execute("UPDATE dms_bundles SET build_state = 'building', progress = 0, build_note = NULL, updated_at = ? WHERE id = ? AND build_state != 'building'", (F.now_iso(), bid))
        threading.Thread(target=_job, args=(bid, plan, opts, prev, fp), name=f"bundle-{bid}", daemon=True).start()
        return jsonify({"ok": True, "bundle": detail(c, uid, scope, get_bundle(c, uid, scope, bid))}), 202

    @api("/files/bundles/<int:bid>/download", ["GET"])
    def bundle_download(bid):
        c = h.conn()
        uid, scope = me(c)
        r = get_bundle(c, uid, scope, bid)
        if not r["built_key"] or r["build_state"] != "done":
            raise h.ApiError("Build the bundle first.", 409)
        cm = S.open_plain(r["built_key"], bool(r["built_enc"]))
        try:
            path = cm.__enter__()
        except S.StoreError as exc:
            raise h.ApiError(str(exc), 410)
        inline = h.truthy(request.args.get("inline"))
        resp = send_file(path, mimetype="application/pdf", as_attachment=not inline, download_name=_safe_title(r["title"]) + ".pdf", conditional=True,
                         etag=(r["built_sha"] or "")[:32], max_age=0)
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["Cache-Control"] = "private, no-store"
        resp.call_on_close(lambda: cm.__exit__(None, None, None))
        return resp

    class _Upload:
        def __init__(self, name, path):
            self.filename, self.stream = name, open(path, "rb")

    @api("/files/bundles/<int:bid>/save", ["POST"])
    def bundle_save(bid):
        """File the finished PDF in the library (on the bundle's case) so it is searchable and versioned like any document."""
        c = h.conn()
        uid, scope = me(c)
        r = get_bundle(c, uid, scope, bid)
        if not r["built_key"] or r["build_state"] != "done":
            raise h.ApiError("Build the bundle first.", 409)
        b = _body()
        ctx = h.ctx_now()
        folder_id = h.int_(b.get("folder_id"))
        h.check_folder(uid, folder_id, c)
        case_ref = r["case_ref"]
        matter_id, lpms_ref = None, None
        if case_ref and case_ref.startswith("lpms:"):
            h.check_lpms_case(c, uid, int(case_ref.split(":")[1]), writing=True)
            lpms_ref = case_ref
        elif case_ref and case_ref.startswith("matter:"):
            matter_id = int(case_ref.split(":")[1])
            h.check_matter(c, uid, matter_id)
        name = _safe_title(b.get("title") or r["title"]) + ".pdf"
        cm = S.open_plain(r["built_key"], bool(r["built_enc"]))
        try:
            path = cm.__enter__()
        except S.StoreError as exc:
            raise h.ApiError(str(exc), 410)
        up = None
        try:
            up = _Upload(name, path)
            dup, row = h.ingest(c, ctx, up, folder_id, matter_id, None, None, True, title=F.clip(b.get("title") or r["title"], 180), case_ref=lpms_ref)
        finally:
            with contextlib.suppress(Exception):
                if up:
                    up.stream.close()
            cm.__exit__(None, None, None)
        if dup or row is None:
            raise h.ApiError("Could not save the bundle to the library.", 409)
        if lpms_ref:
            h.tell_practice(lpms_ref, row["doc_id"], h.title_of(row), uid, "upload")
        with h.Tx() as tx:
            tx.execute("UPDATE dms_bundles SET saved_doc_id = ?, updated_at = ? WHERE id = ?", (row["doc_id"], F.now_iso(), bid))
        return jsonify({"ok": True, "doc": h.docs_payload(c, ctx, [row])[0]}), 201
