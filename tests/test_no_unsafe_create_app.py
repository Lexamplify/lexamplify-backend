"""Guard: nothing under tests/ or scripts/ may build the real app except through tests/helpers_app.py.

Calling create_app() by hand is how an old test once wrote into the developer's lex_assistant.db and instance/ folder (the
app opens those through paths relative to the working folder, and a few through paths built from __file__). helpers_app.py
is the one place that isolates all of that and checks it before the app is built (make_app, create_app_here).

The scan is static (ast), so it never imports the app and never touches data. It flags, in every tests/**/*.py and scripts/*.py:
  (a) any call to create_app, plain name or attribute (app_module.create_app());
  (b) any `from ... import create_app`, with or without `as`;
  (c) any other use of the name create_app as a value (passed around, assigned);
  (d) a string constant containing `create_app(`; a getattr/import_module/exec/eval call that names create_app;
      and gunicorn / `python app.py` / flask given to a subprocess or os.system call.
Docstrings are skipped (they may talk about create_app). This file is skipped.

Known gaps: a name built from pieces ("create_" + "app"), code read from a file and then exec'ed, or a process started by a tool
other than subprocess/os.system. The runtime tripwire in helpers_app.create_app_here covers the cases the scan can miss.
"""
import ast
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
THIS_FILE = Path(__file__).resolve()

# Files allowed to call create_app, keyed by normalised path relative to the repo root. No wildcards.
ALLOWED_EVERYWHERE = {"tests/helpers_app.py"}

# These scripts build the app by hand. Each is allowed only while the proof in its comment still holds in the source
# (checked below with ast line numbers): it makes a temp folder, and changes into it BEFORE the first `import app` / create_app.
ALLOWLIST = {
    # PROOF: build_app() sets DATABASE_URL to a mkdtemp folder, LEGACY_USER_MIGRATION=off, LPMS_SCHEDULER=0, blanks the API keys,
    # then os.chdir(work) and only afterwards `import app` + create_app(). Run by hand, never by pytest.
    # Known gap (not this batch): routes/court_routes.py builds its database path from __file__, so the court routes still use
    # the real instance/client_data.db when this script is used.
    "scripts/eval_drafts.py": "chdir into a mkdtemp folder before importing the app",
    # PROOF: same as eval_drafts.py (its build_app() mirrors it line for line).
    "scripts/eval_inline_edit.py": "chdir into a mkdtemp folder before importing the app",
    # PROOF: mkdtemp at the top, env set (temp DATABASE_URL, legacy migration off, scheduler off, keys blanked), os.chdir(work)
    # BEFORE `import app`, then init_db() and create_app() all run from the temp folder. Started by tests/e2e/conftest.py.
    # Known gap (not this batch): same court-route __file__ path as above, and no network block.
    "scripts/e2e_backend.py": "chdir into a mkdtemp folder before importing the app",
}

SUBPROCESS_FUNCS = {"run", "Popen", "call", "check_call", "check_output", "system", "popen", "spawnl", "spawnv", "startfile"}
DYNAMIC_FUNCS = {"getattr", "__import__", "import_module", "run_path", "run_module", "exec", "eval"}
APP_PY = re.compile(r"(?<![\w.])app\.py\b")


def norm(path):
    return Path(path).resolve().relative_to(REPO).as_posix()


def source_files():
    out = []
    for p in sorted((REPO / "tests").rglob("*.py")):
        if "__pycache__" in p.parts:
            continue
        out.append(p)
    out.extend(sorted((REPO / "scripts").glob("*.py")))
    return [p for p in out if p.resolve() != THIS_FILE]


def parse(text, filename="<src>"):
    return ast.parse(text.lstrip("﻿"), filename=filename)


def _docstring_nodes(tree):
    ids = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            body = node.body
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) and isinstance(body[0].value.value, str):
                ids.add(id(body[0].value))
    return ids


def _call_name(node):
    f = node.func
    if isinstance(f, ast.Name):
        return f.id
    if isinstance(f, ast.Attribute):
        return f.attr
    return ""


