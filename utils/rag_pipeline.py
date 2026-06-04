"""
utils/rag_pipeline.py
Core Universal RAG Chatbot Pipeline for LexAmplify.
Handles semantic chunking (legal-clause specific), embedding generation
(with LiteLLM and a determininstic feature hashing fallback), vector similarity search
on SQLite, and LLM reasoning under strict Indian Law constraints.
"""
import re
import os
import json
import math
import hashlib
import litellm
from utils.ai_helper import ask_groq

# ── 1. SEMANTIC CHUNKING LOGIC ──────────────────────────────────────────

def split_into_semantic_units(text: str) -> list[str]:
    """
    Splits the raw document text into initial semantic units based on legal headings,
    numbered sections, and paragraph breaks common to Indian legal documents.
    """
    if not text:
        return []
    
    # Normalize newlines
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    
    # Regular expressions matching common boundary points in Indian pleadings/contracts:
    # - Paragraph/Clause numbers at start of line: e.g. "1.", "12.", "1.1", "Clause 4", "Section 437"
    # - Capitalized headings: "WHEREAS", "PRAYER", "ORDER", "JUDGMENT", "FACTS", "GROUNDS", "DEFINITIONS"
    # We use lookahead assertions to split without losing or deleting the headings/sections themselves.
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
    
    # Clean up empty or whitespace-only units
    cleaned_units = []
    for unit in units:
        unit_str = unit.strip()
        if unit_str:
            cleaned_units.append(unit_str)
            
    return cleaned_units


def chunk_document_text(text: str, target_chunk_size: int = 1000, max_chunk_size: int = 1500) -> list[str]:
    """
    Assembles semantic units into balanced chunks. If a single unit is too large,
    it splits it by sentences. If units are too small, it groups them to prevent
    context loss, keeping total characters within targets.
    """
    units = split_into_semantic_units(text)
    chunks = []
    current_chunk = []
    current_length = 0
    
    for unit in units:
        unit_len = len(unit)
        
        # Case A: A single unit is extremely large, exceeding our max chunk size.
        # We must split this large unit semantically by sentences.
        if unit_len > max_chunk_size:
            # First, flush any accumulated small units
            if current_chunk:
                chunks.append(" ".join(current_chunk))
                current_chunk = []
                current_length = 0
                
            # Split this large unit by sentence boundaries (period/question/exclamation with space)
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
                
        # Case B: Adding this unit would exceed our maximum chunk size.
        # We flush the current chunk and start a new one with this unit.
        elif current_length + unit_len > max_chunk_size:
            if current_chunk:
                chunks.append(" ".join(current_chunk))
            current_chunk = [unit]
            current_length = unit_len
            
        # Case C: Accumulate the unit.
        else:
            current_chunk.append(unit)
            current_length += unit_len
            
        # If we have reached a good sizing, let's flush to keep chunks clean
        if current_length >= target_chunk_size:
            chunks.append(" ".join(current_chunk))
            current_chunk = []
            current_length = 0
            
    # Flush any remaining items
    if current_chunk:
        chunks.append(" ".join(current_chunk))
        
    return chunks

# ── 2. EMBEDDINGS LOGIC ─────────────────────────────────────────────────

def _generate_local_fallback_embedding(text: str, dimension: int = 512) -> list[float]:
    """
    Generates a deterministic hash-based term frequency vector (Feature Hashing)
    to serve as a zero-dependency, crash-proof local embedding fallback.
    """
    vec = [0.0] * dimension
    words = re.findall(r'\w+', text.lower())
    if not words:
        return vec
    for word in words:
        # Deterministic MD5 hash to index
        h = int(hashlib.md5(word.encode('utf-8')).hexdigest(), 16)
        index = h % dimension
        # Term frequency accumulation
        vec[index] += 1.0
    # Normalize to unit length
    magnitude = math.sqrt(sum(x * x for x in vec))
    if magnitude > 0:
        vec = [x / magnitude for x in vec]
    return vec


