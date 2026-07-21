import os
import re
import sys
import html
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
FAILED_NORMALIZATION_LOG_PATH = "failed_normalization.log"

# Which adapter profile this run's DATA_DIR should be normalized through.
# Env-overridable so a future AWS S3 backfill job or IndianKanoon delta job
# can point the same pipeline at a different source without code changes —
# e.g. INGESTION_SOURCE_TYPE=aws_s3_ecourts python mass_ingestion.py.
SOURCE_TYPE = "aws_s3_ecourts"
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


_HTML_TAG_RE = re.compile(r"<[^>]+>")


class LegalDataDocument:
    """Uniform in-memory record every ingestion adapter normalizes into,
    regardless of source schema (OpenNyAI export, AWS S3 eCourts
    parquet/json backfill, IndianKanoon API delta). Everything downstream of
    IngestionAdapterFactory.normalize() — chunking, batching, case_vault
    persistence — consumes this shape exclusively, never a raw record dict."""
    __slots__ = ("document_id", "title", "text_content", "doc_type", "metadata")

    def __init__(self, document_id, title, text_content, doc_type="Judgment", metadata=None):
        self.document_id = document_id
        self.title = title
        self.text_content = text_content
        self.doc_type = doc_type
        self.metadata = metadata or {}


class IngestionAdapterFactory:
    """Maps a raw external record into a LegalDataDocument via a per-source
    mapping profile. normalize() never raises: a record it can't identify —
    wrong source_type, missing text, or a profile that blows up on
    unexpected shape — is logged to failed_normalization.log and skipped by
    returning None, so a single bad record from a heterogeneous cloud
    backfill can't take down the whole ingestion run."""

    SUPPORTED_SOURCE_TYPES = ("opennyai", "aws_s3_ecourts", "indian_kanoon")

    @classmethod
    def normalize(cls, record, source_type):
        if not isinstance(record, dict):
            cls._log_failed(record, source_type, "record is not a JSON object")
            return None

        profile_fn = getattr(cls, f"_profile_{source_type}", None)
        if profile_fn is None:
            cls._log_failed(record, source_type, f"unknown source_type '{source_type}'")
            return None

        try:
            document_id, title, text, doc_type, metadata = profile_fn(record)
        except Exception as e:
            cls._log_failed(record, source_type, f"profile mapping raised {type(e).__name__}: {e}")
            return None

        if not document_id or not title or not text:
            cls._log_failed(record, source_type, "missing document_id, title, or text_content after mapping")
            return None

        return LegalDataDocument(
            document_id=str(document_id).strip(),
            title=str(title).strip(),
            text_content=str(text).strip(),
            doc_type=doc_type,
            metadata=metadata,
        )

    # ── Profile A: OpenNyAI-style export ────────────────────────────────
    @staticmethod
    def _profile_opennyai(record):
        document_id = _first_present(record, "id", "case_id", "text_id")
        title = _first_present(record, "source_case", "title", "case_title", "name")
        text = _first_present(record, "content", "text", "judgement_text", "judgment_text")
        return document_id, title, text, "Judgment", {}

    # ── Profile B: AWS S3 eCourts bulk backfill (2025 dataset) ──────────
    @staticmethod
    def _profile_aws_s3_ecourts(record):
        document_id = _first_present(record, "nc_display", "path", "doc_id", "id")
        raw_html_content = _first_present(record, "raw_html", "document_blob", "raw_text", "text")
        text = IngestionAdapterFactory._clean_html(raw_html_content) if raw_html_content else None
        title = _first_present(record, "nc_display", "title", "case_title")
        metadata = {
            "citation_year": record.get("citation_year"),
            "nc_display": record.get("nc_display"),
            "scraped_at": record.get("scraped_at")
        }
        return document_id, title, text, "Judgment", metadata

    # ── Profile C: IndianKanoon API delta ───────────────────────────────
    @staticmethod
    def _profile_indian_kanoon(record):
        document_id = _first_present(record, "tid", "doc_id", "id")
        title = IngestionAdapterFactory._clean_html(_first_present(record, "title", "case_title"))
        text = IngestionAdapterFactory._clean_html(_first_present(record, "doc", "text", "content"))
        return document_id, title, text, "Judgment", {}

    @staticmethod
    def _clean_html(raw):
        if not raw:
            return raw
        no_tags = _HTML_TAG_RE.sub(" ", raw)
        unescaped = html.unescape(no_tags)
        return re.sub(r"\s+", " ", unescaped).strip()

    @staticmethod
    def _log_failed(record, source_type, reason):
        try:
            with open(FAILED_NORMALIZATION_LOG_PATH, "a", encoding="utf-8") as f:
                f.write(json.dumps({"source_type": source_type, "reason": reason, "record": record}, default=str) + "\n")
        except Exception:
            pass  # logging must never itself crash the pipeline
        print(f"⚠️ Normalization failed [{source_type}] — {reason}")


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


