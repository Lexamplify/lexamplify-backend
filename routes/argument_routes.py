"""
routes/argument_routes.py

Virtual Lawyer Courtroom Simulator - 5-Stage Agentic Pipeline
"""
import os
import json
import re
from flask import Blueprint, request, jsonify
from litellm import completion
from tavily import TavilyClient

# Blueprint definition
argument_bp = Blueprint("argument", __name__)

# Constraint 1: Default to Gemini 1.5 Flash via LiteLLM to remain model-agnostic
MODEL_NAME = "groq/llama-3.3-70b-versatile"

last_llm_error = "Unknown failure"

def ask_llm(prompt: str, max_tokens: int = None) -> str:
    global last_llm_error
    try:
        kwargs = {
            "model": MODEL_NAME,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.3,
            "timeout": 300,
            "num_retries": 3,
        }
        if max_tokens:
            kwargs["max_tokens"] = max_tokens
            
        response = completion(**kwargs)
        return response.choices[0].message.content
    except Exception as e:
        last_llm_error = str(e)
        print(f"LLM Error: {e}")
        return ""

def stage_4_red_teaming(facts: str, opponent_side: str) -> str:
    """
    Stage 4: Asynchronous Red Teaming (Opponent Simulation)
    Designed to run inside a ThreadPoolExecutor.
    Generates 3 counter-questions and rebuttals in JSON.
    """
    prompt = f"""Act as the opposing counsel representing the {opponent_side}.
Here are the facts and issues of the case:
{facts}

Identify 3 legal weaknesses in these facts. Generate 3 aggressive counter-questions to ask in court.
For each question, provide a suggested rebuttal for the other side to defend themselves.

CRITICAL CITATION FORMATTING RULE: Whenever you cite a case law, you MUST wrap ONLY the exact case name inside double curly braces, like this: {{{{Case Name vs. Other Name}}}}. Do NOT put connecting words like 'as held in' or 'as per' inside the braces.

CRITICAL CITATION RULE: You are strictly forbidden from inventing, hallucinating, or citing any case law outside of the approved Precedent Library below. You MUST ONLY use cases from this exact list:
1. {{{{Hindustan Construction Co. Ltd. vs. State of Orissa}}}}
2. {{{{Simplex Infrastructure Ltd. vs. Union of India}}}}
3. {{{{Indian Oil Corporation Ltd. vs. NEPC India Ltd}}}}
4. {{{{Kailash Nath Associates vs. Delhi Development Authority}}}}
5. {{{{Bharat Aluminium Co. vs. Kaiser Aluminium}}}}
6. {{{{Zee Telefilms Ltd. vs. Sundial Communications Pvt. Ltd.}}}}
7. {{{{Indian Performing Right Society Ltd. vs. Eastern Indian Motion Pictures}}}}
8. {{{{Energy Watchdog vs. Central Electricity Regulatory Commission}}}}
9. {{{{Mahanagar Telephone Nigam Ltd. vs. Canara Bank}}}}
10. {{{{Fateh Chand vs. Balkishan Dass}}}}
Do NOT cite any other cases under any circumstances. Choose the most relevant cases from this list for your arguments.

You MUST return ONLY a valid JSON object. Do not include any conversational text, markers like ```json, or preambles.
Format exactly as follows:
{{
  "opposing_counter_questions": [
    {{
      "question": "Question 1 string",
      "suggested_rebuttal": "Rebuttal 1 string"
    }}
  ]
}}
"""
    return ask_llm(prompt)


@argument_bp.route("/api/upload-case", methods=["POST"])
def upload_case():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    
    f = request.files["file"]
    fname = f.filename.lower()
    data = f.read()
    
    try:
        text = ""
        if fname.endswith(".pdf"):
            from utils.pdf_helper import extract_text_for_summary
            text = extract_text_for_summary(data, "pdf")
        elif fname.endswith(".docx"):
            from utils.pdf_helper import extract_text_for_summary
            text = extract_text_for_summary(data, "docx")
        else:
            text = data.decode("utf-8", errors="ignore")
            
        return jsonify({"text": text.strip()}), 200
    except Exception as e:
        return jsonify({"error": f"Failed to extract text: {str(e)}"}), 500


