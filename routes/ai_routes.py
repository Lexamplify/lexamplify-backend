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
- law_sections: All Indian law sections, acts, or articles mentioned OR applicable
- document_type: Best guess at what type of Indian legal document this is
- Return ONLY the JSON object. No markdown fences. No explanation.
- Start your response with { and end with }
"""

# ── Legal Chatbot Prompt ───────────────────────────────────────
CHATBOT_PROMPT = """
You are a knowledgeable Indian legal assistant helping lawyers and citizens understand Indian law.

Rules:
- Answer in plain English — no heavy legal jargon
- Keep answers to 4-8 sentences
- Always reference the specific Indian law, IPC section, CrPC section,
  Constitutional article, or Act that applies
- Be accurate and helpful
- Always end your response with exactly this line:
  "Note: This is general legal information. Please consult a qualified lawyer for advice specific to your case."

You specialize in: IPC, CrPC, Indian Contract Act 1872, Constitution of India,
Consumer Protection Act, Labour Laws, Family Law, Property Law, Criminal Law.
"""


def safe_parse_json(raw: str) -> dict:
    """Robustly extract JSON object from Gemini response."""
    raw = re.sub(r"```json|```", "", raw).strip()
    try:
        return json.loads(raw)
    except Exception:
        pass
    start = raw.find('{')
    end = raw.rfind('}')
    if start != -1 and end != -1:
        try:
            return json.loads(raw[start:end + 1])
        except Exception:
            pass
    return None


@ai_bp.route("/summarize", methods=["POST"])
def summarize():
    text = ""

    if request.files.get("file"):
        f = request.files["file"]
        fname = f.filename.lower()
        data = f.read()
        if fname.endswith(".pdf"):
            text = extract_text_for_summary(data, "pdf")
        elif fname.endswith(".docx"):
            text = extract_text_for_summary(data, "docx")
        else:
            text = data.decode("utf-8", errors="ignore")[:2500]

    elif request.is_json:
        text = request.json.get("text", "").strip()[:2500]

    if not text:
        return jsonify({"error": "No content provided."}), 400

    try:
        # Step 1: AI summary
        raw = ask_gemini(SUMMARIZER_PROMPT, f"Document text:\n{text}")
        result = safe_parse_json(raw)

        if not result:
            result = {
                "summary": raw[:500],
                "key_points": ["Please review the document manually."],
                "law_sections": [],
                "document_type": "Unknown"
            }

        # Step 2: Find India Kanoon citations
        try:
            citations = find_citations_for_document(text, ask_gemini)
            result["citations"] = citations
        except Exception as ce:
            print(f"[Citation error]: {ce}")
            result["citations"] = []

        return jsonify(result)

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@ai_bp.route("/chat", methods=["POST"])
def chat():
    return redirect("/api/chat", code=307)


@ai_bp.route("/citations", methods=["POST"])
def get_citations():
    """Standalone endpoint to find citations for any text."""
    data = request.get_json()
    text = data.get("text", "").strip()
    if not text:
        return jsonify({"error": "No text provided."}), 400
    try:
        citations = find_citations_for_document(text, ask_gemini)
        return jsonify({"citations": citations})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@ai_bp.route("/rag-chat", methods=["POST"])
@jwt_required()
def rag_chat():
    """
    Secure, context-aware Universal RAG chatbot (Indian Law) endpoint.
    Parses current location path and parameters, and executes agentic routing.
    """
    try:
        user_id = int(get_jwt_identity())
        data = request.get_json(silent=True)
        if not data:
            return jsonify({
                "error": True,
                "message": "Agent processing failed."
            }), 500

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
        
        # Wrap the generator in a Flask Response with the event-stream mimetype
        return Response(
            stream_with_context(
                stream_rag_query(query, user_id, case_id, document_id, scope, current_path, params)
            ),
            mimetype='text/event-stream'
        )

    except Exception as e:
        print(f"[RAG API Error]: {e}")
        return jsonify({
            "error": True,
            "message": "Agent processing failed."
        }), 500