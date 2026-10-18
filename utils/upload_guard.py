"""Checks run on an uploaded document BEFORE any parser touches it.

The file's real type is decided by its bytes, not its name. Archives that expand to absurd sizes (zip bombs),
macro-enabled Word files, files that are not what they claim to be, and oversized uploads are refused with a plain
message. Nothing here opens or executes the document's contents.
"""
import io
import zipfile

MAX_UPLOAD_BYTES = 30 * 1024 * 1024
MAX_UNCOMPRESSED = 200 * 1024 * 1024        # all parts of a .docx together
MAX_PART = 120 * 1024 * 1024                # one part of a .docx
MAX_RATIO = 400                              # compressed:expanded, only judged for parts above 5 MB
MAX_ENTRIES = 4000
MAX_PDF_PAGES = 1500

_MESSAGES = {
    "UNSUPPORTED_FORMAT": "Unsupported file type. Upload a PDF, a Word .docx file or a .txt file. (For an older .doc file, open it in Word and choose Save As .docx.)",
    "EMPTY_FILE": "That file is empty.",
    "TOO_LARGE": "That file is too large. The limit is 30 MB. Upload the relevant pages only.",
    "NOT_A_PDF": "That file is named .pdf but is not a real PDF. Open it, then save it again as a PDF.",
    "NOT_A_DOCX": "That file is named .docx but is not a real Word document. Open it in Word and save it again as .docx.",
    "MACRO_DOCUMENT": "That Word file contains macros, which we do not accept. Save a copy as a plain .docx (not .docm) and upload that.",
    "UNSAFE_ARCHIVE": "That file looks damaged or unusually large when opened, so we could not accept it. Save it again as a PDF or Word file.",
    "NOT_TEXT": "That does not look like a text file. Upload a PDF, a Word .docx file or a .txt file.",
}
_STATUS = {"UNSUPPORTED_FORMAT": 400, "TOO_LARGE": 413}


def _problem(code):
    return {"code": code, "message": _MESSAGES[code], "status": _STATUS.get(code, 422)}


def kind_from_name(filename: str):
    name = (filename or "").lower().strip()
    for ext, kind in ((".pdf", "pdf"), (".docx", "docx"), (".txt", "txt")):
        if name.endswith(ext):
            return kind
    return None


def check_upload(data: bytes, filename: str):
    """Return (kind, None) when the upload may be parsed, else (None, {code, message, status})."""
    kind = kind_from_name(filename)
    if kind is None:
        return None, _problem("UNSUPPORTED_FORMAT")
    if not data:
        return None, _problem("EMPTY_FILE")
    if len(data) > MAX_UPLOAD_BYTES:
        return None, _problem("TOO_LARGE")
    if kind == "pdf":
        if b"%PDF-" not in data[:1024]:
            return None, _problem("NOT_A_PDF")
    elif kind == "docx":
        err = _check_docx(data)
        if err:
            return None, _problem(err)
    else:
        if b"\x00" in data[:4096] and not data.startswith((b"\xff\xfe", b"\xfe\xff")):
            return None, _problem("NOT_TEXT")
    return kind, None


def _check_docx(data: bytes):
    if not data.startswith(b"PK"):
        return "NOT_A_DOCX"
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
        infos = zf.infolist()
    except Exception:  # noqa: BLE001 - any failure to read the archive directory means it is not usable
        return "NOT_A_DOCX"
    if len(infos) > MAX_ENTRIES:
        return "UNSAFE_ARCHIVE"
    names = {i.filename.lower() for i in infos}
    if "word/document.xml" not in names:
        return "NOT_A_DOCX"
    if any(n.endswith("vbaproject.bin") or n.startswith("word/vba") for n in names):
        return "MACRO_DOCUMENT"
    total = 0
    for i in infos:
        total += i.file_size
        if i.file_size > MAX_PART or total > MAX_UNCOMPRESSED:
            return "UNSAFE_ARCHIVE"
        if i.file_size > 5 * 1024 * 1024 and i.compress_size and i.file_size / i.compress_size > MAX_RATIO:
            return "UNSAFE_ARCHIVE"
    return None
