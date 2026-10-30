"""
utils/citation_verifier.py
Deterministic citation-validity check — completely bypasses LLMs. Scaffolds
what a real citator scrape (SCC Online / Manupatra / Indian Kanoon "cited
by") would return, as a stable hash-bucketed mock: the SAME citation string
always yields the SAME status, with no network call and no model
inference, so it's reproducible in tests and instant in the UI.
"""
import hashlib

# 70% Green / 20% Yellow / 10% Red — roughly matches the real-world skew
# (most precedent remains good law; overruling is comparatively rare).
_STATUSES = ["Green", "Green", "Green", "Green", "Green", "Green", "Green", "Yellow", "Yellow", "Red"]


def verify_citation_status(citation_string: str) -> str:
    """Returns one of "Green" (good law), "Yellow" (distinguished), "Red"
    (overruled) — deterministic per citation_string."""
    if not citation_string or not citation_string.strip():
        return "Green"
    digest = hashlib.sha256(citation_string.strip().lower().encode("utf-8")).hexdigest()
    bucket = int(digest[:8], 16) % len(_STATUSES)
    return _STATUSES[bucket]
