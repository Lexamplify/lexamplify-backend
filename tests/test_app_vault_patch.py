"""
The app.py side of the Document Hub milestone: the fixes to the OLD Case Vault routes and the
hooks that keep them consistent with the hub.

app.py cannot be imported in a light environment (it needs Groq, Pinecone, Postgres ...), so these
tests pull the REAL source text of the functions out of app.py with `ast`, run them unchanged
against a throw-away database, and mount the real route functions on a small Flask app. Nothing
is re-implemented here: if app.py's code is wrong, these tests fail.
"""
import ast
import concurrent.futures as cf
import hashlib
import json
import os
import re
import sqlite3
import threading
import time
import uuid

import pytest
from flask import jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from conftest import ORDER_TEXT, make_pdf

APP_PY = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app.py")
SRC = open(APP_PY, encoding="utf-8").read()
TREE = ast.parse(SRC)

MODULE_FUNCS = ["_vault_owner_ok", "_current_vault_user_id", "_get_ancestor_folder_ids", "_effective_permission", "_visible_shared_vault_ids",
                "_vault_access_ok", "_write_provenance", "_dms_present", "_dms_hidden_sql", "_dms_legal_hold_titles", "_dms_adopt_best_effort",
                "format_vault_title", "resolve_vault_title", "extract_case_title_from_content", "_dms_member_ids", "_dms_shared", "_dms_folder_access"]
MODULE_ASSIGNS = ["_PERMISSION_RANK", "_PROVENANCE_LOCK", "_DMS_BP", "_dms_table_seen", "_DMS_MEMBER_CACHE", "_DMS_MEMBER_LOCK", "_DMS_MEMBER_TTL"]
ROUTES = ["get_vault_folders", "get_vault_documents", "get_vault_meta", "download_vault_document", "delete_vault_document", "delete_vault_folder",
          "upload_vault_document", "get_firm_library", "create_firm_library_entry"]


def _segment(node):
    return ast.get_source_segment(SRC, node)


def load_app_code(db, member_ids):
    ns = {"sqlite3": sqlite3, "json": json, "time": time, "hashlib": hashlib, "threading": threading, "re": re, "uuid": uuid, "os": os,
          "jsonify": jsonify, "request": request, "jwt_required": jwt_required, "get_jwt_identity": get_jwt_identity, "db": db,
          "_current_user_team_member_ids": lambda uid: list(member_ids.get(uid, []))}
    for node in TREE.body:
        if isinstance(node, ast.FunctionDef) and node.name in MODULE_FUNCS:
            exec(compile(ast.parse(_segment(node)), APP_PY, "exec"), ns)
        elif isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in MODULE_ASSIGNS for t in node.targets):
            exec(compile(ast.parse(_segment(node)), APP_PY, "exec"), ns)
    missing = [n for n in MODULE_FUNCS if n not in ns]
    assert not missing, f"not found in app.py: {missing}"
    return ns


def mount_routes(flask_app, ns):
    create_app = next(n for n in TREE.body if isinstance(n, ast.FunctionDef) and n.name == "create_app")
    found = {}
    for node in ast.walk(create_app):
        if isinstance(node, ast.FunctionDef) and node.name in ROUTES:
            route = next(d for d in node.decorator_list if isinstance(d, ast.Call) and getattr(d.func, "attr", "") == "route")
            path = route.args[0].value
            methods = [e.value for kw in route.keywords if kw.arg == "methods" for e in kw.value.elts]
            needs_jwt = any(isinstance(d, ast.Call) and getattr(d.func, "id", "") == "jwt_required" for d in node.decorator_list)
            code = _segment(node).split("\n", 1)[1]                    # drop decorator lines
            code = "\n".join(l for l in _segment(node).split("\n") if not l.lstrip().startswith("@app.route") and not l.lstrip().startswith("@jwt_required"))
            import textwrap
            exec(compile(textwrap.dedent(code), APP_PY, "exec"), ns)
            fn = ns[node.name]
            found[node.name] = (path, methods, fn, needs_jwt)
    assert set(found) == set(ROUTES), set(ROUTES) - set(found)
    for name, (path, methods, fn, needs_jwt) in found.items():
        flask_app.add_url_rule(path, endpoint="old_" + name, view_func=jwt_required()(fn) if needs_jwt else fn, methods=methods)
    return found


