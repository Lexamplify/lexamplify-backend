"""utils/claim_check.py: flag case names, sections, amounts, years and dates that are not in the retrieved source text.

Pure functions: no app, no network.
"""
import pytest

from utils.claim_check import check_claims, find_amounts, find_dates, find_sections

SOURCE = (
    "In Sundaram Finance Ltd. v. State of Tamil Nadu the Court held that a notice under Section 138(1)(b) of the Negotiable "
    "Instruments Act must be given within 30 days. Sections 141 and 143 also apply. The accused was sentenced to two years and "
    "fined Rs. 50,00,000/-. The cheque dated 1st day of April 2021 was returned on 04/05/2021. The complainant claimed "
    "fifty lakh rupees and Rs 5 crore as damages in the connected suit. Limitation is three years."
)


def kinds(answer, source=SOURCE):
    return [(f["kind"], f["text"]) for f in check_claims(answer, source)]


# ── the example that must be flagged ──────────────────────────────────────────────────────────────────────────────────
def test_million_and_lakh_that_disagree_are_flagged():
    flags = check_claims("The fine is Rs 50 million (Rs 50 lakhs).", SOURCE)
    first = flags[0]
    assert first["kind"] == "amount" and "do not match" in first["reason"]
    assert "1 million = 10 lakh" in first["reason"]
    assert set(first) == {"text", "kind", "reason"}
    assert "Rs 50 million" in first["text"]


def test_a_matching_pair_in_different_units_is_not_flagged():
    for answer in ("The fine is Rs 50 lakh (Rs 5 million).", "The damages are Rs 5 crore (Rs 50 million).",
                   "The fine is Rs 50,00,000 (fifty lakh rupees)."):
        assert not [f for f in check_claims(answer, SOURCE) if "do not match" in f["reason"]], answer


# ── amounts ───────────────────────────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("answer", [
    "Fined Rs 50,00,000.", "Fined Rs. 50 lakh.", "Fined ₹50 lakhs.", "Fined INR 5000000.", "Fined fifty lakh rupees.",
    "Fined Rs 5 million.", "Damages of Rs 5 crore.", "Damages of 5 crore rupees.", "Fined Rs.50,00,000/-",
])
def test_the_same_sum_written_differently_is_found(answer):
    assert kinds(answer) == [], answer


def test_an_amount_not_in_the_source_is_flagged():
    assert kinds("Fined Rs 75 lakh.") == [("amount", "Rs 75 lakh")]
    assert kinds("Damages of Rs 50 crore.")[0][0] == "amount"          # 500,000,000 is not 50,00,000


def test_find_amounts_reads_indian_numbering_and_words():
    values = {v for _, v, _, _ in find_amounts("Rs 50,00,000 and fifty lakh rupees and Rs 5 million and Rs 5 crore and Rs 2.5 lakh")}
    assert values == {5_000_000, 50_000_000, 250_000}


# ── years ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("answer", ["Limitation is 3 years.", "A three-year period applies.", "The sentence is two years.", "It is 36 months, that is 3 years."])
def test_periods_found_in_the_source_are_not_flagged(answer):
    flagged = [k for k in kinds(answer) if k[0] == "years"]
    assert flagged == [], answer


def test_a_period_not_in_the_source_is_flagged():
    assert ("years", "five years") in kinds("The period is five years.")
    assert ("years", "7 years") in kinds("Limitation is 7 years.")


# ── dates ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("answer", [
    "The cheque is dated 1 April 2021.", "The cheque is dated 1st April 2021.", "The cheque is dated April 1, 2021.",
    "The cheque is dated 01/04/2021.", "The cheque is dated 2021-04-01.", "The cheque is dated 1st day of April 2021.",
    "It was returned on 4 May 2021.", "It was returned on 04-05-2021.",
])
def test_date_variants_that_match_the_source_are_not_flagged(answer):
    assert kinds(answer) == [], answer


def test_numeric_dates_are_day_first():
    assert find_dates("04/05/2021")[0][1] == "2021-05-04"
    assert kinds("It was returned on 5 April 2021.") == [("date", "5 April 2021")]      # month and day swapped: not the source's date


def test_an_invalid_date_is_ignored_not_flagged_as_a_date():
    assert find_dates("31/02/2021") == []


# ── sections ──────────────────────────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("answer", [
    "Under Section 138(1)(b) the notice is needed.", "Under Sec. 138(1)(b) the notice is needed.", "Under S. 138(1)(b) the notice is needed.",
    "Under section 138 ( 1 ) ( b ) the notice is needed.", "Sections 141 and 143 apply.",
])
def test_section_variants_that_match_are_not_flagged(answer):
    assert kinds(answer) == [], answer


