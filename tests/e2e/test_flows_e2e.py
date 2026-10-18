"""Check conflicts and Analyze a contract, driven in a real browser against the real backend (AI replaced by a fake)."""
import io
import re

import pytest

CONTRACT = """SERVICE AGREEMENT

This Agreement is made on 1 August 2026 between Sundaram Agencies Pvt Ltd and Kumar Infra LLP.

1. Services. The Contractor shall provide the services described in Schedule A.

2. Payment. The Client shall pay Rs. 4,75,000 within 30 days of each invoice. Delay attracts interest at 24% per month.

3. Termination. The Client may terminate this Agreement at any time without notice and without paying for work done.

4. Governing law. This Agreement is governed by the laws of India. The courts at Chennai have exclusive jurisdiction.

5. Term. This Agreement runs for 3 years from 1 August 2026 and renews automatically unless notice is given 90 days before expiry.
"""


def _csrf(page):
    return next(c["value"] for c in page.context.cookies() if c["name"] == "csrf_access_token")


def _api(page, method, path, body=None):
    fn = getattr(page.context.request, method)
    r = fn(path, data=body, headers={"X-CSRF-TOKEN": _csrf(page)}) if method != "get" else fn(path)
    assert r.status < 300, (path, r.status, r.text())
    return r.json()


def _seed_firm(page):
    _api(page, "post", "/api/practice/firm", {"name": "Raman Chambers"})
    c1 = _api(page, "post", "/api/practice/clients", {"name": "M/s Sundaram Agencies"})
    cid1 = (c1.get("client") or c1)["id"]
    c2 = _api(page, "post", "/api/practice/clients", {"name": "Mr. Arun Kumar"})
    _api(page, "post", "/api/practice/cases", {"case_no": "CC 1/2026", "court": "Metropolitan Magistrate, Chennai", "title": "Sundaram Agencies v. Kumar Traders",
                                               "client_id": cid1, "opposite_party": "M/s Kumar Traders Pvt Ltd"})


def _docx_bytes(text):
    from docx import Document
    d = Document()
    for para in text.split("\n\n"):
        d.add_paragraph(para)
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


# ── Check conflicts ───────────────────────────────────────────────────────────────────────────
def test_start_card_opens_the_real_conflict_check(advocate):
    page = advocate
    page.goto("/start")
    page.get_by_role("link", name=re.compile("Check conflicts")).click()
    page.wait_for_url(re.compile("/check-conflicts"))
    page.get_by_role("heading", name="Check for a conflict of interest").wait_for()


def test_empty_practice_says_nothing_to_check_not_clear(advocate):
    page = advocate
    _api(page, "post", "/api/practice/firm", {"name": "Raman Chambers"})
    page.goto("/check-conflicts")
    page.locator("#cc-client").fill("Rajesh Sharma")
    page.locator("#cc-other-0").fill("Tech Corp India Private Limited")
    page.get_by_role("button", name="Check names").click()
    page.get_by_text("Nothing to check against").wait_for()
    body = page.locator(".cc").inner_text()
    assert "not a clearance" in body.lower() and "No match found" not in body
    page.get_by_role("link", name="Add your clients").wait_for()


def test_conflict_is_found_with_the_matching_record_and_a_record_can_be_saved(advocate, tmp_path):
    page = advocate
    _seed_firm(page)
    page.goto("/check-conflicts")
    page.locator("#cc-client").fill("Kumar Traders")
    page.get_by_role("button", name="Check names").click()
    page.get_by_text("Possible conflict").first.wait_for()
    assert "Do not accept the matter" in page.locator(".cc-banner").inner_text()
    card = page.locator(".cc-card").first
    assert "You act against" in card.inner_text() and "CC 1/2026" in card.inner_text()
    card.get_by_role("link", name=re.compile("Sundaram Agencies v. Kumar Traders")).wait_for()
    with page.expect_download() as dl:
        page.get_by_role("button", name=re.compile("Save a record of this check")).click()
    path = tmp_path / "check.docx"
    dl.value.save_as(path)
    from docx import Document
    text = "\n".join(p.text for p in Document(str(path)).paragraphs)
    assert "RECORD OF CONFLICT CHECK" in text and "Kumar Traders" in text and "Limits of this check" in text


