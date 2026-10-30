"""
utils/dispute_ai.py

Grounded AI for the Auto-Draft Studio "Disputes" library.

Design goal: the model must not be able to hallucinate law into a filing.

  1. The legal skeleton (statutes, forum, limitation, grounds, prayers) comes
     from the curated catalog (data/dispute_catalog.json), never from the LLM.
  2. The LLM is only asked to write NARRATIVE slots (fact paragraphs and the
     elaboration of each ground) from the facts the lawyer typed, as JSON that
     is validated here against the catalog entry.
  3. Everything the LLM returns goes through guard_text():
       * any section/article/order number that is not in the catalog entry is
         tagged  [verify: not in library]
       * any case-law reference not present in the catalog entry is removed
       * any figure (>= 3 digits) that is not in the lawyer's facts or the
         catalog entry is tagged  [verify: figure not in your facts]
  4. Q&A and the matter-finder use retrieval over the same catalog and refuse
     to answer from memory; the matcher's ids are validated against the catalog.

Limits of the guard (stated honestly): it compares section NUMBERS, not the
Act they belong to, so "Section 9 of the wrong Act" can pass if some other
Act's Section 9 is in the entry. It cannot judge whether a paragraph is
persuasive. It is a backstop, not a substitute for the lawyer reading the draft.
"""
import json
import os
import re
from functools import lru_cache

_CATALOG_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "dispute_catalog.json")

MAX_FACT_VALUE = 2000
MAX_FACTS_TOTAL = 14000
MIN_FACT_CHARS_FOR_AI = 40


# ───────────────────────── catalog ─────────────────────────
@lru_cache(maxsize=1)
def load_catalog(path: str = _CATALOG_PATH) -> dict:
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def get_dispute(dispute_id: str, catalog: dict = None):
    catalog = catalog or load_catalog()
    for d in catalog["disputes"]:
        if d["id"] == dispute_id:
            return d
    return None


def base_fields(dispute: dict, catalog: dict = None) -> list:
    catalog = catalog or load_catalog()
    return catalog["bases"].get(dispute["kind"], [])


def _label_for(dispute: dict, key: str, catalog: dict = None) -> str:
    for f in list(base_fields(dispute, catalog)) + list(dispute.get("facts", [])):
        if f["key"] == key:
            return f["label"]
    return key


# ───────────────────────── keyword matching ─────────────────────────
_STOP = set("""a an the and or of to in on for with by at from is are was were be been being this that these those it its as
i me my we our you your he she they them their his her not no do does did have has had will would can could should may might
about into over under after before against between during without within than then so if but also very more most some any
want need needs please help file filing draft case matter client want get got""".split())


def _tokens(text: str) -> list:
    return [t for t in re.findall(r"[a-z0-9]+", (text or "").lower()) if t not in _STOP and len(t) > 1]


def score_disputes(query: str, catalog: dict = None, limit: int = 8) -> list:
    """Deterministic keyword ranking. keywords x3, title x2, blurb/doc/forum x1."""
    catalog = catalog or load_catalog()
    q = _tokens(query)
    if not q:
        return []
    qset = set(q)
    out = []
    for d in catalog["disputes"]:
        kw = set(_tokens(d.get("keywords", "")))
        ti = set(_tokens(d.get("title", "")))
        rest = set(_tokens(" ".join([d.get("blurb", ""), d.get("doc", ""), d.get("forum", "")])))
        s = 3 * len(qset & kw) + 2 * len(qset & ti) + len(qset & rest)
        # small bonus for exact numeric statute hints ("138", "498a", "482")
        for t in qset:
            if t.isdigit() and any(t in (x.get("ref", "").lower()) for x in d.get("statutes", [])):
                s += 2
        if s > 0:
            out.append((s, d["id"]))
    out.sort(key=lambda x: (-x[0], x[1]))
    return [{"id": i, "score": s} for s, i in out[:limit]]


# ───────────────────────── blueprint text ─────────────────────────
def _statute_lines(d: dict) -> str:
    return "\n".join(f"- {s['ref']}" + (f": {s['note']}" if s.get("note") else "") for s in d.get("statutes", []))


