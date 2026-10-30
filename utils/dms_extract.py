"""
utils/dms_extract.py - file-type detection and text extraction for the Document Hub.

Design rules (they are what keeps search honest):
  * The file's real type comes from its bytes, never from its extension or upload MIME.
  * A page is only called "searchable" if real text came out of it. A scanned page with no
    OCR engine available is reported as unreadable, never silently indexed as empty.
  * Garbage text layers (broken font encodings, common with legacy Indian-language PDFs)
    are detected and treated like scans, so OCR is used instead of indexing gibberish.
  * Nothing here calls an AI model. Extraction is deterministic and repeatable.
"""
import contextlib
import functools
import hashlib
import os
import re
import shutil
import time
import zipfile
from dataclasses import dataclass, field

# ── limits (env-tunable) ─────────────────────────────────────────────────────────────
OCR_MAX_PAGES = int(os.getenv("DMS_OCR_MAX_PAGES", "120"))
OCR_DPI = int(os.getenv("DMS_OCR_DPI", "200"))
OCR_PAGE_TIMEOUT = int(os.getenv("DMS_OCR_PAGE_TIMEOUT", "90"))
EXTRACT_BUDGET_S = int(os.getenv("DMS_EXTRACT_BUDGET_S", "600"))
MAX_TEXT_CHARS = int(os.getenv("DMS_MAX_TEXT_CHARS", "6000000"))
MAX_ZIP_UNCOMPRESSED = 500 * 1024 * 1024
SECTION_TARGET = 2800

BLOCKED_EXT = {
    "exe", "dll", "bat", "cmd", "com", "msi", "scr", "vbs", "vbe", "js", "jse", "wsf", "wsh", "ps1",
    "psm1", "sh", "bash", "jar", "apk", "app", "pif", "lnk", "cpl", "hta", "reg", "msc", "gadget",
    "so", "dylib", "bin", "elf", "appimage", "deb", "rpm", "dmg", "pkg",
}
MEDIA_EXT = {"mp3", "wav", "m4a", "aac", "amr", "opus", "ogg", "flac", "wma", "mp4", "mov", "avi",
             "mkv", "webm", "3gp", "m4v", "wmv"}
LEGACY_OFFICE_EXT = {"doc", "xls", "ppt", "msg", "wps", "pub", "vsd"}
IMAGE_MAGIC = (
    (b"\x89PNG\r\n\x1a\n", "png", "image/png"),
    (b"\xff\xd8\xff", "jpg", "image/jpeg"),
    (b"II*\x00", "tif", "image/tiff"),
    (b"MM\x00*", "tif", "image/tiff"),
    (b"GIF87a", "gif", "image/gif"),
    (b"GIF89a", "gif", "image/gif"),
    (b"BM", "bmp", "image/bmp"),
)

MIME = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "txt": "text/plain", "html": "text/html", "eml": "message/rfc822", "rtf": "application/rtf",
    "png": "image/png", "jpg": "image/jpeg", "tif": "image/tiff", "gif": "image/gif",
    "bmp": "image/bmp", "webp": "image/webp",
}

# Kinds that the browser may render inline. Everything else is always sent as a download.
INLINE_SAFE = {"pdf", "png", "jpg", "gif", "bmp", "webp"}


@dataclass
class Sniffed:
    kind: str            # pdf docx xlsx pptx image text html eml rtf legacy media archive other
    ext: str             # canonical extension for the *real* type
    mime: str
    blocked: bool = False
    reason: str = ""
    claimed_ext: str = ""
    mismatch: bool = False


@dataclass
class Extracted:
    pages: list = field(default_factory=list)      # [(page_no, text)]
    page_count: int = 0
    status: str = "ready"                          # ready ready_partial needs_ocr empty unsupported failed
    method: str = ""
    page_kind: str = "page"                        # page | section | sheet | slide
    ocr_pages: int = 0
    unreadable_pages: int = 0                      # could not be read (no OCR available, OCR crashed, time limit)
    blank_pages: int = 0                           # OCR ran fine and found (almost) nothing: blank or handwritten
    ocr_confidence: float | None = None
    warnings: list = field(default_factory=list)
    error: str | None = None
    fixable_by_ocr: bool = False
    ocr_texts: list = field(default_factory=list, repr=False)   # text that came from OCR (for the language sanity check)

    @property
    def text(self):
        return "\n\n".join(t for _, t in self.pages)


