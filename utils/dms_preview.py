"""
utils/dms_preview.py - server-side page images for the Document Hub preview, with search hits
highlighted on the page itself.

Why images and not the browser's own PDF viewer: the same code path then works for PDFs, scanned
pages and phone photos, the search words can be highlighted on the picture of the page (including
scans, using OCR word positions), and nothing from an uploaded file - no script, no form, no
embedded link - is ever handed to the browser to execute.
"""
import contextlib
import hashlib
import io
import os
import re

MAX_PIXELS = 3800 * 3800
HIGHLIGHT_RGB = (217, 173, 92)          # the "major" amber of the Slate & Rust palette


class PreviewError(Exception):
    """Message is safe to show the user."""


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


def _clean_terms(terms):
    out = []
    for t in terms or ():
        t = re.sub(r"[^\wऀ-෿]+", "", str(t).lower(), flags=re.UNICODE)
        if len(t) >= 2 and t not in out:
            out.append(t)
    return out[:20]


def page_total(path, kind):
    if kind == "pdf":
        fitz = _pymupdf()
        if fitz is None:
            raise PreviewError("Page preview needs PyMuPDF on the server.")
        with contextlib.closing(fitz.open(path)) as doc:
            return doc.page_count
    if kind == "image":
        from PIL import Image
        with Image.open(path) as im:
            return getattr(im, "n_frames", 1)
    return 0


def _ocr_boxes(img, words):
    """Pixel boxes of OCR'd words that contain any search word (scans have no text layer to search)."""
    try:
        import pytesseract
        from utils import dms_extract as X
        eng = X.ocr_engine()
        if not eng.get("available"):
            return []
        data = pytesseract.image_to_data(img, lang=eng.get("langs") or "eng", output_type=pytesseract.Output.DICT,
                                         timeout=X.OCR_PAGE_TIMEOUT)
    except Exception:
        return []
    boxes = []
    for i, txt in enumerate(data.get("text", [])):
        w = re.sub(r"[^\wऀ-෿]+", "", (txt or "").lower(), flags=re.UNICODE)
        if len(w) < 2:
            continue
        if any(t in w or (len(w) >= 4 and w in t) for t in words):
            boxes.append((data["left"][i], data["top"][i], data["width"][i], data["height"][i]))
    return boxes


def _paint(img, boxes):
    if not boxes:
        return img
    from PIL import Image, ImageDraw
    base = img.convert("RGBA")
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    dr = ImageDraw.Draw(layer)
    for x, y, w, h in boxes:
        pad = max(1, int(h * 0.12))
        dr.rectangle([x - pad, y - pad, x + w + pad, y + h + pad], fill=HIGHLIGHT_RGB + (105,))
    return Image.alpha_composite(base, layer).convert("RGB")


def _pdf_page(path, page_no, width, words):
    fitz = _pymupdf()
    if fitz is None:
        raise PreviewError("Page preview needs PyMuPDF on the server.")
    from PIL import Image
    try:
        opened = fitz.open(path)
    except Exception as exc:
        raise PreviewError("This PDF could not be opened for preview. It may be damaged.") from exc
    with contextlib.closing(opened) as doc:
        if doc.needs_pass:
            raise PreviewError("This PDF is password-protected.")
        if page_no < 1 or page_no > doc.page_count:
            raise PreviewError("That page does not exist.")
        page = doc.load_page(page_no - 1)
        zoom = max(0.2, min(4.0, width / max(1.0, page.rect.width)))
        while page.rect.width * zoom * page.rect.height * zoom > MAX_PIXELS:
            zoom *= 0.8
        has_text = len((page.get_text("text") or "").strip()) >= 25
        annots = False
        if words and has_text:
            for w in words:
                for rect in page.search_for(w)[:200]:
                    a = page.add_highlight_annot(rect)
                    a.set_colors(stroke=tuple(c / 255 for c in HIGHLIGHT_RGB))
                    a.set_opacity(0.55)
                    a.update()
                    annots = True
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False, annots=annots)
        img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    if words and not has_text:
        img = _paint(img, _ocr_boxes(img, words))
    return img


def _image_page(path, page_no, width, words):
    from PIL import Image, ImageOps
    try:
        im = Image.open(path)
        frames = getattr(im, "n_frames", 1)
        if page_no < 1 or page_no > frames:
            raise PreviewError("That page does not exist.")
        im.seek(page_no - 1)
        im = ImageOps.exif_transpose(im.convert("RGB"))
    except PreviewError:
        raise
    except Exception as exc:
        raise PreviewError("This image could not be opened.") from exc
    if im.width * im.height > MAX_PIXELS:
        im.thumbnail((3800, 3800))
    scale = min(1.0, width / im.width) if im.width else 1.0
    big = im
    if words:
        big = _paint(im, _ocr_boxes(im, words))
    if scale < 1.0:
        big = big.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.LANCZOS)
    return big


def render_page(path, kind, page_no, width=900, terms=(), cache_dir=None, cache_id=""):
    """JPEG bytes of one page. `terms` are highlighted. Results are cached on disk when cache_dir is given."""
    width = max(200, min(int(width or 900), 1800))
    words = _clean_terms(terms)
    ckey = None
    if cache_dir and cache_id:
        ckey = os.path.join(cache_dir, "pv_" + hashlib.sha1(f"{cache_id}|{page_no}|{width}|{','.join(words)}".encode()).hexdigest() + ".jpg")
        with contextlib.suppress(OSError):
            if os.path.exists(ckey):
                with open(ckey, "rb") as fh:
                    return fh.read()
    if kind == "pdf":
        img = _pdf_page(path, page_no, width, words)
    elif kind == "image":
        img = _image_page(path, page_no, width, words)
    else:
        raise PreviewError("There is no page preview for this kind of file. Use the text view.")
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=86, optimize=True)
    data = buf.getvalue()
    if ckey:
        with contextlib.suppress(OSError):
            os.makedirs(cache_dir, exist_ok=True)
            tmp = ckey + f".{os.getpid()}.tmp"
            with open(tmp, "wb") as fh:
                fh.write(data)
            os.replace(tmp, ckey)
    return data
