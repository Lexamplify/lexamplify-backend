"""Per-request DB identity, carried to Postgres as session GUCs for RLS.

The app connects to Postgres through a POOLED connection as one role, so the
database cannot learn "who is asking" on its own. This module stashes the
caller's identity (user / workspace / firm ids) in a contextvar that the
pg_compat connection layer reads on every pool checkout and pushes into
`app.user_id` / `app.workspace_id` / `app.firm_id` via set_config(...).

Row-Level Security policies (added later, table by table) read those GUCs with
`current_setting('app.user_id', true)`. Until policies exist this is completely
inert — the GUCs are set but nothing reads them.

contextvars (not flask.g) so the value is correct under threads and async and
simply absent (→ NULL GUCs → RLS fails closed) in background workers that have
no request context.
"""
from __future__ import annotations
import contextvars
from typing import Optional, Tuple

# (user_id, workspace_id, firm_id) — any element may be None.
_identity: contextvars.ContextVar[Tuple[Optional[int], Optional[int], Optional[int]]] = (
    contextvars.ContextVar("lx_db_identity", default=(None, None, None))
)


def set_identity(user_id=None, workspace_id=None, firm_id=None) -> None:
    def _i(v):
        try:
            return int(v) if v is not None else None
        except (TypeError, ValueError):
            return None
    _identity.set((_i(user_id), _i(workspace_id), _i(firm_id)))


def get_identity() -> Tuple[Optional[int], Optional[int], Optional[int]]:
    try:
        return _identity.get()
    except Exception:
        return (None, None, None)


def clear_identity() -> None:
    _identity.set((None, None, None))


__all__ = ["set_identity", "get_identity", "clear_identity"]
