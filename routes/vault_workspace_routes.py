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
import html as _html
import io
import json
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
def _esc(s):
    return _html.escape(s or "", quote=False)


def text_to_html(text):
    paras = [p.strip() for p in re.split(r"\n\s*\n", (text or "").replace("\r\n", "\n")) if p.strip()]
    return "".join("<p>" + "<br>".join(_esc(line) for line in p.split("\n")) + "</p>" for p in paras)


def html_to_text(h):
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(h or "", "html.parser")
    for br in soup.find_all("br"):
        br.replace_with("\n")
    names = ["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote"]
    blocks = [b for b in soup.find_all(names) if not b.find(names)]      # innermost blocks only, so <li><p>..</p></li> is read once
    if not blocks:
        return soup.get_text("\n").strip()
    return "\n\n".join(b.get_text().strip() for b in blocks if b.get_text().strip())


def docx_to_html(data):
    from docx import Document
    from docx.table import Table
    from docx.text.paragraph import Paragraph
    doc = Document(io.BytesIO(data))
    out = []
    for child in doc.element.body.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            p = Paragraph(child, doc)
            inner = ""
            for r in p.runs:
                t = _esc(r.text).replace("\n", "<br>")
                if not t:
                    continue
                if r.bold:
                    t = f"<strong>{t}</strong>"
                if r.italic:
                    t = f"<em>{t}</em>"
                if r.underline:
                    t = f"<u>{t}</u>"
                inner += t
            if not inner.strip():
                continue
            style = (p.style.name if p.style is not None else "") or ""
            if style.lower().startswith("list"):
                inner = "• " + inner
            align = {1: "center", 2: "right", 3: "justify"}.get(p.alignment if p.alignment is None else int(p.alignment))
            attr = f' style="text-align:{align}"' if align else ""
            m = re.match(r"heading (\d)", style, re.I)
            if m or style.lower() == "title":
                n = min(max(int(m.group(1)) if m else 1, 1), 4)
                out.append(f"<h{n}{attr}>{inner}</h{n}>")
            else:
                out.append(f"<p{attr}>{inner}</p>")
        elif tag == "tbl":
            t = Table(child, doc)
            for row in t.rows:
                cells = []
                for cell in row.cells:
                    v = " ".join(x.strip() for x in cell.text.split("\n") if x.strip())
                    if v and (not cells or cells[-1] != v):
                        cells.append(v)
                if cells:
                    out.append("<p>" + _esc("  |  ".join(cells)) + "</p>")
    return "".join(out)


def html_to_docx(html, title=None):
    from bs4 import BeautifulSoup, NavigableString, Tag
    from docx import Document
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.shared import Pt
    d = Document()
    st = d.styles["Normal"]
    st.font.name = "Times New Roman"
    st.font.size = Pt(12)
    soup = BeautifulSoup(html or "", "html.parser")

    def runs(node, para, fmt):
        for ch in node.children:
            if isinstance(ch, NavigableString):
                t = str(ch)
                if t:
                    r = para.add_run(t)
                    r.bold, r.italic, r.underline = fmt["b"] or None, fmt["i"] or None, fmt["u"] or None
            elif isinstance(ch, Tag):
                if ch.name == "br":
                    para.add_run().add_break()
                    continue
                f = dict(fmt)
                if ch.name in ("strong", "b"):
                    f["b"] = True
                if ch.name in ("em", "i"):
                    f["i"] = True
                if ch.name == "u":
                    f["u"] = True
                runs(ch, para, f)

    def block(el, prefix=""):
        name = el.name
        if name in ("ul", "ol"):
            for i, li in enumerate(el.find_all("li", recursive=False), 1):
                block(li, "• " if name == "ul" else f"{i}. ")
            return
        if name == "li" and el.find(["p"]):
            for i, p in enumerate(el.find_all("p", recursive=False)):
                block(p, prefix if i == 0 else "")
            return
        if name in ("h1", "h2", "h3", "h4", "h5", "h6"):
            para = d.add_heading(level=min(int(name[1]), 4))
        else:
            para = d.add_paragraph()
        if prefix:
            para.add_run(prefix)
        runs(el, para, {"b": False, "i": False, "u": False})
        m = re.search(r"text-align:\s*(center|right|justify)", el.get("style", "") or "")
        if m:
            para.alignment = {"center": WD_ALIGN_PARAGRAPH.CENTER, "right": WD_ALIGN_PARAGRAPH.RIGHT, "justify": WD_ALIGN_PARAGRAPH.JUSTIFY}[m.group(1)]

    top = [c for c in soup.children if isinstance(c, Tag)]
    if not top:
        d.add_paragraph(soup.get_text())
    for el in top:
        if el.name in ("p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "ul", "ol", "blockquote"):
            block(el)
        else:
            para = d.add_paragraph()
            runs(el, para, {"b": False, "i": False, "u": False})
    if title:
        d.core_properties.title = title[:200]
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


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
            return bytes(c.execute("SELECT file_blob FROM case_vault WHERE id = ?", (row["id"],)).fetchone()[0])
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
                "previewable": ext in INLINE_MIMES, "info": info, "case": case,
                "can_edit": allowed(u, doc_id, True),
                "edited_copy": ((row["tags"] or "") == "EDITED" and row["user_id"] == u),
            }), 200
        finally:
            c.close()

    def resync_hub(c, doc_id, data):
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

            tmp, sha, size = S.spool_upload(_FS(h["original_name"] or f"document_{doc_id}.docx", data), 200 * 1024 * 1024)
            try:
                key, enc = S.commit(tmp, sha)
            finally:
                try:
                    import os
                    os.remove(tmp)
                except OSError:
                    pass
            c.execute("UPDATE dms_docs SET sha256 = ?, store_key = ?, enc = ?, size = ?, ext = 'docx', updated_at = CURRENT_TIMESTAMP WHERE doc_id = ?",
                      (sha, key, int(enc), size, doc_id))
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

    return bp
