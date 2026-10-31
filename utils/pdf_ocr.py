"""OCR for scanned PDFs.

Try fast engine first (PaddleOCR, CPU-only), fall back to Tesseract
(already a dep elsewhere), fall back to empty text on hard failure.

Public entry point:
    ocr_pdf_bytes(file_bytes, min_text_chars_per_page=50) -> str

The caller (contract_routes.py) is expected to first try the fast
embedded-text path via `utils.pdf_helper.extract_text_for_summary`.
Only if that returns suspiciously little text should this module run.

All imports are LAZY — importing this module never triggers heavy
Paddle load. First call pays the one-time load cost (~2-3s), later
calls are instant.
"""
from __future__ import annotations
import io
import os
import threading

_paddle_lock = threading.Lock()
_paddle_engine = None  # type: ignore


def _get_paddle():
    """Lazy-load PaddleOCR. Returns None if the package isn't installed."""
    global _paddle_engine
    if _paddle_engine is not None:
        return _paddle_engine
    with _paddle_lock:
        if _paddle_engine is not None:
            return _paddle_engine
        try:
            from paddleocr import PaddleOCR
            # Language codes:  en, hi for Hindi, ch for Chinese etc. English+Hindi
            # is a common Indian-legal mix; configurable via LX_OCR_LANG env.
            lang = os.getenv("LX_OCR_LANG", "en")
            # use_angle_cls=True handles rotated pages; use_gpu=False forces CPU.
            _paddle_engine = PaddleOCR(use_angle_cls=True, use_gpu=False, lang=lang, show_log=False)
            return _paddle_engine
        except Exception:
            _paddle_engine = False  # mark as "tried and failed"
            return None


def _page_image_from_pdf(pdf_bytes: bytes, page_index: int, dpi: int = 220):
    """Render one PDF page as a PIL Image for OCR. 220 dpi is the usual
    sweet spot — higher is slower, lower hurts recognition."""
    import fitz
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        page = doc.load_page(page_index)
        mat = fitz.Matrix(dpi / 72.0, dpi / 72.0)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        from PIL import Image
        return Image.open(io.BytesIO(pix.tobytes("png")))
    finally:
        doc.close()


def _ocr_page_with_paddle(engine, img) -> str:
    """One page's text via PaddleOCR."""
    import numpy as np
    arr = np.array(img.convert("RGB"))
    res = engine.ocr(arr, cls=True)
    if not res or not res[0]:
        return ""
    lines = []
    for item in res[0]:
        # item = [bbox, (text, confidence)]
        if not item or len(item) < 2:
            continue
        txt_tuple = item[1]
        if not txt_tuple or len(txt_tuple) < 1:
            continue
        text = (txt_tuple[0] or "").strip()
        if text:
            lines.append(text)
    return "\n".join(lines)


def _ocr_page_with_tesseract(img) -> str:
    """Fallback OCR via Tesseract (uses utils/dms_extract's engine config)."""
    try:
        from utils.dms_extract import _ocr_image
        text, _conf = _ocr_image(img)
        return text or ""
    except Exception:
        return ""


def ocr_pdf_bytes(pdf_bytes: bytes, *, min_text_chars_per_page: int = 50,
                  max_pages: int = 1500) -> str:
    """Extract text from a (possibly scanned) PDF. Embedded-text pages
    are returned as-is from PyMuPDF; pages with less than
    `min_text_chars_per_page` get sent through OCR.

    Returns the concatenated text (blank lines between pages). On
    hard failure for a page, that page is skipped (no exception
    bubbles out)."""
    import fitz
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    if doc.needs_pass:
        doc.close()
        raise ValueError("password-protected PDF")
    try:
        n = min(doc.page_count, max_pages)
        pages_text: list[str] = []
        pages_needing_ocr: list[int] = []
        for i in range(n):
            page = doc.load_page(i)
            text = page.get_text("text") or ""
            if len(text.strip()) >= min_text_chars_per_page:
                pages_text.append(text.strip())
            else:
                pages_text.append("")   # placeholder, filled below
                pages_needing_ocr.append(i)
    finally:
        doc.close()

    if not pages_needing_ocr:
        return "\n\n".join(p for p in pages_text if p)

    engine = _get_paddle()
    for i in pages_needing_ocr:
        try:
            img = _page_image_from_pdf(pdf_bytes, i)
            if engine:
                txt = _ocr_page_with_paddle(engine, img)
                if not txt:
                    txt = _ocr_page_with_tesseract(img)
            else:
                txt = _ocr_page_with_tesseract(img)
            pages_text[i] = txt.strip()
        except Exception:
            pages_text[i] = ""
    return "\n\n".join(p for p in pages_text if p)


__all__ = ["ocr_pdf_bytes"]
