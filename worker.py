import os
import sys
import tempfile
import tarfile
import hashlib
import logging
import fitz  # PyMuPDF
import boto3
import time
import threading
import concurrent.futures
from tenacity import retry, retry_if_exception, wait_exponential, stop_after_attempt
from botocore import UNSIGNED
from botocore.config import Config
from pinecone import Pinecone
from pinecone.errors.exceptions import (
    PineconeApiException,
    PineconeTimeoutError,
    PineconeConnectionError,
)
from dotenv import load_dotenv

# Windows consoles default to cp1252, which can't encode the emoji used in
# the status prints below — force UTF-8 so a long-running ingestion job
# never crashes partway through on the first print.
sys.stdout.reconfigure(encoding="utf-8")

load_dotenv()

# --- 1. SAFEGUARDS & LOGGING ---
# encoding="utf-8" explicitly — without it, Python defaults to the platform
# encoding (cp1252 on Windows), which would crash this exact log write the
# moment a case_id or error message contains a character outside cp1252.
logging.basicConfig(
    filename='failed_documents.log',
    level=logging.ERROR,
    format='%(asctime)s - %(levelname)s - %(message)s',
    encoding='utf-8',
)

aws_config = Config(
    signature_version=UNSIGNED,
    retries={'max_attempts': 10, 'mode': 'adaptive'},
    tcp_keepalive=True
)
s3_client = boto3.client('s3', config=aws_config)
PINECONE_API_KEY = os.getenv("PINECONE_API_KEY")
PINECONE_NAMESPACE = os.getenv("PINECONE_NAMESPACE", "legal-cases")

pc = Pinecone(api_key=PINECONE_API_KEY)
index = pc.Index("lexamplify-micro")

BUCKET_NAME = "indian-supreme-court-judgments"
TARGET_YEAR = int(os.getenv("TARGET_YEAR", "2026"))
TAR_KEY = f"data/tar/year={TARGET_YEAR}/english/english.tar"
BATCH_SIZE = 100
CHUNK_SIZE = 1000  # characters (~250 words)
CHUNK_OVERLAP = 150
EMBED_MODEL = "llama-text-embed-v2"
BATCH_PACING_DELAY = 0.5  # seconds — proactive throttle after each upsert cycle
MAX_API_BATCH = 80  # Pinecone's embed endpoint caps inputs at 96 per call — stay under it
EMBED_SUB_BATCH_PACING_DELAY = 0.2  # seconds — throttle between sub-batch calls, prevents RPS micro-bursting
UPSERT_BATCH_SIZE = 50  # Pinecone's upsert endpoint caps request bodies at 2MB — cap vectors per call
UPSERT_SUB_BATCH_PACING_DELAY = 0.1  # seconds — throttle between upsert sub-batch calls
PROCESSED_LOG_PATH = "processed_documents.txt"
PDF_EXTRACTION_WORKERS = 4  # threads for CPU-bound PyMuPDF parsing + chunking only
PDF_EXTRACTION_BATCH_SIZE = 50  # cap in-flight raw PDF byte buffers held in memory at once

# Guards processed_documents.txt writes and the in-memory checkpoint set.
# Currently _append_processed_documents is only ever called from the main
# thread (embedding/upsert stay fully serialized — see ingest_extracted_document
# in stream_and_process), so this isn't protecting against a live race today;
# it's a deliberate defensive boundary so that invariant can change later
# without silently reintroducing a corrupt-checkpoint-file risk.
file_lock = threading.Lock()

# --- 2. ISOLATED RATE-LIMIT RETRIES ---
# Retries fire SPECIFICALLY on HTTP 429 (rate limit) or a transient network
# drop — never on 400 Bad Request, dimension mismatches, or bad API keys
# (401/403), which are permanent errors no amount of retrying will fix.
# reraise=True so the ORIGINAL exception (with real status_code/message)
# propagates after exhausting attempts, instead of tenacity's generic
# RetryError — that's what makes the failed_documents.log entry useful.
#
# A 429 is ambiguous: it means either a transient per-minute rate limit
# (worth retrying) OR a hard monthly quota exhaustion (retrying is pure
# waste — up to 7 minutes of exponential backoff PER DOCUMENT, for the rest
# of a potentially thousands-of-documents run, since the quota will not
# reset mid-run). Detect the latter from the error message and kill the
# whole process immediately via SystemExit — a BaseException, not an
# Exception, so it deliberately bypasses every "log and skip this document"
# except Exception block elsewhere in this file (flush_batch, the per-
# document try/excepts in stream_and_process) instead of being silently
# absorbed as just another failed document.
def _is_retryable_pinecone_error(exc: BaseException) -> bool:
    if isinstance(exc, PineconeApiException):
        if exc.status_code == 429:
            message = str(exc)
            if "current month" in message or "token limit" in message:
                raise SystemExit(f"Fatal Quota Error: {exc}")
            return True
        return False
    return isinstance(exc, (PineconeTimeoutError, PineconeConnectionError))


