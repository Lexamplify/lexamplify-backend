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
    if not raw_text or not isinstance(raw_text, str):
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

# ── 7. DRAFT EDITING HELPERS ────────────────────────────────────────────

# Verbs that signal "change the current draft" (not create a new one, not navigate)
_EDIT_VERBS = (
    'add ', 'insert ', 'append ', 'include ', 'attach ',
    'remove ', 'delete ', 'take out', 'strip ', 'drop ',
    'change ', 'update ', 'modify ', 'edit ', 'revise ', 'amend ', 'replace ',
    'rewrite ', 'rephrase ', 'simplify ', 'formalize ', 'strengthen ',
    'shorten ', 'expand ', 'condense ', 'clarify ', 'fix ', 'correct ',
    'make it ', 'make this ', 'undo ', 'revert ', 'tone down', 'redraft',
    'put in ', 'swap ', 'rename ', 'retitle ', 'restructure ', 'reorganize ',
)
# Prefixes that are always navigation, never editing
_NAV_PREFIXES = ('go to', 'open ', 'navigate to', 'take me to', 'switch to', 'show me')

def _is_edit_intent(query: str) -> bool:
    """Return True if the query reads as a request to mutate an existing draft."""
    ql = query.lower().lstrip()
    if any(ql.startswith(p) for p in _NAV_PREFIXES):
        return False
    return any(v in ql for v in _EDIT_VERBS)


# Explicit pronouns/names that refer to the open document
_DRAFT_REFS = (
    'this draft', 'the draft', 'this document', 'the document',
    'this agreement', 'the agreement', 'this contract', 'the contract',
    'this notice', 'the notice', 'this petition', 'the petition',
    'this nda', 'this mou', 'this deed', 'this clause', 'this order',
)
# Q&A verbs that implicitly target the open document when one is present
_QA_VERBS = (
    'summarize', 'summarise', 'summarization', 'give me a summary',
    'explain ', 'analyze ', 'analyse ', 'review ',
    'highlight', 'what are the', 'list the clause', 'list the term',
    'key clauses', 'key points', 'main points', 'overview of',
    'what does it say', 'what does the', 'tell me about',
)

def _is_draft_query(query: str) -> bool:
    """Return True if the query is a Q&A request referencing the active draft."""
    ql = query.lower().lstrip()
    if any(ref in ql for ref in _DRAFT_REFS):
        return True
    if any(v in ql for v in _QA_VERBS):
        return True
    return False


# Verbs that, as the very first word(s) of a query, unambiguously signal a
# request to create a brand-new document from scratch — checked as a
# deterministic pre-filter before the LLM intent router gets a vote. Added
# after live-testing surfaced a real misclassification: a detailed,
# realistically-phrased drafting request ("Draft a comprehensive mutual
# Non-Disclosure Agreement compliant with the Indian Contract Act, 1872,
# including confidentiality covenants, permitted disclosures, non-
# circumvention, and injunctive relief.") was classified as plain "chat" by
# the fast router model (llama-3.1-8b-instant) instead of "review_document"
# — so the lawyer got an unstructured wall of chat text with none of the
# streamed canvas, citation verification, or rationale that review_document
# provides, even though the query opens with exactly the same pattern the
# router's own prompt gives as a worked example ("write an NDA"). The
# router is a single zero-shot call from a small fast model with no
# few-shot examples grounding it, so it can misfire on real, detailed
# requests precisely like the ones this product exists to handle well.
# This pre-filter only ever narrows toward the correct answer for the
# unambiguous cases (a query that starts with an explicit drafting verb) —
# it never overrides an edit or draft-Q&A request, both of which are
# checked earlier and return before this is reached.
_NEW_DRAFT_VERBS = ('draft ', 'write ', 'prepare ', 'create ', 'generate ', 'draw up ', 'compose ')

_NUMBERED_PART_REF = re.compile(r'\b(?:clause|para(?:graph)?)\s+\d+')

def _is_new_draft_request(query: str) -> bool:
    """Return True if the query unambiguously asks to create a brand-new
    document from scratch: it opens with a drafting verb AND doesn't point
    back at an existing document ("this draft", "clause 5", "a summary of
    the agreement") — those are edits or questions, not new drafts."""
    ql = query.lower().lstrip()
    if any(ql.startswith(p) for p in _NAV_PREFIXES):
        return False
    if not any(ql.startswith(v) for v in _NEW_DRAFT_VERBS):
        return False
    if any(ref in ql for ref in _DRAFT_REFS) or 'summar' in ql or _NUMBERED_PART_REF.search(ql):
        return False
    return True


