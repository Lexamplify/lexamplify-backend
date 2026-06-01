from flask import Flask, render_template, jsonify, request
from flask_jwt_extended import JWTManager
from dotenv import load_dotenv
from database import db as sqlalchemy_db
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
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT,
        email TEXT,
        address TEXT,
        client_type TEXT DEFAULT 'Individual',
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
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
            response.headers.add('Access-Control-Allow-Origin', origin)
            response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization,Accept')
            response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
            response.headers.add('Access-Control-Allow-Credentials', 'true')
        return response

    app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', 'sqlite:///database.db')
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    app.config['JWT_SECRET_KEY'] = os.getenv('JWT_SECRET_KEY', 'secret')
    app.config['UPLOAD_FOLDER'] = os.getenv('UPLOAD_FOLDER', 'static/uploads')
    app.config['MAX_CONTENT_LENGTH'] = int(os.getenv('MAX_CONTENT_LENGTH', 16777216))
    app.config['SQLITE_DB_PATH'] = DB_PATH

    sqlalchemy_db.init_app(app)
    jwt.init_app(app)
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
    init_sqlite_db()

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
                "You are an elite AI navigation, scheduling, document drafting and legal assistant for the LexAmplify application operating under Indian Law.\n"
                "Your role is to help users navigate the application, propose legal deadlines/schedules, draft legal documents, read or search saved legal documents, run virtual courtroom simulations, or answer general legal questions.\n"
                "You must identify the user's current location in the app:\n"
                f"   - Current Path: {current_path}\n"
                f"   - Context Parameters: {json.dumps(params)}\n\n"
                "Rules:\n"
                "1. If the user asks to navigate to a specific section (e.g. 'go to contract analyzer', 'show me court resources', 'take me to the dashboard'), you MUST use the 'navigate_ui' tool.\n"
                "2. If the user asks to schedule, add, or set deadlines/events/meetings, you MUST use the 'propose_calendar_events' tool to draft those events.\n"
                "3. If the user asks to draft, generate, write or compose a legal document (e.g. bail application, master service agreement, petition), you MUST use the 'propose_document_draft' tool.\n"
                "4. If the user asks to read, look up, find or search for saved legal documents or drafts in the vault, you MUST use the 'search_case_vault' tool.\n"
                "5. If the user asks to run a courtroom simulation (or simulate a courtroom case) based on a vault document, you MUST use the 'run_courtroom_simulation' tool.\n"
                "6. For other questions, respond with a direct text answer."
            )

            # Define Tool Schema for Groq SDK
            tools = [
                {
                    "type": "function",
                    "function": {
                        "name": "propose_calendar_events",
                        "description": (
                            "Propose deadlines and tickler warning events (e.g. 30, 14, or 7 days prior to a critical date) "
                            "based on user scheduling requests."
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
                            },
                            "required": ["events"]
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
                        "description": "Search the Case Vault database for saved legal documents or drafts.",
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "case_id": {
                                    "type": "string",
                                    "description": "Optional case ID to filter search results by."
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

            messages = [
                {"role": "system", "content": system_instruction},
                {"role": "user", "content": f"User query: {query}"}
            ]

            # 4. The First Groq Call (Decision Phase)
            response = client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=messages,
                tools=tools,
                tool_choice="auto"
            )

            # 5. Interceptor Logic (Context Preservation)
            response_message = response.choices[0].message
            tool_calls = response_message.tool_calls

            if tool_calls:
                tool_call = tool_calls[0]
                tool_name = tool_call.function.name
                
                # Argument Parsing
                args = json.loads(tool_call.function.arguments)

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
                        messages=[{"role": "user", "content": stage1_prompt}],
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
                        messages=[{"role": "user", "content": stage3_prompt}]
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
                        messages=[{"role": "user", "content": stage4_prompt}],
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
                        if case_id:
                            c.execute("SELECT * FROM case_vault WHERE case_id = ? ORDER BY created_at DESC", (str(case_id),))
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

                    second_response = client.chat.completions.create(
                        model="llama-3.1-8b-instant",
                        messages=messages
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
        from models.document_chunk import DocumentChunk
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
