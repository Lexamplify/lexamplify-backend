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

try:
    import fitz  # PyMuPDF — optional: enables full judgment-text extraction
    # from source PDFs. If it isn't installed, PDF extraction is simply
    # skipped and every record falls back to its raw_html/JSON text instead
    # of the whole pipeline crashing on import.
except ImportError:
    fitz = None

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
BATCH_SIZE = 15  # ~4,500 tokens/batch under the 250K TPM ceiling
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
MAX_CONCURRENT_UPLOADS = 1  # single-stream uploads — no overlapping request slots to spike TPM
QUEUE_MAXSIZE = 20  # tighter producer backpressure so PDF parsing threads can't outrun the throttled uploader

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
    def normalize(cls, record, source_type, filepath=None):
        if not isinstance(record, dict):
            cls._log_failed(record, source_type, "record is not a JSON object")
            return None

        profile_fn = getattr(cls, f"_profile_{source_type}", None)
        if profile_fn is None:
            cls._log_failed(record, source_type, f"unknown source_type '{source_type}'")
            return None

        try:
            document_id, title, text, doc_type, metadata = profile_fn(record, filepath=filepath)
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
    def _profile_opennyai(record, filepath=None):
        document_id = _first_present(record, "id", "case_id", "text_id")
        title = _first_present(record, "source_case", "title", "case_title", "name")
        text = _first_present(record, "content", "text", "judgement_text", "judgment_text")
        return document_id, title, text, "Judgment", {}

    # ── Profile B: AWS S3 eCourts bulk backfill (2025 dataset) ──────────
    @staticmethod
    def _profile_aws_s3_ecourts(record, filepath=None):
        document_id = _first_present(record, "nc_display", "path", "doc_id", "id")
        title = _first_present(record, "nc_display", "title", "case_title")

        # The 2025 dataset sometimes splits headnote/judgment content across
        # multiple keys instead of one authoritative field — concatenate
        # every text-bearing key present (fixed order, duplicates-tolerant)
        # so the combined text is the longest/most complete version
        # available, instead of trusting a single key and silently dropping
        # whatever content lives in the others. Used as the fallback below
        # whenever no usable PDF is found.
        text_keys = ("judgment_text", "raw_html", "document_blob", "content", "raw_text")
        raw_fragments = [record[k] for k in text_keys if record.get(k)]
        raw_html_content = "\n\n".join(raw_fragments) if raw_fragments else None

        # Bulletproof PDF path resolution — the real 20-50 page judgment
        # lives in a companion PDF next to the source JSON, but the filename
        # suffix isn't 100% consistent across the dataset. Strip a
        # pre-existing "_EN" from the base first so appending "_EN.pdf"
        # can't double up into "..._EN_EN.pdf", then try the "_EN.pdf"
        # convention (confirmed for the 2025 batch) before falling back to
        # a plain ".pdf" (older/differently-sourced batches).
        text = None
        if filepath and fitz:
            try:
                base_name = os.path.splitext(filepath)[0]
                if base_name.endswith("_EN"):
                    base_name = base_name[:-3]

                pdf_path_en = base_name + "_EN.pdf"
                pdf_path_std = base_name + ".pdf"

                actual_pdf_path = None
                if os.path.exists(pdf_path_en):
                    actual_pdf_path = pdf_path_en
                elif os.path.exists(pdf_path_std):
                    actual_pdf_path = pdf_path_std

                if actual_pdf_path:
                    pdf_text_parts = []
                    with fitz.open(actual_pdf_path) as doc:
                        for page in doc:
                            page_text = page.get_text("text")
                            if page_text and page_text.strip():
                                pdf_text_parts.append(page_text.strip())
                    pdf_text = "\n\n".join(pdf_text_parts)
                    if len(pdf_text) >= 1000:
                        text = pdf_text
                else:
                    # tqdm.write (not print) — a bare print() here would
                    # corrupt the multi-threaded progress bar's in-place
                    # redraw; only fires when the PDF is genuinely missing,
                    # not on every record, to avoid log flooding.
                    tqdm.write(f"⚠️ DEBUG: PDF missing for base '{base_name}'")
            except Exception as e:
                tqdm.write(f"⚠️ DEBUG: PDF extraction failed for '{filepath}': {e}")

        # Graceful fallback: PDF missing, too short, or errored out ->
        # clean and use whatever raw_html/judgment_text was gathered above.
        if text is None:
            text = IngestionAdapterFactory._clean_html(raw_html_content) if raw_html_content else None

        metadata = {
            "citation_year": record.get("citation_year"),
            "nc_display": record.get("nc_display"),
            "scraped_at": record.get("scraped_at")
        }
        return document_id, title, text, "Judgment", metadata

    # ── Profile C: IndianKanoon API delta ───────────────────────────────
    @staticmethod
    def _profile_indian_kanoon(record, filepath=None):
        document_id = _first_present(record, "tid", "doc_id", "id")
        title = IngestionAdapterFactory._clean_html(_first_present(record, "title", "case_title"))
        text = IngestionAdapterFactory._clean_html(_first_present(record, "doc", "text", "content"))
        return document_id, title, text, "Judgment", {}

    @staticmethod
    def _clean_html(raw):
        if not raw:
            return raw
        # Convert structural line/paragraph boundaries into real newlines
        # BEFORE stripping tags, so legal formatting (paragraph breaks
        # between recitals, numbered clauses, etc.) survives instead of the
        # whole judgment collapsing into one run-on line of prose.
        with_breaks = re.sub(r"(?i)<br\s*/?>|</p>|</div>", "\n", raw)
        no_tags = _HTML_TAG_RE.sub(" ", with_breaks)
        unescaped = html.unescape(no_tags)
        # Collapse horizontal whitespace (spaces/tabs, plus \xa0 — the
        # non-breaking space html.unescape() produces from &nbsp;, which
        # \t and a literal " " don't match) without touching the newlines
        # just inserted, then collapse runs of 3+ blank lines down to a
        # single paragraph break. A plain \s+ collapse here would swallow
        # every \n right back into a single space, undoing the step above
        # entirely.
        collapsed_spaces = re.sub(r"[ \t\xa0]+", " ", unescaped)
        collapsed_blank_lines = re.sub(r"\n[ \t]*(?:\n[ \t]*)+", "\n\n", collapsed_spaces)
        lines = [line.strip() for line in collapsed_blank_lines.split("\n")]
        return "\n".join(lines).strip()

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
        doc = IngestionAdapterFactory.normalize(record, source_type, filepath=filepath)
        if doc is None:
            continue
        yield doc


