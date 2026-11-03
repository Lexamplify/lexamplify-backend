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
            cursor.execute("SELECT id FROM case_vault WHERE (case_id = ? OR case_id = ? OR case_id = ?) AND is_public = 1", (case_id, clean_cid, clean_cid_no_en))
            row = cursor.fetchone()
            if row:
                conn.close()
                return True, str(row[0])
            
        # 2. Try match on title
        if title:
            cursor.execute("SELECT id FROM case_vault WHERE (title = ? OR title LIKE ?) AND is_public = 1", (title, f"%{title}%"))
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


# Target: a 40-page contract completes in under a minute end-to-end
# (baseline before this change was ~200s on a 153K-char / 17-chunk doc
# because the adaptive worker tier capped 11-30 chunk docs at 4 workers).
# Two levers: fewer chunks (bigger CHUNK_CHARS) and more parallel chunks
# (higher WORKERS + a wider adaptive tier below).
#
# Bigger chunks also preserve context better across clause boundaries —
# the model sees whole related sections together instead of mid-clause
# cuts. gpt-4o-mini has a 128K-token context so 20K-char chunks are a
# fraction of that; the cost per chunk is still bounded by the output
# cap (ANALYSIS_MAX_OUTPUT_TOKENS, 1500) which is where latency lives.
CHUNK_CHARS = int(os.getenv("ANALYSIS_CHUNK_CHARS", "20000"))
# When OpenAI gpt-4o-mini is in play (OPENAI_API_KEY only), its 500K TPM
# and 10K RPM easily absorb 15+ concurrent requests. On Groq's 8K TPM,
# keep the lower 6.
if os.getenv("OPENAI_API_KEY") and not os.getenv("GROQ_API_KEY"):
    WORKERS = int(os.getenv("ANALYSIS_WORKERS", "16"))
else:
    WORKERS = int(os.getenv("ANALYSIS_WORKERS", "6"))
PRECEDENT_SECONDS = float(os.getenv("ANALYSIS_PRECEDENT_SECONDS", "25"))


def time_budget(sections):
    """Seconds the whole scan may take. Grows with the document but never past 15 minutes: after that the advocate
    gets what was read, clearly marked as partial, instead of a spinner."""
    return float(os.getenv("ANALYSIS_MAX_SECONDS") or min(900, 240 + 20 * sections))


