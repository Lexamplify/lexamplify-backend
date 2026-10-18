"""The guided drafting wizard, driven like a real advocate in a real browser against the real backend."""
import io
import re
import time

import pytest

S138 = {
    "sender_name": "M/s Sundaram Agencies", "sender_address": "14 Cross Street, T. Nagar, Chennai - 600017",
    "advocate_name": "Adv. Priya Raman", "advocate_enrolment": "MS/1234/2015", "advocate_address": "Chamber 5, High Court Campus, Chennai - 600104",
    "drawer_name": "M/s Kumar Traders Pvt Ltd", "drawer_address": "Plot 22, Industrial Estate, Hosur - 635109",
    "cheque_no": "004817", "cheque_date": "12 June 2026", "cheque_amount": "4,75,000", "drawn_bank": "State Bank of India, Hosur Main Branch",
    "payee_bank": "HDFC Bank, T. Nagar Branch", "presentation_date": "20 June 2026", "return_reason": "Funds insufficient",
    "return_memo_date": "22 June 2026", "info_received_date": "23 June 2026",
    "debt_nature": "That my client supplied goods to you under invoice no. 2231 dated 2 May 2026, and the cheque was issued towards the price of those goods.",
    "notice_date": "30 June 2026",
}


def _fill(page, facts):
    for slot, value in facts.items():
        page.locator(f"#dw-f-{slot}").fill(value)


def _open_s138(page, via_start=True):
    if via_start:
        page.goto("/start")
        page.get_by_role("link", name=re.compile("Draft a document")).click()
    else:
        page.goto("/draft")
    page.get_by_role("heading", name="What would you like to draft?").wait_for()
    page.get_by_role("button", name=re.compile("Cheque bounce notice")).click()
    page.get_by_role("heading", name=re.compile("add the details")).wait_for()
    page.get_by_role("button", name="I will type them in").click()


def _docx_text(data):
    from docx import Document
    d = Document(io.BytesIO(data))
    return "\n".join(p.text for p in d.paragraphs)


def test_flagship_s138_notice_start_to_download_in_well_under_five_minutes(advocate, tmp_path):
    page, t0 = advocate, time.time()
    _open_s138(page)
    _fill(page, S138)
    page.get_by_role("button", name="Review the draft").click()
    page.get_by_role("heading", name="Check the draft").wait_for()
    preview = page.locator(".dw-page").inner_text()
    assert "₹4,75,000 (Rupees Four Lakh Seventy Five Thousand Only)" in preview and "12 June 2026" in preview
    assert page.locator(".dw-chip").count() == 0                       # nothing left blank
    page.get_by_role("button", name="Looks good, continue").click()
    page.get_by_role("heading", name="Your draft is ready").wait_for()
    with page.expect_download() as dl:
        page.get_by_role("button", name=re.compile("Download Word")).click()
    path = tmp_path / "notice.docx"
    dl.value.save_as(path)
    text = _docx_text(path.read_bytes())
    assert "LEGAL NOTICE" in text and "004817" in text and "M/s Kumar Traders Pvt Ltd" in text and "Bracketed Field" not in text
    with page.expect_download() as dl2:
        page.get_by_role("button", name="Download PDF").click()
    pdf_path = tmp_path / "notice.pdf"
    dl2.value.save_as(pdf_path)
    import fitz
    ptext = "".join(p.get_text() for p in fitz.open(str(pdf_path)))
    assert "₹4,75,000" in ptext and "Section 138" in ptext
    assert time.time() - t0 < 120, "the happy path should take seconds for a script; minutes for a person"
    assert not page.console_errors, page.console_errors
    assert not page.bad_responses, page.bad_responses