@argument_bp.route("/api/generate-arguments", methods=["POST"])
def generate_arguments():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid JSON payload"}), 400
        
    case_text = data.get("case_text", "").strip()
    client_side = data.get("client_side", "").strip()
    
    if not case_text or not client_side:
        return jsonify({"error": "Both 'case_text' and 'client_side' are required fields."}), 400

    # 3. Prompt Simplification / Safety Constraint: Truncate massive case files to prevent context exhaustion
    if len(case_text) > 4000:
        case_text = case_text[:4000] + "\n... [TRUNCATED due to character limits]"

    try:
        # Determine the logical opponent for the Red Teaming prompt
        opponent_side = "Respondent" if client_side.lower() in ["appellant", "petitioner", "plaintiff"] else "Appellant"

        # =========================================================
        # STAGE 1: Fact & Issue Extraction
        # =========================================================
        stage1_prompt = f"""You must be extremely concise. Extract the chronological facts and the top 3 core legal issues from this case file. 
Return only raw text (no JSON). Output should not exceed 150 tokens.
Case File:
{case_text}"""
        
        extracted_facts_and_issues = ask_llm(stage1_prompt, max_tokens=150)

        # Quick secondary extraction to form a clean search query for DDGS
        query_prompt = f"From this text, extract ONLY the core legal issues and summarize them into a single 5-word search query string. Text: {extracted_facts_and_issues}"
        search_query = ask_llm(query_prompt, max_tokens=20).strip().replace('"', '')

        # =========================================================
        # Sequential Execution: Stages 2, 3, and 4 run one after another
        # (avoiding ThreadPoolExecutor to prevent 429 Rate Limit spikes)
        # =========================================================
        # =========================================================
        # STAGE 2: Live Web Retrieval (Tavily AI Search)
        # =========================================================
        live_citations = []
        try:
            # Initialize TavilyClient using environment variable TAVILY_API_KEY
            tavily_key = os.getenv("TAVILY_API_KEY")
            if tavily_key:
                tavily_client = TavilyClient(api_key=tavily_key)
                
                # Targeted query for Indian legal landmarks with hardcoded Kanoon boundary
                query = f"Indian Supreme Court landmark judgments regarding {search_query} site:indiankanoon.org"
                
                # Execute Tavily search, restricting to the best 3 results for context window efficiency
                search_result = tavily_client.search(query=query, search_depth="advanced", max_results=3)
                
                # Extract the clean, token-optimized context provided by Tavily
                results = search_result.get("results", [])
                for r in results:
                    live_citations.append({
                        "title": r.get('title', ''),
                        "snippet": r.get('content', ''), # Tavily uses "content" for context snippets
                        "url": r.get('url', '')
                    })
            else:
                print("Tavily Error: TAVILY_API_KEY not found in environment.")
        except Exception as e:
            print(f"Tavily Search Error: {e}")
            # Fails gracefully so the pipeline can continue even if web access is blocked
            
        # =========================================================
        # STAGE 3: Grounded Argument Generation (Main Thread)
        # =========================================================
        citations_text = json.dumps(live_citations, indent=2)
        stage3_prompt = f"""Act as an Indian Advocate representing the {client_side}. 
Draft a structured opening argument for your case.
You MUST cite the provided web search cases to back up your claims if they are relevant.

Facts and Issues: 
{extracted_facts_and_issues}

Live Web Search Cases Retrieved: 
{citations_text}

        Provide only the drafted opening argument text. Do not include conversational text or markdown tags."""

        opening_argument = ask_llm(stage3_prompt)
        print("\n=== STAGE 3 (OPENING ARGUMENT) RAW OUTPUT ===")
        print(opening_argument)
        
        # =========================================================
        # STAGE 4: Asynchronous Red Teaming (Now Sequential)
        # =========================================================
        red_team_output = stage_4_red_teaming(extracted_facts_and_issues, opponent_side)
        print("\n=== STAGE 4 (RED TEAMING JSON) RAW OUTPUT ===")
        print(red_team_output)
        
        # 2. Empty Response Handling
        if not opening_argument or not red_team_output or opening_argument.strip() == "None" or red_team_output.strip() == "None":
            return jsonify({"error": f"The legal complexity is high. Analysis failed after 3 attempts. Log Trace: {last_llm_error}"}), 500
            
        # Parse the JSON from Stage 4
        opposing_questions = []
        try:
            # Strip markdown codeblocks sometimes added by LLMs
            cleaned_json = re.sub(r'```json\n|```', '', red_team_output).strip()
            # Failsafe parsing
            parsed_red_team = json.loads(cleaned_json)
            opposing_questions = parsed_red_team.get("opposing_counter_questions", [])
        except Exception as e:
            print(f"JSON Parsing Error in Stage 4: {e}")
            opposing_questions = [{"question": "Failed to parse opponent argument constraints.", "suggested_rebuttal": red_team_output}]

        # =========================================================
        # STAGE 5: Final Aggregation
        # =========================================================
        response_payload = {
            "client_side": client_side,
            "extracted_issues": extracted_facts_and_issues,
            "live_citations_found": live_citations,
            "opening_argument": opening_argument,
            "opposing_counter_questions": opposing_questions
        }
        
        return jsonify(response_payload), 200

    except Exception as e:
        return jsonify({"error": f"Pipeline failed: {str(e)}"}), 500