def _generate_suggested_actions(client, query: str, response_snippet: str, draft_context: str = "") -> list:
    """Use the fast model to generate 3 context-aware next-step action pills."""
    snippet = response_snippet[:1500] if response_snippet else ""
    draft_hint = (
        f"\nActive draft context (opening): {draft_context[:400]}"
        if draft_context else ""
    )
    prompt = (
        "You are a legal workflow assistant embedded in an Indian legal SaaS platform. "
        "Based on the lawyer's query and the AI response below, suggest exactly 3 "
        "highly specific, actionable next steps they should take inside this workspace.\n\n"
        f"Lawyer's query: {query}\n"
        f"AI Response snippet: {snippet}{draft_hint}\n\n"
        "Rules:\n"
        "1. Each action must be specific to the query/response context — not generic.\n"
        "2. Prefer actions like: editing the draft, analysing clauses, researching law, filing steps.\n"
        "3. Respond ONLY with a JSON array of exactly 3 objects. No preamble, no markdown fences.\n"
        'Each object: {"emoji": "<single emoji>", "label": "<2-5 word label>", "query": "<exact query text>"}'
    )
    try:
        resp = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.4,
            max_tokens=280,
        )
        raw = resp.choices[0].message.content.strip()
        actions = clean_and_parse_json(raw)
        if isinstance(actions, list) and len(actions) >= 1:
            return actions[:3]
    except Exception as e:
        print(f"[suggested_actions]: {e}")
    return [
        {"emoji": "📋", "label": "Summarize Draft",        "query": "Summarize this draft"},
        {"emoji": "✨", "label": "Add Arbitration Clause",  "query": "Add an arbitration clause to this draft"},
        {"emoji": "🔍", "label": "Analyse Risk Clauses",   "query": "Analyse the high risk clauses in this draft"},
    ]


# ── ANTI-HALLUCINATION: FACT FIDELITY + CITATION VERIFICATION ──────────
#
# Two independent defenses, matching what actually distinguishes trusted
# assistants from ones that "sound right but invent things":
#
#   1. A drafting system prompt that forbids re-abstracting facts the
#      lawyer actually supplied, and forbids inventing case law or
#      statute numbers the model isn't sure about.
#   2. A post-generation citation check: every "Section X of the Y Act"
#      the draft cites gets a real Tavily web search against India's
#      official law portal / Indian Kanoon. Only citations a search
#      actually confirms are shown as verified — anything unconfirmed is
#      labelled as such rather than silently dropped or falsely badged.
#
# No paid legal-citator API is available (Groq free tier + Tavily only,
# per the lawyer running this), so this is the honest version of citation
# grounding that's actually buildable on that budget — real search
# results, not a decorative checkmark.

FACT_FIDELITY_RULES = (
    "FACT FIDELITY — MANDATORY:\n"
    "1. If the instructions or context state a specific, concrete fact — a party's actual name, "
    "an address, an amount, a date, a percentage, a city, a defined term, a case number — use that "
    "EXACT fact verbatim wherever it belongs. Do not re-abstract a fact you were actually given back "
    "into a bracket just to look uniform.\n"
    "2. Only for facts genuinely NOT supplied anywhere, use a bracketed placeholder "
    "(e.g. [Client/Company Legal Name], [Amount], [Number] days, [City, State]), exactly as a "
    "fillable template leaves them for the parties to complete.\n"
    "3. NEVER invent or guess a fact, case citation, or statute section number that was not supplied "
    "and that you are not highly confident is real. A bracket beats a fabricated fact. If you are "
    "not confident a section number is correct, say so in plain words rather than stating it as fact.\n"
    "4. Cite only statutes/sections you are confident actually exist and say what you say they say. "
    "Do not manufacture a plausible-sounding case name or citation to fill a gap.\n"
)


