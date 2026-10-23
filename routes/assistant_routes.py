"""
routes/assistant_routes.py - the conversational assistant surface.

Blueprint: no prefix (the public paths are absolute and stay byte-identical)
  GET  /api/document/<string:case_id>
  POST /api/chat
  GET  /api/kanoon-redirect

The kanoon regexes/helpers and force_pristine_groq_messages were
create_app() locals used only by these handlers; they are promoted
verbatim to module level here so the handlers can move without a closure.
"""
import json
import os
import re
import sqlite3
import urllib.parse

from bs4 import BeautifulSoup
from flask import Blueprint, jsonify, redirect, request
from flask_jwt_extended import jwt_required

assistant_bp = Blueprint("assistant", __name__)


_KANOON_DOC_ID_RE = re.compile(r'/doc(?:fragment)?/(\d+)')
_KANOON_CASE_SPLIT_RE = re.compile(r'\s+(?:v\.|vs\.?|versus)\s+', re.IGNORECASE)
_KANOON_WORD_RE = re.compile(r'[A-Za-z0-9]+')
# Em dash, en dash, hyphen-minus, curly double/single quotes, straight
# quotes, and non-breaking space — Kanoon's search silently returns
# zero results for a formInput containing any of these (routine in a
# pasted heading/citation, e.g. "Indian Contract Act — Free Consent
# Doctrine"). Not a raw string — \xa0 needs Python to actually decode
# it into the real non-breaking-space character; a raw string would
# leave it as the four literal characters backslash-x-a-0 instead. The
# plain "-" is placed last in the class so it's never misread as a
# range operator against a neighbouring \uXXXX-style escape.
_KANOON_DASH_QUOTE_RE = re.compile('[—–“”‘’"\'\xa0-]')
# LLM-generated citations occasionally arrive camelCase-glued with no
# spaces at all around legal separators, e.g. "Company vsFoodCorporation
# OfIndiaon 16 Nov" — Kanoon's own search then returns nothing, and
# _KANOON_CASE_SPLIT_RE above (which requires \s+ on BOTH sides of v/vs)
# never even recognizes it as a case citation. A blanket camelCase
# splitter would fix this but also shreds real names ("McDonald" ->
# "Mc Donald") and common words ("Corporation" ends in "-on", "Brand"
# ends in "-and") — each pattern below is bounded tightly enough to
# only fire on the specific glue point it targets, never mid-word:
#   - v./vs glue: only when "v"/"vs" is DIRECTLY followed by a capital
#     letter (the next party name) — "versus"/"very"/"value" all have a
#     lowercase letter next and are left untouched.
#   - on+date glue: only when "on" is directly followed by whitespace
#     then a digit (a hearing date) — "Corporation", "Washington",
#     "Amazon" etc. are never followed by "on \d" and are untouched.
#   - And glue: only when a literal capital "And" sits directly between
#     a lowercase letter and another capital letter (i.e. it's gluing
#     two words together) — "Brand", "Grand", "Command", "Understand"
#     all contain "and" but never as a capitalized word glued on both
#     sides, so none of them match.
_KANOON_VS_GLUE_RE = re.compile(r'\b([Vv][Ss]?\.?)([A-Z])')
_KANOON_ON_DATE_GLUE_RE = re.compile(r'([a-z])(on\s+\d)')
_KANOON_AND_GLUE_RE = re.compile(r'([a-z])And([A-Z])')
_KANOON_BRACKETS_RE = re.compile(r'\([^)]*\)|\[[^\]]*\]')
_KANOON_YEAR_PAREN_RE = re.compile(r'\(\s*(\d{4})\s*\)')
_KANOON_REPORTER_RE = re.compile(r'\b(SCC|AIR|SCR|INSC)\b', re.IGNORECASE)
# The exact list the task specifies for party-token extraction, reused
# everywhere a stopword filter is needed (party tokens, cleaning a
# non-case query, tokenizing hit text for scoring) rather than
# inventing a second, undocumented list for those other uses.
_KANOON_STOPWORDS = {
    'state', 'union', 'india', 'ltd', 'pvt', 'anr', 'ors', 'the', 'of', 'co', 'corp',
}
# Matches the START of the citation apparatus that routinely trails a
# pasted party name — "State of Kerala (1973) 4 SCC 225" — so it can be
# truncated off before tokenizing. Without this, "SCC"/"225" get treated
# as party-name tokens and pollute the title:() clause with citation
# noise no judgment title ever actually contains, defeating the whole
# point of title-scoping.
_KANOON_CITATION_TAIL_RE = re.compile(r'\(\s*\d{4}\s*\)|\b\d{4}\b|\b(?:SCC|AIR|SCR|INSC)\b', re.IGNORECASE)

def _kanoon_strip_citation_tail(text):
    match = _KANOON_CITATION_TAIL_RE.search(text or '')
    return text[:match.start()] if match else (text or '')

def _kanoon_strip_brackets(text):
    # Drops "(BALCO)"/"[Regn. No. 4]"-style asides entirely, including
    # their contents — these are abbreviations/annotations, not part of
    # the actual party name or search text.
    return _KANOON_BRACKETS_RE.sub(' ', text or '')

