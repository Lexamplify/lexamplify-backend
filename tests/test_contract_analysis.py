"""Contract analysis: grounded quotes, honest failure, deterministic missing clauses, private jobs, no fake authorities."""
import io
import os
import time

import pytest

from tests.helpers_app import make_app, register
from utils.contract_checks import find_missing_clauses, key_dates, locate_quote

CONTRACT = """SERVICE AGREEMENT

This Agreement is made on 1 August 2026 between Sundaram Agencies Pvt Ltd and Kumar Infra LLP.

1. Services. The Contractor shall provide the services described in Schedule A.

2. Payment. The Client shall pay ₹4,75,000 within 30 days of each invoice. Delay attracts interest at 24% per month.

3. Termination. The Client may terminate this Agreement at any time without notice and without paying for work done.

4. Governing law. This Agreement is governed by the laws of India. The courts at Chennai have exclusive jurisdiction.

5. Term. This Agreement runs for 3 years from 1 August 2026 and renews automatically for a further 12 months unless notice is given 90 days before expiry.
"""

TERMINATION = "The Client may terminate this Agreement at any time without notice and without paying for work done."
INTEREST = "Delay attracts interest at 24% per month."


# ── grounding ────────────────────────────────────────────────────────────────────────────────
def test_quotes_found_in_the_document_are_returned_exactly_as_the_document_has_them():
    exact, how = locate_quote(TERMINATION, CONTRACT)
    assert how == "exact" and exact == TERMINATION
    squeezed, how = locate_quote("The  Client may terminate this Agreement at any time\nwithout notice and without paying for work done.", CONTRACT)
    assert how == "exact" and squeezed.startswith("The Client may terminate")


def test_a_lightly_reworded_quote_is_snapped_to_the_real_text():
    exact, how = locate_quote("The Client may terminate this agreement at any time without notice and without any payment for work done.", CONTRACT)
    assert how == "close" and "terminate this Agreement at any time without notice" in exact


@pytest.mark.parametrize("quote", [
    "The Contractor shall indemnify the Client for all losses without limit.",
    "This Agreement shall be arbitrated in Singapore under SIAC rules.",
    "short",
    "",
])
def test_invented_quotes_are_not_found(quote):
    assert locate_quote(quote, CONTRACT)[0] is None


def test_missing_clauses_are_found_by_reading_the_text_not_by_asking_a_model():
    ids = {m["id"] for m in find_missing_clauses(CONTRACT)}
    assert "miss-confidentiality" in ids and "miss-indemnity" in ids and "miss-force_majeure" in ids
    assert "miss-governing_law" not in ids and "miss-termination" not in ids and "miss-payment" not in ids
    assert all(m["model"].startswith('"') and m["basis"] for m in find_missing_clauses(CONTRACT))
    assert find_missing_clauses("Confidential. Indemnify. Force majeure. Governing law. Jurisdiction. Terminate. Payment. Liability limitation of liability. "
                                "Notices in writing to the address. Assign. Entire agreement. Severability. Dispute arbitration. Stamp duty.") == []


def test_key_dates_and_periods_come_with_their_sentence():
    items = key_dates(CONTRACT)
    texts = [i["text"] for i in items]
    assert "1 August 2026" in texts and any("30 days" in t for t in texts) and any("90 days" in t for t in texts) and any("3 years" in t for t in texts)
    ninety = next(i for i in items if "90 days" in i["text"])
    assert "unless notice is given" in ninety["context"]


# ── the full job, with the AI mocked ────────────────────────────────────────────────────────────
@pytest.fixture()
def world(tmp_path, monkeypatch):
    flask_app = make_app(tmp_path, monkeypatch)
    return flask_app, register(flask_app, "a@example.com"), register(flask_app, "b@example.com"), monkeypatch


def _ai(monkeypatch, per_chunk):
    """per_chunk(chunk_text) -> dict, or raises. Also disables the other AI calls (summary merge)."""
    import routes.contract_routes as cr
    monkeypatch.setattr(cr, "analyze_contract_with_llm", lambda chunk, strategy="Defensive": per_chunk(chunk))
    import utils.ai_helper as ah
    monkeypatch.setattr(ah, "ask_groq", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("no AI in this test")))


def _run(client, text=None, files=None, timeout=60):
    r = client.post("/api/contract/analyze", **({"json": {"text": text}} if files is None else {"data": files, "content_type": "multipart/form-data"}))
    assert r.status_code in (200, 202), r.get_json()
    job = r.get_json()["job_id"]
    end = time.time() + timeout
    while time.time() < end:
        st = client.get(f"/api/contract/analysis-status/{job}").get_json()
        if st["status"] in ("complete", "failed"):
            return job, st
        time.sleep(0.3)
    raise AssertionError("analysis did not finish")


GOOD = {"summary": "A three-year service agreement between Sundaram Agencies Pvt Ltd and Kumar Infra LLP.",
        "clauses": [
            {"title": "Termination without notice", "original_text": TERMINATION, "risk_level": "High",
             "explanation": "Either side loses its protection: the Client can walk away without paying. See Section 27 of the Indian Contract Act, 1872.",
             "location": "Clause 3", "playbook_rule": "Indian Contract Act, 1872", "suggested_revision": "Either party may terminate on 30 days' written notice."},
            {"title": "Excessive interest", "original_text": INTEREST, "risk_level": "Medium", "explanation": "24% a month is likely to be penal.",
             "location": "Clause 2", "playbook_rule": "Indian Contract Act, 1872", "suggested_revision": "Interest at 12% per annum."},
            {"title": "Invented indemnity", "original_text": "The Contractor shall indemnify the Client for every loss without any limit whatsoever.",
             "risk_level": "High", "explanation": "Unlimited indemnity (this text is not in the contract).", "location": "Clause 9", "playbook_rule": "x", "suggested_revision": "y"},
            {"title": "Made-up law", "original_text": TERMINATION, "risk_level": "Low",
             "explanation": "Breaches Section 999 of the Bharatiya Nyaya Sanhita, 2023 and the Imaginary Contracts Act, 2031.", "location": "Clause 3",
             "playbook_rule": "Imaginary Contracts Act, 2031", "suggested_revision": "z"},
        ]}