class Old:
    """The old Case Vault routes, running app.py's own code against the hub's database."""
    def __init__(self, hub, member_ids=None):
        self.hub = hub
        self.db = sqlite3.connect(hub.db_path, check_same_thread=False)
        self.db.execute("PRAGMA busy_timeout = 15000")
        self.member_ids = member_ids if member_ids is not None else {}
        self.ns = load_app_code(self.db, self.member_ids)
        mount_routes(hub.app, self.ns)
        self.ns["_DMS_BP"] = hub.bp
        hub.shared_override = self.ns["_dms_shared"]                # the hub now uses app.py's own sharing rules
        hub.folder_override = self.ns["_dms_folder_access"]

    def meta(self, c):
        r = c.get("/api/vault/meta")
        assert r.status_code == 200, r.get_json()
        return r.get_json()["documents"]

    def listing(self, c, **q):
        r = c.get("/api/vault/documents?" + "&".join(f"{k}={v}" for k, v in q.items()))
        assert r.status_code == 200, r.get_json()
        return r.get_json()


@pytest.fixture
def old(hub):
    o = Old(hub, member_ids={2: [200]})
    yield o
    o.db.close()


def up(c, name, data, **kw):
    r = c.upload(name, data, **kw)
    assert r.status_code == 201, r.get_json()
    did = r.get_json()["doc"]["id"]
    c.wait(did)
    return did


# ── the audit chain ────────────────────────────────────────────────────────────────────
def chain_report(hub):
    prev, n = "0" * 64, 0
    for r in hub.sql("SELECT * FROM vault_provenance ORDER BY id"):
        payload = "|".join(str(x) for x in (prev, r["node_type"], r["node_id"], r["node_name"], r["action"], r["actor_user_id"], r["owner_user_id"], r["detail"]))
        if hashlib.sha256(payload.encode()).hexdigest() != r["content_hash"]:
            return False, r["id"], n
        prev, n = r["content_hash"], n + 1
    return True, None, n


def test_provenance_chain_survives_old_and_new_writers_at_once(hub, old):
    """app.py's _write_provenance and the hub's own writer append to ONE chain from different threads."""
    write = old.ns["_write_provenance"]
    pdfs = [make_pdf([ORDER_TEXT + f"\nchain writer {i}"]) for i in range(12)]

    def old_writer(i):
        for j in range(15):
            write("document", 1000 + i, f"Old {i}-{j}", "renamed", 1, 1, {"n": j})

    def hub_writer(i):
        return hub.client(1).upload(f"n{i}.pdf", pdfs[i]).status_code

    with cf.ThreadPoolExecutor(8) as ex:
        futs = [ex.submit(old_writer, i) for i in range(4)] + [ex.submit(hub_writer, i) for i in range(12)]
        results = [f.result() for f in futs]
    assert results[4:] == [201] * 12
    ok, bad_at, n = chain_report(hub)
    assert ok, f"chain broken at entry {bad_at}"
    assert n >= 4 * 15 + 12


# ── sharing: a folder's NAME may be visible for navigation, its files are not ─────────
def test_sharing_one_document_does_not_expose_its_neighbours(hub, old):
    a, b = hub.client(1), hub.client(2)
    hub.sql("INSERT INTO vault_folders (id, name, parent_id, user_id) VALUES (1, 'Clients', NULL, 1), (2, 'Acme', 1, 1), (3, 'Other', NULL, 1)")
    shared = up(a, "shared.pdf", make_pdf([ORDER_TEXT + "\nshared one"]), folder_id=2)
    neighbour = up(a, "neighbour.pdf", make_pdf([ORDER_TEXT + "\nneighbour one"]), folder_id=2)
    parent_doc = up(a, "parent.pdf", make_pdf([ORDER_TEXT + "\nparent folder one"]), folder_id=1)
    hub.sql("INSERT INTO document_vault_shares (node_type, node_id, team_member_id, permission) VALUES ('document', ?, 200, 'view')", shared)
    ids = {d["id"] for d in old.meta(b)}
    assert shared in ids, "the shared document itself must be visible"
    assert neighbour not in ids and parent_doc not in ids, "documents in the same / an ancestor folder must stay private"
    assert {d["doc_id"] for d in [dict(r) for r in hub.sql("SELECT doc_id FROM dms_docs")]} >= {shared}
    assert b.docs()["total"] == 1                                       # the hub agrees


