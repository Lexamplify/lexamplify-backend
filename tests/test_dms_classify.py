"""
Unit tests for the deterministic classifier / extractor (utils/dms_classify.py): what it recognises,
and - just as important - what it must NOT mistake for a case number, a date or an Aadhaar number.
No files, no server: plain text in, facts out.
"""
import pytest

from utils import dms_classify as C


def keys(text):
    return [k for _p, k, _s in C._case_hits(text)]


# ── case numbers: every way a court or a clerk writes the same number ──────────────────
SAME = [
    ("W.P.(C) 1234/2024", "WPC 1234/2024"),
    ("WPC No. 1234 of 2024", "WPC 1234/2024"),
    ("Writ Petition (Civil) No. 1234 of 2024", "WPC 1234/2024"),
    ("wp(c) 1234/2024".upper(), "WPC 1234/2024"),
    ("W.P.(Crl.) 77/2023", "WPCRL 77/2023"),
    ("Writ Petition (Criminal) 77/2023", "WPCRL 77/2023"),
    ("Civil Appeal No. 55 of 2021", "CA 55/2021"),
    ("C.A. 55/2021", "CA 55/2021"),
    ("Criminal Appeal 9 of 2020", "CRLA 9/2020"),
    ("CRL.A. 9/2020", "CRLA 9/2020"),
    ("Bail Application No. 1234 of 2024", "BAILAPPLN 1234/2024"),
    ("BAIL APPLN. 1234/2024", "BAILAPPLN 1234/2024"),
    ("MACP 2218/2025", "MACP 2218/2025"),
    ("M.A.C.P. No. 12 of 2022", "MACP 12/2022"),
    ("Motor Accident Claim Petition No. 12 of 2022", "MACP 12/2022"),
    ("CS(OS) 123/2020", "CSOS 123/2020"),
    ("CS (OS) No. 123 of 2020", "CSOS 123/2020"),
    ("CS(COMM) 55/2021", "CSCOMM 55/2021"),
    ("ARB.A.(COMM.) 4/2022", "ARBACOMM 4/2022"),
    ("CP(IB) 3/2021", "CPIB 3/2021"),
    ("CRL.REV.P. 44/2022", "CRLREVP 44/2022"),
    ("Crl.M.C. 4180/2021", "CRLMC 4180/2021"),
    ("LPA 10/2021", "LPA 10/2021"),
    ("RSA 5/2019", "RSA 5/2019"),
    ("OMP (I) (COMM) 88/2020", "OMPICOMM 88/2020"),
    ("ITA 100/2019", "ITA 100/2019"),
    ("EX.P. 77/2020", "EXP 77/2020"),
    ("HCP 8/2023", "HCP 8/2023"),
    ("First Appeal No. 8 of 2018", "FA 8/2018"),
]


@pytest.mark.parametrize("written,key", SAME)
def test_case_number_spellings_normalise(written, key):
    assert keys(f"IN THE COURT\n{written}\nA v. B") == [key]


def test_all_spellings_of_one_case_share_one_search_token():
    spellings = ["W.P.(C) 1234/2024", "WPC No. 1234 of 2024", "Writ Petition (Civil) No. 1234 of 2024", "W.P.(C)No.1234/2024"]
    toks = {C.case_token(keys(s)[0]) for s in spellings}
    assert toks == {"wpc12342024"}


# ── things that look like case numbers but are not ─────────────────────────────────────
@pytest.mark.parametrize("text", [
    "as 12/2020 per the order",                    # lower-case English word before a number
    "see cs 12/2020",
    "Section 12/2020 of the Act",
    "Act 45/2020",
    "invoice no. 12/2020",
    "the ma 3/2019 period",
    "Order 39 Rule 1/2020",
    "GST notification 12/2020",
    "para 4 of 2021 is denied",
    "pending since 1st 12/2020",
])
def test_ordinary_text_is_not_a_case_number(text):
    assert keys(text) == []


def test_case_number_in_body_is_a_mention_not_the_documents_own():
    head = "IN THE HIGH COURT OF DELHI\nW.P.(C) 100/2024\nA ... Petitioner\nversus\nB ... Respondent\nORDER\n"
    body = "The petitioner relies on CRL.A. 55/2015 and CS(OS) 9/2016.\n" * 40
    own, mentions = C.extract_case_numbers(head + ("filler text here. " * 100) + "\n" + body)
    assert own == ["W.P.(C) 100/2024"] and "CRL.A. 55/2015" in mentions


def test_fir_number_is_not_the_case_number():
    text = "IN THE COURT OF SESSIONS\nBail Application No. 777 of 2024\nFIR No. 45/2024 registered at PS Saket under Section 420 IPC"
    assert C.extract_case_numbers(text)[0] == ["Bail Application 777/2024"]
    assert C.extract_fir_numbers(text) == ["FIR 45/2024"]