def blueprint_text(d: dict, compact: bool = False) -> str:
    parts = [
        f"ID: {d['id']}", f"DOCUMENT: {d['doc']}", f"FORUM: {d['forum']}",
        "STATUTES (the only provisions that may be cited):", _statute_lines(d),
        f"LIMITATION: {d.get('limitation') or 'not stated - lawyer to verify'}",
    ]
    if not compact:
        if d.get("outline"):
            parts += ["OUTLINE (order of the facts section):"] + [f"{i+1}. {o}" for i, o in enumerate(d["outline"])]
        if d.get("grounds"):
            parts += ["GROUND SEEDS:"] + [f"G{i+1}. {g}" for i, g in enumerate(d["grounds"])]
    else:
        if d.get("grounds"):
            parts += ["GROUNDS: " + " | ".join(d["grounds"][:4])]
    if d.get("cautions"):
        parts += ["CAUTIONS: " + " | ".join(d["cautions"][:3])]
    if d.get("pre"):
        parts += ["BEFORE FILING: " + " | ".join(d["pre"][:3])]
    return "\n".join(parts)


def _dispute_corpus(d: dict) -> str:
    """Everything the entry itself says - the source of allowed citations/figures."""
    bits = [d.get("doc", ""), d.get("forum", ""), d.get("limitation", ""), d.get("blurb", "")]
    bits += [f"{s['ref']} {s.get('note', '')}" for s in d.get("statutes", [])]
    for k in ("pre", "outline", "grounds", "prayers", "cautions", "annex"):
        bits += d.get(k, [])
    bits += [f"{s['h']} {s['b']}" for s in d.get("sections", [])]
    return "\n".join(bits)


# ───────────────────────── guard ─────────────────────────
_ROMAN = r"[IVXLCDM]{1,8}"
_CITE_RE = re.compile(
    r"(?P<kind>\bSections?\b|\bSec\.|\bss?\.|\bArticles?\b|\bArt\.|\bOrder\b)\s*"
    r"(?P<nums>(?:%s|\d+[A-Za-z]?)(?:\([0-9A-Za-z]+\))*(?:\s*(?:,|and|to|&|-)\s*(?:\d+[A-Za-z]?)(?:\([0-9A-Za-z]+\))*)*)" % _ROMAN,
)
_NUM_SPLIT = re.compile(r"\s*(?:,|and|to|&|-)\s*")


def _family(kind: str) -> str:
    k = kind.lower().rstrip(".")
    if k.startswith("art"):
        return "article"
    if k == "order":
        return "order"
    return "section"


def citation_pairs(text: str) -> set:
    pairs = set()
    for m in _CITE_RE.finditer(text or ""):
        fam = _family(m.group("kind"))
        for raw in _NUM_SPLIT.split(m.group("nums")):
            base = re.sub(r"\(.*", "", raw).strip().upper()
            if base:
                pairs.add((fam, base))
    return pairs


_CASE_RE = re.compile(
    r"(?:(?:[A-Z][\w.&'\-]*\s+){1,4}(?:v\.|vs\.?|versus)\s+(?:[A-Z][\w.&'\-]*\s*){1,5})"
    r"|\bAIR\s+\d{4}\s+\w+\s+\d+"
    r"|\(\d{4}\)\s*\d+\s*(?:SCC|SCR|SCALE)\b(?:\s*\d+)?"
    r"|\b\d{4}\s+SCC\s+OnLine\s+\w+\s+\d+"
    r"|\bMANU/[A-Z]+/\d+/\d{4}"
    r"|\b\d{4}\s*\(\d+\)\s*(?:SCC|SCR|SCALE)\s*\d*"
    r"|\bCriLJ\s+\d+|\bCri\.?\s*L\.?J\.?\s+\d+"
)
_NUM_RE = re.compile(r"(?<![\w./-])(?:Rs\.?\s?|INR\s?|₹\s?)?(\d[\d,]*(?:\.\d+)?)(?![\w/-])")
_WORDNUM = r"(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|forty-five|sixty|ninety|one hundred and twenty|hundred and twenty|twelve)"
_PERIOD_RE = re.compile(r"\b(\d{1,3}|%s)[\s-]+(day|days|month|months|year|years|week|weeks|hour|hours)\b" % _WORDNUM, re.I)
_HTML_RE = re.compile(r"<[^>]{1,200}>")
_MD_RE = re.compile(r"(\*\*|__|`{1,3})")
_LEAD_NUM_RE = re.compile(r"^\s*(?:\(?\d{1,2}[.)]|[-*•])\s+")


