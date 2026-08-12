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
import sqlite3
from concurrent.futures import ThreadPoolExecutor, as_completed

from celery import shared_task


import re

def python_extract_case_name(text):
    if not text:
        return None
    pattern = r'\b([A-Z][\w\.\&\'-]*(?:\s+(?:[A-Z][\w\.\&\'-]*|of|the|and|\&))*\s+(?:v\.|vs\.?|versus)\s+[A-Z][\w\.\&\'-]*(?:\s+(?:[A-Z][\w\.\&\'-]*|of|the|and|\&))*)\b'
    matches = re.findall(pattern, text)
    if matches:
        return max(matches, key=len).strip()
    return None
import urllib.parse
import requests
from bs4 import BeautifulSoup

def check_case_in_vault(title, case_id):
    db_path = os.path.join(os.getcwd(), "lex_assistant.db")
    if not os.path.exists(db_path):
        return False, None
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        # 1. Try exact match on case_id
        if case_id:
            clean_cid = case_id
            if clean_cid.endswith('.pdf'):
                clean_cid = clean_cid[:-4]
            clean_cid_no_en = clean_cid
            if clean_cid_no_en.endswith('_EN'):
                clean_cid_no_en = clean_cid_no_en[:-3]
            cursor.execute("SELECT id FROM case_vault WHERE case_id = ? OR case_id = ? OR case_id = ?", (case_id, clean_cid, clean_cid_no_en))
            row = cursor.fetchone()
            if row:
                conn.close()
                return True, str(row[0])
            
        # 2. Try match on title
        if title:
            cursor.execute("SELECT id FROM case_vault WHERE title = ? OR title LIKE ?", (title, f"%{title}%"))
            row = cursor.fetchone()
            if row:
                conn.close()
                return True, str(row[0])
        conn.close()
    except Exception as e:
        print(f"[check_case_in_vault] Error: {e}")
    return False, None

def fetch_kanoon_case_title(snippet):
    if not snippet or len(snippet) < 60:
        return None
    excerpt = snippet[50:130].strip()
    if not excerpt:
        return None
    
    # Clean up quote
    excerpt = excerpt.replace('"', '').replace("'", "").strip()
    # NOT wrapped in quotes: an exact-phrase search almost never matches —
    # this is a verbatim body excerpt from OUR document, not judgment
    # title text, so Kanoon's title-indexed search returns zero results
    # for the quoted form nearly every time (silently — result_titles
    # comes back empty below, so this whole resolver just returns None).
    # Unquoted, Kanoon's own relevance ranking has a real shot at surfacing
    # the right case — the same fix already validated in this codebase's
    # /api/kanoon-redirect route (see its is_case=False branch).
    query = excerpt

    zenrows_key = os.getenv("ZENROWS_API_KEY")
    target_url = f"https://indiankanoon.org/search/?formInput={urllib.parse.quote(query)}"
    
    try:
        if zenrows_key:
            resp = requests.get(
                "https://api.zenrows.com/v1/",
                params={
                    'apikey': zenrows_key,
                    'url': target_url,
                    'premium_proxy': 'true',
                    'proxy_country': 'in',
                },
                timeout=10,
            )
        else:
            resp = requests.get(
                "https://indiankanoon.org/search/",
                params={'formInput': query},
                timeout=5,
                headers={'User-Agent': 'Mozilla/5.0'},
            )
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, 'html.parser')
        result_titles = soup.find_all(class_='result_title')
        if result_titles:
            a_tag = result_titles[0].find('a')
            if a_tag:
                raw_text = a_tag.get_text(strip=True)
                # Clean up typical Kanoon title format like "Kesavananda ... vs State Of Kerala And Anr on 24 April, 1973"
                cleaned_title = re.sub(r'\s+on\s+\d+\s+\w+,\s+\d{4}', '', raw_text, flags=re.IGNORECASE)
                return cleaned_title
    except Exception as e:
        print(f"[fetch_kanoon_case_title] Error fetching title from Kanoon: {e}")
    return None


@shared_task(bind=True)
def analyze_contract_task(self, full_text, rule_book_text, scan_strategy, job_id=None):
    from routes.contract_routes import (
        chunk_text_by_boundary,
        analyze_contract_with_llm,
        is_near_duplicate_risk,
        EMBED_MODEL,
    )

    def report(status, progress):
        if self.request and self.request.id:
            try:
                self.update_state(state='PROGRESS', meta={'status': status, 'progress': progress})
            except Exception as e:
                print(f"[analyze_contract_task] Celery update_state failed: {e}")
        if job_id:
            try:
                from routes.contract_routes import LOCAL_JOBS
                if job_id in LOCAL_JOBS:
                    LOCAL_JOBS[job_id].update({
                        "progress": progress,
                        "status": status
                    })
            except Exception as e:
                print(f"[analyze_contract_task] Local job state update failed: {e}")

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
                title = metadata.get('title') or metadata.get('case_name') or metadata.get('doc_title') or case_id
                if title == case_id:
                    snippet = metadata.get('text', '') or ''
                    extracted = python_extract_case_name(snippet)
                    if extracted:
                        title = extracted
                    else:
                        resolved = fetch_kanoon_case_title(snippet)
                        if resolved:
                            title = resolved
                        elif title.endswith('.pdf'):
                            title = title[:-4].replace('_', ' ')
                
                # Check database for in_vault
                in_vault, vault_id = check_case_in_vault(title, case_id)
                
                citations.append({
                    "case_id": case_id,
                    "title": title,
                    "year": metadata.get('year', ''),
                    "snippet": (metadata.get('text', '') or '')[:200],
                    "in_vault": in_vault,
                    "vault_id": vault_id,
                })
                if len(citations) >= 3:
                    break
        except Exception as e:
            print(f"[analyze_contract_task] Citation RAG failed: {e}")

    report('Finalizing report...', 97)
    return {
        "summary": final_summary,
        "clauses": formatted_clauses,
        "missing_clauses": [],
        "citations": citations,
        "raw_text": full_text,
        "pdf_url": "",
    }
