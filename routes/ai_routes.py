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

        # Draft iteration context — present when lawyer has an active draft open
        current_draft_context  = data.get("current_draft_context", "").strip()
        current_draft_title    = data.get("current_draft_title", "")
        current_draft_type     = data.get("current_draft_type", "")
        current_draft_case_id  = data.get("current_draft_case_id", "")

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

        # ── AGENTIC TOOL-ROUTING PRE-FLIGHT ──────────────────────────
        # Runs a fast LLM tool-call check BEFORE opening the SSE stream.
        # If the LLM fires a tool (virtual courtroom / contract analyzer),
        # we return a plain JSON response so the frontend can hard-navigate
        # without rendering any chat bubble text.
        # JWT validation above already ran — identity is verified.
        from utils.rag_pipeline import _needs_tool_routing_check, detect_tool_action
        has_file = query.startswith('[Attached document:')
        if _needs_tool_routing_check(query, has_file):
            action_payload = detect_tool_action(query)
            if action_payload:
                return jsonify(action_payload), 200
        # ─────────────────────────────────────────────────────────────

        from utils.rag_pipeline import stream_rag_query
        from flask import Response, stream_with_context
        
        def safe_stream_generator():
            try:
                # Attempt to stream from the pipeline
                for chunk in stream_rag_query(
                    query, user_id, case_id, document_id, scope, current_path, params,
                    current_draft_context=current_draft_context,
                    current_draft_title=current_draft_title,
                    current_draft_type=current_draft_type,
                ):
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


# ── Courtroom Simulation Engine ─────────────────────────────────
@ai_bp.route("/simulate", methods=["POST"])
@jwt_required()
def run_simulation():
    """
    Runs the 4-stage courtroom simulation pipeline.
    Called from WarRoomView after instant navigation — avoids the SSE 15-second timeout.
    """
    try:
        data = request.get_json(silent=True) or {}
        document_content = data.get("document_content", "").strip()
        document_reference = data.get("document_reference", "").strip()
        client_side = data.get("client_side", "Appellant")

        # Vault lookup: if the frontend couldn't pass file_content (LLM dropped it),
        # reconstruct the document text from stored chunks using the reference title.
        if not document_content and document_reference:
            try:
                import sqlite3
                user_id_int = int(get_jwt_identity())
                conn = sqlite3.connect('lex_assistant.db')
                c = conn.cursor()
                c.execute(
                    "SELECT id FROM documents WHERE user_id = ? AND filename LIKE ? ORDER BY created_at DESC LIMIT 1",
                    (user_id_int, f'%{document_reference}%')
                )
                doc_row = c.fetchone()
                if doc_row:
                    c.execute(
                        "SELECT chunk_text FROM document_chunks WHERE user_id = ? AND document_id = ? ORDER BY chunk_index ASC",
                        (user_id_int, doc_row[0])
                    )
                    document_content = '\n'.join(r[0] for r in c.fetchall()).strip()
                conn.close()
            except Exception as _lookup_err:
                print(f"[Simulate Vault Lookup]: {_lookup_err}")

        if not document_content:
            return jsonify({"error": "No document content provided. Attach a file or reference a vault document."}), 400

        from utils.rag_pipeline import get_groq_client
        client = get_groq_client()
        if not client:
            return jsonify({"error": "Groq client unavailable"}), 500

        truncated = document_content[:8000]

        # Stage 1: Extract legal issues + search query
        s1 = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": (
                f"Analyze this legal document:\n\n{truncated}\n\n"
                "Extract the top 3 core legal issues and a 5-word search query. "
                "Return JSON with exactly these keys: "
                "'extracted_issues' (string summarising the 3 issues) and 'search_query' (string)."
            )}],
            temperature=0.1,
            response_format={"type": "json_object"},
        )
        s1_data = json.loads(s1.choices[0].message.content)
        extracted_issues = s1_data.get("extracted_issues", "")
        search_query = s1_data.get("search_query", "")

        # Stage 2: Tavily live citations
        tavily_results = []
        tavily_key = os.environ.get("TAVILY_API_KEY")
        if tavily_key:
            try:
                import sys
                sys.path.insert(0, '.')
                from tavily import TavilyClient
                tc = TavilyClient(api_key=tavily_key)
                sr = tc.search(
                    query=f"Indian Supreme Court landmark judgments {search_query} site:indiankanoon.org",
                    search_depth="advanced",
                    max_results=3,
                )
                for r in sr.get("results", []):
                    tavily_results.append({
                        "title": r.get("title", ""),
                        "snippet": r.get("content", ""),
                        "url": r.get("url", ""),
                    })
            except Exception as te:
                print(f"[Simulate Tavily Error]: {te}")

        # Stage 3: Opening argument
        s3 = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": (
                f"Act as an Indian Advocate representing the {client_side}. "
                "Draft a structured opening argument for your case.\n"
                "Cite the provided web search cases where relevant.\n\n"
                f"Facts and Issues:\n{extracted_issues}\n\n"
                f"Live Cases Retrieved:\n{json.dumps(tavily_results, indent=2)}\n\n"
                "Provide only the drafted argument text. No markdown code blocks."
            )}],
            temperature=0.3,
        )
        opening_argument = s3.choices[0].message.content or ""

        # Stage 4: Red-team opposition
        s4 = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": (
                "Act as opposing counsel in this litigation.\n"
                f"Here is the opening argument by the {client_side}:\n\n"
                f"{opening_argument}\n\n"
                "Identify legal weaknesses and generate aggressive counter-questions. "
                "For each question provide a suggested rebuttal.\n\n"
                "Return JSON with exactly one key: 'opposing_counter_questions' — "
                "a list of objects each with 'question' and 'suggested_rebuttal'."
            )}],
            temperature=0.2,
            response_format={"type": "json_object"},
        )
        try:
            red_team = json.loads(s4.choices[0].message.content)
        except Exception:
            red_team = {"opposing_counter_questions": []}

        return jsonify({
            "simulationData": {
                "client_side": client_side,
                "extracted_issues": extracted_issues,
                "live_citations": tavily_results,
                "opening_argument": opening_argument,
                "red_team": red_team,
            }
        }), 200

    except Exception as e:
        print(f"[Simulate Error]: {e}")
        return jsonify({"error": str(e)}), 500