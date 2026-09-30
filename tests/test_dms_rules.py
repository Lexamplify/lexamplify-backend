"""Document Hub: who can see what, versions, trash, legal hold, audit trail, encryption, exports."""
import csv
import hashlib
import io
import json
import os
import time
import zipfile

import pytest

from conftest import ORDER_TEXT, make_docx, make_pdf

NOTICE = b"LEGAL NOTICE\nUnder instructions from and on behalf of my client Alpha Traders you are hereby called upon to pay Rs 5,00,000 failing which proceedings shall follow. Yours faithfully."


def up(c, name, data=NOTICE, **kw):
    r = c.upload(name, data, **kw)
    assert r.status_code == 201, r.get_json()
    did = r.get_json()["doc"]["id"]
    c.wait(did)
    return did


def setup_matter(hub, owner=1, member=2, other=None):
    hub.sql("INSERT INTO teams(name, owner_user_id) VALUES ('Sharma & Associates', ?)", owner)
    tid = hub.sql("SELECT id FROM teams")[0]["id"]
    hub.sql("INSERT INTO team_memberships(team_id, user_id, role) VALUES (?, ?, 'member')", tid, member)
    hub.sql("INSERT INTO matters(title, team_id, owner_user_id) VALUES ('Rajesh Kumar v. Union of India', ?, ?)", tid, owner)
    return hub.sql("SELECT id FROM matters")[0]["id"]


def chain_ok(hub):
    prev = "0" * 64
    for r in hub.sql("SELECT * FROM vault_provenance ORDER BY id"):
        payload = "|".join(str(x) for x in (prev, r["node_type"], r["node_id"], r["node_name"], r["action"], r["actor_user_id"], r["owner_user_id"], r["detail"]))
        if hashlib.sha256(payload.encode()).hexdigest() != r["content_hash"]:
            return False, r["id"]
        prev = r["content_hash"]
    return True, None


# ── who can see what ────────────────────────────────────────────────────────────────
def test_strangers_see_nothing(hub):
    a, b = hub.client(1), hub.client(2)
    did = up(a, "notice.pdf", make_pdf(["LEGAL NOTICE zebra stripes"]))
    assert b.docs()["total"] == 0 and b.docs(q="zebra")["total"] == 0
    for path in (f"/api/dms/docs/{did}", f"/api/dms/docs/{did}/download", f"/api/dms/docs/{did}/file", f"/api/dms/docs/{did}/page/1",
                 f"/api/dms/docs/{did}/text", f"/api/dms/docs/{did}/hits?q=zebra"):
        assert b.get(path).status_code == 404, path
    assert b.patch(f"/api/dms/docs/{did}", {"title": "mine now"}).status_code == 404
    assert b.delete(f"/api/dms/docs/{did}").status_code == 404
    assert b.post(f"/api/dms/docs/{did}/reprocess").status_code == 404
    assert b.new_version(did, "x.pdf", make_pdf(["x"])).status_code == 404
    assert b.get("/api/dms/stats").get_json()["documents"] == 0
    assert b.get("/api/dms/duplicates").get_json()["count"] == 0
    assert b.post("/api/dms/bulk", json={"ids": [did], "action": "trash"}).get_json()["skipped"][0]["reason"] == "Document not found."


def test_unauthenticated_requests_are_refused(hub):
    c = hub.app.test_client()
    for method, url in (("get", "/api/dms/docs"), ("post", "/api/dms/upload"), ("get", "/api/dms/stats"), ("get", "/api/dms/docs/1/download"),
                        ("get", "/api/dms/export.csv"), ("post", "/api/dms/bulk")):
        assert getattr(c, method)(url).status_code == 401, url


def test_legacy_unowned_rows_are_never_shown(hub):
    hub.sql("INSERT INTO case_vault(case_id, title, user_id) VALUES ('General', 'old shared thing', NULL)")
    hub.sql("INSERT INTO dms_docs(doc_id, sha256, store_key, size, group_id, status) VALUES (1, 'a', 'a', 1, 1, 'ready')")
    assert hub.client(1).docs()["total"] == 0


