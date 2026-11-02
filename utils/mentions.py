"""@-mention parsing and resolution for case room messages.

Spec §8 + plan B5: the backend accepts a free-text body and an explicit
mentions:[] list from the client. We trust the explicit list but still
run the body through a parser so a client that forgets to include the
array still gets correct mentions, and so a client that lies about the
array (e.g. a hostile actor passing user_ids it should not know about)
has its claims re-validated against the actual eligible set for the
case — a mentioned user_id that is NOT eligible for this case is dropped
silently (never surface the existence of unauthorized users).

Supported token forms:
  @12            -> user_id 12
  @user:12       -> user_id 12 (unambiguous — preferred for autocomplete)
  @firstname.lastname  (future, not resolved here — autocomplete emits
                        @user:<id> instead so the backend never has to
                        guess)

What this file does NOT do:
  * Format or render the body for display — that is the frontend's job
    (components/collab/MentionInput reads @user:<id> tokens and renders
    them as chips with the resolved display name).
  * Notify anyone — the collab blueprint calls lpms_store.notify() with
    the resolved ids this helper returns.
"""
from __future__ import annotations
import re
from typing import Iterable

from utils.case_access import eligible_recipient_ids

_TOKEN_RE = re.compile(r"@(?:user:)?(\d{1,10})\b")


def parse_body(body: str | None) -> list[int]:
    """Return every @<id> or @user:<id> token in the message body as an
    int, in first-seen order with duplicates removed. Does NOT check
    authorization — call resolve_mentions() for that."""
    if not body:
        return []
    seen: set[int] = set()
    out: list[int] = []
    for m in _TOKEN_RE.finditer(body):
        try:
            uid = int(m.group(1))
        except ValueError:
            continue
        if uid in seen:
            continue
        seen.add(uid)
        out.append(uid)
    return out


def resolve_mentions(
    body: str | None,
    explicit_user_ids: Iterable[int] | None,
    case_id: int,
) -> list[int]:
    """Combine body-parsed mentions with the client-sent explicit list,
    then intersect with the case's eligible recipient set — anything
    outside is silently dropped (prevents enumeration of users the
    sender shouldn't know about, spec §8).
    Returns deduplicated user_ids in the order they first appeared."""
    allowed = eligible_recipient_ids(case_id)
    if not allowed:
        return []

    seen: set[int] = set()
    out: list[int] = []
    for src in (parse_body(body), explicit_user_ids or []):
        for raw in src:
            try:
                uid = int(raw)
            except (TypeError, ValueError):
                continue
            if uid in seen or uid not in allowed:
                continue
            seen.add(uid)
            out.append(uid)
    return out


__all__ = ["parse_body", "resolve_mentions"]