# Anchors for the specific provisions this product's drafts and answers
# lean on most — added because the recorded LexAmplify session showed
# concrete, checkable slips on exactly these (the DPDP Act 2023 described
# as a "Bill ... once enacted", and Section 64 of the Contract Act cited for
# penalty clauses where Section 74 is the operative provision). A short list
# of known-correct anchors is far more reliable than a general "don't
# hallucinate" instruction, and the closing rule tells the model what to do
# for anything NOT on the list instead of guessing a number.
LEGAL_ACCURACY_ANCHORS = (
    "CURRENT-LAW ANCHORS (use these exactly; they override anything you remember differently):\n"
    "- From 1 July 2024 the Bharatiya Nyaya Sanhita, 2023 (BNS), Bharatiya Nagarik Suraksha Sanhita, 2023 "
    "(BNSS) and Bharatiya Sakshya Adhiniyam, 2023 (BSA) replaced the IPC, CrPC and Indian Evidence Act. "
    "Cite the BNS/BNSS/BSA provision, adding the old IPC/CrPC section in brackets where it helps. "
    "Bail: s.480 BNSS (earlier s.437 CrPC), s.483 BNSS (earlier s.439 CrPC); anticipatory bail s.482 BNSS "
    "(earlier s.438 CrPC). Cheating: s.318 BNS (earlier s.420 IPC).\n"
    "- The Digital Personal Data Protection Act, 2023 is an enacted Act — never call it a Bill.\n"
    "- Indian Contract Act, 1872: s.10 (valid contracts), s.23 (lawful consideration and object), s.27 "
    "(agreements in restraint of trade are void, save the sale-of-goodwill exception), s.28 (agreements "
    "restraining legal proceedings), s.73 (compensation for breach), s.74 (named sum / penalty — this, not "
    "s.64, governs liquidated damages).\n"
    "- Specific Relief Act, 1963: injunctions are ss.36–42 (s.38 perpetual, s.41 bars, s.42 negative "
    "covenants); interim injunctions are under Order XXXIX CPC.\n"
    "- Arbitration and Conciliation Act, 1996: s.7 arbitration agreement, s.9 interim measures by court, "
    "s.11 appointment of arbitrators, s.29A time limit for award.\n"
    "- Commercial Courts Act, 2015: s.12A pre-institution mediation (dispensed with only where urgent "
    "interim relief is contemplated).\n"
    "- Negotiable Instruments Act, 1881, s.138: demand notice within 30 days of receiving the bank's "
    "dishonour memo; drawer has 15 days from receipt of notice to pay.\n"
    "- Stamp duty: Indian Stamp Act, 1899 as modified by each State's stamp law — never state a duty amount.\n"
    "- For ANY provision not listed here whose number you are not certain of, state the legal rule "
    "without a section number, or write the number followed by [verify] — never present a guess as fact.\n"
)

# How output must be formatted so the frontend's renderer shows it cleanly
# — the recorded session showed literal "<br>" and ">" characters and
# emoji section headings leaking into answers.
OUTPUT_FORMAT_RULES = (
    "FORMATTING: Use plain Markdown only — '#'/'##'/'###' headings, numbered clauses (1., 1.1), "
    "'**bold**' for defined terms, '-' bullets, and pipe tables only for genuinely tabular content "
    "(comparisons, signature blocks). Never emit raw HTML tags such as <br>; put separate points on "
    "separate lines instead. Never prefix clause text with '>'. No emoji in headings.\n"
)


# Matches "Section 27 of the Indian Contract Act, 1872", "Section 138 of the Negotiable Instruments Act",
# "Article 14 of the Constitution", "Sections 73 and 74 of the Contract Act", etc.
_CITATION_PATTERN = re.compile(
    r'(?:Section|Sections|Sec\.?|Article|Articles|Order\s+[IVXLCDM]+(?:\s+Rule\s+\d+)?)\s+'
    r'[\d]+[A-Za-z]?(?:\s*(?:,|and|to)\s*\d+[A-Za-z]?)*'
    r'\s+(?:of\s+the\s+)?([A-Z][A-Za-z,\s]{3,60}?\b(?:Act|Code|Constitution)\b(?:,?\s*\d{4})?)',
    re.IGNORECASE,
)


def extract_statute_citations(text: str, max_citations: int = 4) -> list:
    """Pull unique 'Section X of the Y Act' style citations out of drafted
    text, in first-seen order, capped for API-call budget."""
    if not text:
        return []
    seen = set()
    out = []
    for m in _CITATION_PATTERN.finditer(text):
        full = m.group(0).strip().rstrip('.,;:')
        key = full.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(full)
        if len(out) >= max_citations:
            break
    return out


_TRUSTED_LAW_DOMAINS = ("indiacode.nic.in", "indiankanoon.org")


def verify_citations_with_tavily(citations: list) -> list:
    """
    Real verification, not theater: for each citation string, run an actual
    Tavily search scoped to India's official law portal / Indian Kanoon and
    only report back citations a search genuinely confirmed. A citation
    Tavily can't find a matching source for is returned with verified=False
    and no url — never a fabricated link.

    Reuses the exact TavilyClient pattern already live in
    routes/ai_routes.py's /simulate endpoint (site:indiankanoon.org search),
    the one external verification mechanism this deployment actually has.
    """
    if not citations:
        return []
    tavily_key = os.environ.get("TAVILY_API_KEY")
    if not tavily_key:
        # No verification possible — every citation is honestly unverified,
        # never silently marked as confirmed.
        return [{"citation": c, "verified": False, "url": "", "title": ""} for c in citations]

    results = []
    try:
        from tavily import TavilyClient
        tc = TavilyClient(api_key=tavily_key)
    except Exception as e:
        print(f"[Tavily init error]: {e}")
        return [{"citation": c, "verified": False, "url": "", "title": ""} for c in citations]

    for citation in citations:
        try:
            # include_domains is Tavily's real domain filter; a "site:a OR
            # site:b" string inside the query is not guaranteed to be honoured,
            # which could let an unrelated blog result count as "found". The
            # domain check below double-guards that, so a hit only counts when
            # it genuinely comes from one of the two primary-law sources.
            sr = tc.search(
                query=citation,
                search_depth="basic",
                max_results=3,
                include_domains=list(_TRUSTED_LAW_DOMAINS),
            )
            hits = sr.get("results", []) if isinstance(sr, dict) else []
            hits = [h for h in hits if any(d in (h.get("url") or "") for d in _TRUSTED_LAW_DOMAINS)]
            if hits:
                top = hits[0]
                results.append({
                    "citation": citation,
                    "verified": True,
                    "url": top.get("url", ""),
                    "title": top.get("title", citation),
                })
            else:
                results.append({"citation": citation, "verified": False, "url": "", "title": ""})
        except Exception as e:
            print(f"[Tavily citation check error for '{citation}']: {e}")
            results.append({"citation": citation, "verified": False, "url": "", "title": ""})
    return results


