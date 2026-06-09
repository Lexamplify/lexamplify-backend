"""
utils/rag_pipeline.py
Core Universal RAG Chatbot Pipeline for LexAmplify.
Handles semantic chunking, embedding generation, vector similarity search,
and multi-engine intent routing under strict Indian Law constraints.
"""
import re
import os
import json
import math
import hashlib
import litellm
import threading
import queue
from groq import Groq
from utils.ai_helper import ask_groq

# ── LAZY CLIENT SINGLETON PATTERN ───────────────────────────────────
_groq_client = None

def get_groq_client():
    global _groq_client
    if _groq_client is None:
        raw_key = os.environ.get("GROQ_API_KEY", "")
        clean_key = raw_key.strip().replace('"', '').replace("'", "") if raw_key else ""
        if clean_key:
            os.environ["GROQ_API_KEY"] = clean_key
            _groq_client = Groq(api_key=clean_key, timeout=45.0)
    return _groq_client

# ── 1. SEMANTIC CHUNKING LOGIC ──────────────────────────────────────────

def split_into_semantic_units(text: str) -> list[str]:
    if not text:
        return []
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    pattern = r'(?=\n(?:' \
              r'\d+\.\s+|' \
              r'\d+\)\s+|' \
              r'\(\d+\)\s+|' \
              r'[A-Z]{3,}\s+OF\s+[A-Z]{3,}\b|' \
              r'IN\s+THE\s+COURT\s+OF\b|' \
              r'VERSUS\b|' \
              r'ORDER\b|' \
              r'JUDGMENT\b|' \
              r'PRAYER\b|' \
              r'WHEREAS\b|' \
              r'DEFINITIONS\b|' \
              r'Section\s+\d+|' \
              r'Sec\.\s+\d+|' \
              r'Clause\s+\d+|' \
              r'Cl\.\s+\d+|' \
              r'Article\s+\d+' \
              r'))'
    units = re.split(pattern, text)
    return [u.strip() for u in units if u.strip()]


def chunk_document_text(text: str, target_chunk_size: int = 1000, max_chunk_size: int = 1500) -> list[str]:
    units = split_into_semantic_units(text)
    chunks = []
    current_chunk = []
    current_length = 0

    for unit in units:
        unit_len = len(unit)
        if unit_len > max_chunk_size:
            if current_chunk:
                chunks.append(" ".join(current_chunk))
                current_chunk = []
                current_length = 0
            sentences = re.split(r'(?<=[.!?])\s+', unit)
            temp_chunk = []
            temp_len = 0
            for sentence in sentences:
                sentence_len = len(sentence)
                if temp_len + sentence_len > target_chunk_size and temp_chunk:
                    chunks.append(" ".join(temp_chunk))
                    temp_chunk = [sentence]
                    temp_len = sentence_len
                else:
                    temp_chunk.append(sentence)
                    temp_len += sentence_len
            if temp_chunk:
                chunks.append(" ".join(temp_chunk))
        elif current_length + unit_len > max_chunk_size:
            if current_chunk:
                chunks.append(" ".join(current_chunk))
            current_chunk = [unit]
            current_length = unit_len
        else:
            current_chunk.append(unit)
            current_length += unit_len

        if current_length >= target_chunk_size:
            chunks.append(" ".join(current_chunk))
            current_chunk = []
            current_length = 0

    if current_chunk:
        chunks.append(" ".join(current_chunk))
    return chunks

# ── 2. EMBEDDINGS LOGIC ─────────────────────────────────────────────────

def _generate_local_fallback_embedding(text: str, dimension: int = 512) -> list[float]:
    vec = [0.0] * dimension
    words = re.findall(r'\w+', text.lower())
    if not words:
        return vec
    for word in words:
        h = int(hashlib.md5(word.encode('utf-8')).hexdigest(), 16)
        index = h % dimension
        vec[index] += 1.0
    magnitude = math.sqrt(sum(x * x for x in vec))
    if magnitude > 0:
        vec = [x / magnitude for x in vec]
    return vec


def get_embedding(text: str) -> list[float]:
    try:
        response = litellm.embedding(model="groq/nomic-embed-text-v1.5", input=[text])
        return response['data'][0]['embedding']
    except Exception:
        try:
            response = litellm.embedding(model="openai/text-embedding-3-small", input=[text])
            return response['data'][0]['embedding']
        except Exception:
            return _generate_local_fallback_embedding(text)

