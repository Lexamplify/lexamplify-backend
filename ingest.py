import os
from dotenv import load_dotenv
from pinecone import Pinecone
from langchain_text_splitters import RecursiveCharacterTextSplitter

# 1. Load Environment Variables
load_dotenv()

# 2. Initialize Pinecone
print("Initializing Pinecone...")
pc = Pinecone(api_key=os.environ.get("PINECONE_API_KEY"))
index = pc.Index(host=os.environ.get("PINECONE_HOST"))

# 3. The Raw Legal Text
raw_judgment_text = """
1. This appeal is directed against the judgment and order dated 25th October 2018 passed by the High Court.
The primary issue revolves around the interpretation of Section 138 of the Negotiable Instruments Act, 1881.
2. The respondent had issued a cheque which was dishonoured due to insufficient funds. The appellant
issued a statutory notice within the prescribed period of 30 days.
3. The High Court quashed the proceedings on the ground of territorial jurisdiction, relying on the precedent
set in Dashrath Rupsingh Rathod v. State of Maharashtra (2014) 9 SCC 129.
4. However, the subsequent Negotiable Instruments (Amendment) Act, 2015, altered the jurisdictional framework,
which the High Court failed to consider. We set aside the High Court's order and restore the trial court proceedings.
"""

# 4. Chunking the Document
print("Chunking legal text...")
text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=300,
    chunk_overlap=50,
    length_function=len,
    is_separator_regex=False,
)
chunks = text_splitter.split_text(raw_judgment_text)
print(f"Created {len(chunks)} chunks.")

# 5. Preparing Text Records for Nvidia Integrated Embeddings
print("Shipping raw text directly to Pinecone (Nvidia GPUs will embed it automatically)...")
records = []

for i, chunk_text in enumerate(chunks):
    records.append({
        "_id": f"case_123_chunk_{i}",
        "text": chunk_text,
        "source_case": "Sample Appeal v. Respondent (2018)",
        "chunk_index": i
    })

# 6. Upserting Records (FIXED: Using explicit keyword arguments)
index.upsert_records(namespace="legal-cases", records=records)
print("✅ Success! Raw text sent to Pinecone, automatically embedded by Nvidia, and stored securely.")
