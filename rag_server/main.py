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
        └── Synthesize    (llama-3.3-70b-versatile via Groq, structured JSON)
              Returns: citations[], reliability_index, risk_warnings,
                       facts_vs_ruling, synthesis text

Embeddings: ChromaDB's built-in SentenceTransformerEmbeddingFunction (all-MiniLM-L6-v2, local).
            Groq has no embedding endpoint — do NOT add one.

ChromaDB is seeded with 8 realistic Indian case law entries on first boot
so the pipeline can be tested immediately without any manual ingestion.
"""

from __future__ import annotations

import json
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Literal, Optional

import chromadb
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
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
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
        model="llama-3.3-70b-versatile",
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


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