_RATIONALE_DELIMITER = "===DRAFTING_RATIONALE==="


def split_rationale(raw_content: str) -> tuple:
    """Split a model response into (document_content, rationale_text) using
    the ===DRAFTING_RATIONALE=== delimiter the drafting prompt asks the
    model to emit after the document. If the model didn't include one,
    rationale_text is empty and the full text is treated as the document —
    never invented after the fact."""
    if not raw_content or _RATIONALE_DELIMITER not in raw_content:
        return (raw_content or "").strip(), ""
    doc_part, _, rationale_part = raw_content.partition(_RATIONALE_DELIMITER)
    return doc_part.strip(), rationale_part.strip().lstrip(':').strip()


# ── 9. AGENTIC TOOL ROUTING  ────────────────────────────────────────────
#
#  Two tools let the LLM hard-route the user to a specialised workspace
#  instead of answering in chat.  The check is a single fast-model call
#  with tool_choice="auto".  It fires only when keyword pre-screening
#  suggests a routing intent, so normal chat has zero added latency.

_TOOL_DEFS = [
    {
        "type": "function",
        "function": {
            "name": "trigger_virtual_courtroom",
            "description": (
                "Route the user to the Virtual Courtroom / War Room workspace when they "
                "want to simulate a courtroom trial, practice litigation arguments, run a "
                "war-room session, or stress-test a case strategy. "
                "IMPORTANT: DO NOT simulate the courtroom, draft arguments, or analyze "
                "the case yourself. Your ONLY job is to identify the routing intent and "
                "populate document_reference with the raw document title or topic. "
                "The dedicated simulation engine will handle all legal analysis."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "document_reference": {
                        "type": "string",
                        "description": (
                            "The EXACT title or keyword of the document the user mentioned "
                            "(e.g. 'divorce', 'FIR', 'NDA'). Extract it verbatim from the "
                            "user query. You MUST always populate this field."
                        ),
                    }
                },
                "required": ["document_reference"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "trigger_contract_analyzer",
            "description": (
                "Route the user to the Contract Analyzer when they upload a document and "
                "ask to analyze it for risks, extract clauses, check compliance, perform "
                "a due-diligence review, or scan for red-flag provisions."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "document_reference": {
                        "type": "string",
                        "description": "Name or description of the uploaded document.",
                    },
                    "file_content": {
                        "type": "string",
                        "description": "First 200 characters of the file content if available.",
                    },
                },
                "required": [],
            },
        },
    },
]

_TOOL_DESTINATION = {
    "trigger_virtual_courtroom": "/war-room",
    "trigger_contract_analyzer": "/analyzer",
}

# Keywords that justify spending one extra LLM call on the tool-routing check.
_ROUTING_SIMULATION_WORDS = (
    'simulate', 'simulation', 'courtroom', 'war room', 'war-room',
    'litigation practice', 'argue the case', 'moot',
)
_ROUTING_ANALYSIS_WORDS = (
    'analyze contract', 'analyse contract', 'contract analysis', 'contract review',
    'risk analysis', 'risk scan', 'clause risk', 'compliance check',
    'due diligence', 'red flag', 'flag clause', 'analyze this', 'analyse this',
    'review this document', 'scan this',
)


def _needs_tool_routing_check(query: str, has_file: bool) -> bool:
    """Fast keyword pre-screen before paying for the tool-call LLM round-trip."""
    ql = query.lower()
    if any(kw in ql for kw in _ROUTING_SIMULATION_WORDS):
        return True
    if has_file and any(kw in ql for kw in _ROUTING_ANALYSIS_WORDS):
        return True
    return False