def _strings_in(node):
    for sub in ast.walk(node):
        if isinstance(sub, ast.Constant) and isinstance(sub.value, str):
            yield sub


def violations_in(text, filename="<src>"):
    """[(line, reason)] for one source text."""
    tree = parse(text, filename)
    docs = _docstring_nodes(tree)
    found = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and node.id == "create_app":
            found.append((node.lineno, "uses the name create_app (a call, or passed around / assigned)"))
        elif isinstance(node, ast.Attribute) and node.attr == "create_app":
            found.append((node.lineno, "uses .create_app (for example app_module.create_app())"))
        elif isinstance(node, ast.ImportFrom):
            for al in node.names:
                if al.name == "create_app" or al.asname == "create_app":
                    found.append((node.lineno, "imports create_app (from ... import create_app [as ...])"))
        elif isinstance(node, ast.Import):
            for al in node.names:
                if al.asname == "create_app":
                    found.append((node.lineno, "imports a module under the name create_app"))
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docs:
            if "create_app(" in node.value:
                found.append((node.lineno, "a string contains `create_app(` (code run through exec/subprocess)"))
        if isinstance(node, ast.Call):
            name = _call_name(node)
            if name in DYNAMIC_FUNCS:
                for s in _strings_in(node):
                    if "create_app" in s.value:
                        found.append((node.lineno, f"{name}() names create_app"))
            if name in SUBPROCESS_FUNCS:
                for s in _strings_in(node):
                    v = s.value
                    if "gunicorn" in v or APP_PY.search(v) or v == "flask":
                        found.append((node.lineno, f"{name}() starts the backend (gunicorn / app.py / flask) from a test or script"))
    return sorted(set(found))


def allowlist_proof_problems(rel, text):
    """The allowlisted scripts stay allowed only while: they use mkdtemp and os.chdir, and chdir comes before the first app import."""
    tree = parse(text, rel)
    chdir, mkdtemp, first_app = [], [], []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            f = node.func
            if isinstance(f, ast.Attribute) and f.attr == "chdir" and isinstance(f.value, ast.Name) and f.value.id == "os":
                chdir.append(node.lineno)
            if (isinstance(f, ast.Attribute) and f.attr == "mkdtemp") or (isinstance(f, ast.Name) and f.id == "mkdtemp"):
                mkdtemp.append(node.lineno)
            if (isinstance(f, ast.Attribute) and f.attr == "create_app") or (isinstance(f, ast.Name) and f.id == "create_app"):
                first_app.append(node.lineno)
        if isinstance(node, ast.Import) and any(a.name == "app" or a.name.startswith("app.") for a in node.names):
            first_app.append(node.lineno)
        if isinstance(node, ast.ImportFrom) and node.module and (node.module == "app" or node.module.startswith("app.")):
            first_app.append(node.lineno)
    problems = []
    if not chdir:
        problems.append("no os.chdir call any more")
    if not mkdtemp:
        problems.append("no mkdtemp call any more")
    if chdir and first_app and min(chdir) > min(first_app):
        problems.append(f"os.chdir (line {min(chdir)}) comes AFTER the first `import app` / create_app (line {min(first_app)})")
    if chdir and not first_app:
        problems.append("no `import app` / create_app found: the entry no longer matches the file")
    return problems


def test_only_helpers_app_builds_the_real_app():
    bad = []
    for p in source_files():
        rel = norm(p)
        if rel in ALLOWED_EVERYWHERE or rel in ALLOWLIST:
            continue
        for line, why in violations_in(p.read_text(encoding="utf-8-sig"), rel):
            bad.append(f"{rel}:{line}: {why}")
    assert not bad, (
        "These files build or start the real app by hand. Use tests/helpers_app.py (make_app, or create_app_here for a test that "
        "must call create_app itself) so the working folder, database and data paths are isolated:\n  " + "\n  ".join(bad))