@shared_task(bind=True)
def analyze_contract_task(self, full_text, rule_book_text, scan_strategy, job_id=None, firm_master_text=""):
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
    # Adaptive chunk size: big contracts (300+ pages ~= 600K+ chars)
    # get a bigger chunk so the total chunk count stays reasonable and
    # the whole analysis finishes in ~1 minute even for a 300-page
    # agreement. Small contracts stay on the default 10K to keep each
    # LLM call cheap. Override explicitly with ANALYSIS_CHUNK_CHARS.
    _env_chunk = os.getenv("ANALYSIS_CHUNK_CHARS")
    if _env_chunk:
        _effective_chunk = int(_env_chunk)
    elif len(full_text) > 600_000:
        _effective_chunk = 30000          # 300+ page: ~20 chunks
    elif len(full_text) > 300_000:
        _effective_chunk = 24000          # 150-300 page: ~15 chunks
    else:
        _effective_chunk = CHUNK_CHARS    # default 20000
    # Smaller overlap (was 300) — larger chunks mean a boundary clause
    # already lives near the middle of some chunk, not at its edge, so
    # the overlap mostly re-processed duplicate context.
    chunks = chunk_text_by_boundary(full_text, chunk_size=_effective_chunk, overlap=150)
    if not chunks:
        chunks.append(full_text)
    total = len(chunks)

    # Adaptive worker count: small contracts don't need (and shouldn't
    # pay for) 10 parallel threads. Scale with the chunk count. A
    # 5-page contract = 1-2 chunks = 2 workers; a 900-page contract =
    # 100+ chunks = full WORKERS pool. ANALYSIS_WORKERS env wins.
    # Match worker count to chunk count so a 7-chunk doc gets 7 parallel
    # workers (one wave, not two). Floor at 4; env override still wins.
    # Previous tiers capped sub-30-chunk docs at 4-6, which is the main
    # reason a 40-page analyze was taking ~3 minutes.
    if os.getenv("ANALYSIS_WORKERS"):
        _effective_workers = WORKERS
    else:
        _effective_workers = max(4, min(total, WORKERS))
    # Expose it to the chunk-dispatch block below without renaming the var there.
    _WORKERS_LOCAL = _effective_workers
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
                return analyze_contract_with_llm(chunk, scan_strategy, deadline=deadline, rule_book_text=rule_book_text)
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
    # Pipeline item 2: the master prompt now returns a third top-level key,
    # `missing_protections`, listing clauses that would FAVOR our client but
    # are absent from the contract. Each chunk may contribute its own
    # observations; we collect and dedupe them before returning.
    all_missing_proactive = []
    completed = 0
    not_reached = 0

    report(f'Reading the contract: section 0 of {total}', 15, sections_total=total, sections_done=0, deadline_at=deadline, started_at=started)
    executor = ThreadPoolExecutor(max_workers=max(1, _WORKERS_LOCAL))
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
                    if isinstance(res.get("missing_protections"), list):
                        all_missing_proactive.extend(
                            m for m in res["missing_protections"] if isinstance(m, dict)
                        )
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
    from utils.contract_checks import find_missing_clauses, key_dates, locate_quote, _get_squashed
    from utils.draft_engine.verifier import check_citations

    # 1. A finding stays only if the text it quotes is really in the contract (the quote is snapped to the exact words).
    # Pre-squash the full contract ONCE and pass to locate_quote for every
    # clause — rebuilding it per-call was O(N) and burned ~1 minute of
    # wall clock on 500 clauses against a 1M-char doc.
    _squashed = _get_squashed(full_text)
    grounded, dropped_unverified = [], 0
    for c in all_clauses:
        txt = (c.get("original_text") or "").strip()
        if not txt:
            continue
        exact, how = locate_quote(txt, full_text, _cached=_squashed)
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
        # Pipeline item 2: carry the AI's partisan impact tag + client-
        # specific advice through to the UI. We fall back gracefully when
        # an older-prompt chunk didn't populate them.
        raw_impact = (c.get("impact") or "").strip()
        if "favor" in raw_impact.lower():
            impact = "Favors us"
        elif "harm" in raw_impact.lower() or raw_impact == "":
            # Default to "Harms us" when the AI left the field blank —
            # a flagged clause with no impact tag is more likely bad
            # for us than neutral (that's why it was flagged at all).
            impact = "Harms us"
        else:
            impact = "Neutral — monitor"
        client_advice = (c.get("client_specific_advice") or "").strip()
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
            # Partisan fields — exposed under both camelCase and
            # snake_case keys so a mixed React consumer can read either.
            "impact": impact,
            "clientImpact": impact,
            "client_specific_advice": client_advice,
            "clientSpecificAdvice": client_advice,
            # Carry through the AI's source classification so the frontend
            # can show a '🏛️ Firm rule' or '📘 Playbook' badge on risks
            # that specifically violated one of those rulebooks. Normalize
            # legacy / malformed values the same way the missing-clauses
            # merge does so a typo doesn't drop the badge.
            "source": (lambda _r: "firm_master" if _r in ("firm_master","firm","firm_rule")
                                   else "playbook" if _r == "playbook"
                                   else "general" if _r == "general"
                                   else "ai_suggested" if _r in ("ai_suggested","ai_proactive","ai")
                                   else "")(str(c.get("source") or "").strip().lower()),
        })

    report('Identifying missing standard clauses...', 80)
    missing_clauses = find_missing_clauses(full_text)

    # Pipeline item 2: merge the AI-generated "missing protections our
    # client would want" with the static checklist above. Dedupe by title
    # so a protection the deterministic checker already caught doesn't
    # get repeated. The AI's suggestions are more client-specific but
    # less reliable; put them AFTER the deterministic ones so the UI's
    # natural scan order (deterministic → AI) matches "safest first".
    # Normalize an AI 'source' string to one of our four canonical
    # values. Unknown / missing → 'ai_suggested' as the safe default.
    def _norm_source(raw):
        r = str(raw or "").strip().lower()
        if r in ("firm_master", "firm", "firm_rule"): return "firm_master"
        if r == "playbook": return "playbook"
        if r == "general": return "general"
        if r in ("ai_suggested", "ai_proactive", "ai"): return "ai_suggested"
        return "ai_suggested"
    # Source priority — higher wins when the SAME title appears in both
    # the deterministic 'missing_clauses' list and the AI's
    # 'missing_protections'. Previously the deterministic one was kept
    # (so a firm_master classification was silently dropped). Now:
    # firm_master > playbook > general > ai_suggested, and the higher-
    # priority item replaces the lower.
    _PRIO = {"firm_master": 3, "playbook": 2, "general": 1, "ai_suggested": 0}

    merged_by_title = {}
    order = []
    # Pass 1 — deterministic regex matches, tagged general.
    for m in missing_clauses or []:
        if not isinstance(m, dict):
            continue
        t = str(m.get("title") or m.get("name") or "").strip().lower()
        if not t:
            continue
        if "source" not in m:
            m = {**m, "source": "general"}
        if t not in merged_by_title:
            order.append(t)
        merged_by_title[t] = m
    # Pass 2 — AI items. If a title already exists, UPGRADE to the AI
    # entry when its source has higher priority (so a firm_master hit
    # replaces the generic 'general' entry on the same topic).
    for m in all_missing_proactive:
        t = str(m.get("title") or "").strip().lower()
        if not t:
            continue
        src = _norm_source(m.get("source"))
        new_entry = {
            "title": m.get("title") or "",
            "why_we_need_it": m.get("why_we_need_it") or "",
            "suggested_language": m.get("suggested_language") or "",
            "playbook_rule": m.get("playbook_rule") or "",
            "source": src,
        }
        existing = merged_by_title.get(t)
        if existing is None:
            order.append(t)
            merged_by_title[t] = new_entry
        else:
            if _PRIO.get(src, 0) > _PRIO.get(_norm_source(existing.get("source")), 0):
                # Keep deterministic fields the UI uses (id, model, basis)
                # but replace source + user-facing text with the AI's.
                upgraded = {**existing, **new_entry, "source": src}
                merged_by_title[t] = upgraded
    missing_clauses = [merged_by_title[t] for t in order]

    # Deterministic firm-rule tagging. The LLM is inconsistent about
    # setting source='firm_master' — same contract + checklist, back-to-
    # back runs can produce 2 firm_master tags one time and 0 the next.
    # Fall back to a keyword matcher: for each line in the firm master
    # checklist, extract the key nouns and scan every produced item's
    # title + rationale. If any noun appears, upgrade source to
    # firm_master (unless it's already playbook, which outranks it).
    # Playbook text (if any) gets the same treatment at 'playbook' tier.
    # Smaller stopword set — the previous version excluded 'cap', 'term',
    # 'contract', 'value' which gutted most firm rules down to a single
    # keyword and made matching too strict. Keep only true grammatical
    # noise.
    def _extract_keywords(text):
        import re
        if not text:
            return []
        stop = set("""
            a an the and or of to in for on by with from as is are be was were been
            must shall should will may can at by if then else such like including
            include that this it we us our its their his her they them you your
            no not nor
        """.split())
        lines = [ln.strip(" -•*·\t") for ln in str(text).splitlines() if ln.strip(" -•*·\t")]
        kw_sets = []
        for ln in lines:
            words = re.findall(r"[a-zA-Z][a-zA-Z\-/]{2,}", ln.lower())
            keep = [w for w in words if w not in stop and len(w) >= 3]
            # Keep the ORIGINAL line's whole words as a secondary signal
            # for substring matching ('arbitration' in 'arbitration seat'
            # appearing anywhere in an item hits even without a shared
            # second noun).
            if keep:
                # Also build 2-word phrases (bigrams of consecutive kept
                # words) — a hit on 'indemnity cap' as a whole phrase is a
                # near-certain firm-rule match.
                bigrams = set()
                for i in range(len(keep) - 1):
                    bigrams.add(f"{keep[i]} {keep[i+1]}")
                kw_sets.append((ln, set(keep), bigrams))
        return kw_sets

    def _match_source(item_text, kw_sets):
        """Return True on ANY of:
         - the item text contains one of the rule's 2-word phrases
           (near-certain match)
         - the item shares at least 1 distinctive keyword with the rule
           (relaxed from 2 — most firm rules reduce to very few keywords
           after stopword filtering and 2+ matches almost never happen
           on short rules like 'Payment terms: net 30 days maximum')
        """
        import re
        text = (item_text or "").lower()
        if not text:
            return False
        for _line, keep, bigrams in kw_sets:
            for bg in bigrams:
                if bg in text:
                    return True
            tokens = set(re.findall(r"[a-zA-Z][a-zA-Z\-/]{2,}", text))
            if any(k in tokens for k in keep):
                return True
        return False

    _firm_kws = _extract_keywords(firm_master_text)
    _play_kws = _extract_keywords(rule_book_text)

    if _firm_kws or _play_kws:
        def _upgrade(item, text_fields):
            text = " ".join(str(item.get(f) or "") for f in text_fields)
            cur = str(item.get("source") or "").lower()
            cur_prio = _PRIO.get(cur, 0)
            if _play_kws and _match_source(text, _play_kws):
                if _PRIO["playbook"] > cur_prio:
                    item["source"] = "playbook"
                    cur_prio = _PRIO["playbook"]
            if _firm_kws and _match_source(text, _firm_kws):
                if _PRIO["firm_master"] > cur_prio:
                    item["source"] = "firm_master"
            return item
        missing_clauses = [_upgrade(dict(m), ("title", "why_we_need_it", "rationale")) for m in missing_clauses]

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

    # Apply the same deterministic source upgrade to risks (formatted_
    # clauses) that missing_clauses already got. Scans the risk's title +
    # text for firm-rule / playbook keywords and upgrades source to
    # firm_master (or playbook) if a match is found. This runs AFTER the
    # LLM so a model that forgot to set source still gets the right badge.
    if _firm_kws or _play_kws:
        formatted_clauses = [_upgrade(dict(r), ("title", "excerpt", "original_text", "explanation"))
                             for r in formatted_clauses]

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
