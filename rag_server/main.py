"""
rag_server/main.py
LexAmplify — Dual-Brain RAG Intelligence Pipeline

FastAPI sidecar service (port 8001) running alongside the existing Flask app (port 5000).
Never import from Flask or share state with it — these are fully independent processes.

Architecture
------------
POST /api/search
  ├── Step 1 — Semantic Router (llama-3.1-8b-instant via Groq, temp=0.0)
  │     Classifies query as INTERNAL or EXTERNAL
  │
  ├── Brain: INTERNAL
  │     Returns a structured filter signal → frontend applies it against
  │     the `lexai_firm_library` localStorage collection client-side.
  │     No LLM synthesis, no ChromaDB hit.
  │
  └── Brain: EXTERNAL
        ├── Query ChromaDB (query_texts → default SentenceTransformer embedder)
        └── Synthesize    (openai/gpt-oss-120b via Groq, structured JSON)
              Returns: citations[], reliability_index, risk_warnings,
                       facts_vs_ruling, synthesis text

Embeddings: ChromaDB's built-in SentenceTransformerEmbeddingFunction (all-MiniLM-L6-v2, local).
            Groq has no embedding endpoint — do NOT add one.

ChromaDB is seeded with 8 realistic Indian case law entries on first boot
so the pipeline can be tested immediately without any manual ingestion.
"""

from __future__ import annotations

import difflib
import json
import os
import re
import sqlite3
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Literal, Optional
from urllib.parse import quote_plus

import chromadb
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from groq import Groq
from pydantic import BaseModel, Field

# ── Environment ───────────────────────────────────────────────────────────────
# .env lives two directories up (project root), so resolve it relative to this file.
_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=_ENV_PATH)

GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
CHROMA_DIR: Path = Path(__file__).resolve().parent / "chroma_db"
COLLECTION_NAME: str = "case_law"

# The Flask app's live case_vault database — same file, opened read-only from
# this process. This is a filesystem-level read, not a Python import, so it
# doesn't violate the "never import from Flask" rule above: SQLite already
# supports concurrent readers regardless of which process created the
# connection. NOT client_data.db (a separate, effectively-unused legacy file
# referenced by app.py's SQLITE_DB_PATH config) — the real case_vault table
# with live data lives in lex_assistant.db, in the project root.
_CLIENT_DB_PATH: Path = Path(__file__).resolve().parent.parent / "lex_assistant.db"

# ── Module-level singletons (populated in lifespan) ───────────────────────────
_groq: Optional[Groq] = None
_collection = None          # chromadb.Collection


