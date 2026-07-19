"""
routes/document_routes.py
Blueprint: /api/documents
  POST /api/documents/draft    — Auto-draft court pleadings (Original route preserved)
  POST /api/documents/upload   — Upload files (PDF/DOCX/TXT), extract text, save and vectorize (RAG)
  GET  /api/documents          — List uploaded documents (filtered by case_id)
  DELETE /api/documents/<id>   — Delete document and cascade delete RAG vectors
"""
import os
import io
import uuid
import sqlite3
from flask import Blueprint, jsonify, request, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from werkzeug.utils import secure_filename
from utils.ai_helper import ask_groq
from utils.rag_pipeline import ingest_document

doc_bp = Blueprint("document", __name__)

DB_PATH = "lex_assistant.db"

# ── 1. ROBUST TEXT EXTRACTION UTILITY ───────────────────────────────────

def extract_text_from_file(file_bytes: bytes, filename: str) -> str:
    """
    Extracts plain text from PDF, DOCX, or TXT file using fitz (PyMuPDF), pdfplumber,
    python-docx, or PyPDF2 with cascading fallbacks.
    """
    ext = filename.lower().split('.')[-1]
    
    if ext == 'pdf':
        # Fallback Level 1: PyMuPDF (fitz)
        try:
            import fitz
            doc = fitz.open(stream=file_bytes, filetype="pdf")
            text = ""
            for page in doc:
                text += page.get_text() + "\n"
            if text.strip():
                return text.strip()
        except ImportError:
            print("[PDF Extractor] PyMuPDF (fitz) not installed. Trying pdfplumber...")
        except Exception as e:
            print(f"[PDF Extractor] PyMuPDF extraction failed: {e}")
            
        # Fallback Level 2: pdfplumber
        try:
            import pdfplumber
            with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
                text = ""
                for page in pdf.pages:
                    page_text = page.extract_text()
                    if page_text:
                        text += page_text + "\n"
                if text.strip():
                    return text.strip()
        except ImportError:
            print("[PDF Extractor] pdfplumber not installed. Trying PyPDF2...")
        except Exception as e:
            print(f"[PDF Extractor] pdfplumber extraction failed: {e}")

        # Fallback Level 3: PyPDF2 (guaranteed standard)
        try:
            import PyPDF2
            reader = PyPDF2.PdfReader(io.BytesIO(file_bytes))
            text = ""
            for page in reader.pages:
                text += (page.extract_text() or "") + "\n"
            return text.strip()
        except Exception as e:
            print(f"[PDF Extractor] PyPDF2 fallback failed: {e}")
            return ""

    elif ext in ['docx', 'doc']:
        # Extract text and tables from DOCX
        try:
            import docx
            doc = docx.Document(io.BytesIO(file_bytes))
            content_list = []
            
            # Paragraphs
            for p in doc.paragraphs:
                if p.text.strip():
                    content_list.append(p.text)
                    
            # Table cells
            for table in doc.tables:
                for row in table.rows:
                    for cell in row.cells:
                        text = cell.text.strip()
                        if text and text not in content_list:
                            content_list.append(text)
                            
            return "\n".join(content_list).strip()
        except Exception as e:
            print(f"[DOCX Extractor] python-docx extraction failed: {e}")
            return ""

    else:
        # Plain text
        try:
            return file_bytes.decode('utf-8', errors='ignore').strip()
        except Exception as e:
            print(f"[Text Extractor] plain text decode failed: {e}")
            return ""

# ── 2. PRESERVED ORIGINAL AUTO-DRAFT ROUTE ─────────────────────────────

