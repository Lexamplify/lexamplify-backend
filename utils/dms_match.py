"""
utils/dms_match.py - "which case does this document belong to?"

A deterministic, explainable matcher (no AI model): it compares what the Document Hub already read out of a document
(its own case number, parties, court, the names in its first pages) with the cases the person can file into.

    signal                                                         weight
    the document's own case number equals the case's number        0.80   (0.45 if both name a court and the courts differ)
    other documents with that case number are already filed here   0.50  / 0.60 for two or more
    both parties' names match the case                             0.45   (0.30 / 0.20 when only one side can be compared)
    the court matches                                              0.12
    the case number is only *mentioned* in the body                0.25
    the client's full name appears in the first pages              0.20

Signals are combined as independent evidence: 1 - (1-p1)(1-p2)... A result of 0.40 or more is worth showing; a document is
filed WITHOUT asking only at 0.82 or more AND when it beats every other case by 0.25 - in practice that means the case
number plus one more detail (court, a party, or a sibling document) all agree. Everything below waits in a queue for a click.

Every candidate carries its reasons in plain words, so the person can see WHY before confirming.
"""
import json
import re

try:
    from utils import dms_classify as C, dms_files as F, dms_index as I
except ImportError:  # pragma: no cover
    import dms_classify as C, dms_files as F, dms_index as I

SUGGEST_AT = 0.40
AUTO_AT = 0.82
AUTO_MARGIN = 0.25
SHOW_AT = 0.25          # weaker guesses are kept for the "maybe" list but never suggested

P_KEY, P_KEY_CLASH = 0.80, 0.45
P_NUMYEAR_COURT = 0.35
P_SIB1, P_SIB2 = 0.50, 0.60
P_PARTY_BOTH, P_PARTY_SINGLE, P_PARTY_ONE = 0.45, 0.30, 0.20
P_COURT, P_MENTION, P_CLIENT_TEXT = 0.12, 0.25, 0.20
P_MATTER_KEY, P_MATTER_PARTIES = 0.70, 0.35

# words that appear in nearly every caption - they say nothing about WHICH case
STOP = {"state", "union", "india", "limited", "company", "pvt", "ltd", "private", "bank", "others", "another", "versus", "government",
        "department", "office", "officer", "commissioner", "authority", "board", "corporation", "through", "represented", "secretary",
        "ministry", "district", "court", "smt", "shri", "mrs", "miss", "the", "and", "through", "its", "thr", "ors", "anr", "ltd",
        "petitioner", "respondent", "appellant", "defendant", "plaintiff", "applicant", "complainant", "accused", "judge", "magistrate",
        "high", "supreme", "tribunal", "civil", "criminal", "sessions", "additional", "senior", "learned", "versus", "matter", "case", "in", "re"}
# surnames shared by millions: one of these matching proves nothing
COMMON = {"kumar", "singh", "sharma", "devi", "kaur", "gupta", "khan", "verma", "yadav", "patel", "shah", "mohammed", "mohd", "ahmed",
          "ali", "lal", "das", "rao", "reddy", "nair", "jain", "mishra", "pandey", "chauhan", "joshi", "mehta", "begum", "bibi", "prasad",
          "chand", "ram", "rani", "kumari", "raj", "pal", "dutt", "saha", "bhai", "ben", "kaushik", "tiwari", "dubey", "agarwal"}
COURT_GENERIC = {"high", "court", "district", "sessions", "civil", "criminal", "judge", "tribunal", "new", "the", "at", "of", "and", "in",
                 "family", "magistrate", "metropolitan", "additional", "commercial", "consumer", "labour", "industrial", "courts", "complex"}


def noisy_or(ps):
    r = 1.0
    for p in ps:
        r *= (1.0 - p)
    return round(1.0 - r, 3)


def _words(s):
    return [w for w in re.findall(r"[a-z]{3,}", (s or "").lower())]


def name_tokens(s):
    return {w for w in _words(s) if w not in STOP}


def _court_distinct(s):
    return {w for w in _words(s) if w not in COURT_GENERIC}


def court_compare(a, b):
    """'match' | 'mismatch' | 'unknown'. 'Delhi High Court' = 'HIGH COURT OF DELHI AT NEW DELHI'; 'Bombay High Court' is not."""
    da, db = _court_distinct(a), _court_distinct(b)
    if not (a and b) or not da or not db:
        return "unknown"
    return "match" if da & db else "mismatch"


_NUMYEAR = re.compile(r"(\d{1,6})\s*(?:/|of|-)\s*((?:19|20)\d{2})", re.I)


