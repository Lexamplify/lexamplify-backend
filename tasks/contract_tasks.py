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
import time
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED, TimeoutError as FutureTimeout

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


class JobCancelled(Exception):
    """The advocate pressed Cancel."""


CHUNK_CHARS = int(os.getenv("ANALYSIS_CHUNK_CHARS", "4500"))
WORKERS = int(os.getenv("ANALYSIS_WORKERS", "3"))
PRECEDENT_SECONDS = float(os.getenv("ANALYSIS_PRECEDENT_SECONDS", "25"))


def time_budget(sections):
    """Seconds the whole scan may take. Grows with the document but never past 15 minutes: after that the advocate
    gets what was read, clearly marked as partial, instead of a spinner."""
    return float(os.getenv("ANALYSIS_MAX_SECONDS") or min(900, 240 + 20 * sections))


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

    from utils.ai_helper import AITimeout

    def report(status, progress, **extra):
        if job_id:
            try:
                from utils.job_store import get_local_job
                if (get_local_job(job_id) or {}).get("cancelled"):
                    raise JobCancelled()
            except JobCancelled:
                raise
            except Exception:  # noqa: BLE001 - a job file we cannot read must not stop the scan
                pass
        if self.request and self.request.id:
            try:
                self.update_state(state='PROGRESS', meta={'status': status, 'progress': progress})
            except Exception as e:
                print(f"[analyze_contract_task] Celery update_state failed: {e}")
        if job_id:
            try:
                from utils.job_store import update_job
                update_job(job_id, status="processing", progress=progress, stage=status, **extra)
            except Exception as e:
                print(f"[analyze_contract_task] Job store state update failed: {e}")

    started = time.time()
    report('Chunking document...', 5)
    chunks = chunk_text_by_boundary(full_text, chunk_size=CHUNK_CHARS, overlap=300)
    if not chunks:
        chunks.append(full_text)
    total = len(chunks)
    deadline = started + time_budget(total)

    failed_sections = []
    timed_out = []

    def process_chunk_safe(chunk):
        """One section, with one more try when the answer was unreadable. Timeouts are not retried (that would double the wait)."""
        last = None
        for _attempt in (1, 2):
            if time.time() > deadline - 2:
                break
            try:
                return analyze_contract_with_llm(chunk, scan_strategy, deadline=deadline)
            except AITimeout as e:
                last = e
                break
            except Exception as e:  # noqa: BLE001
                last = e
        print(f"[analyze_contract_task] section failed, skipping: {last}")
        failed_sections.append(1)
        if isinstance(last, AITimeout) or last is None:
            timed_out.append(1)
        return {"summary": "", "clauses": []}

    all_clauses = []
    all_summaries = []
    completed = 0
    not_reached = 0

    report(f'Reading the contract: section 0 of {total}', 15, sections_total=total, sections_done=0, deadline_at=deadline, started_at=started)
    executor = ThreadPoolExecutor(max_workers=max(1, WORKERS))
    pending = {executor.submit(lambda c=chunk, i=i: (i, process_chunk_safe(c))) for i, chunk in enumerate(chunks)}
    try:
        while pending:
            done, pending = wait(pending, timeout=2.0, return_when=FIRST_COMPLETED)
            for future in done:
                idx, res = future.result()  # process_chunk_safe never raises
                completed += 1
                if res and isinstance(res, dict):
                    if isinstance(res.get("clauses"), list):
                        all_clauses.extend(c for c in res["clauses"] if isinstance(c, dict))
                    if isinstance(res.get("summary"), str) and res["summary"]:
                        all_summaries.append((idx, res["summary"]))
            progress = 15 + int((completed / total) * 55)  # climbs 15 -> 70
            report(f'Reading the contract: section {completed} of {total}', progress, sections_done=completed)  # also the heartbeat + cancel check
            if time.time() > deadline + 5:
                break
    finally:
        not_reached = len(pending)
        for f in pending:
            f.cancel()
        executor.shutdown(wait=False, cancel_futures=True)

    if not_reached:
        failed_sections.extend([1] * not_reached)
        timed_out.extend([1] * not_reached)

    if failed_sections and len(failed_sections) >= total:
        # Every section failed (provider down, key missing, rate limit, too slow). An empty result here would read as
        # "no risks found", which is the one thing a contract review must never say by accident.
        raise RuntimeError("AI_TIMEOUT" if timed_out else "AI_UNAVAILABLE")

    report('Checking every finding against your contract...', 75)
    from utils.contract_checks import find_missing_clauses, key_dates, locate_quote
    from utils.draft_engine.verifier import check_citations

    # 1. A finding stays only if the text it quotes is really in the contract (the quote is snapped to the exact words).
    grounded, dropped_unverified = [], 0
    for c in all_clauses:
        txt = (c.get("original_text") or "").strip()
        if not txt:
            continue
        exact, how = locate_quote(txt, full_text)
        if not exact:
            dropped_unverified += 1
            continue
        c["original_text"] = exact
        c["_quote_match"] = how
        c["_pos"] = full_text.find(exact)
        grounded.append(c)

    # 2. Document order, the same on every run whichever section answered first.
    grounded.sort(key=lambda c: (c["_pos"], str(c.get("title") or "")))

    # 3. The same clause flagged twice (overlapping sections) is the same stretch of the contract once the quotes are exact,
    #    so it is spotted by position. Two different clauses that merely sound alike are NOT merged, as text similarity did.
    def _rank(c):
        r = str(c.get("risk_level", "")).upper()
        return 3 if ("HIGH" in r or "RED" in r) else (1 if ("LOW" in r or "GREEN" in r) else 2)

    unique_clauses = []
    for c in grounded:
        end = c["_pos"] + len(c["original_text"])
        match = None
        for i in range(max(0, len(unique_clauses) - 6), len(unique_clauses)):
            prev = unique_clauses[i]
            p_end = prev["_pos"] + len(prev["original_text"])
            overlap = min(end, p_end) - max(c["_pos"], prev["_pos"])
            if overlap > 0.6 * min(len(c["original_text"]), len(prev["original_text"])):
                match = i
                break
        if match is None:
            unique_clauses.append(c)
        elif _rank(c) > _rank(unique_clauses[match]):
            unique_clauses[match] = c                          # the same stretch flagged twice: keep the more serious finding

    all_summaries = [t for _i, t in sorted(all_summaries)]
    final_summary = all_summaries[0] if all_summaries else "No summary could be produced for this document."
    if len(all_summaries) > 1 and time.time() < deadline:
        try:
            from utils.ai_helper import ask_groq
            report('Writing the summary...', 76)
            combined = ask_groq(
                "Combine these partial summaries of ONE contract into a single plain summary of at most four short sentences. "
                "Use only facts that appear in them. Do not add anything and do not discuss risks.",
                "\n".join(f"- {t}" for t in all_summaries[:8]),
                deadline=min(deadline, time.time() + 40), timeout=25)
            if combined and combined.strip():
                final_summary = combined.strip()
        except Exception as e:
            print(f"[analyze_contract_task] summary merge skipped: {e}")

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

        cite_issues = check_citations(" ".join([str(rule), str(explanation), str(rev_text)]))
        formatted_clauses.append({
            "id": f"risk-{idx+1}",
            "quoteMatch": c.get("_quote_match", "exact"),
            "citationWarnings": [i["reason"] + " (" + i["text"] + ")" for i in cite_issues],
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
    missing_clauses = find_missing_clauses(full_text)

    report('Matching precedents...', 88)
    citations = []

    def safe_check_case_in_vault(title_to_check, case_id_to_check):
        try:
            return check_case_in_vault(title_to_check, case_id_to_check)
        except Exception as v_err:
            print(f"[analyze_contract_task] Vault check non-fatal error: {v_err}")
            return False, None

    def _match_precedents():
        found = []
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

                found.append({
                    "id": f"cite-{len(found)+1}",
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
                if len(found) >= 4:
                    break
        return found

    precedent_skipped = False
    pexec = ThreadPoolExecutor(max_workers=1)
    pfut = pexec.submit(_match_precedents)
    try:
        limit = 0.0 if time.time() > deadline else PRECEDENT_SECONDS      # no time left: do not start a side search
        waited = 0.0
        while True:
            try:
                citations = pfut.result(timeout=min(2.0, max(0.01, limit - waited)))
                break
            except FutureTimeout:
                waited += 2.0
                if waited >= limit:
                    raise
                report('Matching precedents...', 88)                          # heartbeat and cancel check
    except FutureTimeout:
        precedent_skipped = True
        print("[analyze_contract_task] precedent search took too long; skipped")
    except JobCancelled:
        raise
    except Exception as precedent_err:  # noqa: BLE001
        precedent_skipped = True
        print(f"[analyze_contract_task] Precedent matching non-fatal failure: {precedent_err}")
    finally:
        pexec.shutdown(wait=False, cancel_futures=True)

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
        "key_dates": key_dates(full_text),
        "coverage": {
            "sections": total, "failed_sections": len(failed_sections), "dropped_unverified": dropped_unverified,
            "timed_out_sections": len(timed_out), "partial": bool(failed_sections),
            "elapsed_seconds": int(time.time() - started),
            "warnings": (
                ([f"The AI took too long on {len(timed_out)} of {total} sections, so risks in those sections are not shown. Run the analysis again for a complete result."] if timed_out else [])
                + ([f"The AI could not read {len(failed_sections) - len(timed_out)} of {total} sections, so risks in those sections are not shown."] if len(failed_sections) > len(timed_out) else [])
                + (["Matching to reported cases was skipped because it took too long; no precedents are shown."] if precedent_skipped else [])
                + ([f"{dropped_unverified} AI finding(s) were removed because the text they quoted is not in your document."] if dropped_unverified else [])
            ),
        },
    }