# ── Seed data — 8 landmark Indian case law entries ────────────────────────────
# Metadata values must be scalar (str | int | float | bool) for ChromaDB.
# 'keywords' is stored as a comma-joined string.
_SEED: list[dict] = [
    {
        "id": "seed_001",
        "text": (
            "Maneka Gandhi v. Union of India (1978): The Supreme Court held that "
            "the right to life under Article 21 cannot be restricted except by a "
            "procedure that is fair, just, and reasonable. The case expanded the scope "
            "of personal liberty beyond mere physical restraint and established that "
            "procedure established by law must satisfy the tests of natural justice."
        ),
        "meta": {
            "case_name": "Maneka Gandhi v. Union of India",
            "court": "Supreme Court of India",
            "year": "1978",
            "citation_ref": "AIR 1978 SC 597",
            "domain": "Constitutional Law",
            "keywords": "article 21,personal liberty,natural justice,procedure established by law",
        },
    },
    {
        "id": "seed_002",
        "text": (
            "Vishaka v. State of Rajasthan (1997): The Supreme Court laid down the Vishaka "
            "Guidelines for prevention of sexual harassment at the workplace, making it mandatory "
            "for employers to maintain a redressal mechanism. These guidelines remained primary "
            "law until the Sexual Harassment of Women at Workplace Act, 2013 was enacted."
        ),
        "meta": {
            "case_name": "Vishaka v. State of Rajasthan",
            "court": "Supreme Court of India",
            "year": "1997",
            "citation_ref": "AIR 1997 SC 3011",
            "domain": "Employment Law",
            "keywords": "sexual harassment,workplace,employer duty,vishaka guidelines,article 14",
        },
    },
    {
        "id": "seed_003",
        "text": (
            "Indian Contract Act 1872 — Doctrine of Free Consent (Section 14): "
            "An agreement made without free consent is voidable at the option of the party "
            "whose consent was so caused. Coercion, undue influence, fraud, "
            "misrepresentation, and mistake vitiate consent. Commercial agreements are "
            "presumed to carry the intention to create legal relations, whereas domestic "
            "arrangements carry the opposite presumption."
        ),
        "meta": {
            "case_name": "Indian Contract Act — Free Consent Doctrine",
            "court": "Various High Courts",
            "year": "2010",
            "citation_ref": "Indian Contract Act 1872, Section 14",
            "domain": "Contract Law",
            "keywords": "contract,free consent,coercion,misrepresentation,ICA,voidable",
        },
    },
    {
        "id": "seed_004",
        "text": (
            "K.S. Puttaswamy v. Union of India (2017): Nine-judge bench of the Supreme Court "
            "unanimously held that the right to privacy is a fundamental right under Article 21. "
            "Informational privacy, decisional autonomy, and bodily integrity all form part of "
            "this right. The judgment has far-reaching implications for data protection "
            "legislation and surveillance by the state."
        ),
        "meta": {
            "case_name": "K.S. Puttaswamy v. Union of India",
            "court": "Supreme Court of India",
            "year": "2017",
            "citation_ref": "(2017) 10 SCC 1",
            "domain": "Constitutional Law",
            "keywords": "right to privacy,article 21,fundamental right,data protection,surveillance,aadhaar",
        },
    },
    {
        "id": "seed_005",
        "text": (
            "Arbitration and Conciliation Act 1996 — Section 9 Interim Relief: "
            "Courts may grant interim measures before or during arbitral proceedings. "
            "The Bharat Aluminium Co. v. Kaiser Aluminium (BALCO, 2012) judgment overruled "
            "Bhatia International, holding Part I applies only to India-seated arbitrations. "
            "A Section 9 petition requires satisfaction of: prima facie case, balance of "
            "convenience, and irreparable harm."
        ),
        "meta": {
            "case_name": "Bharat Aluminium Co. v. Kaiser Aluminium (BALCO)",
            "court": "Supreme Court of India",
            "year": "2012",
            "citation_ref": "(2012) 9 SCC 552",
            "domain": "Arbitration Law",
            "keywords": "arbitration,section 9,interim relief,injunction,prima facie,BALCO,A&C Act",
        },
    },
    {
        "id": "seed_006",
        "text": (
            "Negotiable Instruments Act 1881 — Section 138 Cheque Dishonour: "
            "Dishonour of a cheque for insufficiency of funds is a criminal offence. "
            "The payee must send a legal demand notice within 30 days of dishonour; "
            "the drawer has 15 days to pay. If unpaid, complaint must be filed within one month. "
            "Section 138 is a strict liability provision — mens rea is not required "
            "(MMTC Ltd. v. Medchi Chemicals, AIR 2002 SC 182)."
        ),
        "meta": {
            "case_name": "MMTC Ltd. v. Medchi Chemicals & Pharma",
            "court": "Supreme Court of India",
            "year": "2002",
            "citation_ref": "AIR 2002 SC 182",
            "domain": "Criminal Law / NI Act",
            "keywords": "cheque dishonour,section 138,NI act,demand notice,strict liability,criminal complaint",
        },
    },
    {
        "id": "seed_007",
        "text": (
            "Consumer Protection Act 2019 — Deficiency in Service (Section 2(11)): "
            "The NCDRC has consistently held that delayed delivery of flat possession constitutes "
            "deficiency in service. Builders are liable for interest at 9% per annum on deposited "
            "amounts for the delay period. Government bodies providing housing are also 'service "
            "providers' under the Act (Bangalore Development Authority v. Syndicate Bank)."
        ),
        "meta": {
            "case_name": "Consumer Protection — Real Estate Delay (NCDRC)",
            "court": "NCDRC",
            "year": "2020",
            "citation_ref": "Consumer Protection Act 2019, Section 2(11)",
            "domain": "Consumer Law",
            "keywords": "consumer protection,deficiency in service,real estate,flat possession,builder,RERA,NCDRC",
        },
    },
    {
        "id": "seed_008",
        "text": (
            "Bharatiya Nyaya Sanhita (BNS) 2023 — Section 85 (replacing IPC 498A): "
            "Cruelty by husband or his relatives is a cognizable, non-bailable offence "
            "punishable with imprisonment up to 3 years. BNS took effect 1 July 2024. "
            "The Supreme Court in Arnesh Kumar v. State of Bihar (2014) 8 SCC 273 "
            "mandated that arrest under this section must not be automatic — magistrates "
            "must apply their mind before authorising custody."
        ),
        "meta": {
            "case_name": "BNS Section 85 — Cruelty (formerly IPC 498A)",
            "court": "Supreme Court of India",
            "year": "2024",
            "citation_ref": "BNS 2023 s.85; Arnesh Kumar (2014) 8 SCC 273",
            "domain": "Criminal Law / BNS",
            "keywords": "BNS,section 85,IPC 498A,cruelty,domestic violence,arnesh kumar,automatic arrest",
        },
    },
]


# ── Seed helper ───────────────────────────────────────────────────────────────

