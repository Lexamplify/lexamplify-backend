import os
import sys
import json
import glob
import time
import sqlite3
import asyncio
import threading
import dotenv
import aiohttp
from concurrent.futures import ThreadPoolExecutor
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
FAILED_LOG_PATH = "failed_batches.log"

# Parsing/chunking workers (CPU-bound, thread pool) and network concurrency
# (I/O-bound, asyncio semaphore) are sized independently on purpose — file
# parsing is cheap and CPU-light, uploads are the actual rate-limited resource.
MAX_PARSE_WORKERS = min(8, os.cpu_count() or 4)
MAX_CONCURRENT_UPLOADS = 10
QUEUE_MAXSIZE = 100  # producer backpressure: pauses parsing once the network can't keep up

# 2. Chunking configuration
text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=1200,
    chunk_overlap=200,
    length_function=len,
    is_separator_regex=False,
)


async def batch_upsert_to_pinecone(session, chunks_batch):
    """POST one batch of flat {_id, text, source_case} records to Pinecone's
    Integrated Inference records endpoint. Pinecone embeds "text" server-side.
    Body must be newline-delimited JSON, not a JSON array — a wrapped
    {"records": [...]} body is silently rejected by this endpoint."""
    ndjson_data = "\n".join(json.dumps(chunk) for chunk in chunks_batch) + "\n"
    headers = {
        "Content-Type": "application/x-ndjson",
        "Api-Key": PINECONE_API_KEY,
    }
    async with session.post(UPSERT_URL, headers=headers, data=ndjson_data.encode("utf-8")) as response:
        status = response.status
        text = await response.text()
        return status, text


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


def list_case_files(data_dir):
    """Glob every *.json file in data_dir. Raises with operator guidance if
    the directory or any matching files are missing."""
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
    return files