@doc_bp.route("/draft", methods=["POST"])
def auto_draft():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid JSON payload structure."}), 400
        
    prompt = data.get("prompt", "").strip()
    context = data.get("context", "").strip()
    
    if not prompt or not context:
        return jsonify({"error": "Failed verification: Prompt and active Vault Context are required to synthesize drafts."}), 400
        
    system_prompt = f"""You are an Elite Indian Supreme Court Advocate drafting formal legal documents.
You are synthesizing a document based on the user's instructions and the provided reference file context (e.g., an FIR).

CONTEXT FILE:
{context}

CRITICAL DRAFTING RULES:
1. ABSOLUTELY NO HTML TAGS: You are strictly forbidden from using <p>, <h2>, <br>, or any other HTML tags. Use standard plain text, line breaks, and ALL CAPS for headings.
2. STRICT COURT PLEADING FORMAT: If drafting an application (like Bail), it MUST begin with the formal Indian court heading:
   IN THE COURT OF [Appropriate Magistrate/Judge]
   AT [Location]
   CRIMINAL MISC. BAIL APPLICATION NO. _____ OF 202X
   [Name of Applicant] ... APPLICANT
   VERSUS
   STATE OF [State] ... RESPONDENT
3. NUMBERED PARAGRAPHS: The body of the document must be written in formal, numbered paragraphs (1., 2., 3...) standard to Indian pleadings.
4. LEGAL PRECISION: Incorporate the facts from the provided Context File accurately. Cite relevant Indian laws (e.g., Section 437/439 of the CrPC for Bail).
5. PRAYER: Always conclude with a formal "PRAYER" section requesting the specific relief, followed by "AND FOR THIS ACT OF KINDNESS THE APPLICANT SHALL AS IN DUTY BOUND EVER PRAY."
6. OUTPUT NOTHING BUT THE FINAL DRAFTED DOCUMENT. No preambles, no commentary, no "Here is the draft..." — only the document itself.
"""

    try:
        draft_content = ask_groq(system_prompt, f"Draft Request: {prompt}")
        
        if not draft_content or draft_content.strip() == "None":
            return jsonify({"error": "Inference Breakdown: Internal LLM node refused to output a draft."}), 500
            
        return jsonify({"draft": draft_content}), 200
    except Exception as e:
        return jsonify({"error": f"LLM Routing Array Exception: {str(e)}"}), 500

# ── 3. ENTERPRISE UPLOAD & RAG INGESTION ROUTE ─────────────────────────

@doc_bp.route("/upload", methods=["POST"])
@jwt_required()
def upload_document():
    """
    Accepts document files, executes clean text extraction, generates a two-sentence
    summary, and indexes the document chunks with embeddings in the database.
    """
    user_id = int(get_jwt_identity())
    
    if 'file' not in request.files:
        return jsonify({"error": "No file part in the multipart request."}), 400
        
    f = request.files['file']
    if f.filename == '':
        return jsonify({"error": "No file selected."}), 400
        
    # case_vault.case_id is TEXT (mass-ingestion and auto-provisioned vault
    # entries use non-numeric ids like "case_138_dashrath" or
    # "conflict-<timestamp>"), so keep it as a plain string rather than
    # forcing int() the way the old SQLAlchemy FK column required.
    case_id = request.form.get("case_id") or None

    try:
        # Read file bytes in memory for extraction
        file_bytes = f.read()
        extracted_text = extract_text_from_file(file_bytes, f.filename)
        
        if not extracted_text.strip():
            return jsonify({"error": "Failed to extract clean text from the document. The file might be scanned/empty."}), 400
            
        # Save file to uploads folder
        upload_folder = current_app.config.get('UPLOAD_FOLDER', 'static/uploads')
        os.makedirs(upload_folder, exist_ok=True)
        unique_filename = f"{uuid.uuid4().hex}_{secure_filename(f.filename)}"
        file_path = os.path.join(upload_folder, unique_filename)
        
        with open(file_path, "wb") as out_file:
            out_file.write(file_bytes)
            
        # Generate a lightweight 2-sentence summary
        summary = "No summary generated."
        try:
            summary_system_prompt = (
                "You are an elite Indian legal assistant. Read the provided text and write a brief, "
                "2-sentence executive summary of the document highlighting the parties, type of document, "
                "and key subject matter. Keep it strictly to two sentences."
            )
            # Sample first 4000 characters to make summary generation fast
            summary = ask_groq(summary_system_prompt, f"Text snippet:\n{extracted_text[:4000]}").strip()
        except Exception as se:
            print(f"[RAG Ingestion] AI Summary generation skipped: {se}")
            summary = f"Uploaded legal document '{f.filename}' containing {len(extracted_text)} characters."

        # Save metadata record into case_vault — the single source of truth
        # shared with Firm Library / InzIQ, instead of the old SQLAlchemy
        # Document table. doc_type defaults to "Vault Document" and tags to
        # a valid empty JSON array so the citation json_insert/json_remove
        # SQL functions never choke on a NULL or malformed value.
        conn = sqlite3.connect(DB_PATH)
        try:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO case_vault (case_id, title, doc_type, content, tags) VALUES (?, ?, ?, ?, ?)",
                (case_id, f.filename, "Vault Document", extracted_text, "[]")
            )
            conn.commit()
            new_doc_id = cursor.lastrowid
        finally:
            conn.close()

        # Ingest text chunks & generate embeddings — keyed to the new
        # case_vault id so RAG chunk lookups stay consistent with it.
        chunks_count = ingest_document(
            document_id=new_doc_id,
            case_id=case_id,
            user_id=user_id,
            text=extracted_text
        )

        return jsonify({
            "message": "Document uploaded and vectorized successfully.",
            "document": {
                "id": new_doc_id,
                "filename": f.filename,
                "summary": summary,
                "chunks_indexed": chunks_count
            }
        }), 201

    except Exception as e:
        print(f"[Upload Route Error]: {e}")
        return jsonify({"error": f"Failed to ingest document: {str(e)}"}), 500