def _seed(collection: chromadb.Collection) -> None:
    print(f"[RAG] Seeding ChromaDB with {len(_SEED)} case law entries…")
    ids = [e["id"] for e in _SEED]
    docs = [e["text"] for e in _SEED]
    metas = [e["meta"] for e in _SEED]
    collection.add(ids=ids, documents=docs, metadatas=metas)
    print("[RAG] Seeded using ChromaDB default embeddings (all-MiniLM-L6-v2).")


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _groq, _collection

    if GROQ_API_KEY:
        _groq = Groq(api_key=GROQ_API_KEY)
        print("[RAG] Groq client initialized.")
    else:
        print("[RAG] WARNING: GROQ_API_KEY not set — EXTERNAL brain will be unavailable.")

    client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    _collection = client.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},
    )

    if _collection.count() == 0:
        _seed(_collection)

    print(f"[RAG] ChromaDB ready — {_collection.count()} docs in '{COLLECTION_NAME}'")
    yield
    print("[RAG] Shutdown.")


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="LexAmplify RAG Intelligence API",
    version="1.0.0",
    description="Dual-Brain semantic search: INTERNAL (firm library) vs EXTERNAL (case law).",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173", "http://127.0.0.1:5173",
        "http://localhost:5174", "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Pydantic models ───────────────────────────────────────────────────────────

class SearchRequest(BaseModel):
    query: str = Field(..., min_length=3, max_length=2000, description="The user's legal search query")
    context: Optional[str] = Field(None, max_length=1000, description="Optional case context to sharpen routing")


class Citation(BaseModel):
    case_name: str
    court: str
    year: str
    citation_ref: str
    relevance_note: str


class FactsVsRuling(BaseModel):
    facts_summary: str
    ruling_summary: str


class SearchResponse(BaseModel):
    brain: Literal["INTERNAL", "EXTERNAL"]
    query: str

    # Present when brain == "INTERNAL"
    filter_signal: Optional[str] = Field(
        None,
        description="Constant 'filter_firm_library' — tells frontend to run a local filter",
    )
    filter_terms: Optional[List[str]] = Field(
        None,
        description="Keywords extracted from the query for client-side filtering of lexai_firm_library",
    )

    # Present when brain == "EXTERNAL"
    synthesis: Optional[str] = Field(None, description="LLM-synthesized legal intelligence text")
    citations: Optional[List[Citation]] = None
    reliability_index: Optional[float] = Field(None, ge=0.0, le=1.0, description="0.0–1.0 confidence score")
    risk_warnings: Optional[List[str]] = None
    facts_vs_ruling: Optional[FactsVsRuling] = None
    retrieved_chunks: Optional[int] = Field(None, description="Number of ChromaDB chunks retrieved")


# ── Semantic Router ───────────────────────────────────────────────────────────

_ROUTER_SYSTEM = """\
You are a query classifier for an Indian legal SaaS platform.

Classify the user's query as exactly one of:

INTERNAL — the lawyer wants to find a document from their firm's own library:
  templates, firm NDAs, standard drafts, previous agreements, firm precedents, firm formats.
  Signals: "our template", "firm draft", "our NDA", "our standard clause", "previous agreement".

EXTERNAL — the lawyer wants external legal research:
  case law, court judgments, statutes, constitutional provisions, IPC/BNS/CrPC sections,
  Supreme Court precedents, High Court rulings, or any statutory interpretation.
  Signals: "Supreme Court", "IPC", "BNS", "CrPC", "judgment", "case law", "Section", "statute".

If ambiguous, default to EXTERNAL.

Respond ONLY with valid JSON — no markdown, no preamble:
{"brain": "INTERNAL" | "EXTERNAL", "filter_terms": ["term1", "term2", "term3"]}

filter_terms: 2–4 short keywords extracted from the query (always populate, regardless of brain).\
"""


def _route(query: str) -> dict:
    resp = _groq.chat.completions.create(
        model="llama-3.1-8b-instant",
        messages=[
            {"role": "system", "content": _ROUTER_SYSTEM},
            {"role": "user", "content": f"Query: {query}"},
        ],
        temperature=0.0,
        max_tokens=120,
        response_format={"type": "json_object"},
    )
    return json.loads(resp.choices[0].message.content or "{}")


# ── Synthesis ─────────────────────────────────────────────────────────────────

