"""The free-writing studio route (/api/documents/draft) now checks the model's draft against what the advocate supplied."""
import pytest

from tests.helpers_app import make_app, register

INSTRUCTIONS = ("Draft a legal notice for M/s Sundaram Agencies against M/s Kumar Traders Pvt Ltd for cheque no. 004817 dated 12 June 2026 "
                "for Rs. 4,75,000 returned unpaid.")


@pytest.fixture()
def world(tmp_path, monkeypatch):
    flask_app = make_app(tmp_path, monkeypatch)
    return flask_app, register(flask_app, "a@example.com"), monkeypatch


def _draft(a, mp, model_text, instructions=INSTRUCTIONS, **extra):
    import routes.document_routes as dr
    mp.setattr(dr, "ask_groq", lambda *args, **kw: model_text)
    r = a.post("/api/documents/draft", json={"instructions": instructions, **extra})
    assert r.status_code == 200, r.get_json()
    return r.get_json()


def test_a_faithful_draft_has_nothing_flagged(world):
    _f, a, mp = world
    out = _draft(a, mp, "Cheque no. 004817 dated 12 June 2026 for Rs. 4,75,000 was issued by M/s Kumar Traders Pvt Ltd to M/s Sundaram Agencies under Section 138 of the Negotiable Instruments Act, 1881.")
    assert out["unverified"] == [] and out["unverified_count"] == 0 and "004817" in out["draft"]


def test_invented_facts_in_the_draft_are_reported_but_the_draft_is_still_returned_untouched(world):
    _f, a, mp = world
    text = ("Mr. Ramesh Gupta stood surety for Rs. 9,99,999 on 15 March 2019 under CC No. 4567/2022. "
            "The accused is liable under Section 420 of the Bharatiya Nyaya Sanhita, 2023 and the Imaginary Contracts Act, 2031.")
    out = _draft(a, mp, text)
    kinds = {(i["kind"], i["text"]) for i in out["unverified"]}
    assert ("amount", "Rs. 9,99,999") in kinds and ("date", "15 March 2019") in kinds and ("case number", "CC No. 4567/2022") in kinds
    assert any(k == "name" and "Ramesh Gupta" in t for k, t in kinds)
    assert any(k == "citation" and "Section 420" in t for k, t in kinds) and any(k == "citation" and "Imaginary Contracts Act" in t for k, t in kinds)
    assert out["draft"] == text                                   # reported, never silently rewritten


def test_facts_supplied_in_the_reference_text_are_not_flagged(world):
    _f, a, mp = world
    out = _draft(a, mp, "The loan of Rs. 2,50,000 was advanced on 3 January 2025 to Mr. Arun Kumar.", context="Loan note: Rs. 2,50,000 advanced on 3 January 2025 to Mr. Arun Kumar.")
    assert out["unverified"] == []


def test_a_failure_in_the_check_never_blocks_the_draft(world, monkeypatch):
    _f, a, mp = world
    from utils.draft_engine import verifier
    mp.setattr(verifier, "verify", lambda *args, **kw: (_ for _ in ()).throw(RuntimeError("broken checker")))
    out = _draft(a, mp, "A draft.")
    assert out["draft"] == "A draft." and out["unverified"] == []
