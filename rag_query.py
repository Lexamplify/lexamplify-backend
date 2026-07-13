import os
from dotenv import load_dotenv
from pinecone import Pinecone
from groq import Groq

# 1. Load Environment Variables
load_dotenv()

# 2. Initialize Pinecone & Groq
print("Connecting to Pinecone and Groq...")
pc = Pinecone(api_key=os.environ.get("PINECONE_API_KEY"))
index = pc.Index(host=os.environ.get("PINECONE_HOST"))
groq_client = Groq(api_key=os.environ.get("GROQ_API_KEY"))

# 3. The Natural Language Query
lawyer_question = "What is the penalty or issue when a cheque bounces due to insufficient funds?"
print(f"\n🔍 Lawyer Query: '{lawyer_question}'\n")

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

# 5. GENERATION (The Lawyer / Groq)
print("Drafting legal summary with Groq (Llama 3)...")

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

chat_completion = groq_client.chat.completions.create(
    messages=[{"role": "user", "content": prompt}],
    model="llama-3.1-8b-instant", # High-speed, free tier model
)

print("\n==========================================")
print("⚖️  LEXAMPLIFY AI RESPONSE:")
print("==========================================")
print(chat_completion.choices[0].message.content)
print("==========================================\n")