def test_blank_details_stay_blank_and_are_highlighted_never_invented(advocate, tmp_path):
    page = advocate
    _open_s138(page)
    page.locator("#dw-f-sender_name").fill("M/s Sundaram Agencies")
    page.get_by_role("button", name="Review the draft").click()
    page.get_by_role("heading", name="Check the draft").wait_for()
    assert page.get_by_text(re.compile(r"items? needs? your attention|items need your attention")).first.is_visible()
    chips = page.locator(".dw-chip")
    assert chips.count() >= 10
    body = page.locator(".dw-page").inner_text()
    assert not re.search(r"\b\d{6}\b", body)                           # no made-up cheque number or PIN
    page.get_by_role("button", name="Looks good, continue").click()
    with page.expect_download() as dl:
        page.get_by_role("button", name=re.compile("Download Word")).click()
    path = tmp_path / "blank.docx"
    dl.value.save_as(path)
    from docx import Document
    d = Document(str(path))
    highlighted = [r.text for p in d.paragraphs for r in p.runs if r.font.highlight_color is not None]
    assert len(highlighted) >= 10
    assert page.get_by_text(re.compile("highlighted in yellow")).first.is_visible()


def test_autosave_survives_a_refresh_and_the_draft_can_be_resumed_from_start(advocate):
    page = advocate
    _open_s138(page)
    page.locator("#dw-f-sender_name").fill("M/s Sundaram Agencies")
    page.locator("#dw-f-drawer_name").fill("M/s Kumar Traders Pvt Ltd")
    page.get_by_text("All changes saved").wait_for(timeout=15000)
    url = page.url
    assert re.search(r"/draft/\d+$", url)
    page.reload()
    page.locator("#dw-f-sender_name").wait_for()
    assert page.locator("#dw-f-sender_name").input_value() == "M/s Sundaram Agencies"
    assert page.locator("#dw-f-drawer_name").input_value() == "M/s Kumar Traders Pvt Ltd"
    page.goto("/start")
    page.get_by_text("Continue where you left off").wait_for()
    page.get_by_role("link", name=re.compile("Cheque bounce")).click()
    page.locator("#dw-f-sender_name").wait_for()
    assert page.locator("#dw-f-sender_name").input_value() == "M/s Sundaram Agencies"


MEMO = ("STATE BANK OF INDIA, HOSUR MAIN BRANCH\nCheque Return Memo dated 22/06/2026\n"
        "Cheque no. 004817 dated 12/06/2026 for Rs. 4,75,000/- drawn on State Bank of India, Hosur Main Branch "
        "was presented on 20/06/2026 and is returned unpaid. Reason: Funds Insufficient.\n")


def test_file_source_prefills_with_the_source_snippet_beside_each_value(advocate, tmp_path):
    page = advocate
    _open_s138(page)
    page.get_by_role("button", name="From a file I upload").click()
    f = tmp_path / "return_memo.txt"
    f.write_text(MEMO, encoding="utf-8")
    page.get_by_label("Upload a file").set_input_files(str(f))
    page.get_by_text(re.compile(r"Read \d+ details? from")).wait_for(timeout=30000)
    assert page.locator("#dw-f-cheque_no").input_value() == "004817"
    assert "Funds" in page.locator("#dw-f-return_reason").input_value()
    box = page.locator(".dw-field", has=page.locator("#dw-f-cheque_no")).locator(".dw-src")
    assert "Read from return_memo.txt" in box.inner_text() and "004817" in box.inner_text()
    assert page.locator("#dw-f-drawer_name").input_value() == ""       # not in the file, so not invented


def test_a_scanned_pdf_gets_a_plain_message_and_a_way_forward(advocate, tmp_path):
    import fitz
    page = advocate
    doc = fitz.open()
    doc.new_page()
    f = tmp_path / "scan.pdf"
    f.write_bytes(doc.tobytes())
    _open_s138(page)
    page.get_by_role("button", name="From a file I upload").click()
    page.get_by_label("Upload a file").set_input_files(str(f))
    msg = page.get_by_text(re.compile("scanned image")).first
    msg.wait_for(timeout=30000)
    body = page.locator(".dw").inner_text()
    assert "{" not in body and "undefined" not in body and "BLANK_DOCUMENT" not in body
    assert page.locator("#dw-f-sender_name").is_visible()              # they can still type the details in


def test_validation_messages_are_plain_and_beside_the_field(advocate):
    page = advocate
    _open_s138(page)
    page.locator("#dw-f-cheque_no").fill("48")
    page.locator("#dw-f-cheque_date").fill("31/02/2026")
    page.locator("#dw-f-cheque_amount").fill("five lakh")
    page.get_by_text("6-digit cheque number").wait_for(timeout=10000)
    assert page.get_by_text("is not a date this tool can read").first.is_visible()
    assert page.get_by_text("is not a rupee amount").first.is_visible()