_SYNTHESIS_SYSTEM = """\
You are an elite Indian legal intelligence engine.
You have retrieved relevant case law from a vector database.
Produce a structured legal intelligence response grounded STRICTLY in the retrieved context.
Do NOT hallucinate case names, citations, or statutes that are not present in the context.

Return ONLY raw JSON matching this exact schema — no markdown, no preamble:
{
  "synthesis": "2–4 paragraph structured legal analysis grounded in the retrieved context",
  "citations": [
    {
      "case_name": "Full case title",
      "court": "Court name",
      "year": "YYYY",
      "citation_ref": "AIR/SCC/SCR reference",
      "relevance_note": "One sentence on how this case applies to the query"
    }
  ],
  "reliability_index": <float 0.0–1.0>,
  "risk_warnings": ["Warning 1", "Warning 2"],
  "facts_vs_ruling": {
    "facts_summary": "Key facts from the retrieved cases",
    "ruling_summary": "Key legal ruling or ratio decidendi"
  }
}

reliability_index guidance:
  0.85–1.0 → multiple directly on-point cases, statutory authority
  0.60–0.84 → related cases, partially applicable
  0.35–0.59 → tangentially related, limited precedent
  <0.35     → no directly relevant law retrieved

risk_warnings: Always include ≥1 caveat (jurisdiction limits, recent statutory changes, etc.).\
"""


def _synthesize(query: str, chunks: list[dict], avg_distance: float) -> dict:
    context_parts: list[str] = []
    for i, chunk in enumerate(chunks, 1):
        meta = chunk["metadata"]
        context_parts.append(
            f"[CASE {i}] {meta.get('case_name', 'Unknown')} "
            f"({meta.get('court', '')} {meta.get('year', '')})\n"
            f"Citation: {meta.get('citation_ref', 'N/A')}\n"
            f"Excerpt: {chunk['document']}"
        )
    context_str = "\n\n---\n\n".join(context_parts)

    # ChromaDB cosine distance: 0 = identical, 2 = opposite.
    # Convert to reliability hint: distance 0→1.0, distance 1.5+→0.0.
    reliability_hint = round(max(0.0, min(1.0, 1.0 - (avg_distance / 1.5))), 3)

    user_msg = (
        f"Legal Query: {query}\n\n"
        f"Retrieved Context (avg vector distance={avg_distance:.3f}, "
        f"reliability_hint={reliability_hint}):\n\n"
        f"{context_str}"
    )

    resp = _groq.chat.completions.create(
        model="openai/gpt-oss-120b",
        messages=[
            {"role": "system", "content": _SYNTHESIS_SYSTEM},
            {"role": "user", "content": user_msg},
        ],
        temperature=0.15,
        max_tokens=1800,
        response_format={"type": "json_object"},
    )
    return json.loads(resp.choices[0].message.content or "{}")


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "groq_configured": bool(_groq),
        "chroma_documents": _collection.count() if _collection else 0,
        "collection": COLLECTION_NAME,
    }


_IK_DOC     = "https://indiankanoon.org/doc/{}/"
_IK_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; LexAmplify/1.0; legal-research-tool)",
    "Accept": "text/html,application/xhtml+xml",
}

@app.get("/api/resolve-citation")
async def resolve_citation(query: str):
    """
    Resolve a case citation string to its direct Indian Kanoon document URL.
    Scrapes the first /doc/{id}/ link from Kanoon search results.
    Falls back to the search URL on any failure or timeout.
    """
    fallback = f"https://indiankanoon.org/search/?formInput={quote_plus(query)}"
    try:
        async with httpx.AsyncClient(timeout=6.0, follow_redirects=True) as client:
            resp = await client.get(
                "https://indiankanoon.org/search/",
                params={"formInput": query},
                headers=_IK_HEADERS,
            )
        if resp.status_code == 200:
            match = re.search(r'/doc/(\d+)/', resp.text)
            if match:
                return {"exact_url": _IK_DOC.format(match.group(1))}
    except Exception:
        pass
    return {"exact_url": fallback}


