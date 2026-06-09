"""
routes/ai_routes.py
Blueprint: /api/ai
  POST /api/ai/summarize  — legal document summarizer + India Kanoon citations
  POST /api/ai/chat       — Indian legal chatbot
  POST /api/ai/citations  — find citations for any text
  POST /api/ai/rag-chat   — Secure, context-aware Universal RAG chatbot (Indian Law)
"""
import json
import re
from flask import Blueprint, request, jsonify, redirect
from flask_jwt_extended import jwt_required, get_jwt_identity
from utils.ai_helper import ask_gemini
from utils.pdf_helper import extract_text_for_summary
from utils.kanoon_helper import find_citations_for_document

ai_bp = Blueprint("ai", __name__)

# ── Document Summarizer Prompt ─────────────────────────────────
SUMMARIZER_PROMPT = """
You are an expert Indian legal document analyst.
Read the given legal document text and return a JSON object with EXACTLY these fields:

{
  "summary": "3-4 sentence plain English summary of the entire document",
  "key_points": ["point 1", "point 2", "point 3", "point 4", "point 5"],
  "law_sections": ["IPC Section X", "Indian Contract Act 1872 Section Y", "etc"],
  "document_type": "one of: FIR / Petition / Agreement / Judgment / Notice / Contract / Employment Agreement / Other"
}

Rules:
- summary: Plain English, no legal jargon, 3-4 sentences
- key_points: Exactly 5 most important points from the document
- law_sections: List relevant Indian law sections explicitly mentioned or heavily implied
- document_type: Match exactly one of the listed categories
- Do not add any extra commentary or wrap in markdown backticks. Return RAW JSON.
"""

@ai_bp.route("/summarize", methods=["POST"])
@jwt_required()
def summarize_document():
    try:
        if "file" not in request.files:
            return jsonify({"error": "No file uploaded"}), 400
            
        file = request.files["file"]
        if file.filename == "":
            return jsonify({"error": "No selected file"}), 400

        text = extract_text_for_summary(file)
        if not text or len(text.strip()) < 10:
            return jsonify({"error": "Could not extract readable text from document"}), 400

        # Call Gemini for structural JSON breakdown
        raw_response = ask_gemini(f"{SUMMARIZER_PROMPT}\n\nDocument Text:\n{text[:25000]}")
        
        # Clean potential markdown wrapping safely
        cleaned = re.sub(r"```json\s*|\s*```", "", raw_response).strip()
        analysis = json.loads(cleaned)

        # ── Find Indian Kanoon Citations Based on Key Sections ──
        citations = find_citations_for_document(text)
        analysis["citations"] = citations

        return jsonify(analysis), 200

    except Exception as e:
        print(f"[Summarizer Error]: {e}")
        return jsonify({"error": "Failed to analyze document structure."}), 500


# ── Legal Chatbot Endpoint ──────────────────────────────────────
@ai_bp.route("/chat", methods=["POST"])
@jwt_required()
def general_chat():
    try:
        data = request.get_json() or {}
        message = data.get("message", "").strip()
        
        if not message:
            return jsonify({"error": "Message is empty"}), 400

        system_prompt = (
            "You are LexAmplify, an advanced AI legal assistant specializing exclusively in Indian Law. "
            "Provide accurate, professional, cite-supported information covering the IPC, BNS, CrPC, "
            "Indian Contract Act, Constitution of India, and landmarks. Always structure response clearly."
        )
        
        response = ask_gemini(f"System: {system_prompt}\nUser: {message}")
        return jsonify({"response": response}), 200

    except Exception as e:
        print(f"[Chat Error]: {e}")
        return jsonify({"error": "Chat connection timed out."}), 500


# ── Universal RAG Chatbot with SSE Streaming ────────────────────
@ai_bp.route("/rag-chat", methods=["POST"])
@jwt_required()
def rag_chat():
    try:
        user_identity = get_jwt_identity()
        
        # 🚨 FIXED CRITICAL SECURITY HOLE: Reject bad tokens completely. No fallback to User 1!
        if not str(user_identity).isdigit():
            return jsonify({
                "error": True,
                "message": "Invalid authentication token format. Access denied."
            }), 401
            
        user_id = int(user_identity)
        
        data = request.get_json(silent=True) or {}
        query = data.get("query", "").strip()
        current_path = data.get("currentPath", "")
        params = data.get("params", {})

        if not query:
            return jsonify({
                "error": True,
                "message": "Agent processing failed."
            }), 500

        case_id = params.get("caseId")
        document_id = params.get("docId")

        try:
            if case_id is not None:
                case_id = int(case_id)
            if document_id is not None:
                document_id = int(document_id)
        except (ValueError, TypeError):
            case_id = None
            document_id = None

        scope = "all_cases"
        if document_id is not None:
            scope = "open_document"
        elif case_id is not None:
            scope = "current_case"

        from utils.rag_pipeline import stream_rag_query
        from flask import Response, stream_with_context
        
        def safe_stream_generator():
            try:
                # Attempt to stream from the pipeline
                for chunk in stream_rag_query(query, user_id, case_id, document_id, scope, current_path, params):
                    yield chunk
            except Exception as e:
                # If rag_pipeline crashes, stream the exact error into the frontend UI!
                print(f"[PIPELINE CRASH]: {e}")
                error_msg = json.dumps({'token': f"\n\n[System Error: {str(e)}]\nCheck Render logs for utils/rag_pipeline.py"})
                yield f"data: {error_msg}\n\n"

        # Wrap the safe generator in a Flask Response
        # CORS headers are set by the global add_cors_headers handler in app.py.
        # Do NOT hardcode '*' here — it conflicts with Access-Control-Allow-Credentials: true.
        allowed_origins = [
            'http://localhost:5173',
            'http://127.0.0.1:5173',
            'https://lexamplify-4.web.app',
            'https://test.lexamplify.com',
        ]
        request_origin = request.headers.get('Origin', '')
        cors_origin = request_origin if request_origin in allowed_origins else 'http://localhost:5173'

        return Response(
            stream_with_context(safe_stream_generator()),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'X-Accel-Buffering': 'no',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': cors_origin,
                'Access-Control-Allow-Credentials': 'true',
            }
        )

    except Exception as e:
        print(f"[RAG API Error]: {e}")
        return jsonify({
            "error": True,
            "message": "Agent processing failed."
        }), 500