import os
from dotenv import load_dotenv
from pinecone import Pinecone

# 1. Load Environment Variables
load_dotenv()

# 2. Initialize Pinecone
pc = Pinecone(api_key=os.environ.get("PINECONE_API_KEY"))
index = pc.Index(host=os.environ.get("PINECONE_HOST"))

# 3. The Natural Language Query
lawyer_question = "What is the penalty or issue when a cheque bounces due to insufficient funds?"
print(f"\n🔍 Lawyer Query: '{lawyer_question}'\n")

# 4. Search the Database
print("Sending query to Pinecone (Nvidia GPUs will embed the question and find matches)...")
results = index.search(
    namespace="legal-cases",
    query={
        "inputs": {"text": lawyer_question},
        "top_k": 2
    }
)

print("\n⚖️  TOP LEGAL PRECEDENTS RETRIEVED:\n")

hits = results.get("result", {}).get("hits", [])

if not hits:
    print("No matches found.")
else:
    for i, hit in enumerate(hits):

        # --- BULLETPROOF SCORE EXTRACTION ---
        score = 0.0
        if isinstance(hit, dict):
            # Check every known possible key Pinecone might use
            score = hit.get("score", hit.get("_score", hit.get("similarity", 0.0)))
        elif hasattr(hit, 'score') and hit.score is not None:
            score = hit.score
        elif hasattr(hit, '_score') and hit._score is not None:
            score = hit._score

        # Extract fields safely
        fields = {}
        if isinstance(hit, dict):
            fields = hit.get("fields", {})
        elif hasattr(hit, 'fields'):
            fields = hit.fields

        text = fields.get("text", "No text found") if isinstance(fields, dict) else "No text found"
        source = fields.get("source_case", "Unknown Source") if isinstance(fields, dict) else "Unknown Source"

        print(f"--- Match {i+1} ---")
        print(f"Confidence Score: {score:.4f}")
        print(f"Source: {source}")
        print(f"Excerpt: {text}\n")
