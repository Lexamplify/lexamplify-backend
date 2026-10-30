"""
utils/dms_scan.py - from a pile of paper to clean, separate, named documents.

What a lawyer does: photograph a stack of papers with a phone (or feed it through a scanner, which gives one PDF), and expect
separate, straight, readable, correctly named documents filed on the right case. The steps, all real and local (no AI service):

  1. every picture is straightened: the page is found in the photo and cropped (perspective corrected), small tilts removed,
     sideways / upside-down pages turned upright (Tesseract orientation detection), shadows and a yellow cast taken out
  2. every page is read (OCR) and written as a one-page searchable PDF, so the finished document is searchable immediately
  3. blank pages (the empty backs of double-sided scans) are set aside; a printed separator sheet - or a new case number, a
     "Page 1 of n" line, or a heading that looks like the first page of something - starts a new document
  4. each document gets a proposed name, type and case, with the reasons, for the person to confirm or change

Every decision is only a PROPOSAL: the person sees the documents, can cut / join / reorder / rotate / drop pages, and nothing
is filed until they press the button.
"""
import contextlib
import json
import os
import re
import shutil
import threading
import time
import traceback

try:
    import pymupdf as fitz
except ImportError:  # pragma: no cover
    import fitz

try:
    from utils import dms_classify as C, dms_extract as X, dms_files as F, dms_index as I, dms_store as S
except ImportError:  # pragma: no cover
    import dms_classify as C, dms_extract as X, dms_files as F, dms_index as I, dms_store as S

MAX_SIDE = 3300                 # longest edge of the stored clean image (A4 at ~280 dpi)
VIEW_SIDE = 1300
THUMB_SIDE = 340
MAX_PAGES_PER_SESSION = int(os.getenv("DMS_SCAN_MAX_PAGES", "600"))
MAX_IMAGE_BYTES = 45 * 1024 * 1024
MAX_PIXELS = 150_000_000
IMAGE_EXT = {"jpg", "jpeg", "png", "bmp", "webp", "tif", "tiff", "gif"}
SEPARATOR_PAYLOAD = "LEXAMPLIFY-SEPARATOR-v1"
SESSION_TTL_DAYS = 3
OCR_DPI = 280


class ScanError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message, self.status = message, status


def _np():
    try:
        import numpy as np
    except ImportError as exc:  # pragma: no cover - only on a server installed without requirements.txt
        raise ScanError("Page cleaning needs the numpy package on the server (pip install numpy opencv-python-headless).", 503) from exc
    return np


def _cv():
    try:
        import cv2
    except ImportError as exc:  # pragma: no cover
        raise ScanError("Page cleaning needs the opencv-python-headless package on the server (pip install opencv-python-headless).", 503) from exc
    return cv2


# ── folders ──────────────────────────────────────────────────────────────────────────
def scan_root():
    p = os.path.join(S.storage_root(), "_scan")
    os.makedirs(p, exist_ok=True)
    return p


def session_dir(sid):
    if not re.fullmatch(r"[A-Za-z0-9_\-]{8,40}", sid or ""):
        raise ScanError("Scan not found.", 404)
    return os.path.join(scan_root(), sid)


def page_paths(sid, pid):
    d = session_dir(sid)
    return {"raw": None, "clean": os.path.join(d, f"p{pid}.jpg"), "view": os.path.join(d, f"p{pid}.view.jpg"),
            "thumb": os.path.join(d, f"p{pid}.th.jpg"), "pdf": os.path.join(d, f"p{pid}.pdf")}


# ── image steps ──────────────────────────────────────────────────────────────────────
def load_image(path, max_side=MAX_SIDE):
    """BGR numpy image, EXIF-rotated, no larger than max_side."""
    from PIL import Image, ImageOps
    np, cv2 = _np(), _cv()
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    try:
        with Image.open(path) as im:
            if im.width * im.height > MAX_PIXELS:
                raise ScanError("That picture is too large to process.")
            im = ImageOps.exif_transpose(im)
            if im.mode in ("RGBA", "LA", "P"):
                bg = Image.new("RGB", im.size, "white")
                im = im.convert("RGBA")
                bg.paste(im, mask=im.split()[-1])
                im = bg
            elif im.mode != "RGB":
                im = im.convert("RGB")
            if max(im.size) > max_side * 1.5:                    # cut huge phone photos down early: faster everything after
                im.thumbnail((max_side * 1.5, max_side * 1.5), Image.LANCZOS)
            arr = np.asarray(im)
    except ScanError:
        raise
    except Exception as exc:
        raise ScanError(f"This picture could not be opened ({str(exc)[:60]}).")
    return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)