@app.post("/api/search", response_model=SearchResponse)
async def search(req: SearchRequest) -> SearchResponse:
    """
    Dual-Brain RAG search.

    INTERNAL path (fast, zero LLM synthesis):
      Returns filter_signal + filter_terms for the frontend to apply against
      the `lexai_firm_library` localStorage array client-side.

    EXTERNAL path (full RAG):
      ChromaDB top-5 (query_texts → SentenceTransformer) → Groq synthesis →
      citations[], reliability_index, risk_warnings, facts_vs_ruling.
    """
    if not _groq:
        raise HTTPException(
            status_code=503,
            detail="RAG service not configured. Add GROQ_API_KEY to .env and restart.",
        )

    # ── 1. Route ──────────────────────────────────────────────────────────────
    try:
        route_result = _route(req.query)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Router error: {exc}")

    brain: Literal["INTERNAL", "EXTERNAL"] = route_result.get("brain", "EXTERNAL")
    filter_terms: list[str] = route_result.get("filter_terms", [])

    # ── 2a. INTERNAL — return immediately, no ChromaDB or synthesis ───────────
    if brain == "INTERNAL":
        return SearchResponse(
            brain="INTERNAL",
            query=req.query,
            filter_signal="filter_firm_library",
            filter_terms=filter_terms,
        )

    # ── 2b. EXTERNAL — ChromaDB retrieval ────────────────────────────────────
    doc_count = _collection.count() if _collection else 0
    if doc_count == 0:
        raise HTTPException(status_code=503, detail="ChromaDB collection is empty — seed data not loaded.")

    try:
        results = _collection.query(
            query_texts=[req.query],
            n_results=min(5, doc_count),
            include=["documents", "metadatas", "distances"],
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"ChromaDB error: {exc}")

    docs: list[str] = results.get("documents", [[]])[0]
    metas: list[dict] = results.get("metadatas", [[]])[0]
    distances: list[float] = results.get("distances", [[]])[0]

    chunks = [{"document": d, "metadata": m} for d, m in zip(docs, metas)]
    avg_distance = sum(distances) / len(distances) if distances else 1.0

    # ── 3. Synthesize ─────────────────────────────────────────────────────────
    try:
        raw = _synthesize(req.query, chunks, avg_distance)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Synthesis error: {exc}")

    # Parse citations
    citations: list[Citation] = []
    for c in raw.get("citations", []):
        try:
            citations.append(
                Citation(
                    case_name=c.get("case_name", ""),
                    court=c.get("court", ""),
                    year=str(c.get("year", "")),
                    citation_ref=c.get("citation_ref", ""),
                    relevance_note=c.get("relevance_note", ""),
                )
            )
        except Exception:
            continue

    # Parse facts_vs_ruling
    fvr_raw = raw.get("facts_vs_ruling") or {}
    facts_vs_ruling = (
        FactsVsRuling(
            facts_summary=fvr_raw.get("facts_summary", ""),
            ruling_summary=fvr_raw.get("ruling_summary", ""),
        )
        if fvr_raw
        else None
    )

    return SearchResponse(
        brain="EXTERNAL",
        query=req.query,
        synthesis=raw.get("synthesis", ""),
        citations=citations,
        reliability_index=float(raw.get("reliability_index", 0.5)),
        risk_warnings=raw.get("risk_warnings", []),
        facts_vs_ruling=facts_vs_ruling,
        retrieved_chunks=len(docs),
    )


# ── Contract Analyzer — Map-Reduce chunking helpers ────────────────────────────
# Duplicated locally (not imported from the Flask sidecar's routes/contract_routes.py)
# per this file's own rule at the top: this service must never import from Flask
# or share state with it — they're fully independent processes.

def chunk_text_by_boundary(text: str, chunk_size: int = 3000, overlap: int = 300) -> list[str]:
    """Split text into overlapping chunks, snapping each cut to the nearest
    paragraph break (or single newline) within the tail of the window instead
    of hard-slicing at exactly chunk_size — avoids cutting a clause in half
    mid-sentence, which would confuse the LLM's per-chunk analysis."""
    if not text:
        return []
    if len(text) <= chunk_size:
        return [text]

    chunks = []
    start = 0
    n = len(text)
    min_chunk = chunk_size // 2  # never accept a boundary so close it produces a tiny chunk
    while start < n:
        end = min(start + chunk_size, n)
        if end < n:
            search_from = start + min_chunk
            boundary = text.rfind('\n\n', search_from, end)
            if boundary == -1:
                boundary = text.rfind('\n', search_from, end)
            if boundary != -1:
                end = boundary
        piece = text[start:end].strip()
        if piece:
            chunks.append(piece)
        if end >= n:
            break
        start = max(end - overlap, start + min_chunk)  # guarantees forward progress
    return chunks


def is_near_duplicate_risk(candidate_text: str, accepted_texts: list[str], threshold: float = 0.85) -> bool:
    """True if candidate_text is a fuzzy match (SequenceMatcher ratio > threshold)
    against any already-accepted risk. Catches the same clause getting flagged
    twice from two overlapping chunks with slightly different surrounding
    whitespace/punctuation — exact-string dedup misses these."""
    for accepted in accepted_texts:
        if difflib.SequenceMatcher(None, candidate_text, accepted).ratio() > threshold:
            return True
    return False


# ── Dual-Brain Citation Router: is this precedent already in the firm's own
# case_vault, or do we need to send the user out to Indian Kanoon? ────────────

# Bulk-ingested judgments in case_vault often have their `title` column set to
# a bare docket id ("2025INSC1109") rather than the real case name — the real
# name only lives in the document body. Same extraction approach as app.py's
# resolve_vault_title/extract_case_title_from_content (duplicated here, not
# imported, per this file's own no-Flask-imports rule), scanning line-by-line
# and bounded to the first 60 lines so it never behaves like a document-wide
# greedy regex.
_PARTY_VS_LINE_RE = re.compile(r"([^\n]{3,60}\s+(?:v\.|vs\.|vs|VERSUS)\s+[^\n]{3,60})", re.IGNORECASE)
_STANDALONE_VS_RE = re.compile(r'^(?:v\.|vs\.|vs|versus)$', re.IGNORECASE)
_CAPTION_SCAN_WINDOW = 60