FORCE_UPDATE_MIN_CHAR_DELTA = 2000  # new content must be at least this much longer to trigger a force-update


def save_case_to_vault(cursor, case_id, title, content, doc_type="Judgment"):
    """Persist the full, unchunked judgment into the case_vault table for
    relational full-text lookup. case_vault has no UNIQUE constraint on
    case_id, so re-running the pipeline on the same dataset would otherwise
    duplicate rows — guard with an existence check instead.

    Returns one of three states, not a bool — callers MUST branch on this to
    keep SQLite and Pinecone in sync:
      "inserted" — brand new case_id, row created.
      "updated"  — case_id already existed but the new content is
                   significantly longer (> FORCE_UPDATE_MIN_CHAR_DELTA chars)
                   than what's stored, e.g. a short headnote being replaced
                   by the full judgment text — the stale row is overwritten.
      "skipped"  — case_id already existed and the new content isn't
                   meaningfully longer — left untouched. The caller MUST also
                   skip re-chunking/re-upserting to Pinecone in this case, or
                   the vector index would get redundant chunks that don't
                   correspond to any real change in case_vault.

    Caller MUST hold db_lock — this function is not safe to call concurrently
    on the same connection without it."""
    row = cursor.execute("SELECT content FROM case_vault WHERE case_id = ? LIMIT 1", (case_id,)).fetchone()

    if row is None:
        cursor.execute(
            "INSERT INTO case_vault (case_id, title, doc_type, content) VALUES (?, ?, ?, ?)",
            (case_id, title, doc_type, content),
        )
        return "inserted"

    existing_content = row[0] or ""
    if len(content) > len(existing_content) + FORCE_UPDATE_MIN_CHAR_DELTA:
        cursor.execute(
            "UPDATE case_vault SET content = ?, title = ? WHERE case_id = ?",
            (content, title, case_id),
        )
        return "updated"

    return "skipped"