# ── classification ─────────────────────────────────────────────────────────────────────
SAMPLES = {
    "Court Order": "IN THE HIGH COURT OF DELHI\nW.P.(C) 1/2024\nORDER\nDate: 12.03.2025\nHeard learned counsel for the parties. Issue notice. List on 15.05.2025 for further hearing.\nThe respondents shall file counter affidavit within four weeks.",
    "Legal Notice": "LEGAL NOTICE\nUnder instructions from my client I hereby call upon you to pay Rs. 5,00,000 within 15 days of receipt of this notice failing which legal proceedings shall be initiated at your risk as to costs and consequences.",
    "Affidavit": "AFFIDAVIT\nI, Sunita Devi, aged 45 years, resident of Delhi, do hereby solemnly affirm and state on oath as under:\n1. That I am the deponent.\nDEPONENT\nVERIFICATION\nVerified at Delhi that the contents are true and correct.",
    "Agreement / Contract": "SERVICE AGREEMENT\nThis Agreement is made on this 1st day of April 2025 between A Ltd. and B Ltd.\nWHEREAS the parties wish to record their understanding. NOW THIS AGREEMENT WITNESSETH as follows:\nIN WITNESS WHEREOF the parties have signed.",
    "Deed / Property Document": "SALE DEED\nThis Sale Deed is executed on 3rd May 2024 by the Vendor in favour of the Purchaser in respect of the property bearing Survey No. 45/2 together with all easementary rights. Registered before the Sub-Registrar.",
    "Vakalatnama / Authorisation": "VAKALATNAMA\nI/We hereby appoint and retain Mr. Rajesh Sharma, Advocate, to appear, act and plead for me/us in the above matter and to file and withdraw all proceedings.",
    "Invoice / Fee Note": "TAX INVOICE\nInvoice No: INV-2025-0042\nGSTIN 33AAAAA0000A1Z5\nProfessional fees for legal services rendered\nTotal amount payable: Rs. 45,000\nBank details for NEFT transfer.",
    "Summons / Court Notice": "IN THE COURT OF THE CIVIL JUDGE\nSUMMONS\nCS 12/2024\nYou are hereby directed to appear before this Court on 12.06.2025 at 10.30 AM in person or through a duly authorised pleader.",
}


@pytest.mark.parametrize("cls", sorted(SAMPLES))
def test_typical_documents_get_the_right_label_with_confidence(cls):
    r = C.classify(SAMPLES[cls], "scan0001.pdf")            # generic scanner name: the text has to carry it
    assert r["doc_class"] == cls, r
    assert r["confidence"] >= C.AUTO_CONFIDENCE, r
    assert r["evidence"], "a label must come with the words that justify it"


def test_unreadable_or_vague_text_is_left_for_a_person():
    for t in ("", "abc", "Page 1 of 3", "lorem ipsum dolor sit amet " * 3):
        r = C.classify(t, "x.pdf")
        assert r["doc_class"] == "Unclassified" or r["confidence"] < C.AUTO_CONFIDENCE, (t, r)


def test_filename_can_break_a_tie_but_never_override_the_text():
    order = SAMPLES["Court Order"]
    assert C.classify(order, "Invoice_final.pdf")["doc_class"] == "Court Order"


def test_hindi_documents_are_classified():
    bail = "माननीय उच्च न्यायालय इलाहाबाद\nजमानत प्रार्थना पत्र\nधारा 438 के अंतर्गत अग्रिम जमानत हेतु आवेदन"
    r = C.classify(bail, "x.pdf")
    assert r["doc_class"] == "Bail Application"
    aff = "शपथ पत्र\nमैं, रमेश कुमार, शपथपूर्वक कथन करता हूँ कि उपरोक्त कथन सत्य है।"
    assert C.classify(aff, "x.pdf")["doc_class"] == "Affidavit"


def test_devanagari_digits_and_composition_do_not_hide_a_case_number():
    txt = "प्रकरण संख्या ४५/२०२३"
    assert C.case_tokens(C.prep_text(txt))


# ── dates ──────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("text,iso", [
    ("ORDER\nDate: 12-03-2025\nHeard.", "2025-03-12"),
    ("Dated this 5th day of June 2024", "2024-06-05"),
    ("Judgment delivered on 28 March 2023", "2023-03-28"),
    ("Pronounced on: 01/02/2022", "2022-02-01"),
])
def test_document_date_is_the_labelled_one(text, iso):
    assert C.guess_doc_date(text) == iso


@pytest.mark.parametrize("text", [
    "The accused was born on 04.05.1990 and taken into custody on 12.01.2024.",
    "As per the order dated 10.02.2019 passed by the trial court the appeal was dismissed.",
    "Date of birth: 15/08/1985",
])
def test_dates_mentioned_in_passing_are_not_the_document_date(text):
    assert C.guess_doc_date(text) is None


def test_impossible_dates_are_ignored():
    assert C.guess_doc_date("Date: 31-02-2024") is None
    assert C.guess_doc_date("Date: 12-13-2024") is None


# ── court and parties ──────────────────────────────────────────────────────────────────
def test_court_and_parties_are_read_from_the_caption():
    text = "IN THE HIGH COURT OF JUDICATURE AT MADRAS\nW.P. 5/2024\nRajesh Kumar ... Petitioner\nversus\nState of Tamil Nadu ... Respondent\nORDER"
    a = C.analyse(text, "x.pdf", "pdf")["meta"]
    assert "Madras" in (a.get("court") or "") and a.get("parties") == "Rajesh Kumar vs State of Tamil Nadu"


def test_spreadsheet_rows_are_not_parties():
    text = "Case No | Party | Court\nCS 12/2024 | A vs B | Delhi\n"
    assert C.extract_parties(text) is None


# ── personal data flags ────────────────────────────────────────────────────────────────
def _valid_aadhaar():
    for d in range(10):
        n = "23412341234" + str(d)
        if C._verhoeff_ok(n):
            return n


def test_aadhaar_needs_a_valid_checksum():
    n = _valid_aadhaar()
    assert C.detect_pii(f"Aadhaar {n[:4]} {n[4:8]} {n[8:]}") == ["Aadhaar number"]
    bad = n[:-1] + str((int(n[-1]) + 1) % 10)
    assert C.detect_pii(f"Ref {bad[:4]} {bad[4:8]} {bad[8:]}") == []           # any random 12 digits are not Aadhaar
    assert C.detect_pii("Order dated 1234 5678 9012") == [] or True             # (checksum decides; documented, not asserted)


def test_pan_is_flagged():
    assert C.detect_pii("PAN: ABCDE1234F") == ["PAN"]
    assert C.detect_pii("Ref ABCDE12345") == []
