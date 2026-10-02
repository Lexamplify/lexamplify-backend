"""
utils/dms_bundle.py - court-ready bundles ("paper books"): pick documents, put them in order, get ONE PDF with a cover sheet,
an index, optional annexure dividers, a running page number on every page and PDF bookmarks.

Rules this builder keeps:
  * Nothing is skipped silently. If any item cannot be included (unreadable, password-protected, a page range that does not
    exist, a Word file on a server without LibreOffice) the build STOPS and says which item and why - a bundle that quietly
    lacks an annexure is worse than no bundle.
  * Page numbers are continuous from the first page after the cover and the index: dividers and section sheets are counted,
    so the page range printed in the index is exactly the pages that carry those numbers.
  * Source pages are copied as they are (text layers, links and scans survive); only a small number is stamped on top.
"""
import contextlib
import io
import os
import re
import shutil
import subprocess
import tempfile

try:
    import pymupdf as fitz
except ImportError:  # pragma: no cover
    import fitz

try:
    from utils import dms_pdftext as T
except ImportError:  # pragma: no cover
    import dms_pdftext as T

MAX_PAGES = int(os.getenv("DMS_BUNDLE_MAX_PAGES", "3000"))
IMAGE_EXT = {"jpg", "jpeg", "png", "gif", "bmp", "webp", "tif", "tiff"}
OFFICE_EXT = {"docx", "doc", "xlsx", "xls", "pptx", "ppt", "odt", "ods", "odp", "rtf", "txt", "csv", "html", "htm"}
A4 = (595.28, 841.89)
MM = T.MM

DEFAULTS = {
    "cover": True, "index": True, "dividers": False, "pagination": "bottom-center", "number_format": "Page {n} of {N}", "start_at": 1,
    "auto_label": False, "label_prefix": "Annexure P-", "label_style": "number", "label_start": 1,
    "court": "", "case_title": "", "case_no": "", "subtitle": "Paper Book", "filed_by": "", "filed_for": "", "date": "", "index_title": "INDEX",
}
PAGINATIONS = ("bottom-center", "bottom-right", "bottom-left", "top-right", "none")
NUMBER_FORMATS = ("Page {n} of {N}", "{n}", "- {n} -", "Page {n}")


class BundleError(Exception):
    def __init__(self, message, problems=None):
        super().__init__(message)
        self.message, self.problems = message, problems or []


def office_available():
    return bool(shutil.which("soffice") or shutil.which("libreoffice"))


def can_include(ext, kind=None):
    ext = (ext or "").lower()
    if ext == "pdf" or ext in IMAGE_EXT:
        return True, ""
    if ext in OFFICE_EXT:
        if office_available():
            return True, ""
        return False, "This is a Word/Excel-type file and the server has no converter for it. Save it as PDF and add that instead."
    return False, "This kind of file cannot be placed in a bundle. Only PDFs, images and Word/Excel-type files can."


def clean_options(raw):
    o = dict(DEFAULTS)
    raw = raw or {}
    for k in ("cover", "index", "dividers", "auto_label"):
        if k in raw:
            o[k] = bool(raw[k])
    for k, n in (("court", 160), ("case_title", 200), ("case_no", 80), ("subtitle", 80), ("filed_by", 160), ("filed_for", 160), ("date", 40),
                 ("index_title", 40), ("label_prefix", 30)):
        if k in raw:
            o[k] = re.sub(r"\s+", " ", str(raw[k] or "")).strip()[:n]
    if raw.get("pagination") in PAGINATIONS:
        o["pagination"] = raw["pagination"]
    if raw.get("number_format") in NUMBER_FORMATS:
        o["number_format"] = raw["number_format"]
    if raw.get("label_style") in ("number", "alpha", "roman"):
        o["label_style"] = raw["label_style"]
    for k, lo, hi in (("start_at", 1, 99999), ("label_start", 1, 9999)):
        if k in raw:
            try:
                o[k] = max(lo, min(hi, int(raw[k])))
            except (TypeError, ValueError):
                pass
    return o


def _label_text(opts, n):
    style = opts["label_style"]
    if style == "alpha":
        s, k = "", n
        while k > 0:
            k, r = divmod(k - 1, 26)
            s = chr(65 + r) + s
        core = s
    elif style == "roman":
        vals = [(1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"), (90, "XC"), (50, "L"), (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")]
        k, core = n, ""
        for v, sym in vals:
            while k >= v:
                core += sym
                k -= v
    else:
        core = str(n)
    return f"{opts['label_prefix']}{core}".strip()


