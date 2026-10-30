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


def decode_text(data: bytes) -> str:
    """Decode a .txt upload: UTF-16 only when it has a byte-order mark (it would otherwise accept any even-length bytes),
    then UTF-8 (with or without BOM), then Windows-1252, which Indian offices' older files are usually saved in."""
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        try:
            return data.decode("utf-16")
        except UnicodeError:
            pass
    try:
        return data.decode("utf-8-sig")
    except UnicodeError:
        return data.decode("cp1252", errors="replace")


# ──────────────────────────────────────────────────────────────────────────────────────────────
# Stricter checks for the routes that used to read uploads with no real checks (Step 7, batch 2a):
# /api/ai/extract-file, /api/upload-case, /api/vc/simulate and the two conflict routes.
# Everything above this line is unchanged: check_upload and its limits still serve the contract routes exactly as before.
# The limits below are used ONLY by the functions below.
# ──────────────────────────────────────────────────────────────────────────────────────────────
STRICT_MAX_BYTES = 30 * 1024 * 1024          # one file; read at most this + 1 byte from the request
STRICT_MAX_PDF_PAGES = 1500
STRICT_DOCX_MAX_PART = 8 * 1024 * 1024       # any one XML part of a .docx, uncompressed (pictures, fonts and embeddings are not XML parts)
STRICT_DOCX_MAX_TOTAL = 24 * 1024 * 1024     # all XML parts together, uncompressed
STRICT_DOCX_MAX_ALL = 64 * 1024 * 1024       # every part together (pictures included), uncompressed
STRICT_DOCX_MAX_RATIO = 200                  # expanded:compressed, judged for every part above STRICT_DOCX_RATIO_FROM
STRICT_DOCX_RATIO_FROM = 256 * 1024
STRICT_DOCX_MAX_ELEMENTS = 25000             # paragraphs + runs + table cells in the main document part
STRICT_DOCX_MAX_TOTAL_ELEMENTS = 250000      # ONE budget: the sum of every element of EVERY XML part of the file (main part, styles, numbering, settings, headers, footers, .rels ...); python-docx loads all linked parts into memory, about 130 bytes per element

CONFLICT_MAX_FILES = 10                      # file parts (any field name) or JSON documents per request
CONFLICT_MAX_TOTAL_BYTES = 50 * 1024 * 1024
CONFLICT_MAX_DOC_CHARS = 600000              # text of one document; longer is refused, never cut
CONFLICT_MAX_LINE_CHARS = 20000              # longest run of characters between "\n" characters (the comparator splits on "\n" only)
CONFLICT_MAX_PAIR_CHARS = 6000000            # (documents - 1) x total characters: the rule-based comparator's cost grows with this

_W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
_COUNTED = ("{%s}p" % _W_NS, "{%s}r" % _W_NS, "{%s}tc" % _W_NS)
_MB = 1024 * 1024


def _sp(code, message, status=None):
    return {"code": code, "message": message, "status": status or (413 if code in ("TOO_LARGE", "TOO_MANY_FILES", "TOO_MANY_PAGES") else 422)}


def problem_json(problem, with_message=False):
    """The JSON body for a refusal. 'error' stays a plain string (the old routes' shape); conflict routes also get 'message'."""
    if with_message:
        return {"error": problem["message"], "message": problem["message"], "code": problem["code"]}
    return {"error": problem["message"], "code": problem["code"]}


def count_docx_elements(xml: bytes, limit: int, total_limit: int = None):
    """Count the paragraphs, runs and table cells of a Word main part by their real namespace (never by prefix), with a
    streaming parse that stops as soon as the count passes `limit`. Returns (count, status), status one of
    "ok", "limit", "dtd" (a DOCTYPE or entity declaration), "malformed".

    With `total_limit`, ALL elements are counted too (every start event), and the part is refused ("total") as soon as their
    number passes it. That pass clears each element at its end and drops the earlier siblings, so memory stays flat while a
    part with millions of tiny elements is read; the counted-element result is the same as without `total_limit`."""
    from lxml import etree
    if total_limit is not None:
        counted, _total, status = _scan_xml(xml, limit, total_limit)
        return counted, status
    if b"<!DOCTYPE" in xml[:8192] or b"<!ENTITY" in xml[:8192]:
        return 0, "dtd"
    count = 0
    try:
        ctx = etree.iterparse(io.BytesIO(xml), events=("start",), tag=_COUNTED, resolve_entities=False, no_network=True,
                              load_dtd=False, huge_tree=False)
        for _event, el in ctx:
            count += 1
            if count == 1 and _has_dtd(el):
                return 0, "dtd"
            if count > limit:
                return count, "limit"
        if _has_dtd(ctx.root):
            return 0, "dtd"
    except Exception:  # noqa: BLE001 - any parse failure means the part is not usable XML
        return count, "malformed"
    return count, "ok"