def case_no_forms(case_no):
    """(set of exact tokens, (num, year) | None) for a case number as a person typed it into a case record."""
    s = case_no or ""
    toks = {re.sub(r"[^0-9a-z]+", "", s.lower())} - {""}
    for m in C.CASE_RE.finditer(s):
        toks.add(C.case_token(C.case_key(m.group("type"), m.group("num"), m.group("year"))))
    ny = _NUMYEAR.search(s)
    return toks, ((int(ny.group(1)), int(ny.group(2))) if ny else None)


def _numyear_of_key(key):
    m = re.search(r"(\d+)/((?:19|20)\d{2})\b", key or "")
    return (int(m.group(1)), int(m.group(2))) if m else None


class CaseIndex:
    """The cases one person may file into, pre-digested for matching. Build once per batch, not per document."""

    def __init__(self, conn, uid):
        self.uid = int(uid)
        self.cases = []
        self.by_ref = {}
        parties = {}
        if I._has_lpms_tables(conn):
            ids = []
            rows = conn.execute(
                "SELECT c.id, c.case_no, c.court, c.title, c.opposite_party, cl.name AS client, c.updated_at "
                "FROM lpms_cases c LEFT JOIN lpms_clients cl ON cl.id = c.client_id " + F._LPMS_ACCESS + " AND c.archived_at IS NULL",
                {"uid": self.uid}).fetchall()
            ids = [r["id"] for r in rows]
            for i in range(0, len(ids), 500):
                chunk = ids[i:i + 500]
                for p in conn.execute(f"SELECT case_id, name FROM lpms_parties WHERE case_id IN ({','.join('?' * len(chunk))})", chunk):
                    parties.setdefault(p["case_id"], []).append(p["name"])
            for r in rows:
                forms, ny = case_no_forms(r["case_no"])
                pool = name_tokens(" ".join([r["title"] or "", r["opposite_party"] or "", r["client"] or ""] + parties.get(r["id"], [])))
                c = {"ref": f"lpms:{r['id']}", "kind": "practice", "label": r["title"], "case_no": r["case_no"], "court": r["court"],
                     "client": r["client"], "forms": forms, "numyear": ny, "pool": pool, "client_tokens": name_tokens(r["client"]),
                     "updated": r["updated_at"]}
                self.cases.append(c)
        if I._has_matter_tables(conn):
            for m in I.matter_ids_for(conn, self.uid):
                flat = re.sub(r"[^a-z0-9ऀ-෿]", "", (m["title"] or "").lower())
                self.cases.append({"ref": f"matter:{m['id']}", "kind": "matter", "label": m["title"], "case_no": None, "court": None, "client": None,
                                   "forms": set(), "numyear": None, "pool": name_tokens(m["title"]), "client_tokens": set(), "flat": flat,
                                   "updated": ""})
        self.by_ref = {c["ref"]: c for c in self.cases}
        newest = max([c["updated"] or "" for c in self.cases] or [""])
        self.sig = f"{len(self.cases)}:{newest}"


def _party_sides(parties):
    if not parties:
        return []
    parts = re.split(r"\s+(?:vs?\.?|v/s\.?|versus|बनाम)\s+", parties, maxsplit=1, flags=re.I)
    return [name_tokens(p) for p in parts[:2]]


def _side_matches(side, pool):
    ov = side & pool
    if len(ov) >= 2:
        return True
    distinct = ov - COMMON
    return bool(distinct) and any(len(w) >= 6 for w in distinct)


def doc_facts(conn, d, text_head=None):
    """What the matcher needs from one dms_docs row."""
    meta = F.loads(d["meta"], {})
    keys = [k for k in (d["case_keys"] or "").split("|") if k.strip()]
    own = [k for k in keys]
    mention_keys = []
    for shown in meta.get("case_mentions") or []:
        m = C.CASE_RE.search(shown)
        if m:
            mention_keys.append(C.case_key(m.group("type"), m.group("num"), m.group("year")))
    if text_head is None:
        rows = conn.execute("SELECT text FROM dms_pages WHERE doc_id = ? AND page_no <= 2 ORDER BY page_no", (d["doc_id"],)).fetchall()
        text_head = " ".join(r["text"] for r in rows)[:6000]
    return {
        "doc_id": d["doc_id"], "own_keys": own, "own_tokens": {C.case_token(k) for k in own},
        "own_numyear": [x for x in (_numyear_of_key(k) for k in own) if x],
        "mention_tokens": {C.case_token(k) for k in mention_keys}, "parties": d["parties"], "court": d["court"],
        "text_tokens": name_tokens(text_head), "shown_numbers": meta.get("case_numbers") or [],
    }


def keys_from_shown(shown_list):
    keys = []
    for shown in shown_list or []:
        m = C.CASE_RE.search(shown)
        if m:
            keys.append(C.case_key(m.group("type"), m.group("num"), m.group("year")))
        elif re.match(r"FIR \d+/\d{4}$", shown or ""):
            keys.append(shown.upper())
    return list(dict.fromkeys(keys))


