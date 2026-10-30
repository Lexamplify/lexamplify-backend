"""
utils/citation_verify.py
Two-step citation verifier for the Virtual Courtroom.

The anti-hallucination rule for legal AI is simple: a case citation MUST be
grounded in a real public source before it leaves our system. We do that with
two independent lookups and only trust a citation when BOTH agree on the parties.

  Step A: India Kanoon            — the Indian-law database
  Step B: DuckDuckGo web search   — the open web
  (both are free, no key required)

Verdict matrix:
  kanoon_match AND web_match           -> VERIFIED   (safe to cite)
  kanoon_match OR  web_match           -> PARTIAL    (one source confirms)
  hits returned but no party match     -> UNVERIFIED (likely hallucinated)
  no hits anywhere                     -> NOT_FOUND  (very likely hallucinated)

Each verdict comes with a `source_url` the lawyer can click to read the actual
judgment. If no reliable source is found, the citation should be stripped from
the drafter's output rather than shown with a URL that might be wrong.
"""
from __future__ import annotations

import re
from typing import Any

# ── Citation extraction ────────────────────────────────────────────────────
# Matches  "<X> v. <Y>" or "<X> vs. <Y>" with an optional reporter string.
# A party name is a sequence of capitalized tokens, optionally joined by the
# small connectors legal citations use ("of", "the", "and", "&"). This greedy
# match stops at punctuation (comma, newline, ".") so a cite doesn't swallow
# the next sentence.
_PARTY = r"(?:[A-Z][A-Za-z.&\-]+)(?:\s+(?:[A-Z][A-Za-z.&\-]+|of|the|and|&))*"
_CITE_RE = re.compile(
    rf"({_PARTY})"
    r"\s+v(?:\.|s\.?|ersus)?\s+"
    rf"({_PARTY})"
    r"(?:\s*,?\s*(?:Supp\s+)?\(?\d{4}\)?(?:\s+Supp)?\s*(?:\(\d+\))?\s*\d*\s*"
    r"(?:AIR|SCC|SCR|SCW|Cri\.?\s?LJ|Bom|Del|Mad|Cal|Ker)\s*[0-9 ]*)?",
    re.MULTILINE,
)


def extract_citations(text: str, limit: int = 10) -> list[str]:
    """Extract unique 'X v. Y' citation strings from text (longest first)."""
    seen: set[str] = set()
    out: list[str] = []
    for m in _CITE_RE.finditer(text or ""):
        cite = m.group(0).strip().rstrip(",;.")
        key = re.sub(r"\s+", " ", cite.lower())
        if key in seen or len(cite) < 10:
            continue
        seen.add(key)
        out.append(cite)
        if len(out) >= limit:
            break
    return out


def _party_tokens(cite: str) -> list[str]:
    """Return the two party names as lowercase strings for match-checking."""
    parts = re.split(r"\s+v(?:\.|s\.?|ersus)?\s+", cite, maxsplit=1)
    parts = [p.strip().lower() for p in parts]
    # Strip trailing reporter clause from the second party ("Bihar (2000) 4 SCC 168" -> "bihar").
    if len(parts) == 2:
        parts[1] = re.split(r"\s*(?:\(|\d{4}|AIR|SCC|SCR)", parts[1], maxsplit=1)[0].strip()
    return [p for p in parts if len(p) >= 3][:2]


def _title_matches(parties: list[str], title: str) -> bool:
    """A hit counts as a match when the title/snippet contains a strong signal
    of BOTH parties: either the full party string, or a 4+ character distinctive
    token from each party. Lets 'Hridaya Rangan Pd. Verma vs State of Bihar'
    match 'Hridaya Ranjan Prasad Verma v. State of Bihar'."""
    if not parties:
        return False
    t = (title or "").lower()
    hits = 0
    for p in parties:
        if p in t:
            hits += 1
            continue
        # Distinctive multi-char tokens (surname / state / party name) — need at least one
        tokens = [w for w in re.split(r"\W+", p) if len(w) >= 4 and w not in {"state", "union", "india", "govt", "others", "versus", "and"}]
        if any(w in t for w in tokens):
            hits += 1
    return hits >= min(2, len(parties))