def _scan_xml(xml: bytes, limit, total_limit: int):
    """One streaming pass over an XML part: (counted, total, status). `counted` is the number of Word paragraphs, runs and
    cells (stops with "limit" past `limit`, unless `limit` is None); `total` is the number of ALL elements (stops with "total"
    as soon as it passes `total_limit`). Other statuses: "ok", "dtd", "malformed" (total is then what was seen before the error).
    Each element is cleared at its end and the earlier siblings are dropped, so memory stays flat."""
    from lxml import etree
    if b"<!DOCTYPE" in xml[:8192] or b"<!ENTITY" in xml[:8192]:
        return 0, 0, "dtd"
    counted = total = 0
    try:
        ctx = etree.iterparse(io.BytesIO(xml), events=("start", "end"), resolve_entities=False, no_network=True,
                              load_dtd=False, huge_tree=False)
        for event, el in ctx:
            if event == "start":
                total += 1
                if total == 1 and _has_dtd(el):
                    return 0, 0, "dtd"
                if limit is not None and el.tag in _COUNTED:
                    counted += 1
                    if counted > limit:
                        return counted, total, "limit"
                if total > total_limit:
                    return counted, total, "total"
            else:
                el.clear()
                parent = el.getparent()
                if parent is not None:
                    while el.getprevious() is not None:
                        del parent[0]
        if _has_dtd(ctx.root):
            return 0, 0, "dtd"
    except Exception:  # noqa: BLE001 - any parse failure means the part is not usable XML
        return counted, total, "malformed"
    return counted, total, "ok"


def count_xml_elements(xml: bytes, limit: int):
    """Count ALL elements of one XML part with a streaming parse that stops as soon as the count passes `limit`.
    Returns (count, status), status one of "ok", "total" (more than `limit`), "dtd", "malformed"."""
    _counted, total, status = _scan_xml(xml, None, limit)
    return total, status


def _has_dtd(el):
    if el is None:
        return False
    di = el.getroottree().docinfo
    return bool(di.doctype) or di.internalDTD is not None or di.externalDTD is not None


def _main_part_name(zf):
    """The main document part, as named by the package relationships (usually word/document.xml)."""
    from lxml import etree
    try:
        info = zf.getinfo("_rels/.rels")
        if info.file_size > _MB:
            return None
        root = etree.fromstring(zf.read(info), etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False, huge_tree=False))
        if _has_dtd(root):
            return None
    except Exception:  # noqa: BLE001
        return None
    for el in root:
        if isinstance(el.tag, str) and el.tag.endswith("}Relationship") and (el.get("Type") or "").endswith("/officeDocument"):
            if el.get("TargetMode") == "External":
                continue
            name = (el.get("Target") or "").lstrip("/")
            if name in zf.NameToInfo:
                return name
    return None


def _read_content_types(zf):
    """({part name: content type}, {extension: content type}) from [Content_Types].xml, read with the safe parser and at most
    1 MB, or (None, problem) when it is missing, too big, malformed or has a DOCTYPE."""
    from lxml import etree
    try:
        info = zf.getinfo("[Content_Types].xml")
    except KeyError:
        return None, _problem("NOT_A_DOCX")
    if info.file_size > _MB:
        return None, _problem("UNSAFE_ARCHIVE")
    try:
        root = etree.fromstring(zf.read(info), etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False, huge_tree=False))
    except Exception:  # noqa: BLE001 - damaged archive entry or malformed XML
        return None, _problem("NOT_A_DOCX")
    if _has_dtd(root):
        return None, _problem("UNSAFE_ARCHIVE")
    overrides, defaults = {}, {}
    for el in root:
        if not isinstance(el.tag, str):
            continue
        tag = el.tag.rsplit("}", 1)[-1]
        if tag == "Override" and el.get("PartName"):
            overrides[el.get("PartName")] = el.get("ContentType") or ""
        elif tag == "Default" and el.get("Extension"):
            defaults[el.get("Extension").lower()] = el.get("ContentType") or ""
    return (overrides, defaults), None


