import os
from dotenv import load_dotenv
from pinecone import Pinecone
from openai import OpenAI

# 1. Load Environment Variables
load_dotenv()

# 2. Initialize Pinecone & OpenAI
print("Connecting to Pinecone and OpenAI...")
pc = Pinecone(api_key=os.environ.get("PINECONE_API_KEY"))
index = pc.Index(host=os.environ.get("PINECONE_HOST"))
openai_client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

# 3. The Natural Language Query
lawyer_question = "What is the penalty or issue when a cheque bounces due to insufficient funds?"
print(f"\nLawyer Query: '{lawyer_question}'\n")

# 4. RETRIEVAL (The Librarian / Pinecone)
print("Fetching relevant legal precedents from Pinecone...")
results = index.search(
    namespace="legal-cases",
    query={
        "inputs": {"text": lawyer_question},
        "top_k": 2
    }
)

# Extract the text from the results to build our context
retrieved_text = ""
hits = results.get("result", {}).get("hits", [])
for hit in hits:
    text = hit.get("fields", {}).get("text", "")
    retrieved_text += f"- {text}\n"

# 5. GENERATION (The Lawyer / OpenAI)
print("Drafting legal summary with OpenAI (gpt-4o-mini)...")

# We build a strict prompt telling the AI to ONLY use the retrieved context
prompt = f"""You are an expert Indian Legal AI Assistant named LexAmplify.
Answer the user's question based ONLY on the provided legal context.
If the context does not contain the answer, say "I don't have enough information."
Be professional, clear, and concise.

CONTEXT:
{retrieved_text}

QUESTION:
{lawyer_question}
"""

chat_completion = openai_client.chat.completions.create(
    messages=[{"role": "user", "content": prompt}],
    model="gpt-4o-mini",  # fast, cheap; the app standard
)

print("\n==========================================")
print("LEXAMPLIFY AI RESPONSE:")
print("==========================================")
print(chat_completion.choices[0].message.content)
print("==========================================\n")