def test_a_folder_id_is_never_compared_with_a_document_id(hub, old):
    """Old code merged folder ids and document ids into one set: sharing folder #N exposed document #N."""
    a = hub.client(1)
    hub.sql("INSERT INTO vault_folders (id, name, parent_id, user_id) VALUES (1, 'Shared folder', NULL, 1)")
    first = up(a, "first.pdf", make_pdf([ORDER_TEXT + "\nfirst"]))
    assert first == 1                                                   # document #1 collides with folder #1
    hub.sql("INSERT INTO document_vault_shares (node_type, node_id, team_member_id, permission) VALUES ('folder', 1, 200, 'view')")
    assert first not in {d["id"] for d in old.meta(hub.client(2))}


def test_folder_share_still_shares_the_whole_subtree(hub, old):
    a, b = hub.client(1), hub.client(2)
    hub.sql("INSERT INTO vault_folders (id, name, parent_id, user_id) VALUES (10, 'Root', NULL, 1), (11, 'Child', 10, 1)")
    d1 = up(a, "a.pdf", make_pdf([ORDER_TEXT + "\nalpha"]), folder_id=10)
    d2 = up(a, "b.pdf", make_pdf([ORDER_TEXT + "\nbeta"]), folder_id=11)
    hub.sql("INSERT INTO document_vault_shares (node_type, node_id, team_member_id, permission) VALUES ('folder', 10, 200, 'edit')")
    assert {d1, d2} <= {d["id"] for d in old.meta(b)}
    assert {d1, d2} <= {d["id"] for d in b.docs()["docs"] and [{"id": x["id"]} for x in b.docs()["docs"]]}


# ── the old screens do not show what the hub has deleted ────────────────────────────────
def test_old_vault_hides_documents_in_the_hub_trash(hub, old):
    a = hub.client(1)
    hub.sql("INSERT INTO vault_folders (id, name, parent_id, user_id) VALUES (5, 'Matters', NULL, 1)")
    keep = up(a, "keep.pdf", make_pdf([ORDER_TEXT + "\nkeep me"]), folder_id=5)
    gone = up(a, "gone.pdf", make_pdf([ORDER_TEXT + "\ngone soon"]), folder_id=5)
    assert {keep, gone} <= {d["id"] for d in old.meta(a)}
    assert a.delete(f"/api/dms/docs/{gone}").status_code == 200
    assert gone not in {d["id"] for d in old.meta(a)} and gone not in {d["id"] for d in old.listing(a)["documents"]}
    assert keep in {d["id"] for d in old.meta(a)}
    counts = a.c.get("/api/vault/folders", headers=a.headers).get_json()["doc_counts"]
    assert counts["5"] == 1, "the folder count must not include the trashed file"
    assert a.post(f"/api/dms/docs/{gone}/restore").status_code == 200
    assert gone in {d["id"] for d in old.meta(a)}
    assert a.c.get("/api/vault/folders", headers=a.headers).get_json()["doc_counts"]["5"] == 2


def test_hub_file_size_shows_in_old_vault_and_old_download_works(hub, old):
    a = hub.client(1)
    pdf = make_pdf([ORDER_TEXT + "\nsized"])
    did = up(a, "ordér-आदेश.pdf", pdf)
    row = next(d for d in old.meta(a) if d["id"] == did)
    assert row["size_bytes"] == len(pdf)                                # hub files store no blob in the row: the size comes from the hub
    r = a.get(f"/api/vault/documents/{did}/download")
    assert r.status_code == 200 and r.data == pdf
    assert "attachment" in r.headers["Content-Disposition"]
    assert old.hub.client(2).get(f"/api/vault/documents/{did}/download").status_code == 404


# ── legal hold cannot be bypassed through the old Delete buttons ───────────────────────
def test_legal_hold_blocks_old_document_and_folder_delete(hub, old):
    a = hub.client(1)
    hub.sql("INSERT INTO vault_folders (id, name, parent_id, user_id) VALUES (7, 'Litigation', NULL, 1), (8, 'Sub', 7, 1)")
    held = up(a, "held.pdf", make_pdf([ORDER_TEXT + "\nheld"]), folder_id=8)
    free = up(a, "free.pdf", make_pdf([ORDER_TEXT + "\nfree"]), folder_id=7)
    assert a.patch(f"/api/dms/docs/{held}", json={"legal_hold": True}).status_code == 200
    r = a.delete(f"/api/vault/documents/{held}")
    assert r.status_code == 409 and "legal hold" in r.get_json()["message"]
    r = a.delete("/api/vault/folders/7")
    assert r.status_code == 409 and "legal hold" in r.get_json()["message"]
    assert hub.sql("SELECT COUNT(*) n FROM case_vault")[0]["n"] == 2 and hub.sql("SELECT COUNT(*) n FROM vault_folders")[0]["n"] == 2   # nothing was touched
    assert a.delete(f"/api/vault/documents/{free}").status_code == 200                                                                 # unheld files delete as before
    assert a.patch(f"/api/dms/docs/{held}", json={"legal_hold": False}).status_code == 200
    assert a.delete("/api/vault/folders/7").status_code == 200
    assert hub.sql("SELECT COUNT(*) n FROM dms_docs")[0]["n"] == 0                                                                      # hub rows follow the vault rows
    assert chain_report(hub)[0]