def _kanoon_tokenize(text):
    return [
        tok for tok in _KANOON_WORD_RE.findall(text or '')
        if tok.lower() not in _KANOON_STOPWORDS and len(tok) > 1
    ]

def _kanoon_extract_boosters(raw_query):
    """Citation signals pulled from the query BEFORE any bracket
    cleanup — the year lives inside the parens _kanoon_strip_brackets
    would otherwise delete. Safe to call with the dash/quote-cleaned
    query (parens are untouched by that cleanup), just not one that's
    already had its brackets stripped. Stored case-neutral/uppercase so
    a single upper-cased substring check at scoring time covers both
    booster types."""
    boosters = set()
    for year in _KANOON_YEAR_PAREN_RE.findall(raw_query):
        boosters.add(f"({year})")
    for tag in _KANOON_REPORTER_RE.findall(raw_query):
        boosters.add(tag.upper())
    return boosters

def _kanoon_title_clause(tokens):
    if not tokens:
        return ''
    return f"title:({' AND '.join(tokens)})"

def _kanoon_fetch_results(form_input):
    """One Kanoon search request -> its parsed result_title elements,
    or None on any network/HTTP failure. None must always be treated by
    the caller as 'give up, redirect to fallback_url' — never retried
    silently, per the network guardrail.

    Routed through ZenRows (premium proxy, 'in' exit node) whenever
    ZENROWS_API_KEY is configured — production runs from a
    datacenter/cloud-host IP that Kanoon routinely blocks or degrades,
    which no amount of header-spoofing from that host gets around.
    Falls back to a direct request only when the key is absent, i.e.
    local development from an ordinary residential IP.
    """
    import app as app_module
    zenrows_key = os.getenv("ZENROWS_API_KEY")
    target_url = f"https://indiankanoon.org/search/?formInput={urllib.parse.quote(form_input)}"

    try:
        if zenrows_key:
            resp = app_module.requests.get(
                "https://api.zenrows.com/v1/",
                # ZenRows' own param name is "apikey" (no underscore) —
                # confirmed live: sending "api_key" gets a 401 AUTH001
                # ("No apikey provided") on every single request, which
                # would silently degrade every production redirect to
                # the bare search page instead of a specific doc.
                params={
                    'apikey': zenrows_key,
                    'url': target_url,
                    'premium_proxy': 'true',
                    'proxy_country': 'in',
                },
                timeout=15,
            )
        else:
            resp = app_module.requests.get(
                "https://indiankanoon.org/search/",
                params={'formInput': form_input},
                timeout=5,
                headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                                        'Chrome/122.0.0.0 Safari/537.36'},
            )
        # A 403/5xx response body is still valid HTML (an error/block
        # page) — requests won't raise on its own, so raise_for_status()
        # is what actually routes a block or outage into the
        # RequestException branch below instead of silently parsing
        # zero results out of a block page.
        resp.raise_for_status()
    except app_module.requests.exceptions.RequestException as err:
        print(f"[KANOON ERROR] Proxy Mode ({'ZenRows' if zenrows_key else 'Direct'}): {err}")
        return None

    # Matched by class only, not class+tag — Kanoon's search page was
    # redesigned since this was first written; the result title element
    # is an <h4> today (it used to be a <div>), and tying the query to
    # one specific tag would silently match zero results the next time
    # the markup shifts again.
    return BeautifulSoup(resp.text, 'html.parser').find_all(class_='result_title')


def force_pristine_groq_messages(messages):
    clean = []
    allowed_keys = {'role', 'content', 'name', 'tool_calls', 'tool_call_id'}
    for m in messages:
        if not isinstance(m, dict):
            continue
        # Explicitly extract only safe API parameters
        sanitized_msg = {k: v for k, v in m.items() if k in allowed_keys}

        # Handle potential nested dictionary mutations inside tool_calls if they exist
        if 'tool_calls' in sanitized_msg and sanitized_msg['tool_calls'] is None:
            del sanitized_msg['tool_calls']

        clean.append(sanitized_msg)
    return clean