def test_the_allowlist_is_small_exact_and_still_proven():
    assert set(ALLOWLIST) == {"scripts/e2e_backend.py", "scripts/eval_drafts.py", "scripts/eval_inline_edit.py"}, "allowlist changed: tell the owner"
    problems = []
    for rel in ALLOWLIST:
        assert "*" not in rel and rel == rel.replace("\\", "/"), rel
        path = REPO / rel
        assert path.is_file(), f"allowlist names a file that does not exist: {rel}"
        assert norm(path) == rel, f"allowlist key is not the normalised relative path: {rel}"
        problems += [f"{rel}: {p}" for p in allowlist_proof_problems(rel, path.read_text(encoding="utf-8-sig"))]
    assert not problems, "an allowlisted script no longer proves it isolates itself:\n  " + "\n  ".join(problems)


def test_helpers_app_calls_create_app_only_inside_create_app_here():
    src = (REPO / "tests" / "helpers_app.py").read_text(encoding="utf-8-sig")
    tree = parse(src, "tests/helpers_app.py")
    parents = {}
    for node in ast.walk(tree):
        for child in ast.iter_child_nodes(node):
            parents[child] = node
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            assert not any(a.name == "create_app" for a in node.names), "helpers_app must not import create_app by name"
        if (isinstance(node, ast.Attribute) and node.attr == "create_app") or (isinstance(node, ast.Name) and node.id == "create_app"):
            cur, inside = node, None
            while cur in parents:
                cur = parents[cur]
                if isinstance(cur, ast.FunctionDef):
                    inside = cur.name
                    break
            assert inside == "create_app_here", f"helpers_app.py:{node.lineno}: create_app is used outside create_app_here ({inside})"


# ── the scanner itself ────────────────────────────────────────────────────────────────────────────────────────────
def _reasons(code):
    return [why for _line, why in violations_in(code)]


def test_the_scanner_catches_every_spelling():
    assert _reasons("import app\napp.create_app()")
    assert _reasons("import app as app_module\nflask_app = app_module.create_app()")
    assert _reasons("from app import create_app")
    assert _reasons("from app import create_app as build\nbuild()")
    assert _reasons("import app\nf = app.create_app\nf()")
    assert _reasons("make = create_app")
    assert _reasons("import subprocess\nsubprocess.run(['python', '-c', 'import app as a; a.create_app();'])")
    assert _reasons("import subprocess\nsubprocess.Popen(['python', 'app.py'])")
    assert _reasons("import subprocess\nsubprocess.Popen(['gunicorn', 'app:app'])")
    assert _reasons("import subprocess\nsubprocess.run(['python', '-m', 'gunicorn'])")
    assert _reasons("import app\ngetattr(app, 'create_app')()")
    assert _reasons("import importlib\nimportlib.import_module('app').__dict__['x'] = exec('create_app()')")
    assert _reasons("x = 'a.create_app()'")


def test_the_scanner_leaves_harmless_code_alone():
    assert not _reasons('"""Module that talks about create_app() in its docstring."""\nx = 1')
    assert not _reasons("def f():\n    '''create_app() is what the factory is called'''\n    return 1")
    assert not _reasons("import subprocess\nsubprocess.run(['python', 'scripts/e2e_backend.py'])")
    assert not _reasons("import subprocess\nsubprocess.run(['git', 'status'])")
    assert not _reasons("import ast\nok = (n.name == 'create_app')")
    assert not _reasons("from tests.helpers_app import make_app, create_app_here")


def test_the_allowlist_proof_check_catches_a_late_chdir_or_a_missing_mkdtemp():
    good = "import os, tempfile\nw = tempfile.mkdtemp()\nos.chdir(w)\nimport app\napp.create_app()\n"
    assert allowlist_proof_problems("x.py", good) == []
    late = "import os, tempfile\nw = tempfile.mkdtemp()\nimport app\nos.chdir(w)\napp.create_app()\n"
    assert any("AFTER" in p for p in allowlist_proof_problems("x.py", late))
    no_tmp = "import os\nos.chdir('x')\nimport app\napp.create_app()\n"
    assert any("mkdtemp" in p for p in allowlist_proof_problems("x.py", no_tmp))
    no_chdir = "import tempfile\ntempfile.mkdtemp()\nimport app\napp.create_app()\n"
    assert any("chdir" in p for p in allowlist_proof_problems("x.py", no_chdir))