_RATE_LIMIT_RETRY = dict(
    retry=retry_if_exception(_is_retryable_pinecone_error),
    wait=wait_exponential(multiplier=2, min=10, max=60),
    stop=stop_after_attempt(7),
    reraise=True,
)


@retry(**_RATE_LIMIT_RETRY)
def _safe_upsert_single_call(sub_batch):
    index.upsert(vectors=sub_batch, namespace=PINECONE_NAMESPACE)


def safe_pinecone_upsert(vector_batch):
    """Sub-batching controller for upserts — a document-boundary-aligned
    vector_batch can grow well past UPSERT_BATCH_SIZE (a single large
    document's chunks are never split across flush calls), and Pinecone
    rejects any single upsert request body over 2MB. Deliberately NOT
    @retry-decorated itself — _safe_upsert_single_call already retries each
    sub-batch independently, so wrapping this too would re-send already-
    succeeded sub-batches on a later sub-batch's failure."""
    for i in range(0, len(vector_batch), UPSERT_BATCH_SIZE):
        sub_batch = vector_batch[i:i + UPSERT_BATCH_SIZE]
        _safe_upsert_single_call(sub_batch)
        time.sleep(UPSERT_SUB_BATCH_PACING_DELAY)


@retry(**_RATE_LIMIT_RETRY)
def _safe_embed_api_call(texts: list[str]):
    """One embedding-API call for a list of chunks, not one call per
    chunk — this is both the throughput fix (fewer round trips) and what
    makes the 250K TPM budget tractable to reason about per call. Never
    call this directly with more than MAX_API_BATCH texts — Pinecone's
    embed endpoint caps inputs at 96 per call and raises 400 INVALID_ARGUMENT
    above that; generate_embeddings_batch below is what enforces the cap."""
    response = pc.inference.embed(
        model=EMBED_MODEL,
        inputs=texts,
        parameters={"input_type": "passage", "truncate": "END"},
    )
    return [item.values for item in response]


def generate_embeddings_batch(texts: list[str]):
    """Sub-batching controller — the public entry point every caller should
    use instead of _safe_embed_api_call directly. Splits texts into blocks
    of MAX_API_BATCH (90, safely under Pinecone's 96-input ceiling) so a
    massive document (200+ chunks) is automatically issued as multiple safe
    calls (e.g. 90, 90, 20) instead of one oversized call that 400s.
    Deliberately NOT @retry-decorated itself — each sub-batch already
    retries independently via _safe_embed_api_call, so wrapping this too
    would retry the whole multi-call sequence (including already-succeeded
    sub-batches) on a failure partway through."""
    master_embeddings = []
    for i in range(0, len(texts), MAX_API_BATCH):
        sub_batch = texts[i:i + MAX_API_BATCH]
        master_embeddings.extend(_safe_embed_api_call(sub_batch))
        # Pacing between sub-batch calls — without this, a single massive
        # document's sub-batches would fire back-to-back fast enough to
        # trip RPS-based throttling even though each call individually is
        # under the size limit.
        time.sleep(EMBED_SUB_BATCH_PACING_DELAY)
    return master_embeddings


# --- 3. HELPER FUNCTIONS ---
def sanitize_id(raw_string: str) -> str:
    """Generates a clean ASCII MD5 hash ID for Pinecone compliance."""
    return hashlib.md5(raw_string.encode('utf-8')).hexdigest()


def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP):
    """Simple sliding window text chunker."""
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunks.append(text[start:end])
        start += chunk_size - overlap
    return chunks