def _order_quad(pts):
    np = _np()
    pts = np.array(pts, dtype="float32").reshape(4, 2)
    s, d = pts.sum(axis=1), np.diff(pts, axis=1).reshape(-1)
    return np.array([pts[s.argmin()], pts[d.argmin()], pts[s.argmax()], pts[d.argmax()]], dtype="float32")   # tl, tr, br, bl


def find_page_quad(img):
    """The four corners of the sheet of paper in a photo, or None when the picture already IS the page (a flatbed scan) or the
    page cannot be told from its surroundings. Never guesses wildly: an implausible shape means 'leave the picture alone'."""
    np, cv2 = _np(), _cv()
    h, w = img.shape[:2]
    scale = 700.0 / max(h, w)
    small = cv2.resize(img, (max(1, int(w * scale)), max(1, int(h * scale))), interpolation=cv2.INTER_AREA)
    gray = cv2.GaussianBlur(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY), (9, 9), 0)
    _t, th = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    th = cv2.morphologyEx(th, cv2.MORPH_CLOSE, np.ones((17, 17), np.uint8))
    th = cv2.morphologyEx(th, cv2.MORPH_OPEN, np.ones((9, 9), np.uint8))
    cnts, _h = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return None
    c = max(cnts, key=cv2.contourArea)
    ratio = cv2.contourArea(c) / float(small.shape[0] * small.shape[1])
    if ratio < 0.22 or ratio > 0.94:
        return None
    peri = cv2.arcLength(c, True)
    approx = cv2.approxPolyDP(c, 0.02 * peri, True)
    if len(approx) == 4 and cv2.isContourConvex(approx):
        quad = approx.reshape(4, 2)
    else:
        quad = cv2.boxPoints(cv2.minAreaRect(c))
    quad = _order_quad(quad)
    wd = max(np.linalg.norm(quad[1] - quad[0]), np.linalg.norm(quad[2] - quad[3]))
    ht = max(np.linalg.norm(quad[3] - quad[0]), np.linalg.norm(quad[2] - quad[1]))
    if wd < 50 or ht < 50:
        return None
    asp = wd / ht
    if not 0.35 <= asp <= 2.9:
        return None
    # the quad must be mostly inside the picture and roughly rectangular (opposite sides alike)
    top, bot = np.linalg.norm(quad[1] - quad[0]), np.linalg.norm(quad[2] - quad[3])
    lef, rig = np.linalg.norm(quad[3] - quad[0]), np.linalg.norm(quad[2] - quad[1])
    if min(top, bot) / max(top, bot) < 0.6 or min(lef, rig) / max(lef, rig) < 0.6:
        return None
    return quad / scale


