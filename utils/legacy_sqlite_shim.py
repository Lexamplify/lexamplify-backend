"""Transparent redirect from the legacy SQLite files to the consolidated one.

Phase 1 of the workspaces refactor consolidated three databases into one
(`instance/database.db`). ~20 route and utility modules still call
`sqlite3.connect('lex_assistant.db')` and `sqlite3.connect(<instance/client_data.db>)`
with raw SQL. Rewriting every one of them is risky.

Instead, this module monkey-patches `sqlite3.connect` once at app startup so
every call to the two legacy paths is silently routed to the single
`instance/database.db`. Routes keep working unchanged; the three databases
look like one to all callers.

Install from app.py by calling `install()` after config load.

What this is NOT:
  * Not a long-term solution. When we later rewire routes to SQLAlchemy
    this shim is removed.
  * Not an abstraction layer. It's a two-path redirect, nothing more.
"""
from __future__ import annotations
import os
import sqlite3
from pathlib import Path

_installed = False
_original_connect = sqlite3.connect
_target_path: str | None = None


def _normalise(p) -> str:
    """Resolve both path flavours (string / Path / relative / absolute)."""
    try:
        return str(Path(p).resolve())
    except Exception:
        return str(p)


def install(app) -> None:
    """Monkey-patch sqlite3.connect to redirect the two legacy DB paths
    to the single consolidated database. Idempotent."""
    global _installed, _target_path
    if _installed:
        return

    # The consolidated target lives at the SQLALCHEMY_DATABASE_URI (sqlite://)
    # — pull the path out of it so the shim and SQLA share one file.
    uri = app.config.get("SQLALCHEMY_DATABASE_URI", "")
    if not uri.startswith("sqlite:///"):
        # Only install when the target IS a sqlite file. For Postgres targets
        # the raw-SQL routes must have been rewritten first; this shim would
        # be inappropriate.
        app.logger.info("legacy_sqlite_shim: target is not sqlite, shim not installed")
        return

    raw = uri.replace("sqlite:///", "", 1)
    # Flask's SQLA default resolves `sqlite:///database.db` against the
    # app's instance_path (so the real file is instance/database.db).
    # Replicate that so the shim and SQLA agree on the exact path.
    target = Path(raw)
    if not target.is_absolute():
        target = Path(app.instance_path) / target
    _target_path = str(target)
    target_resolved = _normalise(_target_path)

    # Build the set of legacy paths that should be redirected.
    repo_root = Path(__file__).resolve().parents[1]
    legacy_paths: set[str] = {
        _normalise(repo_root / "lex_assistant.db"),
        _normalise("lex_assistant.db"),            # relative CWD form
        _normalise(repo_root / "instance" / "client_data.db"),
        _normalise(app.config.get("SQLITE_DB_PATH", "")) if app.config.get("SQLITE_DB_PATH") else None,
    }
    legacy_paths.discard(None)
    legacy_paths.discard(target_resolved)  # don't redirect the target onto itself

    def _patched_connect(database, *args, **kwargs):
        try:
            resolved = _normalise(database) if isinstance(database, (str, bytes, os.PathLike)) else database
            if resolved in legacy_paths:
                return _original_connect(_target_path, *args, **kwargs)
        except Exception:
            # If anything goes wrong, fall back to the original call —
            # never fail a connect because of this shim.
            pass
        return _original_connect(database, *args, **kwargs)

    sqlite3.connect = _patched_connect  # type: ignore[assignment]
    _installed = True
    app.logger.info(
        f"legacy_sqlite_shim: active — redirecting "
        f"{len(legacy_paths)} legacy paths -> {target_resolved}"
    )


def is_installed() -> bool:
    return _installed


def target_path() -> str | None:
    return _target_path