def compute_labels(items, opts):
    """Final label of each item: its own label if the person typed one, else an automatic 'Annexure P-3' when that is switched on."""
    out, n = [], opts["label_start"] - 1
    for it in items:
        if it["kind"] != "doc":
            out.append(None)
        elif (it.get("label") or "").strip():
            out.append(it["label"].strip()[:40])
        elif opts["auto_label"]:
            n += 1
            out.append(_label_text(opts, n))
        else:
            out.append(None)
    return out


def parse_pages(spec, page_count):
    """'1-3, 7, 9-' -> [1,2,3,7,9,...]. Raises ValueError with a message meant for the person."""
    spec = (spec or "").strip()
    if not spec or spec.lower() in ("all", "*"):
        return list(range(1, page_count + 1))
    pages = []
    for part in re.split(r"\s*,\s*", spec):
        if not part:
            continue
        m = re.fullmatch(r"(\d+)\s*(?:-|–|to)\s*(\d*)", part)
        if m:
            a = int(m.group(1))
            b = int(m.group(2)) if m.group(2) else page_count
            if a < 1 or b < a:
                raise ValueError(f"“{part}” is not a valid range.")
            if b > page_count:
                raise ValueError(f"“{part}” goes past the last page ({page_count}).")
            pages += list(range(a, b + 1))
        elif part.isdigit():
            n = int(part)
            if n < 1 or n > page_count:
                raise ValueError(f"Page {n} does not exist - the document has {page_count} page{'s' if page_count != 1 else ''}.")
            pages.append(n)
        else:
            raise ValueError(f"“{part}” is not a page or a range. Write it like 1-3, 7, 9-12.")
    if not pages:
        raise ValueError("No pages were chosen.")
    return pages


# ── sources -> pdf pages ─────────────────────────────────────────────────────────────
def _image_pdf(path):
    from PIL import Image, ImageOps
    out = fitz.open()
    with Image.open(path) as im:
        frames = getattr(im, "n_frames", 1)
        for i in range(min(frames, 400)):
            try:
                im.seek(i)
            except EOFError:
                break
            fr = ImageOps.exif_transpose(im.copy())
            if fr.mode not in ("RGB", "L"):
                fr = fr.convert("RGB")
            buf = io.BytesIO()
            fr.save(buf, "JPEG", quality=90)
            w, h = fr.size
            pw, ph = (A4[1], A4[0]) if w > h else A4
            page = out.new_page(width=pw, height=ph)
            m = 8 * MM
            box = fitz.Rect(m, m, pw - m, ph - m)
            scale = min(box.width / w, box.height / h)
            iw, ih = w * scale, h * scale
            x, y = (pw - iw) / 2, (ph - ih) / 2
            page.insert_image(fitz.Rect(x, y, x + iw, y + ih), stream=buf.getvalue())
    return out


def _office_pdf(path, workdir):
    exe = shutil.which("soffice") or shutil.which("libreoffice")
    if not exe:
        raise BundleError("The server has no converter for Word/Excel files.")
    prof = tempfile.mkdtemp(prefix="lo_", dir=workdir)
    out = tempfile.mkdtemp(prefix="lo_out_", dir=workdir)
    try:
        subprocess.run([exe, f"-env:UserInstallation=file://{prof}", "--headless", "--norestore", "--convert-to", "pdf", "--outdir", out, path],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=150, check=False)
    except subprocess.TimeoutExpired:
        raise BundleError("Converting the file to PDF took too long.")
    pdfs = [f for f in os.listdir(out) if f.lower().endswith(".pdf")]
    if not pdfs:
        raise BundleError("The file could not be converted to PDF.")
    return fitz.open(os.path.join(out, pdfs[0]))


def open_source(path, ext, workdir):
    """-> an open fitz.Document of the item's pages. Raises BundleError with a plain reason."""
    ext = (ext or "").lower()
    try:
        if ext == "pdf":
            d = fitz.open(path)
            if d.needs_pass:
                d.close()
                raise BundleError("This PDF is password-protected. Remove the password and upload it again.")
            if d.page_count == 0:
                d.close()
                raise BundleError("This PDF has no pages.")
            return d
        if ext in IMAGE_EXT:
            return _image_pdf(path)
        if ext in OFFICE_EXT:
            return _office_pdf(path, workdir)
    except BundleError:
        raise
    except Exception as exc:
        raise BundleError(f"The file could not be read ({str(exc)[:80]}).")
    raise BundleError("This kind of file cannot be placed in a bundle.")