def iter_cases_from_file(filepath):
    """Yield (case_id, title, text) tuples out of a single JSON file. Supports
    a file holding either a single case object or a JSON list of case objects.
    Malformed entries are skipped with a warning rather than raising."""
    with open(filepath, "r", encoding="utf-8") as f:
        try:
            payload = json.load(f)
        except json.JSONDecodeError as e:
            print(f"⚠️ Skipping '{filepath}' — invalid JSON: {e}")
            return

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
    duplicate rows — guard with an existence check instead.
    Caller MUST hold db_lock — this function is not safe to call concurrently
    on the same connection without it."""
    cursor.execute("SELECT 1 FROM case_vault WHERE case_id = ? LIMIT 1", (case_id,))
    if cursor.fetchone() is not None:
        return False
    cursor.execute(
        "INSERT INTO case_vault (case_id, title, doc_type, content) VALUES (?, ?, ?, ?)",
        (case_id, title, "Judgment", content),
    )
    return True


def process_file(filepath, db_conn, db_lock):
    """Runs in a worker thread: parse one file, persist each case to
    case_vault, and chunk each case's text. Returns (chunks, cases_processed,
    vault_inserts) for the whole file — the unit of streaming granularity is
    one file, never the whole dataset, so memory stays bounded to
    (files in flight) x (chunks per file), not the full corpus."""
    chunks_out = []
    cases_processed = 0
    vault_inserts = 0

    for case_id, title, text in iter_cases_from_file(filepath):
        cases_processed += 1

        # All case_vault writes are serialized through this lock — multiple
        # worker threads share one sqlite3 connection (check_same_thread=False),
        # and SQLite does not permit unsynchronized concurrent writes on a
        # single connection.
        with db_lock:
            cursor = db_conn.cursor()
            if save_case_to_vault(cursor, case_id, title, text):
                db_conn.commit()
                vault_inserts += 1

        text_chunks = text_splitter.split_text(text)
        for i, chunk_text in enumerate(text_chunks):
            chunks_out.append({
                "_id": f"{case_id}_chunk_{i}",
                "text": chunk_text,
                "source_case": title,
            })

    return chunks_out, cases_processed, vault_inserts


async def log_failed_batch(batch, error_msg, failed_log_lock):
    """Append a failed batch's raw payload to failed_batches.log so it can be
    inspected or replayed later, without aborting the run."""
    async with failed_log_lock:
        with open(FAILED_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps({"error": error_msg, "records": batch}) + "\n")
    tqdm.write(f"❌ Batch failed — {error_msg}")


async def upload_batch(batch, session, net_sema, stats, failed_log_lock):
    """Upload one batch, bounded to MAX_CONCURRENT_UPLOADS in flight at once.
    Never raises — failures are logged and counted so the rest of the queue
    keeps draining."""
    async with net_sema:
        try:
            status, text = await batch_upsert_to_pinecone(session, batch)
            stats["batches_sent"] += 1
            if not (200 <= status < 300):
                stats["failures"] += 1
                await log_failed_batch(batch, f"HTTP {status}: {text}", failed_log_lock)
        except Exception as e:
            stats["batches_sent"] += 1
            stats["failures"] += 1
            await log_failed_batch(batch, str(e), failed_log_lock)


async def produce_file(filepath, executor, batch_queue, db_conn, db_lock, file_sema, stats, pbar):
    """Parse+chunk one file in the thread pool, then hand its chunks to the
    upload queue one at a time. The `await batch_queue.put(...)` call is the
    actual backpressure point: once the queue is full (network can't keep up),
    this coroutine — and therefore this file's worker thread slot — blocks
    until the consumer drains it, which is what keeps memory bounded instead
    of ever materializing the full dataset's chunks at once."""
    async with file_sema:
        loop = asyncio.get_running_loop()
        chunks, cases_processed, vault_inserts = await loop.run_in_executor(
            executor, process_file, filepath, db_conn, db_lock
        )
        stats["total_cases"] += cases_processed
        stats["vault_inserts"] += vault_inserts
        for chunk in chunks:
            await batch_queue.put(chunk)
            stats["total_chunks"] += 1
        pbar.update(1)


async def run_producers(files, executor, batch_queue, db_conn, db_lock, file_sema, stats, pbar):
    tasks = [
        asyncio.create_task(produce_file(f, executor, batch_queue, db_conn, db_lock, file_sema, stats, pbar))
        for f in files
    ]
    await asyncio.gather(*tasks)
    await batch_queue.put(None)  # single sentinel, only after every file is fully drained into the queue


async def consume_batches(batch_queue, session, net_sema, stats, failed_log_lock):
    buffer = []
    upload_tasks = []
    while True:
        item = await batch_queue.get()
        if item is None:
            break
        buffer.append(item)
        if len(buffer) >= BATCH_SIZE:
            batch, buffer = buffer[:BATCH_SIZE], buffer[BATCH_SIZE:]
            upload_tasks.append(asyncio.create_task(upload_batch(batch, session, net_sema, stats, failed_log_lock)))

    if buffer:  # final partial batch, if any chunks are left over
        upload_tasks.append(asyncio.create_task(upload_batch(buffer, session, net_sema, stats, failed_log_lock)))

    if upload_tasks:
        await asyncio.gather(*upload_tasks)


async def main_async():
    files = list_case_files(DATA_DIR)

    db_conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    db_conn.execute("PRAGMA journal_mode=WAL;")
    db_conn.execute("PRAGMA synchronous=NORMAL;")
    db_lock = threading.Lock()

    stats = {"total_cases": 0, "total_chunks": 0, "vault_inserts": 0, "batches_sent": 0, "failures": 0}
    failed_log_lock = asyncio.Lock()
    batch_queue = asyncio.Queue(maxsize=QUEUE_MAXSIZE)
    net_sema = asyncio.Semaphore(MAX_CONCURRENT_UPLOADS)
    file_sema = asyncio.Semaphore(MAX_PARSE_WORKERS)

    executor = ThreadPoolExecutor(max_workers=MAX_PARSE_WORKERS)
    pbar = tqdm(total=len(files), desc="Files processed", unit="file")

    try:
        async with aiohttp.ClientSession() as session:
            await asyncio.gather(
                run_producers(files, executor, batch_queue, db_conn, db_lock, file_sema, stats, pbar),
                consume_batches(batch_queue, session, net_sema, stats, failed_log_lock),
            )
    finally:
        pbar.close()
        executor.shutdown(wait=True)
        db_conn.close()

    print(f"Processed {stats['total_cases']} cases into {stats['total_chunks']} chunks across {stats['batches_sent']} batches.")
    print(f"case_vault: {stats['vault_inserts']} new records inserted ({stats['total_cases'] - stats['vault_inserts']} already present, skipped).")

    # Explicit non-empty assertion — a 0/0 run would otherwise "succeed" vacuously.
    assert stats["total_chunks"] > 0, f"No records were processed from '{DATA_DIR}' — check it contains valid case files."

    if stats["failures"] == 0:
        print(f"✅ Success! {stats['total_chunks']} records seeded into 'legal-cases'.")
    else:
        print(f"⚠️ Completed with {stats['failures']}/{stats['batches_sent']} batch failures — see {FAILED_LOG_PATH}.")
        sys.exit(1)


def main():
    asyncio.run(main_async())


if __name__ == "__main__":
    main()