def clean_text(text: str) -> str:
    t = str(text or "")
    t = _HTML_RE.sub(" ", t)
    t = _MD_RE.sub("", t)
    t = t.replace("\r", "")
    t = re.sub(r"\s*\n\s*", " ", t)
    t = _LEAD_NUM_RE.sub("", t)
    return re.sub(r"\s{2,}", " ", t).strip()


def digits_in(text: str) -> set:
    out = set()
    for m in _NUM_RE.finditer(text or ""):
        d = m.group(1).replace(",", "").split(".")[0]
        if d:
            out.add(d)
    return out


def guard_text(text: str, allowed_pairs: set, allowed_corpus: str, source_digits: set, source_text: str = ""):
    """Return (guarded_text, flags). Never adds law; only flags or removes."""
    flags = []
    corpus_l = (allowed_corpus or "").lower()
    period_src = (corpus_l + "\n" + (source_text or "").lower())

    # 1. case law: remove unless it appears verbatim in the catalog entry
    def _case(m):
        s = m.group(0).strip()
        if s.lower() in corpus_l:
            return m.group(0)
        flags.append({"type": "case_removed", "text": s})
        return "[case reference removed - verify]"
    out = _CASE_RE.sub(_case, text)

    # 2. statute / article / order numbers not in the entry
    pieces, last = [], 0
    for m in _CITE_RE.finditer(out):
        fam = _family(m.group("kind"))
        bad = []
        for raw in _NUM_SPLIT.split(m.group("nums")):
            base = re.sub(r"\(.*", "", raw).strip().upper()
            if base and (fam, base) not in allowed_pairs:
                bad.append(base)
        pieces.append(out[last:m.end()])
        if bad:
            flags.append({"type": "citation_not_in_library", "text": m.group(0).strip()})
            pieces.append(" [verify: not in library]")
        last = m.end()
    pieces.append(out[last:])
    out = "".join(pieces)

    # 3. figures not in the facts / library
    pieces, last = [], 0
    for m in _NUM_RE.finditer(out):
        d = m.group(1).replace(",", "").split(".")[0]
        if len(d) < 3 or d in source_digits:
            continue
        # skip figures inside a citation we already handled (e.g. Section 482) or a "[verify" tag
        ctx = out[max(0, m.start() - 12):m.start()].lower()
        if re.search(r"(section|sections|sec\.|s\.|ss\.|article|articles|art\.|order)\s*$", ctx):
            continue
        pieces.append(out[last:m.end()])
        pieces.append(" [verify: figure not in your facts]")
        flags.append({"type": "figure_not_in_facts", "text": m.group(0).strip()})
        last = m.end()
    pieces.append(out[last:])
    out = "".join(pieces)

    # 4. limitation / notice periods ("30 days", "three months") not in the entry or the facts
    pieces, last = [], 0
    for m in _PERIOD_RE.finditer(out):
        phrase = re.sub(r"[\s-]+", " ", m.group(0).lower())
        norm_src = re.sub(r"[\s-]+", " ", period_src)
        unit = re.sub(r"s$", "", m.group(2).lower())
        if phrase in norm_src or (m.group(1).lower() + " " + unit) in norm_src or (m.group(1).lower() + " " + unit + "s") in norm_src:
            continue
        pieces.append(out[last:m.end()])
        pieces.append(" [verify: period not in library]")
        flags.append({"type": "period_not_in_library", "text": m.group(0)})
        last = m.end()
    pieces.append(out[last:])
    return "".join(pieces), flags


# ───────────────────────── facts ─────────────────────────
def normalise_facts(facts) -> dict:
    """Keep only string values, trimmed and capped."""
    out, total = {}, 0
    if not isinstance(facts, dict):
        return out
    for k, v in facts.items():
        if not isinstance(k, str) or not re.fullmatch(r"[A-Za-z0-9_]{1,40}", k):
            continue
        if v is None:
            continue
        s = str(v).strip()
        if not s:
            continue
        s = s[:MAX_FACT_VALUE]
        total += len(s)
        if total > MAX_FACTS_TOTAL:
            break
        out[k] = s
    return out