def test_matter_team_shares_documents_and_roles_differ(hub):
    mid = setup_matter(hub, owner=1, member=2)
    senior, junior, outsider = hub.client(1), hub.client(2), hub.client(3)
    did = up(junior, "affidavit.pdf", make_pdf(["AFFIDAVIT I solemnly affirm deponent"]), matter_id=mid)
    assert senior.docs(matter_id=mid)["total"] == 1                 # the senior advocate sees the junior's upload
    assert outsider.docs()["total"] == 0
    assert outsider.upload("x.txt", b"hello", matter_id=mid).status_code == 404       # cannot drop files into a matter they are not on
    d = senior.get(f"/api/dms/docs/{did}").get_json()["doc"]
    assert d["level"] == "own" and d["matter_id"] == mid
    assert junior.get(f"/api/dms/docs/{did}").get_json()["doc"]["level"] == "own"     # the uploader owns their upload
    # a document the senior uploads: the junior may edit but never hold, purge or see others' trash decisions
    sid = up(senior, "order.pdf", make_pdf([ORDER_TEXT]), matter_id=mid)
    assert junior.get(f"/api/dms/docs/{sid}").get_json()["doc"]["level"] == "edit"
    assert junior.patch(f"/api/dms/docs/{sid}", {"tags": ["urgent"]}).status_code == 200
    assert junior.patch(f"/api/dms/docs/{sid}", {"legal_hold": True}).status_code == 403
    assert junior.delete(f"/api/dms/docs/{sid}").status_code == 200
    assert junior.delete(f"/api/dms/docs/{sid}/purge").status_code == 403
    assert senior.delete(f"/api/dms/docs/{sid}/purge").status_code == 200
    assert senior.get(f"/api/dms/docs/{sid}").status_code == 404


def test_vault_share_view_vs_edit(hub):
    a, b = hub.client(1), hub.client(2)
    did = up(a, "n.pdf", make_pdf(["shared secret paperwork"]))
    hub.sql("INSERT INTO document_vault_shares(node_type, node_id, team_member_id, permission) VALUES ('document', ?, 2, 'view')", did)
    assert b.docs(q="secret")["total"] == 1
    assert b.get(f"/api/dms/docs/{did}/download").status_code == 200
    assert b.patch(f"/api/dms/docs/{did}", {"title": "x"}).status_code == 403
    assert b.delete(f"/api/dms/docs/{did}").status_code == 403
    hub.sql("UPDATE document_vault_shares SET permission='edit' WHERE node_id=?", did)
    assert b.patch(f"/api/dms/docs/{did}", {"title": "renamed by editor"}).status_code == 200
    assert b.delete(f"/api/dms/docs/{did}/purge").status_code in (403, 409)


def test_cannot_file_into_someone_elses_folder_or_matter(hub):
    hub.sql("INSERT INTO vault_folders(name, user_id) VALUES ('Private', 1)")
    fid = hub.sql("SELECT id FROM vault_folders")[0]["id"]
    a, b = hub.client(1), hub.client(2)
    assert b.upload("x.txt", b"hi", folder_id=fid).status_code == 404
    did = up(b, "y.txt", b"mine")
    assert b.patch(f"/api/dms/docs/{did}", {"folder_id": fid}).status_code == 404
    assert b.patch(f"/api/dms/docs/{did}", {"matter_id": 999}).status_code == 404
    assert a.upload("z.txt", b"hello there", folder_id=fid).status_code == 201


# ── versions ────────────────────────────────────────────────────────────────────────
def test_versions_promote_and_search(hub):
    a = hub.client(1)
    v1 = up(a, "draft.pdf", make_pdf(["AGREEMENT first draft with penalty clause zulu"]))
    v2_bytes = make_pdf(["AGREEMENT second draft with arbitration clause yankee"])
    r = a.new_version(v1, "draft_v2.pdf", v2_bytes, note="client comments")
    assert r.status_code == 201
    v2 = r.get_json()["doc"]["id"]
    a.wait(v2)
    assert a.ids() == [v2]                                       # only the current version is listed
    assert a.docs(q="yankee")["total"] == 1 and a.docs(q="zulu")["total"] == 0
    assert a.docs(q="zulu", include_versions=1)["total"] == 1
    d = a.get(f"/api/dms/docs/{v2}").get_json()["doc"]
    assert [v["version"] for v in d["versions"]] == [2, 1] and d["version"] == 2 and d["title"] == "draft"
    assert a.new_version(v1, "same.pdf", v2_bytes).status_code == 409   # identical
    assert a.post(f"/api/dms/docs/{v1}/promote").status_code == 200
    assert a.ids() == [v1] and a.docs(q="zulu")["total"] == 1
    a.delete(f"/api/dms/docs/{v1}")                              # trashing a document trashes every version
    assert a.docs()["total"] == 0
    assert a.get("/api/dms/trash").get_json()["total"] >= 1
    a.post(f"/api/dms/docs/{v1}/restore")
    assert a.docs()["total"] == 1