# ── old-style uploads are picked up by the hub straight away ────────────────────────────
def test_old_upload_route_registers_the_file_with_the_hub(hub, old):
    import io
    a = hub.client(1)
    pdf = make_pdf([ORDER_TEXT + "\nold upload route sphinx"])
    r = a.c.post("/api/vault/documents/upload", headers=a.headers, data={"file": (io.BytesIO(pdf), "scan0044.pdf")}, content_type="multipart/form-data")
    assert r.status_code == 201, r.get_json()
    did = r.get_json()["id"]
    a.wait(did)
    assert a.docs(q="sphinx")["total"] == 1
    d = a.get(f"/api/dms/docs/{did}").get_json()["doc"]
    assert d["doc_class"] == "Court Order" and d["status"] == "ready"
    blob = hub.sql("SELECT file_blob FROM case_vault WHERE id = ?", did)[0]["file_blob"]
    assert blob == pdf                                                  # the old row keeps its bytes: old screens are unaffected


# ── Firm Library used to be open to anyone and returned everybody's documents ───────────
def test_firm_library_needs_a_login_and_is_scoped(hub, old):
    a, b = hub.client(1), hub.client(2)
    anon = hub.app.test_client()
    assert anon.get("/api/firm-library").status_code in (401, 422)
    assert anon.post("/api/firm-library", json={"title": "x", "html": "<p>x</p>"}).status_code in (401, 422)
    r = a.post("/api/firm-library", json={"title": "Sale deed draft", "html": "<p>SALE DEED</p>", "category": "Deed"})
    assert r.status_code in (200, 201), r.get_json()
    hub.sql("INSERT INTO case_vault (case_id, title, doc_type, content, user_id) VALUES ('secret', 'Private strategy note', 'note', 'privileged', 2)")
    hub.sql("INSERT INTO case_vault (case_id, title, doc_type, content, user_id) VALUES ('old', 'Legacy shared precedent', 'note', 'legacy', NULL)")
    titles_a = {d["title"] for d in a.get("/api/firm-library").get_json()}
    titles_b = {d["title"] for d in b.get("/api/firm-library").get_json()}
    assert "Sale deed draft" in titles_a and "Private strategy note" not in titles_a
    assert "Private strategy note" in titles_b and "Sale deed draft" not in titles_b
    assert "Legacy shared precedent" in titles_a and "Legacy shared precedent" in titles_b       # legacy unowned rows behave as before


# ── plumbing used by the blueprint registration ────────────────────────────────────────
def test_shared_dependency_reports_content_folders_only(hub, old):
    hub.sql("INSERT INTO vault_folders (id, name, parent_id, user_id) VALUES (1, 'A', NULL, 1), (2, 'B', 1, 1)")
    a = hub.client(1)
    did = up(a, "x.pdf", make_pdf([ORDER_TEXT + "\nplumbing"]), folder_id=2)
    hub.sql("INSERT INTO document_vault_shares (node_type, node_id, team_member_id, permission) VALUES ('document', ?, 200, 'edit')", did)
    folders, docs, perm = old.ns["_dms_shared"](2)
    assert folders == set() and docs == {did} and perm(did) == "edit" and perm(did + 1) is None
    assert old.ns["_dms_shared"](3)[0] == set()
    assert old.ns["_dms_folder_access"](2, 1, True) is True and old.ns["_dms_folder_access"](2, 2, False) is False
    calls = []
    real = old.ns["_current_user_team_member_ids"]
    old.ns["_current_user_team_member_ids"] = lambda uid: (calls.append(uid), real(uid))[1]
    for _ in range(5):
        old.ns["_dms_shared"](2)
    assert len(calls) <= 1, "member-id resolution (a scan of every account) must not repeat on each request"
