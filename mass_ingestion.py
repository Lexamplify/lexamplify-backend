import os
import sys
import json
import glob
import time
import sqlite3
import requests
import dotenv
from tqdm import tqdm
from langchain_text_splitters import RecursiveCharacterTextSplitter

# Windows consoles default to cp1252, which can't encode characters like the
# status emoji below — force UTF-8 stdout so a long-running batch print never
# crashes partway through a real ingestion run.
sys.stdout.reconfigure(encoding="utf-8")

# 1. Load Environment Variables
dotenv.load_dotenv()

PINECONE_API_KEY = os.environ.get("PINECONE_API_KEY")
PINECONE_HOST = os.environ.get("PINECONE_HOST")

if not PINECONE_API_KEY:
    raise ValueError("Missing PINECONE_API_KEY in .env — aborting.")
if not PINECONE_HOST:
    raise ValueError("Missing PINECONE_HOST in .env — aborting.")

DATA_DIR = "data/cases"
DB_PATH = "lex_assistant.db"
UPSERT_URL = f"{PINECONE_HOST}/records/namespaces/legal-cases/upsert"
BATCH_SIZE = 50

# 2. Chunking configuration
text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=1200,
    chunk_overlap=200,
    length_function=len,
    is_separator_regex=False,
)


def batch_upsert_to_pinecone(chunks_batch):
    """POST one batch of flat {_id, text, source_case} records to Pinecone's
    Integrated Inference records endpoint. Pinecone embeds "text" server-side.
    Body must be newline-delimited JSON, not a JSON array — a wrapped
    {"records": [...]} body is silently rejected by this endpoint."""
    ndjson_data = "\n".join(json.dumps(chunk) for chunk in chunks_batch) + "\n"
    headers = {
        "Content-Type": "application/x-ndjson",
        "Api-Key": PINECONE_API_KEY,
    }
    response = requests.post(UPSERT_URL, headers=headers, data=ndjson_data.encode("utf-8"))
    return response


def _first_present(d, *keys):
    """Return the first non-empty value found under any of the candidate
    keys — production legal-text datasets (OpenNyAI and similar corpora)
    don't agree on field names, so we accept the common variants instead of
    hard-failing on a schema mismatch."""
    for key in keys:
        val = d.get(key)
        if val:
            return val
    return None


def iter_cases_from_directory(data_dir):
    """Stream case records out of every *.json file in data_dir, one case at
    a time. Supports a file holding either a single case object or a JSON
    list of case objects. Yields (case_id, title, text) tuples; malformed
    entries are skipped with a warning rather than aborting the whole run."""
    if not os.path.isdir(data_dir):
        raise FileNotFoundError(
            f"'{data_dir}' does not exist. Create it and add production JSON case "
            f"files (each case needs an id, a title, and the full judgment text)."
        )

    files = sorted(glob.glob(os.path.join(data_dir, "*.json")))
    if not files:
        raise FileNotFoundError(
            f"No .json files found in '{data_dir}'. Add production case files before running."
        )

    for filepath in files:
        with open(filepath, "r", encoding="utf-8") as f:
            try:
                payload = json.load(f)
            except json.JSONDecodeError as e:
                print(f"⚠️ Skipping '{filepath}' — invalid JSON: {e}")
                continue

        records = payload if isinstance(payload, list) else [payload]
        for record in records:
            if not isinstance(record, dict):
                print(f"⚠️ Skipping malformed entry in '{filepath}' — not an object.")
                continue

            case_id = _first_present(record, "id", "case_id", "text_id")
            title = _first_present(record, "title", "case_title", "name", "source_case")
            text = _first_present(record, "text", "content", "judgement_text", "judgment_text")

            if not case_id or not title or not text:
                print(f"⚠️ Skipping entry in '{filepath}' — missing id, title, or text.")
                continue

            yield str(case_id), str(title), str(text)


def save_case_to_vault(cursor, case_id, title, content):
    """Persist the full, unchunked judgment into the case_vault table for
    relational full-text lookup. case_vault has no UNIQUE constraint on
    case_id, so re-running the pipeline on the same dataset would otherwise
    duplicate rows — guard with an existence check instead."""
    cursor.execute("SELECT 1 FROM case_vault WHERE case_id = ? LIMIT 1", (case_id,))
    if cursor.fetchone() is not None:
        return False
    cursor.execute(
        "INSERT INTO case_vault (case_id, title, doc_type, content) VALUES (?, ?, ?, ?)",
        (case_id, title, "Judgment", content),
    )
    return True


def main():
    db_conn = sqlite3.connect(DB_PATH)
    db_cursor = db_conn.cursor()

    total_cases = 0
    total_chunks = 0
    vault_inserts = 0
    batches_sent = 0
    failures = 0
    batch_buffer = []

    def flush_batch():
        nonlocal batches_sent, failures
        if not batch_buffer:
            return
        batch = batch_buffer[:BATCH_SIZE]
        del batch_buffer[:BATCH_SIZE]
        response = batch_upsert_to_pinecone(batch)
        batches_sent += 1
        if 200 <= response.status_code < 300:
            time.sleep(1)  # gentle pacing to stay under API rate limit thresholds
        else:
            failures += 1
            tqdm.write(f"❌ Batch failed — status {response.status_code}: {response.text}")

    try:
        # Streaming loop: one case in memory at a time, never a global
        # pool of every chunk from every file.
        for case_id, title, text in tqdm(iter_cases_from_directory(DATA_DIR), desc="Processing cases", unit="case"):
            total_cases += 1

            if save_case_to_vault(db_cursor, case_id, title, text):
                vault_inserts += 1
                db_conn.commit()

            text_chunks = text_splitter.split_text(text)
            for i, chunk_text in enumerate(text_chunks):
                batch_buffer.append({
                    "_id": f"{case_id}_chunk_{i}",
                    "text": chunk_text,
                    "source_case": title,
                })
                total_chunks += 1

            while len(batch_buffer) >= BATCH_SIZE:
                flush_batch()

        # Final partial batch, if any chunks are left over.
        while batch_buffer:
            flush_batch()
    finally:
        db_conn.close()

    print(f"Processed {total_cases} cases into {total_chunks} chunks across {batches_sent} batches.")
    print(f"case_vault: {vault_inserts} new records inserted ({total_cases - vault_inserts} already present, skipped).")

    if failures == 0:
        print(f"✅ Success! {total_chunks} records seeded into 'legal-cases'.")
    else:
        print(f"⚠️ Completed with {failures}/{batches_sent} batch failures — see errors above.")
        sys.exit(1)


if __name__ == "__main__":
    main()