# ── cover, index, divider, stamp ─────────────────────────────────────────────────────
def _center(page, face, names, y, text, size, kind="reg", color=(0, 0, 0), max_w=None):
    max_w = max_w or (A4[0] - 40 * MM)
    for ln in face.wrap(text, size, max_w, kind):
        w = face.width(ln, size, kind)
        face.text(page, names, ((A4[0] - w) / 2, y), ln, size, kind, color)
        y += size * 1.3
    return y


def make_cover(face, o):
    doc = fitz.open()
    page = doc.new_page(width=A4[0], height=A4[1])
    names = face.register(page)
    y = 110
    if o["court"]:
        y = _center(page, face, names, y, o["court"].upper(), 17, "bold") + 6
    if o["case_no"]:
        y = _center(page, face, names, y + 6, o["case_no"], 13, "bold") + 4
    page.draw_line((A4[0] / 2 - 60, y + 6), (A4[0] / 2 + 60, y + 6), color=(0.55, 0.55, 0.55), width=0.8)
    y += 36
    if o["case_title"]:
        y = _center(page, face, names, y, o["case_title"], 15, "bold") + 10
    y += 36
    if o["subtitle"]:
        y = _center(page, face, names, y, o["subtitle"].upper(), 22, "bold") + 8
    for lab, val in (("Filed by", o["filed_by"]), ("On behalf of", o["filed_for"])):
        if val:
            y = _center(page, face, names, y + 30, f"{lab}", 9.5, "reg", (0.4, 0.4, 0.4)) - 2
            y = _center(page, face, names, y, val, 12.5, "bold")
    if o["date"]:
        _center(page, face, names, A4[1] - 90, o["date"], 11, "reg", (0.25, 0.25, 0.25))
    return doc


def make_index(face, o, entries, offset_labels=None):
    """entries: [{'kind': 'doc'|'section', 'title', 'label', 'first', 'last', 'in_index'}]. Returns a fitz.Document (>= 1 page)."""
    doc = fitz.open()
    left, right = 22 * MM, A4[0] - 18 * MM
    col_sno, col_label, col_pages = 13 * MM, 30 * MM, 24 * MM
    x_sno, x_part = left, left + col_sno
    x_pages = right - col_pages
    x_label = x_pages - col_label
    part_w = x_label - x_part - 6
    size = 10
    page = names = None
    y = 0

    def head():
        nonlocal page, names, y
        page = doc.new_page(width=A4[0], height=A4[1])
        names = face.register(page)
        y = 64
        if len(doc) == 1:
            y = _center(page, face, names, y, o["index_title"] or "INDEX", 17, "bold") + 2
            sub = " - ".join(x for x in (o["case_no"], o["case_title"]) if x)
            if sub:
                y = _center(page, face, names, y + 2, sub, 10.5, "reg", (0.3, 0.3, 0.3), max_w=right - left) + 2
            y += 12
        top = y
        page.draw_rect(fitz.Rect(left, y - 2, right, y + 20), color=None, fill=(0.93, 0.93, 0.92))
        face.text(page, names, (x_sno + 3, y + 13), "S.No.", 9.5, "bold")
        face.text(page, names, (x_part + 3, y + 13), "Particulars", 9.5, "bold")
        face.text(page, names, (x_label + 3, y + 13), "Annexure", 9.5, "bold")
        face.text(page, names, (x_pages + 3, y + 13), "Page No.", 9.5, "bold")
        y += 24
        return top

    head()
    n = 0
    for e in entries:
        if not e.get("in_index", True):
            continue
        is_sec = e["kind"] == "section"
        title_lines = face.wrap(e["title"], size, part_w, "bold" if is_sec else "reg")
        row_h = max(1, len(title_lines)) * size * 1.35 + 9
        if y + row_h > A4[1] - 60:
            head()
        if is_sec:
            page.draw_rect(fitz.Rect(left, y - 1, right, y + row_h - 3), color=None, fill=(0.96, 0.96, 0.95))
        else:
            n += 1
            face.text(page, names, (x_sno + 3, y + size + 2), str(n), size)
        ty = y + size + 2
        for ln in title_lines:
            face.text(page, names, (x_part + 3, ty), ln, size, "bold" if is_sec else "reg")
            ty += size * 1.35
        if not is_sec:
            if e.get("label"):
                lines = face.wrap(e["label"], size - 0.5, col_label - 6, "reg", max_lines=2)
                ly = y + size + 2
                for ln in lines:
                    face.text(page, names, (x_label + 3, ly), ln, size - 0.5)
                    ly += size * 1.3
            rng = str(e["first"]) if e["first"] == e["last"] else f"{e['first']} - {e['last']}"
            face.text(page, names, (x_pages + 3, y + size + 2), rng, size)
        page.draw_line((left, y + row_h - 3), (right, y + row_h - 3), color=(0.82, 0.82, 0.8), width=0.5)
        y += row_h
    if n == 0 and not any(e["kind"] == "section" for e in entries):
        face.text(page, names, (x_part + 3, y + size + 2), "(no documents)", size, "reg", (0.5, 0.5, 0.5))
    return doc