# ── Step A: India Kanoon (API if token, else public search) ───────────────
def _kanoon_lookup(cite: str) -> list[dict[str, str]]:
    try:
        from utils.kanoon_helper import search_kanoon_api, search_kanoon_web
    except Exception:
        return []
    try:
        hits = search_kanoon_api(cite, max_results=3) or []
        if not hits:
            hits = search_kanoon_web(cite, max_results=3) or []
    except Exception:
        hits = []
    return [{"title": (h.get("title") or ""), "url": (h.get("url") or ""), "source": "India Kanoon"} for h in hits]


# ── Step B: DuckDuckGo (free, no key) ─────────────────────────────────────
def _ddg_lookup(cite: str) -> list[dict[str, str]]:
    # The project installed `ddgs` (the renamed successor of duckduckgo-search).
    # Fall back to the old import name so this still runs on older envs.
    DDGS = None
    try:
        from ddgs import DDGS as _D
        DDGS = _D
    except Exception:
        try:
            from duckduckgo_search import DDGS as _D
            DDGS = _D
        except Exception:
            return []
    hits: list[dict[str, str]] = []
    # Unquoted + plus-stripped query gives DDG the best chance of a party match;
    # the quoted form is far too strict and often returns 0 results.
    import re as _re
    bare = _re.sub(r"[\",;]+", " ", cite)
    bare = _re.sub(r"\s+v(?:\.|s\.?|ersus)?\s+", " v ", bare)
    bare = _re.sub(r"\s*\(\d{4}\)\s*\d+\s*(?:AIR|SCC|SCR|SCW)[\w .]*", "", bare).strip()
    q = f"{bare} judgment India"
    try:
        with DDGS() as ddg:
            for r in (ddg.text(q, max_results=5, region="in-en") or []):
                hits.append({
                    "title": (r.get("title", "") or "")[:200],
                    "url": r.get("href", "") or r.get("url", "") or r.get("link", ""),
                    "snippet": (r.get("body", "") or r.get("snippet", "") or "")[:240],
                    "source": "DuckDuckGo",
                })
    except Exception as e:
        return [{"error": str(e)[:160]}]
    return hits


# ── Verdict ────────────────────────────────────────────────────────────────
def verify_citation(cite: str) -> dict[str, Any]:
    """Run both lookups and compute the verdict for a single citation."""
    parties = _party_tokens(cite)
    kanoon_hits = _kanoon_lookup(cite)
    ddg_hits = _ddg_lookup(cite)

    kanoon_match = next((h for h in kanoon_hits if _title_matches(parties, h.get("title", ""))), None)
    web_match = next((h for h in ddg_hits if _title_matches(parties, h.get("title", "") + " " + h.get("snippet", ""))), None)

    if kanoon_match and web_match:
        verdict = "VERIFIED"
    elif kanoon_match or web_match:
        verdict = "PARTIAL"
    elif not kanoon_hits and not ddg_hits:
        verdict = "NOT_FOUND"
    else:
        verdict = "UNVERIFIED"

    # Pick the best clickable source: India Kanoon match → DDG match → first Kanoon hit → first DDG hit
    primary = kanoon_match or web_match or (kanoon_hits[0] if kanoon_hits else None) or (ddg_hits[0] if ddg_hits else None)

    return {
        "citation": cite,
        "verdict": verdict,
        "source_url": (primary or {}).get("url", ""),
        "source_title": (primary or {}).get("title", ""),
        "source_name": (primary or {}).get("source", ""),
        "kanoon_match": bool(kanoon_match),
        "web_match": bool(web_match),
        "kanoon_hits": kanoon_hits[:3],
        "ddg_hits": [h for h in ddg_hits if "error" not in h][:3],
    }


def verify_text(text: str, limit: int = 10) -> list[dict[str, Any]]:
    """Extract every citation from text and verify each one."""
    return [verify_citation(c) for c in extract_citations(text, limit=limit)]