def detect_tool_action(query: str) -> dict | None:
    """
    Calls llama-3.1-8b-instant with tool definitions.
    Returns a routing payload dict if the LLM fires a tool call, else None.
    This function is called from ai_routes.py BEFORE the SSE stream is opened,
    so it can return a plain JSON response (Content-Type: application/json)
    rather than an SSE stream, enabling the frontend dual-mode handler.
    """
    client = get_groq_client()
    if not client:
        return None
    try:
        resp = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": query[:2000]}],
            tools=_TOOL_DEFS,
            tool_choice="auto",
            temperature=0.0,
            max_tokens=120,
        )
        msg = resp.choices[0].message
        if not msg.tool_calls:
            return None
        call        = msg.tool_calls[0]
        fn_name     = call.function.name
        destination = _TOOL_DESTINATION.get(fn_name)
        if not destination:
            return None
        try:
            args = json.loads(call.function.arguments or '{}')
        except Exception:
            args = {}

        # Extract file content from the query string (frontend embeds it as
        # "[Attached document: name]\n\ncontent\n\n---\n\nUser query: ...").
        file_content = ""
        if '\n\n---\n\nUser query:' in query:
            file_content = query.split('\n\n---\n\nUser query:')[0]
            # Strip the "[Attached document: ...]\n\n" header line
            if file_content.startswith('[Attached document:'):
                file_content = '\n'.join(file_content.split('\n')[2:])

        return {
            "is_action":   True,
            "intent":      "ROUTE",
            "destination": destination,
            "data": {
                "tool":               fn_name,
                "document_reference": args.get("document_reference", ""),
                "file_content":       file_content[:8000],
            },
        }
    except Exception as e:
        print(f"[detect_tool_action]: {e}")
        return None


# ── 8. DUAL-ENGINE STREAMING ENDPOINT ──────────────────────────────────