def _extract_case_title_from_content(content: str | None) -> str | None:
    if not content:
        return None
    lines = [l.strip() for l in content.split('\n')]
    non_empty = [l for l in lines if l][:_CAPTION_SCAN_WINDOW]
    for i, line in enumerate(non_empty):
        m = _PARTY_VS_LINE_RE.search(line)
        if m:
            cleaned = re.sub(r'\s+', ' ', m.group(1)).strip(' .,-:;')
            if cleaned:
                return cleaned
        if _STANDALONE_VS_RE.match(line) and 0 < i < len(non_empty) - 1:
            party_a, party_b = non_empty[i - 1], non_empty[i + 1]
            if 3 <= len(party_a) <= 80 and 3 <= len(party_b) <= 80:
                cleaned = re.sub(r'\s+', ' ', f'{party_a} {line} {party_b}').strip(' .,-:;')
                if cleaned:
                    return cleaned
    return None


def find_in_vault(citation_title: str, threshold: float = 0.8) -> tuple[bool, str | None]:
    """Two-stage lookup, never loads case_vault into memory:
    1. A SQL LIKE pre-filter on a single distinctive keyword narrows 900+ rows
       down to at most 5 candidates entirely inside SQLite.
    2. difflib.SequenceMatcher runs only against those <=5 candidates.
    """
    if not citation_title or not _CLIENT_DB_PATH.exists():
        return False, None

    # Case titles are almost always "Party A v. Party B" — the phrase before
    # the separator is far more selective as a LIKE pattern than any single
    # word from it. A common surname alone (e.g. "Jaiswal") can appear in
    # dozens of unrelated judgments and starve the real match out of the
    # top-5 LIMIT before difflib ever gets to see it.
    parts = re.split(r'\s+(?:v\.|vs\.|vs|versus)\s+', citation_title, maxsplit=1, flags=re.IGNORECASE)
    phrase = parts[0].strip() if parts and len(parts[0].strip()) >= 6 else citation_title.strip()
    like = f"%{phrase}%"

    try:
        conn = sqlite3.connect(f"file:{_CLIENT_DB_PATH.as_posix()}?mode=ro", uri=True, timeout=2)
        try:
            rows = conn.execute(
                "SELECT id, title, case_id, content FROM case_vault "
                "WHERE title LIKE ? OR content LIKE ? LIMIT 5",
                (like, like),
            ).fetchall()
        finally:
            conn.close()
    except Exception as exc:
        print(f"[analyze-contract] case_vault lookup failed: {exc}")
        return False, None

    best_ratio, best_id = 0.0, None
    for row_id, title, case_id, content in rows:
        # A title that's just a bare copy of the docket id carries no
        # comparable signal — fall back to a name extracted from the body.
        candidate = title if (title and title != case_id) else (_extract_case_title_from_content(content) or title or "")
        ratio = difflib.SequenceMatcher(None, citation_title.lower(), candidate.lower()).ratio()
        if ratio > best_ratio:
            best_ratio, best_id = ratio, row_id

    if best_ratio > threshold:
        return True, str(best_id)
    return False, None


class ContractAnalysisRequest(BaseModel):
    contract_text: str = Field(..., min_length=10, max_length=60000)
    rule_book: Optional[str] = Field(None, max_length=8000)
    scan_strategy: str = Field("Defensive", description="Defensive | Aggressive | Standard")