# ── 4. DOCUMENT LIST ROUTE ──────────────────────────────────────────────

@doc_bp.route("", methods=["GET"])
@jwt_required()
def list_documents():
    """Lists metadata for case_vault documents, optionally filtered by
    case_id. Queries case_vault directly — the single source of truth shared
    with Firm Library / InzIQ — instead of the old SQLAlchemy Document table,
    so ids returned here line up with the citation routes' doc_id space."""
    case_id_raw = request.args.get("case_id")

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        if case_id_raw:
            rows = conn.execute(
                "SELECT id AS doc_id, case_id, title, doc_type, tags, created_at "
                "FROM case_vault WHERE case_id = ? ORDER BY created_at DESC",
                (case_id_raw,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id AS doc_id, case_id, title, doc_type, tags, created_at "
                "FROM case_vault ORDER BY created_at DESC"
            ).fetchall()
    except Exception as e:
        print(f"[List Docs Error]: {e}")
        return jsonify({"error": "Failed to fetch documents."}), 500
    finally:
        conn.close()

    # Mapped onto the exact shape CaseVault.jsx already renders (id/filename/
    # filetype/summary) so the existing table UI needs no changes.
    return jsonify([{
        "id": r["doc_id"],
        "case_id": r["case_id"],
        "filename": r["title"],
        "filetype": r["doc_type"],
        "summary": None,
        "tags": r["tags"],
        "created_at": r["created_at"],
    } for r in rows]), 200

# ── 5. DOCUMENT DETAILS ROUTE (WITH CHUNKS RECONSTRUCTION) ──────────────

@doc_bp.route("/<int:doc_id>", methods=["GET"])
@jwt_required()
def get_document_details(doc_id):
    """Fetches case_vault document metadata and reconstructs full text from
    its RAG chunks, falling back to the row's own stored content if no
    chunks exist."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            "SELECT id AS doc_id, case_id, title, doc_type, tags, content, created_at "
            "FROM case_vault WHERE id = ?",
            (doc_id,)
        ).fetchone()
        if not row:
            return jsonify({"error": "Document not found."}), 404

        chunk_rows = conn.execute(
            "SELECT chunk_text FROM document_chunks WHERE document_id = ? ORDER BY chunk_index ASC",
            (doc_id,)
        ).fetchall()
    except Exception as e:
        print(f"[Get Doc Details Error]: {e}")
        return jsonify({"error": f"Failed to retrieve document details: {str(e)}"}), 500
    finally:
        conn.close()

    full_text = "\n\n".join(r[0] for r in chunk_rows) if chunk_rows else (row["content"] or "")

    return jsonify({
        "id": row["doc_id"],
        "case_id": row["case_id"],
        "filename": row["title"],
        "filetype": row["doc_type"],
        "summary": None,
        "tags": row["tags"],
        "created_at": row["created_at"],
        "text": full_text
    }), 200

# ── 6. DOCUMENT DELETE ROUTE ───────────────────────────────────────────

@doc_bp.route("/<int:doc_id>", methods=["DELETE"])
@jwt_required()
def delete_document(doc_id):
    """Deletes the case_vault document and cascade-deletes its RAG chunks."""
    conn = sqlite3.connect(DB_PATH)
    try:
        row = conn.execute("SELECT id FROM case_vault WHERE id = ?", (doc_id,)).fetchone()
        if not row:
            return jsonify({"error": "Document not found."}), 404

        conn.execute("DELETE FROM document_chunks WHERE document_id = ?", (doc_id,))
        conn.execute("DELETE FROM case_vault WHERE id = ?", (doc_id,))
        conn.commit()
        return jsonify({"message": "Document and vectorized index successfully deleted."}), 200
    except Exception as e:
        conn.rollback()
        print(f"[Delete Doc Error]: {e}")
        return jsonify({"error": f"Failed to delete document: {str(e)}"}), 500
    finally:
        conn.close()