@argument_bp.route("/api/virtual-courtroom/chat", methods=["POST"])
def vc_chat():
    data = request.get_json()
    history      = data.get("history", [])
    case_facts   = data.get("case_facts", "")
    strategy_tone = data.get("strategy_tone", "Aggressive")

    if strategy_tone == "Aggressive":
        tone_directive = (
            "Adopt a hostile, counter-attacking, and dominating legal tone. "
            "Pierce the opponent's argument aggressively. Expose every logical flaw and exploit "
            "inconsistencies without mercy. Escalate the pressure with each exchange."
        )
    else:
        tone_directive = (
            "Adopt a mitigating, shielding, and de-escalating legal tone. "
            "Focus on safe harbor provisions, statutory compliance, and deflecting blame smoothly. "
            "Acknowledge partial merit where it exists to appear reasonable, while firmly "
            "minimising liability and guiding the narrative toward settlement."
        )

    prompt = f"""Act as the opposing counsel in a Virtual Indian Courtroom simulation.
Here are the extracted case facts: {case_facts}

MANDATORY TONE DIRECTIVE — {strategy_tone.upper()} MODE:
{tone_directive}

CRITICAL CITATION FORMATTING RULE: Whenever you cite a case law, you MUST wrap ONLY the exact case name inside double curly braces, like this: {{{{Case Name vs. Other Name}}}}. Do NOT put connecting words like 'as held in' or 'as per' inside the braces.

CRITICAL CITATION RULE: You are strictly forbidden from inventing, hallucinating, or citing any case law outside of the approved Precedent Library below. You MUST ONLY use cases from this exact list:
1. {{{{Hindustan Construction Co. Ltd. vs. State of Orissa}}}}
2. {{{{Simplex Infrastructure Ltd. vs. Union of India}}}}
3. {{{{Indian Oil Corporation Ltd. vs. NEPC India Ltd}}}}
4. {{{{Kailash Nath Associates vs. Delhi Development Authority}}}}
5. {{{{Bharat Aluminium Co. vs. Kaiser Aluminium}}}}
6. {{{{Zee Telefilms Ltd. vs. Sundial Communications Pvt. Ltd.}}}}
7. {{{{Indian Performing Right Society Ltd. vs. Eastern Indian Motion Pictures}}}}
8. {{{{Energy Watchdog vs. Central Electricity Regulatory Commission}}}}
9. {{{{Mahanagar Telephone Nigam Ltd. vs. Canara Bank}}}}
10. {{{{Fateh Chand vs. Balkishan Dass}}}}
Do NOT cite any other cases under any circumstances. Choose the most relevant cases from this list for your arguments.

Based on the chat history below (the user is the defending lawyer), deliver your next courtroom response strictly following the tone directive above.
Do not break character. Do not use markdown blocks. Reply purely with your courtroom dialogue.
"""
    for msg in history[-5:]:
        prompt += f"\n{msg['role'].upper()}: {msg['content']}"

    prompt += "\nOPPOSING COUNSEL:"

    try:
        reply = ask_llm(prompt)
        return jsonify({"reply": reply.strip()})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@argument_bp.route("/api/vault/save", methods=["POST"])