# ── trash / legal hold ──────────────────────────────────────────────────────────────
def test_trash_restore_purge_and_shared_blob(hub):
    a = hub.client(1)
    data = make_pdf(["blob shared by two documents"])
    d1 = up(a, "one.pdf", data)
    d2 = a.upload("two.pdf", data, force=1).get_json()["doc"]["id"]
    a.wait(d2)
    sha = hub.sql("SELECT sha256, store_key FROM dms_docs WHERE doc_id=?", d1)[0]
    blob = os.path.join(str(hub.tmp / "files"), sha["store_key"])
    assert os.path.exists(blob)
    assert a.delete(f"/api/dms/docs/{d1}").status_code == 200
    assert a.docs(q="blob")["total"] == 1 and a.get("/api/dms/trash").get_json()["total"] == 1
    assert a.delete(f"/api/dms/docs/{d2}/purge").status_code == 409          # must be in the trash first
    assert a.delete(f"/api/dms/docs/{d1}/purge").status_code == 200
    assert os.path.exists(blob), "the other document still needs this file"
    a.delete(f"/api/dms/docs/{d2}")
    assert a.delete(f"/api/dms/docs/{d2}/purge").status_code == 200
    assert not os.path.exists(blob), "last reference gone -> file removed from disk"
    assert hub.sql("SELECT COUNT(*) n FROM dms_pages")[0]["n"] == 0
    assert hub.sql("SELECT COUNT(*) n FROM case_vault")[0]["n"] == 0
    assert a.docs(q="blob")["total"] == 0


def test_legal_hold_blocks_delete_and_purge_everywhere(hub):
    a = hub.client(1)
    did = up(a, "evidence.pdf", make_pdf(["critical evidence tango"]))
    assert a.patch(f"/api/dms/docs/{did}", {"legal_hold": True}).status_code == 200
    r = a.delete(f"/api/dms/docs/{did}")
    assert r.status_code == 409 and r.get_json()["code"] == "legal_hold"
    b = a.post("/api/dms/bulk", json={"ids": [did], "action": "trash"}).get_json()
    assert b["done"] == 0 and "legal hold" in b["skipped"][0]["reason"]
    assert a.docs(q="tango")["total"] == 1
    a.patch(f"/api/dms/docs/{did}", {"legal_hold": False})
    assert a.delete(f"/api/dms/docs/{did}").status_code == 200
    a.patch(f"/api/dms/docs/{did}", {"legal_hold": True}) if False else None


def test_expired_trash_is_purged_but_never_under_hold(hub):
    from utils import dms_index as I, dms_worker as W
    a = hub.client(1)
    keep = up(a, "held.pdf", make_pdf(["held document"]))
    gone = up(a, "junk.pdf", make_pdf(["junk document"]))
    a.patch(f"/api/dms/docs/{keep}", {"legal_hold": True})
    hub.sql("UPDATE dms_docs SET deleted_at='2020-01-01 00:00:00' WHERE doc_id IN (?, ?)", keep, gone)
    c = I.connect(hub.db_path)
    try:
        assert W.purge_expired_trash(c) == 1
    finally:
        c.close()
    assert [r["doc_id"] for r in hub.sql("SELECT doc_id FROM dms_docs")] == [keep]


def test_old_vault_route_deleting_a_row_leaves_no_ghosts(hub):
    a = hub.client(1)
    did = up(a, "ghost.pdf", make_pdf(["ghost words phantom"]))
    assert a.docs(q="phantom")["total"] == 1
    hub.sql("DELETE FROM case_vault WHERE id=?", did)               # what /api/vault/documents/<id> DELETE does
    assert a.docs(q="phantom")["total"] == 0
    assert hub.sql("SELECT COUNT(*) n FROM dms_docs")[0]["n"] == 0 and hub.sql("SELECT COUNT(*) n FROM dms_pages")[0]["n"] == 0


# ── edits, review queue, reprocess ──────────────────────────────────────────────────
def test_review_queue_corrections_survive_reprocess(hub):
    a = hub.client(1)
    did = up(a, "scan0007.pdf", make_pdf(["Some paper about a matter, nothing that says what kind of paper it is. Reference 17."]))
    d = a.get(f"/api/dms/docs/{did}").get_json()["doc"]
    assert d["doc_class"] == "Unclassified" and d["review"] == "needs_review"
    assert a.get("/api/dms/queue?kind=review").get_json()["total"] == 1
    r = a.patch(f"/api/dms/docs/{did}", {"doc_class": "Agreement / Contract", "title": "Consultancy terms", "doc_date": "2024-02-29",
                                          "case_numbers": ["CS 45/2023"], "parties": "A vs B", "tags": ["urgent", "Urgent", " client-x "]})
    assert r.status_code == 200, r.get_json()
    assert a.get("/api/dms/queue?kind=review").get_json()["total"] == 0
    assert a.patch(f"/api/dms/docs/{did}", {"doc_class": "Made Up"}).status_code == 400
    assert a.patch(f"/api/dms/docs/{did}", {"doc_date": "29/02/2024"}).status_code == 400
    assert a.post(f"/api/dms/docs/{did}/reprocess").status_code == 200
    a.wait(did)
    d = a.get(f"/api/dms/docs/{did}").get_json()["doc"]
    assert d["doc_class"] == "Agreement / Contract" and d["class_src"] == "user" and d["title"] == "Consultancy terms"
    assert d["doc_date"] == "2024-02-29" and d["case_numbers"] == ["CS 45/2023"] and d["parties"] == "A vs B"
    assert d["tags"] == ["urgent", "client-x"]
    assert a.docs(q="CS%2045/2023")["total"] == 1                    # corrected case number is searchable
    assert a.docs(q="Consultancy")["total"] == 1                     # so is the corrected title
    assert a.docs(**{"class": "Agreement%20/%20Contract"})["total"] == 1