def process_file(filepath, db_conn, db_lock, source_type):
    """Runs in a worker thread: parse one file, normalize each record into a
    LegalDataDocument, persist it to case_vault, and chunk its text. Returns
    (chunks, cases_processed, vault_inserts, vault_updates) for the whole
    file — the unit of streaming granularity is one file, never the whole
    dataset, so memory stays bounded to (files in flight) x (chunks per
    file), not the full corpus. Everything past this point consumes
    LegalDataDocument fields exclusively — no raw dict/tuple ever reaches
    chunking or persistence."""
    chunks_out = []
    cases_processed = 0
    vault_inserts = 0
    vault_updates = 0

    for doc in iter_cases_from_file(filepath, source_type):
        cases_processed += 1

        # All case_vault writes are serialized through this lock — multiple
        # worker threads share one sqlite3 connection (check_same_thread=False),
        # and SQLite does not permit unsynchronized concurrent writes on a
        # single connection.
        with db_lock:
            cursor = db_conn.cursor()
            write_result = save_case_to_vault(cursor, doc.document_id, doc.title, doc.text_content, doc.doc_type)
            if write_result != "skipped":
                db_conn.commit()
                if write_result == "inserted":
                    vault_inserts += 1
                else:
                    vault_updates += 1

        # CRITICAL: a "skipped" SQLite write must skip Pinecone too — chunking
        # and pushing vectors for content that was never actually written
        # would desynchronize the vector index from case_vault (stale-but-
        # accepted short text sitting in SQLite while newer chunks silently
        # replace it in Pinecone, or vice versa on a partial re-run).
        if write_result != "skipped":
            text_chunks = text_splitter.split_text(doc.text_content)
            for i, chunk_text in enumerate(text_chunks):
                chunks_out.append({
                    "_id": f"{doc.document_id}_chunk_{i}",
                    "text": chunk_text,
                    "source_case": doc.title,
                })

    return chunks_out, cases_processed, vault_inserts, vault_updates


async def log_failed_batch(batch, error_msg, failed_log_lock):
    """Append a failed batch's raw payload to failed_batches.log so it can be
    inspected or replayed later, without aborting the run."""
    async with failed_log_lock:
        with open(FAILED_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps({"error": error_msg, "records": batch}) + "\n")
    tqdm.write(f"❌ Batch failed — {error_msg}")


async def upload_batch(batch, session, net_sema, stats, failed_log_lock):
    """Upload one batch, bounding concurrency to MAX_CONCURRENT_UPLOADS
    (single-stream). Retries 429s with reset-window backoff long enough for
    Pinecone's 1-minute rolling TPM window to actually clear, and paces every
    successful upload to hold sustained throughput to ~150-180K TPM (70% of
    the 250K ceiling, a 30% buffer for denser-than-average text)."""
    async with net_sema:
        max_retries = 5
        for attempt in range(max_retries):
            try:
                status, text = await batch_upsert_to_pinecone(session, batch)
                if status == 429 and attempt < max_retries - 1:
                    # Reset-window backoff: 35s on the 1st retry clears over
                    # half of the 1-minute rolling window before trying
                    # again, rather than a short backoff that just re-hits
                    # a still-exhausted quota. Retries here never touch
                    # stats — only a final success or exhausted-retries
                    # failure counts, so a batch that eventually succeeds
                    # is never double-counted as a failure along the way.
                    await asyncio.sleep(35 * (attempt + 1))
                    continue

                stats["batches_sent"] += 1
                if 200 <= status < 300:
                    # Inter-batch pacing on every successful upload — this is
                    # the primary throttle keeping sustained throughput under
                    # the TPM ceiling, not just the 429 backoff.
                    await asyncio.sleep(1.5)
                else:
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
        chunks, cases_processed, vault_inserts, vault_updates = await loop.run_in_executor(
            executor, process_file, filepath, db_conn, db_lock, source_type
        )
        stats["total_cases"] += cases_processed
        stats["vault_inserts"] += vault_inserts
        stats["vault_updates"] += vault_updates
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

    stats = {"total_cases": 0, "total_chunks": 0, "vault_inserts": 0, "vault_updates": 0, "batches_sent": 0, "failures": 0}
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

    skipped = stats["total_cases"] - stats["vault_inserts"] - stats["vault_updates"]
    print(f"Processed {stats['total_cases']} cases into {stats['total_chunks']} chunks across {stats['batches_sent']} batches.")
    print(f"case_vault: {stats['vault_inserts']} new records inserted, {stats['vault_updates']} force-updated "
          f"(replaced shorter stored content), {skipped} unchanged and skipped.")

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