def facts_from_analysis(a, text):
    """The same facts, for a document that is not stored yet (a scanned stack being sorted): `a` is dms_scan.analyse_texts()."""
    own = keys_from_shown(list(a.get("case_numbers") or []) + list(a.get("fir_numbers") or []))
    return {
        "doc_id": None, "own_keys": own, "own_tokens": {C.case_token(k) for k in own},
        "own_numyear": [x for x in (_numyear_of_key(k) for k in own) if x],
        "mention_tokens": {C.case_token(k) for k in keys_from_shown(a.get("case_mentions"))}, "parties": a.get("parties"), "court": a.get("court"),
        "text_tokens": name_tokens((text or "")[:6000]), "shown_numbers": a.get("case_numbers") or [],
    }


def siblings(conn, doc_id, own_keys):
    """{case_ref: n} - other live documents with the same case number that are already filed on a case."""
    out = {}
    for k in own_keys[:4]:
        for r in conn.execute(
                "SELECT cv.case_id AS cid, COUNT(*) AS n FROM dms_docs d JOIN case_vault cv ON cv.id = d.doc_id "
                "WHERE d.case_keys LIKE ? AND cv.case_id IS NOT NULL AND (cv.case_id LIKE 'lpms:%' OR cv.case_id LIKE 'matter:%') "
                "AND d.deleted_at IS NULL AND d.doc_id != ? GROUP BY cv.case_id", (f"%|{k}|%", doc_id if doc_id is not None else -1)):
            out[r["cid"]] = max(out.get(r["cid"], 0), r["n"])
    return out


def score(facts, index, sib):
    """-> candidates [{ref, score, reasons, label, case_no, court, client, kind}] best first (only those >= SHOW_AT)."""
    sides = _party_sides(facts["parties"])
    nonempty = [s for s in sides if s]
    out = []
    for c in index.cases:
        ps, why = [], []
        court_cmp = court_compare(facts["court"], c["court"])
        key_hit = bool(facts["own_tokens"] & c["forms"])
        if key_hit:
            clash = court_cmp == "mismatch"
            ps.append(P_KEY_CLASH if clash else P_KEY)
            shown = next((s for s in facts["shown_numbers"] if C.case_token(s) in c["forms"] or re.sub(r"[^0-9a-z]", "", s.lower()) in c["forms"]), c["case_no"])
            why.append(f"Case number {shown or c['case_no']} matches" + (" - but the court is different" if clash else ""))
        elif c["numyear"] and c["numyear"] in facts["own_numyear"] and court_cmp == "match":
            ps.append(P_NUMYEAR_COURT)
            why.append(f"Case number {c['numyear'][0]}/{c['numyear'][1]} and the court match")
        elif facts["mention_tokens"] & c["forms"]:
            ps.append(P_MENTION)
            why.append("The text mentions this case number")
        if c["kind"] == "matter" and facts["own_tokens"]:
            if any(t and t in c.get("flat", "") for t in facts["own_tokens"]):
                ps.append(P_MATTER_KEY)
                why.append("The matter's name contains this case number")
        n_sib = sib.get(c["ref"], 0)
        if n_sib:
            ps.append(P_SIB2 if n_sib >= 2 else P_SIB1)
            why.append(f"{n_sib} other document{'s' if n_sib != 1 else ''} with the same case number {'are' if n_sib != 1 else 'is'} already filed here")
        if nonempty:
            hits = [_side_matches(s, c["pool"]) for s in nonempty]
            if all(hits) and len(nonempty) == 2:
                ps.append(P_PARTY_BOTH if c["kind"] == "practice" else P_MATTER_PARTIES)
                why.append("Both parties' names match")
            elif all(hits) and len(nonempty) == 1:
                ps.append(P_PARTY_SINGLE if c["kind"] == "practice" else P_PARTY_ONE)
                why.append("The party's name matches")
            elif any(hits):
                ps.append(P_PARTY_ONE)
                why.append("One party's name matches")
        elif len(c["client_tokens"]) >= 2 and c["client_tokens"] <= facts["text_tokens"]:
            ps.append(P_CLIENT_TEXT)
            why.append(f"The client's name ({c['client']}) appears in the text")
        if ps and court_cmp == "match":
            ps.append(P_COURT)
            why.append(f"Court matches ({c['court']})")
        if not ps:
            continue
        s = noisy_or(ps)
        if s >= SHOW_AT:
            out.append({"ref": c["ref"], "score": s, "reasons": why, "label": c["label"], "case_no": c["case_no"], "court": c["court"],
                        "client": c["client"], "kind": c["kind"]})
    out.sort(key=lambda x: (-x["score"], x["ref"]))
    return out[:3]