def test_suggested_matter_is_a_suggestion_not_a_link(hub):
    mid = setup_matter(hub, owner=1, member=2)
    a = hub.client(1)
    first = up(a, "o1.pdf", make_pdf([ORDER_TEXT]), matter_id=mid)
    second = up(a, "o2.pdf", make_pdf([ORDER_TEXT.replace("15.05.2025", "20.06.2025")]))
    d = a.get(f"/api/dms/docs/{second}").get_json()["doc"]
    assert d["matter_id"] is None and d["suggested_matter"]["id"] == mid
    assert a.patch(f"/api/dms/docs/{second}", {"matter_id": mid}).status_code == 200
    assert a.docs(matter_id=mid)["total"] == 2 and a.docs(matter_id="none")["total"] == 0


def test_confident_documents_are_filed_into_blueprint_folders(hub):
    hub.sql("INSERT INTO vault_folders(name, user_id, protected) VALUES ('02 · Court Filings', 1, 1)")
    fid = hub.sql("SELECT id FROM vault_folders")[0]["id"]
    a = hub.client(1)
    did = up(a, "order.pdf", make_pdf([ORDER_TEXT, "Heard learned counsel. The next date of hearing is fixed."]))
    d = a.get(f"/api/dms/docs/{did}").get_json()["doc"]
    assert d["doc_class"] == "Court Order"
    if d["class_conf"] >= 0.72:
        assert d["folder_id"] == fid and d["auto_filed"] is True
    # explicit placement is never overridden
    hub.sql("INSERT INTO vault_folders(name, user_id) VALUES ('Mine', 1)")
    mine = hub.sql("SELECT id FROM vault_folders WHERE name='Mine'")[0]["id"]
    d2 = up(a, "order2.pdf", make_pdf([ORDER_TEXT + " again"]), folder_id=mine)
    assert a.get(f"/api/dms/docs/{d2}").get_json()["doc"]["folder_id"] == mine


# ── search behaviour ────────────────────────────────────────────────────────────────
def test_search_is_safe_and_predictable(hub):
    a = hub.client(1)
    up(a, "a.pdf", make_pdf(["Arbitration clause between Alpha and Beta. Seat of arbitration is Delhi."]))
    up(a, "b.pdf", make_pdf(["Lease of the shop premises. No arbitration here, only rent."]))
    up(a, "c.pdf", make_pdf(["Delhi High Court order on bail."]))
    evil = ['"', "'", "OR AND NEAR ( ) * ^ :", "\"unterminated phrase", "col:val", "a AND b", "; DROP TABLE dms_docs; --", "%", "\\", "\x00", "-", "--x", "((((", "*", "\U0001f600"]
    for q in evil:
        r = a.get("/api/dms/docs", query_string={"q": q})
        assert r.status_code == 200, (q, r.data[:200])
    assert a.docs(q="arbitration")["total"] == 2
    assert a.docs(q="arbitration%20delhi")["total"] == 1
    assert a.docs(q="arbitration%20-lease")["total"] == 1
    assert a.docs(q="%22seat%20of%20arbitration%22")["total"] == 1
    assert a.docs(q="arbitr")["total"] == 2                          # prefix match on 4+ letter words
    assert a.docs(q="ARBITRATION")["total"] == 2
    top = a.docs(q="arbitration%20delhi")["docs"][0]
    assert "\x02" in top["hit"]["snippet"] and top["hit"]["page"] == 1
    # ranking prefers the document about arbitration over the one that merely mentions it
    order = [d["title"] for d in a.docs(q="arbitration")["docs"]]
    assert order[0] == "a"


def test_filters_facets_sorting_and_pagination(hub):
    a = hub.client(1)
    ids = [up(a, f"order{i}.pdf", make_pdf([ORDER_TEXT.replace("12-03-2025", f"{10 + i}-03-2025").replace("1234/2024", f"{1234 + i}/2024")])) for i in range(5)]
    up(a, "notice.pdf", make_pdf(["LEGAL NOTICE hereby called upon failing which at your risk as to costs. Date: 05-01-2025"]))
    res = a.docs(per_page=2, page=1)
    assert res["total"] == 6 and len(res["docs"]) == 2
    assert len({d["id"] for d in a.docs(per_page=2, page=2)["docs"]} & {d["id"] for d in res["docs"]}) == 0
    assert a.docs(**{"class": "Legal%20Notice"})["total"] == 1
    assert res["facets"]["classes"].get("Court Order") == 5 and res["facets"]["classes"].get("Legal Notice") == 1
    assert a.docs(**{"class": "Legal%20Notice"})["facets"]["classes"].get("Court Order") == 5      # facets ignore their own selection
    assert a.docs(date_from="2025-03-12", date_to="2025-03-13")["total"] == 2
    assert a.docs(case="WP(C)%201236/2024")["total"] == 1
    dates = [d["doc_date"] for d in a.docs(sort="doc_date_asc", per_page=10)["docs"] if d["doc_date"]]
    assert dates == sorted(dates)
    assert [d["title"] for d in a.docs(sort="name", per_page=10)["docs"]] == sorted(d["title"] for d in a.docs(sort="name", per_page=10)["docs"])
    st = a.get("/api/dms/stats").get_json()
    assert st["documents"] == 6 and sum(x["n"] for x in st["activity"]) == 6 and st["classes"]["Court Order"] == 5


