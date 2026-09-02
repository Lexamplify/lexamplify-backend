"""
utils/pdf_helper.py
Converts PDF / DOCX / plain text into a list of clause dicts.
Returns: [{"id": "clause_1", "text": "..."}, ...]
"""
import re
import io

def extract_clauses_from_pdf(file_bytes: bytes) -> list:
    import PyPDF2
    reader = PyPDF2.PdfReader(io.BytesIO(file_bytes))
    raw = ""
    for page in reader.pages:
        raw += (page.extract_text() or "") + "\n"
    return _split_into_clauses(raw)

def extract_clauses_from_docx(file_bytes: bytes) -> list:
    import docx
    doc = docx.Document(io.BytesIO(file_bytes))
    raw = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
    return _split_into_clauses(raw)

def extract_clauses_from_text(text: str) -> list:
    return _split_into_clauses(text)

def extract_text_for_summary(file_bytes: bytes, filetype: str) -> str:
    """For document summarizer / Contract Analyzer pre-scan extraction —
    returns raw text. PDF path uses PyMuPDF (fitz), not PyPDF2 — PyPDF2 has
    no internal bound on certain malformed/complex PDFs and can run for a
    very long time; fitz is both faster in the common case and, paired with
    the caller's own hard timeout (routes/contract_routes.py's
    extract_text route), actually boundable."""
    if filetype == "pdf":
        import fitz
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        try:
            # page.get_text() (plain "text" mode) puts a \n at every ORIGINAL
            # PRINT LINE, not at paragraph boundaries — a sentence that wrapped
            # across two print lines in the PDF becomes two separate lines
            # here. Fed through rawTextToHtml() on the frontend (which treats
            # a single \n as a soft <br> and needs a blank line for a new
            # <p>), that reproduces the PDF's print-line wrapping as random
            # mid-sentence breaks instead of real paragraphs — confirmed live
            # against a real PDF upload showing exactly this collapsed/
            # misaligned text in the Auto-Draft editor.
            #
            # get_text("blocks") instead: each block is one logical
            # paragraph/heading/list-item as PyMuPDF's own layout analysis
            # groups it. Flatten each block's internal line-wraps into a
            # single flowing line (they're print-line wraps, not real
            # breaks), join blocks with a blank line so the frontend
            # reconstructs real paragraphs, and drop two kinds of pure
            # layout noise that otherwise leak into the text: page-number
            # footers/headers (a block that's just digits) and standalone
            # bullet-glyph blocks (some PDF exporters place a list's bullet
            # characters in their own block, separate from the item text).
            paragraphs = []
            for page in doc:
                blocks = page.get_text("blocks")
                blocks.sort(key=lambda b: (round(b[1], 1), b[0]))
                for b in blocks:
                    block_text = b[4].strip()
                    if not block_text:
                        continue
                    if re.fullmatch(r'\d{1,4}', block_text):
                        continue
                    if re.fullmatch(r'[•\-\*\s]+', block_text):
                        continue
                    flowed = re.sub(r'\s*\n\s*', ' ', block_text).strip()
                    paragraphs.append(flowed)
            text = "\n\n".join(paragraphs)
        finally:
            doc.close()
    elif filetype == "docx":
        import docx
        doc = docx.Document(io.BytesIO(file_bytes))
        text = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
    else:
        text = file_bytes.decode("utf-8", errors="ignore")
    return text

def _split_into_clauses(text: str) -> list:
    """
    Split contract text into individual clauses.
    Handles: numbered (1. 2. 3.), lettered (a. b.), and paragraph splits.
    Each clause becomes one item for AI analysis.
    """
    # Normalize line endings
    text = text.replace('\r\n', '\n').replace('\r', '\n')

    # Split on numbered clause patterns: "1." "2." "(1)" "(a)" at start of line or after period+space
    # This regex splits BEFORE each numbered item
    split_pattern = re.compile(
        r'(?<!\w)'           # not preceded by word char
        r'(?='               # lookahead
        r'(?:\d{1,2}\.\ )'  # "1. " "2. " etc
        r'|(?:\([a-zA-Z0-9]\)\ )'  # "(a) " "(1) " etc
        r')',
        re.MULTILINE
    )

    parts = split_pattern.split(text)

    clauses = []
    clause_id = 1

    for part in parts:
        part = part.strip()
        if not part or len(part) < 20:
            continue

        # If the part is very long (>300 chars), split at sentence boundaries
        if len(part) > 300:
            sentences = re.split(r'(?<=[.!?])\s+', part)
            buffer = ""
            for sentence in sentences:
                buffer += (" " if buffer else "") + sentence
                if len(buffer) > 200:
                    clauses.append({
                        "id": f"clause_{clause_id}",
                        "text": buffer.strip()
                    })
                    clause_id += 1
                    buffer = ""
            if buffer.strip() and len(buffer.strip()) > 20:
                clauses.append({
                    "id": f"clause_{clause_id}",
                    "text": buffer.strip()
                })
                clause_id += 1
        else:
            clauses.append({
                "id": f"clause_{clause_id}",
                "text": part
            })
            clause_id += 1

    return clauses