# ── type detection ───────────────────────────────────────────────────────────────────
def _ext_of(filename):
    name = os.path.basename(filename or "")
    return name.rsplit(".", 1)[-1].lower() if "." in name else ""


def _looks_like_text(head):
    if not head or b"\x00" in head:
        # UTF-16 with BOM legitimately contains NULs
        return head[:2] in (b"\xff\xfe", b"\xfe\xff")
    for enc in ("utf-8", "cp1252"):
        try:
            s = head.decode(enc)
        except UnicodeDecodeError:
            continue
        ctrl = sum(1 for ch in s if ord(ch) < 32 and ch not in "\r\n\t\f")
        return ctrl / max(1, len(s)) < 0.02
    return False


def sniff(path, filename=""):
    claimed = _ext_of(filename)
    with open(path, "rb") as fh:
        head = fh.read(8192)

    # Executables are refused no matter what they are called.
    if head[:2] == b"MZ" or head[:4] == b"\x7fELF" or head[:2] == b"#!" or head[:4] in (
            b"\xcf\xfa\xed\xfe", b"\xca\xfe\xba\xbe", b"\xfe\xed\xfa\xce", b"\xfe\xed\xfa\xcf"):
        return Sniffed("other", claimed or "bin", "application/octet-stream", True,
                       "Executable programs cannot be stored in the Document Hub.", claimed)
    if claimed in BLOCKED_EXT:
        return Sniffed("other", claimed, "application/octet-stream", True,
                       f".{claimed} files (programs and scripts) cannot be stored in the Document Hub.", claimed)

    def done(kind, ext, mime=None):
        mm = bool(claimed) and claimed != ext and not (
            {claimed, ext} <= {"jpg", "jpeg"} or {claimed, ext} <= {"tif", "tiff"} or
            {claimed, ext} <= {"htm", "html"} or (kind == "text" and claimed in {"txt", "csv", "md", "log", "json", "xml"}))
        return Sniffed(kind, ext, mime or MIME.get(ext, "application/octet-stream"), False, "", claimed, mm)

    if head.lstrip(b"\x00\r\n\t ")[:5] == b"%PDF-" or b"%PDF-" in head[:1024]:
        return done("pdf", "pdf")
    if head[:4] == b"PK\x03\x04":
        with contextlib.suppress(Exception):
            with zipfile.ZipFile(path) as zf:
                names = set(zf.namelist())
            if "word/document.xml" in names:
                return done("docx", "docx")
            if "xl/workbook.xml" in names:
                return done("xlsx", "xlsx")
            if "ppt/presentation.xml" in names:
                return done("pptx", "pptx")
        return done("archive", claimed if claimed in {"zip", "odt", "ods", "odp", "epub"} else "zip", "application/zip")
    if head[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        return done("legacy", claimed if claimed in LEGACY_OFFICE_EXT else "doc", "application/x-ole-storage")
    for magic, ext, mime in IMAGE_MAGIC:
        if head.startswith(magic):
            return done("image", ext, mime)
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return done("image", "webp", "image/webp")
    if (head[:3] == b"ID3" or head[4:8] == b"ftyp" or head[:4] == b"OggS" or head[:4] == b"fLaC"
            or (head[:4] == b"RIFF" and head[8:12] in (b"WAVE", b"AVI ")) or head[:4] == b"\x1aE\xdf\xa3"
            or claimed in MEDIA_EXT):
        return done("media", claimed if claimed in MEDIA_EXT else "bin", "application/octet-stream")
    if head.lstrip()[:5] == b"{\\rtf":
        return done("rtf", "rtf")
    lowered = head[:600].lower()
    if b"<!doctype html" in lowered or b"<html" in lowered:
        return done("html", "html")
    if _looks_like_text(head):
        if claimed == "eml" or re.match(rb"(?im)^(from |received:|return-path:|mime-version:|delivered-to:|message-id:)", head):
            return done("eml", "eml")
        return done("text", "txt" if claimed not in {"csv", "md", "log", "json", "xml"} else claimed, "text/plain")
    return done("other", claimed or "bin", "application/octet-stream")


# ── OCR ──────────────────────────────────────────────────────────────────────────────
@functools.lru_cache(maxsize=1)
def ocr_engine():
    """{'available': bool, 'langs': 'eng+tam', 'installed': [...], 'reason': str}"""
    if not shutil.which("tesseract"):
        return {"available": False, "langs": "", "installed": [],
                "reason": "The Tesseract OCR program is not installed on this server."}
    try:
        import pytesseract  # noqa: F401
        from PIL import Image  # noqa: F401
    except Exception:
        return {"available": False, "langs": "", "installed": [],
                "reason": "Python packages pytesseract and Pillow are not installed."}
    try:
        installed = [l for l in pytesseract.get_languages(config="") if l not in ("osd", "snum")]
    except Exception:
        installed = ["eng"]
    wanted = os.getenv("DMS_OCR_LANGS", "").strip()
    if wanted:
        langs = [l for l in re.split(r"[+,\s]+", wanted) if l in installed]
    else:
        langs = [l for l in ("eng", "hin", "tam") if l in installed]
    if not langs:
        return {"available": False, "langs": "", "installed": installed,
                "reason": "Tesseract is installed but has no usable language data."}
    return {"available": True, "langs": "+".join(langs), "installed": installed, "reason": ""}


def _ocr_image(img):
    """OCR one PIL image. Returns (text, mean_confidence_0_100)."""
    import pytesseract
    from PIL import ImageOps
    os.environ.setdefault("OMP_THREAD_LIMIT", "1")
    eng = ocr_engine()
    g = ImageOps.autocontrast(img.convert("L"))
    data = pytesseract.image_to_data(g, lang=eng["langs"], config="--psm 3",
                                     output_type=pytesseract.Output.DICT, timeout=OCR_PAGE_TIMEOUT)
    lines, order, confs = {}, [], []
    for i, word in enumerate(data["text"]):
        word = (word or "").strip()
        if not word:
            continue
        k = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        if k not in lines:
            lines[k] = []
            order.append(k)
        lines[k].append(word)
        with contextlib.suppress(ValueError, TypeError):
            c = float(data["conf"][i])
            if c >= 0:
                confs.append(c)
    text = "\n".join(" ".join(lines[k]) for k in order)
    return text, (sum(confs) / len(confs) if confs else 0.0)


# ── text quality ─────────────────────────────────────────────────────────────────────
_CID = re.compile(r"\(cid:\d+\)")
_INDIC = re.compile(r"[\u0900-\u0dff]")


def usable_text(text):
    """True if text looks like real language rather than a broken font map."""
    s = (text or "").strip()
    if len(s) < 25:
        return False
    if len(_CID.findall(s)) > 3:
        return False
    body = re.sub(r"\s+", "", s)
    if not body:
        return False
    if body.count("\ufffd") / len(body) > 0.04:
        return False
    good = sum(1 for ch in body if ch.isalnum() or ch in ".,;:()-/&'\"%@₹$#?!" or _INDIC.match(ch))
    return good / len(body) >= 0.70


def normalize_for_hash(text):
    return re.sub(r"\s+", " ", (text or "").lower()).strip()


def text_hash(text):
    n = normalize_for_hash(text)
    return hashlib.sha256(n[:400000].encode("utf-8", "ignore")).hexdigest() if len(n) >= 80 else None


def chunk_text(text, kind="section", target=SECTION_TARGET):
    text = (text or "").strip()
    if not text:
        return []
    paras = re.split(r"\n\s*\n", text)
    out, buf = [], ""
    for p in paras:
        if buf and len(buf) + len(p) > target:
            out.append(buf.strip())
            buf = ""
        if len(p) > target * 2:  # one enormous paragraph - hard split on sentence-ish boundaries
            for i in range(0, len(p), target):
                out.append(p[i:i + target].strip())
            continue
        buf += ("\n\n" if buf else "") + p
    if buf.strip():
        out.append(buf.strip())
    return [(i + 1, t) for i, t in enumerate(out)]


# ── extractors ───────────────────────────────────────────────────────────────────────
def _pymupdf():
    try:
        import pymupdf
        return pymupdf
    except ImportError:
        try:
            import fitz
            return fitz
        except ImportError:
            return None


def _image_cover(fitz, page):
    """Fraction of the page area covered by embedded pictures (0..1)."""
    try:
        area = page.rect.width * page.rect.height
        if not area:
            return 0.0
        covered = 0.0
        for info in page.get_image_info():
            r = fitz.Rect(info["bbox"]) & page.rect
            covered += max(0.0, r.width) * max(0.0, r.height)
        return min(1.0, covered / area)
    except Exception:
        return 0.0


_PATHISH = re.compile(r"(?:[A-Za-z]:\\[^\s'\"),;]+|/(?:[\w.\-@ ]+/)+[\w.\-@]*|'[^']*(?:/|\\)[^']*')")


def why(exc, limit=120):
    """A short, path-free reason taken from an exception, safe to show to a user (store paths and the like are removed)."""
    text = _PATHISH.sub("the file", " ".join(str(exc).split()))
    text = re.sub(r"(the file[ ,:]*)+", "the file ", text).strip(" :,-")
    return text[:limit]


def _extract_pdf(path, use_ocr, started):
    res = Extracted(method="pdf")
    fitz = _pymupdf()
    if fitz is None:
        return _extract_pdf_fallback(path, res)
    try:
        doc = fitz.open(path)
    except Exception:
        res.status, res.error = "failed", "This PDF could not be opened. It may be damaged, or not really a PDF."
        return res
    with contextlib.closing(doc):
        if doc.needs_pass:
            res.status, res.error = "failed", "This PDF is password-protected. Remove the password and upload it again."
            return res
        res.page_count = doc.page_count
        if doc.page_count == 0:
            res.status, res.error = "failed", "This PDF has no readable pages. It is probably damaged - open it in a PDF viewer, re-save it and upload again."
            return res
        eng = ocr_engine() if use_ocr else {"available": False}
        confs, ocr_budget = [], OCR_MAX_PAGES
        for i in range(doc.page_count):
            if time.time() - started > EXTRACT_BUDGET_S:
                res.warnings.append(f"Stopped after {i} pages: processing time limit reached.")
                res.unreadable_pages += doc.page_count - i
                break
            page = doc.load_page(i)
            text = page.get_text("text") or ""
            good = usable_text(text)
            # A short page is a scan only if a picture covers most of it; a signature page with a
            # small stamp or logo is just a short page.
            short_not_scan = len(text.strip()) < 25 and _image_cover(fitz, page) < 0.35
            if good or short_not_scan:
                if text.strip():
                    res.pages.append((i + 1, text))
                continue
            # scanned page, or a text layer that is garbage: OCR it if we can
            if eng.get("available") and ocr_budget > 0:
                try:
                    scale = OCR_DPI / 72.0
                    rect = page.rect
                    scale = min(scale, 3800.0 / max(rect.width, rect.height))
                    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
                    from PIL import Image
                    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
                    otext, conf = _ocr_image(img)
                    ocr_budget -= 1
                    alnum = sum(1 for ch in otext if ch.isalnum())
                    if usable_text(otext) or len(otext.strip()) >= 25 or (alnum >= 4 and conf >= 55):
                        res.pages.append((i + 1, otext))
                        res.ocr_pages += 1
                        res.ocr_texts.append(otext)
                        confs.append(conf)
                    else:
                        res.blank_pages += 1          # a blank back-side is not a failure
                    continue
                except Exception as exc:  # timeout / tesseract crash on one page must not lose the document
                    res.warnings.append(f"OCR failed on page {i + 1}: {why(exc, 80)}")
            res.unreadable_pages += 1
        if confs:
            res.ocr_confidence = round(sum(confs) / len(confs), 1)
        repaired = bool(getattr(doc, "is_repaired", False))      # the file's structure was broken (cut off / damaged) and MuPDF rebuilt it
    _finish_pages(res, eng if use_ocr else {"available": False})
    if repaired and res.status != "failed":
        res.warnings.append("This PDF is damaged (possibly cut off during copying or upload) and was repaired while reading. "
                            "Some pages or text may be missing - compare it with the original and upload a complete copy.")
        if res.status == "ready" and len(res.pages) < (res.page_count or 0):
            res.status = "ready_partial"
    return res


def _extract_pdf_fallback(path, res):
    """Used only when PyMuPDF is missing (it is in requirements.txt). No OCR in this path."""
    try:
        import pdfplumber
    except ImportError:
        res.status, res.error = "failed", "No PDF library is installed on the server (PyMuPDF or pdfplumber)."
        return res
    try:
        with pdfplumber.open(path) as pdf:
            res.page_count = len(pdf.pages)
            res.method = "pdfplumber"
            for i, page in enumerate(pdf.pages):
                text = page.extract_text() or ""
                if usable_text(text):
                    res.pages.append((i + 1, text))
                elif page.images:
                    res.unreadable_pages += 1
                elif text.strip():
                    res.pages.append((i + 1, text))
    except Exception as exc:
        res.status, res.error = "failed", f"This PDF could not be read ({why(exc, 120)})."
        return res
    _finish_pages(res, {"available": False})
    return res


_EN_STOP = frozenset("the of and to in is that for on with as by be this at or are was it from which not shall any an has have been his her their "
                     "he she they we you will would may under before after case court order date said notice petitioner respondent".split())


def looks_like_latin_garbage(text):
    """True only when a fair amount of text is clearly NOT English words: almost no common English words AND mostly
    one/two-letter or vowel-less fragments. Conservative on purpose - a numbers-heavy or short English page never trips it."""
    toks = re.findall(r"[^\W\d_]+", text or "")
    if len(toks) < 40:
        return False
    low = [t.lower() for t in toks]
    stop = sum(1 for t in low if t in _EN_STOP) / len(low)
    tiny = sum(1 for t in low if len(t) <= 2) / len(low)
    wordlike = sum(1 for t in low if len(t) >= 3 and re.search(r"[aeiouy]", t) and not re.search(r"[^aeiouy]{5,}", t)) / len(low)
    return stop < 0.04 and tiny > 0.40 and wordlike < 0.45


def _indic_ocr_warning(res, eng):
    if not res.ocr_texts or not eng.get("available"):
        return
    have = set((eng.get("langs") or "").split("+"))
    missing = [n for code, n in (("hin", "Hindi"), ("tam", "Tamil")) if code not in have]
    if missing and looks_like_latin_garbage("\n".join(res.ocr_texts)):
        res.warnings.append(f"The text read from this scan looks like gibberish. If the document is in {' or '.join(missing)} or another Indian language, "
                            f"the server's OCR has no {'/'.join(missing)} language data installed (it only reads {eng.get('langs') or 'English'}), "
                            f"so the extracted text and search results are not reliable. Ask the administrator to install the Tesseract language packs.")


def _finish_pages(res, eng):
    real = [(n, t) for n, t in res.pages if t.strip()]
    res.pages = real
    if res.unreadable_pages and not real:
        res.status = "needs_ocr"
        res.fixable_by_ocr = True
    elif res.unreadable_pages:
        res.status = "ready_partial"
        res.fixable_by_ocr = True
    elif not real:
        res.status = "empty"
        res.error = res.error or ("No readable text was found (blank pages, or handwriting that OCR cannot read)."
                                  if res.blank_pages else "No text was found in this file (blank pages or an empty document).")
    else:
        res.status = "ready"
    if res.blank_pages and real:
        res.warnings.append(f"{res.blank_pages} page(s) had no readable text (blank, or handwriting that OCR cannot read).")
    if res.unreadable_pages and not eng.get("available"):
        res.warnings.append(f"{res.unreadable_pages} page(s) are scans with no text layer and cannot be searched "
                            f"until OCR is available.")
    elif res.unreadable_pages:
        res.warnings.append(f"{res.unreadable_pages} page(s) could not be read even with OCR (blank, too faint or handwritten).")
    if res.ocr_confidence is not None and res.ocr_confidence < 60:
        res.warnings.append(f"OCR confidence is low ({res.ocr_confidence:.0f}%). Check important passages against the original.")
    with contextlib.suppress(Exception):
        _indic_ocr_warning(res, eng)


def _zip_guard(path):
    with zipfile.ZipFile(path) as zf:
        total = sum(i.file_size for i in zf.infolist())
    if total > MAX_ZIP_UNCOMPRESSED:
        raise ValueError("Archive expands to an unsafe size and was not opened.")


def _extract_docx(path):
    res = Extracted(method="docx", page_kind="section")
    try:
        _zip_guard(path)
        import docx
        from docx.table import Table
        from docx.text.paragraph import Paragraph
        d = docx.Document(path)
        parts = []
        for section in d.sections:
            for hf in (section.header, section.first_page_header):
                with contextlib.suppress(Exception):
                    t = "\n".join(p.text for p in hf.paragraphs if p.text.strip())
                    if t and t not in parts:
                        parts.append(t)
        for child in d.element.body.iterchildren():
            tag = child.tag.rsplit("}", 1)[-1]
            if tag == "p":
                t = Paragraph(child, d).text
                if t.strip():
                    parts.append(t)
            elif tag == "tbl":
                tbl = Table(child, d)
                for row in tbl.rows:
                    seen, cells = set(), []
                    for c in row.cells:
                        if id(c._tc) in seen:
                            continue
                        seen.add(id(c._tc))
                        if c.text.strip():
                            cells.append(c.text.strip().replace("\n", " "))
                    if cells:
                        parts.append(" | ".join(cells))
    except Exception as exc:
        res.status, res.error = "failed", f"This Word file could not be read ({why(exc, 120)}). It may be damaged or password-protected."
        return res
    res.pages = chunk_text("\n\n".join(parts))
    res.page_count = len(res.pages)
    res.status = "ready" if res.pages else "empty"
    return res


def _extract_xlsx(path):
    res = Extracted(method="xlsx", page_kind="sheet")
    try:
        _zip_guard(path)
        import openpyxl
    except ImportError:
        res.status = "unsupported"
        res.error = "Excel search needs the openpyxl package on the server."
        return res
    except Exception as exc:
        res.status, res.error = "failed", why(exc, 160)
        return res
    try:
        # Stored files are named by their hash and have no extension; openpyxl decides the format from
        # the extension when given a path, so hand it an open file instead.
        with open(path, "rb") as fh:
            wb = openpyxl.load_workbook(fh, read_only=True, data_only=True)
            cells_left = 300000
            for idx, ws in enumerate(wb.worksheets, start=1):
                lines = []
                for row in ws.iter_rows(values_only=True):
                    vals = [str(v).strip() for v in row if v is not None and str(v).strip() != ""]
                    if vals:
                        lines.append(" | ".join(vals))
                        cells_left -= len(vals)
                    if cells_left <= 0:
                        res.warnings.append("Very large spreadsheet: only the first part was indexed.")
                        break
                if lines:
                    res.pages.append((idx, f"[Sheet: {ws.title}]\n" + "\n".join(lines)))
                if cells_left <= 0:
                    break
            res.page_count = len(wb.worksheets)
            wb.close()
    except Exception as exc:
        res.status, res.error = "failed", f"This spreadsheet could not be read ({why(exc, 120)})."
        return res
    res.status = "ready" if res.pages else "empty"
    return res


def _extract_pptx(path):
    res = Extracted(method="pptx", page_kind="slide")
    try:
        _zip_guard(path)
        with zipfile.ZipFile(path) as zf:
            slides = sorted((n for n in zf.namelist() if re.match(r"ppt/slides/slide\d+\.xml$", n)),
                            key=lambda n: int(re.findall(r"\d+", n)[-1]))
            for i, name in enumerate(slides, start=1):
                xml = zf.read(name).decode("utf-8", "ignore")
                txt = " ".join(re.findall(r"<a:t>([^<]*)</a:t>", xml))
                txt = re.sub(r"&amp;", "&", re.sub(r"&lt;", "<", re.sub(r"&gt;", ">", txt))).strip()
                if txt:
                    res.pages.append((i, txt))
            res.page_count = len(slides)
    except Exception as exc:
        res.status, res.error = "failed", f"This presentation could not be read ({why(exc, 120)})."
        return res
    res.status = "ready" if res.pages else "empty"
    return res


def _decode(raw):
    if raw[:3] == b"\xef\xbb\xbf":
        return raw[3:].decode("utf-8", "replace")
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return raw.decode("utf-16", "replace")
    for enc in ("utf-8", "cp1252"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            pass
    return raw.decode("latin-1", "replace")


def _extract_text_like(path, kind):
    res = Extracted(method=kind, page_kind="section")
    try:
        with open(path, "rb") as fh:
            raw = fh.read(20 * 1024 * 1024)
        text = _decode(raw)
        if kind == "html":
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(text, "html.parser")
            for t in soup(["script", "style", "noscript"]):
                t.decompose()
            text = soup.get_text("\n")
        elif kind == "rtf":
            text = re.sub(r"\{\\\*[^{}]*\}", "", text)
            text = re.sub(r"\\'([0-9a-fA-F]{2})", lambda m: bytes.fromhex(m.group(1)).decode("cp1252", "replace"), text)
            text = re.sub(r"\\(par|line|tab)\b ?", "\n", text)
            text = re.sub(r"\\[a-zA-Z]+-?\d* ?", "", text)
            text = re.sub(r"[{}]", "", text)
        elif kind == "eml":
            import email
            from email import policy
            msg = email.message_from_bytes(raw, policy=policy.default)
            head = "\n".join(f"{h}: {msg[h]}" for h in ("From", "To", "Cc", "Date", "Subject") if msg[h])
            body_part = msg.get_body(preferencelist=("plain", "html"))
            body = ""
            if body_part is not None:
                body = body_part.get_content()
                if body_part.get_content_type() == "text/html":
                    from bs4 import BeautifulSoup
                    body = BeautifulSoup(body, "html.parser").get_text("\n")
            atts = [p.get_filename() for p in msg.iter_attachments() if p.get_filename()]
            text = head + "\n\n" + body + (("\n\nAttachments: " + ", ".join(atts)) if atts else "")
        text = re.sub(r"\r\n?", "\n", text)
        text = re.sub(r"[ \t]+\n", "\n", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
    except Exception as exc:
        res.status, res.error = "failed", f"This file could not be read ({why(exc, 120)})."
        return res
    res.pages = chunk_text(text)
    res.page_count = len(res.pages)
    res.status = "ready" if res.pages else "empty"
    return res


def _extract_image(path, use_ocr, started):
    res = Extracted(method="image")
    try:
        from PIL import Image
    except ImportError:
        res.status, res.error = "failed", "Pillow is not installed on the server."
        return res
    Image.MAX_IMAGE_PIXELS = 200_000_000  # decompression-bomb guard
    try:
        img = Image.open(path)
        frames = getattr(img, "n_frames", 1)
    except Exception as exc:
        res.status, res.error = "failed", f"This image could not be opened ({why(exc, 100)})."
        return res
    res.page_count = frames
    eng = ocr_engine() if use_ocr else {"available": False}
    if not eng.get("available"):
        res.unreadable_pages = frames
        _finish_pages(res, eng)
        return res
    confs = []
    for i in range(min(frames, OCR_MAX_PAGES)):
        if time.time() - started > EXTRACT_BUDGET_S:
            res.warnings.append("Stopped early: processing time limit reached.")
            break
        try:
            img.seek(i)
            frame = img.convert("RGB")
            frame.thumbnail((4000, 4000))
            otext, conf = _ocr_image(frame)
            alnum = sum(1 for ch in otext if ch.isalnum())
            if len(otext.strip()) >= 8 or (alnum >= 4 and conf >= 55):
                res.pages.append((i + 1, otext))
                res.ocr_pages += 1
                res.ocr_texts.append(otext)
                confs.append(conf)
            else:
                res.blank_pages += 1
        except Exception as exc:
            res.warnings.append(f"OCR failed on frame {i + 1}: {why(exc, 80)}")
            res.unreadable_pages += 1
    if frames > OCR_MAX_PAGES:
        res.unreadable_pages += frames - OCR_MAX_PAGES
    if confs:
        res.ocr_confidence = round(sum(confs) / len(confs), 1)
    _finish_pages(res, eng)
    return res


def extract(path, sniffed, use_ocr=True):
    """Extract searchable text. Never raises; problems come back as status/error."""
    started = time.time()
    kind = sniffed.kind
    try:
        if kind == "pdf":
            res = _extract_pdf(path, use_ocr, started)
        elif kind == "docx":
            res = _extract_docx(path)
        elif kind == "xlsx":
            res = _extract_xlsx(path)
        elif kind == "pptx":
            res = _extract_pptx(path)
        elif kind in ("text", "html", "eml", "rtf"):
            res = _extract_text_like(path, kind)
        elif kind == "image":
            res = _extract_image(path, use_ocr, started)
        elif kind == "legacy":
            res = Extracted(method="legacy", status="unsupported",
                            error=f"Old .{sniffed.ext} format is stored but not searchable. Save it as .docx or PDF and upload that.")
        elif kind == "media":
            res = Extracted(method="media", status="unsupported", error="Audio and video files are stored but not searchable.")
        else:
            res = Extracted(method=kind, status="unsupported", error="This file type is stored but not searchable.")
    except Exception as exc:  # last-resort guard: one bad file must never take down the worker
        res = Extracted(method=kind, status="failed", error=f"Unexpected error while reading this file: {why(exc, 140)}")
    total = 0
    trimmed = []
    for n, t in res.pages:
        if total + len(t) > MAX_TEXT_CHARS:
            res.warnings.append("Very long document: only the first part was indexed for search.")
            break
        trimmed.append((n, t))
        total += len(t)
    res.pages = trimmed
    return res
