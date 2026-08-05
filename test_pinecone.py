import os
from dotenv import load_dotenv
from pinecone import Pinecone

load_dotenv()

try:
    pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
    index = pc.Index(host=os.getenv("PINECONE_HOST"))
    stats = index.describe_index_stats()
    print("SUCCESS! Pinecone Connected. Vector Stats:", stats)
except Exception as e:
    print("EXACT PINECONE FAILURE:", e)