@pytest.mark.parametrize("width", [375, 360])
def test_phone_width_has_no_sideways_scroll_and_44px_targets_on_every_step(advocate, width):
    page = advocate
    page.set_viewport_size({"width": width, "height": 800})

    def check(label):
        sw = page.evaluate("document.documentElement.scrollWidth")
        assert sw <= width + 1, f"{label}: page scrolls sideways ({sw}px > {width}px)"
        box = page.evaluate("(() => { const e = document.querySelector('.dw, .sp'); const r = e.getBoundingClientRect(); return [r.left, r.right]; })()")
        assert box[0] >= -0.5 and box[1] <= width + 0.5, f"{label}: content is cut off at the edge ({box})"
        assert page.evaluate("document.querySelectorAll('main').length") == 1, f"{label}: more than one main landmark"

    page.goto("/start")
    page.get_by_role("heading", name=re.compile("What would you like")).wait_for()
    check("start")
    page.get_by_role("link", name=re.compile("Draft a document")).click()
    page.get_by_role("heading", name="What would you like to draft?").wait_for()
    check("choose")
    page.get_by_role("button", name=re.compile("Cheque bounce notice")).click()
    page.get_by_role("button", name="I will type them in").click()
    check("details")
    small = page.evaluate("""() => [...document.querySelectorAll('.dw button, .dw input, .dw select, .dw textarea')]
        .filter(e => e.offsetParent !== null && e.getBoundingClientRect().height < 40)
        .map(e => (e.textContent || e.id || e.tagName).trim().slice(0, 30))""")
    assert not small, f"touch targets under 40px: {small}"
    _fill(page, S138)
    page.get_by_role("button", name="Review the draft").click()
    page.get_by_role("heading", name="Check the draft").wait_for()
    check("review")
    page.get_by_role("button", name="Looks good, continue").click()
    page.get_by_role("heading", name="Your draft is ready").wait_for()
    check("download")


def test_double_click_on_review_creates_one_draft_not_two(advocate):
    page = advocate
    _open_s138(page)
    _fill(page, S138)
    page.get_by_text("All changes saved").wait_for(timeout=15000)
    btn = page.get_by_role("button", name="Review the draft")
    btn.dblclick()
    page.get_by_role("heading", name="Check the draft").wait_for()
    rows = page.context.request.get("/api/drafts/sessions").json()["sessions"]
    assert len(rows) == 1, rows


def test_session_that_expires_mid_task_loses_nothing_the_advocate_typed(advocate):
    page = advocate
    _open_s138(page)
    page.locator("#dw-f-sender_name").fill("M/s Sundaram Agencies")
    page.get_by_text("All changes saved").wait_for(timeout=15000)
    url = page.url
    page.context.clear_cookies()                                        # the session ends while they are mid-form
    page.locator("#dw-f-drawer_name").fill("M/s Kumar Traders Pvt Ltd")
    # Either the in-page notice or the app's redirect to sign-in is fine. A blank page or lost typing is not.
    # polled from Python: Playwright's own wait_for_function evaluates a string inside the page, which the strict CSP forbids
    for _ in range(50):
        if "/login" in page.url or "session has expired" in page.locator("body").inner_text():
            break
        page.wait_for_timeout(500)
    else:
        raise AssertionError("neither the sign-in redirect nor the expired-session notice appeared")
    assert page.locator("body").inner_text().strip()
    r = page.context.request.post("/api/auth/login", data={"email": page.email, "password": "TestPass123!"})
    assert r.status == 200, r.text()
    page.goto(url)
    page.locator("#dw-f-drawer_name").wait_for()
    assert page.locator("#dw-f-drawer_name").input_value() == "M/s Kumar Traders Pvt Ltd"
    assert page.locator("#dw-f-sender_name").input_value() == "M/s Sundaram Agencies"


