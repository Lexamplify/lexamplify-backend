"""A scripted first-day junior advocate walks the three tasks on a desktop and on a 375 px phone.

At every screen it records objective signs of confusion: no clear title, more than one primary button, nothing to click
(a dead end), controls with no name, sideways scrolling, a page that takes more than 2 seconds to show its first control.
The result is written to docs/WALKTHROUGH.md (with screenshots in docs/screens/). It is a script, not a person: it shows
where a person would be lost, it does not replace watching Mohan use it.
"""
import os
import re
import time

import pytest

from tests.e2e.test_flows_e2e import CONTRACT, _api, _docx_bytes, _seed_firm

DOCS = os.path.join(os.path.dirname(__file__), "..", "..", "docs")
SHOTS = os.path.join(DOCS, "screens")
LOG = []

OBSERVE_JS = r"""
() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const name = (e) => (e.getAttribute('aria-label') || e.textContent || e.getAttribute('title') || (e.labels && e.labels[0] && e.labels[0].textContent) || e.placeholder || '').trim();
  const root = document.querySelector('.dw, .cc, .sp, .state-analyzed-wrap, .upload-grid, .state-scanning-wrap, main') || document.body;
  const controls = [...root.querySelectorAll('button, a[href], input, select, textarea')].filter(vis);
  const primary = [...root.querySelectorAll('.dw-btn.primary, .cc-btn.primary, .btn-primary')].filter(vis);
  const h1 = [...document.querySelectorAll('h1')].filter(vis).map(h => h.textContent.trim())[0] || '';
  return {
    h1, controls: controls.length, primary: primary.map(b => (b.textContent || '').trim().slice(0, 30)),
    unnamed: controls.filter(c => !name(c)).length,
    sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
    badText: /undefined|\[object|Traceback|NaN|\{"error"/.test(document.body.innerText),
  };
}
"""


def observe(page, device, label, shot=True, allow_primary=1):
    t0 = time.time()
    page.wait_for_selector(".dw button, .cc button, .sp a, .upload-grid button, .state-analyzed-wrap button, main button", state="visible", timeout=8000)
    ready_ms = int((time.time() - t0) * 1000)
    o = page.evaluate(OBSERVE_JS)
    issues = []
    if not o["h1"] and "analyzer" not in label.lower():
        issues.append("no clear title")
    if len(o["primary"]) > allow_primary:
        issues.append(f"{len(o['primary'])} primary buttons ({', '.join(o['primary'])})")
    if o["controls"] == 0:
        issues.append("dead end: nothing to click")
    if o["unnamed"]:
        issues.append(f"{o['unnamed']} control(s) without a name")
    if o["sideways"]:
        issues.append("page scrolls sideways")
    if o["badText"]:
        issues.append("raw text on screen (undefined, NaN, object, JSON)")
    if ready_ms > 2000:
        issues.append(f"{ready_ms} ms before the first control appeared")
    if shot:
        os.makedirs(SHOTS, exist_ok=True)
        n = len([x for x in LOG if x["device"] == device]) + 1
        page.screenshot(path=os.path.join(SHOTS, f"walkthrough-{device}-{n:02d}.png"), full_page=True)
    LOG.append({"device": device, "step": label, "title": o["h1"] or "(analyzer screen)", "primary": o["primary"], "ready_ms": ready_ms, "issues": issues})
    return issues