def decide(cands):
    """-> (state, confident). 'pending' = worth asking about; 'nomatch' = nothing convincing."""
    if not cands or cands[0]["score"] < SUGGEST_AT:
        return "nomatch", False
    second = cands[1]["score"] if len(cands) > 1 else 0.0
    return "pending", (cands[0]["score"] >= AUTO_AT and cands[0]["score"] - second >= AUTO_MARGIN)


# ── persistence ──────────────────────────────────────────────────────────────────────
UNFILED = "(cv.case_id IS NULL OR cv.case_id = '' OR cv.case_id = 'General')"
_UNREAD = ("queued", "processing")


def _eval_sig(index, d):
    return f"{index.sig}|{d['processed_at']}|{d['case_keys']}|{d['parties']}|{d['court']}"


def evaluate(conn, uid, d, index):
    """Evaluate one unfiled document and store the verdict. Never changes the document. Returns (state, confident, cands)."""
    if d["status"] in _UNREAD:
        return None, False, []
    facts = doc_facts(conn, d)
    cands = score(facts, index, siblings(conn, d["doc_id"], facts["own_keys"])) if (facts["own_keys"] or facts["parties"] or facts["mention_tokens"]
                                                                                    or facts["text_tokens"]) else []
    state, confident = decide(cands)
    note = None
    if state == "nomatch":
        if d["status"] in ("needs_ocr", "empty", "failed", "unsupported"):
            note = "This file could not be read, so there is nothing to match - file it by hand."
        elif not facts["own_keys"] and not facts["parties"]:
            note = "No case number or party names were found in this document."
        elif not index.cases:
            note = "You have no cases to file into yet."
        else:
            note = "No case matched convincingly."
    row = conn.execute("SELECT state FROM dms_filing WHERE doc_id = ?", (d["doc_id"],)).fetchone()
    if row and row["state"] in ("filed", "dismissed"):
        return row["state"], False, cands
    conn.execute(
        "INSERT INTO dms_filing (doc_id, owner_id, state, top_ref, top_score, candidates, note, sig, evaluated_at) VALUES (?,?,?,?,?,?,?,?,?) "
        "ON CONFLICT(doc_id) DO UPDATE SET state = excluded.state, top_ref = excluded.top_ref, top_score = excluded.top_score, "
        "candidates = excluded.candidates, note = excluded.note, sig = excluded.sig, evaluated_at = excluded.evaluated_at",
        (d["doc_id"], int(uid), state, cands[0]["ref"] if cands else None, cands[0]["score"] if cands else None,
         json.dumps(cands), note, _eval_sig(index, d), F.now_iso()))
    return state, confident, cands


def unfiled_rows(conn, uid, only_ids=None, limit=None):
    sql = ("SELECT d.*, cv.case_id AS cv_case_id, cv.user_id AS cv_user_id, cv.title AS cv_title, cv.smart_title AS cv_smart_title, "
           "cv.folder_id AS cv_folder_id FROM dms_docs d JOIN case_vault cv ON cv.id = d.doc_id "
           f"WHERE cv.user_id = ? AND {UNFILED} AND d.deleted_at IS NULL AND d.is_current = 1")
    args = [int(uid)]
    if only_ids:
        sql += f" AND d.doc_id IN ({','.join('?' * len(only_ids))})"
        args += list(only_ids)
    sql += " ORDER BY d.doc_id DESC"
    if limit:
        sql += f" LIMIT {int(limit)}"
    return conn.execute(sql, args).fetchall()


def refresh(conn, uid, limit=150, only_ids=None, force=False):
    """Evaluate every unfiled, finished-reading document that has no verdict yet (or whose verdict is out of date because the
    case list or the document changed). Returns {'evaluated': n, 'remaining': n, 'confident': [doc_id, ...]}."""
    index = CaseIndex(conn, uid)
    rows = unfiled_rows(conn, uid, only_ids)
    have = {r["doc_id"]: r for r in conn.execute("SELECT doc_id, state, sig FROM dms_filing WHERE owner_id = ?", (int(uid),))}
    todo = []
    for d in rows:
        if d["status"] in _UNREAD:
            continue
        h = have.get(d["doc_id"])
        if h and h["state"] in ("filed", "dismissed") and not force:
            continue
        if h and h["sig"] == _eval_sig(index, d) and not force:
            continue
        todo.append(d)
    done, confident = 0, []
    for d in todo[:limit]:
        state, conf, _c = evaluate(conn, uid, d, index)
        done += 1
        if conf:
            confident.append(d["doc_id"])
    if done:
        conn.commit()
    return {"evaluated": done, "remaining": max(0, len(todo) - limit), "confident": confident}
