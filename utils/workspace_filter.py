"""Reusable workspace-scope helpers for raw-SQL routes.

Every per-client route file in this codebase scopes its reads and writes
by X-Workspace-Id using the same two primitives — this module just
centralises them so we aren't copy-pasting a 15-line _ws_id + _in_scope
pair into every route file during pipeline item 6.

Legacy data policy (matches `routes/matter_routes.py` and the earlier
Phase-4 workspace migrations): a row whose workspace_id is NULL is
visible from every workspace (firm-wide default), and a request without
X-Workspace-Id doesn't filter anything. We only hide a row when BOTH the
row and the request have workspace ids and they differ — this keeps the
unscoped older frontend working while the switcher-aware pages get real
isolation.
"""
from __future__ import annotations


def ws_id():
    """Return the active workspace id (int) from the X-Workspace-Id header,
    or None when the header is absent / unparseable. Lazy-imported so test
    harnesses that skip the workspaces blueprint keep loading these route
    modules."""
    try:
        from utils.workspace_scope import current_workspace_id
        return current_workspace_id()
    except Exception:
        return None


def in_scope(row, column: str = "workspace_id") -> bool:
    """True when a sqlite3.Row is visible in the current workspace.
    NULL on either side (legacy row or unscoped request) → visible."""
    try:
        row_ws = row[column]
    except (KeyError, IndexError, TypeError):
        return True        # row has no workspace column at all
    req_ws = ws_id()
    if row_ws is None or req_ws is None:
        return True
    try:
        return int(row_ws) == int(req_ws)
    except (TypeError, ValueError):
        return True


__all__ = ["ws_id", "in_scope"]
