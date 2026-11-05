"""
utils/docx_preview.py
Render the first page of a .docx template to a PNG preview.

Tries in order:
  1) MS Word COM (Windows + Word installed) — best fidelity
  2) LibreOffice `soffice --headless --convert-to pdf` — cross-platform
Both routes land in the same final step: open the resulting PDF with
PyMuPDF (fitz) and rasterise page 1 at ~150 DPI.

Returns PNG bytes, or None if nothing worked.
"""
from __future__ import annotations

import hashlib
import io
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from typing import Optional

log = logging.getLogger(__name__)

# Simple in-memory cache: sha1(path + mtime) -> png bytes. Avoids
# re-launching Word / LibreOffice on every refresh of the editor.
_CACHE: dict[str, bytes] = {}
_CACHE_LOCK = threading.Lock()
_MAX_CACHE_ENTRIES = 32


def _cache_key(docx_path: str) -> str:
    st = os.stat(docx_path)
    raw = f"{docx_path}|{int(st.st_mtime)}|{st.st_size}".encode("utf-8")
    return hashlib.sha1(raw).hexdigest()


def _cache_get(key: str) -> Optional[bytes]:
    with _CACHE_LOCK:
        return _CACHE.get(key)


def _cache_put(key: str, data: bytes) -> None:
    with _CACHE_LOCK:
        if len(_CACHE) >= _MAX_CACHE_ENTRIES:
            # drop oldest insertion
            _CACHE.pop(next(iter(_CACHE)))
        _CACHE[key] = data


def _pdf_first_page_to_png(pdf_path: str, dpi: int = 150) -> Optional[bytes]:
    try:
        import fitz  # type: ignore
    except ImportError:
        log.warning("docx_preview: PyMuPDF (fitz) not installed")
        return None
    try:
        doc = fitz.open(pdf_path)
        if doc.page_count == 0:
            doc.close()
            return None
        page = doc.load_page(0)
        zoom = dpi / 72.0
        mat = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        png = pix.tobytes("png")
        doc.close()
        return png
    except Exception as exc:
        log.warning("docx_preview: PDF → PNG failed: %s", exc)
        return None


def _convert_with_word(docx_path: str, out_pdf: str) -> bool:
    """Drive MS Word on Windows via COM to Save As PDF."""
    if sys.platform != "win32":
        return False
    try:
        import pythoncom  # type: ignore
        import win32com.client  # type: ignore
    except ImportError:
        return False
    try:
        pythoncom.CoInitialize()
        word = win32com.client.DispatchEx("Word.Application")
        word.Visible = False
        word.DisplayAlerts = False
        try:
            # Normalise to absolute path — Word rejects relative paths.
            abs_in = os.path.abspath(docx_path)
            abs_out = os.path.abspath(out_pdf)
            doc = word.Documents.Open(abs_in, ReadOnly=True, AddToRecentFiles=False)
            # 17 = wdFormatPDF
            doc.SaveAs2(abs_out, FileFormat=17)
            doc.Close(SaveChanges=False)
        finally:
            word.Quit()
        return os.path.isfile(out_pdf) and os.path.getsize(out_pdf) > 0
    except Exception as exc:
        log.info("docx_preview: Word COM path failed: %s", exc)
        return False
    finally:
        try:
            pythoncom.CoUninitialize()
        except Exception:
            pass


def _find_soffice() -> Optional[str]:
    override = os.environ.get("SOFFICE_BINARY")
    if override and os.path.isfile(override):
        return override
    cand = shutil.which("soffice") or shutil.which("libreoffice")
    if cand:
        return cand
    for p in (
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
        "/usr/bin/soffice",
        "/usr/bin/libreoffice",
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    ):
        if os.path.isfile(p):
            return p
    return None


