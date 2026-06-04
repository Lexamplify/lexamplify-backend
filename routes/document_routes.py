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
from flask import Blueprint, jsonify, request, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from werkzeug.utils import secure_filename
from database import db
from models.document import Document
from utils.ai_helper import ask_groq
from utils.rag_pipeline import ingest_document

doc_bp = Blueprint("document", __name__)

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
        
    case_id_raw = request.form.get("case_id")
    case_id = int(case_id_raw) if (case_id_raw and case_id_raw.isdigit()) else None
    tags = request.form.get("tags", "")

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

        # Save metadata record to DB
        doc = Document(
            user_id=user_id,
            case_id=case_id,
            filename=f.filename,
            filetype=f.filename.lower().split('.')[-1],
            summary=summary,
            tags=tags
        )
        db.session.add(doc)
        db.session.commit()
        
        # Ingest text chunks & generate embeddings
        chunks_count = ingest_document(
            document_id=doc.id,
            case_id=case_id,
            user_id=user_id,
            text=extracted_text
        )
        
        return jsonify({
            "message": "Document uploaded and vectorized successfully.",
            "document": {
                "id": doc.id,
                "filename": doc.filename,
                "summary": doc.summary,
                "chunks_indexed": chunks_count
            }
        }), 201
        
    except Exception as e:
        db.session.rollback()
        print(f"[Upload Route Error]: {e}")
        return jsonify({"error": f"Failed to ingest document: {str(e)}"}), 500

# ── 4. DOCUMENT LIST ROUTE ──────────────────────────────────────────────

@doc_bp.route("", methods=["GET"])
@jwt_required()
def list_documents():
    """Lists metadata for all uploaded documents, optionally filtered by case_id."""
    user_id = int(get_jwt_identity())
    case_id_raw = request.args.get("case_id")
    
    query = Document.query.filter_by(user_id=user_id)
    if case_id_raw and case_id_raw.isdigit():
        query = query.filter_by(case_id=int(case_id_raw))
        
    try:
        docs = query.order_by(Document.created_at.desc()).all()
        return jsonify([{
            "id": d.id,
            "case_id": d.case_id,
            "filename": d.filename,
            "filetype": d.filetype,
            "summary": d.summary,
            "tags": d.tags,
            "created_at": d.created_at.isoformat()
        } for d in docs]), 200
    except Exception as e:
        print(f"[List Docs Error]: {e}")
        return jsonify({"error": "Failed to fetch documents."}), 500

# ── 5. DOCUMENT DETAILS ROUTE (WITH CHUNKS RECONSTRUCTION) ──────────────

@doc_bp.route("/<int:doc_id>", methods=["GET"])
@jwt_required()
def get_document_details(doc_id):
    """Fetches document metadata and reconstructs full text from its RAG chunks."""
    user_id = int(get_jwt_identity())
    
    doc = Document.query.filter_by(id=doc_id, user_id=user_id).first()
    if not doc:
        return jsonify({"error": "Document not found or access unauthorized."}), 404
        
    try:
        import sqlite3
        conn = sqlite3.connect('lex_assistant.db')
        c = conn.cursor()
        c.execute("SELECT chunk_text FROM document_chunks WHERE document_id = ? ORDER BY chunk_index ASC", (doc_id,))
        rows = c.fetchall()
        conn.close()
        
        full_text = "\n\n".join(r[0] for r in rows)
        
        return jsonify({
            "id": doc.id,
            "case_id": doc.case_id,
            "filename": doc.filename,
            "filetype": doc.filetype,
            "summary": doc.summary,
            "tags": doc.tags,
            "created_at": doc.created_at.isoformat(),
            "text": full_text
        }), 200
    except Exception as e:
        print(f"[Get Doc Details Error]: {e}")
        return jsonify({"error": f"Failed to retrieve document details: {str(e)}"}), 500

# ── 6. DOCUMENT DELETE ROUTE ───────────────────────────────────────────

@doc_bp.route("/<int:doc_id>", methods=["DELETE"])
@jwt_required()
def delete_document(doc_id):
    """Deletes the document and automatically cascade deletes all associated chunks."""
    user_id = int(get_jwt_identity())
    
    doc = Document.query.filter_by(id=doc_id, user_id=user_id).first()
    if not doc:
        return jsonify({"error": "Document not found or access unauthorized."}), 404
        
    try:
        import sqlite3
        # Cascade delete from lex_assistant.db SQLite Direct
        conn = sqlite3.connect('lex_assistant.db')
        c = conn.cursor()
        c.execute("DELETE FROM document_chunks WHERE document_id = ?", (doc_id,))
        conn.commit()
        conn.close()

        # Delete from SQLAlchemy database.db
        db.session.delete(doc)
        db.session.commit()
        return jsonify({"message": "Document and vectorized index successfully deleted."}), 200
    except Exception as e:
        db.session.rollback()
        print(f"[Delete Doc Error]: {e}")
        return jsonify({"error": f"Failed to delete document: {str(e)}"}), 500
