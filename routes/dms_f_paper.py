"""Physical file register: shelves, paper files, issue / return / transfer, overdue, lookup by number or QR, printable labels."""
import csv
import io
import re

from flask import Response, jsonify, request

from utils import dms_files as F
from utils import dms_index as I
from utils import dms_paper as PF


def _body():
    b = request.get_json(force=True, silent=True)
    return b if isinstance(b, dict) else {}


def mount(bp, h, api):
    from routes.dms_files import actor_name

    @bp.errorhandler(PF.PaperError)
    def _paper_error(e):
        return h.err(e.message, e.status, **e.extra)

    def me(c):
        uid = h.uid_now()
        return uid, F.scope_of(c, uid), actor_name(h, c, uid)

    def case_info(c, uid, ref):
        """(label, client) for a case reference the person may see; ApiError otherwise."""
        ref = (ref or "").strip()
        if not ref:
            return None, None
        ok, why = F.can_use_case(c, uid, ref, writing=False)
        if not ok:
            raise h.ApiError(why, 404)
        client = None
        if ref.startswith("lpms:") and I._has_lpms_tables(c):
            r = c.execute("SELECT cl.name FROM lpms_cases cs LEFT JOIN lpms_clients cl ON cl.id = cs.client_id WHERE cs.id = ?", (int(ref.split(":")[1]),)).fetchone()
            client = r[0] if r else None
        return F.case_label(c, ref), client

    def payload(c, scope, rows, locs=None):
        locs = locs if locs is not None else PF.location_map(c, scope)
        labels = {}
        for r in rows:
            if r["case_ref"] and r["case_ref"] not in labels:
                labels[r["case_ref"]] = F.case_label(c, r["case_ref"])
        return [PF.pfile_dict(r, locs, labels) for r in rows]

    def one(c, uid, scope, pf_id):
        r = PF.get_pfile(c, scope, pf_id, uid)
        return payload(c, scope, [r])[0]

    # ── locations ────────────────────────────────────────────────────────────────
    @api("/files/locations", ["GET", "POST"])
    def locations():
        c = h.conn()
        uid, scope, _a = me(c)
        if request.method == "POST":
            b = _body()
            with h.Tx() as tx:
                lid = PF.create_location(tx, scope, uid, b.get("name"), b.get("kind") or "almirah", h.int_(b.get("parent_id")), b.get("code"), b.get("notes"))
            return jsonify({"ok": True, "id": lid, "locations": PF.locations_payload(c, scope)}), 201
        return jsonify({"locations": PF.locations_payload(c, scope), "kinds": list(F.LOCATION_KINDS)})

    @api("/files/locations/<int:loc_id>", ["PATCH", "DELETE"])
    def location_item(loc_id):
        c = h.conn()
        uid, scope, _a = me(c)
        with h.Tx() as tx:
            if request.method == "DELETE":
                PF.delete_location(tx, scope, loc_id)
            else:
                b = _body()
                fields = {k: b[k] for k in ("name", "kind", "code", "notes", "archived") if k in b}
                if "parent_id" in b:
                    fields["parent_id"] = h.int_(b["parent_id"])
                PF.update_location(tx, scope, loc_id, fields)
        return jsonify({"ok": True, "locations": PF.locations_payload(c, scope)})

    # ── register ─────────────────────────────────────────────────────────────────
    @api("/files/paper/summary", ["GET"])
    def paper_summary():
        c = h.conn()
        uid, scope, _a = me(c)
        base = PF.visible_sql(c)
        a = {"uid": uid, "scope": scope}
        overdue_rows = PF.list_pfiles(c, scope, uid, overdue=True, per_page=8, sort="due")[0]
        recent = c.execute(
            f"SELECT m.id, m.action, m.actor_name, m.to_holder, m.from_holder, m.to_loc, m.from_loc, m.note, m.at, pf.id AS pfile_id, pf.file_no, pf.title "
            f"FROM dms_pfile_moves m JOIN dms_pfiles pf ON pf.id = m.pfile_id WHERE {base} ORDER BY m.id DESC LIMIT 12", a).fetchall()
        return jsonify({"stats": PF.stats(c, scope, uid), "holders": PF.holders(c, scope, uid), "overdue": payload(c, scope, overdue_rows),
                        "recent": [dict(r) for r in recent], "people": [{"id": k, "name": v} for k, v in F.scope_member_names(c, uid).items()],
                        "locations": PF.locations_payload(c, scope), "layouts": {k: v[0] for k, v in PF.LAYOUTS.items()}})

    @api("/files/paper", ["GET", "POST"])
    def paper_collection():
        c = h.conn()
        uid, scope, actor = me(c)
        if request.method == "POST":
            b = _body()
            label, client = case_info(c, uid, b.get("case_ref"))
            fields = dict(b)
            if not (fields.get("title") or "").strip() and label:
                fields["title"] = label
            if not (fields.get("client") or "").strip() and client:
                fields["client"] = client
            fields["location_id"] = h.int_(b.get("location_id"))
            fields["case_ref"] = (b.get("case_ref") or "").strip() or None
            with h.Tx() as tx:
                pid = PF.create_pfile(tx, scope, uid, actor, fields, case_label=label)
            return jsonify({"ok": True, "file": one(c, uid, scope, pid)}), 201
        a = request.args
        rows, total = PF.list_pfiles(
            c, scope, uid, status=a.get("status") or "active", q=a.get("q", ""), location_id=h.int_(a.get("location_id")), case_ref=a.get("case_ref") or None,
            holder=a.get("holder") or None, overdue=h.truthy(a.get("overdue")), page=h.int_(a.get("page"), 1) or 1,
            per_page=h.int_(a.get("per_page"), 30) or 30, sort=a.get("sort") or "recent")
        return jsonify({"files": payload(c, scope, rows), "total": total, "page": h.int_(a.get("page"), 1) or 1,
                        "per_page": max(1, min(h.int_(a.get("per_page"), 30) or 30, 100)), "stats": PF.stats(c, scope, uid)})

    @api("/files/paper/lookup", ["GET"])
    def paper_lookup():
        c = h.conn()
        uid, scope, _a = me(c)
        r = PF.lookup(c, scope, uid, request.args.get("code", ""))
        return jsonify({"file": payload(c, scope, [r])[0]})

    def linked_docs(c, uid, pf_id):
        ctx = h.ctx_now()
        vis = I.visibility_sql(c, ctx)
        rows = c.execute(
            f"SELECT {I._LIST_COLS} FROM dms_pfile_docs pd JOIN dms_docs d ON d.doc_id = pd.doc_id JOIN case_vault cv ON cv.id = d.doc_id "
            f"WHERE pd.pfile_id = :pf AND d.deleted_at IS NULL AND d.is_current = 1 AND {vis} ORDER BY pd.linked_at DESC LIMIT 200", {"pf": pf_id, "uid": uid}).fetchall()
        return h.docs_payload(c, ctx, rows)

    @api("/files/paper/<int:pf_id>", ["GET", "PATCH"])
    def paper_item(pf_id):
        c = h.conn()
        uid, scope, actor = me(c)
        if request.method == "PATCH":
            b = _body()
            f = {k: b[k] for k in ("title", "kind", "client", "location_note", "pages_est", "notes", "note") if k in b}
            if "location_id" in b:
                f["location_id"] = h.int_(b["location_id"])
            case_changed, label = False, None
            if "case_ref" in b:
                label, client = case_info(c, uid, b.get("case_ref"))
                f["case_ref"] = (b.get("case_ref") or "").strip() or None
                case_changed = True
                if client and "client" not in b and not PF.get_pfile(c, scope, pf_id, uid)["client"]:
                    f["client"] = client
            with h.Tx() as tx:
                PF.edit_pfile(tx, scope, uid, actor, pf_id, f, case_label=label, case_changed=case_changed)
        r = PF.get_pfile(c, scope, pf_id, uid)
        return jsonify({"file": payload(c, scope, [r])[0], "history": PF.history(c, pf_id), "docs": linked_docs(c, uid, pf_id)})

    def _act(pf_id, fn):
        c = h.conn()
        uid, scope, actor = me(c)
        b = _body()
        with h.Tx() as tx:
            fn(tx, scope, uid, actor, b)
        return jsonify({"ok": True, "file": one(c, uid, scope, pf_id), "stats": PF.stats(c, scope, uid)})

    @api("/files/paper/<int:pf_id>/issue", ["POST"])
    def paper_issue(pf_id):
        return _act(pf_id, lambda tx, scope, uid, actor, b: PF.issue(
            tx, scope, uid, actor, pf_id, to_name=b.get("to_name"), to_user_id=h.int_(b.get("to_user_id")), due_at=b.get("due_at") or None,
            note=b.get("note"), transfer=bool(b.get("transfer"))))

    @api("/files/paper/<int:pf_id>/return", ["POST"])
    def paper_return(pf_id):
        return _act(pf_id, lambda tx, scope, uid, actor, b: PF.return_file(
            tx, scope, uid, actor, pf_id, location_id=h.int_(b.get("location_id")), location_note=b.get("location_note"), note=b.get("note")))

    @api("/files/paper/<int:pf_id>/move", ["POST"])
    def paper_move(pf_id):
        return _act(pf_id, lambda tx, scope, uid, actor, b: PF.move_file(
            tx, scope, uid, actor, pf_id, h.int_(b.get("location_id")), location_note=b.get("location_note"), note=b.get("note")))

    def _status_route(action):
        def view(pf_id):
            return _act(pf_id, lambda tx, scope, uid, actor, b: PF.set_status(tx, scope, uid, actor, pf_id, action, note=b.get("note")))
        view.__name__ = f"paper_{action}"
        api(f"/files/paper/<int:pf_id>/{action}", ["POST"])(view)

    for _action in ("lost", "found", "archive", "restore"):
        _status_route(_action)

    @api("/files/paper/<int:pf_id>/docs", ["POST"])
    def paper_link_docs(pf_id):
        c = h.conn()
        uid, scope, actor = me(c)
        PF.get_pfile(c, scope, pf_id, uid)
        ctx = h.ctx_now()
        ids = [i for i in (h.int_(x) for x in (_body().get("doc_ids") or [])) if i][:200]
        if not ids:
            raise h.ApiError("Choose documents to link.", 400)
        added, skipped = 0, 0
        with h.Tx() as tx:
            for did in ids:
                try:
                    h.fetch_doc(tx, ctx, did, allow_trashed=False)
                except h.ApiError:
                    skipped += 1
                    continue
                n = tx.execute("INSERT OR IGNORE INTO dms_pfile_docs (pfile_id, doc_id, linked_by, linked_at) VALUES (?,?,?,?)", (pf_id, did, uid, F.now_iso())).rowcount
                added += n
            if added:
                PF._log(tx, pf_id, "linked-docs", uid, actor, note=f"{added} scanned document{'s' if added != 1 else ''}")
        return jsonify({"ok": True, "added": added, "skipped": skipped, "docs": linked_docs(c, uid, pf_id)})

    @api("/files/paper/<int:pf_id>/docs/<int:doc_id>", ["DELETE"])
    def paper_unlink_doc(pf_id, doc_id):
        c = h.conn()
        uid, scope, _a = me(c)
        PF.get_pfile(c, scope, pf_id, uid)
        with h.Tx() as tx:
            tx.execute("DELETE FROM dms_pfile_docs WHERE pfile_id = ? AND doc_id = ?", (pf_id, doc_id))
        return jsonify({"ok": True, "docs": linked_docs(c, uid, pf_id)})

    @api("/files/paper/export.csv", ["GET"])
    def paper_export():
        c = h.conn()
        uid, scope, _a = me(c)
        out = []
        page = 1
        while True:
            rs, total = PF.list_pfiles(c, scope, uid, status=request.args.get("status") or "active", per_page=100, page=page, sort="number")
            out += rs
            if page * 100 >= total or page >= 100:
                break
            page += 1
        items = payload(c, scope, out)
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["File no.", "Name", "Kind", "Case", "Client", "Status", "Kept at", "Shelf note", "With", "Issued", "Due back", "Overdue", "Pages (est.)", "Notes"])
        for f in items:
            w.writerow([h.csv_safe(x) for x in (f["file_no"], f["title"], f["kind"], f["case_label"], f["client"], f["status"], f["location"], f["location_note"],
                                               f["holder"], (f["issued_at"] or "")[:10], f["due_at"], "yes" if f["overdue"] else "", f["pages_est"], f["notes"])])
        return Response("﻿" + buf.getvalue(), mimetype="text/csv", headers={"Content-Disposition": 'attachment; filename="paper-file-register.csv"',
                                                                                  "X-Content-Type-Options": "nosniff"})

    # ── labels ───────────────────────────────────────────────────────────────────
    def _base_url(b):
        base = (b or request.args.get("base") or "").strip()
        if not re.fullmatch(r"https?://[A-Za-z0-9.\-:\[\]]{1,120}(?:/[^\s?#]{0,80})?", base):
            base = request.host_url.rstrip("/")
        return base.rstrip("/")

    def _labels(ids, layout, base, cut):
        c = h.conn()
        uid, scope, _a = me(c)
        files = [PF.get_pfile(c, scope, i, uid) for i in ids]
        pdf, warns = PF.labels_pdf(files, PF.location_map(c, scope), base, layout, cut_marks=cut)
        resp = Response(pdf, mimetype="application/pdf", headers={"Content-Disposition": 'inline; filename="paper-file-labels.pdf"', "X-Content-Type-Options": "nosniff",
                                                                  "Cache-Control": "private, no-store"})
        if warns:
            resp.headers["X-Label-Warnings"] = "; ".join(warns)[:300]
        return resp

    @api("/files/paper/labels.pdf", ["POST"])
    def paper_labels():
        b = _body()
        ids = [i for i in (h.int_(x) for x in (b.get("ids") or [])) if i]
        if not ids:
            raise h.ApiError("Choose at least one file.", 400)
        if len(ids) > 240:
            raise h.ApiError("Print at most 240 labels at a time.", 400)
        return _labels(ids, b.get("layout") or "a4-24", _base_url(b.get("base")), bool(b.get("cut_marks")))

    @api("/files/paper/<int:pf_id>/label.pdf", ["GET"])
    def paper_label_one(pf_id):
        return _labels([pf_id], request.args.get("layout") or "roll", _base_url(None), False)
