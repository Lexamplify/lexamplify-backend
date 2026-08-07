"""
tasks/contract_tasks.py
Celery task extracted from the old synchronous /api/contract/analyze
handler — this is the ~5-minute map-reduce LLM scan, now off the Flask
request thread. Progress is pushed via self.update_state() so the SSE
endpoint (/api/contract/stream/<job_id>) has real status text to relay.

Imports from routes.contract_routes are deferred to inside the task body
(not module top-level) — that route module dispatches this task via a
deferred import too, so neither module needs the other to be fully loaded
first; this avoids a load-order circular import between them.
"""
import os
from concurrent.futures import ThreadPoolExecutor, as_completed

from celery import shared_task


@shared_task(bind=True)
def analyze_contract_task(self, full_text, rule_book_text, scan_strategy):
    from routes.contract_routes import (
        chunk_text_by_boundary,
        analyze_contract_with_llm,
        is_near_duplicate_risk,
        EMBED_MODEL,
    )

    def report(status, progress):
        self.update_state(state='PROGRESS', meta={'status': status, 'progress': progress})

    report('Chunking document...', 5)
    chunks = chunk_text_by_boundary(full_text, chunk_size=3000, overlap=300)
    if not chunks:
        chunks.append(full_text)

    def process_chunk_safe(chunk):
        try:
            return analyze_contract_with_llm(chunk, scan_strategy)
        except Exception as e:
            print(f"[analyze_contract_task] chunk failed, skipping: {e}")
            return {"summary": "", "clauses": []}

    all_clauses = []
    all_summaries = []
    total = len(chunks)
    completed = 0

    report('Scanning Liability...', 15)
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = [executor.submit(process_chunk_safe, chunk) for chunk in chunks]
        for future in as_completed(futures):
            res = future.result()  # process_chunk_safe never raises
            completed += 1
            progress = 15 + int((completed / total) * 55)  # climbs 15 -> 70
            report(f'Scanning Liability... ({completed}/{total} sections)', progress)
            if res and isinstance(res, dict):
                if isinstance(res.get("clauses"), list):
                    all_clauses.extend(res["clauses"])
                if isinstance(res.get("summary"), str) and res["summary"]:
                    all_summaries.append(res["summary"])

    report('Deduplicating flagged clauses...', 75)
    accepted_texts = []
    unique_clauses = []
    for c in all_clauses:
        txt = (c.get("original_text") or "").strip()
        if not txt:
            continue
        if is_near_duplicate_risk(txt, accepted_texts):
            continue
        accepted_texts.append(txt)
        unique_clauses.append(c)

    final_summary = all_summaries[0] if all_summaries else "Document analyzed successfully."

    formatted_clauses = []
    for c in unique_clauses:
        risk_val = str(c.get("risk_level", "AMBER")).upper()
        if "HIGH" in risk_val:
            color = "RED"
        elif "LOW" in risk_val:
            color = "GREEN"
        else:
            color = "AMBER"
        formatted_clauses.append({
            "original_text": c.get("original_text", ""),
            "risk_level": c.get("risk_level", "Medium").capitalize(),
            "explanation": c.get("explanation", ""),
            "text": c.get("original_text", ""),
            "risk": color,
            "issue": c.get("explanation", ""),
        })

    report('Matching precedents...', 85)
    citations = []
    search_query = " ".join(c.get("explanation", "") for c in formatted_clauses[:5]).strip() if formatted_clauses else ""

    if search_query:
        try:
            from pinecone import Pinecone
            pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
            index = pc.Index(host=os.getenv("PINECONE_HOST"))
            namespace = os.getenv("PINECONE_NAMESPACE", "legal-cases")
            embed_response = pc.inference.embed(
                model=EMBED_MODEL,
                inputs=[search_query],
                parameters={"input_type": "query", "truncate": "END"},
            )
            query_vector = embed_response[0].values
            pinecone_results = index.query(vector=query_vector, top_k=10, include_metadata=True, namespace=namespace)

            seen_cases = set()
            for match in (pinecone_results.matches or []):
                metadata = match.metadata or {}
                case_id = metadata.get('case_id') or match.id
                if case_id in seen_cases:
                    continue
                seen_cases.add(case_id)
                title = case_id
                if title.endswith('.pdf'):
                    title = title[:-4].replace('_', ' ')
                citations.append({
                    "case_id": case_id,
                    "title": title,
                    "year": metadata.get('year', ''),
                    "snippet": (metadata.get('text', '') or '')[:200],
                })
                if len(citations) >= 3:
                    break
        except Exception as e:
            print(f"[analyze_contract_task] Citation RAG failed: {e}")

    report('Finalizing report...', 97)
    return {
        "summary": final_summary,
        "clauses": formatted_clauses,
        "citations": citations,
        "raw_text": full_text,
        "pdf_url": "",
    }