@app.post("/api/analyze-contract")
async def analyze_contract(req: ContractAnalysisRequest):
    """
    Map-Reduce contract risk scanner powered by openai/gpt-oss-120b.

    Step 1 — General Indian law analysis (Contract Act 1872, NI Act, IT Act, etc.)
    Step 2 — Rule Book enforcement: if rule_book is provided, its directives are
              ABSOLUTE OVERRIDES; violating clauses are flagged Red with
              is_rule_book_violation: true regardless of general legal compliance.

    The contract is split into overlapping ~3000-char chunks (boundary-aware,
    never mid-sentence) and analyzed concurrently (max 3 workers, to avoid
    tripping the LLM provider's rate limiter) instead of hard-truncating
    anything past 14000 chars as the single-call version used to. Results are
    fuzzy-deduplicated across chunk overlaps, then used to drive a semantic
    citation lookup against the existing ChromaDB case-law index.
    """
    if _groq is None:
        raise HTTPException(
            status_code=503,
            detail="Groq client not initialised — set GROQ_API_KEY in .env",
        )

    rule_book_block = ""
    if req.rule_book and req.rule_book.strip():
        rule_book_block = f"""
RULE BOOK (ABSOLUTE OVERRIDE — enforce after general analysis):
The following directives were set by the client. ANY clause that contradicts them
MUST be flagged as risk_level "Red" with is_rule_book_violation set to true and a
suggested_rewrite that brings the clause into full compliance. Whenever
is_rule_book_violation is true you MUST also populate "rule_book_reference" with the
EXACT verbatim quote (or the single most relevant line) from the Rule Book below that
the clause violates — copy it word-for-word, do not paraphrase.

{req.rule_book.strip()}

"""

    system_prompt = f"""You are an unyielding Corporate General Counsel performing a rigorous {req.scan_strategy} scan.
You must evaluate the contract through two absolute filters.

STEP 1 — GENERAL LAW BENCHMARK:
Benchmark the text against general law. Identify all clauses that pose High (Red) or
Medium (Amber) risk under Indian law: Indian Contract Act 1872, NI Act, IT Act 2000,
Consumer Protection Act, IPC/BNS, GDPR-equivalent data provisions, and sector-specific
regulations. For each flagged clause include a verbatim excerpt (max 200 chars), the
legal issue, and a suggested attorney-quality rewrite.
{rule_book_block}
STEP 2 — THE MANDATE (applies only when a Rule Book is provided above):
Apply the provided custom rule book as a NON-NEGOTIABLE directive. If the rule book
requires a condition (e.g., Net 10 days), ANY variation in the contract (e.g., Net 30
days) is immediately an unacceptable High Risk (Red) violation with
is_rule_book_violation: true. You must IGNORE generic industry standards whenever they
conflict with the user's playbook directives — the playbook always wins.

Return ONLY a valid JSON object — no markdown, no commentary:
{{
  "overall_risk_score": <integer 0-100, 100 = maximum risk>,
  "summary": "<2–3 sentence executive risk summary>",
  "flagged_clauses": [
    {{
      "clause_title": "<short descriptive title>",
      "original_text": "<verbatim excerpt from contract, max 200 chars>",
      "risk_level": "<Red|Amber|Green>",
      "explanation": "<specific Indian legal issue or Rule Book violation>",
      "suggested_rewrite": "<attorney-quality replacement clause>",
      "is_rule_book_violation": <true|false>,
      "rule_book_reference": "<exact verbatim quote from the Rule Book that this clause violates — REQUIRED when is_rule_book_violation is true, otherwise empty string>"
    }}
  ],
  "missing_clauses": [
    {{
      "title": "<clause name>",
      "clause": "<suggested clause text>",
      "explanation": "<why this protection is legally significant>"
    }}
  ]
}}"""

    def analyze_chunk(chunk_text: str) -> dict:
        # One hallucinated/malformed JSON response for a single chunk must
        # never take down the whole document's analysis — isolate it here so
        # a failure degrades to "no findings in this chunk", not a crash.
        try:
            response = _groq.chat.completions.create(
                model="openai/gpt-oss-120b",
                temperature=0.15,
                max_tokens=3000,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"CONTRACT TEXT:\n\n{chunk_text}"},
                ],
            )
            return json.loads(response.choices[0].message.content or "{}")
        except Exception as exc:
            print(f"[analyze-contract] chunk failed, skipping: {exc}")
            return {"flagged_clauses": [], "missing_clauses": [], "overall_risk_score": None, "summary": ""}

    chunks = chunk_text_by_boundary(req.contract_text, chunk_size=3000, overlap=300)
    if not chunks:
        chunks = [req.contract_text]

    all_clauses: list[dict] = []
    all_missing: list[dict] = []
    scores: list[float] = []
    summaries: list[str] = []

    # Capped at 3 concurrent workers so a large document doesn't fire N
    # simultaneous requests at the LLM provider and trip its rate limiter.
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = [executor.submit(analyze_chunk, c) for c in chunks]
        for future in as_completed(futures):
            res = future.result()  # analyze_chunk never raises
            if isinstance(res.get("flagged_clauses"), list):
                all_clauses.extend(res["flagged_clauses"])
            if isinstance(res.get("missing_clauses"), list):
                all_missing.extend(res["missing_clauses"])
            if isinstance(res.get("overall_risk_score"), (int, float)):
                scores.append(res["overall_risk_score"])
            if isinstance(res.get("summary"), str) and res["summary"]:
                summaries.append(res["summary"])

    if not summaries and not all_clauses:
        # every chunk failed — surface a real error instead of a silent empty result
        raise HTTPException(status_code=500, detail="Analysis failed for all document chunks.")

    # Fuzzy-deduplicate flagged clauses: overlapping chunks routinely re-flag
    # the same clause with minor wording/whitespace differences, which
    # exact-string matching would let through as two "different" risks.
    accepted_texts: list[str] = []
    unique_clauses: list[dict] = []
    for c in all_clauses:
        txt = (c.get("original_text") or "").strip()
        if not txt:
            continue
        if is_near_duplicate_risk(txt, accepted_texts):
            continue
        accepted_texts.append(txt)
        unique_clauses.append(c)

    # Missing-clause suggestions are short, structured titles rather than
    # free-text excerpts, so exact-match dedup (by title) is sufficient here.
    seen_titles = set()
    unique_missing: list[dict] = []
    for m in all_missing:
        title = (m.get("title") or "").strip().lower()
        if title and title not in seen_titles:
            seen_titles.add(title)
            unique_missing.append(m)

    overall_score = round(sum(scores) / len(scores)) if scores else 0
    final_summary = summaries[0] if summaries else "Document analyzed successfully."

    # Context-Aware Dynamic Auto-RAG: skip the embedding + ChromaDB round-trip
    # entirely when there are no risks to search precedents for.
    citations: list[dict] = []
    if unique_clauses:
        search_query = " ".join(c.get("explanation", "") for c in unique_clauses[:5]).strip()
        if search_query and _collection is not None:
            try:
                doc_count = _collection.count()
                if doc_count > 0:
                    # query_texts routes through ChromaDB's existing embedding
                    # function (SentenceTransformer all-MiniLM-L6-v2) — the
                    # same one the case-law index was seeded with — before
                    # running the similarity search.
                    results = _collection.query(
                        query_texts=[search_query],
                        n_results=min(3, doc_count),
                        include=["documents", "metadatas"],
                    )
                    docs = results.get("documents", [[]])[0]
                    metas = results.get("metadatas", [[]])[0]
                    for i, meta in enumerate(metas):
                        meta = meta or {}
                        doc_text = docs[i] if i < len(docs) else ""
                        title = meta.get("case_name", "Untitled Case")
                        in_vault, vault_id = find_in_vault(title)
                        citations.append({
                            "title": title,
                            "snippet": doc_text[:200],
                            "in_vault": in_vault,
                            "vault_id": vault_id,
                            "kanoon_query": title,
                        })
            except Exception as exc:
                print(f"[analyze-contract] citation RAG failed: {exc}")

    return {
        "overall_risk_score": overall_score,
        "summary": final_summary,
        "flagged_clauses": unique_clauses,
        "missing_clauses": unique_missing,
        "citations": citations,
    }