def warp_page(img, quad):
    np, cv2 = _np(), _cv()
    q = _order_quad(quad)
    wd = int(max(np.linalg.norm(q[1] - q[0]), np.linalg.norm(q[2] - q[3])))
    ht = int(max(np.linalg.norm(q[3] - q[0]), np.linalg.norm(q[2] - q[1])))
    dst = np.array([[0, 0], [wd - 1, 0], [wd - 1, ht - 1], [0, ht - 1]], dtype="float32")
    return cv2.warpPerspective(img, cv2.getPerspectiveTransform(q, dst), (wd, ht), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def _ink(gray):
    cv2 = _cv()
    h, w = gray.shape[:2]
    k = max(15, (min(h, w) // 12) | 1)
    return cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, k, 14)


def estimate_skew(gray, limit=10.0):
    """Tilt of the text lines in degrees (positive = counter-clockwise), found by sharpening the horizontal projection profile."""
    np, cv2 = _np(), _cv()
    h, w = gray.shape[:2]
    s = 900.0 / max(h, w)
    small = cv2.resize(gray, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA) if s < 1 else gray.copy()
    ink = _ink(small)
    mh, mw = ink.shape
    ink = ink[int(mh * .04):int(mh * .96), int(mw * .04):int(mw * .96)]
    if ink.sum() < 255 * 400:
        return 0.0

    def score(a):
        r = cv2.warpAffine(ink, cv2.getRotationMatrix2D((ink.shape[1] / 2, ink.shape[0] / 2), a, 1.0), (ink.shape[1], ink.shape[0]), flags=cv2.INTER_NEAREST)
        prof = r.sum(axis=1).astype("float64")
        return float(np.sum(np.diff(prof) ** 2))

    base = score(0.0)
    best_a, best = 0.0, base
    a = -limit
    while a <= limit + 1e-9:
        sc = score(a)
        if sc > best:
            best_a, best = a, sc
        a += 0.5
    a = best_a - 0.5
    while a <= best_a + 0.5 + 1e-9:
        sc = score(a)
        if sc > best:
            best_a, best = a, sc
        a += 0.1
    if abs(best_a) < 0.35 or best < base * 1.04:
        return 0.0
    return round(best_a, 2)


def rotate_free(img, angle):
    cv2 = _cv()
    h, w = img.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    return cv2.warpAffine(img, m, (w, h), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


def flatten(img):
    """Take out shadows and the colour of the light: divide by an estimate of the paper's own brightness. Colour is kept only
    when the page really carries colour (a stamp, a blue signature, a letterhead); otherwise the result is clean grayscale."""
    np, cv2 = _np(), _cv()
    h, w = img.shape[:2]
    k = max(21, (min(h, w) // 25) | 1)
    s = 0.25
    small = cv2.resize(img, (max(8, int(w * s)), max(8, int(h * s))), interpolation=cv2.INTER_AREA)
    ks = max(5, (int(k * s)) | 1)
    chans = []
    for ch in cv2.split(small):
        bg = cv2.morphologyEx(ch, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ks, ks)))
        bg = cv2.GaussianBlur(bg, (0, 0), ks / 2.0)
        chans.append(cv2.resize(bg, (w, h), interpolation=cv2.INTER_LINEAR))
    out = cv2.merge([cv2.divide(c, np.maximum(b, 1), scale=255) for c, b in zip(cv2.split(img), chans)])
    out = cv2.convertScaleAbs(out, alpha=1.12, beta=-14)
    hsv = cv2.cvtColor(out, cv2.COLOR_BGR2HSV)
    colourful = float(np.mean((hsv[..., 1] > 70) & (hsv[..., 2] > 60) & (hsv[..., 2] < 245)))
    if colourful > 0.006:
        return out, True
    return cv2.cvtColor(out, cv2.COLOR_BGR2GRAY), False


def is_blank_image(gray_or_bgr):
    """True only for a page with nothing on it (the empty back of a double-sided sheet). A page with one line of text, a stamp or a
    lone signature is NOT blank - dropping a real page is the worst mistake this tool could make - so this looks for marks that are
    big enough to be letters or strokes, not for the amount of ink: scanner dust and paper grain are tiny specks, text is not."""
    cv2 = _cv()
    g = gray_or_bgr if gray_or_bgr.ndim == 2 else cv2.cvtColor(gray_or_bgr, cv2.COLOR_BGR2GRAY)
    h, w = g.shape
    g = g[int(h * .03):int(h * .97), int(w * .03):int(w * .97)]
    s = 700.0 / max(g.shape)
    g = cv2.resize(g, (max(1, int(g.shape[1] * s)), max(1, int(g.shape[0] * s))), interpolation=cv2.INTER_AREA)
    dark = (g < 165).astype("uint8")
    n, _lab, stats, _c = cv2.connectedComponentsWithStats(dark, connectivity=8)
    areas = [int(stats[i, cv2.CC_STAT_AREA]) for i in range(1, n)]
    marks = [a for a in areas if a >= 5]
    return len(marks) < 4 and (max(areas) if areas else 0) < 70


_OSD = {}


def osd_available():
    """Tesseract's orientation data (osd.traineddata) is a separate download on some systems."""
    if "ok" not in _OSD:
        ok = False
        if X.ocr_engine().get("available"):
            with contextlib.suppress(Exception):
                import pytesseract
                ok = "osd" in pytesseract.get_languages(config="")
        _OSD["ok"] = ok
    return _OSD["ok"]


def osd_rotation(img):
    """Degrees (0/90/180/270) to turn the image CLOCKWISE so its text reads upright; (0, 0) when unknown or Tesseract's OSD is missing."""
    cv2 = _cv()
    if not osd_available():
        return 0, 0.0
    try:
        import pytesseract
        g = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        s = 1500.0 / max(g.shape)
        if s < 1:
            g = cv2.resize(g, (int(g.shape[1] * s), int(g.shape[0] * s)), interpolation=cv2.INTER_AREA)
        o = pytesseract.image_to_osd(g, config="--psm 0 -c min_characters_to_try=40", output_type=pytesseract.Output.DICT, timeout=40)
        return int(o.get("rotate", 0)) % 360, float(o.get("orientation_conf", 0))
    except Exception:
        return 0, 0.0


def rotate_90s(img, deg):
    cv2 = _cv()
    deg %= 360
    if deg == 90:
        return cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
    if deg == 180:
        return cv2.rotate(img, cv2.ROTATE_180)
    if deg == 270:
        return cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)
    return img


def find_separator(img):
    """True when the picture holds our printed separator sheet's QR code."""
    cv2 = _cv()
    try:
        g = img if img.ndim == 2 else cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        s = 1100.0 / max(g.shape)
        if s < 1:
            g = cv2.resize(g, (int(g.shape[1] * s), int(g.shape[0] * s)), interpolation=cv2.INTER_AREA)
        det = cv2.QRCodeDetector()
        data, _pts, _st = det.detectAndDecode(g)
        if data == SEPARATOR_PAYLOAD:
            return True
        data, _pts, _st = det.detectAndDecode(cv2.copyMakeBorder(g, 40, 40, 40, 40, cv2.BORDER_CONSTANT, value=255))
        return data == SEPARATOR_PAYLOAD
    except Exception:
        return False


def save_jpeg(img, path, quality=82):
    cv2 = _cv()
    cv2.imwrite(path, img, [int(cv2.IMWRITE_JPEG_QUALITY), quality, int(cv2.IMWRITE_JPEG_OPTIMIZE), 1])


def shrink(img, side):
    cv2 = _cv()
    h, w = img.shape[:2]
    s = float(side) / max(h, w)
    return cv2.resize(img, (max(1, int(w * s)), max(1, int(h * s))), interpolation=cv2.INTER_AREA) if s < 1 else img


def clean_photo(img, quality_notes):
    """Raw picture -> upright, cropped, straightened, flattened picture. quality_notes collects what was done / what could not be."""
    cropped = False
    quad = find_page_quad(img)
    if quad is not None:
        try:
            img = warp_page(img, quad)
            cropped = True
        except Exception:
            quality_notes.append("could not crop")
    img = shrink(img, MAX_SIDE)
    flat, coloured = flatten(img)
    g = flat if flat.ndim == 2 else _cv().cvtColor(flat, _cv().COLOR_BGR2GRAY)
    blank = is_blank_image(g)
    turned, conf = (0, 0.0)
    skew = 0.0
    if not blank:
        turned, conf = osd_rotation(g)
        if turned and conf >= 1.2:
            flat = rotate_90s(flat, turned)
            g = rotate_90s(g, turned)
        else:
            turned = 0
        skew = estimate_skew(g)
        if skew:
            flat = rotate_free(flat, skew)
    return flat, {"cropped": cropped, "turned": turned, "osd_conf": round(conf, 1), "skew": skew, "colour": coloured, "blank": blank}


# ── OCR + page pdf ───────────────────────────────────────────────────────────────────
def make_page_pdf(clean_path, out_pdf, ocr=True):
    """One-page PDF of the clean picture. With OCR the page carries an invisible text layer. Returns (text, ocr_ok)."""
    eng = X.ocr_engine()
    text = ""
    if ocr and eng.get("available"):
        try:
            import pytesseract
            data = pytesseract.image_to_pdf_or_hocr(clean_path, lang=eng["langs"], extension="pdf", config=f"--psm 3 --dpi {OCR_DPI}",
                                                    timeout=X.OCR_PAGE_TIMEOUT)
            doc = fitz.open("pdf", data)
            if doc.page_count:
                text = doc[0].get_text("text") or ""
                doc.save(out_pdf, garbage=4, deflate=True)
                doc.close()
                return text.strip(), True
            doc.close()
        except Exception:
            pass
    # no OCR: an image-only page, sized as an A4-ish sheet at the scan resolution
    from PIL import Image
    with Image.open(clean_path) as im:
        w, h = im.size
    pw, ph = w * 72.0 / OCR_DPI, h * 72.0 / OCR_DPI
    doc = fitz.open()
    page = doc.new_page(width=pw, height=ph)
    page.insert_image(page.rect, filename=clean_path)
    doc.save(out_pdf, garbage=4, deflate=True)
    doc.close()
    return "", False


def process_image_page(src_path, paths, ocr=True, extra_rot=0, reuse_clean=False):
    """Run the whole pipeline for one picture. Writes clean/view/thumb/pdf; returns the page's `info` dict (incl. 'text')."""
    notes = []
    if reuse_clean:
        img = load_image(paths["clean"], MAX_SIDE)
        info = {}
        img = rotate_90s(img, extra_rot) if extra_rot else img
        blank = is_blank_image(img)
        info.update({"blank": blank, "rot_manual": extra_rot})
        flat = img
    else:
        raw = load_image(src_path)
        flat, info = clean_photo(raw, notes)
        if extra_rot:
            flat = rotate_90s(flat, extra_rot)
        info["rot_manual"] = extra_rot
    save_jpeg(flat, paths["clean"], 82)
    save_jpeg(shrink(flat, VIEW_SIDE), paths["view"], 78)
    save_jpeg(shrink(flat, THUMB_SIDE), paths["thumb"], 70)
    info["separator"] = False if info.get("blank") else find_separator(flat)
    text, ocr_ok = ("", False)
    if not info.get("blank") and not info["separator"]:
        text, ocr_ok = make_page_pdf(paths["clean"], paths["pdf"], ocr=ocr)
    else:
        make_page_pdf(paths["clean"], paths["pdf"], ocr=False)
    info.update({"ocr": ocr_ok, "notes": notes, "w": int(flat.shape[1]), "h": int(flat.shape[0])})
    info["text"] = text
    return info


def process_pdf_page(pdf_path, page_index, paths, ocr=True):
    """A page of an uploaded PDF (a scanner's output). Pages that already carry text are kept exactly as they are; picture-only pages
    are cleaned like photos and read."""
    src = fitz.open(pdf_path)
    try:
        pg = src[page_index]
        native = (pg.get_text("text") or "").strip()
        zoom = 200.0 / 72.0
        pix = pg.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        raw_path = paths["clean"] + ".raw.png"
        pix.save(raw_path)
        if len(native) >= 40 and X.usable_text(native):
            img = load_image(raw_path, VIEW_SIDE * 2)
            save_jpeg(img, paths["clean"], 80)
            save_jpeg(shrink(img, VIEW_SIDE), paths["view"], 78)
            save_jpeg(shrink(img, THUMB_SIDE), paths["thumb"], 70)
            out = fitz.open()
            out.insert_pdf(src, from_page=page_index, to_page=page_index)
            out.save(paths["pdf"], garbage=4, deflate=True)
            out.close()
            info = {"blank": False, "separator": find_separator(img), "ocr": False, "native": True, "text": native, "notes": [],
                    "w": int(img.shape[1]), "h": int(img.shape[0])}
            if info["separator"]:
                info["text"] = ""
            return info
        info = process_image_page(raw_path, paths, ocr=ocr)
        info["from_pdf"] = True
        return info
    finally:
        src.close()
        with contextlib.suppress(OSError):
            os.remove(paths["clean"] + ".raw.png")


# ── reading a page's meaning ─────────────────────────────────────────────────────────
_PAGE_OF = re.compile(r"(?:\bpage\s*(?:no\.?)?\s*[:\-]?\s*(\d{1,4})\s*(?:of|/)\s*(\d{1,4})\b)|(?:^\s*(\d{1,3})\s*/\s*(\d{1,3})\s*$)", re.I | re.M)
_PAGE_ONLY = re.compile(r"^\s*[-–—\[\(]*\s*(?:page\s*)?(\d{1,4})\s*[-–—\]\)]*\s*$", re.I)
_START_CUES = re.compile(
    r"^\s*(?:in\s+the\s+(?:honou?rable\s+)?(?:high|supreme|district|sessions?|civil|family|consumer|labou?r|national|city|court|tribunal)|before\s+(?:the|hon)|"
    r"affidavit|vakalatnama|legal\s+notice|notice\b|order\b|judg(?:e)?ment|memo\s+of\s+parties|power\s+of\s+attorney|agreement|"
    r"this\s+(?:agreement|deed)|summons|first\s+information\s+report|f\.?i\.?r\.?\b|receipt|invoice|tax\s+invoice|letter|to,?\s*$|subject\s*:|"
    r"application\s+under|petition|plaint|written\s+statement|reply\b|rejoinder|bail\s+application|memorandum|index\b|list\s+of\s+dates|synopsis|"
    r"proceedings\s+of|order\s+sheet|cause\s+title|आदेश|न्यायालय|शपथ\s*पत्र|वकालतनामा|नोटिस)", re.I)
_END_CUES = re.compile(r"(?:\bsd/?-|\bverification\b|\bverified\b|\badvocate\s+for\b|\bcounsel\s+for\b|\bplace\s*:|\bdated?\s*:\s*[\d/.\-]+\s*$|\bdeponent\b|\bsignature\b|"
                       r"\bprayer\b|\bthrough\s+counsel\b|\byours\s+(?:faithfully|sincerely|truly)\b|\bregards\b)", re.I)


def read_page(text):
    """Cheap features of one page's text used for splitting and naming."""
    lines = [l.strip() for l in (text or "").splitlines() if l.strip()]
    head = lines[:10]
    tail = lines[-6:]
    f = {"chars": len(text or ""), "page_no": None, "page_total": None, "cue": None, "cue_first": False, "end_cue": False, "lower_start": False,
         "case_key": None, "cls": None, "cls_conf": 0.0}
    if not lines:
        return f
    for l in tail + head[:3]:
        m = _PAGE_OF.search(l)
        if m:
            a, b = (m.group(1), m.group(2)) if m.group(1) else (m.group(3), m.group(4))
            if a and b and int(a) <= int(b) <= 999:
                f["page_no"], f["page_total"] = int(a), int(b)
                break
    if f["page_no"] is None:
        for l in tail[-2:]:
            m = _PAGE_ONLY.match(l)
            if m and len(l) <= 14:
                f["page_no"] = int(m.group(1))
                break
    for k, l in enumerate(head[:8]):
        if _START_CUES.match(l):
            f["cue"], f["cue_first"] = l[:80], k == 0
            break
    f["end_cue"] = any(_END_CUES.search(l) for l in tail[-4:])
    f["lower_start"] = bool(re.match(r"^[a-z]{2,}", head[0])) if head else False
    own, _m = C.extract_case_numbers("\n".join(lines[:25]))
    if own:
        m = C.CASE_RE.search(own[0])
        if m:
            f["case_key"] = C.case_key(m.group("type"), m.group("num"), m.group("year"))
    try:
        cl = C.classify("\n".join(lines[:60]), "", "pdf")
        if cl["doc_class"] != "Unclassified" and cl["confidence"] >= 0.55:
            f["cls"], f["cls_conf"] = cl["doc_class"], cl["confidence"]
    except Exception:
        pass
    return f


def propose_starts(pages):
    """pages: [{'info': {...'blank','separator'}, 'f': read_page(...)}] in order, already without dropped pages.
    -> [(starts_new_document: bool, reason: str|None)] one per page.
    The case number and the type are remembered across the pages of the current document, so a page without a case number in the
    middle (a continuation sheet) does not hide the change of case on the page after it."""
    out = []
    prev = None
    sep_pending = False
    cur_key = cur_cls = None
    for i, p in enumerate(pages):
        f = p["f"]
        if i == 0:
            out.append((True, None))
            prev = p
            cur_key, cur_cls = f["case_key"], f["cls"]
            continue
        score, why = 0.0, []
        if sep_pending:
            score += 3
            why.append("after a separator sheet")
        pf = prev["f"]
        if f["page_no"] == 1 and (pf["page_no"] or 0) != 1:
            score += 3
            why.append("this page says " + (f"“Page 1 of {f['page_total']}”" if f["page_total"] else "“Page 1”"))
        elif f["page_no"] and pf["page_no"] and f["page_no"] == pf["page_no"] + 1:
            score -= 3
        if f["case_key"] and cur_key and f["case_key"] != cur_key:
            score += 3
            why.append(f"a different case number ({f['case_key']})")
        if f["cue"]:
            reasoned = False
            if cur_cls and f["cls"] and cur_cls != f["cls"]:
                score += 2 + (0.5 if f["cls_conf"] >= 0.75 else 0)
                why.append(f"looks like the first page of {('an ' if f['cls'][0] in 'AEIOU' else 'a ')}{f['cls']}")
                reasoned = True
            if pf["end_cue"]:
                score += 1.5 if f["cue_first"] else 1.0
                if not reasoned:
                    why.append("the previous page looks like an ending and this one a heading")
                reasoned = True
            if not reasoned:
                score += 1.2 if f["cue_first"] else 0.6
        if f["lower_start"]:
            score -= 1.5
        if pf["page_total"] and pf["page_no"] and pf["page_no"] < pf["page_total"] and f["page_no"] != 1:
            score -= 1
        starts = score >= 2.5
        out.append((starts, "; ".join(why) if starts and why else None))
        if starts:
            cur_key, cur_cls = f["case_key"], f["cls"]
        else:
            cur_key, cur_cls = cur_key or f["case_key"], cur_cls or f["cls"]
        sep_pending = False
        prev = p
    return out


def split_pages(pages):
    """pages: [{'id', 'info', 'f'}] in order.  -> list of {'pages': [ids], 'reasons': [...]}.
    Separator sheets and blank pages are removed from the documents (a separator also starts the next document); the pages
    removed are returned separately so the screen can show and restore them."""
    kept, removed = [], []
    pending_sep = False
    for p in pages:
        info = p.get("info") or {}
        if info.get("separator"):
            removed.append({"id": p["id"], "why": "separator sheet"})
            pending_sep = True
            continue
        if info.get("blank"):
            removed.append({"id": p["id"], "why": "blank page"})
            continue
        kept.append(dict(p, _sep=pending_sep))
        pending_sep = False
    flags = propose_starts(kept)
    docs = []
    for p, (start, why) in zip(kept, flags):
        if p["_sep"] and docs:
            start, why = True, "after a separator sheet"
        if start or not docs:
            docs.append({"pages": [p["id"]], "reasons": [why] if why else []})
        else:
            docs[-1]["pages"].append(p["id"])
    return docs, removed


# ── what to call a document ──────────────────────────────────────────────────────────
def analyse_texts(texts, today=None):
    """Name, type and case details for one document made of the given page texts."""
    body = "\n".join(t for t in texts if t)[:60000]
    out = {"title": None, "doc_class": "Unclassified", "class_conf": 0.0, "case_numbers": [], "case_mentions": [], "fir_numbers": [], "parties": None, "court": None,
           "doc_date": None, "next_hearing": None, "readable": bool(body.strip())}
    if not body.strip():
        return out
    an = C.analyse(body, "scan.pdf", "pdf")
    cls, meta = an["class"], an["meta"]
    out.update({"doc_class": cls["doc_class"], "class_conf": cls["confidence"], "case_numbers": meta.get("case_numbers") or [], "case_mentions": meta.get("case_mentions") or [],
                "fir_numbers": meta.get("fir_numbers") or [], "parties": meta.get("parties"), "court": meta.get("court"), "doc_date": meta.get("doc_date"),
                "next_hearing": meta.get("next_hearing")})
    title = an.get("suggested_title")
    if not title:
        first = next((l.strip() for l in body.splitlines() if len(re.sub(r"[^A-Za-zऀ-ॿ]", "", l)) >= 8), "")
        first = re.sub(r"\s+", " ", first).strip(" .:-_")[:70]
        if first:
            title = first.title() if first.isupper() else first
    out["title"] = title
    return out


# ── the separator sheet ──────────────────────────────────────────────────────────────
def separator_pdf(count=1):
    """A4 sheet with a big QR code: put it between two documents in the stack; the scanner/phone sees it and starts a new document."""
    try:
        from utils import dms_pdftext as T
    except ImportError:  # pragma: no cover
        import dms_pdftext as T
    doc = fitz.open()
    face = T.Face()
    for _ in range(max(1, min(int(count), 20))):
        page = doc.new_page(width=595.28, height=841.89)
        names = face.register(page)
        qs = 300
        page.insert_image(fitz.Rect((595.28 - qs) / 2, 150, (595.28 + qs) / 2, 150 + qs), stream=T.qr_png(SEPARATOR_PAYLOAD, scale=14, border=2))
        for y, text, size, kind in ((105, "NEW DOCUMENT STARTS AFTER THIS SHEET", 17, "bold"), (490, "Separator sheet", 24, "bold"),
                                    (525, "Put this sheet between two documents before you scan or photograph the stack.", 11, "reg"),
                                    (542, "It is recognised automatically and is not kept as a page.", 11, "reg"),
                                    (790, "LexAmplify Document Hub", 9, "reg")):
            w = face.width(text, size, kind)
            face.text(page, names, ((595.28 - w) / 2, y), text, size, kind, (0.1, 0.1, 0.1) if kind == "bold" else (0.35, 0.35, 0.35))
    buf = doc.tobytes(garbage=4, deflate=True)
    doc.close()
    return buf


# ── assembling the finished documents ────────────────────────────────────────────────
def assemble_pdf(page_pdfs, out_path, title=None):
    out = fitz.open()
    for p in page_pdfs:
        src = fitz.open(p)
        try:
            out.insert_pdf(src)
        finally:
            src.close()
    if title:
        out.set_metadata({"title": title[:180], "producer": "LexAmplify Document Hub (scan)"})
    out.save(out_path, garbage=4, deflate=True)
    n = out.page_count
    out.close()
    return n


# ── background worker ────────────────────────────────────────────────────────────────
class ScanWorker:
    """Cleans and reads the pictures people upload. Same pattern as the Document Hub's worker: the queue is a table, a page is
    claimed atomically, a failure is recorded on the page and never blocks the pages behind it."""

    def __init__(self, db_path, threads=None, log=None):
        self.db_path = db_path
        self.n = int(threads if threads is not None else os.getenv("DMS_SCAN_WORKERS", "2"))
        self.log = log or (lambda m: None)
        self._threads, self._stop, self._wake, self._lock = [], threading.Event(), threading.Event(), threading.Lock()

    def start(self):
        with self._lock:
            if self._threads or self.n <= 0:
                return
            self._stop.clear()
            for i in range(self.n):
                t = threading.Thread(target=self._loop, args=(i,), name=f"dms-scan-{i}", daemon=True)
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

    def _claim(self, conn):
        conn.execute("BEGIN IMMEDIATE")
        try:
            r = conn.execute("SELECT id, session_id FROM dms_scan_pages WHERE status = 'queued' ORDER BY id LIMIT 1").fetchone()
            if not r:
                conn.commit()
                return None
            conn.execute("UPDATE dms_scan_pages SET status = 'processing', info = json_set(COALESCE(info, '{}'), '$.started', ?) WHERE id = ?", (time.time(), r["id"]))
            conn.commit()
            return dict(r)
        except Exception:
            conn.rollback()
            raise

    def _loop(self, idx):
        with contextlib.suppress(Exception):
            os.nice(6)
        conn = I.connect(self.db_path)
        last_recover = 0
        misses = 0
        while not self._stop.is_set():
            try:
                if idx == 0 and time.time() - last_recover > 60:
                    last_recover = time.time()
                    recover_stale(conn)
                job = self._claim(conn)
            except Exception as exc:
                misses += 1
                if misses > 20 or not os.path.exists(self.db_path):
                    break
                self.log(f"[scan] claim failed: {exc}")
                self._stop.wait(1.5)
                continue
            misses = 0
            if not job:
                self._wake.wait(timeout=3)
                self._wake.clear()
                continue
            try:
                run_page_job(conn, job["id"], job["session_id"])
            except Exception as exc:
                self.log(f"[scan] page {job['id']} failed: {exc}\n{traceback.format_exc()}")
                with contextlib.suppress(Exception):
                    conn.rollback()
                    conn.execute("UPDATE dms_scan_pages SET status = 'failed', error = ? WHERE id = ?", (str(exc)[:200], job["id"]))
                    conn.commit()
        with contextlib.suppress(Exception):
            conn.close()


def recover_stale(conn, seconds=900):
    conn.execute("UPDATE dms_scan_pages SET status = 'queued' WHERE status = 'processing' AND "
                 "CAST(json_extract(COALESCE(info, '{}'), '$.started') AS REAL) < ?", (time.time() - seconds,))
    conn.commit()


def run_page_job(conn, page_id, sid):
    row = conn.execute("SELECT * FROM dms_scan_pages WHERE id = ?", (page_id,)).fetchone()
    if not row:
        return
    info_in = F.loads(row["info"], {})
    paths = page_paths(sid, page_id)
    d = session_dir(sid)
    if not os.path.isdir(d):                            # the scan was discarded while this page waited
        conn.execute("DELETE FROM dms_scan_pages WHERE id = ?", (page_id,))
        conn.commit()
        return
    ocr = os.getenv("DMS_OCR_ENABLED", "1") != "0"
    try:
        if info_in.get("reprocess"):
            rot = int(info_in["reprocess"].get("rot", 0))
            info = process_image_page(None, paths, ocr=ocr, extra_rot=rot, reuse_clean=True)
            info["rot_manual"] = (int(info_in.get("rot_manual", 0)) + rot) % 360
        elif row["src_kind"] == "pdf":
            info = process_pdf_page(os.path.join(d, info_in["src_file"]), int(info_in["pdf_page"]), paths, ocr=ocr)
        else:
            info = process_image_page(os.path.join(d, info_in["src_file"]), paths, ocr=ocr)
    except ScanError as exc:
        conn.execute("UPDATE dms_scan_pages SET status = 'failed', error = ? WHERE id = ?", (exc.message[:200], page_id))
        conn.commit()
        return
    text = info.pop("text", "") or ""
    info["f"] = read_page(text)
    info["src_file"] = info_in.get("src_file")
    info["pdf_page"] = info_in.get("pdf_page")
    info["done"] = round(time.time(), 2)                # the screen puts this on picture URLs so a rotated page is not shown from cache
    conn.execute("UPDATE dms_scan_pages SET status = 'ready', error = NULL, w = ?, h = ?, text = ?, info = ? WHERE id = ?",
                 (info.get("w"), info.get("h"), text[:60000], json.dumps(info), page_id))
    conn.execute("UPDATE dms_scan_sessions SET updated_at = ? WHERE id = ?", (F.now_iso(), sid))
    conn.commit()


def discard_files(sid):
    with contextlib.suppress(Exception):
        shutil.rmtree(session_dir(sid), ignore_errors=True)


def sweep_old(conn):
    """Open scans nobody finished for 3 days are removed, files included."""
    cutoff = time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(time.time() - SESSION_TTL_DAYS * 86400))
    for r in conn.execute("SELECT id FROM dms_scan_sessions WHERE updated_at < ?", (cutoff,)).fetchall():
        discard_files(r["id"])
        conn.execute("DELETE FROM dms_scan_pages WHERE session_id = ?", (r["id"],))
        conn.execute("DELETE FROM dms_scan_sessions WHERE id = ?", (r["id"],))
    conn.commit()
