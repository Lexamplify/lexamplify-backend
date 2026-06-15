from flask import Flask, render_template, jsonify, request
from flask_jwt_extended import JWTManager
from dotenv import load_dotenv
from database import db as sqlalchemy_db
from datetime import timedelta
import os
import sqlite3
import json
from groq import Groq
from tavily import TavilyClient

db = sqlite3.connect('lex_assistant.db', check_same_thread=False)

def init_db():
    conn = db
    c = conn.cursor()
    c.execute('DROP TABLE IF EXISTS calendar_events')
    c.execute('''
        CREATE TABLE IF NOT EXISTS calendar_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_date TEXT,
            event_type TEXT,
            title TEXT,
            related_case_id TEXT
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS case_vault (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            case_id TEXT,
            title TEXT,
            doc_type TEXT,
            content TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS document_chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            case_id INTEGER,
            document_id INTEGER NOT NULL,
            chunk_index INTEGER NOT NULL,
            chunk_text TEXT NOT NULL,
            embedding TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    c.execute('''
        CREATE TABLE IF NOT EXISTS chat_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            user_message TEXT NOT NULL,
            bot_response TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()

load_dotenv()

jwt = JWTManager()

DB_PATH = os.path.join('instance', 'client_data.db')

def init_sqlite_db():
    os.makedirs('instance', exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS tracked_cases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        case_name TEXT NOT NULL,
        case_number TEXT,
        cnr_number TEXT,
        court TEXT,
        client_name TEXT,
        case_type TEXT,
        next_hearing DATE,
        last_hearing DATE,
        status TEXT DEFAULT 'Active',
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        cnr TEXT,
        title TEXT,
        next_hearing_date DATE
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        address TEXT,
        client_type TEXT DEFAULT 'Individual',
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        contact TEXT,
        company TEXT
    )''')
    
    # Ensure missing schema columns are dynamically appended
    for col, col_type in [("cnr", "TEXT"), ("title", "TEXT"), ("next_hearing_date", "DATE")]:
        try:
            c.execute(f"ALTER TABLE tracked_cases ADD COLUMN {col} {col_type}")
        except sqlite3.OperationalError:
            pass
            
    for col, col_type in [("contact", "TEXT"), ("company", "TEXT")]:
        try:
            c.execute(f"ALTER TABLE clients ADD COLUMN {col} {col_type}")
        except sqlite3.OperationalError:
            pass
    c.execute('''CREATE TABLE IF NOT EXISTS time_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER,
        case_id INTEGER,
        date DATE,
        hours REAL,
        rate REAL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER,
        invoice_number TEXT,
        amount REAL,
        gst REAL,
        total REAL,
        status TEXT DEFAULT 'Draft',
        due_date DATE,
        paid_date DATE,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS ip_assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ip_type TEXT,
        title TEXT,
        registration_number TEXT,
        filing_date DATE,
        renewal_due DATE,
        status TEXT DEFAULT 'Active',
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS team_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        email TEXT,
        role TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        assigned_to INTEGER,
        case_id INTEGER,
        due_date DATE,
        priority TEXT DEFAULT 'Normal',
        status TEXT DEFAULT 'todo',
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    conn.commit()
    conn.close()


def create_app():
    app = Flask(__name__)
    @app.after_request
    def add_cors_headers(response):
        origin = request.headers.get('Origin')
        if origin in ['http://localhost:5173', 'http://127.0.0.1:5173', 'https://lexamplify-4.web.app', 'https://test.lexamplify.com']:
            # Use direct assignment so we never produce duplicate CORS headers
            # (SSE responses pre-set these; .add() would append a second value)
            response.headers['Access-Control-Allow-Origin'] = origin
            response.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization,Accept'
            response.headers['Access-Control-Allow-Methods'] = 'GET,PUT,POST,DELETE,OPTIONS'
            response.headers['Access-Control-Allow-Credentials'] = 'true'
        return response

    app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', 'sqlite:///database.db')
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['JWT_SECRET_KEY'] = os.getenv('JWT_SECRET_KEY', 'secret')
    app.config['JWT_ACCESS_TOKEN_EXPIRES'] = timedelta(days=30)
    app.config['UPLOAD_FOLDER'] = os.getenv('UPLOAD_FOLDER', 'static/uploads')
    app.config['MAX_CONTENT_LENGTH'] = int(os.getenv('MAX_CONTENT_LENGTH', 16777216))
    app.config['SQLITE_DB_PATH'] = DB_PATH

    sqlalchemy_db.init_app(app)
    jwt.init_app(app)
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
    init_sqlite_db()

    @app.route('/api/ai/extract-file', methods=['POST', 'OPTIONS'])
    def extract_file_text():
        """Extract plain text from an uploaded PDF, DOCX, or TXT for the AI Legal Associate."""
        if request.method == 'OPTIONS':
            return jsonify({}), 200
        f = request.files.get('file')
        if not f or not f.filename:
            return jsonify({'error': 'No file provided'}), 400
        ext = f.filename.rsplit('.', 1)[-1].lower() if '.' in f.filename else 'txt'
        try:
            from utils.pdf_helper import extract_text_for_summary
            raw_bytes = f.read()
            text = extract_text_for_summary(raw_bytes, ext)
            if not text or not text.strip():
                text = raw_bytes.decode('utf-8', errors='ignore')
            return jsonify({'text': text[:12000], 'filename': f.filename})
        except Exception as e:
            return jsonify({'error': str(e)}), 500

    @app.route('/api/vault/save', methods=['POST', 'OPTIONS'])
    def save_vault_document():
        if request.method == 'OPTIONS':
            return jsonify({}), 200
        try:
            data = request.get_json(force=True, silent=True) or {}
            
            # Check if it is the Virtual Courtroom simulator session save format
            if 'case_facts' in data or 'history' in data:
                case_facts = data.get("case_facts", "")
                history = data.get("history", [])
                title = data.get("title", "VC Session")
                
                import uuid
                vault_path = os.path.join(os.getcwd(), "vc_vault_data.json")
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
                    
                return jsonify({"status": "success", "message": f"Session locked to VC Vault (ID: {case_id}).", "id": case_id}), 200
            
            # Case Vault save format
            case_id = data.get('case_id')
            title = data.get('title')
            doc_type = data.get('doc_type')
            content = data.get('content')

            if not case_id or not title or not content:
                return jsonify({"error": True, "message": "Missing required fields (case_id, title, content)."}), 400

            conn = db
            c = conn.cursor()
            c.execute('''
                INSERT INTO case_vault (case_id, title, doc_type, content)
                VALUES (?, ?, ?, ?)
            ''', (str(case_id), str(title), str(doc_type or ""), str(content)))
            conn.commit()
            return jsonify({"success": True, "message": "Document successfully saved."}), 200
        except Exception as e:
            return jsonify({"error": True, "message": str(e)}), 500

    @app.route('/api/vault/documents', methods=['GET'])
    def get_vault_documents():
        try:
            conn = db
            old_row_factory = conn.row_factory
            conn.row_factory = sqlite3.Row
            try:
                c = conn.cursor()
                c.execute("SELECT * FROM case_vault ORDER BY created_at DESC")
                rows = c.fetchall()
                dict_rows = [dict(row) for row in rows]
            finally:
                conn.row_factory = old_row_factory
            return jsonify({"documents": dict_rows}), 200
        except Exception as e:
            return jsonify({"error": True, "message": str(e)}), 500

    # Register blueprints
    from routes.auth_routes import auth_bp
    from routes.ai_routes import ai_bp
    from routes.document_routes import doc_bp
    from routes.contract_routes import contract_bp
    from routes.argument_routes import argument_bp
    from routes.court_routes import court_bp
    from routes.causelist_routes import causelist_bp
    from routes.client_routes import client_bp
    from routes.billing_routes import billing_bp
    from routes.conflict_routes import conflict_bp
    from routes.team_routes import team_bp

    app.register_blueprint(court_bp)
    app.register_blueprint(argument_bp)
    app.register_blueprint(causelist_bp)
    app.register_blueprint(client_bp)
    app.register_blueprint(billing_bp)
    app.register_blueprint(conflict_bp)
    app.register_blueprint(team_bp)
    app.register_blueprint(auth_bp, url_prefix='/api/auth')
    app.register_blueprint(ai_bp, url_prefix='/api/ai')
    app.register_blueprint(doc_bp, url_prefix='/api/documents')
    app.register_blueprint(contract_bp, url_prefix='/api/contract')

    # Keep-alive health check — always 200 while the server is up.
    # The client clears its interval on 401/403 from other protected endpoints.
    @app.route('/api/ping')
    def api_ping():
        return jsonify({'ok': True})

    def force_pristine_groq_messages(messages):
        clean = []
        allowed_keys = {'role', 'content', 'name', 'tool_calls', 'tool_call_id'}
        for m in messages:
            if not isinstance(m, dict):
                continue
            # Explicitly extract only safe API parameters
            sanitized_msg = {k: v for k, v in m.items() if k in allowed_keys}
            
            # Handle potential nested dictionary mutations inside tool_calls if they exist
            if 'tool_calls' in sanitized_msg and sanitized_msg['tool_calls'] is None:
                del sanitized_msg['tool_calls']
                
            clean.append(sanitized_msg)
        return clean

    @app.route('/api/chat', methods=['POST', 'OPTIONS'])
    def api_chat():
        if request.method == 'OPTIONS':
            return jsonify({}), 200
        try:
            # 1. Safe Payload Parsing with force=True to handle missing/wrong Content-Type header
            data = request.get_json(force=True, silent=True) or {}
            query = data.get('query', '').strip()
            current_path = data.get('currentPath', '/')
            params = data.get('params', {})

            # Backward compatibility fallback
            if not query:
                query = data.get('question', '').strip()

            # 2. Dynamic Payload & DoS Protection (max 1500 chars)
            if len(query) > 1500:
                return jsonify({"error": True, "message": "Query exceeds maximum limit of 1500 characters."}), 400

            if not query:
                return jsonify({"error": True, "message": "No query or question provided."}), 400

            # Securely load GROQ_API_KEY from environment
            groq_api_key = os.getenv("GROQ_API_KEY")
            if not groq_api_key:
                raise ValueError("GROQ_API_KEY environment variable is not set.")
            
            # Initialize Groq Client
            client = Groq(api_key=groq_api_key)

            # 3. Anchored System Prompt & Context Injection
            system_instruction = (
                "You are LexAI, an AI Legal Associate and junior counsel embedded inside LexAmplify — an intelligent legal practice management platform for advocates practising under Indian law.\n\n"

                "YOUR PERSONA:\n"
                "You are a highly capable junior advocate trained in Indian law: IPC, CrPC, CPC, Constitution of India, IBC, Companies Act, Negotiable Instruments Act, Transfer of Property Act, IP law (Trade Marks Act, Patents Act, Copyright Act), Consumer Protection Act, Arbitration & Conciliation Act, and procedural law across all tiers of Indian courts.\n"
                "You think and respond like a diligent junior lawyer: precise, professionally cautious, well-researched, and always deferential to the senior advocate (the user). "
                "You draft documents in correct legal English, cite relevant provisions, identify procedural requirements, flag risks, and manage deadlines — all under the advocate's supervision.\n\n"

                "DAILY TASKS YOU HANDLE (examples — not exhaustive):\n"
                "- Draft petitions, plaints, written statements, bail applications, legal notices, NDAs, MOUs, agreements, affidavits, vakalatnamas\n"
                "- Research IPC/CrPC/CPC sections, Supreme Court and High Court precedents, bare act provisions\n"
                "- Navigate to any part of LexAmplify: High Courts, District Courts, Contract Analyzer, Conflict Engine, Calendar, Case Vault, War Room\n"
                "- Schedule hearings, drop-dead deadlines, tickler reminders, and court appearances in the Legal Calendar\n"
                "- Analyze uploaded contracts for risk clauses\n"
                "- Prepare hearing briefs and arguments for courtroom simulation\n"
                "- Save drafted documents to the Case Vault for the advocate's records\n\n"

                "NAVIGATION CAPABILITY:\n"
                "You can navigate to any feature of LexAmplify. Valid routes include:\n"
                "  /dashboard, /contract-analyzer, /court-resources, /conflict-engine, /calendar, /vault, /war-room\n"
                "When navigating to /court-resources, you may also specify a tab: supreme, highcourt, district, laws, forms, events, courtfee, enotary, iptracker.\n"
                "Use the navigate tool when the user gives a navigation command.\n\n"

                "CRITICAL EXECUTION MANDATE (TOOL CALLING):\n"
                "1. Use native JSON tool calling — never output raw XML tags.\n"
                "2. Execute EXACTLY ONE tool per turn. Never chain tools.\n"
                "3. Always provide ALL required parameters. Never pass empty {} objects.\n\n"

                "WORKFLOW MANDATE (THE 3-PHASE PIPELINE):\n"
                "You orchestrate a strict state machine: Draft → Approval → Simulate.\n\n"

                "PHASE 1 — DRAFTING:\n"
                "When the advocate requests a document, invoke the document generation tool, present the draft, and STOP. Never assume approval.\n\n"

                "PHASE 2 — HUMAN-IN-THE-LOOP APPROVAL:\n"
                "You cannot save to the Case Vault yourself. Wait for the advocate to approve or reject via the UI.\n"
                "  If Rejected: acknowledge and ask for revised parameters.\n"
                "  If Approved: confirm the document is now saved in the Case Vault.\n\n"

                "PHASE 3 — SIMULATION:\n"
                "Never launch a courtroom simulation from conversational memory alone. Always retrieve the approved document from the Case Vault first via the appropriate tool.\n\n"

                "ANTI-CHAINING GUARDRAIL:\n"
                "For multi-step commands like 'Draft, save, and simulate', execute only Phase 1. "
                "Explicitly tell the advocate you are pausing for their UI approval before proceeding further."
            )

            # Define Tool Schema for Groq SDK
            tools = [
                {
                    "type": "function",
                    "function": {
                        "name": "propose_calendar_events",
                        "description": (
                            "Propose deadlines and tickler warning events (e.g. 30, 14, or 7 days prior to a critical date) "
                            "based on user scheduling requests. STRICT RULE: If you have no events to propose, do not invoke this tool."
                        ),
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "events": {
                                    "type": "array",
                                    "description": "The list of proposed events.",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "event_date": {
                                                "type": "string",
                                                "description": "The date of the event in YYYY-MM-DD format (e.g. '2026-06-01')."
                                            },
                                            "event_type": {
                                                "type": "string",
                                                "enum": ["drop_dead", "tickler", "appearance", "task"],
                                                "description": "The type of the event."
                                            },
                                            "title": {
                                                "type": "string",
                                                "description": "The title or description of the event."
                                            },
                                            "related_case_id": {
                                                "type": "string",
                                                "description": "The related case ID if applicable, or an empty string."
                                            }
                                        },
                                        "required": ["event_date", "event_type", "title", "related_case_id"]
                                    }
                                }
                            }
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "navigate_ui",
                        "description": "Navigate the user interface to a specific page or route in the application.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "target_route": {
                                    "type": "string",
                                    "description": "The target route to navigate to (e.g. '/dashboard')."
                                }
                            },
                            "required": ["target_route"]
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "propose_document_draft",
                        "description": "Propose a draft of a legal document (e.g. bail application, petition, agreement) for user review and approval.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "case_id": {
                                    "type": "string",
                                    "description": "The related case ID."
                                },
                                "title": {
                                    "type": "string",
                                    "description": "The title of the document draft."
                                },
                                "doc_type": {
                                    "type": "string",
                                    "description": "The document type (e.g. 'Bail Application', 'Contract')."
                                },
                                "content": {
                                    "type": "string",
                                    "description": "The complete text content of the drafted legal document."
                                }
                            },
                            "required": ["case_id", "title", "doc_type", "content"]
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "search_case_vault",
                        "description": "Search the Case Vault. If you know the exact Case ID, provide it in case_id. If you do not know the exact ID, provide a detailed query in search_query (e.g., \"bail application for chain snatching\"). DO NOT guess or hallucinate case_id numbers.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "case_id": {
                                    "type": ["string", "null"],
                                    "description": "The specific case identifier. If the user does not specify a case, you may pass null. If you pass null, you MUST ask the user 'Which case vault would you like me to search?'"
                                },
                                "search_query": {
                                    "type": ["string", "null"],
                                    "description": "A semantic text query to find the document by keywords if the case_id is unknown."
                                }
                            }
                        }
                    }
                },
                {
                    "type": "function",
                    "function": {
                        "name": "run_courtroom_simulation",
                        "description": "Run a 5-stage agentic courtroom simulation based on a saved document in the Case Vault.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "case_id": {
                                    "type": "string",
                                    "description": "The case ID of the document in the Case Vault."
                                },
                                "client_side": {
                                    "type": "string",
                                    "description": "The client side, e.g., 'Appellant', 'Respondent', 'Plaintiff', 'Defendant'."
                                }
                            },
                            "required": ["case_id", "client_side"]
                        }
                    }
                }
            ]

            incoming_messages = data.get('messages', [])
            
            if incoming_messages:
                clean_messages = force_pristine_groq_messages(incoming_messages)
            else:
                clean_messages = [{"role": "user", "content": f"User query: {query}"}]
                
            messages = [{"role": "system", "content": system_instruction}] + clean_messages

            # 4. The First Groq Call (Decision Phase)
            sanitized_messages = force_pristine_groq_messages(messages)
            
            response = client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=sanitized_messages,
                tools=tools,
                tool_choice="auto"
            )

            # 5. Interceptor Logic (Context Preservation)
            response_message = response.choices[0].message
            tool_calls = response_message.tool_calls

            if tool_calls:
                tool_call = tool_calls[0]
                tool_name = tool_call.function.name
                
                # Dynamic Argument Parsing Guardrail
                try:
                    args = json.loads(tool_call.function.arguments)
                    # Dynamically check required fields against our active schema
                    active_schema = next((t["function"] for t in tools if t["function"]["name"] == tool_name), None)
                    if active_schema and "parameters" in active_schema:
                        required_fields = active_schema["parameters"].get("required", [])
                        missing_fields = [f for f in required_fields if f not in args]
                        if missing_fields:
                            raise ValueError(f"Missing required parameters: {missing_fields}")
                except Exception as e:
                    # Intercept before hitting external gateways and feed error back to LLM
                    error_feedback = (
                        f"System Guardrail Alert: Your tool invocation for '{tool_name}' failed validation. "
                        f"Error: {str(e)}. "
                        "You MUST retry your function call and ensure you provide all required parameters exactly as specified in the schema."
                    )
                    
                    try:
                        assistant_msg = response_message.model_dump()
                    except AttributeError:
                        try:
                            assistant_msg = response_message.dict()
                        except AttributeError:
                            assistant_msg = {
                                "role": "assistant",
                                "content": response_message.content,
                                "tool_calls": [{"id": tool_call.id, "type": "function", "function": {"name": tool_call.function.name, "arguments": tool_call.function.arguments}}]
                            }
                    
                    messages.append(assistant_msg)
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "name": tool_name,
                        "content": error_feedback
                    })
                    
                    retry_sanitized = force_pristine_groq_messages(messages)
                    retry_response = client.chat.completions.create(
                        model="llama-3.1-8b-instant",
                        messages=retry_sanitized
                    )
                    
                    fallback_text = retry_response.choices[0].message.content or "Tool validation failed. Please try again."
                    return jsonify({
                        "action": "chat",
                        "message": fallback_text,
                        "answer": fallback_text
                    }), 200

                if tool_name == "run_courtroom_simulation":
                    case_id = args.get('case_id')
                    client_side = args.get('client_side', 'Appellant')
                    
                    conn = db
                    c = conn.cursor()
                    c.execute("SELECT content FROM case_vault WHERE case_id = ? ORDER BY created_at DESC LIMIT 1", (str(case_id),))
                    row = c.fetchone()
                    if not row or not row[0]:
                        return jsonify({"error": True, "message": f"Document with Case ID '{case_id}' not found in the Case Vault."}), 400
                        
                    content = row[0]
                    truncated_content = content[:8000]
                    
                    stage1_prompt = (
                        "Analyze the following legal document content:\n\n"
                        f"{truncated_content}\n\n"
                        "Task:\n"
                        "1. Extract the top 3 core legal issues in this case.\n"
                        "2. Summarize these issues into a single 5-word search query string.\n\n"
                        "You must respond with a JSON object. The JSON object must contain exactly these keys:\n"
                        '- "extracted_issues": "A summary string listing the top 3 core legal issues."\n'
                        '- "search_query": "A single 5-word search query string."'
                    )
                    
                    res_stage1 = client.chat.completions.create(
                        model="llama-3.3-70b-versatile",
                        messages=force_pristine_groq_messages([{"role": "user", "content": stage1_prompt}]),
                        response_format={"type": "json_object"}
                    )
                    
                    try:
                        stage1_data = json.loads(res_stage1.choices[0].message.content)
                    except Exception as e:
                        return jsonify({"error": True, "message": f"Stage 1 parsing failed: {str(e)}"}), 500
                        
                    stage1_text = stage1_data.get("extracted_issues", "")
                    search_query = stage1_data.get("search_query", "")
                    
                    tavily_results = []
                    tavily_key = os.getenv("TAVILY_API_KEY")
                    if tavily_key:
                        try:
                            tavily_client = TavilyClient(api_key=tavily_key)
                            query = f"Indian Supreme Court landmark judgments regarding {search_query} site:indiankanoon.org"
                            search_result = tavily_client.search(query=query, search_depth="advanced", max_results=3)
                            results = search_result.get("results", [])
                            for r in results:
                                tavily_results.append({
                                    "title": r.get('title', ''),
                                    "snippet": r.get('content', ''),
                                    "url": r.get('url', '')
                                })
                        except Exception as e:
                            print(f"Tavily search failed: {e}")
                            tavily_results = []
                            
                    stage3_prompt = (
                        f"Act as an Indian Advocate representing the {client_side}.\n"
                        "Draft a structured opening argument for your case.\n"
                        "You MUST cite the provided web search cases to back up your claims if they are relevant.\n\n"
                        f"Facts and Issues:\n{stage1_text}\n\n"
                        f"Live Web Search Cases Retrieved:\n{json.dumps(tavily_results, indent=2)}\n\n"
                        "Provide only the drafted opening argument text. Do not include conversational text or markdown code blocks."
                    )
                    
                    res_stage3 = client.chat.completions.create(
                        model="llama-3.3-70b-versatile",
                        messages=force_pristine_groq_messages([{"role": "user", "content": stage3_prompt}])
                    )
                    stage3_text = res_stage3.choices[0].message.content or ""
                    
                    stage4_prompt = (
                        "Act as the opposing counsel in this litigation.\n"
                        f"Here is the opening argument presented by the {client_side}:\n\n"
                        f"{stage3_text}\n\n"
                        "Identify legal weaknesses and generate aggressive counter-questions. For each question, provide a suggested rebuttal for the other side to defend themselves.\n\n"
                        "You must respond with a JSON object. The JSON object must contain exactly one key:\n"
                        '- "opposing_counter_questions": A list of objects, where each object contains exactly:\n'
                        '    - "question": "The opposing counsel\'s objection or counter-question string."\n'
                        '    - "suggested_rebuttal": "A suggested defense rebuttal string."'
                    )
                    
                    res_stage4 = client.chat.completions.create(
                        model="llama-3.3-70b-versatile",
                        messages=force_pristine_groq_messages([{"role": "user", "content": stage4_prompt}]),
                        response_format={"type": "json_object"}
                    )
                    
                    try:
                        stage4_json = json.loads(res_stage4.choices[0].message.content)
                    except Exception as e:
                        stage4_json = {"opposing_counter_questions": [{"question": "Failed to parse opponent arguments.", "suggested_rebuttal": res_stage4.choices[0].message.content}]}
                        
                    return jsonify({
                        "action": "simulate_courtroom",
                        "simulationData": {
                            "client_side": args['client_side'],
                            "extracted_issues": stage1_text,
                            "live_citations": tavily_results,
                            "opening_argument": stage3_text,
                            "red_team": stage4_json
                        },
                        "message": "Dynamic simulation complete. Transferring to the War Room..."
                    }), 200

                elif tool_name == "propose_calendar_events":
                    proposed_events = args.get('events', [])
                    return jsonify({
                        "action": "confirm_schedule",
                        "proposed_events": proposed_events,
                        "message": "I have drafted the schedule and ticklers. Please review and approve.",
                        "answer": "I have drafted the schedule and ticklers. Please review and approve."
                    }), 200

                elif tool_name == "propose_document_draft":
                    # INTERCEPT IMMEDIATELY. Do NOT write to DB.
                    return jsonify({
                        "action": "review_document",
                        "draft": args,
                        "message": "Draft ready. Please review and approve to save to the Vault.",
                        "answer": "Draft ready. Please review and approve to save to the Vault."
                    }), 200

                elif tool_name == "search_case_vault":
                    conn = db
                    old_row_factory = conn.row_factory
                    conn.row_factory = sqlite3.Row
                    try:
                        c = conn.cursor()
                        case_id = args.get("case_id")
                        search_query = args.get("search_query")
                        
                        if case_id and str(case_id).lower() != "null":
                            c.execute("SELECT * FROM case_vault WHERE case_id = ? ORDER BY created_at DESC", (str(case_id),))
                            rows = c.fetchall()
                        elif search_query:
                            c.execute("SELECT * FROM case_vault ORDER BY created_at DESC")
                            all_docs = c.fetchall()
                            stop_words = {"a", "an", "the", "and", "or", "but", "if", "for", "with", "about", "as", "by", "in", "to", "of", "on", "is", "are"}
                            keywords = [w.lower() for w in search_query.split() if w.lower() not in stop_words]
                            
                            best_doc = None
                            max_overlap = 0
                            
                            for doc in all_docs:
                                doc_text = (str(doc['title']) + " " + str(doc['content'])).lower()
                                overlap = sum(1 for kw in keywords if kw in doc_text)
                                if overlap > max_overlap:
                                    max_overlap = overlap
                                    best_doc = doc
                            
                            rows = [best_doc] if best_doc else []
                        else:
                            c.execute("SELECT * FROM case_vault ORDER BY created_at DESC")
                            rows = c.fetchall()
                    finally:
                        conn.row_factory = old_row_factory
                    
                    results = []
                    for row in rows:
                        results.append(
                            f"Document ID: {row['id']}\n"
                            f"Case ID: {row['case_id']}\n"
                            f"Title: {row['title']}\n"
                            f"Type: {row['doc_type']}\n"
                            f"Created At: {row['created_at']}\n"
                            f"Content:\n{row['content']}\n"
                            "---"
                        )
                    
                    if results:
                        formatted_vault_results = "\n".join(results)
                    else:
                        if args.get("search_query"):
                            formatted_vault_results = "No documents found matching this query in the Case Vault."
                        else:
                            formatted_vault_results = "No documents found in the Case Vault."

                    # Convert response_message to dict to be safe or use model_dump
                    try:
                        assistant_msg = response_message.model_dump()
                    except AttributeError:
                        try:
                            assistant_msg = response_message.dict()
                        except AttributeError:
                            assistant_msg = {
                                "role": "assistant",
                                "content": response_message.content,
                                "tool_calls": [
                                    {
                                        "id": tool_call.id,
                                        "type": "function",
                                        "function": {
                                            "name": tool_call.function.name,
                                            "arguments": tool_call.function.arguments
                                        }
                                    }
                                ]
                            }

                    messages.append(assistant_msg)
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call.id,
                        "name": "search_case_vault",
                        "content": formatted_vault_results
                    })

                    sanitized_second_messages = force_pristine_groq_messages(messages)

                    second_response = client.chat.completions.create(
                        model="llama-3.1-8b-instant",
                        messages=sanitized_second_messages
                    )
                    final_text = second_response.choices[0].message.content or ""
                    return jsonify({
                        "action": "chat",
                        "message": final_text,
                        "answer": final_text
                    }), 200

                elif tool_name == "navigate_ui":
                    # INTERCEPT IMMEDIATELY. Do NOT make a second Groq call.
                    target_route = args.get("target_route")
                    
                    # Titanium Route Validation
                    valid_routes = ['/dashboard', '/contract-analyzer', '/court-resources', '/conflict-engine', '/calendar', '/vault']
                    if target_route in valid_routes:
                        return jsonify({
                            "action": "navigate",
                            "target_route": target_route,
                            "message": "Navigating to requested module...",
                            "answer": "Navigating to requested module..."
                        }), 200
                    else:
                        return jsonify({
                            "action": "chat",
                            "message": "I cannot navigate to that specific module.",
                            "answer": "I cannot navigate to that specific module."
                        }), 200
                else:
                    # Graceful fallback for any other tool/hallucination
                    return jsonify({
                        "action": "chat",
                        "message": "I cannot perform that action right now.",
                        "answer": "I cannot perform that action right now."
                    }), 200
            else:
                final_text = response_message.content or ""
                # 4. Fallback: Standard chat (no tools called)
                return jsonify({
                    "action": "chat",
                    "message": final_text,
                    "answer": final_text
                }), 200

        except Exception as e:
            import traceback
            traceback.print_exc()
            return jsonify({"error": True, "message": str(e)}), 500

    @app.route('/api/calendar/save', methods=['POST'])
    def save_calendar_events():
        try:
            data = request.get_json(force=True, silent=True) or {}
            events = data.get('events', [])
            
            conn = db
            c = conn.cursor()
            for event in events:
                event_date = event.get('event_date')
                event_type = event.get('event_type')
                title = event.get('title')
                related_case_id = event.get('related_case_id')
                
                c.execute('''
                    INSERT INTO calendar_events (event_date, event_type, title, related_case_id)
                    VALUES (?, ?, ?, ?)
                ''', (event_date, event_type, title, related_case_id))
            
            conn.commit()
            return jsonify({"success": True, "message": "Events successfully saved."}), 200
        except Exception as e:
            return jsonify({"error": True, "message": str(e)}), 500

    @app.route('/api/calendar/events', methods=['GET'])
    def get_calendar_events_all():
        try:
            conn = db
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            c.execute("SELECT * FROM calendar_events ORDER BY event_date ASC")
            rows = c.fetchall()
            dict_rows = [dict(row) for row in rows]
            return jsonify({"events": dict_rows}), 200
        except Exception as e:
            return jsonify({"error": True, "message": str(e)}), 500

    @app.route('/api/districts', methods=['GET'])
    def get_districts():
        try:
            base_dir = os.path.dirname(os.path.abspath(__file__))
            primary_path = os.path.join(base_dir, 'data', 'districts.json')
            backup_path  = os.path.join(base_dir, 'data', 'districts_backup.json')
            target_file  = primary_path if os.path.exists(primary_path) else backup_path
            with open(target_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
            return jsonify(data)
        except FileNotFoundError:
            return jsonify({"error": "Database not found. Please run scraper.py first."}), 404

    # Page routes
    @app.route('/')
    def landing():
        return render_template('landing.html')

    @app.route('/login')
    def login_page():
        return render_template('login.html')

    @app.route('/signup')
    def signup_page():
        return render_template('signup.html')

    @app.route('/dashboard')
    def dashboard():
        return render_template('dashboard.html')

    @app.route('/contract-viewer')
    def contract_viewer():
        return render_template('contract_viewer.html')

    with app.app_context():
        # Explicitly import all models to ensure SQL schemas are registered in metadata
        from models.user import User
        from models.case import Case
        from models.document import Document
        sqlalchemy_db.create_all()

    # --- START DATABASE BUILDER ---
    import sqlite3
    try:
        # Connect to your exact database file
        conn = sqlite3.connect('lex_assistant.db')
        c = conn.cursor()
        
        # Build the Case Vault table
        c.execute('''
            CREATE TABLE IF NOT EXISTS case_vault (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                case_id TEXT,
                title TEXT,
                doc_type TEXT,
                content TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Build the Calendar Events table
        c.execute('''
            CREATE TABLE IF NOT EXISTS calendar_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_date TEXT,
                event_type TEXT,
                title TEXT,
                related_case_id TEXT
            )
        ''')

        # Build the Document Chunks table
        c.execute('''
            CREATE TABLE IF NOT EXISTS document_chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                case_id INTEGER,
                document_id INTEGER NOT NULL,
                chunk_index INTEGER NOT NULL,
                chunk_text TEXT NOT NULL,
                embedding TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        conn.commit()
        conn.close()
        print("Database tables verified successfully!")
    except Exception as e:
        print(f"Database setup error: {e}")
    # --- END DATABASE BUILDER ---
    return app

if __name__ == '__main__':
    init_db()
    app = create_app()
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port)