@pytest.mark.parametrize("device,width,height", [("desktop", 1280, 900), ("phone", 375, 812)])
def test_a_first_day_advocate_walks_all_three_tasks(advocate, device, width, height, tmp_path):
    page = advocate
    page.set_viewport_size({"width": width, "height": height})
    _seed_firm(page)
    found = []

    # 1. Draft a document, from a case
    page.goto("/start")
    page.get_by_role("heading", name=re.compile("What would you like")).wait_for()
    found += observe(page, device, "Start", allow_primary=0)
    page.get_by_role("link", name=re.compile("Draft a document")).click()
    page.get_by_role("heading", name="What would you like to draft?").wait_for()
    found += observe(page, device, "Draft: choose a document", allow_primary=0)
    page.get_by_role("button", name=re.compile("Cheque bounce notice")).click()
    page.get_by_role("heading", name=re.compile("add the details")).wait_for()
    found += observe(page, device, "Draft: where do the facts come from")
    page.get_by_role("button", name="From one of my cases").click()
    page.get_by_text("Sundaram Agencies v. Kumar Traders").first.wait_for(timeout=15000)
    found += observe(page, device, "Draft: pick a case")
    page.get_by_role("button", name=re.compile("Sundaram Agencies v. Kumar Traders")).first.click()
    page.get_by_text(re.compile(r"Filled \d+ details? from this case")).wait_for(timeout=15000)
    assert page.locator("#dw-f-sender_name").input_value() == "M/s Sundaram Agencies"
    assert page.locator("#dw-f-drawer_name").input_value() == "M/s Kumar Traders Pvt Ltd"
    found += observe(page, device, "Draft: details filled from the case")
    rest = {"sender_address": "14 Cross Street, Chennai - 600017", "advocate_name": "Adv. Priya Raman", "drawer_address": "Plot 22, Hosur - 635109", "cheque_no": "004817",
            "cheque_date": "12 June 2026", "cheque_amount": "4,75,000", "drawn_bank": "State Bank of India, Hosur", "payee_bank": "HDFC Bank, T. Nagar",
            "presentation_date": "20 June 2026", "return_reason": "Funds insufficient", "return_memo_date": "22 June 2026", "info_received_date": "23 June 2026",
            "debt_nature": "That my client supplied goods under invoice no. 2231.", "notice_date": "30 June 2026"}
    for slot, value in rest.items():
        page.locator(f"#dw-f-{slot}").fill(value)
    page.get_by_role("button", name="Review the draft").click()
    page.get_by_role("heading", name="Check the draft").wait_for()
    found += observe(page, device, "Draft: review")
    page.get_by_role("button", name="Looks good, continue").click()
    page.get_by_role("heading", name="Your draft is ready").wait_for()
    found += observe(page, device, "Draft: download", allow_primary=1)

    # 2. Analyze a contract
    page.goto("/start")
    page.get_by_role("link", name=re.compile("Analyze a contract")).click()
    page.wait_for_url(re.compile("/contract-analyzer"))
    page.locator("input[type=file]").first.wait_for(state="attached")
    found += observe(page, device, "Analyzer: upload", allow_primary=2)
    page.locator("input[type=file]").first.set_input_files({"name": "contract.docx", "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "buffer": _docx_bytes(CONTRACT)})
    page.get_by_role("button", name="Begin analysis").click()
    page.get_by_text("Flagged clauses").first.wait_for(timeout=90000)
    found += observe(page, device, "Analyzer: results", shot=True, allow_primary=6)

    # 3. Check conflicts
    page.goto("/start")
    page.get_by_role("link", name=re.compile("Check conflicts")).click()
    page.get_by_role("heading", name="Check for a conflict of interest").wait_for()
    found += observe(page, device, "Conflicts: the form")
    page.locator("#cc-client").fill("Kumar Traders")
    page.get_by_role("button", name="Check names").click()
    page.get_by_text("Possible conflict").first.wait_for()
    found += observe(page, device, "Conflicts: the answer")

    assert not found, found
    if device == "phone":
        _write_report()


def _write_report():
    os.makedirs(DOCS, exist_ok=True)
    lines = ["# Walkthrough: a first-day junior advocate", "",
             "A script walks Start, then each of the three tasks, on a desktop (1280 px) and a phone (375 px), choosing the obvious action at every screen.",
             "At each screen it records objective signs of confusion: no clear title, more than one primary button, nothing to click, controls with no name, sideways scrolling,",
             "raw text such as `undefined`, and a first control that takes longer than 2 seconds to appear. It is a script, not a person: it finds where a person would be lost; it does not replace watching Mohan use the product.", "",
             f"Screens checked: {len(LOG)}. Screens with a confusion point: {sum(1 for r in LOG if r['issues'])}. Screenshots are in `docs/screens/walkthrough-*.png`.", "",
             "| Device | Screen | Title shown | Primary buttons | First control ready | Confusion points |", "|---|---|---|---|---|---|"]
    for r in LOG:
        lines.append(f"| {r['device']} | {r['step']} | {r['title']} | {', '.join(r['primary']) or 'none'} | {r['ready_ms']} ms | {'; '.join(r['issues']) or 'none'} |")
    many = [r for r in LOG if len(r["primary"]) > 1]
    if many:
        lines += ["", "## Known departure from 'one primary button per screen'", "",
                  "These screens belong to the older Contract Analyzer, which was kept as it was (it is a large screen with its own workbench). The new screens (Start, wizard, conflicts) have one primary button each.", ""]
        lines += [f"- {r['device']}, {r['step']}: {len(r['primary'])} primary buttons ({', '.join(r['primary'])})" for r in many]
    lines += ["", "## What this found while it was being built", "",
              "- The first version of the wizard moved the whole page 16 to 40 px off the left edge on a phone every time it changed step. The cause was the shell's header capsule, which is wider than a phone. Fixed.",
              "- The review preview was unreadable in the dark theme (1.1:1 contrast). Fixed.",
              "- The Start page and wizard had muted text at 2.85:1 contrast. Fixed app-wide through the shared colour tokens.",
              "- A page-wide scroll shift came back whenever focus moved; every page change now moves focus to the new heading without scrolling.", "",
              "## What it cannot tell you", "",
              "Whether the wording of the questions is the wording an advocate would use, whether the draft text is what a court expects, and how long a real person takes. Those need Mohan (see `docs/MOHAN_TEST_CHECKLIST.md`)."]
    with open(os.path.join(DOCS, "WALKTHROUGH.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