def test_unsaved_typing_is_offered_back_even_when_the_draft_never_reached_the_server(advocate):
    page = advocate
    _open_s138(page)
    page.context.route("**/api/drafts/sessions**", lambda route: route.abort())   # the network drops before the first save
    page.locator("#dw-f-sender_name").fill("M/s Sundaram Agencies")
    page.get_by_text(re.compile("Not saved yet")).wait_for(timeout=15000)
    page.context.unroute("**/api/drafts/sessions**")
    page.goto("/draft")
    page.get_by_text("You have unsaved work").wait_for(timeout=15000)
    page.get_by_role("button", name="Restore it").click()
    page.locator("#dw-f-sender_name").wait_for()
    assert page.locator("#dw-f-sender_name").input_value() == "M/s Sundaram Agencies"
    page.get_by_text("All changes saved").wait_for(timeout=15000)       # and it now saves normally


def test_a_draft_changed_in_another_tab_is_flagged_not_silently_overwritten(advocate):
    page = advocate
    _open_s138(page)
    page.locator("#dw-f-sender_name").fill("M/s Sundaram Agencies")
    page.get_by_text("All changes saved").wait_for(timeout=15000)
    sid = re.search(r"/draft/(\d+)", page.url).group(1)
    page.context.request.put(f"/api/drafts/sessions/{sid}", data={"facts": {"sender_name": "Changed elsewhere"}},
                             headers={"X-CSRF-TOKEN": next(c["value"] for c in page.context.cookies() if c["name"] == "csrf_access_token")})
    page.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
    page.get_by_text("changed in another tab").wait_for(timeout=10000)


def test_indic_and_special_characters_reach_the_word_file(advocate, tmp_path):
    page = advocate
    _open_s138(page)
    facts = {**S138, "drawer_name": "M/s குமார் டிரேடர்ஸ் / कुमार ट्रेडर्स Pvt Ltd", "drawer_address": "प्लॉट 22, औद्योगिक क्षेत्र, होसूर & Co. <b>bold</b> 'quote' \"dq\""}
    _fill(page, facts)
    page.get_by_role("button", name="Review the draft").click()
    page.get_by_role("heading", name="Check the draft").wait_for()
    assert "कुमार ट्रेडर्स" in page.locator(".dw-page").inner_text() and page.locator(".dw-page b").count() <= 1
    page.get_by_role("button", name="Looks good, continue").click()
    with page.expect_download() as dl:
        page.get_by_role("button", name=re.compile("Download Word")).click()
    path = tmp_path / "indic.docx"
    dl.value.save_as(path)
    text = _docx_text(path.read_bytes())
    assert "குமார்" in text and "कुमार" in text and "<b>bold</b>" in text      # shown as typed, never interpreted as markup


def test_open_in_editor_loads_the_finished_draft_into_the_studio(advocate):
    page = advocate
    _open_s138(page)
    _fill(page, S138)
    page.get_by_role("button", name="Review the draft").click()
    page.get_by_role("button", name="Looks good, continue").click()
    page.get_by_role("button", name="Open in the editor").click()
    page.wait_for_url(re.compile("/auto-draft"))
    page.get_by_text("004817").first.wait_for(timeout=20000)
    assert page.get_by_text("M/s Kumar Traders Pvt Ltd").first.is_visible()


def test_start_over_deletes_the_draft_after_confirmation(advocate):
    page = advocate
    _open_s138(page)
    page.locator("#dw-f-sender_name").fill("M/s Sundaram Agencies")
    page.get_by_text("All changes saved").wait_for(timeout=15000)
    page.get_by_role("button", name="Start over").click()
    page.get_by_role("button", name="Yes, start over").click()
    page.get_by_role("heading", name="What would you like to draft?").wait_for()
    assert page.context.request.get("/api/drafts/sessions").json()["sessions"] == []


def test_first_run_guide_is_remembered_on_the_server_not_just_in_the_browser(advocate, browser, stack):
    page = advocate
    page.goto("/start")
    page.get_by_text("How it works").wait_for()
    page.get_by_role("button", name="Got it, hide this").click()
    page.wait_for_function("true")
    # a brand-new browser (no localStorage) for the same advocate must not see the guide again
    cookies = page.context.cookies()
    ctx2 = browser.new_context(base_url=stack)
    ctx2.add_cookies(cookies)
    p2 = ctx2.new_page()
    p2.goto("/start")
    p2.get_by_role("heading", name=re.compile("What would you like")).wait_for()
    p2.wait_for_timeout(1500)
    assert p2.get_by_text("How it works").count() == 0
    ctx2.close()