# ── 3. DB INGESTION LOGIC ───────────────────────────────────────────────

def ingest_document(document_id: int, case_id: int, user_id: int, text: str) -> int:
    import sqlite3
    chunks = chunk_document_text(text)
    if not chunks:
        return 0
    conn = sqlite3.connect('lex_assistant.db')
    c = conn.cursor()
    try:
        c.execute("DELETE FROM document_chunks WHERE document_id = ?", (document_id,))
        conn.commit()
    except Exception:
        pass
    try:
        for idx, chunk_text in enumerate(chunks):
            embedding_vector = get_embedding(chunk_text)
            c.execute(
                'INSERT INTO document_chunks (user_id, case_id, document_id, chunk_index, chunk_text, embedding) VALUES (?, ?, ?, ?, ?, ?)',
                (user_id, case_id, document_id, idx, chunk_text, json.dumps(embedding_vector))
            )
        conn.commit()
        return len(chunks)
    except Exception as e:
        raise e
    finally:
        conn.close()

# ── 4. SIMILARITY & METADATA FILTERING ──────────────────────────────────

def cosine_similarity(vec1: list[float], vec2: list[float]) -> float:
    if not vec1 or not vec2 or len(vec1) != len(vec2):
        return 0.0
    dot_product = sum(x * y for x, y in zip(vec1, vec2))
    norm_a = math.sqrt(sum(x * x for x in vec1))
    norm_b = math.sqrt(sum(x * x for x in vec2))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot_product / (norm_a * norm_b)


def search_chunks(query: str, user_id: int, case_id: int = None, document_id: int = None, scope: str = "all_cases", top_k: int = 5) -> list[dict]:
    import sqlite3
    sql = "SELECT id, document_id, case_id, chunk_index, chunk_text, embedding FROM document_chunks WHERE user_id = ?"
    params = [user_id]
    if scope == "current_case" and case_id is not None:
        sql += " AND case_id = ?"
        params.append(case_id)
    elif scope == "open_document":
        if document_id is not None:
            sql += " AND document_id = ?"
            params.append(document_id)
        if case_id is not None:
            sql += " AND case_id = ?"
            params.append(case_id)
    sql += " ORDER BY created_at DESC LIMIT 500"
    conn = sqlite3.connect('lex_assistant.db')
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    try:
        c.execute(sql, params)
        rows = c.fetchall()
    except Exception:
        return []
    finally:
        conn.close()
    if not rows:
        return []
    query_emb = get_embedding(query)
    scored_chunks = []
    for row in rows:
        try:
            chunk_emb = json.loads(row["embedding"])
            sim = cosine_similarity(query_emb, chunk_emb)
            scored_chunks.append({
                "chunk_id": row["id"],
                "document_id": row["document_id"],
                "case_id": row["case_id"],
                "chunk_index": row["chunk_index"],
                "text": row["chunk_text"],
                "similarity": sim
            })
        except Exception:
            continue
    scored_chunks.sort(key=lambda x: x["similarity"], reverse=True)
    return scored_chunks[:top_k]

# ── 5. JSON PARSE SHIELD ────────────────────────────────────────────────

def clean_and_parse_json(raw_text: str) -> dict:
    if not raw_text:
        return None
    cleaned = raw_text.strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        if len(lines) >= 2:
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines[-1].startswith("```"):
                lines = lines[:-1]
            cleaned = "\n".join(lines).strip()
    cleaned = cleaned.strip("`").strip()
    try:
        return json.loads(cleaned)
    except Exception:
        pass
    start_idx = cleaned.find('{')
    end_idx = cleaned.rfind('}')
    if start_idx != -1 and end_idx != -1:
        try:
            return json.loads(cleaned[start_idx:end_idx + 1])
        except Exception:
            pass
    return None

# ── 6. LEGACY NON-STREAMING ENDPOINT ───────────────────────────────────

def answer_rag_query(query: str, user_id: int, case_id: int = None, document_id: int = None, scope: str = "all_cases", current_path: str = "", params: dict = None) -> dict:
    pass

# ── 7. DUAL-ENGINE STREAMING ENDPOINT ──────────────────────────────────

