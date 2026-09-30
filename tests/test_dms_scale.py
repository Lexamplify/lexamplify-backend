"""
Document Hub at scale: thousands of documents through the REAL upload -> read -> classify -> index path,
then search / list / facet timings on the finished library.

    python -m pytest tests/test_dms_scale.py -q -s                           # default 600 (about a minute)
    DMS_SCALE_N=3000 python -m pytest tests/test_dms_scale.py -q -s        # the full run used for the report (about 2.5 min)
    DMS_SCALE_N=0    python -m pytest tests/test_dms_scale.py               # skip

Numbers depend on the machine; the assertions are deliberately loose "nothing is broken" budgets,
the printed report is what to look at. The corpus is synthetic (scripts/make_sample_corpus.py) and was
written by the same people who wrote the classifier, so "agreement" measures wiring, not real-world
accuracy - it is reported, not sold.
"""
import concurrent.futures as cf
import json
import os
import statistics
import sys
import time

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

N = int(os.getenv("DMS_SCALE_N", "600"))
pytestmark = pytest.mark.skipif(N <= 0, reason="DMS_SCALE_N=0")


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(len(xs) * p))] if xs else 0.0


def timed(fn, *a, **k):
    t = time.perf_counter()
    r = fn(*a, **k)
    return (time.perf_counter() - t) * 1000, r