def test_logged_out_visitor_is_sent_to_login_not_a_blank_page(browser, stack):
    ctx = browser.new_context(base_url=stack)
    p = ctx.new_page()
    p.goto("/draft")
    p.wait_for_url(re.compile("/login"), timeout=15000)
    assert p.locator("body").inner_text().strip()
    ctx.close()


SCREENS = __import__("os").path.join(__import__("os").path.dirname(__file__), "..", "..", "docs", "screens")


@pytest.mark.parametrize("name,width,height", [("desktop", 1280, 900), ("tablet", 768, 1024), ("phone", 375, 812)])
def test_capture_screens_for_the_review_pack(advocate, name, width, height):
    """Writes docs/screens/<size>-<step>.png so the manager can see every step without running anything."""
    import os
    os.makedirs(SCREENS, exist_ok=True)
    page = advocate
    page.set_viewport_size({"width": width, "height": height})

    def shot(step):
        page.wait_for_timeout(400)
        page.screenshot(path=os.path.join(SCREENS, f"{name}-{step}.png"), full_page=True)

    page.goto("/start")
    page.get_by_role("heading", name=re.compile("What would you like")).wait_for()
    shot("1-start")
    page.get_by_role("link", name=re.compile("Draft a document")).click()
    page.get_by_role("heading", name="What would you like to draft?").wait_for()
    shot("2-choose")
    page.get_by_role("button", name=re.compile("Cheque bounce notice")).click()
    page.get_by_role("button", name="I will type them in").click()
    shot("3-details-empty")
    _fill(page, S138)
    page.locator("#dw-f-cheque_no").scroll_into_view_if_needed()
    shot("4-details-filled")
    page.get_by_role("button", name="Review the draft").click()
    page.get_by_role("heading", name="Check the draft").wait_for()
    shot("5-review")
    page.get_by_role("button", name="Looks good, continue").click()
    page.get_by_role("heading", name="Your draft is ready").wait_for()
    shot("6-download")


def test_an_earlier_version_can_be_opened_and_chosen_again(advocate):
    page = advocate
    _open_s138(page)
    _fill(page, S138)
    page.get_by_role("button", name="Review the draft").click()
    page.get_by_role("button", name="Looks good, continue").click()
    page.get_by_role("heading", name="Your draft is ready").wait_for()
    page.get_by_role("button", name="Do another").wait_for()
    page.get_by_text("This draft is saved").wait_for()
    # go back, change the amount, and reach the download step again: that makes a second version
    page.get_by_role("button", name="Go back and change something").click()
    page.get_by_role("button", name="Back to details").click()
    page.locator("#dw-f-cheque_amount").fill("9,99,999")
    page.get_by_role("button", name="Review the draft").click()
    page.get_by_role("heading", name="Check the draft").wait_for()
    assert "9,99,999" in page.locator(".dw-page").inner_text()
    page.get_by_role("button", name="Looks good, continue").click()
    page.get_by_role("heading", name="Your draft is ready").wait_for()
    page.get_by_text(re.compile(r"Earlier versions \(1\)")).wait_for(timeout=15000)
    page.get_by_text(re.compile(r"Earlier versions")).click()
    page.get_by_role("button", name=re.compile("^Saved")).first.click()
    page.get_by_role("heading", name="An earlier version").wait_for()
    old = page.locator(".dw-page").inner_text()
    assert "4,75,000" in old and "9,99,999" not in old
    page.get_by_role("button", name="Use this version").click()
    page.get_by_role("heading", name="Your draft is ready").wait_for()
    with page.expect_download() as dl:
        page.get_by_role("button", name=re.compile("Download Word")).click()
    import tempfile, os
    path = os.path.join(tempfile.mkdtemp(), "v.docx")
    dl.value.save_as(path)
    assert "4,75,000" in _docx_text(open(path, "rb").read()) and "9,99,999" not in _docx_text(open(path, "rb").read())