# ── bulk ────────────────────────────────────────────────────────────────────────────
def test_bulk_actions_report_what_they_skipped(hub):
    a, b = hub.client(1), hub.client(2)
    mine = [up(a, f"m{i}.txt", f"document number {i} kilo".encode()) for i in range(3)]
    theirs = up(b, "t.txt", b"someone else's paper")
    hub.sql("INSERT INTO vault_folders(name, user_id) VALUES ('Bundle', 1)")
    fid = hub.sql("SELECT id FROM vault_folders")[0]["id"]
    r = a.post("/api/dms/bulk", json={"ids": mine + [theirs], "action": "move", "folder_id": fid}).get_json()
    assert r["done"] == 3 and r["skipped"][0]["id"] == theirs
    assert a.docs(folder_id=fid)["total"] == 3
    assert a.post("/api/dms/bulk", json={"ids": mine, "action": "classify", "doc_class": "Exhibit / Annexure"}).get_json()["done"] == 3
    assert a.post("/api/dms/bulk", json={"ids": mine, "action": "tag_add", "tags": ["bundle-a"]}).get_json()["done"] == 3
    assert a.docs(**{"class": "Exhibit%20/%20Annexure"})["total"] == 3
    assert a.get(f"/api/dms/docs/{mine[0]}").get_json()["doc"]["tags"] == ["bundle-a"]
    assert a.post("/api/dms/bulk", json={"ids": mine, "action": "trash"}).get_json()["done"] == 3
    assert a.post("/api/dms/bulk", json={"ids": mine, "action": "restore"}).get_json()["done"] == 3
    assert a.post("/api/dms/bulk", json={"ids": mine, "action": "explode"}).status_code == 400
    assert a.post("/api/dms/bulk", json={"ids": [], "action": "trash"}).status_code == 400
    assert a.post("/api/dms/bulk", json={"ids": mine, "action": "trash"}).get_json()["done"] == 3
    assert a.post("/api/dms/trash/empty").get_json()["purged"] == 3
    assert a.get("/api/dms/trash").get_json()["total"] == 0


# ── audit trail ─────────────────────────────────────────────────────────────────────
def test_every_change_is_on_an_unbroken_provenance_chain(hub):
    a, b = hub.client(1), hub.client(3)                       # 3 is not on the matter's team
    mid = setup_matter(hub, 1, 2)
    d = up(a, "x.pdf", make_pdf([ORDER_TEXT]))
    a.patch(f"/api/dms/docs/{d}", {"title": "Renamed", "doc_class": "Judgment", "matter_id": mid, "tags": ["t"], "legal_hold": True})
    a.patch(f"/api/dms/docs/{d}", {"legal_hold": False})
    a.new_version(d, "x2.pdf", make_pdf([ORDER_TEXT + " v2"]))
    a.get(f"/api/dms/docs/{d}/download")
    a.post("/api/dms/download-zip", json={"ids": [d]})
    a.get("/api/dms/export.csv")
    a.delete(f"/api/dms/docs/{d}")
    a.post(f"/api/dms/docs/{d}/restore")
    actions = [r["action"] for r in hub.sql("SELECT action FROM vault_provenance ORDER BY id")]
    for expected in ("upload", "renamed", "reclassified", "matter-linked", "tags-edited", "legal-hold-on", "legal-hold-off", "new-version",
                     "download", "exported", "trashed", "restored"):
        assert expected in actions, expected
    ok, broken = chain_ok(hub)
    assert ok, f"chain broken at {broken}"
    # a rejected change writes nothing
    n = len(actions)
    b.patch(f"/api/dms/docs/{d}", {"title": "hack"})
    assert len(hub.sql("SELECT id FROM vault_provenance")) == n