def facts_block(d: dict, facts: dict, catalog: dict = None) -> str:
    lines = []
    for k, v in facts.items():
        lines.append(f"- {_label_for(d, k, catalog)}: {v}")
    return "\n".join(lines)


# ───────────────────────── LLM plumbing (patched in tests) ─────────────────────────
def _llm(system_prompt: str, user_msg: str, **kw) -> str:
    from utils.ai_helper import ask_groq
    return ask_groq(system_prompt, user_msg, **kw)


def _parse_json(raw: str):
    try:
        from utils.ai_helper import extract_json_from_llm_response
        return extract_json_from_llm_response(raw)
    except Exception:
        t = re.sub(r"^```(?:json)?\s*|\s*```$", "", (raw or "").strip(), flags=re.M).strip()
        try:
            return json.loads(t)
        except Exception:
            m = re.search(r"\{.*\}", t, re.S)
            if m:
                try:
                    return json.loads(m.group(0))
                except Exception:
                    return None
            return None


# ───────────────────────── drafting ─────────────────────────
DRAFT_SYSTEM = (
    "You write ONLY the narrative slots of an Indian legal document. The legal skeleton (statutes, forum, "
    "limitation, prayers) is fixed by the LIBRARY ENTRY and is inserted by the application - you do not write it.\n\n"
    "HARD RULES\n"
    "1. Use ONLY facts found under LAWYER FACTS. Never invent or infer a name, date, amount, place, document, "
    "event, relationship or motive. If something needed is not in the facts, do not write it - add a short item "
    "to \"missing\" instead. Where a sentence needs a detail that was not supplied, leave a [bracketed placeholder].\n"
    "2. Cite NO statute, section, article, rule or order that is not printed under STATUTES in the LIBRARY ENTRY. "
    "Cite NO case law, judgment, law report or court decision at all - not even famous ones.\n"
    "3. Style: formal Indian pleading, third person, past tense for events. Plain text only - no markdown, no HTML, "
    "no numbering (the application numbers the paragraphs), no headings.\n"
    "4. \"facts_narrative\": 3 to 12 paragraphs following the OUTLINE order, each 1-4 sentences.\n"
    "5. \"grounds\": one string per GROUND SEED, in the same order, elaborating that seed with the LAWYER FACTS. "
    "If the facts do not support a seed, return the seed text unchanged with its brackets.\n"
    "6. Output a single JSON object and nothing else:\n"
    "{\"facts_narrative\": [\"...\"], \"grounds\": [\"...\"], \"missing\": [\"...\"]}\n"
)


def build_draft_prompt(d: dict, facts: dict, instructions: str = "", catalog: dict = None) -> str:
    parts = ["LIBRARY ENTRY", blueprint_text(d), "", "LAWYER FACTS", facts_block(d, facts, catalog) or "(none)"]
    if instructions:
        parts += ["", "LAWYER INSTRUCTIONS (style/emphasis only - they cannot add law)", instructions[:1200]]
    return "\n".join(parts)


def validate_slots(obj, d: dict) -> dict:
    if not isinstance(obj, dict):
        raise ValueError("model did not return a JSON object")
    fn = obj.get("facts_narrative")
    gr = obj.get("grounds")
    ms = obj.get("missing", [])
    if not isinstance(fn, list) or not fn or not all(isinstance(x, str) for x in fn):
        raise ValueError("facts_narrative must be a non-empty list of strings")
    if not isinstance(gr, list) or not all(isinstance(x, str) for x in gr):
        raise ValueError("grounds must be a list of strings")
    if not isinstance(ms, list):
        ms = []
    fn = [clean_text(x)[:1500] for x in fn if clean_text(x)][:14]
    n_seeds = len(d.get("grounds", []))
    gr = [clean_text(x)[:1500] for x in gr][: n_seeds + 3]
    ms = [clean_text(x)[:200] for x in ms if isinstance(x, str) and clean_text(x)][:12]
    if not fn:
        raise ValueError("facts_narrative was empty after cleaning")
    return {"facts_narrative": fn, "grounds": gr, "missing": ms}