def test_findings_are_grounded_and_invented_ones_are_dropped_and_counted(world):
    _f, a, _b, mp = world
    _ai(mp, lambda chunk: GOOD)
    _job, st = _run(a, CONTRACT)
    assert st["status"] == "complete"
    res = st["results"]
    titles = [c["title"] for c in res["clauses"]]
    assert "Termination without notice" in titles and "Excessive interest" in titles and "Invented indemnity" not in titles
    for c in res["clauses"]:
        assert c["original_text"] in CONTRACT                                  # every quote is a real slice of the document
    assert res["coverage"]["dropped_unverified"] >= 1 and any("removed" in w for w in res["coverage"]["warnings"])


def test_unknown_statutes_are_flagged_on_the_finding(world):
    _f, a, _b, mp = world
    _ai(mp, lambda chunk: {"summary": "s", "clauses": [GOOD["clauses"][3]]})
    _job, st = _run(a, CONTRACT)
    c = st["results"]["clauses"][0]
    joined = " ".join(c["citationWarnings"])
    assert "Imaginary Contracts Act" in joined and "Section 999" in joined


def test_missing_clauses_and_key_dates_are_real_and_there_are_no_fake_authorities(world):
    _f, a, _b, mp = world
    _ai(mp, lambda chunk: GOOD)
    _job, st = _run(a, CONTRACT)
    res = st["results"]
    assert {m["id"] for m in res["missing_clauses"]} >= {"miss-confidentiality", "miss-indemnity"}
    assert "miss-governing_law" not in {m["id"] for m in res["missing_clauses"]}
    assert res["citations"] == []                                                # no canned "matching precedents" without a real source
    assert any("90 days" in d["text"] for d in res["key_dates"])


def test_if_the_ai_is_down_the_job_fails_loudly_it_never_says_no_risks_found(world):
    _f, a, _b, mp = world

    def boom(chunk):
        raise RuntimeError("provider down: api key invalid")
    _ai(mp, boom)
    _job, st = _run(a, CONTRACT)
    assert st["status"] == "failed" and st.get("results") in (None, {})
    assert "nothing was checked" in st["error"] and "api key" not in st["error"].lower()


def test_if_some_sections_fail_the_result_says_so(world):
    _f, a, _b, mp = world
    calls = {"n": 0}

    def flaky(chunk):
        calls["n"] += 1
        if calls["n"] % 2 == 0:
            raise RuntimeError("rate limit")
        return {"summary": "A long agreement.", "clauses": []}
    _ai(mp, flaky)
    long_text = "\n\n".join(f"{i}. Clause number {i}. " + ("The parties agree to perform their duties carefully. " * 40) for i in range(1, 30))
    _job, st = _run(a, long_text)
    cov = st["results"]["coverage"]
    assert st["status"] == "complete" and cov["failed_sections"] >= 1 and any("could not read" in w for w in cov["warnings"])


def test_a_big_contract_completes(world):
    _f, a, _b, mp = world
    _ai(mp, lambda chunk: {"summary": "Part of a long agreement.", "clauses": []})
    big = "\n\n".join(f"{i}. Clause {i}. " + ("Each party shall comply with applicable law and keep proper records. " * 30) for i in range(1, 140))
    assert len(big) > 250000
    t0 = time.time()
    _job, st = _run(a, big, timeout=120)
    assert st["status"] == "complete" and time.time() - t0 < 90
    assert st["results"]["word_count"] > 30000


def test_another_advocate_cannot_read_my_analysis_and_anonymous_cannot_start_one(world):
    flask_app, a, b, mp = world
    _ai(mp, lambda chunk: GOOD)
    job, st = _run(a, CONTRACT)
    assert b.get(f"/api/contract/analysis-status/{job}").status_code == 404
    assert b.get(f"/api/contract/stream/{job}").status_code == 404
    assert flask_app.test_client().post("/api/contract/analyze", json={"text": CONTRACT}).status_code == 401


def test_uploads_are_checked_and_never_written_to_the_public_static_folder(world, tmp_path):
    _f, a, _b, mp = world
    _ai(mp, lambda chunk: GOOD)
    from docx import Document
    d = Document()
    d.add_paragraph(CONTRACT)
    buf = io.BytesIO()
    d.save(buf)
    _job, st = _run(a, files={"file": (io.BytesIO(buf.getvalue()), "contract.docx")})
    assert st["status"] == "complete"
    uploads = os.path.join(os.getcwd(), "static", "uploads")
    assert not os.path.isdir(uploads) or not os.listdir(uploads)
    bad = a.post("/api/contract/analyze", data={"file": (io.BytesIO(b"not a pdf"), "fake.pdf")}, content_type="multipart/form-data")
    assert bad.status_code == 422 and bad.get_json()["code"] == "NOT_A_PDF"
    blank = a.post("/api/contract/analyze", json={"text": "   "})
    assert blank.status_code in (400, 422)
    for body in ([1], "x", None):
        assert a.post("/api/contract/analyze", json=body).status_code == 400


def test_oversized_text_is_refused_politely(world):
    _f, a, _b, _mp = world
    r = a.post("/api/contract/analyze", json={"text": "word " * 130000})
    assert r.status_code == 413 and r.get_json()["code"] == "TOO_LARGE"
