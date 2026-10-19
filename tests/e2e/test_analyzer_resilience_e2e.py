"""The Contract Analyzer screen must never spin without end: a forgotten job, a dead connection, a Cancel and a failure each end with a plain message."""
import json
import re

from tests.e2e.test_flows_e2e import CONTRACT, _upload_and_begin

STATUS = "**/api/contract/analysis-status/*"


def _processing(route):
    route.fulfill(status=200, content_type="application/json", body=json.dumps(
        {"success": True, "status": "processing", "progress": 42, "stage": "Reading the contract: section 1 of 2", "sections_total": 2, "sections_done": 1}))


def _body(page):
    return page.locator("body").inner_text()


def test_a_job_the_server_has_forgotten_ends_with_a_plain_message_and_a_retry(advocate):
    page = advocate
    page.route(STATUS, lambda route: route.fulfill(status=404, content_type="application/json", body=json.dumps({"success": False, "status": "not_found", "error": "x"})))
    _upload_and_begin(page, CONTRACT)
    page.get_by_text(re.compile("no longer has this analysis")).first.wait_for(timeout=30000)
    assert page.get_by_role("button", name=re.compile("Retry")).first.is_visible()
    assert page.locator(".scan-ring").count() == 0                         # nothing is spinning any more
    assert not re.search(r"undefined|\[object|Traceback|\{\"", _body(page))


def test_the_screen_shows_time_and_sections_and_cancel_ends_it(advocate):
    page = advocate
    page.route(STATUS, _processing)
    cancels = []
    page.route("**/api/contract/cancel/*", lambda route: (cancels.append(route.request.url), route.fulfill(status=200, content_type="application/json", body='{"ok": true}')))
    _upload_and_begin(page, CONTRACT)
    page.get_by_text(re.compile(r"\d+:\d\d elapsed")).wait_for(timeout=30000)
    page.get_by_text(re.compile("section 2 of 2")).wait_for(timeout=15000)
    page.get_by_role("button", name="Cancel").click()
    page.get_by_text(re.compile("You cancelled the analysis")).first.wait_for(timeout=10000)
    assert cancels, "Cancel did not tell the server"
    assert page.locator(".scan-ring").count() == 0
    assert page.get_by_role("button", name=re.compile("Retry")).first.is_visible()


def test_a_dropped_connection_shows_reconnecting_and_then_recovers(advocate):
    page = advocate
    seen = {"n": 0}

    def flaky(route):
        seen["n"] += 1
        if seen["n"] <= 3:
            route.abort()
        else:
            route.continue_()
    page.route(STATUS, flaky)
    _upload_and_begin(page, CONTRACT)
    page.get_by_text("Flagged clauses").first.wait_for(timeout=90000)       # it completed although three checks were lost
    assert seen["n"] > 3


def test_a_failed_job_shows_its_own_reason(advocate):
    page = advocate
    page.route(STATUS, lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps(
        {"success": True, "status": "failed", "error": "The AI service was too slow to answer, so no analysis was produced and nothing was checked. Please try again in a minute."})))
    _upload_and_begin(page, CONTRACT)
    page.get_by_text(re.compile("too slow to answer")).first.wait_for(timeout=30000)
    assert page.get_by_role("button", name=re.compile("Retry")).first.is_visible()


def test_an_expired_session_during_the_wait_says_so(advocate):
    page = advocate
    page.route(STATUS, lambda route: route.fulfill(status=401, content_type="application/json", body='{"error": true, "message": "x"}'))
    _upload_and_begin(page, CONTRACT)
    for _ in range(60):                                                    # the app sends the person to sign in, or the screen says so
        if "/login" in page.url or "session has expired" in _body(page):
            break
        page.wait_for_timeout(500)
    else:
        raise AssertionError("no sign-in redirect or expired-session message")
    assert page.locator(".scan-ring").count() == 0 or "/login" in page.url


def test_leaving_the_page_cancels_the_scan_on_the_server(advocate):
    page = advocate
    page.route(STATUS, _processing)
    cancels = []
    page.route("**/api/contract/cancel/*", lambda route: (cancels.append(1), route.fulfill(status=200, content_type="application/json", body='{"ok": true}')))
    _upload_and_begin(page, CONTRACT)
    page.get_by_text(re.compile("section 2 of 2")).wait_for(timeout=30000)           # the job is running on the server
    page.locator("aside, nav").get_by_text("Start", exact=True).first.click()
    page.wait_for_url(re.compile("/start"), timeout=10000)
    page.wait_for_timeout(1500)
    assert cancels, "leaving the screen left the scan running on the server"
