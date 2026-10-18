"""Deterministic checks around the contract analysis, so what a lawyer reads is grounded in the document itself.

* locate_quote: an AI finding is kept only if the text it quotes is really in the contract (exact slice returned).
* find_missing_clauses: a clause is reported missing only if no wording for it is found in the text.
* key_dates: dates and time periods (notice, cure, term, payment) with the sentence they sit in.
No language model is used here.
"""
import re
from difflib import SequenceMatcher

from utils.draft_engine.verifier import DATE_RES

_WS = re.compile(r"\s+")


def _squash(s: str) -> str:
    return _WS.sub(" ", s or "").strip().lower()


def locate_quote(quote: str, doc_text: str, threshold: float = 0.9):
    """Return (exact_text_from_document | None, how). `how` is 'exact', 'close' or 'not found'."""
    q = (quote or "").strip().strip('"“”').strip()
    if len(q) < 12 or not doc_text:
        return None, "not found"
    nq = _squash(q)
    # exact, whitespace-insensitive: map positions through a squashed copy of the document
    squashed, index = [], []
    prev_space = True
    for i, ch in enumerate(doc_text):
        if ch.isspace():
            if not prev_space:
                squashed.append(" ")
                index.append(i)
            prev_space = True
        else:
            squashed.append(ch.lower())
            index.append(i)
            prev_space = False
    flat = "".join(squashed)
    pos = flat.find(nq)
    if pos >= 0:
        start, end = index[pos], index[min(pos + len(nq), len(index)) - 1] + 1
        return doc_text[start:end].strip(), "exact"
    # close: best window of sentences (handles a model that dropped or re-ordered a few words)
    sentences = [m for m in re.finditer(r"[^.;\n]+[.;\n]?", doc_text) if len(m.group(0).strip()) > 10]
    best, best_text = 0.0, None
    span = max(1, min(4, len(nq) // 120 + 1))
    for i in range(len(sentences)):
        win = doc_text[sentences[i].start(): sentences[min(i + span, len(sentences)) - 1].end()]
        r = SequenceMatcher(None, nq, _squash(win)).quick_ratio()
        if r >= threshold - 0.1:
            r = SequenceMatcher(None, nq, _squash(win)).ratio()
            if r > best:
                best, best_text = r, win.strip()
    if best >= threshold and best_text:
        return best_text, "close"
    return None, "not found"


# id, title, regex that shows the clause IS present, why it matters, fixed starter wording (to be reviewed by an advocate)
CLAUSES = [
    ("governing_law", "Governing law", r"governing\s+law|governed\s+by\s+(?:and\s+construed\s+in\s+accordance\s+with\s+)?the\s+laws?|laws\s+of\s+india",
     "Without it, it is unclear which country's or state's law decides the contract.",
     "This Agreement is governed by the laws of India."),
    ("jurisdiction", "Courts that decide disputes", r"jurisdiction|courts?\s+(?:at|in|of)\s+[A-Z]|arbitration|arbitral|seat\s+of",
     "Without it, either side may file in a different court, which adds cost and delay.",
     "The courts at [City] have exclusive jurisdiction over any dispute arising from this Agreement."),
    ("termination", "Termination", r"terminat",
     "Without it, there is no clear way out of the contract or notice period.",
     "Either party may terminate this Agreement by giving [number] days' written notice to the other."),
    ("confidentiality", "Confidentiality", r"confidential|non-?disclosure",
     "Without it, information shared under the contract is not protected by the contract.",
     "Each party shall keep the other's confidential information secret and use it only for the purpose of this Agreement."),
    ("payment", "Payment terms", r"payment|fees?\b|invoice|consideration|remuneration|rent\b|price",
     "Without it, the amount and timing of payment are not fixed.",
     "[Party] shall pay [amount] on or before [date / within number days of invoice]."),
    ("liability", "Limit on liability", r"limitation\s+of\s+liability|liability\s+(?:shall\s+)?(?:not\s+exceed|is\s+limited|cap)|aggregate\s+liability|cap\s+on\s+liability",
     "Without it, a party's exposure for loss is not capped by the contract.",
     "Each party's total liability under this Agreement is limited to [amount]."),
    ("indemnity", "Indemnity", r"indemnif|hold\s+harmless",
     "Without it, there is no agreed right to be compensated for third-party claims.",
     "[Party] shall indemnify the other against losses arising from [specified breach or claim]."),
    ("force_majeure", "Force majeure", r"force\s+majeure|act\s+of\s+god|beyond\s+(?:the\s+)?(?:reasonable\s+)?control",
     "Without it, there is no agreed relief when events outside a party's control stop performance.",
     "Neither party is liable for delay caused by events beyond its reasonable control, provided it gives prompt notice."),
    ("notices", "Notices", r"\bnotices?\b.*(?:writing|address|email|e-mail|registered)|address\s+for\s+notice",
     "Without it, it is unclear how a valid notice is given.",
     "Notices must be in writing and sent to the address of the other party stated in this Agreement."),
    ("assignment", "Assignment", r"assign",
     "Without it, it is unclear whether a party may transfer its rights or obligations.",
     "Neither party may assign this Agreement without the other's written consent."),
    ("entire_agreement", "Entire agreement", r"entire\s+agreement|whole\s+agreement|supersede",
     "Without it, earlier talks and drafts may be argued to form part of the contract.",
     "This Agreement is the entire agreement between the parties on its subject and supersedes all earlier understandings."),
    ("severability", "Severability", r"severab|invalid(?:ity)?\s+(?:or|and)\s+unenforceab|unenforceable",
     "Without it, one invalid clause may put the whole contract in doubt.",
     "If any provision of this Agreement is held invalid, the rest of this Agreement remains in force."),
    ("dispute_resolution", "Dispute resolution", r"dispute|arbitrat|mediation|conciliation",
     "Without it, there is no agreed first step before going to court.",
     "The parties shall first try to settle any dispute by discussion within [number] days before approaching a court."),
    ("stamp_duty", "Stamp duty", r"stamp\s+(?:duty|paper|act)|stamped",
     "An agreement that is not duly stamped may not be admissible in evidence until the duty and penalty are paid.",
     "The stamp duty on this Agreement shall be borne by [party]."),
]


def find_missing_clauses(text: str):
    """Standard clauses with no wording anywhere in the text. The starter wording is fixed text, not model output."""
    t = text or ""
    out = []
    for cid, title, present, why, model in CLAUSES:
        if not re.search(present, t, re.I | re.S):
            out.append({"id": f"miss-{cid}", "title": title, "rationale": why, "model": f'"{model}"', "checked": False, "expanded": False,
                        "basis": "No wording for this was found in the text."})
    return out


_PERIOD = re.compile(r"((?:\b\d{1,3}\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|thirty|sixty|ninety)\b)(?:\s*\(\s*\d{1,3}\s*\))?\s*(?:business\s+|working\s+|calendar\s+)?(?:days?|weeks?|months?|years?))", re.I)


def key_dates(text: str, limit: int = 25):
    """Dates and time periods in the contract, each with the sentence it appears in."""
    t = text or ""
    items, seen = [], set()

    def sentence(start, end):
        a = max(t.rfind(".", 0, start), t.rfind("\n", 0, start)) + 1
        b_candidates = [x for x in (t.find(".", end), t.find("\n", end)) if x != -1]
        b = min(b_candidates) + 1 if b_candidates else len(t)
        return _WS.sub(" ", t[a:b]).strip()[:300]

    for rx in DATE_RES:
        for m in rx.finditer(t):
            key = ("date", m.group(0).lower())
            if key not in seen:
                seen.add(key)
                items.append({"kind": "date", "text": m.group(0), "context": sentence(m.start(), m.end()), "offset": m.start()})
    for m in _PERIOD.finditer(t):
        ctx = sentence(m.start(), m.end())
        key = ("period", ctx.lower()[:80], m.group(0).lower())
        if key not in seen:
            seen.add(key)
            items.append({"kind": "period", "text": _WS.sub(" ", m.group(0)), "context": ctx, "offset": m.start()})
    items.sort(key=lambda i: i["offset"])
    return items[:limit]
