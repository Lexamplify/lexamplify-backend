"""The golden corpus (tests/fixtures/indian_legal): every file through the real routes. The AI is replaced by a deterministic stand-in.

Run `python scripts/make_corpus.py` to rebuild the corpus. Ground truth for the cheque-bounce packs is in manifest.json.
"""
import io
import json
import os
import random
import re
import threading
import time
from datetime import date, timedelta

import pytest

from tests.helpers_app import make_app, register
from utils.draft_engine import export, validators as V, verifier
from utils.draft_engine.render import blocks_to_text, fixed_text, render

CORPUS = os.path.join(os.path.dirname(__file__), "fixtures", "indian_legal")
MANIFEST = json.load(open(os.path.join(CORPUS, "manifest.json"), encoding="utf-8"))["files"]
MIME = {".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".txt": "text/plain"}


def _bytes(name):
    return open(os.path.join(CORPUS, name), "rb").read()


@pytest.fixture(scope="module")
def world(tmp_path_factory):
    mp = pytest.MonkeyPatch()
    flask_app = make_app(tmp_path_factory.mktemp("corpus"), mp)
    a = register(flask_app, "corpus@example.com")
    import routes.contract_routes as cr
    import utils.ai_helper as ah

    def fake_chunk(chunk, strategy="Defensive"):
        found = []
        for pat, title, level in ((r"[^.\n]*without notice[^.\n]*\.", "Termination without notice", "High"), (r"[^.\n]*24% per month[^.\n]*\.", "Excessive interest", "Medium")):
            m = re.search(pat, chunk)
            if m:
                found.append({"title": title, "original_text": m.group(0).strip(), "risk_level": level, "explanation": "Simulated.", "location": "Clause",
                              "playbook_rule": "Indian Contract Act, 1872", "suggested_revision": "Either party may terminate on 30 days' written notice."})
        found.append({"title": "Invented", "original_text": "The Contractor shall indemnify the Client without any limit whatsoever for every loss.", "risk_level": "High",
                      "explanation": "x", "location": "x", "playbook_rule": "x", "suggested_revision": "y"})
        return {"summary": "A service agreement.", "clauses": found}

    mp.setattr(cr, "analyze_contract_with_llm", fake_chunk)
    mp.setattr(ah, "ask_groq", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no model in tests")))
    yield flask_app, a
    mp.undo()


def _upload(client, name):
    ext = os.path.splitext(name)[1]
    return client.post("/api/contract/extract-text", data={"file": (io.BytesIO(_bytes(name)), name, MIME.get(ext, "application/octet-stream"))}, content_type="multipart/form-data")


def test_the_corpus_is_big_and_varied_enough():
    kinds = {m["kind"] for m in MANIFEST}
    assert len(MANIFEST) >= 30 and kinds == {"pdf", "docx", "txt"}
    expects = {m["expect"] for m in MANIFEST}
    assert {"ok", "BLANK_DOCUMENT", "NOT_A_PDF", "NOT_A_DOCX", "MACRO_DOCUMENT", "EMPTY_FILE", "EXTRACTION_ERROR"} <= expects


@pytest.mark.parametrize("entry", MANIFEST, ids=[m["file"] for m in MANIFEST])
def test_every_file_gets_the_outcome_the_manifest_expects_and_never_a_5xx(world, entry):
    _f, a = world
    r = _upload(a, entry["file"])
    assert r.status_code < 500, (entry["file"], r.status_code, r.get_data(as_text=True)[:200])
    body = r.get_json()
    if entry["expect"] == "ok":
        assert r.status_code == 200 and body["text"].strip() and body["word_count"] > 5, entry["file"]
        if entry.get("pages_at_least"):
            assert body["page_count"] >= entry["pages_at_least"] * 0.5
    else:
        assert r.status_code in (400, 413, 422) and body["code"] == entry["expect"], (entry["file"], body)
        assert body["message"] and "Traceback" not in body["message"] and "{" not in body["message"]


def _norm_fact(key, value):
    if key in ("cheque_amount",):
        a = V.parse_amount(value)
        return str(a) if a is not None else str(value).lower()
    if key in ("cheque_date", "return_memo_date", "presentation_date"):
        d = V.parse_date(value)
        return d.isoformat() if d else str(value).lower()
    return re.sub(r"\s+", " ", str(value)).strip().lower()


MEMOS = [m for m in MANIFEST if m.get("doc_type") == "notice_138" and m.get("facts") and m["expect"] == "ok"]


@pytest.mark.parametrize("entry", MEMOS, ids=[m["file"] for m in MEMOS])
def test_cheque_pack_extraction_matches_the_truth_and_never_returns_a_wrong_value(world, entry):
    _f, a = world
    text = _upload(a, entry["file"]).get_json()["text"]
    fields = a.post("/api/drafts/extract", json={"type": "notice_138", "text": text, "source_name": entry["file"]}).get_json()["fields"]
    truth = entry["facts"]
    for key, expected in truth.items():
        if key in fields:                                            # a missing value is acceptable; a wrong one is not
            assert _norm_fact(key, fields[key]["value"]) == _norm_fact(key, expected), (entry["file"], key, fields[key]["value"], expected)
            assert fields[key]["snippet"] and fields[key]["source_doc"] == entry["file"]
    assert {"cheque_no", "cheque_amount"} <= set(fields) or entry["file"].startswith("mixed"), (entry["file"], sorted(fields))


def test_a_cheque_memo_flows_into_a_verified_word_notice(world, tmp_path):
    _f, a = world
    entry = next(m for m in MEMOS if m["file"].endswith("memo_1.pdf"))
    text = _upload(a, entry["file"]).get_json()["text"]
    fields = a.post("/api/drafts/extract", json={"type": "notice_138", "text": text}).get_json()["fields"]
    facts = {k: v["value"] for k, v in fields.items()}
    facts.update({"sender_name": entry["parties"]["payee"], "sender_address": "14 Cross Street, Chennai - 600017", "advocate_name": "Adv. Priya Raman",
                  "drawer_name": entry["parties"]["drawer"], "drawer_address": "Plot 22, Hosur - 635109", "payee_bank": "HDFC Bank, T. Nagar",
                  "info_received_date": facts["return_memo_date"], "debt_nature": "That my client supplied goods and the cheque was issued towards their price.",
                  "notice_date": facts["return_memo_date"]})
    doc = a.post("/api/drafts/render", json={"type": "notice_138", "facts": facts}).get_json()
    text_out = blocks_to_text(doc["blocks"])
    assert verifier.verify(text_out, facts, fixed_text("notice_138"))["ok"]
    assert entry["facts"]["cheque_no"] in text_out and not [u for u in doc["unresolved"] if u["required"]]
    docx = a.post("/api/drafts/export", json={"document": doc, "format": "docx"}).data
    assert re.sub(r"\s+", " ", export.docx_text(docx).replace("\t", " ")).strip() == re.sub(r"\s+", " ", text_out).strip()


CONTRACTS = [m for m in MANIFEST if m.get("doc_type") == "contract" and m["expect"] == "ok"]


def _analyse(a, text, timeout=180):
    r = a.post("/api/contract/analyze", json={"text": text})
    assert r.status_code in (200, 202), r.get_json()
    job = r.get_json()["job_id"]
    end = time.time() + timeout
    while time.time() < end:
        st = a.get(f"/api/contract/analysis-status/{job}").get_json()
        if st["status"] in ("complete", "failed"):
            return st
        time.sleep(0.4)
    raise AssertionError("analysis timed out")


@pytest.mark.parametrize("entry", CONTRACTS, ids=[m["file"] for m in CONTRACTS])
def test_forty_page_contracts_are_analysed_with_grounded_findings_and_the_right_dates(world, entry):
    _f, a = world
    text = _upload(a, entry["file"]).get_json()["text"]
    t0 = time.time()
    st = _analyse(a, text)
    assert st["status"] == "complete" and time.time() - t0 < 150
    res = st["results"]
    flat = re.sub(r"\s+", " ", text)
    for c in res["clauses"]:
        assert re.sub(r"\s+", " ", c["original_text"]) in flat                               # quotes are real
    titles = {c["title"] for c in res["clauses"]}
    assert "Termination without notice" in titles and "Excessive interest" in titles and "Invented" not in titles
    dates = " | ".join(d["text"] for d in res["key_dates"])
    for expected in entry["key_dates"]:
        assert expected in dates, (expected, dates[:300])
    assert res["coverage"]["failed_sections"] == 0 and res["coverage"]["dropped_unverified"] >= 1


@pytest.mark.parametrize("name", ["rent_agreement_1.docx", "sale_deed_2.pdf", "nda_1.docx", "plaint_2.pdf", "affidavit_1.docx", "bail_application_2.pdf", "mixed_script_notice.docx", "messy_tables_1.docx"])
def test_every_other_document_type_analyses_without_an_error(world, name):
    _f, a = world
    text = _upload(a, name).get_json()["text"]
    st = _analyse(a, text, timeout=90)
    assert st["status"] == "complete" and isinstance(st["results"]["missing_clauses"], list)


# ── the flagship, many times ─────────────────────────────────────────────────────────────────────
def _random_case(rng):
    first = ["Arun", "Priya", "Ramesh", "Lakshmi", "Venkatesh", "Meena", "Suresh", "Fatima", "Harpreet", "Kavita"]
    last = ["Kumar", "Raman", "Gupta", "Iyer", "Reddy", "Sharma", "Nair", "Khan", "Bose", "Joshi"]
    biz = ["Traders", "Agencies", "Industries", "Infra", "Textiles", "Foods"]
    cd = date(2026, rng.randint(1, 5), rng.randint(1, 27))
    pres = cd + timedelta(days=rng.randint(2, 60))
    memo = pres + timedelta(days=rng.randint(1, 5))
    notice = memo + timedelta(days=rng.randint(1, 20))
    amount = rng.choice([25000, 75000, 125000, 475000, 880000, 2150000, 12500000])
    return {
        "sender_name": f"M/s {rng.choice(last)} {rng.choice(biz)}", "sender_address": f"{rng.randint(1, 99)} {rng.choice(last)} Road, Chennai - 600017",
        "advocate_name": f"Adv. {rng.choice(first)} {rng.choice(last)}", "drawer_name": f"M/s {rng.choice(last)} {rng.choice(biz)} Pvt Ltd",
        "drawer_address": f"Plot {rng.randint(1, 99)}, Industrial Estate, Hosur - 635109", "cheque_no": f"{rng.randint(100000, 999999)}",
        "cheque_date": V.format_date(cd), "cheque_amount": f"{amount}", "drawn_bank": f"{rng.choice(['State Bank of India', 'HDFC Bank', 'Axis Bank'])}, Hosur Main Branch",
        "payee_bank": "HDFC Bank, T. Nagar Branch", "presentation_date": V.format_date(pres), "return_reason": rng.choice(["Funds insufficient", "Payment stopped by drawer", "Account closed"]),
        "return_memo_date": V.format_date(memo), "info_received_date": V.format_date(memo), "debt_nature": f"That my client supplied goods under invoice no. {rng.randint(1000, 9999)}.",
        "notice_date": V.format_date(notice),
    }


def test_the_flagship_s138_notice_100_times_with_the_ai_stubbed_has_zero_hard_failures(world, tmp_path):
    _f, a = world
    rng = random.Random(138)
    failures, t0, warned = [], time.time(), 0
    for i in range(100):
        facts = _random_case(rng)
        try:
            r = a.post("/api/drafts/render", json={"type": "notice_138", "facts": facts})
            assert r.status_code == 200
            doc = r.get_json()
            text = blocks_to_text(doc["blocks"])
            assert not doc["unresolved"], doc["unresolved"]
            res = verifier.verify(text, facts, fixed_text("notice_138"))
            assert res["ok"], res["issues"]
            amt = V.format_inr(V.parse_amount(facts["cheque_amount"]))
            assert amt in text and V.amount_in_words(V.parse_amount(facts["cheque_amount"])) in text and facts["cheque_no"] in text
            warned += bool(doc["warnings"])
            fmt = "docx" if i % 2 == 0 else "pdf"
            ex = a.post("/api/drafts/export", json={"document": doc, "format": fmt})
            assert ex.status_code == 200 and ex.headers["X-Unresolved-Count"] == "0"
            if fmt == "docx":
                assert re.sub(r"\s+", " ", export.docx_text(ex.data).replace("\t", " ")).strip() == re.sub(r"\s+", " ", text).strip()
            else:
                import fitz
                ptext = re.sub(r"\s+", " ", "".join(p.get_text() for p in fitz.open(stream=ex.data, filetype="pdf")))
                assert amt in ptext and facts["cheque_no"] in ptext
        except Exception as exc:  # noqa: BLE001 - collect, then fail once with everything
            failures.append((i, facts.get("cheque_no"), repr(exc)[:200]))
    took = time.time() - t0
    print(f"FLAGSHIP x100: {len(failures)} failures, {warned} drafts carried a statutory-timing warning, {took:.1f}s total")
    assert not failures, failures[:5]


def test_twelve_advocates_working_at_once_do_not_see_each_others_drafts_or_break_each_other(world):
    flask_app, _a = world
    users = [register(flask_app, f"parallel{i}@example.com") for i in range(12)]
    results, errors = {}, []

    def work(i, u):
        try:
            facts = {**_random_case(random.Random(i)), "sender_name": f"M/s Advocate-{i} Clients"}
            s = u.post("/api/drafts/sessions", json={"type": "notice_138", "facts": facts}).get_json()
            for _ in range(5):
                u.put(f"/api/drafts/sessions/{s['id']}", json={"facts": facts, "step": "details"})
            doc = u.post("/api/drafts/render", json={"type": "notice_138", "facts": facts}).get_json()
            ex = u.post("/api/drafts/export", json={"document": doc, "format": "docx"})
            results[i] = (s["id"], ex.status_code, f"M/s Advocate-{i} Clients" in blocks_to_text(doc["blocks"]))
        except Exception as exc:  # noqa: BLE001
            errors.append((i, repr(exc)[:200]))

    threads = [threading.Thread(target=work, args=(i, u)) for i, u in enumerate(users)]
    [t.start() for t in threads]
    [t.join(120) for t in threads]
    assert not errors, errors
    assert len(results) == 12 and all(v[1] == 200 and v[2] for v in results.values())
    for i, u in enumerate(users):
        mine = u.get("/api/drafts/sessions").get_json()["sessions"]
        assert len(mine) == 1 and mine[0]["id"] == results[i][0]


def test_a_50_mb_file_and_other_oversized_input_are_refused_politely(world, tmp_path):
    _f, a = world
    big = b"x" * (50 * 1024 * 1024)
    r = a.post("/api/contract/extract-text", data={"file": (io.BytesIO(big), "huge.txt", "text/plain")}, content_type="multipart/form-data")
    assert r.status_code == 413 and r.get_json()["code"] == "TOO_LARGE" and "MB" in r.get_json()["message"]
    r = a.post("/api/drafts/extract", json={"type": "notice_138", "text": "word " * 100000 + "x" * 1})
    assert r.status_code in (200, 413)


@pytest.mark.skipif(not (os.environ.get("RUN_REAL_LLM") == "1" and os.environ.get("REAL_GROQ_API_KEY")), reason="set RUN_REAL_LLM=1 and REAL_GROQ_API_KEY to run against the real model")
def test_real_model_extraction_20_times_never_invents(world, monkeypatch):
    """Not run in CI. 20 real extractions from the cheque memos; every value must be quotable from the source."""
    _f, a = world
    monkeypatch.setenv("GROQ_API_KEY", os.environ["REAL_GROQ_API_KEY"])
    bad = []
    for n in range(20):
        entry = MEMOS[n % len(MEMOS)]
        text = _upload(a, entry["file"]).get_json()["text"]
        fields = a.post("/api/drafts/extract", json={"type": "notice_138", "text": text, "use_model": True}).get_json()["fields"]
        for k, rec in fields.items():
            if rec["value"].lower() not in re.sub(r"\s+", " ", text).lower():
                bad.append((entry["file"], k, rec["value"]))
    assert not bad, bad


def test_word_tables_are_read_in_order_because_fee_schedules_live_in_tables(world):
    _f, a = world
    text = _upload(a, "messy_tables_1.docx").get_json()["text"]
    assert "5 November 2026 | Rs. 1,25,000" in text and "Kumar Infra LLP | Buyer" in text
    assert text.index("SCHEDULE OF PAYMENTS") < text.index("Instalment") < text.index("Sundaram Agencies Pvt Ltd | Seller")


def test_text_files_in_the_encodings_indian_offices_use_are_decoded_not_garbled():
    from utils.upload_guard import decode_text
    assert decode_text("Notice — ₹4,75,000 अरुण".encode("utf-8")) == "Notice — ₹4,75,000 अरुण"
    assert decode_text(b"\xef\xbb\xbfhello") == "hello"
    assert decode_text("hello — world".encode("utf-16")) == "hello — world"
    assert decode_text("Smt. Lakshmi \x97 notice".encode("latin-1")).startswith("Smt. Lakshmi")        # Windows-1252 dash, not UTF-16 mojibake
    assert "�" not in decode_text("Café notice".encode("cp1252"))


def test_every_text_answer_has_the_same_shape_whatever_the_file_type(world):
    _f, a = world
    for name in ("s138_return_memo_4.txt", "s138_return_memo_1.pdf", "s138_notice_1.docx"):
        body = _upload(a, name).get_json()
        assert {"text", "raw_text", "page_count", "word_count", "clauses"} <= set(body), (name, sorted(body))
