"""
routes/vault_workspace_routes.py - Case Vault workspace: live overview numbers, a timeline built from real records,
and the in-app document viewer (inline preview, editable text, save-as-DOCX, per-document AI assistant).

Mounted from app.py with create_vault_workspace_blueprint(deps). deps:
  db_path     the SQLite file the Case Vault / Document Hub / Practice already share
  scope       uid -> (sql, params): predicate for the case_vault rows (alias cv) this user may list - the same one /api/vault/meta uses
  access      (uid, doc_id, require_edit) -> bool: may this user open / change that document
  adopt       (uid, doc_id) -> None: hand a stored row to the Document Hub (search, classification) - best effort
  provenance  (node_type, node_id, name, action, actor, owner, detail) -> None: the vault's tamper-evident trail
Nothing here invents data: every number and every timeline entry comes from a table row, and a user with no practice, no
documents or no matters simply gets zeros and empty lists.
"""
import hashlib
import html as _html
import io
import json
import os
import re
import sqlite3
from datetime import date, datetime, timedelta

from flask import Blueprint, Response, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

MAX_BYTES = 60 * 1024 * 1024
INLINE_MIMES = {
    "pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif",
    "webp": "image/webp", "txt": "text/plain; charset=utf-8",
}
MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
D_NUM = re.compile(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b")
D_DMY = re.compile(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})\b", re.I)
D_MDY = re.compile(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b", re.I)
# (words just before a date) -> what that date is. Only dated sentences that say what they are become timeline entries.
DATE_KINDS = [
    (re.compile(r"next (date of )?hearing|posted to|adjourned to|list(ed)?( again)? (the matter )?on|next date|called on|come up on|further hearing", re.I), "Next hearing"),
    (re.compile(r"filed on|date of filing|filing date|presented on|instituted on", re.I), "Filed"),
    (re.compile(r"summons|notice (issued|dated|sent)|legal notice", re.I), "Notice / summons"),
    (re.compile(r"affidavit|sworn|solemnly", re.I), "Affidavit"),
    (re.compile(r"agreement|executed on|entered into|work order", re.I), "Agreement / contract"),
    (re.compile(r"order(s)? (passed|dated)|orders? dated|heard the|judgment|decree", re.I), "Order"),
    (re.compile(r"vakalat", re.I), "Vakalatnama"),
    (re.compile(r"written statement|reply to the plaint", re.I), "Written statement"),
    (re.compile(r"issues? (framed|settled)", re.I), "Issues framed"),
    (re.compile(r"evidence|cross-?examin|\bPW\s?-?\d", re.I), "Evidence"),
]


def _connect(path):
    c = sqlite3.connect(path, timeout=30)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA busy_timeout=30000")
    return c


def _has(c, name):
    return bool(c.execute("SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ?", (name,)).fetchone())


def _iso(y, m, d):
    try:
        v = date(int(y), int(m), int(d))
    except Exception:
        return None
    return v.isoformat() if 1990 <= v.year <= 2100 else None


def find_dates(text):
    """[(iso, start, end)] for every day-first / written date in the text."""
    out = []
    for m in D_NUM.finditer(text):
        iso = _iso(m.group(3), m.group(2), m.group(1))
        if iso:
            out.append((iso, m.start(), m.end()))
    for m in D_DMY.finditer(text):
        iso = _iso(m.group(3), MONTHS[m.group(2).lower()[:3]], m.group(1))
        if iso:
            out.append((iso, m.start(), m.end()))
    for m in D_MDY.finditer(text):
        iso = _iso(m.group(3), MONTHS[m.group(1).lower()[:3]], m.group(2))
        if iso:
            out.append((iso, m.start(), m.end()))
    return sorted(out, key=lambda t: t[1])


def dated_events_in(text, limit=8):
    """[(iso, kind, snippet)] - only dates whose surrounding words say what happened on that date."""
    flat = re.sub(r"\s+", " ", text or "")
    seen, out = set(), []
    for iso, s, e in find_dates(flat):
        before = flat[max(0, s - 70):s]
        after = flat[e:e + 25]
        kind = next((k for rx, k in DATE_KINDS if rx.search(before) or rx.search(flat[max(0, s - 25):e + 25])), None)
        if not kind or (iso, kind) in seen:
            continue
        seen.add((iso, kind))
        snippet = (before[-60:] + flat[s:e] + after).strip()
        out.append((iso, kind, snippet))
        if len(out) >= limit:
            break
    return out


# ── text <-> html ────────────────────────────────────────────────────────────────────
from utils.vault_docs_convert import (  # noqa: E402  (conversion lives in one place: layout-preserving both ways)
    _esc, docx_to_html, html_to_docx, html_to_pdf, html_to_text, pdf_to_html, text_to_html,
)
from utils import doc_storage  # noqa: E402

FORMATS = {
    "docx": ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Word document"),
    "pdf": ("application/pdf", "PDF"),
    "txt": ("text/plain; charset=utf-8", "Plain text"),
}


def render_format(fmt, html, title):
    if fmt == "docx":
        return html_to_docx(html, title)
    if fmt == "pdf":
        return html_to_pdf(html, title)
    return html_to_text(html).replace("\r\n", "\n").encode("utf-8-sig")


def safe_name(name, fallback="document"):
    n = re.sub(r"\.(pdf|docx?|txt|rtf|png|jpe?g)$", "", str(name or ""), flags=re.I)
    n = re.sub(r"[\\/:*?\"<>|\x00-\x1f]+", " ", n).strip(" .")
    return (re.sub(r"\s+", " ", n)[:120] or fallback)


# ── blueprint ────────────────────────────────────────────────────────────────────────
def create_vault_workspace_blueprint(deps):
    bp = Blueprint("vault_workspace", __name__, url_prefix="/api/vault")
    db_path = deps["db_path"]
    log = deps.get("log") or (lambda m: None)

    def uid():
        return int(get_jwt_identity())

    def err(msg, code=400):
        return jsonify({"error": True, "message": msg}), code

    def member(c, user_id):
        from utils import lpms_store as L
        if not _has(c, "lpms_members"):
            return None
        return L.member_for_user(c, user_id)

    def visible_docs(c, user_id, cols="cv.id"):
        sql, params = deps["scope"](user_id)
        join = "LEFT JOIN dms_docs dd ON dd.doc_id = cv.id" if _has(c, "dms_docs") else ""
        return c.execute(f"SELECT {cols} FROM case_vault cv {join} WHERE {sql}", params).fetchall()

    # ── overview numbers ────────────────────────────────────────────────────────────
    @bp.route("/overview", methods=["GET", "OPTIONS"])
    @jwt_required()
    def overview():
        if request.method == "OPTIONS":
            return jsonify({}), 200
        c = _connect(db_path)
        try:
            u = uid()
            hub = _has(c, "dms_docs")
            cols = "cv.id, cv.created_at, cv.doc_type, cv.title, cv.smart_title, cv.case_id" + (", dd.doc_class" if hub else ", NULL AS doc_class")
            docs = visible_docs(c, u, cols)
            cutoff = (datetime.utcnow() - timedelta(days=7)).strftime("%Y-%m-%d %H:%M:%S")
            classes = {}
            drafts = 0
            week = 0
            for r in docs:
                if (r["created_at"] or "") >= cutoff:
                    week += 1
                cl = (r["doc_class"] or "").strip()
                if cl and cl.lower() not in ("unclassified", "other", "unknown"):
                    classes[cl] = classes.get(cl, 0) + 1
                name = f"{r['smart_title'] or ''} {r['title'] or ''} {r['doc_type'] or ''}".lower()
                if "draft" in name:
                    drafts += 1
            out = {
                "documents": len(docs), "documents_this_week": week, "drafts": drafts,
                "categories": len(classes),
                "category_names": [k for k, _ in sorted(classes.items(), key=lambda kv: (-kv[1], kv[0]))],
                "practice": False, "matters": 0, "open_matters": 0, "hearings_this_week": 0, "next_hearing": None, "case_docs": {},
            }
            m = member(c, u)
            if m:
                from utils import lpms_store as L
                vis, vp = L.case_visible_sql(m, "c")
                today = L.today_ist()
                p = {**vp, "today": today.isoformat(), "week": (today + timedelta(days=6)).isoformat()}
                out["practice"] = True
                out["matters"] = c.execute(f"SELECT COUNT(*) FROM lpms_cases c WHERE {vis} AND c.archived_at IS NULL", p).fetchone()[0]
                out["open_matters"] = c.execute(f"SELECT COUNT(*) FROM lpms_cases c WHERE {vis} AND c.archived_at IS NULL AND c.closed_at IS NULL", p).fetchone()[0]
                out["hearings_this_week"] = c.execute(
                    f"SELECT COUNT(*) FROM lpms_hearings h JOIN lpms_cases c ON c.id = h.case_id WHERE {vis} AND c.archived_at IS NULL "
                    "AND h.status = 'scheduled' AND h.hearing_date BETWEEN :today AND :week", p).fetchone()[0]
                nh = c.execute(f"SELECT MIN(h.hearing_date) FROM lpms_hearings h JOIN lpms_cases c ON c.id = h.case_id WHERE {vis} AND c.archived_at IS NULL "
                               "AND h.status = 'scheduled' AND h.hearing_date >= :today", p).fetchone()[0]
                out["next_hearing"] = nh
                if hub:
                    rows = c.execute(
                        "SELECT cv.case_id AS ref, COUNT(*) AS n FROM case_vault cv JOIN dms_docs d ON d.doc_id = cv.id "
                        "WHERE cv.case_id LIKE 'lpms:%' AND d.deleted_at IS NULL AND d.is_current = 1 GROUP BY cv.case_id").fetchall()
                    ids = {r[0] for r in c.execute(f"SELECT c.id FROM lpms_cases c WHERE {vis}", vp).fetchall()}
                    for r in rows:
                        try:
                            cid = int(r["ref"].split(":", 1)[1])
                        except Exception:
                            continue
                        if cid in ids:
                            out["case_docs"][str(cid)] = r["n"]
            return jsonify(out), 200
        except Exception as exc:
            log(f"vault overview failed: {exc}")
            return err("Could not load the vault overview.", 500)
        finally:
            c.close()

    # ── timeline from real records ──────────────────────────────────────────────────
    @bp.route("/timeline", methods=["GET", "OPTIONS"])
    @jwt_required()
    def timeline():
        if request.method == "OPTIONS":
            return jsonify({}), 200
        c = _connect(db_path)
        try:
            u = uid()
            deep = str(request.args.get("deep", "")).lower() in ("1", "true", "yes")
            only_case = request.args.get("case_id", type=int)
            events, cases = [], {}
            m = member(c, u)
            if m:
                from utils import lpms_store as L
                vis, vp = L.case_visible_sql(m, "c")
                extra = " AND c.id = :only" if only_case else ""
                p = {**vp, **({"only": only_case} if only_case else {})}
                for r in c.execute(f"SELECT c.id, c.case_no, c.title, c.court, c.filing_date, c.next_action, c.next_action_due, c.closed_at, c.status "
                                   f"FROM lpms_cases c WHERE {vis} AND c.archived_at IS NULL{extra}", p).fetchall():
                    cases[r["id"]] = dict(r)
                    src = f"Practice · {r['case_no']}"
                    if r["filing_date"]:
                        events.append({"date": r["filing_date"], "label": f"Case filed — {r['title']}", "source": src, "kind": "filing", "case_id": r["id"]})
                    if r["next_action"] and r["next_action_due"] and not r["closed_at"]:
                        events.append({"date": r["next_action_due"], "label": f"Action due — {r['next_action']}", "source": src, "kind": "deadline", "case_id": r["id"]})
                    if r["closed_at"]:
                        events.append({"date": str(r["closed_at"])[:10], "label": f"Case closed ({r['status']})", "source": src, "kind": "closed", "case_id": r["id"]})
                ids = ",".join(str(i) for i in cases) or "0"
                for r in c.execute(f"SELECT h.id, h.case_id, h.hearing_date, h.purpose, h.status, h.court FROM lpms_hearings h WHERE h.case_id IN ({ids})").fetchall():
                    cs = cases[r["case_id"]]
                    verb = {"scheduled": "Hearing listed", "heard": "Hearing held", "adjourned": "Hearing adjourned"}.get(r["status"], f"Hearing {r['status']}")
                    label = f"{verb} — {r['purpose']}" if r["purpose"] else verb
                    events.append({"date": r["hearing_date"], "label": label, "source": f"Practice · {cs['case_no']} · {r['court'] or cs['court']}", "kind": "hearing", "case_id": r["case_id"]})
                for r in c.execute(f"SELECT p.id, p.case_id, p.proc_date, p.outcome, p.orders, p.next_date FROM lpms_proceedings p WHERE p.case_id IN ({ids})").fetchall():
                    cs = cases[r["case_id"]]
                    what = (r["orders"] or r["outcome"] or "Proceedings recorded").strip().split("\n")[0][:160]
                    events.append({"date": r["proc_date"], "label": f"Proceedings — {what}", "source": f"Practice · {cs['case_no']} · daily proceedings", "kind": "proceeding", "case_id": r["case_id"]})
            if _has(c, "dms_docs"):
                cols = "cv.id, cv.case_id, COALESCE(cv.smart_title, cv.title) AS name, dd.doc_class, dd.doc_date, dd.next_hearing, dd.original_name"
                for r in visible_docs(c, u, cols):
                    ref = r["case_id"] or ""
                    cid = int(ref.split(":", 1)[1]) if ref.startswith("lpms:") and ref.split(":", 1)[1].isdigit() else None
                    if only_case and cid != only_case:
                        continue
                    if m and cid is not None and cid not in cases:
                        continue                            # a matter this user cannot see
                    fname = r["original_name"] or r["name"] or f"Document {r['id']}"
                    if r["doc_date"]:
                        events.append({"date": r["doc_date"], "label": f"{r['doc_class'] or 'Document'} dated", "source": fname, "kind": "document", "case_id": cid, "doc_id": r["id"]})
                    if r["next_hearing"]:
                        events.append({"date": r["next_hearing"], "label": "Next hearing noted in the document", "source": fname, "kind": "document", "case_id": cid, "doc_id": r["id"]})
                if deep:
                    scope_sql, scope_p = deps["scope"](u)
                    rows = c.execute(
                        "SELECT cv.id, cv.case_id, dd.original_name, COALESCE(cv.smart_title, cv.title) AS name, "
                        "(SELECT GROUP_CONCAT(text, ' ') FROM (SELECT text FROM dms_pages WHERE doc_id = cv.id ORDER BY page_no LIMIT 6)) AS body "
                        f"FROM case_vault cv JOIN dms_docs dd ON dd.doc_id = cv.id WHERE {scope_sql} AND dd.is_current = 1 LIMIT 60", scope_p).fetchall()
                    for r in rows:
                        ref = r["case_id"] or ""
                        cid = int(ref.split(":", 1)[1]) if ref.startswith("lpms:") and ref.split(":", 1)[1].isdigit() else None
                        if only_case and cid != only_case:
                            continue
                        if m and cid is not None and cid not in cases:
                            continue
                        for iso, kind, snip in dated_events_in(r["body"] or ""):
                            events.append({"date": iso, "label": f"{kind} — “…{snip}…”", "source": r["original_name"] or r["name"], "kind": "extracted",
                                           "case_id": cid, "doc_id": r["id"], "extracted": True})
            seen, out = set(), []
            for e in sorted(events, key=lambda e: (e["date"] or "", e["kind"])):
                if not e["date"]:
                    continue
                key = (e["date"], e["label"].split(" — ")[0], e.get("doc_id"), e.get("case_id"), e["source"])
                if key in seen:
                    continue
                seen.add(key)
                cs = cases.get(e.get("case_id"))
                e["case_title"] = cs["title"] if cs else None
                e["id"] = f"e{len(out)}"
                out.append(e)
            return jsonify({"events": out[:600], "deep": deep, "practice": bool(m)}), 200
        except Exception as exc:
            log(f"vault timeline failed: {exc}")
            return err("Could not build the timeline.", 500)
        finally:
            c.close()

    # ── document viewer ─────────────────────────────────────────────────────────────
    def allowed(user_id, doc_id, edit=False):
        return bool(deps["access"](user_id, doc_id, edit))

    def load_doc(c, doc_id):
        row = c.execute("SELECT id, case_id, title, smart_title, doc_type, content, folder_id, tags, file_format, user_id, created_at, "
                        "(file_blob IS NOT NULL AND LENGTH(file_blob) > 0) AS has_blob FROM case_vault WHERE id = ?", (doc_id,)).fetchone()
        if not row:
            return None, None
        hub = c.execute("SELECT * FROM dms_docs WHERE doc_id = ?", (doc_id,)).fetchone() if _has(c, "dms_docs") else None
        if hub is not None and hub["deleted_at"]:
            return None, None
        return row, hub

    def doc_ext(row, hub):
        ext = ((hub["ext"] if hub is not None else None) or row["file_format"] or "").lower().lstrip(".")
        if not ext and hub is not None and hub["original_name"] and "." in hub["original_name"]:
            ext = hub["original_name"].rsplit(".", 1)[-1].lower()
        return "docx" if ext == "native" else ext

    def doc_bytes(c, row, hub):
        if row["has_blob"]:
            _raw = c.execute("SELECT file_blob FROM case_vault WHERE id = ?", (row["id"],)).fetchone()[0]
            return doc_storage.resolve(_raw)
        if hub is None:
            return None
        from utils import dms_store
        with dms_store.open_plain(hub["store_key"], bool(hub["enc"])) as path:
            with open(path, "rb") as fh:
                return fh.read(MAX_BYTES + 1)

    def extracted_text(c, doc_id):
        rows = c.execute("SELECT page_no, text FROM dms_pages WHERE doc_id = ? ORDER BY page_no", (doc_id,)).fetchall() if _has(c, "dms_pages") else []
        return [(r["page_no"], r["text"]) for r in rows if (r["text"] or "").strip()]

    @bp.route("/documents/<int:doc_id>/view", methods=["GET", "OPTIONS"])
    @jwt_required()
    def view_file(doc_id):
        """The file itself, shown in the browser (never as a download)."""
        if request.method == "OPTIONS":
            return jsonify({}), 200
        u = uid()
        if not allowed(u, doc_id):
            return err("Document not found.", 404)
        c = _connect(db_path)
        try:
            row, hub = load_doc(c, doc_id)
            if not row:
                return err("Document not found.", 404)
            ext = doc_ext(row, hub)
            if ext not in INLINE_MIMES:
                return err("This file type cannot be previewed as-is; it opens as editable text instead.", 415)
            try:
                data = doc_bytes(c, row, hub)
            except Exception as exc:
                return err(str(exc), 410)
            if data is None:
                return err("No file is stored for this document.", 404)
            if len(data) > MAX_BYTES:
                return err("This file is too large to preview.", 413)
            resp = Response(data, mimetype=INLINE_MIMES[ext])
            resp.headers["Content-Disposition"] = "inline"
            resp.headers["X-Content-Type-Options"] = "nosniff"
            resp.headers["Cache-Control"] = "private, no-store"
            if ext != "pdf":
                resp.headers["Content-Security-Policy"] = "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'"
            return resp
        finally:
            c.close()

    @bp.route("/documents/<int:doc_id>/content", methods=["GET", "OPTIONS"])
    @jwt_required()
    def content(doc_id):
        """Editable HTML + plain text of a document, plus what the Document Hub knows about it."""
        if request.method == "OPTIONS":
            return jsonify({}), 200
        u = uid()
        if not allowed(u, doc_id):
            return err("Document not found.", 404)
        c = _connect(db_path)
        try:
            row, hub = load_doc(c, doc_id)
            if not row:
                return err("Document not found.", 404)
            ext = doc_ext(row, hub)
            html, source, note = "", "none", None
            try:
                if ext == "docx":
                    data = doc_bytes(c, row, hub)
                    html, source = (docx_to_html(data) if data else ""), "docx"
                elif ext == "pdf":
                    data = doc_bytes(c, row, hub)
                    html = pdf_to_html(data) if data else ""
                    source = "pdf" if html.strip() else "none"
                    if html.strip():
                        note = "Rebuilt from the PDF's text and layout so you can edit it. Your original PDF is never changed."
                elif ext in ("txt", "md", "text"):
                    data = doc_bytes(c, row, hub)
                    html, source = text_to_html((data or b"").decode("utf-8", "replace")), "text"
            except Exception as exc:
                log(f"vault content: could not read {ext} for {doc_id}: {exc}")
                note = "The file could not be read as a Word document; showing its extracted text instead."
            if not html.strip():
                pages = extracted_text(c, doc_id)
                if pages:
                    html = "".join(text_to_html(t) if len(pages) == 1 else f"<h3>Page {n}</h3>{text_to_html(t)}" for n, t in pages)
                    source = "extracted"
            if not html.strip() and (row["content"] or "").strip():
                html, source = text_to_html(row["content"]), "saved"
            if not html.strip() and not note:
                note = "No readable text is available for this file yet. If it was just uploaded, the Document Hub may still be reading it."
            info = {}
            if hub is not None:
                info = {k: hub[k] for k in ("doc_class", "doc_date", "next_hearing", "court", "parties", "status", "page_count") if k in hub.keys()}
            case_ref, case = row["case_id"], None
            if case_ref and str(case_ref).startswith("lpms:"):
                m = member(c, u)
                cid = str(case_ref).split(":", 1)[1]
                if m and cid.isdigit():
                    from utils import lpms_store as L
                    vis, vp = L.case_visible_sql(m, "c")
                    r = c.execute(f"SELECT c.id, c.case_no, c.title, c.court FROM lpms_cases c WHERE c.id = :id AND {vis}", {**vp, "id": int(cid)}).fetchone()
                    case = dict(r) if r else None
            title = row["smart_title"] or row["title"] or f"Document {doc_id}"
            return jsonify({
                "id": doc_id, "title": title, "ext": ext, "html": html, "text": html_to_text(html), "source": source, "note": note,
                "previewable": ext in INLINE_MIMES, "has_original": bool(row["has_blob"] or hub is not None), "info": info, "case": case,
                "can_edit": allowed(u, doc_id, True),
                "edited_copy": ((row["tags"] or "") == "EDITED" and row["user_id"] == u),
            }), 200
        finally:
            c.close()

    def resync_hub(c, doc_id, data, ext="docx", fname=None):
        """The edited copy was rewritten in place: give the Document Hub the new bytes and have it read them again,
        so its preview and search never show the old text. Best effort - the vault copy above is already correct."""
        try:
            if not _has(c, "dms_docs"):
                return
            h = c.execute("SELECT original_name FROM dms_docs WHERE doc_id = ?", (doc_id,)).fetchone()
            if not h:
                return
            from utils import dms_store as S
            from utils import dms_worker as W

            class _FS:
                def __init__(self, name, payload):
                    self.filename, self.stream = name, io.BytesIO(payload)

            tmp, sha, size = S.spool_upload(_FS(fname or h["original_name"] or f"document_{doc_id}.{ext}", data), 200 * 1024 * 1024)
            try:
                key, enc = S.commit(tmp, sha)
            finally:
                try:
                    import os
                    os.remove(tmp)
                except OSError:
                    pass
            c.execute("UPDATE dms_docs SET sha256 = ?, store_key = ?, enc = ?, size = ?, ext = ?, original_name = COALESCE(?, original_name), updated_at = CURRENT_TIMESTAMP WHERE doc_id = ?",
                      (sha, key, int(enc), size, ext, fname, doc_id))
            W.enqueue(c, doc_id, commit=False)
            c.commit()
        except Exception as exc:
            log(f"vault save-edit: could not refresh the Document Hub copy of {doc_id}: {exc}")

    @bp.route("/documents/<int:doc_id>/save-edit", methods=["POST", "OPTIONS"])
    @jwt_required()
    def save_edit(doc_id):
        """Saves the edited text as a DOCX in the vault. The original file is never touched: the first save makes
        '<name> (edited)'; later saves from the same editor (target_id) update that copy."""
        if request.method == "OPTIONS":
            return jsonify({}), 200
        u = uid()
        body = request.get_json(silent=True) or {}
        html = body.get("html")
        if not isinstance(html, str) or not html.strip() or len(html) > 3_000_000:
            return err("There is nothing to save.", 400)
        if not allowed(u, doc_id):
            return err("Document not found.", 404)
        c = _connect(db_path)
        try:
            row, hub = load_doc(c, doc_id)
            if not row:
                return err("Document not found.", 404)
            folder = row["folder_id"]
            if folder is not None and not deps["folder_ok"](folder, u):
                return err("You can view this document but not add copies to its folder.", 403)
            text = html_to_text(html)
            blob = html_to_docx(html, row["smart_title"] or row["title"])
            blob = doc_storage.store(blob, 'docx')  # durable when DOC_STORAGE=disk; unchanged on sqlite
            target = body.get("target_id")
            if target:
                t = c.execute("SELECT id, user_id, tags FROM case_vault WHERE id = ?", (int(target),)).fetchone()
                if not t or t["user_id"] != u or (t["tags"] or "") != "EDITED":
                    return err("That edited copy was not found.", 404)
                c.execute("UPDATE case_vault SET content = ?, file_blob = ?, file_format = 'docx' WHERE id = ?", (text, blob, t["id"]))
                c.commit()
                resync_hub(c, t["id"], blob)
                new_id, action = t["id"], "renamed"
                name = c.execute("SELECT COALESCE(smart_title, title) FROM case_vault WHERE id = ?", (t["id"],)).fetchone()[0]
                created = False
            else:
                base = (row["smart_title"] or row["title"] or f"Document {doc_id}")
                base = re.sub(r"\.(pdf|docx?|txt|png|jpe?g)$", "", base, flags=re.I)
                name = (str(body.get("title")).strip()[:150] if body.get("title") else f"{base} (edited)")
                cur = c.execute(
                    "INSERT INTO case_vault (case_id, title, doc_type, content, folder_id, smart_title, tags, file_blob, file_format, user_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (row["case_id"] or "General", name + ".docx", "edited", text, folder, name, "EDITED", blob, "docx", u))
                c.commit()
                new_id, created, action = cur.lastrowid, True, "created"
            try:
                deps["provenance"]("document", new_id, name, "created" if created else "renamed", u, u,
                                   {"edited_from": doc_id, "size_bytes": len(blob)} if created else {"old_name": name, "new_name": name, "revised": True})
            except Exception as exc:
                log(f"vault save-edit: provenance skipped: {exc}")
            try:
                deps["adopt"](u, new_id)
            except Exception as exc:
                log(f"vault save-edit: hub adopt skipped: {exc}")
            return jsonify({"success": True, "id": new_id, "title": name, "created": created}), 201 if created else 200
        except Exception as exc:
            log(f"vault save-edit failed: {exc}")
            return err("Could not save the edited document.", 500)
        finally:
            c.close()

    @bp.route("/documents/<int:doc_id>/export-docx", methods=["POST", "OPTIONS"])
    @jwt_required()
    def export_docx(doc_id):
        if request.method == "OPTIONS":
            return jsonify({}), 200
        u = uid()
        if not allowed(u, doc_id):
            return err("Document not found.", 404)
        body = request.get_json(silent=True) or {}
        html = body.get("html") or ""
        if not html.strip() or len(html) > 3_000_000:
            return err("There is nothing to export.", 400)
        name = re.sub(r"[^A-Za-z0-9 _.-]+", "", str(body.get("title") or f"document_{doc_id}"))[:100].strip() or f"document_{doc_id}"
        data = html_to_docx(html, name)
        resp = Response(data, mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        resp.headers["Content-Disposition"] = f'attachment; filename="{name}.docx"'
        resp.headers["X-Content-Type-Options"] = "nosniff"
        return resp

    # ── export + save-as (Word / PDF / text; this computer, Case Vault, Document Hub, Practice, Firm Library) ──
    def clean_html(body):
        html = body.get("html")
        if not isinstance(html, str) or not html.strip() or len(html) > 6_000_000:
            return None
        return html

    @bp.route("/documents/<int:doc_id>/export", methods=["POST", "OPTIONS"])
    @jwt_required()
    def export_any(doc_id):
        """Renders the editor's current content as .docx / .pdf / .txt and returns it for the browser to save anywhere."""
        if request.method == "OPTIONS":
            return jsonify({}), 200
        u = uid()
        if not allowed(u, doc_id):
            return err("Document not found.", 404)
        body = request.get_json(silent=True) or {}
        html, fmt = clean_html(body), str(body.get("format") or "docx").lower()
        if html is None:
            return err("There is nothing to export.", 400)
        if fmt not in FORMATS:
            return err("Choose Word, PDF or text.", 400)
        name = safe_name(body.get("title"), f"document_{doc_id}")
        try:
            data = render_format(fmt, html, name)
        except Exception as exc:
            log(f"vault export {fmt} failed: {exc}")
            return err(f"Could not create the {FORMATS[fmt][1]} file.", 500)
        resp = Response(data, mimetype=FORMATS[fmt][0])
        resp.headers["Content-Disposition"] = f'attachment; filename="{name}.{fmt}"'
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["Cache-Control"] = "private, no-store"
        return resp

    @bp.route("/destinations", methods=["GET", "OPTIONS"])
    @jwt_required()
    def destinations():
        """Where this user may save a document inside LexAmplify: vault folders, Practice matters, the Firm Library."""
        if request.method == "OPTIONS":
            return jsonify({}), 200
        u = uid()
        c = _connect(db_path)
        try:
            rows = c.execute("SELECT id, name, parent_id, user_id FROM vault_folders WHERE user_id = ? OR user_id IS NULL "
                             "ORDER BY name COLLATE NOCASE LIMIT 1500", (u,)).fetchall()
            by_id = {r["id"]: r for r in rows}
            folders = []
            for r in rows:
                if r["user_id"] is None and not deps["folder_ok"](r["id"], u):
                    continue
                path, cur, guard = [], r, 0
                while cur is not None and guard < 12:
                    path.append(cur["name"])
                    cur = by_id.get(cur["parent_id"])
                    guard += 1
                folders.append({"id": r["id"], "name": r["name"], "parent_id": r["parent_id"], "path": " / ".join(reversed(path))})
            folders.sort(key=lambda f: f["path"].lower())
            practice = {"enabled": False, "cases": []}
            m = member(c, u)
            if m:
                from utils import lpms_store as L
                vis, vp = L.case_visible_sql(m, "c")
                cases = c.execute(f"SELECT c.id, c.case_no, c.title, c.court, c.closed_at FROM lpms_cases c WHERE {vis} AND c.archived_at IS NULL "
                                  "ORDER BY (c.closed_at IS NOT NULL), c.title COLLATE NOCASE LIMIT 300", vp).fetchall()
                practice = {"enabled": True, "firm": m["firm_name"], "cases": [
                    {"id": r["id"], "case_no": r["case_no"], "title": r["title"], "court": r["court"], "closed": bool(r["closed_at"])} for r in cases]}
            return jsonify({"folders": folders, "practice": practice, "library": {"enabled": True, "categories": ["Draft", "Pleading", "Notice", "Agreement", "Precedent", "Order"]},
                            "formats": [{"id": k, "label": v[1]} for k, v in FORMATS.items()]}), 200
        finally:
            c.close()

    @bp.route("/documents/<int:doc_id>/save-as", methods=["POST", "OPTIONS"])
    @jwt_required()
    def save_as(doc_id):
        """Saves the editor's content as a NEW document (or updates the copy this editor already made) in the chosen
        destination. The original file is never touched."""
        if request.method == "OPTIONS":
            return jsonify({}), 200
        u = uid()
        body = request.get_json(silent=True) or {}
        html, fmt = clean_html(body), str(body.get("format") or "docx").lower()
        dest = str(body.get("destination") or "vault").lower()
        if html is None:
            return err("There is nothing to save.", 400)
        if fmt not in FORMATS:
            return err("Choose Word, PDF or text.", 400)
        if dest not in ("vault", "hub", "practice", "library"):
            return err("Choose where to save it.", 400)
        if not allowed(u, doc_id):
            return err("Document not found.", 404)
        c = _connect(db_path)
        try:
            row, hub = load_doc(c, doc_id)
            if not row:
                return err("Document not found.", 404)
            base = safe_name(body.get("title") or f"{row['smart_title'] or row['title'] or 'Document ' + str(doc_id)} (edited)")
            fname = f"{base}.{fmt}"
            folder, case_ref, practice_case, location = None, row["case_id"] or "General", None, "Case Vault"
            if dest in ("vault", "hub"):
                fid = body.get("folder_id")
                if fid not in (None, "", 0):
                    try:
                        fid = int(fid)
                    except (TypeError, ValueError):
                        return err("That folder was not found.", 404)
                    if not deps["folder_ok"](fid, u):
                        return err("You cannot save into that folder.", 403)
                    folder = fid
                    nm = c.execute("SELECT name FROM vault_folders WHERE id = ?", (fid,)).fetchone()
                    location = ("Document Hub" if dest == "hub" else "Case Vault") + (f" / {nm[0]}" if nm else "")
                else:
                    location = "Document Hub" if dest == "hub" else "Case Vault"
            elif dest == "practice":
                try:
                    practice_case = int(body.get("practice_case_id"))
                except (TypeError, ValueError):
                    return err("Choose a Practice matter.", 400)
                from utils import lpms_store as L
                if not _has(c, "lpms_cases") or L.lpms_case_role(c, u, practice_case) is None:
                    return err("That matter was not found, or you are not on it.", 404)
                cr = c.execute("SELECT case_no, title FROM lpms_cases WHERE id = ?", (practice_case,)).fetchone()
                case_ref, location = f"lpms:{practice_case}", f"Practice / {cr['title'] or cr['case_no']}"
            else:
                case_ref, location = f"draft_{int(datetime.utcnow().timestamp())}_{__import__('uuid').uuid4().hex[:6]}", "Firm Library"
            try:
                blob = render_format(fmt, html, base)
                blob = doc_storage.store(blob, fmt)  # durable when DOC_STORAGE=disk; unchanged on sqlite
            except Exception as exc:
                log(f"vault save-as: render {fmt} failed: {exc}")
                return err(f"Could not create the {FORMATS[fmt][1]} file.", 500)
            text = html_to_text(html)
            target = body.get("target_id")
            created = True
            if target:
                try:
                    t = c.execute("SELECT id, user_id, tags, case_id, folder_id FROM case_vault WHERE id = ?", (int(target),)).fetchone()
                except (TypeError, ValueError):
                    t = None
                same_place = t and (t["case_id"] == case_ref or dest in ("vault", "hub")) and (dest not in ("vault", "hub") or t["folder_id"] == folder)
                if t and t["user_id"] == u and (t["tags"] or "") == "EDITED" and same_place:
                    c.execute("UPDATE case_vault SET title = ?, smart_title = ?, content = ?, file_blob = ?, file_format = ? WHERE id = ?",
                              (fname, base, text, blob, fmt, t["id"]))
                    c.commit()
                    resync_hub(c, t["id"], blob, fmt, fname)
                    new_id, created = t["id"], False
            if created:
                if dest == "library":
                    cur = c.execute("INSERT INTO case_vault (case_id, title, doc_type, content, smart_title, file_blob, file_format, user_id) VALUES (?,?,?,?,?,?,?,?)",
                                    (case_ref, base, f"Firm Library Draft — {str(body.get('category') or 'Draft')[:40]}", html, base, blob, fmt, u))
                else:
                    cur = c.execute(
                        "INSERT INTO case_vault (case_id, title, doc_type, content, folder_id, smart_title, tags, file_blob, file_format, user_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
                        (case_ref, fname, "edited", text, folder, base, "EDITED", blob, fmt, u))
                c.commit()
                new_id = cur.lastrowid
            try:
                deps["provenance"]("document", new_id, base, "created" if created else "renamed", u, u,
                                   {"edited_from": doc_id, "size_bytes": len(blob), "format": fmt, "destination": location} if created
                                   else {"old_name": base, "new_name": base, "revised": True})
            except Exception as exc:
                log(f"vault save-as: provenance skipped: {exc}")
            if dest != "library":
                try:
                    deps["adopt"](u, new_id)
                except Exception as exc:
                    log(f"vault save-as: hub adopt skipped: {exc}")
            else:
                # Never cold-load the embedding model (torch) inside a web request: on a small server that alone
                # exceeds the RAM budget and kills the instance. Index only when the model is already warm, in the
                # background; otherwise the draft is still saved and is found by keyword search.
                try:
                    import threading
                    from utils import local_search as _ls
                    if getattr(_ls, "_collection", None) is not None and getattr(_ls, "_embedder", None) is not None:
                        threading.Thread(target=_ls.index_document, args=(new_id, base, html), daemon=True).start()
                except Exception as exc:
                    log(f"vault save-as: library index skipped: {exc}")
            if dest == "practice" and created and deps.get("practice_event"):
                try:
                    deps["practice_event"](practice_case, new_id, base, u)
                except Exception as exc:
                    log(f"vault save-as: practice timeline skipped: {exc}")
            return jsonify({"success": True, "id": new_id, "title": base, "filename": fname, "format": fmt, "destination": dest,
                            "location": location, "created": created, "size": len(blob)}), 201 if created else 200
        except Exception as exc:
            log(f"vault save-as failed: {exc}")
            return err("Could not save the document.", 500)
        finally:
            c.close()

    # ── a draft written in the AI Legal Associate, filed into the practice ──────────────
    # The assistant's drafts live only in the conversation until the advocate files them. This
    # puts one finished draft wherever it belongs — Case Vault, Document Hub, Practice matter or
    # Firm Library — in one call, so the generated document is connected to the rest of LexAmplify
    # instead of being a dead end in a chat window.
    @bp.route("/documents/draft-save", methods=["POST", "OPTIONS"])
    @jwt_required()
    def draft_save():
        if request.method == "OPTIONS":
            return jsonify({}), 200
        u = uid()
        body = request.get_json(silent=True) or {}
        html = clean_html(body)
        fmt = str(body.get("format") or "docx").lower()
        dest = str(body.get("destination") or "vault").lower()
        if html is None:
            return err("There is nothing to save yet.", 400)
        if fmt not in FORMATS:
            return err("Choose Word, PDF or text.", 400)
        if dest not in ("vault", "hub", "practice", "library"):
            return err("Choose where to save it.", 400)
        base = safe_name(body.get("title") or "Legal draft")
        fname = f"{base}.{fmt}"
        c = _connect(db_path)
        try:
            folder, case_ref, practice_case, location = None, "General", None, "Case Vault"
            if dest in ("vault", "hub"):
                fid = body.get("folder_id")
                if fid not in (None, "", 0):
                    try:
                        fid = int(fid)
                    except (TypeError, ValueError):
                        return err("That folder was not found.", 404)
                    if not deps["folder_ok"](fid, u):
                        return err("You cannot save into that folder.", 403)
                    folder = fid
                    nm = c.execute("SELECT name FROM vault_folders WHERE id = ?", (fid,)).fetchone()
                    location = ("Document Hub" if dest == "hub" else "Case Vault") + (f" / {nm[0]}" if nm else "")
                else:
                    location = "Document Hub" if dest == "hub" else "Case Vault"
            elif dest == "practice":
                try:
                    practice_case = int(body.get("practice_case_id"))
                except (TypeError, ValueError):
                    return err("Choose a Practice matter.", 400)
                from utils import lpms_store as L
                if not _has(c, "lpms_cases") or L.lpms_case_role(c, u, practice_case) is None:
                    return err("That matter was not found, or you are not on it.", 404)
                cr = c.execute("SELECT case_no, title FROM lpms_cases WHERE id = ?", (practice_case,)).fetchone()
                case_ref, location = f"lpms:{practice_case}", f"Practice / {cr['title'] or cr['case_no']}"
            else:
                case_ref, location = f"draft_{int(datetime.utcnow().timestamp())}_{__import__('uuid').uuid4().hex[:6]}", "Firm Library"
            try:
                blob = render_format(fmt, html, base)
                blob = doc_storage.store(blob, fmt)  # durable when DOC_STORAGE=disk; unchanged on sqlite
            except Exception as exc:
                log(f"draft-save: render {fmt} failed: {exc}")
                return err(f"Could not create the {FORMATS[fmt][1]} file.", 500)
            text = html_to_text(html)
            if dest == "library":
                cur = c.execute("INSERT INTO case_vault (case_id, title, doc_type, content, smart_title, file_blob, file_format, user_id) VALUES (?,?,?,?,?,?,?,?)",
                                (case_ref, base, f"Firm Library Draft — {str(body.get('category') or 'Draft')[:40]}", html, base, blob, fmt, u))
            else:
                cur = c.execute(
                    "INSERT INTO case_vault (case_id, title, doc_type, content, folder_id, smart_title, tags, file_blob, file_format, user_id) VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (case_ref, fname, "AI draft", text, folder, base, "EDITED", blob, fmt, u))
            c.commit()
            new_id = cur.lastrowid
            try:
                deps["provenance"]("document", new_id, base, "created", u, u,
                                   {"source": "ai_legal_associate", "size_bytes": len(blob), "format": fmt, "destination": location})
            except Exception as exc:
                log(f"draft-save: provenance skipped: {exc}")
            if dest != "library":
                try:
                    deps["adopt"](u, new_id)
                except Exception as exc:
                    log(f"draft-save: hub adopt skipped: {exc}")
            else:
                # Never cold-load the embedding model inside a web request — index only when it is already warm.
                try:
                    import threading
                    from utils import local_search as _ls
                    if getattr(_ls, "_collection", None) is not None and getattr(_ls, "_embedder", None) is not None:
                        threading.Thread(target=_ls.index_document, args=(new_id, base, html), daemon=True).start()
                except Exception as exc:
                    log(f"draft-save: library index skipped: {exc}")
            if dest == "practice" and deps.get("practice_event"):
                try:
                    deps["practice_event"](practice_case, new_id, base, u)
                except Exception as exc:
                    log(f"draft-save: practice timeline skipped: {exc}")
            return jsonify({"success": True, "id": new_id, "title": base, "filename": fname, "format": fmt,
                            "destination": dest, "location": location, "size": len(blob)}), 201
        except Exception as exc:
            log(f"draft-save failed: {exc}")
            return err("Could not save the draft.", 500)
        finally:
            c.close()

    # ── per-document AI assistant ───────────────────────────────────────────────────
    ASSIST_SYSTEM = (
        "You are the document assistant inside an Indian advocate's case vault. You are given ONE document (and sometimes the "
        "advocate's current selection). Answer only from that document and well-settled Indian law. Quote short phrases from the "
        "document when you rely on them. If the document does not say something, say so plainly - never invent facts, dates, "
        "case numbers or citations. Keep answers short, practical and in plain English (or the language the advocate writes in). "
        "When asked to draft or rewrite, return the draft text only, ready to paste into the editor."
    )

    def fallback_answer(question, text, info, dates):
        q = (question or "").lower()
        bits = []
        if "date" in q or "deadline" in q or "hearing" in q or "timeline" in q:
            if dates:
                bits.append("Dates I can see in this document:\n" + "\n".join(f"• {iso} — {kind}" for iso, kind, _ in dates))
            else:
                bits.append("I could not find any dated events in this document's text.")
        else:
            head = re.sub(r"\s+", " ", text or "").strip()[:700]
            facts = [f"{k.replace('_', ' ').title()}: {v}" for k, v in (info or {}).items() if v and k in ("doc_class", "court", "doc_date", "next_hearing", "parties")]
            bits.append(("Summary of what is on file:\n" + "\n".join(facts) + "\n\n" if facts else "") + (f"Opening text: {head}…" if head else "There is no readable text in this document yet."))
        bits.append("(The AI service is not reachable right now, so this is a plain read-out of the document, not an AI analysis. Try again in a moment.)")
        return "\n\n".join(bits)

    @bp.route("/documents/<int:doc_id>/assistant", methods=["POST", "OPTIONS"])
    @jwt_required()
    def assistant(doc_id):
        if request.method == "OPTIONS":
            return jsonify({}), 200
        u = uid()
        if not allowed(u, doc_id):
            return err("Document not found.", 404)
        b = request.get_json(silent=True) or {}
        question = str(b.get("message") or "").strip()
        if not question:
            return err("Ask a question or pick an action.", 400)
        if len(question) > 4000:
            return err("That question is too long.", 400)
        c = _connect(db_path)
        try:
            row, hub = load_doc(c, doc_id)
            if not row:
                return err("Document not found.", 404)
            text = str(b.get("document_text") or "")[:60000]
            if not text.strip():
                pages = extracted_text(c, doc_id)
                text = "\n\n".join(t for _, t in pages)
            if not text.strip():
                text = row["content"] or ""
            info = {}
            if hub is not None:
                info = {k: hub[k] for k in ("doc_class", "doc_date", "next_hearing", "court", "parties") if k in hub.keys()}
        finally:
            c.close()
        dates = dated_events_in(text, limit=12)
        selection = str(b.get("selection") or "").strip()[:4000]
        history = [h for h in (b.get("history") or []) if isinstance(h, dict) and h.get("role") in ("user", "assistant") and isinstance(h.get("content"), str)][-6:]
        ctx = text[:14000] + ("\n[… document continues …]" if len(text) > 14000 else "")
        prompt = (
            f"DOCUMENT TITLE: {row['smart_title'] or row['title']}\n"
            + (f"HUB FACTS: {json.dumps({k: v for k, v in info.items() if v}, default=str)}\n" if info else "")
            + f"\nDOCUMENT TEXT:\n{ctx or '(no readable text)'}\n"
            + (f"\nADVOCATE'S SELECTION:\n{selection}\n" if selection else "")
            + ("\nEARLIER IN THIS CHAT:\n" + "\n".join(f"{h['role'].upper()}: {h['content'][:1500]}" for h in history) + "\n" if history else "")
            + f"\nADVOCATE ASKS: {question}"
        )
        try:
            from utils.ai_helper import ask_groq
            answer = (ask_groq(ASSIST_SYSTEM, prompt) or "").strip()
            if not answer:
                raise ValueError("empty answer")
            return jsonify({"answer": answer, "ai": True}), 200
        except Exception as exc:
            log(f"vault assistant fell back: {exc}")
            return jsonify({"answer": fallback_answer(question, text, info, dates), "ai": False}), 200

    # ── Vault Sharing API (moved verbatim from app.py's create_app(), step 3c) ──────────────
    # Paths are relative to this blueprint's /api/vault prefix: "/shares" is /api/vault/shares,
    # "/shares/<id>" is /api/vault/shares/<id>. Owner-only management is unchanged
    # (app.py's _vault_owner_ok, not _vault_access_ok, guards every route here).

    @bp.route("/shares", methods=['GET', 'OPTIONS'])
    @jwt_required()
    def list_vault_shares():
        """Returns a node's OWN explicit shares only (never ones it merely
        inherits by cascade from an ancestor folder) — this is what the
        Share modal's people list and the vault grid's share badge both
        render, so cascaded access stays invisible/implicit exactly like a
        parent folder's other properties would."""
        import app as app_module
        if request.method == 'OPTIONS':
            return jsonify({}), 200
        uid = app_module._current_vault_user_id()
        try:
            node_type = request.args.get('node_type')
            node_id = request.args.get('node_id', type=int)
            if node_type not in ('folder', 'document') or node_id is None:
                return jsonify({'error': True, 'message': 'node_type and node_id are required.'}), 400

            row_owner = app_module._fetch_vault_node_owner(node_type, node_id)
            if row_owner is None and app_module.db.execute(
                f"SELECT 1 FROM {'vault_folders' if node_type == 'folder' else 'case_vault'} WHERE id = ?", (node_id,)
            ).fetchone() is None:
                return jsonify({'error': True, 'message': 'Not found.'}), 404
            if not app_module._vault_owner_ok(row_owner, uid):
                return jsonify({'error': True, 'message': 'Only the owner can view sharing for this item.'}), 403

            conn = app_module.db
            old_rf = conn.row_factory
            conn.row_factory = sqlite3.Row
            try:
                rows = conn.execute(
                    'SELECT id, team_member_id, permission, created_at FROM document_vault_shares '
                    'WHERE node_type = ? AND node_id = ? ORDER BY created_at ASC',
                    (node_type, node_id)
                ).fetchall()
                shares = [dict(r) for r in rows]
            finally:
                conn.row_factory = old_rf

            # Enrich with the roster's name/email/resolved-user_id so the
            # modal doesn't need a second round trip per row.
            if shares:
                team_conn = sqlite3.connect(app_module.DB_PATH)
                team_conn.row_factory = sqlite3.Row
                try:
                    app_module._resolve_team_member_user_ids(team_conn)
                    ids = [s['team_member_id'] for s in shares]
                    ph = ','.join('?' for _ in ids)
                    members = {
                        r['id']: dict(r) for r in team_conn.execute(
                            f'SELECT id, name, email, role, user_id FROM team_members WHERE id IN ({ph})', ids
                        ).fetchall()
                    }
                finally:
                    team_conn.close()
                for s in shares:
                    m = members.get(s['team_member_id'], {})
                    s['member_name'] = m.get('name')
                    s['member_email'] = m.get('email')
                    s['member_matched'] = m.get('user_id') is not None

            link_shared = False
            table = 'vault_folders' if node_type == 'folder' else 'case_vault'
            ls_row = app_module.db.execute(f'SELECT link_shared FROM {table} WHERE id = ?', (node_id,)).fetchone()
            if ls_row:
                link_shared = bool(ls_row[0])

            return jsonify({'shares': shares, 'link_shared': link_shared}), 200
        except Exception as e:
            return jsonify({'error': True, 'message': str(e)}), 500

    @bp.route("/shares", methods=['POST', 'OPTIONS'])
    @jwt_required()
    def create_vault_share():
        import app as app_module
        if request.method == 'OPTIONS':
            return jsonify({}), 200
        uid = app_module._current_vault_user_id()
        try:
            data = request.get_json(force=True, silent=True) or {}
            node_type = data.get('node_type')
            node_id = data.get('node_id')
            team_member_id = data.get('team_member_id')
            permission = data.get('permission', 'view')
            if node_type not in ('folder', 'document') or not node_id or not team_member_id:
                return jsonify({'error': True, 'message': 'node_type, node_id and team_member_id are required.'}), 400
            if permission not in ('view', 'edit'):
                return jsonify({'error': True, 'message': 'permission must be "view" or "edit".'}), 400

            row_owner = app_module._fetch_vault_node_owner(node_type, node_id)
            if row_owner is None and app_module.db.execute(
                f"SELECT 1 FROM {'vault_folders' if node_type == 'folder' else 'case_vault'} WHERE id = ?", (node_id,)
            ).fetchone() is None:
                return jsonify({'error': True, 'message': 'Not found.'}), 404
            if not app_module._vault_owner_ok(row_owner, uid):
                return jsonify({'error': True, 'message': 'Only the owner can share this item.'}), 403

            team_conn = sqlite3.connect(app_module.DB_PATH)
            try:
                # Only people on the sharer's OWN roster can be shared with. Without this, any signed-in user could
                # probe other advocates' rosters (names and e-mails) by trying member ids.
                from utils import tenancy
                tenancy.prepare(team_conn, "team", ("team_members",), uid)
                member_row = team_conn.execute('SELECT id, name, email FROM team_members WHERE id = ? AND owner_user_id = ?', (team_member_id, uid)).fetchone()
            finally:
                team_conn.close()
            if not member_row:
                return jsonify({'error': True, 'message': 'Team member not found.'}), 404

            app_module.db.execute(
                'INSERT INTO document_vault_shares (node_type, node_id, team_member_id, permission) VALUES (?, ?, ?, ?) '
                'ON CONFLICT(node_type, node_id, team_member_id) DO UPDATE SET permission = excluded.permission',
                (node_type, node_id, team_member_id, permission)
            )
            app_module.db.commit()
            share_id = app_module.db.execute(
                'SELECT id FROM document_vault_shares WHERE node_type = ? AND node_id = ? AND team_member_id = ?',
                (node_type, node_id, team_member_id)
            ).fetchone()[0]
            app_module._write_provenance(
                node_type, node_id, app_module._fetch_vault_node_name(node_type, node_id), 'shared', uid, uid,
                {
                    'team_member_id': team_member_id, 'permission': permission,
                    'member_name': member_row[1], 'member_email': member_row[2],
                }
            )
            return jsonify({'success': True, 'id': share_id, 'permission': permission}), 201
        except Exception as e:
            return jsonify({'error': True, 'message': str(e)}), 500

    @bp.route("/shares/<int:share_id>", methods=['DELETE', 'OPTIONS'])
    @jwt_required()
    def delete_vault_share(share_id):
        import app as app_module
        if request.method == 'OPTIONS':
            return jsonify({}), 200
        uid = app_module._current_vault_user_id()
        try:
            share_row = app_module.db.execute(
                'SELECT node_type, node_id, team_member_id FROM document_vault_shares WHERE id = ?', (share_id,)
            ).fetchone()
            if not share_row:
                return jsonify({'error': True, 'message': 'Share not found.'}), 404
            node_type, node_id, team_member_id = share_row
            row_owner = app_module._fetch_vault_node_owner(node_type, node_id)
            if not app_module._vault_owner_ok(row_owner, uid):
                return jsonify({'error': True, 'message': 'Only the owner can revoke this share.'}), 403
            member_row = None
            team_conn = sqlite3.connect(app_module.DB_PATH)
            try:
                member_row = team_conn.execute('SELECT name, email FROM team_members WHERE id = ?', (team_member_id,)).fetchone()
            finally:
                team_conn.close()
            app_module.db.execute('DELETE FROM document_vault_shares WHERE id = ?', (share_id,))
            app_module.db.commit()
            app_module._write_provenance(
                node_type, node_id, app_module._fetch_vault_node_name(node_type, node_id), 'unshared', uid, uid,
                {
                    'team_member_id': team_member_id,
                    'member_name': member_row[0] if member_row else None,
                    'member_email': member_row[1] if member_row else None,
                }
            )
            return jsonify({'success': True, 'deleted_id': share_id}), 200
        except Exception as e:
            return jsonify({'error': True, 'message': str(e)}), 500

    @bp.route("/shares/link", methods=['PATCH', 'OPTIONS'])
    @jwt_required()
    def toggle_vault_link_share():
        """Owner-only toggle for the node's "Anyone with the link" flag —
        distinct from (and independent of) the per-person shares above."""
        import app as app_module
        if request.method == 'OPTIONS':
            return jsonify({}), 200
        uid = app_module._current_vault_user_id()
        try:
            data = request.get_json(force=True, silent=True) or {}
            node_type = data.get('node_type')
            node_id = data.get('node_id')
            link_shared = bool(data.get('link_shared'))
            if node_type not in ('folder', 'document') or not node_id:
                return jsonify({'error': True, 'message': 'node_type and node_id are required.'}), 400

            table = 'vault_folders' if node_type == 'folder' else 'case_vault'
            row_owner = app_module._fetch_vault_node_owner(node_type, node_id)
            if row_owner is None and app_module.db.execute(f'SELECT 1 FROM {table} WHERE id = ?', (node_id,)).fetchone() is None:
                return jsonify({'error': True, 'message': 'Not found.'}), 404
            if not app_module._vault_owner_ok(row_owner, uid):
                return jsonify({'error': True, 'message': 'Only the owner can change link sharing.'}), 403

            app_module.db.execute(f'UPDATE {table} SET link_shared = ? WHERE id = ?', (1 if link_shared else 0, node_id))
            app_module.db.commit()
            app_module._write_provenance(
                node_type, node_id, app_module._fetch_vault_node_name(node_type, node_id),
                'link_shared' if link_shared else 'link_unshared', uid, uid, {}
            )
            return jsonify({'success': True, 'link_shared': link_shared}), 200
        except Exception as e:
            return jsonify({'error': True, 'message': str(e)}), 500


    # ── Vault Provenance + Citations (moved verbatim from app.py's create_app(), step 3c) ──
    # Paths are relative to this blueprint's /api/vault prefix.

    @bp.route("/provenance", methods=["GET", "OPTIONS"])
    @jwt_required()
    def get_vault_provenance():
        """The real Provenance Trail feed — merges vault_provenance (every
        folder/document mutation, hash-chained) with vault_audit (the
        pre-existing, narrower "AI conversation behind one saved document"
        log) into one chronological list, replacing the old client-only
        mock (INITIAL_PROVENANCE/generateQuickHash()) entirely.

        Scoped by owner_user_id/actor_user_id rather than trying to
        re-check current access on possibly-deleted nodes: a user sees an
        entry if they own (or owned, at write time) the node, it was
        legacy/shared-to-everyone, or they personally performed the action
        — the same "owned or legacy" convention used everywhere else in
        this vault, just captured as a snapshot since a deleted node has no
        current owner to re-check against.

        node_type+node_id optionally filters to one item's own history
        (folder/document detail view); otherwise this is the vault-wide
        feed, mirroring vault_audit_trail's own optional folder_id filter."""
        import app as app_module
        if request.method == 'OPTIONS':
            return jsonify({}), 200
        uid = app_module._current_vault_user_id()
        try:
            node_type = request.args.get('node_type')
            node_id = request.args.get('node_id', type=int)
            try:
                limit = max(1, min(int(request.args.get('limit', 100)), 300))
            except (TypeError, ValueError):
                limit = 100

            conn = app_module.db
            old_rf = conn.row_factory
            conn.row_factory = sqlite3.Row
            try:
                where = ['(owner_user_id = ? OR owner_user_id IS NULL OR actor_user_id = ?)']
                params = [uid, uid]
                if node_type in ('folder', 'document') and node_id is not None:
                    where.append('node_type = ? AND node_id = ?')
                    params.extend([node_type, node_id])
                where_sql = ' AND '.join(where)
                prov_rows = conn.execute(
                    f'SELECT id, node_type, node_id, node_name, action, actor_user_id, detail, content_hash, created_at '
                    f'FROM vault_provenance WHERE {where_sql} ORDER BY id DESC LIMIT ?',
                    params + [limit]
                ).fetchall()
                entries = []
                for r in prov_rows:
                    d = dict(r)
                    try:
                        d['detail'] = json.loads(d['detail']) if d['detail'] else {}
                    except Exception:
                        d['detail'] = {}
                    d['id'] = f"prov-{d['id']}"
                    d['source'] = 'provenance'
                    entries.append(d)

                # Fold in vault_audit, scoped the same way vault_audit_trail
                # already scopes it (via the case_vault row's own
                # ownership, since vault_audit itself carries no user_id).
                audit_where = ['(cv.user_id = ? OR cv.user_id IS NULL)']
                audit_params = [uid]
                if node_type == 'folder' and node_id is not None:
                    audit_where.append('va.folder_id = ?')
                    audit_params.append(node_id)
                elif node_type == 'document' and node_id is not None:
                    audit_where.append('va.vault_doc_id = ?')
                    audit_params.append(node_id)
                audit_where_sql = ' AND '.join(audit_where)
                audit_rows = conn.execute(
                    f'''
                    SELECT va.id, va.folder_id, va.vault_doc_id, va.session_title, va.created_at,
                           cv.title AS doc_title, cv.smart_title AS doc_smart_title
                    FROM vault_audit va
                    LEFT JOIN case_vault cv ON va.vault_doc_id = cv.id
                    WHERE {audit_where_sql}
                    ORDER BY va.id DESC LIMIT ?
                    ''',
                    audit_params + [limit]
                ).fetchall()
                for r in audit_rows:
                    entries.append({
                        'id': f'audit-{r["id"]}',
                        'node_type': 'document',
                        'node_id': r['vault_doc_id'],
                        'node_name': r['doc_smart_title'] or r['doc_title'] or r['session_title'] or 'Document',
                        'action': 'ai_generated',
                        'actor_user_id': None,
                        'detail': {'session_title': r['session_title']},
                        'content_hash': None,
                        'created_at': r['created_at'],
                        'source': 'audit',
                    })
            finally:
                conn.row_factory = old_rf

            entries.sort(key=lambda e: e['created_at'], reverse=True)
            return jsonify({'entries': entries[:limit]}), 200
        except Exception as e:
            return jsonify({'error': True, 'message': str(e)}), 500

    @bp.route("/provenance/verify", methods=["GET", "OPTIONS"])
    @jwt_required()
    def verify_vault_provenance():
        """Recomputes the ENTIRE global hash chain from the first row
        onward using the exact same payload formula _write_provenance
        writes with, and compares each recomputed hash against what's
        stored — real tamper-evidence, replacing the old "Verify chain
        integrity" button's no-op alert(). Deliberately walks the whole
        chain rather than a per-case slice: vault_audit_trail-style
        filtering is a display concern, not a verification one — a
        tampered row anywhere breaks every hash after it, so any partial
        check would be able to report "valid" while missing corruption
        upstream of the slice it looked at."""
        import app as app_module
        if request.method == 'OPTIONS':
            return jsonify({}), 200
        try:
            conn = app_module.db
            old_rf = conn.row_factory
            conn.row_factory = sqlite3.Row
            try:
                rows = conn.execute(
                    'SELECT id, node_type, node_id, node_name, action, actor_user_id, owner_user_id, detail, content_hash '
                    'FROM vault_provenance ORDER BY id ASC'
                ).fetchall()
            finally:
                conn.row_factory = old_rf

            prev_hash = '0' * 64
            for row in rows:
                payload = '|'.join(str(x) for x in (
                    prev_hash, row['node_type'], row['node_id'], row['node_name'],
                    row['action'], row['actor_user_id'], row['owner_user_id'], row['detail']
                ))
                expected = hashlib.sha256(payload.encode('utf-8')).hexdigest()
                if expected != row['content_hash']:
                    return jsonify({
                        'valid': False,
                        'broken_at_id': row['id'],
                        'total_entries': len(rows),
                    }), 200
                prev_hash = row['content_hash']
            return jsonify({'valid': True, 'broken_at_id': None, 'total_entries': len(rows)}), 200
        except Exception as e:
            return jsonify({'error': True, 'message': str(e)}), 500

    @bp.route("/documents/<int:doc_id>/citations", methods=["POST", "OPTIONS"])
    @jwt_required()
    def add_vault_citation(doc_id):
        import app as app_module
        if request.method == 'OPTIONS':
            return jsonify({}), 200
        uid = app_module._current_vault_user_id()
        try:
            data = request.get_json(force=True, silent=True) or {}
            citation_id = str(data.get('id', '')).strip()
            citation_title = str(data.get('title', '')).strip()
            if not citation_id or not citation_title:
                return jsonify({"error": True, "message": "Citation requires both id and title."}), 400

            payload = json.dumps({"id": citation_id, "title": citation_title})

            conn = app_module.db
            conn.execute('BEGIN IMMEDIATE')
            row = conn.execute('SELECT id, user_id FROM case_vault WHERE id = ?', (doc_id,)).fetchone()
            if not row or not app_module._vault_access_ok('document', doc_id, row[1], uid, require_edit=True):
                conn.rollback()
                return jsonify({"error": True, "message": f"Document {doc_id} not found."}), 404
            conn.execute(app_module._CITATION_INSERT_SQL, (citation_id, payload, doc_id, doc_id))
            conn.commit()

            tags_row = conn.execute('SELECT tags FROM case_vault WHERE id = ?', (doc_id,)).fetchone()
            citations = json.loads(tags_row[0]) if tags_row and tags_row[0] else []
            return jsonify({"status": "success", "citations": citations}), 200
        except Exception as e:
            app_module.db.rollback()
            import traceback
            traceback.print_exc()
            return jsonify({"error": True, "message": str(e)}), 500

    @bp.route("/documents/<int:doc_id>/citations/<string:citation_id>", methods=["DELETE", "OPTIONS"])
    @jwt_required()
    def remove_vault_citation(doc_id, citation_id):
        import app as app_module
        if request.method == 'OPTIONS':
            return jsonify({}), 200
        uid = app_module._current_vault_user_id()
        try:
            conn = app_module.db
            conn.execute('BEGIN IMMEDIATE')
            row = conn.execute('SELECT id, user_id FROM case_vault WHERE id = ?', (doc_id,)).fetchone()
            if not row or not app_module._vault_access_ok('document', doc_id, row[1], uid, require_edit=True):
                conn.rollback()
                return jsonify({"error": True, "message": f"Document {doc_id} not found."}), 404
            conn.execute(app_module._CITATION_DELETE_SQL, (doc_id, citation_id, doc_id))
            conn.commit()

            tags_row = conn.execute('SELECT tags FROM case_vault WHERE id = ?', (doc_id,)).fetchone()
            citations = json.loads(tags_row[0]) if tags_row and tags_row[0] else []
            return jsonify({"status": "success", "citations": citations}), 200
        except Exception as e:
            app_module.db.rollback()
            import traceback
            traceback.print_exc()
            return jsonify({"error": True, "message": str(e)}), 500


    # ── Folder/document writes, blueprint init and audit trail (moved verbatim from app.py's create_app(), step 3c) ──
    # Paths are relative to this blueprint's /api/vault prefix.

    @bp.route("/folders", methods=["POST"])
    @jwt_required()
    def create_vault_folder():
        import app as app_module
        uid = app_module._current_vault_user_id()
        try:
            data = request.get_json(force=True, silent=True) or {}
            name = (data.get('name') or '').strip()
            parent_id = data.get('parent_id')  # None = root folder

            if not name:
                return jsonify({'error': True, 'message': 'Folder name is required.'}), 400
            if len(name) > 80:
                return jsonify({'error': True, 'message': 'Folder name must be under 80 characters.'}), 400

            conn = app_module.db

            # A parent_id must be a folder this user can actually see —
            # otherwise anyone could nest a folder under another user's
            # private folder id (folder_id is a small sequential integer,
            # trivially guessable/enumerable).
            if parent_id is not None:
                parent_row = conn.execute(
                    'SELECT user_id FROM vault_folders WHERE id = ?', (parent_id,)
                ).fetchone()
                if not parent_row or not app_module._vault_access_ok('folder', parent_id, parent_row[0], uid, require_edit=True):
                    return jsonify({'error': True, 'message': 'Parent folder not found.'}), 404

            # Uniqueness check: same name + same parent, within this user's own folders
            existing = conn.execute(
                'SELECT id FROM vault_folders WHERE name = ? AND (parent_id IS ? OR parent_id = ?) AND user_id = ?',
                (name, parent_id, parent_id, uid)
            ).fetchone()
            if existing:
                return jsonify({'error': True, 'message': f'A folder named "{name}" already exists here.'}), 409

            c = conn.cursor()
            c.execute(
                'INSERT INTO vault_folders (name, parent_id, user_id) VALUES (?, ?, ?)',
                (name, parent_id, uid)
            )
            conn.commit()
            folder_id = c.lastrowid
            app_module._write_provenance('folder', folder_id, name, 'created', uid, uid, {'parent_id': parent_id})
            return jsonify({'success': True, 'id': folder_id, 'name': name, 'parent_id': parent_id}), 201
        except Exception as e:
            return jsonify({'error': True, 'message': str(e)}), 500

    @bp.route("/folders/init-blueprint", methods=["POST", "OPTIONS"])
    @jwt_required()
    def init_vault_blueprint():
        import app as app_module
        if request.method == 'OPTIONS':
            return jsonify({}), 200
        uid = app_module._current_vault_user_id()
        try:
            existing = app_module.db.execute(
                'SELECT name FROM vault_folders WHERE parent_id IS NULL AND (user_id = ? OR user_id IS NULL)',
                (uid,)
            ).fetchall()
            existing_names = {r[0] for r in existing}
            if existing_names & set(app_module._BLUEPRINT_FOLDER_NAMES):
                return jsonify({'success': True, 'created': False, 'message': 'Blueprint already initialized.'}), 200

            c = app_module.db.cursor()
            created = []
            for name in app_module._BLUEPRINT_FOLDER_NAMES:
                c.execute(
                    'INSERT INTO vault_folders (name, parent_id, user_id, protected) VALUES (?, NULL, ?, 1)',
                    (name, uid)
                )
                created.append({'id': c.lastrowid, 'name': name, 'protected': True})
            app_module.db.commit()
            app_module._write_provenance(
                'folder', None, 'Standard blueprint', 'blueprint_applied', uid, uid,
                {'folders': created}
            )
            return jsonify({'success': True, 'created': True, 'folders': created}), 201
        except Exception as e:
            return jsonify({'error': True, 'message': str(e)}), 500

    @bp.route("/folders/<int:folder_id>", methods=["PATCH", "OPTIONS"])
    @jwt_required()
    def update_vault_folder(folder_id):
        import app as app_module
        if request.method == 'OPTIONS':
            return jsonify({}), 200
        uid = app_module._current_vault_user_id()
        try:
            owner_row = app_module.db.execute('SELECT user_id, protected, name, parent_id FROM vault_folders WHERE id = ?', (folder_id,)).fetchone()
            if not owner_row or not app_module._vault_access_ok('folder', folder_id, owner_row[0], uid, require_edit=True):
                return jsonify({'error': True, 'message': 'Folder not found.'}), 404
            if owner_row[1]:
                return jsonify({'error': True, 'message': 'This is one of the standard blueprint folders and cannot be renamed or moved.'}), 403
            folder_owner_uid = owner_row[0] if owner_row[0] is not None else uid
            old_name, old_parent_id = owner_row[2], owner_row[3]

            data = request.get_json(force=True, silent=True) or {}

            if 'name' in data:
                new_name = (data.get('name') or '').strip()
                if not new_name:
                    return jsonify({'error': True, 'message': 'Folder name cannot be empty.'}), 400
                if len(new_name) > 80:
                    return jsonify({'error': True, 'message': 'Folder name must be under 80 characters.'}), 400
                app_module.db.execute('UPDATE vault_folders SET name = ? WHERE id = ?', (new_name, folder_id))
                app_module.db.commit()
                app_module._write_provenance(
                    'folder', folder_id, new_name, 'renamed', uid, folder_owner_uid,
                    {'old_name': old_name, 'new_name': new_name}
                )
                return jsonify({'success': True, 'id': folder_id, 'name': new_name}), 200

            if 'parent_id' in data:
                new_parent = data.get('parent_id')  # None = move to root
                # The destination folder must also belong to this user (or be
                # legacy/shared) — otherwise a folder could be relocated
                # underneath another user's private tree by guessing an id.
                if new_parent is not None:
                    dest_row = app_module.db.execute('SELECT user_id FROM vault_folders WHERE id = ?', (new_parent,)).fetchone()
                    if not dest_row or not app_module._vault_access_ok('folder', new_parent, dest_row[0], uid, require_edit=True):
                        return jsonify({'error': True, 'message': 'Destination folder not found.'}), 404
                # Prevent circular parentage: new_parent must not be self or a descendant
                def get_descendants(fid):
                    kids = [r['id'] for r in app_module.db.execute('SELECT id FROM vault_folders WHERE parent_id = ?', (fid,)).fetchall()]
                    result = list(kids)
                    for k in kids:
                        result.extend(get_descendants(k))
                    return result
                if new_parent == folder_id or new_parent in get_descendants(folder_id):
                    return jsonify({'error': True, 'message': 'Cannot move a folder into itself or its own descendant.'}), 400
                app_module.db.execute('UPDATE vault_folders SET parent_id = ? WHERE id = ?', (new_parent, folder_id))
                app_module.db.commit()
                app_module._write_provenance(
                    'folder', folder_id, old_name, 'moved', uid, folder_owner_uid,
                    {'old_parent_id': old_parent_id, 'new_parent_id': new_parent}
                )
                return jsonify({'success': True, 'id': folder_id, 'parent_id': new_parent}), 200

            return jsonify({'error': True, 'message': 'No valid fields provided (name or parent_id).'}), 400
        except Exception as e:
            return jsonify({'error': True, 'message': str(e)}), 500

    @bp.route("/documents/<int:doc_id>", methods=["PUT", "OPTIONS"])
    @jwt_required()
    def update_vault_document(doc_id):
        import app as app_module
        if request.method == 'OPTIONS':
            return jsonify({}), 200
        uid = app_module._current_vault_user_id()
        try:
            owner_row = app_module.db.execute(
                'SELECT user_id, COALESCE(smart_title, title), folder_id FROM case_vault WHERE id = ?', (doc_id,)
            ).fetchone()
            if not owner_row or not app_module._vault_access_ok('document', doc_id, owner_row[0], uid, require_edit=True):
                return jsonify({'error': True, 'message': 'Document not found.'}), 404
            doc_owner_uid = owner_row[0] if owner_row[0] is not None else uid
            old_title, old_folder_id = owner_row[1], owner_row[2]

            data = request.get_json(force=True, silent=True) or {}
            if 'content' in data:
                app_module.db.execute('UPDATE case_vault SET content = ? WHERE id = ?', (data.get('content', ''), doc_id))
            if 'title' in data or 'smart_title' in data:
                new_title = (data.get('title') or data.get('smart_title') or '').strip()
                if not new_title:
                    return jsonify({'error': True, 'message': 'Title cannot be empty.'}), 400
                if len(new_title) > 200:
                    return jsonify({'error': True, 'message': 'Title must be under 200 characters.'}), 400
                app_module.db.execute('UPDATE case_vault SET smart_title = ? WHERE id = ?', (new_title, doc_id))
                app_module._write_provenance(
                    'document', doc_id, new_title, 'renamed', uid, doc_owner_uid,
                    {'old_title': old_title, 'new_title': new_title}
                )
            if 'tags' in data:
                new_tags = (str(data.get('tags') or '')).strip()[:120]
                app_module.db.execute('UPDATE case_vault SET tags = ? WHERE id = ?', (new_tags, doc_id))
                if 'FINAL' in new_tags.upper():
                    app_module._write_provenance('document', doc_id, old_title, 'finalised', uid, doc_owner_uid, {'tags': new_tags})
            if 'folder_id' in data:
                new_folder_id = data.get('folder_id')
                if new_folder_id is not None:
                    dest_row = app_module.db.execute('SELECT user_id FROM vault_folders WHERE id = ?', (new_folder_id,)).fetchone()
                    if not dest_row or not app_module._vault_access_ok('folder', new_folder_id, dest_row[0], uid, require_edit=True):
                        return jsonify({'error': True, 'message': 'Destination folder not found.'}), 404
                app_module.db.execute('UPDATE case_vault SET folder_id = ? WHERE id = ?', (new_folder_id, doc_id))
                app_module._write_provenance(
                    'document', doc_id, old_title, 'moved', uid, doc_owner_uid,
                    {'old_folder_id': old_folder_id, 'new_folder_id': new_folder_id}
                )
            app_module.db.commit()
            return jsonify({'success': True, 'id': doc_id}), 200
        except Exception as e:
            return jsonify({'error': True, 'message': str(e)}), 500

    @bp.route("/audit-trail", methods=["GET", "OPTIONS"])
    @jwt_required()
    def vault_audit_trail():
        import app as app_module
        if request.method == 'OPTIONS':
            return jsonify({}), 200
        uid = app_module._current_vault_user_id()
        try:
            folder_id = request.args.get('folder_id', type=int)
            conn = app_module.db
            old_rf = conn.row_factory
            conn.row_factory = sqlite3.Row
            try:
                c = conn.cursor()
                # An audit record's owner is transitive through the vault
                # document it documents — vault_audit itself carries no
                # user_id, so ownership is resolved via the case_vault join.
                if folder_id is not None:
                    c.execute('''
                        SELECT va.id, va.folder_id, va.vault_doc_id, va.session_title,
                               va.messages_json, va.created_at,
                               cv.title AS doc_title, cv.doc_type,
                               vf.name  AS folder_name
                        FROM   vault_audit va
                        LEFT JOIN case_vault    cv ON va.vault_doc_id = cv.id
                        LEFT JOIN vault_folders vf ON va.folder_id    = vf.id
                        WHERE  va.folder_id = ? AND (cv.user_id = ? OR cv.user_id IS NULL)
                        ORDER  BY va.created_at DESC
                    ''', (folder_id, uid))
                else:
                    c.execute('''
                        SELECT va.id, va.folder_id, va.vault_doc_id, va.session_title,
                               va.messages_json, va.created_at,
                               cv.title AS doc_title, cv.doc_type,
                               vf.name  AS folder_name
                        FROM   vault_audit va
                        LEFT JOIN case_vault    cv ON va.vault_doc_id = cv.id
                        LEFT JOIN vault_folders vf ON va.folder_id    = vf.id
                        WHERE  cv.user_id = ? OR cv.user_id IS NULL
                        ORDER  BY va.created_at DESC
                        LIMIT  60
                    ''', (uid,))
                rows = c.fetchall()
                threads = []
                for row in rows:
                    d = dict(row)
                    try:
                        d['messages'] = json.loads(d.get('messages_json') or '[]')
                    except Exception:
                        d['messages'] = []
                    threads.append(d)
                return jsonify({'threads': threads}), 200
            finally:
                conn.row_factory = old_rf
        except Exception as e:
            return jsonify({'error': True, 'message': str(e)}), 500


    # ── Vault save (moved verbatim from app.py's create_app(), step 3c) ──
    # Path is relative to this blueprint's /api/vault prefix.

    @bp.route("/save", methods=["POST", "OPTIONS"])
    @jwt_required()
    def save_vault_document():
        import app as app_module
        if request.method == 'OPTIONS':
            return jsonify({}), 200
        uid = app_module._current_vault_user_id()
        try:
            data = request.get_json(force=True, silent=True) or {}

            # Virtual Courtroom simulator session save format
            if 'case_facts' in data or 'history' in data:
                case_facts = data.get("case_facts", "")
                history = data.get("history", [])
                title = data.get("title", "VC Session")

                import uuid
                vault_path = os.path.join(os.getcwd(), "vc_vault_data.json")
                if os.path.exists(vault_path):
                    with open(vault_path, "r", encoding="utf-8") as f:
                        vault_data = json.load(f)
                else:
                    vault_data = {}

                case_id = "VC_" + str(uuid.uuid4())[:8]
                vault_data[case_id] = {
                    "title": title,
                    "case_facts": case_facts,
                    "history": history
                }

                with open(vault_path, "w", encoding="utf-8") as f:
                    json.dump(vault_data, f, indent=4)

                return jsonify({"status": "success", "message": f"Session locked to VC Vault (ID: {case_id}).", "id": case_id}), 200

            # Case Vault save format
            case_id     = data.get('case_id')
            title       = data.get('title')
            doc_type    = data.get('doc_type')
            content     = data.get('content')
            folder_id   = data.get('folder_id')    # optional — from SaveToVaultModal
            smart_title = data.get('smart_title')  # optional — auto-generated client-side
            tags_raw    = data.get('tags')          # optional — JSON string or list
            if isinstance(tags_raw, list):
                tags = ','.join(str(t) for t in tags_raw)
            elif isinstance(tags_raw, str):
                try:
                    import json as _json
                    parsed = _json.loads(tags_raw)
                    tags = ','.join(str(t) for t in parsed) if isinstance(parsed, list) else tags_raw
                except Exception:
                    tags = tags_raw
            else:
                tags = None

            # Normalise content — allow empty string (blank draft is valid)
            content = str(content) if content is not None else ''
            if not case_id or not title:
                return jsonify({"error": True, "message": "Missing required fields (case_id, title)."}), 400

            # A folder_id must be a folder this user can actually see — a
            # bare integer id is trivially guessable, so without this check
            # a client could file a document straight into another user's
            # private folder just by sending its id.
            if folder_id:
                folder_owner = app_module.db.execute('SELECT user_id FROM vault_folders WHERE id = ?', (folder_id,)).fetchone()
                if not folder_owner or not app_module._vault_access_ok('folder', folder_id, folder_owner[0], uid, require_edit=True):
                    return jsonify({"error": True, "message": "Destination folder not found."}), 404

            # Format conversion — generate binary blob if requested
            save_format = data.get('format', 'native')
            file_blob = None
            file_format = save_format
            if save_format == 'pdf':
                try:
                    file_blob = app_module.generate_pdf_blob(smart_title or title or 'Document', content)
                except Exception as conv_err:
                    return jsonify({'error': True, 'message': f'PDF generation failed: {str(conv_err)}'}), 500
            elif save_format == 'docx':
                try:
                    file_blob = app_module.generate_docx_blob(smart_title or title or 'Document', content)
                except Exception as conv_err:
                    return jsonify({'error': True, 'message': f'DOCX generation failed: {str(conv_err)}'}), 500

            audit_messages  = data.get('audit_messages')   # JSON string of [{role, text, ts}]
            session_title_s = data.get('session_title', '')

            # Resolve folder path string for breadcrumb confirmation (best-effort)
            folder_path = ''
            if folder_id:
                try:
                    path_parts = []
                    fid = folder_id
                    seen = set()
                    while fid and fid not in seen:
                        seen.add(fid)
                        row = app_module.db.execute('SELECT name, parent_id FROM vault_folders WHERE id = ?', (fid,)).fetchone()
                        if row:
                            path_parts.insert(0, row[0])
                            fid = row[1]
                        else:
                            break
                    folder_path = ' / '.join(path_parts)
                except Exception:
                    pass

            conn = app_module.db
            c = conn.cursor()
            file_blob = doc_storage.store(file_blob, file_format)  # durable when DOC_STORAGE=disk; unchanged on sqlite
            c.execute(
                'INSERT INTO case_vault (case_id, title, doc_type, content, folder_id, smart_title, tags, file_blob, file_format, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                (str(case_id), str(title), str(doc_type or ''), str(content), folder_id, smart_title, tags, file_blob, file_format, uid)
            )
            conn.commit()
            inserted_id = c.lastrowid

            # Write AI provenance / audit trail entry
            if audit_messages and inserted_id:
                try:
                    c.execute(
                        'INSERT INTO vault_audit (folder_id, vault_doc_id, session_title, messages_json) VALUES (?, ?, ?, ?)',
                        (folder_id, inserted_id, session_title_s, audit_messages)
                    )
                    conn.commit()
                except Exception:
                    pass

            display_title = smart_title or title
            location_str  = f'{folder_path} / {display_title}' if folder_path else display_title
            return jsonify({
                'success': True,
                'id': inserted_id,
                'message': 'Document successfully saved.',
                'location': location_str,
            }), 200
        except Exception as e:
            return jsonify({"error": True, "message": str(e)}), 500

    return bp