@assistant_bp.route('/api/kanoon-redirect', methods=['GET'])
def kanoon_redirect():
    query = request.args.get('query', '') or ''
    # fallback_url intentionally stays on the raw, unaltered query —
    # it's the last-resort "go search it yourself" link, so it should
    # reflect exactly what the user typed, not our cleaned-up version.
    fallback_url = f"https://indiankanoon.org/search/?formInput={urllib.parse.quote(query)}"

    # Kanoon's search silently returns zero results for a formInput
    # containing unicode dashes/smart-quotes/NBSP — routine in a pasted
    # heading or citation ("Indian Contract Act — Free Consent
    # Doctrine"). Cleaned BEFORE is_case detection: an NBSP standing in
    # for a normal space around "v."/"vs." could otherwise dodge the
    # \s+ boundaries in the case-split regex.
    cleaned_query = _KANOON_DASH_QUOTE_RE.sub(' ', query)
    # Restore spaces at the specific glue points malformed LLM citations
    # collapse — must run BEFORE is_case detection below, since
    # _KANOON_CASE_SPLIT_RE requires whitespace on both sides of v/vs
    # and would otherwise never recognize a glued citation as a case at
    # all. re.sub target strings only reference their OWN pattern's
    # capture groups, so running all three back-to-back is safe even
    # though each can shift where the next one's matches fall.
    cleaned_query = _KANOON_VS_GLUE_RE.sub(r'\1 \2', cleaned_query)
    cleaned_query = _KANOON_ON_DATE_GLUE_RE.sub(r'\1 \2', cleaned_query)
    cleaned_query = _KANOON_AND_GLUE_RE.sub(r'\1 And \2', cleaned_query)
    cleaned_query = re.sub(r'\s+', ' ', cleaned_query).strip()

    is_case = bool(_KANOON_CASE_SPLIT_RE.search(cleaned_query))

    if not is_case:
        # Statutory/doctrine queries ("Doctrine of Promissory Estoppel")
        # almost never repeat their exact phrasing inside any single
        # judgment's title+snippet, so the token-intersection scorer
        # below routinely scores every real, relevant hit as 0 and
        # punts to the bare search page even when Kanoon's own #1
        # result is a perfectly good answer — confirmed empirically:
        # a batch of realistic doctrine queries scored 0 across the
        # board despite Kanoon returning 10 real results each. Skip
        # scoring entirely here and trust Kanoon's own ranking instead.
        try:
            result_titles = _kanoon_fetch_results(cleaned_query)
            if result_titles:
                a_tag = result_titles[0].find('a', href=True)
                if a_tag:
                    # /doc(?:fragment)?/ — not a bare /doc/ — matches both
                    # of Kanoon's link forms: plain /doc/<id>/ when the
                    # match was in the title, /docfragment/<id>/ when it
                    # was in the body. A /doc/-only pattern silently drops
                    # to the fallback for the /docfragment/ case — and that
                    # case is the COMMON one here: sampled against several
                    # realistic doctrine queries, 3 of 4 top results linked
                    # via /docfragment/, not /doc/.
                    doc_match = _KANOON_DOC_ID_RE.search(a_tag['href'])
                    if doc_match:
                        return redirect(f"https://indiankanoon.org/doc/{doc_match.group(1)}/")
        except Exception as e:
            # A Kanoon markup change or unexpected parse error here must
            # still land the user on a working search page, not Flask's
            # default HTML 500 — this route backs a plain <a href> link
            # click, which can't render a JSON error to the user anyway.
            print(f"[KANOON REDIRECT ERROR] non-case branch: {e}")
        return redirect(fallback_url)

    citation_boosters = _kanoon_extract_boosters(cleaned_query)
    party_a_raw, party_b_raw = _KANOON_CASE_SPLIT_RE.split(cleaned_query, maxsplit=1)
    tokens_a = _kanoon_tokenize(_kanoon_strip_brackets(_kanoon_strip_citation_tail(party_a_raw)))[:3]
    tokens_b = _kanoon_tokenize(_kanoon_strip_brackets(_kanoon_strip_citation_tail(party_b_raw)))[:3]
    query_tokens = {t.lower() for t in tokens_a + tokens_b}
    clauses = [c for c in (_kanoon_title_clause(tokens_a), _kanoon_title_clause(tokens_b)) if c]
    # Degenerate case: stopword-filtering emptied BOTH parties (e.g.
    # "The State v. The Union") — title:() is invalid Lucene syntax,
    # so fall back to the cleaned query instead of sending Kanoon
    # malformed input.
    form_input = ' '.join(clauses) if clauses else cleaned_query

    # Attempt 1: title-scoped search.
    result_titles = _kanoon_fetch_results(form_input)
    if result_titles is None:
        return redirect(fallback_url)

    # Attempt 2: title:() scoping can legitimately return zero hits for a
    # case whose title doesn't literally contain both party names as
    # formatted (abbreviations, "& Ors" variants, etc.) — one plain retry
    # with the cleaned (not raw) query before giving up; retrying with
    # the UNCLEANED original would just reproduce the same
    # unicode-choking failure the cleanup step exists to fix. Skipped
    # when form_input already IS the cleaned query (a case query
    # degenerate enough that both parties fell back to it) — retrying
    # would just re-fetch the identical 0 results.
    if not result_titles and form_input != cleaned_query:
        result_titles = _kanoon_fetch_results(cleaned_query)
        if result_titles is None:
            return redirect(fallback_url)

    best_doc_id = None
    best_score = 0

    try:
        for title_el in result_titles:
            link = title_el.find('a', href=True)
            if not link:
                continue
            doc_match = _KANOON_DOC_ID_RE.search(link['href'])
            if not doc_match:
                continue
            doc_id = doc_match.group(1)

            # separator=' ' is required: Kanoon bolds individual matched
            # words ("Constitution of <b>India</b>"), and get_text()'s
            # default empty separator glues adjacent fragments across
            # tag boundaries into "ofIndia" — silently breaking any
            # token that crosses a bold-tag boundary.
            title_text = title_el.get_text(separator=' ', strip=True)

            # The snippet lives in a sibling <div class="headline"> next
            # to the <h4 class="result_title">, both inside a shared
            # <article class="result"> wrapper — fall back to searching
            # the whole result container in case a future markup shift
            # reorders the siblings.
            snippet_el = title_el.find_next_sibling(class_='headline')
            if snippet_el is None:
                result_container = title_el.find_parent(class_='result')
                snippet_el = result_container.find(class_='headline') if result_container else None
            snippet_text = snippet_el.get_text(separator=' ', strip=True) if snippet_el else ''
            combined_text = f"{title_text} {snippet_text}"

            hit_tokens = {t.lower() for t in _KANOON_WORD_RE.findall(combined_text)}
            score = len(query_tokens & hit_tokens)
            if score == 0:
                continue

            # Citation multiplier: collapse whitespace immediately
            # inside parens first — a bolded citation year renders as
            # "(<b>1973</b>)", and get_text's separator=' ' would
            # otherwise insert stray spaces ("( 1973 )") that break a
            # literal "(1973)" substring check.
            normalized = re.sub(r'\(\s+', '(', combined_text)
            normalized = re.sub(r'\s+\)', ')', normalized).upper()
            if any(booster in normalized for booster in citation_boosters):
                score *= 3

            if score > best_score:
                best_score = score
                best_doc_id = doc_id
    except Exception:
        return redirect(fallback_url)

    if best_doc_id and best_score > 0:
        return redirect(f"https://indiankanoon.org/doc/{best_doc_id}/")

    return redirect(fallback_url)


