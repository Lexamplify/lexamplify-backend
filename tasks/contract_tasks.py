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

_KANOON_DOC_ID_RE = re.compile(r'/doc(?:fragment)?/(\d+)/')


def _word_boundary_excerpt(snippet, start=50, end=130):
    """Same 50:130 window, but nudged outward to the nearest whitespace on
    both sides instead of hard-cutting mid-word ("...AssistMed..." ->
    "tMed" at a bare snippet[50:130]) — a query that starts/ends mid-word
    is guaranteed to mismatch Kanoon's tokenized search, on top of already
    being a rough, non-title excerpt to begin with."""
    if start >= len(snippet):
        return snippet.strip()
    end = min(end, len(snippet))
    while start > 0 and not snippet[start - 1].isspace():
        start -= 1
    while end < len(snippet) and not snippet[end].isspace():
        end += 1
    return snippet[start:end].strip()


def fetch_kanoon_case_title(snippet):
    """Returns {"title": str, "url": str|None} — url is the exact document
    permalink when the search below actually found a matching result,
    None otherwise (caller falls back to a query-based redirect link at
    click time in that case). Previously this only kept the TITLE text and
    threw away the very search result that titled it, forcing the frontend
    to blindly re-run an independent search later and hope it turns up the
    same document — confirmed live as the concrete cause of citations
    landing on a bare Kanoon search page instead of the actual judgment."""
    if not snippet or len(snippet) < 60:
        return {"title": None, "url": None}
    excerpt = _word_boundary_excerpt(snippet)
    if not excerpt:
        return {"title": None, "url": None}

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
            a_tag = result_titles[0].find('a', href=True)
            if a_tag:
                raw_text = a_tag.get_text(strip=True)
                # Clean up typical Kanoon title format like "Kesavananda ... vs State Of Kerala And Anr on 24 April, 1973"
                cleaned_title = re.sub(r'\s+on\s+\d+\s+\w+,\s+\d{4}', '', raw_text, flags=re.IGNORECASE)
                doc_match = _KANOON_DOC_ID_RE.search(a_tag.get('href', ''))
                url = f"https://indiankanoon.org/doc/{doc_match.group(1)}/" if doc_match else None
                return {"title": cleaned_title, "url": url}
    except Exception as e:
        print(f"[fetch_kanoon_case_title] Error fetching title from Kanoon: {e}")
    return {"title": None, "url": None}