def test_concurrent_uploads_keep_the_chain_intact(hub):
    import threading
    a = hub.client(1)
    errs = []

    def worker(k):
        c = hub.client(1)
        for i in range(8):
            r = c.upload(f"t{k}_{i}.txt", f"thread {k} document {i} unique-{k}-{i}".encode())
            if r.status_code != 201:
                errs.append(r.get_json())
    ts = [threading.Thread(target=worker, args=(k,)) for k in range(6)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert not errs, errs[:2]
    assert len(hub.sql("SELECT doc_id FROM dms_docs")) == 48
    ok, broken = chain_ok(hub)
    assert ok, broken
    a.wait([r["doc_id"] for r in hub.sql("SELECT doc_id FROM dms_docs")], timeout=120)
    assert a.docs(q="unique-3-5")["total"] == 1


# ── exports ─────────────────────────────────────────────────────────────────────────
def test_csv_export_neutralises_spreadsheet_formulas(hub):
    a = hub.client(1)
    did = up(a, "=HYPERLINK(\"http://evil\",\"x\").txt", b"formula named file text")
    a.patch(f"/api/dms/docs/{did}", {"title": "=cmd|' /C calc'!A0", "parties": "+SUM(1+1)"})
    body = a.get("/api/dms/export.csv").data.decode("utf-8-sig")
    rows = list(csv.reader(io.StringIO(body)))
    assert rows[0][0] == "ID" and len(rows) == 2
    for cell in rows[1]:
        assert not cell.startswith(("=", "+", "-", "@")), cell


def test_zip_download_contains_the_original_bytes(hub):
    a = hub.client(1)
    data1, data2 = make_pdf(["first"]), make_docx(["second paper"])
    d1, d2 = up(a, "same name.pdf", data1), up(a, "same name.pdf", make_pdf(["other"]))
    d3 = up(a, "second.docx", data2)
    r = a.post("/api/dms/download-zip", json={"ids": [d1, d2, d3]})
    assert r.status_code == 200 and r.mimetype == "application/zip"
    zf = zipfile.ZipFile(io.BytesIO(r.data))
    names = zf.namelist()
    assert len(names) == 3 and len(set(n.lower() for n in names)) == 3
    assert zf.read("second.docx") == data2 and zf.read("same name.pdf") == data1
    assert a.post("/api/dms/download-zip", json={"ids": list(range(1, 300))}).status_code == 400


# ── storage ─────────────────────────────────────────────────────────────────────────
def test_encryption_at_rest_hides_content_but_everything_still_works(hub_factory):
    from cryptography.fernet import Fernet
    h = hub_factory(encryption_key=Fernet.generate_key().decode())
    a = h.client(1)
    secret = "Confidential settlement figure is Rs 88,88,888 mike"
    pdf = make_pdf([secret])
    did = up(a, "settlement.pdf", pdf)
    on_disk = []
    for base, _d, files in os.walk(str(h.tmp / "files")):
        if "_incoming" in base:
            continue
        for f in files:
            on_disk.append(open(os.path.join(base, f), "rb").read())
    assert on_disk and all(b"88,88,888" not in blob and b"%PDF" not in blob[:16] for blob in on_disk)
    assert a.get(f"/api/dms/docs/{did}/download").data == pdf
    assert a.docs(q="mike")["total"] == 1
    assert a.get(f"/api/dms/docs/{did}/page/1?terms=settlement").mimetype == "image/jpeg"
    assert a.get("/api/dms/config").get_json()["encryption"]["enabled"] is True
    assert not any(f.startswith("dec_") for f in os.listdir(str(h.tmp / "files" / "_incoming")))    # no plaintext temp left behind


def test_wrong_encryption_key_fails_cleanly(hub_factory, monkeypatch):
    from cryptography.fernet import Fernet
    h = hub_factory(encryption_key=Fernet.generate_key().decode())
    a = h.client(1)
    did = up(a, "s.pdf", make_pdf(["enc doc"]))
    monkeypatch.setenv("DMS_ENCRYPTION_KEY", Fernet.generate_key().decode())
    r = a.get(f"/api/dms/docs/{did}/download")
    assert r.status_code in (410, 500) and r.get_json()["message"]


def test_crashed_worker_jobs_are_recovered(hub):
    from utils import dms_index as I, dms_worker as W
    a = hub.client(1)
    did = up(a, "n.txt", b"resilient text words")
    c = I.connect(hub.db_path)
    try:
        c.execute("UPDATE dms_jobs SET status='running', locked_at=?, attempts=1 WHERE doc_id=?", (time.time() - 99999, did))
        c.execute("UPDATE dms_docs SET status='processing' WHERE doc_id=?", (did,))
        c.commit()
        assert W.recover_stale(c) == 1
        assert c.execute("SELECT status FROM dms_jobs WHERE doc_id=?", (did,)).fetchone()[0] == "queued"
    finally:
        c.close()
    hub.bp.worker.kick()
    a.wait(did)
    assert a.get(f"/api/dms/docs/{did}").get_json()["doc"]["status"] == "ready"


def test_batch_progress_endpoint(hub):
    a = hub.client(1)
    ids = [a.upload(f"b{i}.txt", f"batch member {i} papa".encode(), batch_id="batch-1").get_json()["doc"]["id"] for i in range(6)]
    a.wait(ids)
    b = a.get("/api/dms/batches/batch-1").get_json()
    assert b["total"] == 6 and b["done"] == 6 and b["working"] == 0
    assert hub.client(2).get("/api/dms/batches/batch-1").get_json()["total"] == 0


def test_identical_files_sent_at_the_same_moment_are_stored_once(hub):
    """A dropped folder with two copies of one file is uploaded 3-4 at a time; both copies must not slip in."""
    import concurrent.futures as cf
    data = make_pdf([ORDER_TEXT + "\nsame-instant race"])
    with cf.ThreadPoolExecutor(8) as ex:
        res = list(ex.map(lambda i: hub.client(1).upload(f"o{i}.pdf", data), range(8)))
    assert sorted(r.status_code for r in res) == [200] * 7 + [201]
    assert all(r.get_json().get("duplicate") for r in res if r.status_code == 200)
    assert hub.sql("SELECT COUNT(*) n FROM dms_docs WHERE is_current = 1")[0]["n"] == 1
    assert len(os.listdir(hub.tmp / "files" / "_incoming")) == 0 if (hub.tmp / "files" / "_incoming").exists() else True


def test_existing_case_vault_files_are_brought_in_without_touching_the_originals(hub):
    """Files uploaded through the old Case Vault screens (bytes in SQLite) must show up in the hub."""
    import sqlite3
    pdf = make_pdf([ORDER_TEXT + "\nlegacy bytes marker gryphon"])
    db = sqlite3.connect(hub.db_path)
    db.execute("INSERT INTO case_vault (case_id, title, doc_type, content, folder_id, smart_title, tags, file_blob, file_format, user_id) "
               "VALUES ('General', 'scan0009.pdf', 'uploaded', '', NULL, 'scan0009', 'UNCLASSIFIED', ?, 'pdf', 1)", (pdf,))
    db.execute("INSERT INTO case_vault (case_id, title, doc_type, content, user_id) VALUES ('draft_1', 'Lease draft', 'Firm Library Draft', "
               "'<h1>LEASE DEED</h1><p>The lessor hereby demises the property to the lessee</p>', 1)")
    db.execute("INSERT INTO case_vault (case_id, title, doc_type, content, file_blob, file_format, user_id) VALUES ('General', 'run.exe', 'uploaded', '', ?, 'exe', 1)", (b"MZ\x90\x00" + b"\x00" * 200,))
    db.execute("INSERT INTO case_vault (case_id, title, doc_type, content, user_id) VALUES ('General', 'nothing', 'note', '', 1)")        # no bytes, no text: nothing to bring in
    db.execute("INSERT INTO case_vault (case_id, title, doc_type, content, file_blob, file_format, user_id) VALUES ('General', 'theirs.pdf', 'uploaded', '', ?, 'pdf', 2)", (pdf,))
    db.commit()
    db.close()
    a, b = hub.client(1), hub.client(2)
    assert a.get("/api/dms/stats").get_json()["unadopted"] == 3
    r = a.post("/api/dms/adopt", json={}).get_json()
    assert r["adopted"] == 3 and r["failed"] == 0 and r["remaining"] == 0
    ids = [x["doc_id"] for x in hub.sql("SELECT doc_id FROM dms_docs")]
    a.wait(ids)
    assert a.docs(q="gryphon")["total"] == 1                      # the old upload is now readable and searchable
    assert a.docs(q="lessor")["total"] == 1                       # so is the saved draft
    pdf_doc = a.docs(q="gryphon")["docs"][0]
    assert pdf_doc["doc_class"] == "Court Order" and pdf_doc["title"].startswith("Court Order")
    row = hub.sql("SELECT file_blob, folder_id, smart_title FROM case_vault WHERE title = 'scan0009.pdf'")[0]
    assert row["file_blob"] == pdf                                # original bytes untouched
    assert row["folder_id"] is None                               # never auto-filed: existing files stay where the user left them
    assert a.post("/api/dms/adopt", json={}).get_json()["adopted"] == 0        # idempotent
    assert b.get("/api/dms/stats").get_json()["unadopted"] == 1 and b.docs()["total"] == 0     # other people's files stay theirs
    assert ok_chain(hub)


def ok_chain(hub):
    return chain_ok(hub)[0]


def test_config_warns_when_files_would_not_survive_a_redeploy(hub, monkeypatch):
    a = hub.client(1)
    monkeypatch.setenv("RENDER", "true")
    monkeypatch.delenv("PERSISTENT_DATA_DIR", raising=False)
    monkeypatch.setenv("DMS_STORAGE_DIR", str(hub.tmp / "files"))
    assert a.get("/api/dms/config").get_json()["storage"]["at_risk"] is False        # an explicit storage folder is trusted
    monkeypatch.delenv("DMS_STORAGE_DIR")
    cwd = os.getcwd()
    os.chdir(hub.tmp)
    try:
        st = a.get("/api/dms/config").get_json()["storage"]
    finally:
        os.chdir(cwd)
    assert st["at_risk"] is True and st["persistent"] is False
    monkeypatch.delenv("RENDER")


def test_folder_filter_includes_subfolders_and_select_all_ids(hub):
    a = hub.client(1)
    hub.sql("INSERT INTO vault_folders (id, name, parent_id, user_id) VALUES (1, 'Clients', NULL, 1), (2, 'Acme', 1, 1), (3, 'Zed', NULL, 1)")
    d1 = up(a, "a.pdf", make_pdf([ORDER_TEXT + "\nfolder one"]), folder_id=1)
    d2 = up(a, "b.pdf", make_pdf([ORDER_TEXT + "\nfolder two"]), folder_id=2)
    d3 = up(a, "c.pdf", make_pdf([ORDER_TEXT + "\nfolder three"]), folder_id=3)
    assert set(a.ids(folder_id=1)) == {d1}
    assert set(a.ids(folder_id=1, subfolders=1)) == {d1, d2}
    got = a.get("/api/dms/ids?folder_id=1&subfolders=1").get_json()
    assert set(got["ids"]) == {d1, d2} and got["total"] == 2 and got["capped"] is False
    assert set(a.get("/api/dms/ids?q=folder").get_json()["ids"]) == {d1, d2, d3}
    assert hub.client(2).get("/api/dms/ids").get_json()["ids"] == []


def test_folder_counts_stay_visible_when_one_folder_is_selected(hub):
    """Picking a folder must not zero every other folder in the sidebar; counts still honour search + type filters."""
    a = hub.client(1)
    hub.sql("INSERT INTO vault_folders (id, name, parent_id, user_id) VALUES (1, 'Clients', NULL, 1), (3, 'Zed', NULL, 1)")
    up(a, "a.pdf", make_pdf([ORDER_TEXT + "\nfolder one"]), folder_id=1)
    up(a, "b.pdf", make_pdf([ORDER_TEXT + "\nfolder one again"]), folder_id=1)
    up(a, "c.pdf", make_pdf([ORDER_TEXT + "\nfolder three"]), folder_id=3)
    up(a, "n.pdf", make_pdf([NOTICE.decode()]), folder_id=3)
    for extra in ("", "&q=folder"):
        fac = a.get(f"/api/dms/docs?folder_id=1{extra}").get_json()["facets"]["folders"]
        assert fac.get("1") == 2 and fac.get("3") == (2 if not extra else 1), (extra, fac)
    only_orders = a.get("/api/dms/docs?folder_id=1&class=Court%20Order").get_json()
    assert only_orders["total"] == 2 and only_orders["facets"]["folders"].get("3") == 1
    assert a.get("/api/dms/docs?folder_id=1&facets=1&q=folder").get_json()["total"] == 2


def test_every_sidebar_count_honours_all_filters_but_its_own(hub):
    """Standard faceted search: a count says how many results you would get by picking that entry."""
    a = hub.client(1)
    up(a, "o1.pdf", make_pdf([ORDER_TEXT + "\nalpha"]))
    up(a, "o2.pdf", make_pdf([ORDER_TEXT + "\nbeta"]))
    up(a, "n1.pdf", make_pdf([NOTICE.decode() + "\nalpha"]))
    up(a, "n2.txt", NOTICE + b"\ngamma")
    hub.sql("UPDATE dms_docs SET status='failed' WHERE doc_id = (SELECT doc_id FROM dms_docs ORDER BY doc_id LIMIT 1)")

    def fac(qs):
        return a.get("/api/dms/docs?" + qs).get_json()["facets"]

    allf = fac("")
    n_all = sum(allf["classes"].values())
    assert n_all == 4 and sum(allf["statuses"].values()) == 4 and sum(allf["kinds"].values()) == 4
    by_class = fac("class=Court%20Order")
    assert by_class["classes"] == allf["classes"]                      # a type count ignores the type filter ...
    assert sum(by_class["statuses"].values()) == 2                     # ... but the status counts follow it
    assert sum(by_class["kinds"].values()) == 2 and sum(by_class["folders"].values()) == 2
    by_status = fac("status=ready")
    assert sum(by_status["classes"].values()) == 3 and by_status["statuses"] == allf["statuses"]
    by_kind = fac("kind=pdf")
    assert by_kind["kinds"] == allf["kinds"] and sum(by_kind["classes"].values()) == 3   # other file types stay visible
    with_search = fac("class=Court%20Order&q=alpha")
    assert with_search["statuses"] == {"failed": 1}                    # "alpha" is in o1 (a Court Order) and both notices
    assert with_search["classes"] == {"Court Order": 1, "Legal Notice": 2}
    only_excluded = fac("q=-alpha")
    assert sum(only_excluded["classes"].values()) == 1                 # only o2 lacks the word
    # the list itself is the intersection of everything
    assert a.docs(**{"class": "Court%20Order", "kind": "pdf", "status": "ready"})["total"] == sum(
        1 for d in a.docs(**{"class": "Court%20Order"})["docs"] if d["kind"] == "pdf" and d["status"] == "ready")
