"""OCR for scanned PDFs.

Pipeline (lightest working engine wins):
    1. RapidOCR (ONNX runtime, PaddleOCR models re-exported) —
       ~30-50 MB models, ~100 MB RAM, 2-3x faster than Tesseract.
       First choice because it fits the 512 MB Render free tier.
    2. Tesseract (via pytesseract) — hard fallback.
    3. Nothing — return whatever fitz got from the embedded text pass.

Public entry point:
    ocr_pdf_bytes(file_bytes, min_text_chars_per_page=50) -> str

All imports are LAZY. Importing this module never triggers OCR
engine load. First call pays the one-time load cost (~2 s for
RapidOCR), later calls are instant.

Why RapidOCR instead of PaddleOCR:
  * paddlepaddle wheel is 200 MB and the full PP-OCRv4 model set is
    another 200 MB. Combined RAM footprint > 400 MB — would OOM-kill
    the server on Render's 512 MB free tier (see earlier memory note
    about the free-plan server stopping at 512 MB during analysis).
  * RapidOCR packages the same model architecture via ONNX, so
    accuracy is comparable while the install + runtime footprint
    drops to a tenth.
"""
from __future__ import annotations
import io
import os
import threading

_engine_lock = threading.Lock()
_engine = None  # type: ignore


def _get_engine():
    """Lazy-load RapidOCR. Returns None if the package isn't installed."""
    global _engine
    if _engine is not None:
        return _engine
    with _engine_lock:
        if _engine is not None:
            return _engine
        try:
            from rapidocr_onnxruntime import RapidOCR
            # det_use_cuda / rec_use_cuda / cls_use_cuda default to False —
            # CPU-only is explicit. First call downloads ~30-50 MB of ONNX
            # model files into ~/.cache/.
            _engine = RapidOCR()
            return _engine
        except Exception:
            _engine = False  # tried and failed — skip to Tesseract next time
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


def _ocr_page_with_engine(engine, img) -> str:
    """One page's text via RapidOCR. Returns '' on any failure path."""
    import numpy as np
    arr = np.array(img.convert("RGB"))
    try:
        res, _elapsed = engine(arr)
    except Exception:
        return ""
    if not res:
        return ""
    lines = []
    for item in res:
        # item = [bbox_list, text, confidence]
        if not item or len(item) < 2:
            continue
        text = (item[1] or "").strip()
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

    engine = _get_engine()
    for i in pages_needing_ocr:
        try:
            img = _page_image_from_pdf(pdf_bytes, i)
            if engine:
                txt = _ocr_page_with_engine(engine, img)
                if not txt:
                    txt = _ocr_page_with_tesseract(img)
            else:
                txt = _ocr_page_with_tesseract(img)
            pages_text[i] = txt.strip()
        except Exception:
            pages_text[i] = ""
    return "\n\n".join(p for p in pages_text if p)


__all__ = ["ocr_pdf_bytes"]