# ── AI Auto-Resolution: draft a revised clause from a user comment ──────────

class DraftRevisionRequest(BaseModel):
    original_text: str = Field(..., min_length=1, max_length=5000)
    surrounding_context: str = Field("", max_length=20000)
    user_comment: str = Field("", max_length=2000)


@app.post("/api/draft-revision")
async def draft_revision(req: DraftRevisionRequest):
    """Rewrites a single clause per the user's comment (or, absent one, per
    general Indian-law risk reduction). surrounding_context is required in
    the payload, not optional — an isolated clause with no context around it
    routinely causes the LLM to invent facts or break a defined term that's
    only established elsewhere in the document."""
    if _groq is None:
        raise HTTPException(
            status_code=503,
            detail="Groq client not initialised — set GROQ_API_KEY in .env",
        )

    instruction = (
        f"USER INSTRUCTION: {req.user_comment.strip()}"
        if req.user_comment.strip()
        else "No specific instruction was given — use your own judgment to reduce "
             "legal risk and improve enforceability under Indian law."
    )

    system_prompt = f"""You are an expert Indian contract lawyer revising a single clause.

SURROUNDING DOCUMENT CONTEXT (for reference only — do not rewrite anything
outside the target clause, and do not break any defined term or
cross-reference that appears in this context):
{req.surrounding_context[:6000]}

TARGET CLAUSE TO REVISE (verbatim):
{req.original_text}

{instruction}

Return ONLY a valid JSON object — no markdown, no commentary:
{{"revised_text": "<the rewritten clause, ready to drop in verbatim in place of the target clause>"}}"""

    try:
        response = _groq.chat.completions.create(
            model="openai/gpt-oss-120b",
            temperature=0.2,
            max_tokens=800,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": "Revise the target clause now."},
            ],
        )
        result = json.loads(response.choices[0].message.content or "{}")
        revised_text = (result.get("revised_text") or "").strip()
        if not revised_text:
            raise HTTPException(status_code=500, detail="Model returned an empty revision.")
        return {"original_text": req.original_text, "revised_text": revised_text}
    except HTTPException:
        raise
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"Groq returned invalid JSON: {exc}")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Draft revision failed: {exc}")


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