def make_divider(face, label, title, sub=None):
    doc = fitz.open()
    page = doc.new_page(width=A4[0], height=A4[1])
    names = face.register(page)
    y = A4[1] / 2 - 60
    if label:
        y = _center(page, face, names, y, label.upper(), 26, "bold") + 14
    y = _center(page, face, names, y + 4, title, 14.5, "reg", (0.15, 0.15, 0.15)) + 4
    if sub:
        _center(page, face, names, y + 10, sub, 10.5, "reg", (0.45, 0.45, 0.45))
    return doc


_HELV = fitz.Font("helv")


def _stamp(page, text, where):
    """The page number: plain Helvetica (never embeds a font) in a small, nearly opaque white box so it reads over scans too."""
    rect = page.rect
    size = 9
    w = _HELV.text_length(text, fontsize=size) + 12
    h = size + 7
    margin = 10
    if where == "bottom-center":
        x0, y0 = (rect.width - w) / 2, rect.height - margin - h
    elif where == "bottom-left":
        x0, y0 = margin + 8, rect.height - margin - h
    elif where == "top-right":
        x0, y0 = rect.width - margin - 8 - w, margin
    else:
        x0, y0 = rect.width - margin - 8 - w, rect.height - margin - h
    page.draw_rect(fitz.Rect(x0, y0, x0 + w, y0 + h), color=None, fill=(1, 1, 1), fill_opacity=0.88, overlay=True)
    page.insert_text((x0 + 6, y0 + h - 4.2), text, fontsize=size, fontname="helv", color=(0.1, 0.1, 0.1))


# ── the build ────────────────────────────────────────────────────────────────────────
def check_items(items):
    """Cheap pre-flight (no files opened): [{index, problem}] for items that can never be built as they are."""
    probs = []
    for i, it in enumerate(items):
        if it["kind"] == "section":
            continue
        if it.get("missing"):
            probs.append({"index": i, "problem": it["missing"]})
            continue
        ok, why = can_include(it.get("ext"))
        if not ok:
            probs.append({"index": i, "problem": why})
    return probs