@assistant_bp.route('/api/document/<string:case_id>', methods=['GET', 'OPTIONS'])
def api_document_reconstruct(case_id):
    """Reconstructs a full worker.py-ingested judgment from its Pinecone
    chunks. Distinct from /api/legal-research/document/<case_id> above,
    which reads AI-drafted documents out of the local case_vault table —
    S3-ingested judgments were never written there, only into Pinecone.
    """
    import app as app_module
    if request.method == 'OPTIONS':
        return jsonify({}), 200

    if not app_module.PINECONE_CASE_ID_RE.match(case_id):
        return jsonify({"error": True, "message": "Invalid case_id format."}), 400

    try:
        pc = app_module.Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
        index = pc.Index(host=os.getenv("PINECONE_HOST"))
        namespace = os.getenv("PINECONE_NAMESPACE", "legal-cases")

        resolved_case_id = case_id
        if app_module.MD5_HASH_RE.match(case_id):
            # The caller only has a raw chunk vector id (e.g. a search
            # result whose metadata lacked case_id) — resolve the real
            # case_id from that one vector's metadata first.
            fetch_result = index.fetch(ids=[case_id], namespace=namespace)
            vector = fetch_result.vectors.get(case_id)
            if vector and vector.metadata:
                resolved_case_id = vector.metadata.get('case_id', case_id)

        # Dummy near-zero vector: this is a filter-only lookup, not a
        # similarity search — the score is discarded, so the vector's
        # direction doesn't matter, but a true [0.0]*N is undefined
        # under this index's cosine metric (division by zero) and would
        # error instead of just returning arbitrarily-ranked matches.
        query_result = index.query(
            vector=app_module.DUMMY_QUERY_VECTOR,
            filter={"case_id": resolved_case_id},
            top_k=3000,  # a large judgment can run to hundreds of chunks
            include_metadata=True,
            namespace=namespace,
        )

        matches = query_result.matches or []
        if not matches:
            return jsonify({"error": True, "message": f"Document with case_id '{resolved_case_id}' not found."}), 404

        # int() cast is required: Pinecone metadata typing isn't
        # guaranteed uniform across every historical ingestion run, and
        # a string sort would order chunks as 1, 10, 11, 2, 3... instead
        # of 1, 2, 3... 10, 11, silently scrambling the reassembled text.
        sorted_matches = sorted(
            matches,
            key=lambda m: int((m.metadata or {}).get('chunk_index', 0))
        )
        content = "\n\n".join((m.metadata or {}).get('text', '') for m in sorted_matches)

        return jsonify({
            "case_id": resolved_case_id,
            "title": app_module.format_case_title(resolved_case_id),
            "content": content,
        }), 200

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": True, "message": f"Failed to reconstruct document: {str(e)}"}), 500