def save_vault():
    data = request.get_json()
    case_facts = data.get("case_facts", "")
    history = data.get("history", [])
    title = data.get("title", "VC Session")
    
    import uuid
    vault_path = os.path.join(os.getcwd(), "vc_vault_data.json")
    try:
        if os.path.exists(vault_path):
            with open(vault_path, "r", encoding="utf-8") as f:
                vault_data = json.load(f)
        else:
            vault_data = {}
            
        case_id = "VC_" + str(uuid.uuid4())[:8]
        vault_data[case_id] = {
            "title": title,
            "case_facts": case_facts,
            "history": history
        }
        
        with open(vault_path, "w", encoding="utf-8") as f:
            json.dump(vault_data, f, indent=4)
            
        return jsonify({"status": "success", "message": f"Session locked to VC Vault (ID: {case_id}).", "id": case_id})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@argument_bp.route("/api/vc/simulate", methods=["POST"])
def vc_simulate():
    """
    Fast single-stage courtroom simulation.
    Accepts: multipart/form-data with 'file' (PDF/DOCX) OR 'facts' (text), plus 'strategy'.
    Returns: JSON {argument, objections, rebuttals} — all values are HTML strings.
    """
    strategy = request.form.get("strategy", "Aggressive")
    facts = request.form.get("facts", "").strip()

    # Extract text from uploaded file when present
    if "file" in request.files and request.files["file"].filename:
        f = request.files["file"]
        fname = f.filename.lower()
        raw_bytes = f.read()
        try:
            from utils.pdf_helper import extract_text_for_summary
            if fname.endswith(".pdf"):
                facts = extract_text_for_summary(raw_bytes, "pdf")
            elif fname.endswith(".docx"):
                facts = extract_text_for_summary(raw_bytes, "docx")
            else:
                facts = raw_bytes.decode("utf-8", errors="ignore")[:2500]
        except Exception as e:
            return jsonify({"error": f"File extraction failed: {str(e)}"}), 500

    if not facts:
        return jsonify({"error": "No case facts provided. Upload a file or enter facts."}), 400

    strategy_directive = {
        "Aggressive": "Be assertive. Open with your strongest point. Cite Indian legal principles forcefully. Attack opposing weaknesses directly.",
        "Defensive":  "Focus on damage control and risk mitigation. Acknowledge concessions early. Emphasise equitable arguments.",
        "Balanced":   "Balance offensive arguments with defensive safeguards. Present a measured, judicial-tone submission.",
    }.get(strategy, "Be assertive and cite relevant Indian law.")

    prompt = f"""You are a senior Indian advocate running a {strategy} litigation strategy.

CASE FACTS:
{facts}

TASK — produce a single-stage courtroom simulation strictly in the JSON format below.
Strategy directive: {strategy_directive}

Rules:
1. "argument"  — 2-3 HTML <p> paragraphs forming a persuasive opening submission. Reference established Indian legal principles (IPC, CPC, Contract Act, etc.) where relevant. Do NOT invent case citations.
2. "objections" — an HTML <ul> with 3-4 <li> items: specific legal objections the opposing counsel is likely to raise.
3. "rebuttals"  — an HTML <ul> with 3-4 <li> items: direct rebuttals to the above objections, one per objection.

CRITICAL: Return ONLY the JSON object below. No markdown fences, no preamble, no trailing text.

{{
  "argument": "<p>...</p><p>...</p>",
  "objections": "<ul><li>...</li><li>...</li></ul>",
  "rebuttals": "<ul><li>...</li><li>...</li></ul>"
}}"""

    raw = ask_llm(prompt, max_tokens=1500)
    if not raw:
        return jsonify({"error": f"LLM returned empty response: {last_llm_error}"}), 500

    # Strip markdown fences if the model added them despite instructions
    cleaned = re.sub(r"```(?:json)?", "", raw).strip().strip("`").strip()

    try:
        result = json.loads(cleaned)
        if not all(k in result for k in ("argument", "objections", "rebuttals")):
            raise ValueError("Missing required keys in LLM JSON output")
        return jsonify(result), 200
    except (json.JSONDecodeError, ValueError):
        # Fallback: extract outermost {...} block
        match = re.search(r'\{.*\}', cleaned, re.DOTALL)
        if match:
            try:
                result = json.loads(match.group())
                if all(k in result for k in ("argument", "objections", "rebuttals")):
                    return jsonify(result), 200
            except Exception:
                pass
        return jsonify({"error": "LLM returned malformed JSON.", "raw": raw[:300]}), 500