# --- 4. LOCAL CHECKPOINTING ---
def _load_processed_documents() -> set:
    """Read the set of case_ids already successfully upserted on a prior
    run, so this run can skip them entirely — no re-extraction, no
    re-embedding, no re-upsert API calls."""
    if not os.path.exists(PROCESSED_LOG_PATH):
        return set()
    with open(PROCESSED_LOG_PATH, "r", encoding="utf-8") as f:
        return {line.strip() for line in f if line.strip()}


def _append_processed_documents(case_ids, processed_set):
    """Persist newly-confirmed-upserted case_ids to disk immediately, and
    mirror them into the in-memory set. Caller MUST only pass case_ids
    whose chunks were just in a batch that safe_pinecone_upsert actually
    succeeded on — never call this speculatively."""
    if not case_ids:
        return
    with file_lock:
        with open(PROCESSED_LOG_PATH, "a", encoding="utf-8") as f:
            for cid in case_ids:
                f.write(cid + "\n")
        processed_set.update(case_ids)


# --- 5. PDF EXTRACTION WORKER (runs inside the ThreadPoolExecutor) ---
def _extract_text_and_chunks(member_name, pdf_bytes):
    """CPU-bound unit of work handed to the extraction thread pool: parses
    PDF bytes with PyMuPDF and splits the result into chunks. Opens its own
    local fitz.Document (never shares one across threads/tasks) and touches
    no shared state — vector_batch, the checkpoint set, and the tarfile
    handle are all owned exclusively by the main thread. Raises on failure;
    the caller (drain_futures, on the main thread) is responsible for
    catching and logging it per-document without killing the pool."""
    with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
        full_text = "\n".join(
            page.get_text("text").strip() for page in doc if page.get_text("text").strip()
        )
    if not full_text.strip():
        return member_name, []
    return member_name, chunk_text(full_text)


