"""Things going wrong while an advocate works: the network drops, the server is slow or asleep, a huge paste, the back button."""
import json
import re

import pytest

from tests.e2e.test_wizard_e2e import S138, _fill, _open_s138

MEMO = ("Cheque Return Memo dated 22/06/2026. The cheque no. 004817 dated 12/06/2026 for Rs. 4,75,000/- drawn on State Bank of India, "
        "Hosur Main Branch was presented on 20/06/2026 and is returned unpaid. Reason: Funds Insufficient.\n")


def _plain(page):
    body = page.locator(".dw").inner_text()
    assert not re.search(r"undefined|\[object|Traceback|\{\"|HTTP_\d|SERVER_ERROR|DB_UNAVAILABLE", body), body[:400]


def test_the_network_drops_in_the_middle_of_an_upload(advocate, tmp_path):
    page = advocate
    _open_s138(page)
    page.get_by_role("button", name="From a file I upload").click()
    f = tmp_path / "memo.txt"
    f.write_text(MEMO, encoding="utf-8")
    page.route("**/api/contract/extract-text", lambda route: route.abort())
    page.get_by_label("Upload a file").set_input_files(str(f))
    page.get_by_text(re.compile("could not reach the server")).wait_for(timeout=15000)
    _plain(page)
    assert page.locator("#dw-f-sender_name").is_visible()                  # they can type the details instead
    page.unroute("**/api/contract/extract-text")
    page.get_by_label("Upload a file").set_input_files(str(f))             # and retrying works once the network is back
    page.get_by_text(re.compile(r"Read \d+ details? from")).wait_for(timeout=30000)
    assert page.locator("#dw-f-cheque_no").input_value() == "004817"


def test_a_sleeping_database_gives_a_plain_message_and_the_answers_survive(advocate):
    page = advocate
    _open_s138(page)
    _fill(page, S138)
    page.get_by_text("All changes saved").wait_for(timeout=15000)
    page.route("**/api/drafts/render", lambda route: route.fulfill(status=503, content_type="application/json",
                                                                  body=json.dumps({"error": True, "code": "DB_UNAVAILABLE", "message": "The database is not responding. It may be waking up. Please try again in a few seconds."})))
    page.get_by_role("button", name="Review the draft").click()
    page.get_by_text(re.compile("database is not responding")).first.wait_for(timeout=15000)
    _plain(page)
    assert page.locator("#dw-f-drawer_name").input_value() == S138["drawer_name"]        # nothing was lost
    page.unroute("**/api/drafts/render")
    page.get_by_role("button", name="Review the draft").click()                           # retry succeeds
    page.get_by_role("heading", name="Check the draft").wait_for()


def test_a_slow_server_shows_progress_then_succeeds(advocate, tmp_path):
    page = advocate
    _open_s138(page)
    page.get_by_role("button", name="From a file I upload").click()
    f = tmp_path / "memo.txt"
    f.write_text(MEMO, encoding="utf-8")

    def slow(route):
        import time
        time.sleep(4)
        route.continue_()
    page.route("**/api/drafts/extract", slow)
    page.get_by_label("Upload a file").set_input_files(str(f))
    page.get_by_text("Reading the file…").wait_for(timeout=10000)                         # the advocate sees that something is happening
    page.get_by_text(re.compile(r"Read \d+ details? from")).wait_for(timeout=40000)


def test_the_session_expires_during_an_upload(advocate, tmp_path):
    page = advocate
    _open_s138(page)
    page.get_by_role("button", name="From a file I upload").click()
    f = tmp_path / "memo.txt"
    f.write_text(MEMO, encoding="utf-8")
    page.context.clear_cookies()
    page.get_by_label("Upload a file").set_input_files(str(f))
    for _ in range(40):
        if "/login" in page.url or "session has expired" in page.locator("body").inner_text():
            break
        page.wait_for_timeout(500)
    else:
        raise AssertionError("no sign-in redirect or expired-session message after an upload with no session")
    assert page.locator("body").inner_text().strip()


def test_a_huge_paste_is_cut_to_the_field_limit_and_everything_still_saves(advocate):
    page = advocate
    _open_s138(page)
    page.locator("#dw-f-debt_nature").fill("x" * 300000)
    page.locator("#dw-f-sender_name").fill("y" * 5000)
    assert len(page.locator("#dw-f-debt_nature").input_value()) == 2000
    assert len(page.locator("#dw-f-sender_name").input_value()) == 300
    page.get_by_text("All changes saved").wait_for(timeout=20000)
    page.reload()
    assert len(page.locator("#dw-f-debt_nature").input_value()) == 2000


def test_the_browser_back_button_never_loses_the_draft(advocate):
    page = advocate
    _open_s138(page)
    page.locator("#dw-f-sender_name").fill("M/s Sundaram Agencies")
    page.get_by_text("All changes saved").wait_for(timeout=15000)
    page.go_back()                                                         # leaves the wizard for the previous page
    page.wait_for_timeout(500)
    assert page.locator("body").inner_text().strip()
    page.go_forward()
    page.locator("#dw-f-sender_name").wait_for(timeout=15000)
    assert page.locator("#dw-f-sender_name").input_value() == "M/s Sundaram Agencies"


def test_a_very_long_name_and_unusual_characters_do_not_break_the_layout(advocate, tmp_path):
    page = advocate
    page.set_viewport_size({"width": 375, "height": 800})
    _open_s138(page)
    page.locator("#dw-f-drawer_name").fill("M/s " + "Subramaniapuram-Venkatasubramaniam-Ramanathan " * 6 + "‮RTL‬ 𠜎 😀 ï")
    page.locator("#dw-f-sender_name").fill("M/s Sundaram")
    page.get_by_role("button", name="Review the draft").click()
    page.get_by_role("heading", name="Check the draft").wait_for()
    assert page.evaluate("document.documentElement.scrollWidth") <= 376
    assert page.evaluate("(() => { const r = document.querySelector('.dw-page').getBoundingClientRect(); return r.right <= window.innerWidth + 1; })()")


def test_the_server_returns_html_instead_of_json(advocate):
    """A proxy or gateway error page must not reach the screen as markup or as 'Unexpected token <'."""
    page = advocate
    _open_s138(page)
    _fill(page, S138)
    page.route("**/api/drafts/render", lambda route: route.fulfill(status=502, content_type="text/html", body="<html><body><h1>502 Bad Gateway</h1>nginx</body></html>"))
    page.get_by_role("button", name="Review the draft").click()
    page.wait_for_timeout(1500)
    body = page.locator(".dw").inner_text()
    assert "<html" not in body and "nginx" not in body and "Unexpected token" not in body and "JSON" not in body
    assert re.search(r"something went wrong|try again", body, re.I)


def test_if_the_list_of_documents_cannot_load_there_is_a_try_again(advocate):
    page = advocate
    page.route("**/api/drafts/types", lambda route: route.abort())
    page.goto("/draft")
    page.get_by_text(re.compile("could not reach the server")).first.wait_for(timeout=15000)
    page.unroute("**/api/drafts/types")
    page.get_by_role("button", name="Try again").click()
    page.get_by_role("button", name=re.compile("Cheque bounce notice")).wait_for(timeout=15000)
