"""The golden set for the drafting evaluation must stay true to itself.

`scripts/eval_matters.py` is the data the evaluation runs on. If a fact in it is not really in the matter's
source text, the evaluation would measure the wrong thing and call it a failure (or, worse, call a real
failure a pass). These tests keep the data honest:

  - every "truth" fact is really in the source, word for word;
  - a slot that is listed as missing is not in the facts;
  - the traps are really seeded (the values the file tells the model to invent are really in the file);
  - the set is big enough and covers every document type and every kind of trap.
"""
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

from eval_matters import MATTERS  # noqa: E402

REQUIRED_TYPES = {"notice_138", "rent_agreement", "sale_deed", "affidavit", "nda", "reply_notice"}
REQUIRED_TRAPS = {"clean", "missing_party", "conflicting_amount", "wrong_date_format", "injection"}


def norm(s):
    return re.sub(r"\s+", " ", str(s or "")).strip().lower()


def test_there_are_at_least_twenty_matters():
    assert len(MATTERS) >= 20, f"only {len(MATTERS)} matters in the golden set"


def test_every_type_and_every_kind_of_trap_is_covered():
    assert {m["type"] for m in MATTERS} == REQUIRED_TYPES
    assert REQUIRED_TRAPS <= {m["trap"] for m in MATTERS}


def test_the_matter_ids_are_unique():
    ids = [m["id"] for m in MATTERS]
    assert len(ids) == len(set(ids)), "two matters share an id"


def test_every_truth_fact_is_really_in_the_source():
    for m in MATTERS:
        for slot, value in (m.get("facts") or {}).items():
            assert isinstance(value, str) and value.strip(), f"{m['id']}: {slot} is empty"
            assert norm(value) in norm(m["source"]), (
                f"{m['id']}: the fact '{slot}' is not in the source word for word:\n  {value!r}"
            )


def test_a_slot_that_must_stay_blank_is_not_among_the_facts():
    for m in MATTERS:
        for slot in m.get("blank") or []:
            assert slot not in (m.get("facts") or {}), f"{m['id']}: {slot} is both a fact and a blank"
            assert slot not in (m.get("trap_values") or {}), f"{m['id']}: {slot} is both a blank and a trap"


def test_the_traps_are_really_seeded_in_the_source():
    for m in MATTERS:
        for value in (m.get("trap_values") or {}):
            assert norm(value) in norm(m["source"]), (
                f"{m['id']}: the trap value {value!r} is not in the source, so nothing is being tested"
            )


def test_every_matter_has_a_source_a_type_and_a_studio_instruction():
    for m in MATTERS:
        assert len(m.get("source") or "") > 200, f"{m['id']}: the source is too short to be realistic"
        assert m.get("type") and m.get("studio") and m.get("title")


def test_the_blank_list_is_exactly_what_the_document_leaves_blank():
    """The evaluation compares the blanks the pipeline leaves with the list in the matter. If the two drift
    apart, a real failure would be scored as a pass (or the other way round)."""
    from utils.draft_engine.render import render
    for m in MATTERS:
        doc = render(m["type"], m.get("facts") or {})
        left_blank = [u["slot"] for u in doc["unresolved"]]
        assert left_blank == (m.get("blank") or []), (
            f"{m['id']}: the document leaves {left_blank} blank, the matter says {m.get('blank')}"
        )
