"""
routes/dms_files.py - the "paper to digital" part of the Document Hub, mounted INTO the hub's blueprint:

    /api/dms/files/summary          one call for the tab badges
    /api/dms/files/cases            cases a person may file into (search box)
    /api/dms/files/filing/...       auto-filing: the "To file" queue            (routes/dms_f_filing.py)
    /api/dms/files/paper/...        physical file register, shelves, labels     (routes/dms_f_paper.py)
    /api/dms/files/bundles/...      court-ready bundles                          (routes/dms_f_bundles.py)
    /api/dms/files/scan/...         scan intake                                  (routes/dms_f_scan.py)

`mount(bp, h)` is called once by create_dms_blueprint with `h`, a bundle of the hub's own helpers (database, auth context, the
transaction wrapper, the audit-trail writer, the upload pipeline). Nothing here opens its own login or its own database.
"""
import contextlib
import functools

from flask import jsonify, request
from flask_jwt_extended import jwt_required

from utils import dms_files as F
from utils import dms_index as I
from utils import dms_match as M
from utils import dms_paper as PF


def api_factory(bp):
    """@api('/path', ['GET', 'POST']) -> a JWT-protected route that answers preflights like every other hub route."""
    def api(path, methods):
        def deco(fn):
            @bp.route(path, methods=list(methods) + ["OPTIONS"], endpoint=f"files_{fn.__name__}")
            @jwt_required()
            @functools.wraps(fn)
            def wrapper(*a, **kw):
                if request.method == "OPTIONS":
                    return jsonify({}), 200
                return fn(*a, **kw)
            return wrapper
        return deco
    return api


def body():
    b = request.get_json(force=True, silent=True)
    return b if isinstance(b, dict) else {}


def actor_name(h, c, uid):
    if h.user_name:
        with contextlib.suppress(Exception):
            n = h.user_name(uid)
            if n:
                return str(n)[:80]
    if I._has_lpms_tables(c):
        with contextlib.suppress(Exception):
            r = c.execute("SELECT name FROM lpms_members WHERE user_id = ? AND active = 1 ORDER BY id LIMIT 1", (uid,)).fetchone()
            if r:
                return r["name"]
    return f"User #{uid}"


def mount(bp, h):
    api = api_factory(bp)
    from routes import dms_f_bundles, dms_f_filing, dms_f_paper, dms_f_scan

    boot = I.connect(h.db_path)
    try:
        F.ensure_schema(boot)
    finally:
        boot.close()

    @api("/files/summary", ["GET"])
    def files_summary():
        c = h.conn()
        uid = h.uid_now()
        scope = F.scope_of(c, uid)
        filing = dms_f_filing.summary(h, c, uid)
        paper = PF.stats(c, scope, uid)
        n_bundles = c.execute("SELECT COUNT(*) FROM dms_bundles WHERE scope = ?", (scope,)).fetchone()[0]
        n_scans = c.execute("SELECT COUNT(*) FROM dms_scan_sessions WHERE owner_id = ? AND status = 'open'", (uid,)).fetchone()[0]
        return jsonify({"filing": filing, "paper": paper, "bundles": n_bundles, "scans": n_scans, "scope": scope.split(":")[0]})

    @api("/files/cases", ["GET"])
    def files_cases():
        c = h.conn()
        uid = h.uid_now()
        one = (request.args.get("ref") or "").strip()
        cases = F.accessible_cases(c, uid, request.args.get("q", ""), limit=h.int_(request.args.get("limit"), 40) or 40,
                                   include_archived=h.truthy(request.args.get("archived")) or bool(one), refs=[one] if one else None)
        return jsonify({"cases": cases})

    @api("/files/case-summary", ["GET"])
    def files_case_summary():
        """What the Document Hub knows about one case, for the link on the Practice case page."""
        c = h.conn()
        uid = h.uid_now()
        ref = request.args.get("case_ref", "")
        ok, why = F.can_use_case(c, uid, ref, writing=False)
        if not ok:
            raise h.ApiError(why, 404)
        scope = F.scope_of(c, uid)
        pf = PF.list_pfiles(c, scope, uid, status="active", case_ref=ref, per_page=1)[1]
        out_n = PF.list_pfiles(c, scope, uid, status="out", case_ref=ref, per_page=1)[1]
        bundles = c.execute("SELECT COUNT(*) FROM dms_bundles WHERE scope = ? AND case_ref = ?", (scope, ref)).fetchone()[0]
        sugg = c.execute("SELECT COUNT(*) FROM dms_filing f JOIN case_vault cv ON cv.id = f.doc_id WHERE f.owner_id = ? AND f.state = 'pending' "
                         f"AND f.top_ref = ? AND {M.UNFILED}", (uid, ref)).fetchone()[0]
        return jsonify({"paper_files": pf, "paper_out": out_n, "bundles": bundles, "to_file": sugg})

    # the Document Hub reads these when it processes a file / shows a document
    dms_f_filing.mount(bp, h, api)
    dms_f_paper.mount(bp, h, api)
    dms_f_bundles.mount(bp, h, api)
    dms_f_scan.mount(bp, h, api)