def stream_rag_query(query: str, user_id: int, case_id: int = None, document_id: int = None, scope: str = "all_cases", current_path: str = "", params: dict = None):
    """
    Dual-Engine Architecture with Threaded Heartbeats to prevent Render proxy timeouts.
      - Engine 1 (llama-3.1-8b-instant): Sub-500ms intent router.
      - Engine 2 (llama-3.3-70b-versatile): Draft / simulation / RAG generation.
    """
    client = get_groq_client()
    if not client:
        yield f"data: {json.dumps({'token': '[System Error: GROQ_API_KEY is missing or invalid on server.]'})}\n\n"
        return

    # ── ENGINE 1: INTENT ROUTER ─────────────────────────────────────
    command_check_prompt = f"""User query: "{query}"
Determine if the user is giving a COMMAND or asking a QUESTION.
Commands include:
1. simulate_courtroom: "start courtroom simulation", "simulate courtroom", "virtual courtroom simulation", "war room simulation", "pull document and simulate"
2. navigate: "go to dashboard", "open court resources", "take me to vault", "view case vault"
3. review_document: "draft a bail application", "write an agreement", "create a petition"
4. confirm_schedule: "schedule a meeting", "add hearing to calendar", "set a reminder"

If simulate_courtroom, return JSON: {{"action": "simulate_courtroom", "target_route": "/war-room"}}
If navigate, return JSON: {{"action": "navigate", "target_route": "/dashboard"}} (valid routes: /dashboard, /contract-viewer, /court-resources, /conflict-engine, /vault)
If review_document, return JSON: {{"action": "review_document", "draft": {{"title": "Draft Title", "doc_type": "Legal Document", "content": "", "case_id": "{case_id or 'Unknown'}"}}}}
If confirm_schedule, return JSON: {{"action": "confirm_schedule", "proposed_events": [{{"title": "Event", "event_date": "2026-06-15", "event_type": "task", "related_case_id": "{case_id or ''}"}}]}}
If chat, return JSON: {{"action": "chat"}}

CRITICAL RESOLUTION RULE:
If the query mentions BOTH a document or vault AND a 'courtroom simulation', 'simulation', or 'war room', you MUST return 'simulate_courtroom'. Do NOT return 'navigate'.

Return ONLY valid JSON. No markdown fences, no explanation."""

    try:
        intent_res = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": command_check_prompt}],
            temperature=0.0,
            response_format={"type": "json_object"}
        )
        intent_data = clean_and_parse_json(intent_res.choices[0].message.content)

        if intent_data:
            action = intent_data.get("action", "chat")

            # ── ACTION: COURTROOM SIMULATION (Threaded Heartbeat Architecture) ──
            if action == "simulate_courtroom":
                yield f"data: {json.dumps({'token': 'Synchronizing case file context and entering Virtual Courtroom...\n'})}\n\n"

                matched_chunks = search_chunks(query, user_id, case_id, document_id, scope, top_k=4)
                context_str = (
                    "\n\n".join(f"[Document Context]:\n{c['text']}" for c in matched_chunks)
                    if matched_chunks else "No specific case vault context located. Initializing general procedural matrix."
                )

                res_queue = queue.Queue()

                def generate_simulation_data():
                    try:
                        sim_prompt = f"""You are an elite Indian litigation war room strategist.
Based on the user request and file context, generate a litigation strategy package matching the structure of an Indian court trial.

Context:
{context_str}

Request: {query}

Return a JSON object with EXACTLY these keys:
{{
    "extracted_issues": "Numbered list of core legal issues/disputes extracted from the context under statutory Indian Law frameworks.",
    "opening_argument": "A powerful, comprehensive opening argument tailored for the advocate to present before the Judge.",
    "live_citations": [
        {{
            "title": "Landmark Case Title (e.g., Supreme Court of India reference)",
            "snippet": "Short brief explaining how this precedent applies directly to the arguments.",
            "url": "https://indiankanoon.org/doc/915461/"
        }}
    ],
    "red_team": {{
        "opposing_counter_questions": [
            {{
                "question": "A heavy cross-examination question or attack expected from opposing counsel.",
                "suggested_rebuttal": "Recommended strategic legal rebuttal or statutory safe-harbour answer."
            }}
        ]
    }}
}}
Return ONLY raw JSON matching this schema."""
                        sim_res = client.chat.completions.create(
                            model="llama-3.3-70b-versatile",
                            messages=[{"role": "user", "content": sim_prompt}],
                            temperature=0.2,
                            response_format={"type": "json_object"}
                        )
                        res_queue.put(("success", sim_res.choices[0].message.content))
                    except Exception as ex:
                        res_queue.put(("error", str(ex)))

                threading.Thread(target=generate_simulation_data, daemon=True).start()

                stages = [
                    "Formulating grounded opening arguments...",
                    "Mapping Supreme Court precedents...",
                    "Anticipating opposing counsel cross-examination threats...",
                ]
                stage_idx = 0

                while True:
                    try:
                        status, payload = res_queue.get(timeout=2.0)
                        if status == "success":
                            parsed_sim = clean_and_parse_json(payload)
                            if parsed_sim:
                                parsed_sim["client_side"] = "Advocate"
                                final_payload = {
                                    "action": "simulate_courtroom",
                                    "target_route": "/war-room",
                                    "simulationData": parsed_sim,
                                }
                                yield f"data: {json.dumps(final_payload)}\n\n"
                                yield "data: [DONE]\n\n"
                                return
                        # status == "error" or parse failed — fall through to RAG chat
                        break
                    except queue.Empty:
                        current_stage = stages[stage_idx % len(stages)]
                        yield f"data: {json.dumps({'token': f'{current_stage}\n'})}\n\n"
                        stage_idx += 1
                return

            if action == "navigate":
                yield f"data: {json.dumps(intent_data)}\n\n"
                yield "data: [DONE]\n\n"
                return

            if action == "confirm_schedule":
                yield f"data: {json.dumps(intent_data)}\n\n"
                yield "data: [DONE]\n\n"
                return

            if action == "review_document":
                # ── ENGINE 2: DRAFT GENERATOR ───────────────────────
                matched_chunks = search_chunks(query, user_id, case_id, document_id, scope, top_k=6)
                context_str = (
                    "\n\n".join(f"[Source Chunk]:\n{c['text']}" for c in matched_chunks)
                    if matched_chunks else "No case document context available."
                )
                draft_prompt = (
                    "You are an elite Indian legal document drafter. "
                    "Using the case context below, draft the requested legal document in full.\n\n"
                    f"Case Context:\n{context_str}\n\n"
                    f"Request: {query}\n\n"
                    "Generate a complete, professional legal document with proper headings, "
                    "clauses, and formatting suitable for Indian courts."
                )
                draft_res = client.chat.completions.create(
                    model="llama-3.3-70b-versatile",
                    messages=[{"role": "user", "content": draft_prompt}],
                    temperature=0.3,
                )
                draft_content = draft_res.choices[0].message.content
                doc_info = intent_data.get("draft", {})
                result = {
                    "action": "review_document",
                    "draft": {
                        "title": doc_info.get("title", "Legal Document"),
                        "doc_type": doc_info.get("doc_type", "Legal Document"),
                        "content": draft_content,
                        "case_id": str(case_id or "Unknown"),
                    }
                }
                yield f"data: {json.dumps(result)}\n\n"
                yield "data: [DONE]\n\n"
                return

    except Exception as e:
        print(f"[Interceptor Error]: {e}")

    # ── ENGINE 2: NORMAL RAG STREAM (chat) ─────────────────────────
    matched_chunks = search_chunks(query, user_id, case_id, document_id, scope, top_k=4)
    system_prompt = (
        "You are an elite AI legal assistant operating strictly under Indian Law. "
        "Answer the user's query using the provided context. "
        "Format your response clearly using markdown. DO NOT output JSON."
    )
    context_str = (
        "\n\n".join(f"[Source Chunk]:\n{c['text']}" for c in matched_chunks)
        if matched_chunks else "No document context retrieved."
    )
    user_message = f"Retrieved Context:\n{context_str}\n\nUser Query: {query}"

    try:
        metadata = {
            "action": "chat",
            "sources": [{"document_id": c["document_id"]} for c in matched_chunks]
        }
        yield f"data: {json.dumps({'metadata': metadata})}\n\n"

        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
            ],
            temperature=0.2,
            stream=True,
        )

        for chunk in completion:
            if chunk.choices[0].delta.content:
                yield f"data: {json.dumps({'token': chunk.choices[0].delta.content})}\n\n"

        yield "data: [DONE]\n\n"

    except Exception as e:
        yield f"data: {json.dumps({'error': str(e)})}\n\n"
