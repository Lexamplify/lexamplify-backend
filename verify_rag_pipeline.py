import os
import sys
import math
import sqlite3
import dotenv
from pinecone import Pinecone

# Windows consoles default to cp1252, which can't encode the emoji/checkmark
# below — force UTF-8 stdout so this doesn't crash on the success line.
sys.stdout.reconfigure(encoding="utf-8")

dotenv.load_dotenv()

DB_PATH = "lex_assistant.db"
NAMESPACE = "legal-cases"
SAMPLE_QUERY = "Mamman Khan versus State of Haryana communal violence"
TOP_K = 3


def verify_sqlite():
    print("=" * 60)
    print("1. SQLITE DATABASE VERIFICATION")
    print("=" * 60)
    conn = sqlite3.connect(DB_PATH)
    try:
        count = conn.execute("SELECT COUNT(*) FROM case_vault;").fetchone()[0]
    finally:
        conn.close()

    assert count > 0, f"case_vault is empty (count={count}) — no cases have been ingested."
    print(f"case_vault total case count: {count}")
    print()
    return count


def verify_pinecone():
    print("=" * 60)
    print("2. PINECONE VECTOR RETRIEVAL VERIFICATION")
    print("=" * 60)

    api_key = os.environ.get("PINECONE_API_KEY")
    host = os.environ.get("PINECONE_HOST")
    assert api_key, "Missing PINECONE_API_KEY in .env"
    assert host, "Missing PINECONE_HOST in .env"

    pc = Pinecone(api_key=api_key)
    index = pc.Index(host=host)

    print(f"Querying namespace '{NAMESPACE}' with: \"{SAMPLE_QUERY}\"")
    results = index.search(
        namespace=NAMESPACE,
        query={"inputs": {"text": SAMPLE_QUERY}, "top_k": TOP_K},
    )
    hits = results.get("result", {}).get("hits", [])
    print(f"Hits returned: {len(hits)}")
    print()
    return hits


def print_and_validate_results(hits):
    print("=" * 60)
    print("3. OUTPUT & ASSERTIONS")
    print("=" * 60)

    assert len(hits) > 0, "0 matches returned from Pinecone — RAG retrieval is broken."

    for rank, hit in enumerate(hits, start=1):
        # Bulletproof extraction — the Pinecone SDK's Hit object exposes
        # score/id/fields as properties, not as dict keys ("_score"/"_id"
        # return None even though they look like the obvious names).
        score = hit.get("score", None) if isinstance(hit, dict) else getattr(hit, "score", None)
        doc_id = hit.get("id", None) if isinstance(hit, dict) else getattr(hit, "id", None)
        fields = hit.get("fields", {}) if isinstance(hit, dict) else getattr(hit, "fields", {})

        # A "valid" score is a finite real number — not hard-bounded to
        # [0, 1], since the exact metric (cosine vs. dot-product) can
        # legitimately produce values outside that range without indicating
        # a broken retrieval.
        assert score is not None, f"Result #{rank} has no similarity score."
        assert isinstance(score, (int, float)) and not isinstance(score, bool), \
            f"Result #{rank} score is not numeric: {score!r}"
        assert math.isfinite(score), f"Result #{rank} has a non-finite similarity score: {score}"

        source_case = fields.get("source_case", "Unknown Case") if isinstance(fields, dict) else "Unknown Case"
        text_snippet = fields.get("text", "") if isinstance(fields, dict) else ""
        snippet = (text_snippet[:150] + "...") if len(text_snippet) > 150 else text_snippet

        print(f"\n--- Result #{rank} ---")
        print(f"Match Score:        {score:.4f}")
        print(f"Document/Chunk ID:  {doc_id}")
        print(f"Source Case:        {source_case}")
        print(f"Snippet:            {snippet}")

    print()


def main():
    verify_sqlite()
    hits = verify_pinecone()
    print_and_validate_results(hits)

    print("=" * 60)
    print("✅ RAG PIPELINE VERIFIED SUCCESSFULLY")
    print("=" * 60)
    sys.exit(0)


if __name__ == "__main__":
    main()