def get_embedding(text: str) -> list[float]:
    """
    Generates an embedding vector for a given text.
    Attempts groq/nomic-embed-text-v1.5, falls back to openai/text-embedding-3-small,
    and defaults to a robust local feature hashing fallback under network or credential failures.
    """
    try:
        response = litellm.embedding(
            model="groq/nomic-embed-text-v1.5",
            input=[text]
        )
        return response['data'][0]['embedding']
    except Exception as e:
        print(f"[RAG Pipeline] Groq embedding failed: {e}. Trying OpenAI fallback...")
        try:
            response = litellm.embedding(
                model="openai/text-embedding-3-small",
                input=[text]
            )
            return response['data'][0]['embedding']
        except Exception as e2:
            print(f"[RAG Pipeline] External embedding interfaces failed: {e2}. Routing to local hash vectorizer...")
            return _generate_local_fallback_embedding(text)

# ── 3. DB INGESTION LOGIC ───────────────────────────────────────────────

def ingest_document(document_id: int, case_id: int, user_id: int, text: str) -> int:
    """
    Splits document text into semantic chunks, generates embeddings,
    and stores them in SQLite. Returns count of chunks created.
    Cleans up existing chunks for the same document to prevent double indexing.
    """
    import sqlite3
    chunks = chunk_document_text(text)
    if not chunks:
        return 0
        
    conn = sqlite3.connect('lex_assistant.db')
    c = conn.cursor()
    try:
        # Avoid duplicate index entries
        c.execute("DELETE FROM document_chunks WHERE document_id = ?", (document_id,))
        conn.commit()
    except Exception as e:
        print(f"[RAG Ingestion] Error cleaning old chunks: {e}")
        
    try:
        for idx, chunk_text in enumerate(chunks):
            embedding_vector = get_embedding(chunk_text)
            embedding_json = json.dumps(embedding_vector)
            
            c.execute('''
                INSERT INTO document_chunks (user_id, case_id, document_id, chunk_index, chunk_text, embedding)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (user_id, case_id, document_id, idx, chunk_text, embedding_json))
        conn.commit()
        return len(chunks)
    except Exception as e:
        print(f"[RAG Ingestion] Direct insertion failed: {e}")
        raise e
    finally:
        conn.close()

# ── 4. SIMILARITY & METADATA FILTERING ──────────────────────────────────

def cosine_similarity(vec1: list[float], vec2: list[float]) -> float:
    """Computes cosine similarity between two float vectors."""
    if not vec1 or not vec2 or len(vec1) != len(vec2):
        return 0.0
    dot_product = sum(x * y for x, y in zip(vec1, vec2))
    norm_a = math.sqrt(sum(x * x for x in vec1))
    norm_b = math.sqrt(sum(x * x for x in vec2))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot_product / (norm_a * norm_b)


def search_chunks(query: str, user_id: int, case_id: int = None, document_id: int = None, scope: str = "all_cases", top_k: int = 5) -> list[dict]:
    """
    Search chunks based on query and dynamically adjusted metadata scope filters.
    Performs cosine similarity calculation in-memory.
    Scope options:
      - 'all_cases': filters only by user_id
      - 'current_case': filters by user_id AND case_id
      - 'open_document': filters by user_id, case_id, AND document_id
    """
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
            
    conn = sqlite3.connect('lex_assistant.db')
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    try:
        c.execute(sql, params)
        rows = c.fetchall()
    except Exception as e:
        print(f"[RAG Search] Database query failed: {e}")
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
        except Exception as e:
            continue
            
    scored_chunks.sort(key=lambda x: x["similarity"], reverse=True)
    return scored_chunks[:top_k]

# ── 5. RAG RESPONSE GENERATION ─────────────────────────────────────────

def clean_and_parse_json(raw_text: str) -> dict:
    """
    Safely strips markdown blocks and extracts a valid JSON object.
    """
    if not raw_text:
        return None
    cleaned = raw_text.strip()
    
    # Strip markdown block wraps
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        if len(lines) >= 2:
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines[-1].startswith("```"):
                lines = lines[:-1]
            cleaned = "\n".join(lines).strip()
            
    # Remove any surrounding backticks
    cleaned = cleaned.strip("`").strip()
    
    try:
        return json.loads(cleaned)
    except Exception:
        pass
        
    # Search for first '{' and last '}'
    start_idx = cleaned.find('{')
    end_idx = cleaned.rfind('}')
    if start_idx != -1 and end_idx != -1:
        try:
            return json.loads(cleaned[start_idx:end_idx + 1])
        except Exception:
            pass
            
    return None


def answer_rag_query(query: str, user_id: int, case_id: int = None, document_id: int = None, scope: str = "all_cases", current_path: str = "", params: dict = None) -> dict:
    """
    Orchestrates the retrieval of relevant context and executes the LLM reasoning loop.
    Acting as a strict JSON routing/navigation agent.
    """
    # Retrieve closest contexts
    matched_chunks = search_chunks(
        query=query,
        user_id=user_id,
        case_id=case_id,
        document_id=document_id,
        scope=scope,
        top_k=4
    )
    
    # Restrict system prompt to enforce strict agentic routing & return format
    system_prompt = (
        "You are an elite AI legal assistant operating strictly under Indian Law. "
        "Additionally, you act as a strict JSON navigation and routing agent.\n\n"
        "CRITICAL RULES:\n"
        "1. You must identify the user's current location in the app:\n"
        f"   - Current Path: {current_path or 'Not specified'}\n"
        f"   - Context Parameters: {json.dumps(params or {})}\n\n"
        "2. Strict Agentic Routing Map:\n"
        "   The list of allowed routes is: ['/dashboard', '/contract-analyzer', '/court-resources', '/conflict-engine']\n"
        "   - If the user's query implies navigation (e.g., 'go to contract analyzer', 'show me court resources', 'take me to the dashboard'), you MUST return EXACTLY this JSON structure:\n"
        "     {\n"
        "       \"action\": \"navigate\",\n"
        "       \"target_route\": \"<one_of_the_allowed_routes>\",\n"
        "       \"message\": \"Navigating...\"\n"
        "     }\n"
        "     NOTE: Choose the route that best matches the user's navigation target.\n\n"
        "3. Legal & General Queries:\n"
        "   - If the query is a legal question or a general query (not navigation), use the provided document context to answer it.\n"
        "   - If the context lacks the answer, state 'Insufficient document context'.\n"
        "   - You MUST format your response as EXACTLY this JSON structure:\n"
        "     {\n"
        "       \"action\": \"chat\",\n"
        "       \"message\": \"<your answer text here>\"\n"
        "     }\n\n"
        "4. DO NOT wrap the output in markdown code fences or backticks. Return ONLY the raw JSON string starting with { and ending with }."
    )
    
    # Formulate context payload
    if matched_chunks:
        context_blocks = []
        for c in matched_chunks:
            context_blocks.append(
                f"[Source Document ID: {c['document_id']}, Chunk Index: {c['chunk_index']}]:\n"
                f"{c['text']}"
            )
        context_str = "\n\n".join(context_blocks)
    else:
        context_str = "No document context retrieved."
        
    user_message = (
        f"Retrieved Document Context:\n"
        f"=========================\n"
        f"{context_str}\n"
        f"=========================\n\n"
        f"User Query: {query}"
    )
    
    try:
        answer_raw = ask_groq(system_prompt, user_message)
        
        # Clean and parse the response from the LLM
        parsed = clean_and_parse_json(answer_raw)
        
        if parsed:
            action = parsed.get("action", "chat")
            target_route = parsed.get("target_route")
            message = parsed.get("message", "")
            
            # Map both answer and message fields to guarantee frontend compatibility
            return {
                "action": action,
                "target_route": target_route,
                "answer": message,
                "message": message,
                "sources": [
                    {
                        "document_id": c["document_id"],
                        "case_id": c["case_id"],
                        "chunk_index": c["chunk_index"],
                        "similarity": round(c["similarity"], 4)
                    }
                    for c in matched_chunks
                ]
            }
        else:
            # Fallback if parsing failed
            return {
                "action": "chat",
                "answer": answer_raw,
                "message": answer_raw,
                "sources": []
            }
            
    except Exception as e:
        print(f"[RAG Pipeline] Inference engine error: {e}")
        return {
            "answer": "Error generating RAG response. Please check backend LLM availability.",
            "sources": []
        }