def allowed_context(d: dict, extra_disputes=()):
    corpus = _dispute_corpus(d) + "\n" + "\n".join(_dispute_corpus(x) for x in extra_disputes)
    return citation_pairs(corpus), corpus


def draft_slots(dispute_id: str, facts, instructions: str = "", catalog: dict = None) -> dict:
    """Returns {ok, slots, flags, missing, ...}. Never raises for model failures."""
    catalog = catalog or load_catalog()
    d = get_dispute(dispute_id, catalog)
    if not d:
        return {"ok": False, "error": "unknown_dispute", "message": "Unknown dispute id."}
    facts = normalise_facts(facts)
    typed = sum(len(v) for k, v in facts.items() if k not in ("court", "place", "date", "advocate"))
    if typed < MIN_FACT_CHARS_FOR_AI:
        return {"ok": False, "error": "not_enough_facts",
                "message": "Add the key facts first - the AI only writes from what you enter, so it has nothing to work with yet."}
    prompt = build_draft_prompt(d, facts, str(instructions or "")[:1200], catalog)
    pairs, corpus = allowed_context(d)
    src_digits = digits_in(corpus) | digits_in("\n".join(facts.values())) | digits_in(str(instructions or ""))
    src_text = "\n".join(facts.values()) + "\n" + str(instructions or "")
    last_err = ""
    for attempt in range(2):
        try:
            sys_prompt = DRAFT_SYSTEM if attempt == 0 else DRAFT_SYSTEM + "\nYour previous reply was not valid JSON in the required shape. Return ONLY the JSON object."
            raw = _llm(sys_prompt, prompt, max_tokens=2600, timeout=90, temperature=0.1)
            slots = validate_slots(_parse_json(raw), d)
            break
        except ValueError as e:
            last_err = str(e)
            slots = None
        except Exception as e:  # network / rate limit / provider errors
            return {"ok": False, "error": "ai_unavailable", "message": "The AI service is unavailable right now. The drafting skeleton is unaffected.", "detail": str(e)[:200]}
    if slots is None:
        return {"ok": False, "error": "bad_model_output", "message": "The AI returned an unusable answer twice. Your skeleton is intact - try again.", "detail": last_err}

    flags = []
    for key in ("facts_narrative", "grounds"):
        cleaned = []
        for para in slots[key]:
            g, f = guard_text(para, pairs, corpus, src_digits, src_text)
            cleaned.append(g)
            flags += f
        slots[key] = cleaned
    return {"ok": True, "slots": {"facts_narrative": slots["facts_narrative"], "grounds": slots["grounds"]},
            "missing": slots["missing"], "flags": flags}


# ───────────────────────── Q&A ─────────────────────────
ASK_SYSTEM = (
    "You are a careful research assistant for an Indian advocate. Answer ONLY from the REFERENCE LIBRARY below "
    "(and the DRAFT, if given, when asked about the draft). The library is a curated summary, not the whole law.\n"
    "1. If the answer is not in the library, say exactly: \"That is not in the reference library - please check India Code or the "
    "current notification.\" and stop. Do not answer from memory.\n"
    "2. Cite only provisions printed in the library. Never cite case law or judgments.\n"
    "3. Never state a limitation period, fee, threshold or amount unless it is printed in the library.\n"
    "4. Be concise: at most 180 words, plain text, no markdown headings. Name the library entry you used.\n"
)


def retrieve_for_question(question: str, active_id: str = "", catalog: dict = None, k: int = 3) -> list:
    catalog = catalog or load_catalog()
    ids = []
    if active_id and get_dispute(active_id, catalog):
        ids.append(active_id)
    for m in score_disputes(question, catalog, limit=k + 2):
        if m["id"] not in ids:
            ids.append(m["id"])
        if len(ids) >= k + (1 if active_id else 0):
            break
    return [get_dispute(i, catalog) for i in ids]


