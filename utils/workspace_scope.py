"""Request-side helpers for workspace-scoped routes.

Phase 4+ of the workspaces-refactor. Thin wrappers around the X-Workspace-Id
header so routes don't duplicate the parsing + access check in every handler.

Keep the dependency surface tiny — nothing here imports SQLAlchemy. Routes
that only need to filter their raw SQL by workspace_id just call
`current_workspace_id()` to get an int or None.
"""
from __future__ import annotations
from flask import g, request


def _parse_header() -> int | None:
    """Return a validated positive int from X-Workspace-Id, or None."""
    raw = request.headers.get("X-Workspace-Id")
    if raw is None or raw == "":
        return None
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def current_workspace_id() -> int | None:
    """The workspace this request belongs to, cached on g for the request.
    Returns None if the client didn't send the header (legacy / unscoped
    behaviour — reads return everything the user owns, writes land in
    workspace_id = NULL)."""
    cached = getattr(g, "_lx_workspace_id", "unset")
    if cached != "unset":
        return cached
    wid = _parse_header()
    g._lx_workspace_id = wid
    return wid


def scope_filter_sql(col: str = "workspace_id") -> tuple[str, tuple]:
    """Return a SQL WHERE fragment + bind tuple matching the active workspace.

    Legacy fallback is baked in: rows with workspace_id IS NULL are visible
    in every workspace until Phase 7 migrates them. This fragment is designed
    to be AND'd onto an existing WHERE.
    """
    wid = current_workspace_id()
    if wid is None:
        return "", tuple()
    return f" AND ({col} = ? OR {col} IS NULL)", (wid,)


__all__ = ["current_workspace_id", "scope_filter_sql"]