@assistant_bp.route('/api/chat', methods=['POST', 'OPTIONS'])
@jwt_required()
def api_chat():
    import app as app_module
    if request.method == 'OPTIONS':
        return jsonify({}), 200
    chat_uid = app_module._current_vault_user_id()
    try:
        # 1. Safe Payload Parsing with force=True to handle missing/wrong Content-Type header
        data = request.get_json(force=True, silent=True) or {}
        query = data.get('query', '').strip()
        current_path = data.get('currentPath', '/')
        params = data.get('params', {})

        # Backward compatibility fallback
        if not query:
            query = data.get('question', '').strip()

        # 2. Dynamic Payload & DoS Protection (max 1500 chars)
        if len(query) > 1500:
            return jsonify({"error": True, "message": "Query exceeds maximum limit of 1500 characters."}), 400

        if not query:
            return jsonify({"error": True, "message": "No query or question provided."}), 400

        # Securely load GROQ_API_KEY from environment
        groq_api_key = os.getenv("GROQ_API_KEY")
        if not groq_api_key:
            raise ValueError("GROQ_API_KEY environment variable is not set.")

        # Initialize Groq Client
        client = app_module.Groq(api_key=groq_api_key)

        # 3. Anchored System Prompt & Context Injection
        system_instruction = (
            "You are LexAI, an AI Legal Associate and junior counsel embedded inside LexAmplify — an intelligent legal practice management platform for advocates practising under Indian law.\n\n"

            "YOUR PERSONA:\n"
            "You are a highly capable junior advocate trained in Indian law: IPC, CrPC, CPC, Constitution of India, IBC, Companies Act, Negotiable Instruments Act, Transfer of Property Act, IP law (Trade Marks Act, Patents Act, Copyright Act), Consumer Protection Act, Arbitration & Conciliation Act, and procedural law across all tiers of Indian courts.\n"
            "You think and respond like a diligent junior lawyer: precise, professionally cautious, well-researched, and always deferential to the senior advocate (the user). "
            "You draft documents in correct legal English, cite relevant provisions, identify procedural requirements, flag risks, and manage deadlines — all under the advocate's supervision.\n\n"

            "DAILY TASKS YOU HANDLE (examples — not exhaustive):\n"
            "- Draft petitions, plaints, written statements, bail applications, legal notices, NDAs, MOUs, agreements, affidavits, vakalatnamas\n"
            "- Research IPC/CrPC/CPC sections, Supreme Court and High Court precedents, bare act provisions\n"
            "- Navigate to any part of LexAmplify: High Courts, District Courts, Contract Analyzer, Conflict Engine, Calendar, Case Vault, War Room\n"
            "- Schedule hearings, drop-dead deadlines, tickler reminders, and court appearances in the Legal Calendar\n"
            "- Analyze uploaded contracts for risk clauses\n"
            "- Prepare hearing briefs and arguments for courtroom simulation\n"
            "- Save drafted documents to the Case Vault for the advocate's records\n\n"

            "NAVIGATION CAPABILITY:\n"
            "You can navigate to any feature of LexAmplify. Valid routes include:\n"
            "  /dashboard, /contract-analyzer, /court-resources, /conflict-engine, /calendar, /vault, /war-room\n"
            "When navigating to /court-resources, you may also specify a tab: supreme, highcourt, district, laws, forms, events, courtfee, enotary, iptracker.\n"
            "Use the navigate tool when the user gives a navigation command.\n\n"

            "CRITICAL EXECUTION MANDATE (TOOL CALLING):\n"
            "1. Use native JSON tool calling — never output raw XML tags.\n"
            "2. Execute EXACTLY ONE tool per turn. Never chain tools.\n"
            "3. Always provide ALL required parameters. Never pass empty {} objects.\n\n"

            "WORKFLOW MANDATE (THE 3-PHASE PIPELINE):\n"
            "You orchestrate a strict state machine: Draft → Approval → Simulate.\n\n"

            "PHASE 1 — DRAFTING:\n"
            "When the advocate requests a document, invoke the document generation tool, present the draft, and STOP. Never assume approval.\n\n"

            "PHASE 2 — HUMAN-IN-THE-LOOP APPROVAL:\n"
            "You cannot save to the Case Vault yourself. Wait for the advocate to approve or reject via the UI.\n"
            "  If Rejected: acknowledge and ask for revised parameters.\n"
            "  If Approved: confirm the document is now saved in the Case Vault.\n\n"

            "PHASE 3 — SIMULATION:\n"
            "Never launch a courtroom simulation from conversational memory alone. Always retrieve the approved document from the Case Vault first via the appropriate tool.\n\n"

            "ANTI-CHAINING GUARDRAIL:\n"
            "For multi-step commands like 'Draft, save, and simulate', execute only Phase 1. "
            "Explicitly tell the advocate you are pausing for their UI approval before proceeding further."
        )

        # Define Tool Schema for Groq SDK
        tools = [
            {
                "type": "function",
                "function": {
                    "name": "propose_calendar_events",
                    "description": (
                        "Propose deadlines and tickler warning events (e.g. 30, 14, or 7 days prior to a critical date) "
                        "based on user scheduling requests. STRICT RULE: If you have no events to propose, do not invoke this tool."
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "events": {
                                "type": "array",
                                "description": "The list of proposed events.",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "event_date": {
                                            "type": "string",
                                            "description": "The date of the event in YYYY-MM-DD format (e.g. '2026-06-01')."
                                        },
                                        "event_type": {
                                            "type": "string",
                                            "enum": ["drop_dead", "tickler", "appearance", "task"],
                                            "description": "The type of the event."
                                        },
                                        "title": {
                                            "type": "string",
                                            "description": "The title or description of the event."
                                        },
                                        "related_case_id": {
                                            "type": "string",
                                            "description": "The related case ID if applicable, or an empty string."
                                        }
                                    },
                                    "required": ["event_date", "event_type", "title", "related_case_id"]
                                }
                            }
                        }
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "navigate_ui",
                    "description": "Navigate the user interface to a specific page or route in the application.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "target_route": {
                                "type": "string",
                                "description": "The target route to navigate to (e.g. '/dashboard')."
                            }
                        },
                        "required": ["target_route"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "propose_document_draft",
                    "description": "Propose a draft of a legal document (e.g. bail application, petition, agreement) for user review and approval.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "case_id": {
                                "type": "string",
                                "description": "The related case ID."
                            },
                            "title": {
                                "type": "string",
                                "description": "The title of the document draft."
                            },
                            "doc_type": {
                                "type": "string",
                                "description": "The document type (e.g. 'Bail Application', 'Contract')."
                            },
                            "content": {
                                "type": "string",
                                "description": "The complete text content of the drafted legal document."
                            }
                        },
                        "required": ["case_id", "title", "doc_type", "content"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "search_case_vault",
                    "description": "Search the Case Vault. If you know the exact Case ID, provide it in case_id. If you do not know the exact ID, provide a detailed query in search_query (e.g., \"bail application for chain snatching\"). DO NOT guess or hallucinate case_id numbers.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "case_id": {
                                "type": ["string", "null"],
                                "description": "The specific case identifier. If the user does not specify a case, you may pass null. If you pass null, you MUST ask the user 'Which case vault would you like me to search?'"
                            },
                            "search_query": {
                                "type": ["string", "null"],
                                "description": "A semantic text query to find the document by keywords if the case_id is unknown."
                            }
                        }
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "run_courtroom_simulation",
                    "description": "Run a 5-stage agentic courtroom simulation based on a saved document in the Case Vault.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "case_id": {
                                "type": "string",
                                "description": "The case ID of the document in the Case Vault."
                            },
                            "client_side": {
                                "type": "string",
                                "description": "The client side, e.g., 'Appellant', 'Respondent', 'Plaintiff', 'Defendant'."
                            }
                        },
                        "required": ["case_id", "client_side"]
                    }
                }
            }
        ]

        incoming_messages = data.get('messages', [])

        if incoming_messages:
            clean_messages = force_pristine_groq_messages(incoming_messages)
        else:
            clean_messages = [{"role": "user", "content": f"User query: {query}"}]

        messages = [{"role": "system", "content": system_instruction}] + clean_messages

        # 4. The First Groq Call (Decision Phase)
        sanitized_messages = force_pristine_groq_messages(messages)

        response = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=sanitized_messages,
            tools=tools,
            tool_choice="auto"
        )

        # 5. Interceptor Logic (Context Preservation)
        response_message = response.choices[0].message
        tool_calls = response_message.tool_calls

        if tool_calls:
            tool_call = tool_calls[0]
            tool_name = tool_call.function.name

            # Dynamic Argument Parsing Guardrail
            try:
                args = json.loads(tool_call.function.arguments)
                # Dynamically check required fields against our active schema
                active_schema = next((t["function"] for t in tools if t["function"]["name"] == tool_name), None)
                if active_schema and "parameters" in active_schema:
                    required_fields = active_schema["parameters"].get("required", [])
                    missing_fields = [f for f in required_fields if f not in args]
                    if missing_fields:
                        raise ValueError(f"Missing required parameters: {missing_fields}")
            except Exception as e:
                # Intercept before hitting external gateways and feed error back to LLM
                error_feedback = (
                    f"System Guardrail Alert: Your tool invocation for '{tool_name}' failed validation. "
                    f"Error: {str(e)}. "
                    "You MUST retry your function call and ensure you provide all required parameters exactly as specified in the schema."
                )

                try:
                    assistant_msg = response_message.model_dump()
                except AttributeError:
                    try:
                        assistant_msg = response_message.dict()
                    except AttributeError:
                        assistant_msg = {
                            "role": "assistant",
                            "content": response_message.content,
                            "tool_calls": [{"id": tool_call.id, "type": "function", "function": {"name": tool_call.function.name, "arguments": tool_call.function.arguments}}]
                        }

                messages.append(assistant_msg)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "name": tool_name,
                    "content": error_feedback
                })

                retry_sanitized = force_pristine_groq_messages(messages)
                retry_response = client.chat.completions.create(
                    model="llama-3.1-8b-instant",
                    messages=retry_sanitized
                )

                fallback_text = retry_response.choices[0].message.content or "Tool validation failed. Please try again."
                return jsonify({
                    "action": "chat",
                    "message": fallback_text,
                    "answer": fallback_text
                }), 200

            if tool_name == "run_courtroom_simulation":
                case_id = args.get('case_id')
                client_side = args.get('client_side', 'Appellant')

                conn = app_module.db
                c = conn.cursor()
                c.execute(
                    "SELECT content FROM case_vault WHERE case_id = ? AND (user_id = ? OR user_id IS NULL) "
                    "ORDER BY created_at DESC LIMIT 1",
                    (str(case_id), chat_uid)
                )
                row = c.fetchone()
                if not row or not row[0]:
                    return jsonify({"error": True, "message": f"Document with Case ID '{case_id}' not found in the Case Vault."}), 400

                content = row[0]
                truncated_content = content[:8000]

                stage1_prompt = (
                    "Analyze the following legal document content:\n\n"
                    f"{truncated_content}\n\n"
                    "Task:\n"
                    "1. Extract the top 3 core legal issues in this case.\n"
                    "2. Summarize these issues into a single 5-word search query string.\n\n"
                    "You must respond with a JSON object. The JSON object must contain exactly these keys:\n"
                    '- "extracted_issues": "A summary string listing the top 3 core legal issues."\n'
                    '- "search_query": "A single 5-word search query string."'
                )

                res_stage1 = client.chat.completions.create(
                    model="openai/gpt-oss-120b",
                    messages=force_pristine_groq_messages([{"role": "user", "content": stage1_prompt}]),
                    response_format={"type": "json_object"}
                )

                stage1_data = app_module.extract_json_from_llm_response(res_stage1.choices[0].message.content)
                if not isinstance(stage1_data, dict):
                    return jsonify({
                        "error": True,
                        "message": "Stage 1 parsing failed: AI returned an unparseable response.",
                        "code": "LLM_JSON_PARSE_ERROR",
                    }), 502

                stage1_text = stage1_data.get("extracted_issues", "")
                search_query = stage1_data.get("search_query", "")

                tavily_results = []
                tavily_key = os.getenv("TAVILY_API_KEY")
                if tavily_key:
                    try:
                        tavily_client = app_module.TavilyClient(api_key=tavily_key)
                        query = f"Indian Supreme Court landmark judgments regarding {search_query} site:indiankanoon.org"
                        search_result = tavily_client.search(query=query, search_depth="advanced", max_results=3)
                        results = search_result.get("results", [])
                        for r in results:
                            tavily_results.append({
                                "title": r.get('title', ''),
                                "snippet": r.get('content', ''),
                                "url": r.get('url', '')
                            })
                    except Exception as e:
                        print(f"Tavily search failed: {e}")
                        tavily_results = []

                stage3_prompt = (
                    f"Act as an Indian Advocate representing the {client_side}.\n"
                    "Draft a structured opening argument for your case.\n"
                    "You MUST cite the provided web search cases to back up your claims if they are relevant.\n\n"
                    f"Facts and Issues:\n{stage1_text}\n\n"
                    f"Live Web Search Cases Retrieved:\n{json.dumps(tavily_results, indent=2)}\n\n"
                    "For any specific fact not given above (party names, dates, monetary amounts, "
                    "case/appeal numbers, court name, etc.), insert a placeholder in square brackets "
                    "describing what belongs there, e.g. [Appellant's Name], [Rs. Amount], [Date]. "
                    "Do NOT use dotted lines, ellipses (…), underscores, or blank spaces as "
                    "placeholders — always use the bracketed form so it renders as a fillable field.\n"
                    "Provide only the drafted opening argument text. Do not include conversational text or markdown code blocks."
                )

                res_stage3 = client.chat.completions.create(
                    model="openai/gpt-oss-120b",
                    messages=force_pristine_groq_messages([{"role": "user", "content": stage3_prompt}])
                )
                stage3_text = res_stage3.choices[0].message.content or ""

                stage4_prompt = (
                    "Act as the opposing counsel in this litigation.\n"
                    f"Here is the opening argument presented by the {client_side}:\n\n"
                    f"{stage3_text}\n\n"
                    "Identify legal weaknesses and generate aggressive counter-questions. For each question, provide a suggested rebuttal for the other side to defend themselves.\n\n"
                    "You must respond with a JSON object. The JSON object must contain exactly one key:\n"
                    '- "opposing_counter_questions": A list of objects, where each object contains exactly:\n'
                    '    - "question": "The opposing counsel\'s objection or counter-question string."\n'
                    '    - "suggested_rebuttal": "A suggested defense rebuttal string."'
                )

                res_stage4 = client.chat.completions.create(
                    model="openai/gpt-oss-120b",
                    messages=force_pristine_groq_messages([{"role": "user", "content": stage4_prompt}]),
                    response_format={"type": "json_object"}
                )

                stage4_json = app_module.extract_json_from_llm_response(res_stage4.choices[0].message.content)
                if not isinstance(stage4_json, dict):
                    # Stages 1-3 already succeeded and are real, usable
                    # data — only the red-team sub-section failed to
                    # parse, so the overall response still degrades
                    # gracefully (with the failure visibly marked in the
                    # fallback question itself) rather than discarding
                    # everything the pipeline already produced.
                    stage4_json = {"opposing_counter_questions": [{"question": "Failed to parse opponent arguments.", "suggested_rebuttal": res_stage4.choices[0].message.content}]}

                return jsonify({
                    "action": "simulate_courtroom",
                    "simulationData": {
                        "client_side": client_side,
                        "extracted_issues": stage1_text,
                        "live_citations": tavily_results,
                        "opening_argument": stage3_text,
                        "red_team": stage4_json
                    },
                    "message": "Dynamic simulation complete. Transferring to the War Room..."
                }), 200

            elif tool_name == "propose_calendar_events":
                proposed_events = args.get('events', [])
                return jsonify({
                    "action": "confirm_schedule",
                    "proposed_events": proposed_events,
                    "message": "I have drafted the schedule and ticklers. Please review and approve.",
                    "answer": "I have drafted the schedule and ticklers. Please review and approve."
                }), 200

            elif tool_name == "propose_document_draft":
                # INTERCEPT IMMEDIATELY. Do NOT write to DB.
                return jsonify({
                    "action": "review_document",
                    "draft": args,
                    "message": "Draft ready. Please review and approve to save to the Vault.",
                    "answer": "Draft ready. Please review and approve to save to the Vault."
                }), 200

            elif tool_name == "search_case_vault":
                conn = app_module.db
                old_row_factory = conn.row_factory
                conn.row_factory = sqlite3.Row
                try:
                    c = conn.cursor()
                    case_id = args.get("case_id")
                    search_query = args.get("search_query")

                    if case_id and str(case_id).lower() != "null":
                        c.execute(
                            "SELECT * FROM case_vault WHERE case_id = ? AND (user_id = ? OR user_id IS NULL) "
                            "ORDER BY created_at DESC",
                            (str(case_id), chat_uid)
                        )
                        rows = c.fetchall()
                    elif search_query:
                        c.execute(
                            "SELECT * FROM case_vault WHERE user_id = ? OR user_id IS NULL ORDER BY created_at DESC",
                            (chat_uid,)
                        )
                        all_docs = c.fetchall()
                        stop_words = {"a", "an", "the", "and", "or", "but", "if", "for", "with", "about", "as", "by", "in", "to", "of", "on", "is", "are"}
                        keywords = [w.lower() for w in search_query.split() if w.lower() not in stop_words]

                        best_doc = None
                        max_overlap = 0

                        for doc in all_docs:
                            doc_text = (str(doc['title']) + " " + str(doc['content'])).lower()
                            overlap = sum(1 for kw in keywords if kw in doc_text)
                            if overlap > max_overlap:
                                max_overlap = overlap
                                best_doc = doc

                        rows = [best_doc] if best_doc else []
                    else:
                        c.execute(
                            "SELECT * FROM case_vault WHERE user_id = ? OR user_id IS NULL ORDER BY created_at DESC",
                            (chat_uid,)
                        )
                        rows = c.fetchall()
                finally:
                    conn.row_factory = old_row_factory

                results = []
                for row in rows:
                    results.append(
                        f"Document ID: {row['id']}\n"
                        f"Case ID: {row['case_id']}\n"
                        f"Title: {row['title']}\n"
                        f"Type: {row['doc_type']}\n"
                        f"Created At: {row['created_at']}\n"
                        f"Content:\n{row['content']}\n"
                        "---"
                    )

                if results:
                    formatted_vault_results = "\n".join(results)
                else:
                    if args.get("search_query"):
                        formatted_vault_results = "No documents found matching this query in the Case Vault."
                    else:
                        formatted_vault_results = "No documents found in the Case Vault."

                # Convert response_message to dict to be safe or use model_dump
                try:
                    assistant_msg = response_message.model_dump()
                except AttributeError:
                    try:
                        assistant_msg = response_message.dict()
                    except AttributeError:
                        assistant_msg = {
                            "role": "assistant",
                            "content": response_message.content,
                            "tool_calls": [
                                {
                                    "id": tool_call.id,
                                    "type": "function",
                                    "function": {
                                        "name": tool_call.function.name,
                                        "arguments": tool_call.function.arguments
                                    }
                                }
                            ]
                        }

                messages.append(assistant_msg)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "name": "search_case_vault",
                    "content": formatted_vault_results
                })

                sanitized_second_messages = force_pristine_groq_messages(messages)

                second_response = client.chat.completions.create(
                    model="llama-3.1-8b-instant",
                    messages=sanitized_second_messages
                )
                final_text = second_response.choices[0].message.content or ""
                return jsonify({
                    "action": "chat",
                    "message": final_text,
                    "answer": final_text
                }), 200

            elif tool_name == "navigate_ui":
                # INTERCEPT IMMEDIATELY. Do NOT make a second Groq call.
                target_route = args.get("target_route")

                # Titanium Route Validation
                valid_routes = ['/dashboard', '/contract-analyzer', '/court-resources', '/conflict-engine', '/calendar', '/vault']
                if target_route in valid_routes:
                    return jsonify({
                        "action": "navigate",
                        "target_route": target_route,
                        "message": "Navigating to requested module...",
                        "answer": "Navigating to requested module..."
                    }), 200
                else:
                    return jsonify({
                        "action": "chat",
                        "message": "I cannot navigate to that specific module.",
                        "answer": "I cannot navigate to that specific module."
                    }), 200
            else:
                # Graceful fallback for any other tool/hallucination
                return jsonify({
                    "action": "chat",
                    "message": "I cannot perform that action right now.",
                    "answer": "I cannot perform that action right now."
                }), 200
        else:
            final_text = response_message.content or ""
            # 4. Fallback: Standard chat (no tools called)
            return jsonify({
                "action": "chat",
                "message": final_text,
                "answer": final_text
            }), 200

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({"error": True, "message": str(e)}), 500