def ask_question(question: str, active_id: str = "", draft_text: str = "", catalog: dict = None) -> dict:
    catalog = catalog or load_catalog()
    q = str(question or "").strip()[:1200]
    if len(q) < 3:
        return {"ok": False, "error": "empty_question", "message": "Type a question first."}
    entries = retrieve_for_question(q, active_id, catalog)
    if not entries:
        return {"ok": True, "answer": "That is not in the reference library - please check India Code or the current notification.",
                "grounded_on": [], "flags": [], "refused": True}
    ctx = "\n\n".join(blueprint_text(e, compact=(i > 0)) for i, e in enumerate(entries))
    user = "REFERENCE LIBRARY\n" + ctx + ("\n\nDRAFT (may be partial)\n" + str(draft_text)[:4500] if draft_text else "") + "\n\nQUESTION\n" + q
    pairs, corpus = allowed_context(entries[0], entries[1:])
    src_digits = digits_in(corpus) | digits_in(q) | digits_in(str(draft_text)[:4500])
    try:
        raw = _llm(ASK_SYSTEM, user, max_tokens=700, timeout=60, temperature=0.1)
    except Exception as e:
        return {"ok": False, "error": "ai_unavailable", "message": "The AI service is unavailable right now.", "detail": str(e)[:200]}
    answer, flags = guard_text(clean_text(raw) if raw else "", pairs, corpus, src_digits, q + "\n" + str(draft_text)[:4500])
    if not answer:
        answer = "That is not in the reference library - please check India Code or the current notification."
    return {"ok": True, "answer": answer, "grounded_on": [e["id"] for e in entries], "flags": flags, "refused": False}


# ───────────────────────── matter finder ─────────────────────────
MATCH_SYSTEM = (
    "You route an advocate's matter description to entries of a fixed library. You may choose ONLY from CANDIDATES "
    "(use the ids exactly). Pick up to 4, best first. Output JSON only:\n"
    "{\"matches\": [{\"id\": \"...\", \"why\": \"<=140 chars, using only the matter description\"}]}\n"
    "If nothing fits, return {\"matches\": []}. Do not invent ids."
)


def match_matter(description: str, catalog: dict = None) -> dict:
    catalog = catalog or load_catalog()
    desc = str(description or "").strip()[:1500]
    if len(desc) < 6:
        return {"ok": False, "error": "empty", "message": "Describe the matter in a sentence or two."}
    ranked = score_disputes(desc, catalog, limit=8)
    by_id = {d["id"]: d for d in catalog["disputes"]}
    base = [{"id": r["id"], "score": r["score"], "why": by_id[r["id"]]["blurb"]} for r in ranked[:4]]
    if not ranked:
        return {"ok": True, "source": "keywords", "matches": []}
    cand = "\n".join(f"{r['id']}: {by_id[r['id']]['title']} - {by_id[r['id']]['blurb']}" for r in ranked)
    try:
        raw = _llm(MATCH_SYSTEM, f"MATTER\n{desc}\n\nCANDIDATES\n{cand}", max_tokens=450, timeout=40, temperature=0)
        obj = _parse_json(raw)
        good = []
        if isinstance(obj, dict) and isinstance(obj.get("matches"), list):
            for m in obj["matches"]:
                if isinstance(m, dict) and m.get("id") in by_id and m["id"] in {r["id"] for r in ranked}:
                    if all(g["id"] != m["id"] for g in good):
                        good.append({"id": m["id"], "why": clean_text(m.get("why", ""))[:160] or by_id[m["id"]]["blurb"]})
        if good:
            return {"ok": True, "source": "ai", "matches": good[:4]}
    except Exception:
        pass
    return {"ok": True, "source": "keywords", "matches": base}


# ───────────────────────── citation verification ─────────────────────────
def verify_text_citations(text: str, max_citations: int = 8) -> dict:
    """Real lookups on India Code / Indian Kanoon via the existing Tavily helper;
    unverifiable citations are reported as unverified, never as confirmed."""
    from utils.rag_pipeline import extract_statute_citations, verify_citations_with_tavily
    cites = extract_statute_citations(str(text or "")[:60000], max_citations=max_citations)
    if not cites:
        return {"ok": True, "results": [], "message": "No 'Section X of the ... Act' style citations were found to check."}
    res = verify_citations_with_tavily(cites)
    return {"ok": True, "results": res,
            "message": "A citation marked verified means a search found a page on India Code / Indian Kanoon for it - it does not confirm the section says what the draft says."}