def test_a_section_or_sub_part_not_in_the_source_is_flagged():
    assert kinds("See Section 139.") == [("section", "Section 139")]
    flagged = check_claims("See Section 138(2)(c).", SOURCE)
    assert flagged[0]["kind"] == "section" and flagged[0]["text"] == "Section 138(2)(c)"
    assert [f["kind"] for f in check_claims("Section 141 and Section 147 apply.", SOURCE)] == ["section"]    # only 147 is missing


def test_find_sections_splits_lists():
    assert [n for _, n in find_sections("Sections 138, 141 and 143(2)")] == ["138", "141", "143(2)"]


# ── case names ────────────────────────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("answer", [
    "In Sundaram Finance Ltd. v. State of Tamil Nadu the Court held so.", "Sundaram Finance Ltd versus State of Tamil Nadu is the leading case.",
    "See Sundaram Finance Ltd. vs. State of Tamil Nadu.",
])
def test_a_case_name_in_the_source_is_not_flagged_whatever_the_v(answer):
    assert [k for k in kinds(answer) if k[0] == "case"] == []


def test_an_invented_case_is_flagged():
    flagged = [k for k in kinds("As held in Mehta Traders v. Union of India, the notice is valid.") if k[0] == "case"]
    assert flagged == [("case", "Mehta Traders v. Union of India")]


# ── citation tags and housekeeping ────────────────────────────────────────────────────────────────────────────────────
def test_citation_tags_are_ignored_and_duplicates_collapse():
    flags = check_claims("Fined Rs 75 lakh [S1]. Again Rs 75 lakh [S2].", SOURCE)
    assert len(flags) == 1


def test_no_source_text_flags_everything_checkable():
    kinds_found = {f["kind"] for f in check_claims("Section 138, five years, Rs 5 lakh, 1 April 2021, Mehta v. Rao.", "")}
    assert kinds_found == {"section", "years", "amount", "date", "case"}


def test_plain_prose_with_nothing_checkable_has_no_flags():
    assert check_claims("The notice must be given in time and the drawer may pay.", SOURCE) == []
    assert check_claims("", SOURCE) == []


# ── old criminal-code currency note (Run 2 A6 & Run 3 TASK 3) ────────────────────────────────────────────────────────
from utils.claim_check import OLD_LAW_CURRENCY_NOTE, currency_flags  # noqa: E402


@pytest.mark.parametrize("text", [
    "Bail under Section 438 of the CrPC is discretionary.",
    "Punishment under Section 420 IPC applies here.",
    "Under the Indian Penal Code and Code of Criminal Procedure, cognizable offences require an FIR.",
    "Admissibility is governed by the Indian Evidence Act.",
    "See Section 438 Cr.P.C. and Section 420 I.P.C.",
    "Grant of bail under the Cr.P.C.",
    "Bail under the Cr. P.C. is discretionary.",
    "Bail under the Cr.P.C is discretionary.",
    "Punishment under the I.P.C.",
    "Punishment under the I.P.C applies.",
    "Under the Criminal Procedure Code, bail may be granted.",
    "Admissibility under the Evidence Act, 1872.",
])
def test_currency_flags_triggers_when_old_criminal_code_named_alone(text):
    flags = currency_flags(text)
    assert flags == [{"code": "criminal_codes_2024", "note": OLD_LAW_CURRENCY_NOTE}]
    assert flags[0]["note"] == (
        "IPC, CrPC and the Evidence Act were replaced by BNS, BNSS and BSA from 1 July 2024. "
        "Check which law applies to your case dates."
    )


@pytest.mark.parametrize("text", [
    "Section 438 CrPC has been replaced by Section 482 of the BNSS.",
    "Cheating under IPC is now covered by the Bharatiya Nyaya Sanhita (BNS).",
    "The Indian Evidence Act was replaced by the Bharatiya Sakshya Adhiniyam (BSA).",
    "Under the Bharatiya Nagarik Suraksha Sanhita and CrPC, anticipatory bail may be sought.",
    "Bail under the Cr. P.C. and BNSS.",
    "Evidence Act, 1872 and Bharatiya Sakshya Adhiniyam.",
])
def test_currency_flags_is_empty_when_new_criminal_code_is_also_named(text):
    assert currency_flags(text) == []


@pytest.mark.parametrize("text", [
    "",
    "Notice under Section 138 of the Negotiable Instruments Act must be given within 30 days.",
    "Assessment under the Income-tax Act 1961 or Income-tax Act 2025.",
    "A typical shipcaptain or chronicle word has no old statute.",
    "The word slipcover or microchip or crpctest has no old statute.",
])
def test_currency_flags_is_empty_for_other_laws_and_has_no_income_tax_note(text):
    assert currency_flags(text) == []