@shared_task(bind=True)
def analyze_contract_task(self, full_text, rule_book_text, scan_strategy, job_id=None):
    from routes.contract_routes import (
        chunk_text_by_boundary,
        analyze_contract_with_llm,
        is_near_duplicate_risk,
        compute_diff_segments,
        format_diff_html,
        segment_text_into_clauses,
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
                from utils.job_store import get_local_job, save_local_job
                job_data = get_local_job(job_id) or {}
                job_data["status"] = "processing"
                job_data["progress"] = progress
                job_data["stage"] = status
                save_local_job(job_id, job_data)
            except Exception as e:
                print(f"[analyze_contract_task] Job store state update failed: {e}")

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
    for idx, c in enumerate(unique_clauses):
        risk_val = str(c.get("risk_level", "AMBER")).upper()
        if "HIGH" in risk_val or "RED" in risk_val:
            color = "RED"
            severity = "critical"
        elif "LOW" in risk_val or "GREEN" in risk_val:
            color = "GREEN"
            severity = "info"
        else:
            color = "AMBER"
            severity = "caution"

        orig_text = c.get("original_text") or c.get("text") or ""
        rev_text = c.get("suggested_revision") or ""
        diff_segs = compute_diff_segments(orig_text, rev_text) if (orig_text and rev_text) else []
        diff_h = format_diff_html(diff_segs) if diff_segs else (f'"{orig_text}"' if orig_text else "")

        title = c.get("title") or c.get("issue") or f"Risk in {c.get('location', f'Clause {idx+1}')}"
        loc = c.get("location") or f"Section {idx+1}"
        rule = c.get("playbook_rule") or "Indian Contract Act, 1872"
        explanation = c.get("explanation") or c.get("issue") or "This clause presents contractual risk under Indian law."

        formatted_clauses.append({
            "id": f"risk-{idx+1}",
            "severity": severity,
            "title": title,
            "excerpt": (orig_text[:140] + "…") if len(orig_text) > 140 else orig_text,
            "location": loc,
            "playbookRule": f"Playbook Guardrail · {rule}" if not rule.startswith("Playbook") else rule,
            "guardrailText": explanation,
            "original": f'"{orig_text}"' if not orig_text.startswith('"') else orig_text,
            "diffHtml": diff_h,
            "replacementText": rev_text,
            "suggestedRevision": {
                "diffSegments": diff_segs,
                "replacementText": rev_text,
            },
            "original_text": orig_text,
            "risk_level": c.get("risk_level", "Medium").capitalize(),
            "explanation": explanation,
            "text": orig_text,
            "risk": color,
            "issue": explanation,
        })

    report('Identifying missing standard clauses...', 80)
    missing_clauses = []
    try:
        from utils.ai_helper import ask_groq, extract_json_from_llm_response
        missing_prompt = """You are a senior Indian corporate lawyer reviewing a contract.
Identify 3 to 5 critical clauses or legal protections that are completely MISSING or dangerously absent from this agreement (e.g. Force Majeure, Transition Assistance, Audit Rights, DPDP Act 2023 compliance, Mutual Indemnification, Severability).

Return ONLY a valid JSON array of objects with these exact keys:
[
  {
    "title": "Clause Title (e.g. Force Majeure clause)",
    "rationale": "One-sentence rationale explaining why this clause is standard and what exposure its absence creates under Indian law.",
    "model": "Complete, formal contractual clause ready to insert directly into the executed agreement."
  }
]
"""
        raw_missing = ask_groq(missing_prompt, f"Contract Text excerpt:\n{full_text[:9000]}")
        parsed_missing = extract_json_from_llm_response(raw_missing)
        if isinstance(parsed_missing, list):
            for m_idx, m_item in enumerate(parsed_missing):
                if isinstance(m_item, dict) and m_item.get("title"):
                    model_txt = m_item.get("model", "")
                    if not model_txt.startswith('"') and model_txt:
                        model_txt = f'"{model_txt}"'
                    missing_clauses.append({
                        "id": f"miss-{m_idx+1}",
                        "title": m_item.get("title", ""),
                        "rationale": m_item.get("rationale", ""),
                        "model": model_txt,
                        "checked": False,
                        "expanded": False,
                    })
    except Exception as e:
        print(f"[analyze_contract_task] Missing clauses detection error: {e}")

    report('Matching precedents...', 88)
    citations = []

    def safe_check_case_in_vault(title_to_check, case_id_to_check):
        try:
            return check_case_in_vault(title_to_check, case_id_to_check)
        except Exception as v_err:
            print(f"[analyze_contract_task] Vault check non-fatal error: {v_err}")
            return False, None

    try:
        search_query = " ".join(c.get("explanation", "") for c in formatted_clauses[:5]).strip() if formatted_clauses else ""
        if search_query and os.getenv("PINECONE_API_KEY") and os.getenv("PINECONE_HOST"):
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
                kanoon_url = None
                if title == case_id:
                    snippet = metadata.get('text', '') or ''
                    extracted = python_extract_case_name(snippet)
                    if extracted:
                        title = extracted
                    else:
                        try:
                            resolved = fetch_kanoon_case_title(snippet)
                            if resolved.get('title'):
                                title = resolved['title']
                                kanoon_url = resolved.get('url')
                            elif title.endswith('.pdf'):
                                title = title[:-4].replace('_', ' ')
                        except Exception:
                            pass

                in_vault, vault_id = safe_check_case_in_vault(title, case_id)

                citations.append({
                    "id": f"cite-{len(citations)+1}",
                    "case_id": case_id,
                    "title": title,
                    "name": title,
                    "year": metadata.get('year', ''),
                    "num": metadata.get('year') or case_id,
                    "snippet": (metadata.get('text', '') or '')[:200],
                    "in_vault": in_vault,
                    "inVault": in_vault,
                    "vault_id": vault_id,
                    "kanoon_url": kanoon_url or f"https://indiankanoon.org/search/?formInput={urllib.parse.quote(title)}",
                })
                if len(citations) >= 4:
                    break
    except Exception as precedent_err:
        print(f"[analyze_contract_task] Precedent matching non-fatal failure: {precedent_err}")

    # Fallback statutory citations if index was empty or offline (guaranteed non-fatal)
    if not citations:
        try:
            statutory_candidates = [
                {
                    "title": "Digital Personal Data Protection Act, 2023",
                    "num": "Act No. 22 of 2023",
                    "snippet": "Governs the processing of digital personal data within India, requiring reasonable security safeguards and lawful basis for processing.",
                },
                {
                    "title": "Indian Contract Act, 1872 — Section 73 & 74",
                    "num": "Act No. 9 of 1872",
                    "snippet": "Statutory rules on compensation for loss or damage caused by breach of contract and enforcement of liquidated damages.",
                },
                {
                    "title": "Arbitration and Conciliation Act, 1996",
                    "num": "Act No. 26 of 1996",
                    "snippet": "Sets out the legal framework for domestic and international commercial arbitration seated in India, party autonomy, and enforceability.",
                },
                {
                    "title": "Specific Relief Act, 1963 — Section 14",
                    "num": "Act No. 47 of 1963",
                    "snippet": "Contracts not specifically enforceable, including contracts dependent on personal qualifications or determinable contracts.",
                },
            ]
            for c_cand in statutory_candidates:
                in_v, v_id = safe_check_case_in_vault(c_cand["title"], c_cand["num"])
                citations.append({
                    "id": f"cite-{len(citations)+1}",
                    "case_id": c_cand["num"],
                    "title": c_cand["title"],
                    "name": c_cand["title"],
                    "year": c_cand["num"],
                    "num": c_cand["num"],
                    "snippet": c_cand["snippet"],
                    "in_vault": in_v,
                    "inVault": in_v,
                    "vault_id": v_id,
                    "kanoon_url": f"https://indiankanoon.org/search/?formInput={urllib.parse.quote(c_cand['title'])}",
                })
        except Exception as stat_err:
            print(f"[analyze_contract_task] Statutory fallback non-fatal error: {stat_err}")

    report('Finalizing report...', 97)
    word_count = len(full_text.split())
    page_count = max(1, word_count // 250)
    doc_clauses = segment_text_into_clauses(full_text)

    return {
        "summary": final_summary,
        "clauses": formatted_clauses,
        "risks": formatted_clauses,
        "missing_clauses": missing_clauses,
        "missing": missing_clauses,
        "citations": citations,
        "raw_text": full_text,
        "document_clauses": doc_clauses,
        "page_count": page_count,
        "word_count": word_count,
        "pdf_url": "",
    }