def test_thousands_of_documents(tmp_path, monkeypatch, hub_factory):
    import make_sample_corpus as M
    corp = tmp_path / "corpus"
    t0 = time.perf_counter()
    M.main(["--out", str(corp), "--count", str(N), "--seed", "11", "--scans", "0", "--max-pages", "30"])
    gen_s = time.perf_counter() - t0
    manifest = json.load(open(corp / "manifest.json"))

    hub = hub_factory(workers=4)
    me = hub.client(1)
    other = hub.client(2)

    # ── 1. bulk upload, 4 at a time, exactly like the browser does ─────────────────
    batch = "bulk-1"
    results = {}

    def send(item):
        c = hub.client(1)                       # one client per thread
        path = corp / item["file"]
        with open(path, "rb") as fh:
            data = fh.read()
        ms, r = timed(c.upload, os.path.basename(item["file"]), data, batch_id=batch, rel_path=item["file"])
        return item, ms, r.status_code, r.get_json()

    up_ms = []
    t0 = time.perf_counter()
    with cf.ThreadPoolExecutor(4) as ex:
        for item, ms, code, body in ex.map(send, manifest):
            up_ms.append(ms)
            results[item["file"]] = (code, body)
    upload_s = time.perf_counter() - t0

    created = {f: b["doc"]["id"] for f, (code, b) in results.items() if code == 201}
    dupes = {f for f, (code, b) in results.items() if code == 200 and b.get("duplicate")}
    refused = {f: code for f, (code, b) in results.items() if code not in (200, 201)}
    print(f"\n  uploaded {len(created)} files (+{len(dupes)} reported as duplicates, {len(refused)} refused) in {upload_s:.1f}s"
          f"  -> {len(manifest) / upload_s:.1f} files/s   upload latency p50 {pct(up_ms, .5):.0f}ms p95 {pct(up_ms, .95):.0f}ms")
    assert not refused, refused
    import hashlib
    hashes = {}
    for m in manifest:
        with open(corp / m["file"], "rb") as fh:
            hashes.setdefault(hashlib.sha256(fh.read()).hexdigest(), []).append(m["file"])
    # Which copy of a pair is "the duplicate" depends on which upload lands first, so compare counts and groups.
    want_dupes = sum(len(v) - 1 for v in hashes.values())
    assert len(dupes) == want_dupes, f"{len(dupes)} reported, {want_dupes} really are byte-identical to another file"
    for v in hashes.values():
        stored = [f for f in v if f in created]
        assert len(stored) == 1, f"identical files {v}: {len(stored)} stored, codes {[results[f][0] for f in v]}"

    # ── 2. wait for the background reader ──────────────────────────────────────────
    t0 = time.perf_counter()
    last, depth = None, None
    while time.perf_counter() - t0 < 1500:
        st = me.get("/api/dms/stats").get_json()
        depth = st["processing"]
        if depth == 0:
            break
        if last != depth and int(time.perf_counter() - t0) % 15 == 0:
            print(f"    ...{depth} still being read")
        last = depth
        time.sleep(0.5)
    process_s = time.perf_counter() - t0
    assert depth == 0, f"{depth} documents never finished"
    print(f"  background reading finished {process_s:.1f}s after the last upload  -> {len(created) / max(process_s + upload_s, .1):.1f} docs/s end-to-end")

    st = me.get("/api/dms/stats").get_json()
    assert st["documents"] == len(created)
    print(f"  library: {st['documents']} documents, {st['pages']} pages, {st['bytes'] / 1e6:.0f} MB; needs review {st['review']}, problems {st['problems']}")

    # ── 3. every file reached a sensible end state ─────────────────────────────────
    rows = hub.sql("SELECT doc_id, status, doc_class, review, meta, page_count, original_name FROM dms_docs WHERE is_current = 1")
    by_id = {r["doc_id"]: r for r in rows}
    statuses = {}
    for r in rows:
        statuses[r["status"]] = statuses.get(r["status"], 0) + 1
    print(f"  end states: {statuses}")
    assert set(statuses) <= {"ready", "failed", "empty"}, statuses
    damaged = by_id[created["Inbox/damaged.pdf"]]
    assert damaged["status"] == "failed"
    assert statuses.get("failed", 0) == 1, "only the deliberately damaged file may fail"

    # ── 4. classification vs. the generator's own labels ───────────────────────────
    ok = wrong = review = unk = 0
    confusions = {}
    with_case = case_ok = 0
    for m in manifest:
        if m["file"] not in created or not m.get("class"):
            continue
        r = by_id[created[m["file"]]]
        if r["doc_class"] == m["class"]:
            ok += 1
        elif r["doc_class"] in (None, "Unclassified"):
            unk += 1
        else:
            wrong += 1
            k = (m["class"], r["doc_class"])
            confusions[k] = confusions.get(k, 0) + 1
        if r["review"] == "needs_review":
            review += 1
        if m.get("case_no"):
            with_case += 1
            nums = (json.loads(r["meta"] or "{}")).get("case_numbers") or []
            norm = lambda s: "".join(ch for ch in s.upper() if ch.isalnum())
            if any(norm(n) == norm(m["case_no"]) for n in nums):
                case_ok += 1
    total = ok + wrong + unk
    print(f"  class agreement with generator: {ok}/{total} = {ok / total:.1%}  (wrong {wrong}, left Unclassified {unk}, flagged for review {review})")
    print(f"  case number recovered: {case_ok}/{with_case} = {case_ok / max(with_case, 1):.1%}")
    for (want, got), n in sorted(confusions.items(), key=lambda kv: -kv[1])[:6]:
        print(f"    confused: {want!r} -> {got!r}  x{n}")
    assert ok / total >= 0.85
    assert wrong / total <= 0.08, "confidently wrong labels must stay rare"
    assert case_ok / max(with_case, 1) >= 0.97

    # ── 5. search and list latency on the full library ─────────────────────────────
    sample = [m for m in manifest if m.get("case_no") and m["file"] in created][:40]
    lat = {"list": [], "search-word": [], "search-case": [], "phrase": [], "filter": [], "facets-off": []}
    for i in range(20):
        lat["list"].append(timed(me.get, f"/api/dms/docs?page={i + 1}&per_page=30")[0])
    for w in ("petitioner", "settled position", "interim relief", "irreparable", "tenant", "deponent", "hereby call upon", "consumer"):
        ms, r = timed(me.get, f"/api/dms/docs?q={w.replace(' ', '%20')}")
        lat["search-word"].append(ms)
        assert r.status_code == 200 and r.get_json()["total"] > 0, w
    miss = 0
    for m in sample:
        ms, r = timed(me.get, "/api/dms/docs?q=" + m["case_no"].replace(" ", "%20"))
        lat["search-case"].append(ms)
        ids = [d["id"] for d in r.get_json()["docs"]]
        miss += created[m["file"]] not in ids
    for q in ('"further hearing"', "petition -notice", "prayer OR summons"):
        lat["phrase"].append(timed(me.get, "/api/dms/docs?q=" + q.replace(" ", "%20").replace('"', "%22"))[0])
    for qs in ("class=Judgment", "class=Legal%20Notice&sort=date", "needs_review=1", "kind=pdf&q=court", "batch_id=bulk-1&page=3"):
        lat["filter"].append(timed(me.get, "/api/dms/docs?" + qs)[0])
    for i in range(10):
        lat["facets-off"].append(timed(me.get, "/api/dms/docs?facets=0&q=petitioner")[0])
    print(f"  case-number search found the right document {len(sample) - miss}/{len(sample)} times")
    print("  latency (ms)              p50     p95     max")
    for k, xs in lat.items():
        print(f"    {k:<20} {pct(xs, .5):7.0f} {pct(xs, .95):7.0f} {max(xs):7.0f}")
    assert miss == 0, "searching a case number must always surface that case's document"
    assert pct(lat["search-word"], .95) < 3000 and pct(lat["list"], .95) < 2000

    # ── 6. isolation still holds with thousands of rows ────────────────────────────
    assert other.docs()["total"] == 0
    assert other.get(f"/api/dms/docs/{next(iter(created.values()))}").status_code in (403, 404)

    # ── 7. bulk actions on a big selection ─────────────────────────────────────────
    some = list(created.values())[:min(500, len(created) // 2)]
    ms, r = timed(me.post, "/api/dms/bulk", json={"ids": some, "action": "tag_add", "tags": ["scaletest"]})
    body = r.get_json()
    print(f"  bulk tag of {len(some)} documents: {ms:.0f}ms  (done {body['done']}, skipped {len(body['skipped'])})")
    assert r.status_code == 200 and body["done"] == len(some) and not body["skipped"]
    assert me.docs(q="scaletest")["total"] == len(some)
    ms, r = timed(me.post, "/api/dms/bulk", json={"ids": some[:200], "action": "trash"})
    gone = len(some[:200])
    assert r.get_json()["done"] == gone
    print(f"  bulk trash of {gone} documents: {ms:.0f}ms")
    assert me.get("/api/dms/stats").get_json()["documents"] == len(created) - gone

    # ── 8. the audit chain is unbroken after all of it ─────────────────────────────
    import hashlib
    prev, n = "0" * 64, 0
    for row in hub.sql("SELECT * FROM vault_provenance ORDER BY id"):
        payload = "|".join(str(x) for x in (prev, row["node_type"], row["node_id"], row["node_name"], row["action"], row["actor_user_id"], row["owner_user_id"], row["detail"]))
        assert hashlib.sha256(payload.encode()).hexdigest() == row["content_hash"], f"chain broken at entry {row['id']}"
        prev, n = row["content_hash"], n + 1
    print(f"  audit chain: {n} entries, every link verified (uploaded from 4 threads at once)")
    assert n >= len(created)
    print(f"  corpus generation took {gen_s:.1f}s\n")