def test_unrelated_name_is_clear_and_says_what_was_searched(advocate):
    page = advocate
    _seed_firm(page)
    page.goto("/check-conflicts")
    page.locator("#cc-client").fill("Venkatesh Reddy")
    page.get_by_role("button", name="Check names").click()
    page.get_by_text("No match found").first.wait_for()
    assert "2 clients and 1 case" in page.locator(".cc").inner_text()


def test_a_user_with_no_practice_gets_a_plain_message(advocate):
    page = advocate
    page.goto("/check-conflicts")
    page.locator("#cc-client").fill("Anyone")
    page.get_by_role("button", name="Check names").click()
    page.get_by_text(re.compile("set up your practice")).wait_for()
    assert "NO_FIRM" not in page.locator(".cc").inner_text() and "{" not in page.locator(".cc").inner_text()


# ── Analyze a contract ──────────────────────────────────────────────────────────────────────────
def _upload_and_begin(page, text, name="contract.docx"):
    page.goto("/contract-analyzer")
    page.locator("input[type=file]").first.set_input_files({"name": name, "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                                                            "buffer": _docx_bytes(text)})
    page.get_by_role("button", name="Begin analysis").click()


def test_analyze_a_contract_end_to_end_with_grounded_findings_and_key_dates(advocate):
    page = advocate
    _upload_and_begin(page, CONTRACT)
    page.get_by_text("Flagged clauses").first.wait_for(timeout=90000)
    cards = page.locator(".risk-card")
    assert cards.count() == 2                                              # the invented finding was dropped
    text = page.locator(".rail-panel.active").inner_text()
    assert "Termination without notice" in text and "Excessive interest" in text and "Invented finding" not in text
    assert page.get_by_role("alert").filter(has_text="removed because the text they quoted is not in your document").first.is_visible()
    page.get_by_role("button", name=re.compile("^\\s*Missing clauses|Missing")).first.click()
    assert "Confidentiality" in page.locator(".rail-panel.active").inner_text()
    page.get_by_role("button", name="Key dates").click()
    kd = page.locator(".rail-panel.active").inner_text()
    assert "90 days" in kd and "1 August 2026" in kd
    page.get_by_role("button", name=re.compile("Citations")).click()
    assert "No supporting authorities found" in page.locator(".rail-panel.active").inner_text()
    assert not page.bad_responses


def test_when_the_ai_is_down_the_screen_says_nothing_was_checked(advocate):
    page = advocate
    _upload_and_begin(page, CONTRACT + "\n[[AI-DOWN]]")
    page.get_by_text("Analysis").first.wait_for()
    page.get_by_text(re.compile("nothing was checked")).first.wait_for(timeout=90000)
    body = page.locator("body").inner_text()
    assert "Risks flagged" not in body and "No risks flagged" not in body
    assert page.get_by_role("button", name=re.compile("Retry")).first.is_visible()
    assert "provider" not in body.lower() and "RuntimeError" not in body


def test_a_finding_becomes_an_amendment_with_the_quote_prefilled_and_the_new_wording_flagged(advocate, tmp_path):
    page = advocate
    _upload_and_begin(page, CONTRACT)
    page.get_by_text("Flagged clauses").first.wait_for(timeout=90000)
    page.locator(".risk-card").filter(has_text="Termination without notice").get_by_role("button", name="Draft an amendment").click()
    page.get_by_role("heading", name=re.compile("add the details")).wait_for()
    assert "contract analysis" in page.locator(".dw").inner_text()
    old = page.locator("#dw-f-old_wording").input_value()
    assert "terminate this Agreement at any time without notice" in old and old in CONTRACT.replace("\n", " ") or "without notice" in old
    box = page.locator(".dw-field", has=page.locator("#dw-f-new_wording"))
    assert "Please check" in box.inner_text()                              # AI-suggested wording is never trusted silently
    for slot, value in {"agreement_date": "1 August 2026", "party_a_name": "Sundaram Agencies Pvt Ltd", "party_b_name": "Kumar Infra LLP", "effective_date": "1 November 2026",
                        "place": "Chennai", "amendment_date": "15 October 2026"}.items():
        page.locator(f"#dw-f-{slot}").fill(value)
    page.get_by_role("button", name="Review the draft").click()
    page.get_by_role("heading", name="Check the draft").wait_for()
    preview = page.locator(".dw-page").inner_text()
    assert "which now reads" in preview and "without notice" in preview and "1 November 2026" in preview
    page.get_by_role("button", name="Looks good, continue").click()
    with page.expect_download() as dl:
        page.get_by_role("button", name=re.compile("Download Word")).click()
    path = tmp_path / "amendment.docx"
    dl.value.save_as(path)
    from docx import Document
    assert "AMENDMENT TO THE" in "\n".join(p.text for p in Document(str(path)).paragraphs)


def test_a_bad_file_gets_a_plain_message_in_the_analyzer(advocate):
    page = advocate
    page.goto("/contract-analyzer")
    page.locator("input[type=file]").first.set_input_files({"name": "fake.pdf", "mimeType": "application/pdf", "buffer": b"this is not a pdf at all"})
    page.get_by_role("button", name="Begin analysis").click()
    page.get_by_text(re.compile("not a real PDF")).first.wait_for(timeout=30000)
    body = page.locator("body").inner_text()
    assert "NOT_A_PDF" not in body and "undefined" not in body


def test_the_analyzer_and_conflict_pages_have_no_console_errors_on_the_happy_path(advocate):
    page = advocate
    _seed_firm(page)
    page.goto("/check-conflicts")
    page.locator("#cc-client").fill("Venkatesh Reddy")
    page.get_by_role("button", name="Check names").click()
    page.get_by_text("No match found").first.wait_for()
    assert not [e for e in page.console_errors if "401" not in e], page.console_errors


@pytest.mark.parametrize("name,width,height", [("desktop", 1280, 900), ("phone", 375, 812)])
def test_capture_flow_screens_for_the_review_pack(advocate, name, width, height):
    import os
    out = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "screens")
    os.makedirs(out, exist_ok=True)
    page = advocate
    page.set_viewport_size({"width": width, "height": height})
    _seed_firm(page)
    page.goto("/check-conflicts")
    page.locator("#cc-client").fill("Kumar Traders")
    page.get_by_role("button", name="Check names").click()
    page.get_by_text("Possible conflict").first.wait_for()
    page.wait_for_timeout(300)
    page.screenshot(path=os.path.join(out, f"{name}-7-conflicts-result.png"), full_page=True)
    _upload_and_begin(page, CONTRACT)
    page.get_by_text("Flagged clauses").first.wait_for(timeout=90000)
    page.wait_for_timeout(600)
    page.screenshot(path=os.path.join(out, f"{name}-8-analyzer-result.png"), full_page=True)


XSS = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script><svg onload="window.__xss=3">'


def test_script_in_a_contract_or_a_party_name_never_runs_in_the_analyzer(advocate):
    page = advocate
    _upload_and_begin(page, CONTRACT.replace("Kumar Infra LLP", "Kumar " + XSS) + "\n\n6. Notice. The Client may end it without notice " + XSS + " to the Contractor.")
    page.get_by_text("Flagged clauses").first.wait_for(timeout=90000)
    page.wait_for_timeout(1500)
    assert page.evaluate("window.__xss === undefined"), "script from the contract ran in the page"
    assert page.locator("img[src='x']").count() == 0 and page.locator("svg[onload]").count() == 0


def test_script_in_a_name_never_runs_on_the_conflict_page_or_in_the_editor(advocate):
    page = advocate
    _seed_firm(page)
    page.goto("/check-conflicts")
    page.locator("#cc-client").fill(XSS)
    page.get_by_role("button", name="Check names").click()
    page.get_by_text(re.compile("No match found|Possible conflict|Please check")).first.wait_for()
    page.wait_for_timeout(800)
    assert page.evaluate("window.__xss === undefined")
    # and through the wizard into the editor
    page.goto("/draft")
    page.get_by_role("button", name=re.compile("Cheque bounce notice")).click()
    page.get_by_role("button", name="I will type them in").click()
    page.locator("#dw-f-drawer_name").fill("M/s Kumar " + XSS)
    page.locator("#dw-f-sender_name").fill("M/s Sundaram Agencies")
    page.get_by_role("button", name="Review the draft").click()
    page.get_by_role("heading", name="Check the draft").wait_for()
    page.get_by_role("button", name="Looks good, continue").click()
    page.get_by_role("button", name="Open in the editor").click()
    page.wait_for_url(re.compile("/auto-draft"))
    page.get_by_text("Kumar").first.wait_for(timeout=20000)
    page.wait_for_timeout(1500)
    assert page.evaluate("window.__xss === undefined"), "script from a party name ran in the editor"
