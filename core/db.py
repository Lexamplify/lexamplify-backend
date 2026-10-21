"""Shared raw-SQLite handle for the vault / case-data layer.

Extracted from app.py as part of the modularization in
docs/BACKEND_REFACTOR_PLAN.md. This is the single most load-bearing global —
nearly every vault/case route uses `db.execute(...)`. Keeping it in an
importable module (rather than a create_app closure) is what lets those route
handlers move into blueprints.

The connection is opened lazily on first use, so importing this module has no
side effects and does not depend on import order relative to app.py's
persistent-disk symlink shim.
"""
import sqlite3
import threading


class _ThreadLocalDB:
    """The app shares one `db` object everywhere and many handlers briefly switch its row_factory. With one connection
    shared by several request threads those switches collide ("tuple indices must be integers or slices, not str" on a
    page that loads several endpoints at once). Each thread therefore gets its own connection to the same file; every
    attribute and method behaves exactly as on a plain sqlite3 connection."""
    def __init__(self, path):
        object.__setattr__(self, "_path", path)
        object.__setattr__(self, "_local", threading.local())

    def _conn(self):
        c = getattr(self._local, "c", None)
        if c is None:
            c = sqlite3.connect(self._path, check_same_thread=False, timeout=30)
            self._local.c = c
        return c

    def __getattr__(self, name):
        return getattr(self._conn(), name)

    def __setattr__(self, name, value):
        setattr(self._conn(), name, value)

    def __enter__(self):
        return self._conn().__enter__()

    def __exit__(self, *a):
        return self._conn().__exit__(*a)

    def __iter__(self):
        return iter(self._conn())


db = _ThreadLocalDB('lex_assistant.db')