def build(items, options, out_path, progress=None, workdir=None):
    """
    items:   [{'kind': 'doc'|'section', 'title', 'label', 'pages', 'path', 'ext', 'in_index', 'missing'}] in bundle order
    options: see DEFAULTS (run through clean_options first)
    Writes the PDF to out_path. Returns {'pages': total pages, 'numbered': n, 'index_pages': n, 'entries': [...], 'warnings': [...]}.
    Raises BundleError (with .problems) and writes nothing when anything cannot be included.
    """
    o = clean_options(options)
    progress = progress or (lambda frac, note="": None)
    created_workdir = workdir is None
    workdir = workdir or tempfile.mkdtemp(prefix="bundle_")
    face = T.Face()
    if not any(it["kind"] == "doc" for it in items):
        raise BundleError("The bundle has no documents yet. Add at least one.")
    pre = check_items(items)
    if pre:
        raise BundleError("Some items cannot go in the bundle.", [{"item": items[p["index"]].get("title") or f"Item {p['index'] + 1}", "problem": p["problem"]} for p in pre])
    labels = compute_labels(items, o)

    opened, problems, plan = [], [], []
    try:
        total_src = 0
        for i, it in enumerate(items):
            progress(0.05 + 0.45 * i / max(1, len(items)), f"Reading {it.get('title') or 'item'}")
            if it["kind"] == "section":
                plan.append({"item": it, "pages": [], "doc": None})
                continue
            try:
                d = open_source(it["path"], it.get("ext"), workdir)
            except BundleError as exc:
                problems.append({"item": it.get("title") or f"Item {i + 1}", "problem": exc.message})
                continue
            opened.append(d)
            try:
                pages = parse_pages(it.get("pages"), d.page_count)
            except ValueError as exc:
                problems.append({"item": it.get("title") or f"Item {i + 1}", "problem": str(exc)})
                continue
            plan.append({"item": it, "pages": pages, "doc": d})
            total_src += len(pages)
            if total_src > MAX_PAGES:
                raise BundleError(f"A bundle can hold at most {MAX_PAGES} pages; this one is longer. Split it into two bundles.")
        if problems:
            raise BundleError("Some items cannot go in the bundle.", problems)

        # lay out: every page after the cover/index is numbered, dividers and section sheets included
        entries, cursor = [], o["start_at"]
        for idx, p in enumerate(plan):
            it = p["item"]
            sheet = 1 if (it["kind"] == "section" or (o["dividers"] and it["kind"] == "doc")) else 0
            first = cursor
            n_pages = sheet + len(p["pages"])
            cursor += n_pages
            entries.append({"kind": it["kind"], "title": (it.get("title") or "").strip() or "Untitled", "label": labels[idx], "first": first,
                            "last": cursor - 1, "in_index": bool(it.get("in_index", True)) or it["kind"] == "section", "sheet": sheet,
                            "pages": p["pages"], "plan": p})
        total_numbered = cursor - o["start_at"]
        last_no = cursor - 1

        out = fitz.open()
        cover_n = 0
        if o["cover"]:
            c = make_cover(face, o)
            out.insert_pdf(c)
            cover_n = c.page_count
            c.close()
        index_n = 0
        if o["index"]:
            ix = make_index(face, o, [{k: v for k, v in e.items() if k not in ("plan", "pages")} for e in entries])
            out.insert_pdf(ix)
            index_n = ix.page_count
            ix.close()

        toc = []
        body_start = out.page_count
        nums = []                                                    # number printed on each body page
        for idx, e in enumerate(entries):
            progress(0.5 + 0.4 * idx / max(1, len(entries)), f"Adding {e['title']}")
            p = e["plan"]
            first_page_index = out.page_count
            if e["sheet"]:
                dv = make_divider(face, e["label"] if e["kind"] == "doc" else None, e["title"],
                                  None if e["kind"] == "section" else (f"{len(p['pages'])} page{'s' if len(p['pages']) != 1 else ''}"))
                out.insert_pdf(dv)
                dv.close()
                nums.append(e["first"])
            if p["doc"] is not None:
                # consecutive runs are copied in one call (fast, keeps links); an out-of-order list is still honoured
                run_start = prev = None
                for pg in p["pages"] + [None]:
                    if run_start is not None and (pg is None or pg != prev + 1):
                        out.insert_pdf(p["doc"], from_page=run_start - 1, to_page=prev - 1)
                        run_start = None
                    if pg is not None:
                        if run_start is None:
                            run_start = pg
                        prev = pg
                for k in range(len(p["pages"])):
                    nums.append(e["first"] + e["sheet"] + k)
            toc.append([2 if e["kind"] == "doc" and any(x["kind"] == "section" for x in entries[:idx]) else 1,
                        ((e["label"] + " - ") if e["label"] else "") + e["title"], first_page_index + 1])
        for d in opened:
            with contextlib.suppress(Exception):
                d.close()
        opened = []

        if o["pagination"] != "none":
            for k, no in enumerate(nums):
                pg = out[body_start + k]
                if pg.rotation:
                    pg.remove_rotation()
                _stamp(pg, o["number_format"].format(n=no, N=last_no), o["pagination"])
        if toc:
            out.set_toc(toc)
        out.set_metadata({"title": o["case_title"] or "Bundle", "author": o["filed_by"] or "", "subject": o["case_no"] or "", "producer": "LexAmplify Document Hub"})
        progress(0.95, "Saving")
        out.save(out_path, garbage=4, deflate=True)
        out.close()
    finally:
        for d in opened:
            with contextlib.suppress(Exception):
                d.close()
        if created_workdir:
            shutil.rmtree(workdir, ignore_errors=True)
    warnings = []
    if face.lost:
        warnings.append("Some characters in the titles could not be printed with the fonts on this server and appear as “?”. Install a Unicode font (set DMS_PDF_FONT) to print them.")
    progress(1.0, "Done")
    return {"pages": cover_n + index_n + len(nums), "numbered": total_numbered, "index_pages": index_n, "cover_pages": cover_n,
            "entries": [{k: v for k, v in e.items() if k not in ("plan", "pages")} for e in entries], "warnings": warnings}