def _is_xml_part(name: str, types) -> bool:
    """Whether a part will be parsed as XML. python-docx decides from [Content_Types].xml (an Override by part name, otherwise a
    Default by extension), never from the file name, so this does the same. A part whose type cannot be found counts as XML (strict)."""
    overrides, defaults = types
    if name.lower().endswith(".rels"):          # python-docx reads relationship parts as XML by their name, whatever [Content_Types].xml says
        return True
    ctype = overrides.get("/" + name)
    if ctype is None:
        last = name.rsplit("/", 1)[-1]
        ctype = defaults.get(last.rsplit(".", 1)[-1].lower() if "." in last else "")
    ctype = (ctype or "").split(";")[0].strip().lower()
    if not ctype:
        return True
    return ctype.endswith("+xml") or ctype in ("application/xml", "text/xml")


def _strict_docx(data: bytes):
    """Problem for a .docx that passed check_upload but is too big, too expanded or too complex to read in time, else None.
    XML parts (judged by their content type, not their name) are capped one by one and together; pictures, fonts and other
    binary parts only count towards the overall cap. The compression-ratio rule applies to every part. The elements of ALL XML
    parts (not only the main one) share one budget, STRICT_DOCX_MAX_TOTAL_ELEMENTS, because python-docx parses them all."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
        infos = zf.infolist()
    except Exception:  # noqa: BLE001
        return _problem("NOT_A_DOCX")
    types, problem = _read_content_types(zf)
    if problem:
        return problem
    xml_total = all_total = 0
    for i in infos:
        all_total += i.file_size
        if _is_xml_part(i.filename, types):
            xml_total += i.file_size
            if i.file_size > STRICT_DOCX_MAX_PART or xml_total > STRICT_DOCX_MAX_TOTAL:
                return _sp("UNSAFE_ARCHIVE", "That Word file has more text content than we can read safely when opened (more than %d MB in one part, or more than %d MB in all). "
                           "Save it as a PDF, or split it into smaller files." % (max(1, STRICT_DOCX_MAX_PART // _MB), max(1, STRICT_DOCX_MAX_TOTAL // _MB)))
        if all_total > STRICT_DOCX_MAX_ALL:
            return _sp("UNSAFE_ARCHIVE", "That Word file is too large to read safely when opened (more than %d MB once unpacked). "
                       "Save it as a PDF, or split it into smaller files." % max(1, STRICT_DOCX_MAX_ALL // _MB))
        if i.file_size > STRICT_DOCX_RATIO_FROM and i.file_size / max(i.compress_size, 1) > STRICT_DOCX_MAX_RATIO:
            return _sp("UNSAFE_ARCHIVE", "That Word file expands to far more than its size on disk, so we could not accept it. "
                       "Open it in Word and save it again, or save it as a PDF.")
    main = _main_part_name(zf)
    if main is None:
        return _problem("NOT_A_DOCX")
    try:
        with zf.open(main) as fh:
            xml = fh.read(STRICT_DOCX_MAX_PART + 1)
    except Exception:  # noqa: BLE001 - damaged or password-protected archive entry
        return _problem("NOT_A_DOCX")
    if len(xml) > STRICT_DOCX_MAX_PART:
        return _sp("UNSAFE_ARCHIVE", "That Word file is too large to read safely when opened. Save it as a PDF, or split it into smaller files.")
    too_many = _sp("UNSAFE_ARCHIVE", "That Word file is built from more than {:,} elements, which is more than we can read in one go. "
                   "Save it as a PDF, or split it into smaller files.".format(STRICT_DOCX_MAX_TOTAL_ELEMENTS))
    _n, total, status = _scan_xml(xml, STRICT_DOCX_MAX_ELEMENTS, STRICT_DOCX_MAX_TOTAL_ELEMENTS)
    if status == "total":
        return too_many
    if status == "limit":
        return _sp("UNSAFE_ARCHIVE", "That Word file has more than {:,} paragraphs, text runs and table cells, which is more than we can read in one go. "
                   "Save it as a PDF, or split it into smaller files.".format(STRICT_DOCX_MAX_ELEMENTS))
    if status == "dtd":
        return _problem("UNSAFE_ARCHIVE")
    if status == "malformed":
        return _problem("NOT_A_DOCX")
    # python-docx also loads and parses the parts the document links to (styles, numbering, settings, headers, footers,
    # comments and every .rels part), so the elements of ALL XML parts share one budget with the main part.
    budget = STRICT_DOCX_MAX_TOTAL_ELEMENTS - total
    for i in infos:
        if i.filename == main or i.filename.endswith("/") or not i.file_size or not _is_xml_part(i.filename, types):
            continue
        try:
            with zf.open(i) as fh:
                part = fh.read(STRICT_DOCX_MAX_PART + 1)
        except Exception:  # noqa: BLE001 - damaged entry: the extractor will report it
            continue
        n, status = count_xml_elements(part, budget)
        if status == "total":
            return too_many
        if status == "dtd":
            return _problem("UNSAFE_ARCHIVE")
        budget -= n                              # "malformed": only the elements seen before the error count
    return None


def _strict_pdf(data: bytes):
    """Open the PDF with PyMuPDF (fast, and it never extracts text, so a scan with no text passes). Refuses a file PyMuPDF
    cannot open, one that needs a password to open, and one with too many pages. An owner-password-only PDF opens without a
    password and is accepted."""
    try:
        import fitz
    except ImportError:  # pragma: no cover - PyMuPDF is in requirements.txt
        return None
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception:  # noqa: BLE001 - damaged, junk after a PDF header, broken page tree
        return _problem("NOT_A_PDF")
    try:
        if doc.needs_pass:
            return _sp("EXTRACTION_ERROR", "That PDF needs a password to open. Remove the password in your PDF viewer, save a copy, and upload the copy.")
        pages = doc.page_count
        if pages > STRICT_MAX_PDF_PAGES:
            return _sp("TOO_MANY_PAGES", "That PDF has more than {:,} pages, which is more than we can read in one go. "
                       "Upload only the pages you need, saved as a separate PDF.".format(STRICT_MAX_PDF_PAGES))
        if pages < 1:
            return _problem("NOT_A_PDF")             # a PDF-looking file with no pages (junk that PyMuPDF "repairs")
        doc.load_page(0)                             # walks the page tree: a loop or a broken tree raises here
    except Exception:  # noqa: BLE001
        return _problem("NOT_A_PDF")
    finally:
        doc.close()
    return None


def _looks_like_text_under_document_name(data: bytes) -> bool:
    """Clean text that arrives under a .pdf/.docx name (the conflict page re-sends restored documents that way)."""
    return bool(data) and b"\x00" not in data and not data.startswith((b"%PDF-", b"PK"))


def check_upload_strict(data: bytes, filename: str, *, allow_text_under_document_name: bool = False, max_bytes: int = None):
    """Return (kind, None) when the upload may be parsed, else (None, {code, message, status}).

    Runs check_upload first, then the stricter docx and PDF rules. The name only says which type is EXPECTED; the bytes must
    confirm it. Any name that is not .pdf/.docx/.txt (.md, .csv, .html, no extension ...) is checked as plain text.
    With allow_text_under_document_name (conflict routes only) clean text under a .pdf/.docx name is accepted as text."""
    limit = STRICT_MAX_BYTES if max_bytes is None else max_bytes
    name_kind = kind_from_name(filename)
    if not data:
        return None, _problem("EMPTY_FILE")
    if len(data) > limit:
        return None, _sp("TOO_LARGE", "That file is too large. The limit is %d MB. Upload the relevant pages only." % max(1, limit // _MB))
    if allow_text_under_document_name and name_kind in ("pdf", "docx") and _looks_like_text_under_document_name(data):
        name_kind = "txt"
    kind, problem = check_upload(data, "x." + (name_kind or "txt"))
    if problem:
        return None, problem
    problem = _strict_docx(data) if kind == "docx" else _strict_pdf(data) if kind == "pdf" else None
    if problem:
        return None, problem
    return kind, None


def read_checked_upload(storage, *, allow_text_under_document_name: bool = False):
    """Read an uploaded file (a werkzeug FileStorage) with at most STRICT_MAX_BYTES + 1 bytes and check it.
    Returns (kind, data, None) or (None, None, problem). The stream is rewound, so a later storage.read() still works."""
    limit = STRICT_MAX_BYTES
    data = storage.stream.read(limit + 1)
    try:
        storage.stream.seek(0)
    except Exception:  # noqa: BLE001
        pass
    kind, problem = check_upload_strict(data, storage.filename or "", allow_text_under_document_name=allow_text_under_document_name, max_bytes=limit)
    if problem:
        return None, None, problem
    return kind, data, None


def _stream_size(storage):
    try:
        storage.stream.seek(0, 2)
        n = storage.stream.tell()
        storage.stream.seek(0)
        return n
    except Exception:  # noqa: BLE001
        return 0


def _too_many_files():
    return _sp("TOO_MANY_FILES", "You can compare at most %d documents at a time. Remove some and try again." % CONFLICT_MAX_FILES)


def check_files_request(files, kinds=None):
    """Conflict routes: judge every file part of the request, whatever its field name (the handler only finds doc1..docN
    and the 'files'/'documents' lists, and stops at the first missing slot, so the cap must not depend on that).
    Counts all parts, caps their total size, then runs the strict checks on each named part. `kinds`, if given, is filled
    with id(part) -> "pdf" | "docx" | "txt". Streams are left rewound."""
    parts = [part for _field, part in files.items(multi=True)]
    if len(parts) > CONFLICT_MAX_FILES:
        return _too_many_files()
    if sum(_stream_size(p) for p in parts) > CONFLICT_MAX_TOTAL_BYTES:
        return _sp("TOO_LARGE", "Together these files are too large to compare in one check (the limit is %d MB in total). "
                   "Remove some, or upload only the relevant pages." % max(1, CONFLICT_MAX_TOTAL_BYTES // _MB))
    for part in parts:
        if not part.filename:
            continue
        kind, _data, problem = read_checked_upload(part, allow_text_under_document_name=True)
        if problem:
            return problem
        if kinds is not None:
            kinds[id(part)] = kind
    return None


def check_readable_count(n_docs: int, n_unreadable: int, minimum: int = 2):
    """Conflict routes: a check needs at least max(minimum, 1) documents WITH readable text. Zero readable documents is always
    refused: a comparison of nothing would look like a clearance, which it is not. Same status (400) as the routes' own
    "at least 2 documents" answer. The message carries counts only, never a file name."""
    need = max(minimum, 1)
    readable = n_docs - n_unreadable
    if readable >= need:
        return None
    if readable <= 0:
        why = "none of your %d document%s had readable text" % (n_docs, "" if n_docs == 1 else "s")
        return _sp("NOT_ENOUGH_READABLE_TEXT", "At least %d document%s with readable text %s needed, but %s (for example a scan). "
                   "Upload text versions or run OCR on the scans first." % (need, "" if need == 1 else "s", "is" if need == 1 else "are", why), 400)
    return _sp("NOT_ENOUGH_READABLE_TEXT", "At least %d documents with readable text are needed. %d of your %d documents had no readable text (for example a scan). "
               "Upload text versions or run OCR on the scans first." % (need, n_unreadable, n_docs), 400)


def check_json_documents(raw_docs):
    """Conflict routes, JSON body: the number of documents."""
    if isinstance(raw_docs, list) and len(raw_docs) > CONFLICT_MAX_FILES:
        return _too_many_files()
    return None


def check_conflict_documents(docs):
    """Conflict routes, after extraction and before the comparator or any LLM call. `docs` is a list of {"name", "text"}.
    Never cuts text: a document that is too long is refused. Checks, in this order: count; characters in one document; the
    longest line (split on "\\n" only, which is how the comparator finds the start and end of a snippet); and the pair budget
    (documents - 1) x total characters, which bounds the comparator's work."""
    if len(docs) > CONFLICT_MAX_FILES:
        return _too_many_files()
    for d in docs:
        if len(d["text"]) > CONFLICT_MAX_DOC_CHARS:
            return _sp("TOO_LARGE", "One of the documents has more than {:,} characters of text (roughly {} pages), which is too long to compare without cutting it. "
                       "Upload only the relevant part, for example the pages you need saved as a separate PDF.".format(CONFLICT_MAX_DOC_CHARS, max(1, CONFLICT_MAX_DOC_CHARS // 2400)))
    for d in docs:
        text = d["text"]
        if len(text) > CONFLICT_MAX_LINE_CHARS and max(map(len, text.split("\n"))) > CONFLICT_MAX_LINE_CHARS:
            return _sp("TOO_LARGE", "This file has a very long stretch of text (more than {:,} characters without a line break). "
                       "Add line breaks, or upload it as a PDF or Word file.".format(CONFLICT_MAX_LINE_CHARS))
    total = sum(len(d["text"]) for d in docs)
    if (len(docs) - 1) * total > CONFLICT_MAX_PAIR_CHARS:
        return _sp("TOO_LARGE", "These documents contain too much text to compare in one check. Split them into smaller groups and check each group.")
    return None