# --- 6. PRODUCER-CONSUMER PIPELINE (sequential tar I/O + parallel CPU-bound extraction) ---
def stream_and_process():
    processed_documents = _load_processed_documents()
    print(f"📋 Loaded {len(processed_documents)} previously processed document(s) from {PROCESSED_LOG_PATH}")

    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".tar")
    try:
        print(f"📥 Downloading s3://{BUCKET_NAME}/{TAR_KEY} to a temporary file...")
        s3_client.download_fileobj(BUCKET_NAME, TAR_KEY, temp_file)

        # CRITICAL ON WINDOWS: release the OS-level file lock before tarfile
        # opens the same path by name below, or that open fails with a
        # PermissionError ("being used by another process").
        temp_file.close()

        vector_batch = []
        # case_ids whose chunks are currently sitting in vector_batch, not
        # yet confirmed upserted. Kept in lockstep with vector_batch and
        # reset together — a case_id is only ever written to
        # processed_documents.txt from inside a successful flush.
        pending_case_ids = []
        total_upserted = 0

        def flush_batch(context_label):
            """Upsert whatever is currently buffered. ALWAYS resets both
            vector_batch and pending_case_ids afterward — success or
            failure — so a permanently-failed batch can never bleed stale
            vectors into the next iteration, and a failed document is never
            checkpointed (it will be retried on the next run instead)."""
            nonlocal vector_batch, pending_case_ids, total_upserted
            if not vector_batch:
                return
            try:
                safe_pinecone_upsert(vector_batch)
                total_upserted += len(vector_batch)
                print(f"✅ Upserted batch. Total vectors: {total_upserted}")
                _append_processed_documents(pending_case_ids, processed_documents)
            except Exception as e:
                failed_ids = [v["id"] for v in vector_batch]
                logging.error(
                    f"Batch upsert failed after all retries near '{context_label}' — "
                    f"{len(failed_ids)} vector(s) dropped, {len(pending_case_ids)} document(s) "
                    f"NOT checkpointed (will retry next run): {pending_case_ids} — {type(e).__name__}: {e}"
                )
                print(f"❌ Batch upsert failed after retries — see failed_documents.log")
            finally:
                vector_batch = []
                pending_case_ids = []

        def ingest_extracted_document(member_name, text_chunks):
            """Sequential tail of the pipeline for one already-extracted
            document. Runs exclusively on the main thread — extraction is
            the only stage that got parallelized. generate_embeddings_batch
            and safe_pinecone_upsert are never called concurrently, so all
            existing API safeguards (sub-batching, pacing, retry/backoff,
            quota SystemExit) apply completely unchanged."""
            nonlocal vector_batch, pending_case_ids
            if not text_chunks:
                return

            try:
                embeddings = generate_embeddings_batch(text_chunks)
            except Exception as e:
                logging.error(f"Embedding failed for {member_name}: {type(e).__name__}: {e}")
                print(f"⚠️ Skipped embeddings for: {member_name}")
                return

            for idx, (chunk, embedding) in enumerate(zip(text_chunks, embeddings)):
                clean_vector_id = sanitize_id(f"{member_name}_chunk_{idx}")

                # Store the actual text chunk in metadata for RAG retrieval context.
                metadata = {
                    "case_id": member_name,
                    "year": TARGET_YEAR,
                    "chunk_index": idx,
                    "text": chunk[:1000],  # safe size for Pinecone metadata
                }

                vector_batch.append({
                    "id": clean_vector_id,
                    "values": embedding,
                    "metadata": metadata
                })

            pending_case_ids.append(member_name)

            # Flush only at document boundaries — never mid-document.
            # Splitting one document's chunks across two batches would
            # mean a failure on the second batch either loses those
            # chunks silently or, worse, the first batch's success could
            # get this case_id checkpointed before the rest of it is
            # actually safe in Pinecone.
            if len(vector_batch) >= BATCH_SIZE:
                flush_batch(member_name)
                # Proactive throttle — keeps sustained throughput safely
                # under the 250K TPM ceiling alongside (not instead of)
                # the reactive 429 retry/backoff above.
                time.sleep(BATCH_PACING_DELAY)

        def drain_futures(futures_in_order):
            """Resolve a bounded batch of extraction futures IN SUBMISSION
            ORDER on the main thread. .result() is wrapped per-future so one
            corrupted PDF is logged and skipped without killing the pool or
            blocking the rest of the batch. Feeding results into
            ingest_extracted_document here (not inside the pool) is what
            keeps embedding/upsert fully serialized."""
            for member_name, future in futures_in_order:
                try:
                    _, text_chunks = future.result()
                except Exception as e:
                    logging.error(f"PDF extraction failed for {member_name}: {type(e).__name__}: {e}")
                    print(f"⚠️ Skipped corrupted document: {member_name}")
                    continue
                ingest_extracted_document(member_name, text_chunks)

        with tarfile.open(temp_file.name, mode='r') as tar, \
             concurrent.futures.ThreadPoolExecutor(max_workers=PDF_EXTRACTION_WORKERS) as executor:
            pending_futures = []
            for member in tar:
                if not member.name.endswith("_EN.pdf"):
                    continue
                if member.name in processed_documents:
                    continue  # checkpointed on a prior run — skip, saves the extraction+embed+upsert cost entirely

                # tarfile is not thread-safe — extraction (locating and
                # reading the member's raw bytes from the archive) stays
                # sequential in the main thread. Only the CPU-bound PyMuPDF
                # parse + chunk step below is handed off to worker threads.
                try:
                    file_obj = tar.extractfile(member)
                    if not file_obj:
                        continue
                    pdf_bytes = file_obj.read()
                except Exception as e:
                    logging.error(f"PDF extraction failed for {member.name}: {str(e)}")
                    print(f"⚠️ Skipped corrupted document: {member.name}")
                    continue

                future = executor.submit(_extract_text_and_chunks, member.name, pdf_bytes)
                pending_futures.append((member.name, future))

                # Bounded submission — caps how many raw PDF byte buffers
                # and in-flight futures can pile up in memory at once. Each
                # drain fully resolves the current batch before the next
                # PDF_EXTRACTION_BATCH_SIZE are read off the tar.
                if len(pending_futures) >= PDF_EXTRACTION_BATCH_SIZE:
                    drain_futures(pending_futures)
                    pending_futures = []

            drain_futures(pending_futures)

        flush_batch("final flush")
    finally:
        if os.path.exists(temp_file.name):
            os.remove(temp_file.name)

    print("🎉 Pipeline run complete!")


if __name__ == "__main__":
    stream_and_process()
