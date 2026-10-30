import os
import sys
import requests
from dotenv import load_dotenv

# Windows consoles default to cp1252, which can't encode the emoji below —
# force UTF-8 stdout so the status prints don't crash after a successful upsert.
sys.stdout.reconfigure(encoding="utf-8")

# 1. Load Environment Variables
load_dotenv()

PINECONE_API_KEY = os.environ.get("PINECONE_API_KEY")
PINECONE_HOST = os.environ.get("PINECONE_HOST")

if not PINECONE_API_KEY or not PINECONE_HOST:
    print("Missing PINECONE_API_KEY or PINECONE_HOST in .env — aborting.")
    sys.exit(1)

# 2. The Golden Dataset — landmark Section 138 cheque bounce precedents
records = [
    {
        "_id": "case_138_dashrath",
        "text": "In Dashrath Rupsingh Rathod v. State of Maharashtra (2014) 9 SCC 129, the Supreme Court of India clarified the territorial jurisdiction for filing a cheque bounce case under Section 138 of the Negotiable Instruments Act. The penalty for a bounced cheque due to insufficient funds includes imprisonment for a term which may extend to two years, or with fine which may extend to twice the amount of the cheque, or with both.",
        "source_case": "Dashrath Rupsingh Rathod v. State of Maharashtra",
    },
    {
        "_id": "case_138_bridgestone",
        "text": "In Bridgestone India Pvt. Ltd. v. Inderpal Singh (2016), the Supreme Court applied the Negotiable Instruments (Amendment) Act, 2015. It allowed the payee to file the Section 138 cheque bounce complaint at the place where they hold their bank account, providing relief to the complainant. The penalties of up to two years imprisonment and fines up to twice the cheque amount remain actively enforced.",
        "source_case": "Bridgestone India Pvt. Ltd. v. Inderpal Singh",
    },
]

# 3. Upsert directly via Pinecone's Integrated Inference REST endpoint —
# Pinecone embeds the "text" field server-side, so no local embedding model
# or OpenAI call is needed here.
#
# The records-upsert endpoint expects newline-delimited JSON (one record
# object per line, no wrapping array/key) — a plain {"records": [...]} body
# is rejected with "Missing or invalid field: _id" even when _id is present,
# because the parser is reading each line as its own record.
import json

ndjson_body = "\n".join(json.dumps(r) for r in records)

url = f"{PINECONE_HOST}/records/namespaces/legal-cases/upsert"
headers = {
    "Api-Key": PINECONE_API_KEY,
    "Content-Type": "application/x-ndjson",
    "X-Pinecone-API-Version": "2025-04",
}

print(f"Upserting {len(records)} records into 'legal-cases' namespace...")
response = requests.post(url, headers=headers, data=ndjson_body.encode("utf-8"))

print(f"Status Code: {response.status_code}")
print(f"Response Body: {response.text}")

if 200 <= response.status_code < 300:
    print("✅ Success! Golden Dataset seeded into Pinecone 'legal-cases' namespace.")
else:
    print("❌ Upsert failed — check the status code and response body above.")
    sys.exit(1)