def iter_cases_from_file(filepath, source_type):
    """Yield LegalDataDocument objects out of a single JSON file, one record
    at a time through IngestionAdapterFactory.normalize(). Supports a file
    holding either a single record or a JSON list of records — of ANY of the
    three supported source shapes, since normalization happens per-record,
    not per-file. A record that fails to parse or normalize is logged and
    skipped rather than raising, so one bad record never aborts the file."""
    with open(filepath, "r", encoding="utf-8") as f:
        try:
            payload = json.load(f)
        except json.JSONDecodeError as e:
            print(f"⚠️ Skipping '{filepath}' — invalid JSON: {e}")
            return

    records = payload if isinstance(payload, list) else [payload]
    for record in records:
        doc = IngestionAdapterFactory.normalize(record, source_type)
        if doc is None:
            continue
        yield doc


def save_case_to_vault(cursor, case_id, title, content, doc_type="Judgment"):
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
        (case_id, title, doc_type, content),
    )
    return True


def process_file(filepath, db_conn, db_lock, source_type):
    """Runs in a worker thread: parse one file, normalize each record into a
    LegalDataDocument, persist it to case_vault, and chunk its text. Returns
    (chunks, cases_processed, vault_inserts) for the whole file — the unit of
    streaming granularity is one file, never the whole dataset, so memory
    stays bounded to (files in flight) x (chunks per file), not the full
    corpus. Everything past this point consumes LegalDataDocument fields
    exclusively — no raw dict/tuple ever reaches chunking or persistence."""
    chunks_out = []
    cases_processed = 0
    vault_inserts = 0

    for doc in iter_cases_from_file(filepath, source_type):
        cases_processed += 1

        # All case_vault writes are serialized through this lock — multiple
        # worker threads share one sqlite3 connection (check_same_thread=False),
        # and SQLite does not permit unsynchronized concurrent writes on a
        # single connection.
        with db_lock:
            cursor = db_conn.cursor()
            if save_case_to_vault(cursor, doc.document_id, doc.title, doc.text_content, doc.doc_type):
                db_conn.commit()
                vault_inserts += 1

        text_chunks = text_splitter.split_text(doc.text_content)
        for i, chunk_text in enumerate(text_chunks):
            chunks_out.append({
                "_id": f"{doc.document_id}_chunk_{i}",
                "text": chunk_text,
                "source_case": doc.title,
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
    """Upload one batch, bounding concurrency. Retries on 429 rate limits automatically."""
    async with net_sema:
        max_retries = 5
        for attempt in range(max_retries):
            try:
                status, text = await batch_upsert_to_pinecone(session, batch)
                if status == 429 and attempt < max_retries - 1:
                    await asyncio.sleep(4 * (attempt + 1))
                    continue

                stats["batches_sent"] += 1
                if not (200 <= status < 300):
                    stats["failures"] += 1
                    await log_failed_batch(batch, f"HTTP {status}: {text}", failed_log_lock)
                return
            except Exception as e:
                if attempt == max_retries - 1:
                    stats["batches_sent"] += 1
                    stats["failures"] += 1
                    await log_failed_batch(batch, str(e), failed_log_lock)
                else:
                    await asyncio.sleep(2)


async def produce_file(filepath, executor, batch_queue, db_conn, db_lock, file_sema, stats, pbar, source_type):
    """Parse+chunk one file in the thread pool, then hand its chunks to the
    upload queue one at a time. The `await batch_queue.put(...)` call is the
    actual backpressure point: once the queue is full (network can't keep up),
    this coroutine — and therefore this file's worker thread slot — blocks
    until the consumer drains it, which is what keeps memory bounded instead
    of ever materializing the full dataset's chunks at once."""
    async with file_sema:
        loop = asyncio.get_running_loop()
        chunks, cases_processed, vault_inserts = await loop.run_in_executor(
            executor, process_file, filepath, db_conn, db_lock, source_type
        )
        stats["total_cases"] += cases_processed
        stats["vault_inserts"] += vault_inserts
        for chunk in chunks:
            await batch_queue.put(chunk)
            stats["total_chunks"] += 1
        pbar.update(1)


async def run_producers(files, executor, batch_queue, db_conn, db_lock, file_sema, stats, pbar, source_type):
    tasks = [
        asyncio.create_task(produce_file(f, executor, batch_queue, db_conn, db_lock, file_sema, stats, pbar, source_type))
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
    if SOURCE_TYPE not in IngestionAdapterFactory.SUPPORTED_SOURCE_TYPES:
        raise ValueError(
            f"Unknown INGESTION_SOURCE_TYPE '{SOURCE_TYPE}' — must be one of "
            f"{IngestionAdapterFactory.SUPPORTED_SOURCE_TYPES}."
        )

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
                run_producers(files, executor, batch_queue, db_conn, db_lock, file_sema, stats, pbar, SOURCE_TYPE),
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