def _convert_with_soffice(docx_path: str, out_dir: str) -> Optional[str]:
    soffice = _find_soffice()
    if not soffice:
        return None
    try:
        # Each conversion runs in its own temp profile dir so parallel calls
        # don't block on LibreOffice's single-user-profile lock.
        profile = tempfile.mkdtemp(prefix="lh_lo_")
        try:
            env = os.environ.copy()
            cmd = [
                soffice,
                f"-env:UserInstallation=file:///{profile.replace(os.sep, '/')}",
                "--headless", "--norestore", "--nologo", "--nofirststartwizard",
                "--convert-to", "pdf",
                "--outdir", out_dir,
                docx_path,
            ]
            subprocess.run(cmd, check=True, timeout=60, env=env,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            base = os.path.splitext(os.path.basename(docx_path))[0]
            out = os.path.join(out_dir, base + ".pdf")
            return out if os.path.isfile(out) else None
        finally:
            shutil.rmtree(profile, ignore_errors=True)
    except Exception as exc:
        log.info("docx_preview: LibreOffice path failed: %s", exc)
        return None


def render_docx_first_page_png(docx_path: str, dpi: int = 150) -> Optional[bytes]:
    """Return PNG bytes for the first page of the .docx, or None if neither
    Word nor LibreOffice is available (or both failed)."""
    if not docx_path or not os.path.isfile(docx_path):
        return None
    key = _cache_key(docx_path)
    cached = _cache_get(key)
    if cached is not None:
        return cached

    workdir = tempfile.mkdtemp(prefix="lh_prev_")
    try:
        out_pdf = os.path.join(workdir, "preview.pdf")
        ok = _convert_with_word(docx_path, out_pdf)
        pdf_path = out_pdf if ok else None
        if not pdf_path:
            pdf_path = _convert_with_soffice(docx_path, workdir)
        if not pdf_path:
            return None
        png = _pdf_first_page_to_png(pdf_path, dpi=dpi)
        if png:
            _cache_put(key, png)
        return png
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def preview_available() -> dict:
    """Report which backends are available — surfaced to the frontend so the
    UI can show an install hint if neither Word nor LibreOffice is present."""
    word_ok = sys.platform == "win32"
    if word_ok:
        try:
            import win32com.client  # noqa: F401
        except ImportError:
            word_ok = False
    return {
        "word_com": word_ok,
        "libreoffice": bool(_find_soffice()),
    }


def detect_safe_content_margins_cm(docx_path, page_height_cm=29.7, page_width_cm=21.0):
    """TEMPLATE MAPPING ENGINE.

    Many uploaded letterhead .docx files decorate the page with full-page
    background graphics (coloured corners/bands anchored in the header). Their
    text margins do NOT account for that art, so poured-in body text collides
    with the top/bottom decoration. This renders the template (whatever body
    it currently has — call it on an EMPTY-body copy) to an image and finds
    the vertical "safe zone": the band of near-white page between the top and
    bottom decoration. Returns (top_cm, bottom_margin_cm) to use as the body's
    text margins, or None if we can't render or can't find a clear zone.

    Only top/bottom are returned — side decorations are usually corner art
    that the template's own left/right margins already clear.
    """
    png = render_docx_first_page_png(docx_path, dpi=100)
    if not png:
        return None
    try:
        from PIL import Image
    except ImportError:
        return None
    try:
        img = Image.open(io.BytesIO(png)).convert("RGB")
    except Exception:
        return None
    W, H = img.size
    if W < 10 or H < 10:
        return None
    px = img.load()
    step = max(1, W // 280)   # sample ~280 columns per row for speed

    def _row_ink(y):
        hits = 0
        n = 0
        for x in range(0, W, step):
            r, g, b = px[x, y]
            if min(r, g, b) < 225:   # not near-white → decoration/ink
                hits += 1
            n += 1
        return hits / max(1, n)

    rows = [_row_ink(y) for y in range(H)]
    CLEAR = 0.05        # ≤5% inked ⇒ clear row
    RUN = max(12, H // 45)   # consecutive clear rows that mark the content band

    def _first_clear(seq):
        run = 0
        for i, d in enumerate(seq):
            run = run + 1 if d <= CLEAR else 0
            if run >= RUN:
                return i - RUN + 1
        return None

    top_i = _first_clear(rows)
    bot_from_bottom = _first_clear(rows[::-1])
    if top_i is None or bot_from_bottom is None:
        return None
    top_cm = top_i / H * page_height_cm
    bottom_content_cm = (H - 1 - bot_from_bottom) / H * page_height_cm
    bottom_margin_cm = page_height_cm - bottom_content_cm
    # sanity: keep within reasonable bounds, add a little breathing room
    top_cm = min(max(top_cm + 0.25, 1.5), page_height_cm * 0.45)
    bottom_margin_cm = min(max(bottom_margin_cm + 0.25, 1.5), page_height_cm * 0.45)
    return (round(top_cm, 2), round(bottom_margin_cm, 2))