def stream_rag_query(query: str, user_id: int, case_id: int = None, document_id: int = None,
                     scope: str = "all_cases", current_path: str = "", params: dict = None,
                     current_draft_context: str = "", current_draft_title: str = "",
                     current_draft_type: str = ""):
    """
    Dual-Engine Architecture with Threaded Heartbeats to prevent Render proxy timeouts.
      - Engine 1 (llama-3.1-8b-instant): Sub-500ms intent router.
      - Engine 2 (openai/gpt-oss-120b): Draft / simulation / RAG generation.
    """
    client = get_groq_client()
    if not client:
        yield f"data: {json.dumps({'token': '[System Error: GROQ_API_KEY is missing or invalid on server.]'})}\n\n"
        return

    params = params or {}
    # A clear "draft/write/prepare a <document>" request always means a NEW
    # document, even when another draft is open in the session — otherwise
    # "Draft a bail application, add grounds of parity" with an NDA open
    # would be caught by the edit intercept below (it contains "add ") and
    # silently rewrite the NDA instead.
    new_draft_request = _is_new_draft_request(query)

    # Selection-scoped edit — the ChatGPT-style "select text → Ask for
    # changes" flow. The frontend sends the exact passage the lawyer
    # highlighted; we change only that passage and return the full document.
    selection = params.get("selection_edit") if isinstance(params, dict) else None
    selection = selection.strip()[:4000] if isinstance(selection, str) else ""

    # ── DRAFT EDITING INTERCEPT (runs BEFORE the intent router) ────────────
    # When the lawyer has an active draft AND gives an editing command, we skip
    # the intent router entirely — it cannot hallucinate navigation or simulation.
    if current_draft_context and (selection or (_is_edit_intent(query) and not new_draft_request)):
        if selection:
            scope_rules = (
                f"THE LAWYER SELECTED THIS EXACT PASSAGE:\n\"\"\"\n{selection}\n\"\"\"\n\n"
                f"LAWYER'S INSTRUCTION FOR THAT PASSAGE: {query}\n\n"
                "SCOPE RULE — CRITICAL: change ONLY the selected passage (and, if the instruction strictly "
                "requires it, the minimum consequential wording elsewhere, e.g. a defined term used later). "
                "Every other character of the document must be reproduced exactly as it is.\n"
            )
        else:
            scope_rules = f"LAWYER'S INSTRUCTION: {query}\n"
        edit_prompt = (
            f"You are a senior Indian legal drafting counsel. "
            f"The lawyer wants you to revise their active draft.\n\n"
            f"CURRENT DRAFT — \"{current_draft_title or 'Legal Document'}\":\n"
            f"---\n{current_draft_context[:10000]}\n---\n\n"
            f"{scope_rules}\n"
            "DRAFTING RULES:\n"
            "1. Apply the instruction precisely and correctly under Indian Law.\n"
            "2. Return the COMPLETE updated document — not just the changed section.\n"
            "3. Preserve all existing headings, numbering, party names, and clause structure.\n"
            "4. Insert new clauses in the most logically appropriate position.\n"
            "5. Use proper legal English suitable for Indian courts and arbitral tribunals.\n"
            "6. Output ONLY the revised document text — no preamble, no explanation, no markdown code fences.\n\n"
            f"{FACT_FIDELITY_RULES}\n{LEGAL_ACCURACY_ANCHORS}\n{OUTPUT_FORMAT_RULES}"
        )
        try:
            edit_res = client.chat.completions.create(
                model="openai/gpt-oss-120b",
                messages=[{"role": "user", "content": edit_prompt}],
                temperature=0.2,
            )
            updated_content = edit_res.choices[0].message.content or ""
            # Models occasionally wrap the whole document in a ``` fence
            # despite rule 6 — strip it so the canvas never shows the fence.
            updated_content = re.sub(r'^\s*```[a-zA-Z]*\s*\n', '', updated_content)
            updated_content = re.sub(r'\n\s*```\s*$', '', updated_content).strip()
            if not updated_content:
                raise ValueError("empty revision")
            _edit_payload = json.dumps({
                'action': 'update_document',
                'updated_content': updated_content,
                'title': current_draft_title,
                'change_summary': query[:120],
                'selection': selection[:160] if selection else '',
            })
            yield f"data: {_edit_payload}\n\n"
        except Exception as e:
            print(f"[Draft edit error]: {e}")
            _err_payload = json.dumps({'token': "I couldn't apply that change — the drafting model didn't return a revision. Your draft is unchanged; please try again."})
            yield f"data: {_err_payload}\n\n"
        yield "data: [DONE]\n\n"
        return

    # ── DRAFT Q&A INTERCEPT (runs BEFORE the intent router) ────────────────
    # When the lawyer asks a question about or requests a summary of the active
    # draft, answer strictly from the injected draft text — not from the RAG
    # index or general knowledge.
    if current_draft_context and not new_draft_request and _is_draft_query(query) and not _is_edit_intent(query):
        qa_prompt = (
            f"You are a senior Indian legal counsel reviewing an active draft document.\n\n"
            f"ACTIVE DRAFT — \"{current_draft_title or 'Legal Document'}\":\n"
            f"---\n{current_draft_context[:10000]}\n---\n\n"
            f"LAWYER'S QUERY: {query}\n\n"
            "INSTRUCTIONS:\n"
            "1. Answer STRICTLY from the draft text above — do not fabricate clauses.\n"
            "2. Cite specific clause numbers or headings from the draft where relevant.\n"
            "3. Be precise. Format clearly with headings or bullet points as appropriate.\n"
            "4. If asked for a summary, produce a structured executive summary covering: "
            "parties, purpose, key obligations, confidentiality scope, term, and termination.\n\n"
            f"{LEGAL_ACCURACY_ANCHORS}\n{OUTPUT_FORMAT_RULES}"
        )
        try:
            yield f"data: {json.dumps({'metadata': {'action': 'chat', 'sources': []}})}\n\n"
            qa_completion = client.chat.completions.create(
                model="openai/gpt-oss-120b",
                messages=[{"role": "user", "content": qa_prompt}],
                temperature=0.1,
                stream=True,
            )
            full_qa_text = ''
            for chunk in qa_completion:
                delta = chunk.choices[0].delta.content
                if delta:
                    full_qa_text += delta
                    yield f"data: {json.dumps({'token': delta})}\n\n"
            actions = _generate_suggested_actions(client, query, full_qa_text, current_draft_context)
            yield f"data: {json.dumps({'suggested_actions': actions})}\n\n"
        except Exception as e:
            _qa_err = json.dumps({'token': '[Query error: ' + str(e) + ']'})
            yield f"data: {_qa_err}\n\n"
        yield "data: [DONE]\n\n"
        return

    # ── ENGINE 1: INTENT ROUTER ─────────────────────────────────────
    command_check_prompt = f"""User query: "{query}"

Classify this into exactly one action. Return ONLY valid JSON — no markdown, no explanation.

STRICT RULES — read carefully before classifying:
- "simulate_courtroom": ONLY when the user EXPLICITLY says "simulate courtroom", "start war room simulation", "virtual courtroom", or "run simulation". NEVER trigger for drafting, editing, or clause requests.
- "navigate": ONLY when the user EXPLICITLY says "go to [page]", "open [page]", "navigate to [page]", or "take me to [page]".
- "review_document": When the user wants to CREATE a brand-new legal document from scratch ("draft a bail application", "write an NDA", "prepare a petition").
- "confirm_schedule": When the user wants to add calendar entries, hearings, or reminders.
- "chat": For ALL questions, research, legal analysis, explanations, and anything not matching the above.

JSON formats:
- navigate:           {{"action": "navigate", "target_route": "/route"}}  (valid: /dashboard, /court-resources, /conflict-engine, /vault, /war-room)
- simulate_courtroom: {{"action": "simulate_courtroom", "target_route": "/war-room"}}
- review_document:    {{"action": "review_document", "draft": {{"title": "Title", "doc_type": "Type", "content": "", "case_id": "{case_id or 'Unknown'}"}}}}
- confirm_schedule:   {{"action": "confirm_schedule", "proposed_events": [{{"title": "...", "event_date": "YYYY-MM-DD", "event_type": "task", "related_case_id": "{case_id or ''}"}}]}}
- chat:               {{"action": "chat"}}"""

    try:
        if new_draft_request:
            # Deterministic fast-path — see _is_new_draft_request's comment.
            # Skips the router call entirely for the unambiguous cases, which
            # also saves a full model round-trip on the most common request
            # this product handles.
            intent_data = {
                "action": "review_document",
                "draft": {
                    "title": "New Legal Document",
                    "doc_type": "Legal Draft",
                    "content": "",
                    "case_id": str(case_id) if case_id else "Unknown",
                },
            }
        else:
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
                _init_msg = json.dumps({'token': 'Synchronizing case file context and entering Virtual Courtroom...\n'})
                yield f"data: {_init_msg}\n\n"

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
                            model="openai/gpt-oss-120b",
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
                        _stage_msg = json.dumps({'token': current_stage + '\n'})
                        yield f"data: {_stage_msg}\n\n"
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
                # ── ENGINE 2: DRAFT GENERATOR — streamed live into the canvas ──
                matched_chunks = search_chunks(query, user_id, case_id, document_id, scope, top_k=6)
                context_str = (
                    "\n\n".join(f"[Source Chunk]:\n{c['text']}" for c in matched_chunks)
                    if matched_chunks else "No case document context available."
                )
                doc_info = intent_data.get("draft", {})
                draft_prompt = (
                    "You are an elite Indian legal document drafter. "
                    "Using the case context below, draft the requested legal document in full.\n\n"
                    f"Case Context:\n{context_str}\n\n"
                    f"Request: {query}\n\n"
                    "Generate a complete, professional legal document with proper headings, "
                    "clauses, and formatting suitable for Indian courts. Start directly with the "
                    "document title as a '#' heading — no preamble.\n\n"
                    f"{FACT_FIDELITY_RULES}\n{LEGAL_ACCURACY_ANCHORS}\n{OUTPUT_FORMAT_RULES}\n"
                    "After the complete document, on its own line write the exact delimiter "
                    f"{_RATIONALE_DELIMITER} followed by 3-5 short bullet points explaining the key "
                    "drafting choices you made and why (e.g. why a clause was scoped a certain way, "
                    "why a specific statute applies) — the same way a senior associate would leave a "
                    "cover note for the partner reviewing the draft. Do not repeat the document text "
                    "in the rationale."
                )

                # Tell the frontend the canvas is opening NOW, before a single
                # token exists — the draft fills in live instead of appearing
                # as one blocking blob once generation finishes.
                start_payload = {
                    "action": "review_document_start",
                    "draft": {
                        "title": doc_info.get("title", "Legal Document"),
                        "doc_type": doc_info.get("doc_type", "Legal Document"),
                        "case_id": str(case_id or "Unknown"),
                    },
                }
                yield f"data: {json.dumps(start_payload)}\n\n"

                raw_content = ""
                sent_len = 0  # how much of the VISIBLE document we've already streamed out
                hold_back = len(_RATIONALE_DELIMITER) - 1
                try:
                    draft_stream = client.chat.completions.create(
                        model="openai/gpt-oss-120b",
                        messages=[{"role": "user", "content": draft_prompt}],
                        temperature=0.3,
                        stream=True,
                    )
                    for chunk in draft_stream:
                        delta = chunk.choices[0].delta.content
                        if not delta:
                            continue
                        raw_content += delta

                        delim_idx = raw_content.find(_RATIONALE_DELIMITER)
                        if delim_idx != -1:
                            # Delimiter confirmed — flush everything up to it
                            # (once, trailing whitespace trimmed to match the
                            # final .strip()'d content) and stop emitting
                            # draft tokens; the rest is rationale, accumulated
                            # silently until [DONE].
                            visible_tail = raw_content[sent_len:delim_idx].rstrip()
                            if visible_tail:
                                yield f"data: {json.dumps({'draft_token': visible_tail})}\n\n"
                            sent_len = delim_idx
                            continue

                        # No confirmed delimiter yet — hold back only the
                        # last few characters in case they're its opening
                        # prefix, and flush the rest immediately. Held-back
                        # characters are never lost: if they turn out not to
                        # be the delimiter, the next iteration (or the final
                        # flush below) sends them.
                        safe_len = max(sent_len, len(raw_content) - hold_back)
                        if safe_len > sent_len:
                            yield f"data: {json.dumps({'draft_token': raw_content[sent_len:safe_len]})}\n\n"
                            sent_len = safe_len
                except Exception as e:
                    yield f"data: {json.dumps({'token': f'[Draft generation error: {e}]'})}\n\n"
                    yield "data: [DONE]\n\n"
                    return

                draft_content, rationale_text = split_rationale(raw_content)
                # Final flush — covers both a false-alarm delimiter prefix
                # that never completed, and the last held-back tail of a
                # document with no rationale delimiter at all.
                if sent_len < len(draft_content):
                    yield f"data: {json.dumps({'draft_token': draft_content[sent_len:]})}\n\n"

                # search_chunks() above already retrieved the real context this
                # draft was grounded on — resolve each unique chunk's parent
                # document to a human-readable title here (the frontend's
                # "GROUNDED IN:" chips need a name, not a bare document_id) so
                # that provenance actually reaches the UI instead of being
                # discarded, which is what happened before this change.
                sources = []
                if matched_chunks:
                    import sqlite3 as _sqlite3
                    seen_doc_ids = set()
                    conn = _sqlite3.connect('lex_assistant.db')
                    conn.row_factory = _sqlite3.Row
                    try:
                        for c in matched_chunks:
                            doc_id = c.get("document_id")
                            if doc_id is None or doc_id in seen_doc_ids:
                                continue
                            seen_doc_ids.add(doc_id)
                            row = conn.execute("SELECT title FROM case_vault WHERE id = ?", (doc_id,)).fetchone()
                            if row and row["title"]:
                                sources.append({"document_id": doc_id, "title": row["title"]})
                    finally:
                        conn.close()

                # Real citation verification — a Tavily search per statute
                # citation the draft actually contains, not a fake badge.
                citations = []
                try:
                    cited = extract_statute_citations(draft_content)
                    if cited:
                        citations = verify_citations_with_tavily(cited)
                except Exception as e:
                    print(f"[Citation verification error]: {e}")

                # Title from the document's own '#' heading when the router /
                # fast-path only had a placeholder — so the card reads
                # "Mutual Non-Disclosure Agreement", not "New Legal Document".
                final_title = doc_info.get("title") or "Legal Document"
                _h = re.search(r'^\s*#\s+(.+?)\s*$', draft_content, re.MULTILINE)
                if _h and final_title in ("New Legal Document", "Title", "Legal Document"):
                    final_title = _h.group(1).strip().strip('*').strip()[:120]

                done_payload = {
                    "action": "review_document_done",
                    "draft": {
                        "title": final_title,
                        "doc_type": doc_info.get("doc_type", "Legal Document"),
                        "content": draft_content,
                        "case_id": str(case_id or "Unknown"),
                        "sources": sources,
                        "citations": citations,
                        "rationale": rationale_text,
                    }
                }
                yield f"data: {json.dumps(done_payload)}\n\n"
                actions = _generate_suggested_actions(client, query, draft_content[:800])
                yield f"data: {json.dumps({'suggested_actions': actions})}\n\n"
                yield "data: [DONE]\n\n"
                return

    except Exception as e:
        print(f"[Interceptor Error]: {e}")

    # ── ENGINE 2: NORMAL RAG STREAM (chat) ─────────────────────────
    matched_chunks = search_chunks(query, user_id, case_id, document_id, scope, top_k=4)
    system_prompt = (
        "You are an elite AI legal assistant operating strictly under Indian Law. "
        "Answer the user's query using the provided context. "
        "Format your response clearly using markdown. DO NOT output JSON.\n\n"
        "Never invent a statute section, case citation, or fact you are not confident is real — "
        "say plainly that you're not certain rather than stating a guess as fact. "
        "If the provided context doesn't contain the answer, say so instead of filling the gap "
        "from unverified general knowledge presented with false confidence. "
        "When you cite a specific 'Section X of the Y Act', only do so when you are genuinely "
        "confident that section exists and says what you say it says.\n\n"
        "Answer shape: lead with the direct answer in one or two sentences, then the supporting "
        "detail. Keep it as long as the question needs and no longer.\n\n"
        f"{LEGAL_ACCURACY_ANCHORS}\n{OUTPUT_FORMAT_RULES}"
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
            model="openai/gpt-oss-120b",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
            ],
            temperature=0.2,
            stream=True,
        )

        full_text = ''
        for chunk in completion:
            if chunk.choices[0].delta.content:
                token = chunk.choices[0].delta.content
                full_text += token
                yield f"data: {json.dumps({'token': token})}\n\n"

        # Same source check drafts get — every answer's statute citations are
        # looked up on India Code / Indian Kanoon, capped at 3 to respect the
        # free-tier Tavily budget. Only runs when the answer actually cites
        # something, so plain explanations cost nothing extra.
        try:
            cited = extract_statute_citations(full_text, max_citations=3)
            if cited:
                yield f"data: {json.dumps({'citations': verify_citations_with_tavily(cited)})}\n\n"
        except Exception as e:
            print(f"[Chat citation check error]: {e}")

        actions = _generate_suggested_actions(client, query, full_text, current_draft_context)
        yield f"data: {json.dumps({'suggested_actions': actions})}\n\n"
        yield "data: [DONE]\n\n"

    except Exception as e:
        yield f"data: {json.dumps({'error': str(e)})}\n\n"
