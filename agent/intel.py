"""Application Intelligence (MVP): a keyword-searchable index of the
codebase so the agent can answer "which route handles X?" with file:line
evidence instead of guessing.

MVP decisions (see build log): Python `ast` instead of Tree-sitter, and
SQLite keyword search instead of embeddings — both upgrade paths stay open.
Secrets never enter the index: only .py source is parsed, and lines
containing key-like tokens are skipped.
"""
import ast
import os
import re
import sqlite3
import subprocess
from datetime import datetime, timezone

INDEX_DIRS = ("routes", "utils", "agent", "models", "services", "tasks")
_ROUTE_RE = re.compile(r"@(\w+)\.route\(\s*['\"]([^'\"]+)['\"](?:.*?methods\s*=\s*\[([^\]]*)\])?", re.S)
_SECRET_RE = re.compile(r"(api[_-]?key|secret|password|token)\s*[=:]", re.I)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS agent_code_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT, file TEXT NOT NULL, kind TEXT NOT NULL,
  name TEXT NOT NULL, detail TEXT, line INTEGER, indexed_at TEXT);
CREATE TABLE IF NOT EXISTS agent_code_meta (key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX IF NOT EXISTS idx_code_name ON agent_code_index(name);
"""


def _connect(db_path):
    c = sqlite3.connect(db_path, timeout=15)
    c.row_factory = sqlite3.Row
    c.executescript(_SCHEMA)
    return c


def _git_commit(repo_root):
    try:
        out = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=repo_root,
                             capture_output=True, text=True, timeout=10)
        return out.stdout.strip() or "unknown"
    except Exception:
        return "unknown"


def _index_py(path, rel, rows):
    try:
        src = open(path, encoding="utf-8", errors="replace").read()
    except OSError:
        return
    # Flask routes (regex: decorators may wrap over lines)
    for m in _ROUTE_RE.finditer(src):
        line = src[:m.start()].count("\n") + 1
        methods = (m.group(3) or "GET").replace("'", "").replace('"', "").strip()
        rows.append((rel, "route", m.group(2), f"blueprint={m.group(1)} methods={methods}", line))
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            doc = (ast.get_docstring(node) or "").split("\n")[0][:160]
            if _SECRET_RE.search(doc):
                doc = ""                       # keep the symbol, drop the secretish text
            rows.append((rel, "function", node.name, doc, node.lineno))
        elif isinstance(node, ast.ClassDef):
            doc = (ast.get_docstring(node) or "").split("\n")[0][:160]
            rows.append((rel, "class", node.name, doc, node.lineno))


def scan_repo(repo_root, db_path, dirs=INDEX_DIRS):
    """(Re)build the code index. Returns {"files": n, "symbols": n, "commit": sha}."""
    rows, files = [], 0
    for d in dirs:
        base = os.path.join(repo_root, d)
        if not os.path.isdir(base):
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            dirnames[:] = [x for x in dirnames if x not in ("__pycache__", "node_modules", ".git")]
            for fn in filenames:
                if fn.endswith(".py"):
                    files += 1
                    rel = os.path.relpath(os.path.join(dirpath, fn), repo_root).replace("\\", "/")
                    _index_py(os.path.join(dirpath, fn), rel, rows)
    commit = _git_commit(repo_root)
    now = datetime.now(timezone.utc).isoformat()
    with _connect(db_path) as c:
        c.execute("DELETE FROM agent_code_index")
        c.executemany("INSERT INTO agent_code_index (file, kind, name, detail, line, indexed_at) VALUES (?,?,?,?,?,?)",
                      [(*r, now) for r in rows])
        c.execute("INSERT OR REPLACE INTO agent_code_meta (key, value) VALUES ('commit', ?)", (commit,))
        c.execute("INSERT OR REPLACE INTO agent_code_meta (key, value) VALUES ('indexed_at', ?)", (now,))
    return {"files": files, "symbols": len(rows), "commit": commit}


def search_code(db_path, query, limit=10):
    """Keyword search over routes/functions/classes. Returns hits with
    file:line evidence and the commit the index was built from."""
    terms = [t for t in re.split(r"\W+", query.lower()) if len(t) > 2][:6]
    if not terms:
        return {"hits": [], "commit": None}
    with _connect(db_path) as c:
        meta = {r["key"]: r["value"] for r in c.execute("SELECT key, value FROM agent_code_meta")}
        scored = {}
        for t in terms:
            pat = f"%{t}%"
            for r in c.execute("SELECT id, file, kind, name, detail, line FROM agent_code_index "
                               "WHERE lower(name) LIKE ? OR lower(detail) LIKE ? OR lower(file) LIKE ?",
                               (pat, pat, pat)).fetchall():
                e = scored.setdefault(r["id"], {"row": dict(r), "score": 0})
                e["score"] += 3 if t in (r["name"] or "").lower() else 1
    hits = sorted(scored.values(), key=lambda e: -e["score"])[:limit]
    return {"hits": [{**e["row"], "evidence": f"{e['row']['file']}:{e['row']['line']}"} for e in hits],
            "commit": meta.get("commit"), "indexed_at": meta.get("indexed_at")}
