"""
utils/local_search.py
100% local semantic search — no OpenAI, no cloud vector DB. Embeddings via
sentence-transformers (all-MiniLM-L6-v2, fetched once then cached under
the standard HF cache dir, fully offline after that). Vector store is
ChromaDB's embedded/persistent client, writing to ./chroma_data on disk —
document text never leaves this machine. BM25 is a pure-Python keyword
fallback with zero network dependency, so search still degrades gracefully
to keyword-only if the vector leg errors for any reason.
"""
import os
import re
import threading

import chromadb
from chromadb.utils import embedding_functions
from rank_bm25 import BM25Okapi

CHROMA_PATH = os.getenv('CHROMA_PATH', 'chroma_data')
COLLECTION_NAME = 'firm_library'
EMBED_MODEL_NAME = 'sentence-transformers/all-MiniLM-L6-v2'

_lock = threading.Lock()
_collection = None
_embedder = None


def _get_embedder():
    global _embedder
    if _embedder is None:
        _embedder = embedding_functions.SentenceTransformerEmbeddingFunction(
            model_name=EMBED_MODEL_NAME
        )
    return _embedder


def _get_collection():
    global _collection
    if _collection is not None:
        return _collection
    with _lock:
        if _collection is not None:
            return _collection
        client = chromadb.PersistentClient(path=CHROMA_PATH)
        _collection = client.get_or_create_collection(
            name=COLLECTION_NAME,
            embedding_function=_get_embedder(),
        )
    return _collection


def index_document(doc_id, title, content):
    """Upserts a single Firm Library document into the local vector index.
    Best-effort — a local-model load hiccup must never break the write
    path that calls this (document creation), so failures are swallowed
    after logging."""
    if not content or not content.strip():
        return
    try:
        collection = _get_collection()
        collection.upsert(
            ids=[str(doc_id)],
            documents=[content[:8000]],
            metadatas=[{"title": title or ""}],
        )
    except Exception as e:
        print(f"[local_search] index_document failed for {doc_id}: {e}")


def delete_document(doc_id):
    try:
        collection = _get_collection()
        collection.delete(ids=[str(doc_id)])
    except Exception:
        pass


_TOKEN_RE = re.compile(r"[A-Za-z0-9]+")


def _tokenize(text):
    return [t.lower() for t in _TOKEN_RE.findall(text or "")]


def hybrid_search(query, candidates, top_k=10):
    """
    candidates: list of {"id", "title", "content"} — the full corpus,
    pulled fresh by the caller from case_vault so results stay correct
    even for documents the vector index hasn't caught up with yet.

    Blends two independent signals into one ranking:
      - Vector proximity: ChromaDB query against the local MiniLM index.
      - BM25 keyword score: rebuilt fresh from `candidates` every call
        (cheap for a few hundred docs) — pure Python, no index/network
        dependency, so it still works even if the vector leg is empty or
        errors entirely.
    An exact keyword hit is never buried by a purely semantic near-miss,
    and a semantically-close-but-keyword-mismatched passage still surfaces.
    """
    if not query or not query.strip() or not candidates:
        return []

    id_to_candidate = {str(c["id"]): c for c in candidates}

    # ── Vector leg ──────────────────────────────────────────────────────
    vector_scores = {}
    try:
        collection = _get_collection()
        result = collection.query(
            query_texts=[query],
            n_results=min(top_k * 3, max(len(candidates), 1)),
        )
        ids = (result.get("ids") or [[]])[0]
        distances = (result.get("distances") or [[]])[0]
        for doc_id, dist in zip(ids, distances):
            if doc_id not in id_to_candidate:
                continue
            # Chroma returns a distance (lower = closer) — convert to a
            # 0..1 similarity so it combines cleanly with the BM25 score.
            vector_scores[doc_id] = 1.0 / (1.0 + max(dist, 0.0))
    except Exception as e:
        print(f"[local_search] vector query failed, falling back to BM25 only: {e}")

    # ── BM25 keyword leg ────────────────────────────────────────────────
    corpus_ids = [str(c["id"]) for c in candidates]
    tokenized_corpus = [_tokenize(c.get("content") or c.get("title") or "") for c in candidates]
    bm25_scores = {}
    if tokenized_corpus and any(tokenized_corpus):
        bm25 = BM25Okapi(tokenized_corpus)
        raw_scores = bm25.get_scores(_tokenize(query))
        max_score = max(raw_scores) if len(raw_scores) else 0
        for doc_id, score in zip(corpus_ids, raw_scores):
            bm25_scores[doc_id] = (score / max_score) if max_score > 0 else 0.0

    # ── Blend ───────────────────────────────────────────────────────────
    VECTOR_WEIGHT, BM25_WEIGHT = 0.6, 0.4
    blended = []
    for doc_id in id_to_candidate:
        v = vector_scores.get(doc_id, 0.0)
        b = bm25_scores.get(doc_id, 0.0)
        score = VECTOR_WEIGHT * v + BM25_WEIGHT * b
        if score <= 0:
            continue
        blended.append((doc_id, score))

    blended.sort(key=lambda x: x[1], reverse=True)
    results = []
    for doc_id, score in blended[:top_k]:
        c = id_to_candidate[doc_id]
        results.append({
            "id": c["id"],
            "title": c.get("title", ""),
            "snippet": (c.get("content") or "")[:240],
            "score": round(score, 4),
        })
    return results
