"""Browser (Playwright) tests against the REAL backend and the built frontend.

Starts scripts/e2e_backend.py (throw-away database, no AI key) on :5000 and `vite preview` of frontend/dist on :5199
(its proxy sends /api to :5000, exactly like production's same-origin cookies). Skipped when the build, the browser or
the ports are not available, and with E2E_SKIP=1.
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FRONT = os.path.join(ROOT, "frontend")
BACK_PORT, FRONT_PORT = 5000, 5199
BASE = f"http://localhost:{FRONT_PORT}"


def _port_free(port):
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", port)) != 0


def _wait(url, seconds=60):
    end = time.time() + seconds
    while time.time() < end:
        try:
            urllib.request.urlopen(url, timeout=3)
            return True
        except Exception:  # noqa: BLE001
            time.sleep(0.5)
    return False


@pytest.hookimpl(tryfirst=True, hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    setattr(item, "rep_" + call.when, outcome.get_result())


ARTIFACTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_artifacts")


def _build_e2e_bundle(npx):
    """Build the frontend with an EMPTY API base so every call is same-origin (and goes through the preview proxy to the
    throw-away backend). The normal build bakes in the production API address, which tests must never talk to."""
    out = os.path.join(FRONT, "dist-e2e")
    newest_src = max(os.path.getmtime(os.path.join(d, f)) for d, _, fs in os.walk(os.path.join(FRONT, "src")) for f in fs)
    index = os.path.join(out, "index.html")
    if os.path.isfile(index) and os.path.getmtime(index) > newest_src and os.environ.get("E2E_REBUILD") != "1":
        return
    env = {**os.environ, "VITE_API_BASE_URL": ""}
    r = subprocess.run([npx, "vite", "build", "--outDir", "dist-e2e", "--emptyOutDir"], cwd=FRONT, env=env,
                       capture_output=True, text=True, shell=(os.name == "nt"))
    assert r.returncode == 0, r.stdout[-2000:] + r.stderr[-2000:]


@pytest.fixture(scope="session")
def stack():
    if os.environ.get("E2E_SKIP") == "1":
        pytest.skip("E2E_SKIP=1")
    npx = shutil.which("npx") or shutil.which("npx.cmd")
    if not npx:
        pytest.skip("npx not found")
    _build_e2e_bundle(npx)
    if not (_port_free(BACK_PORT) and _port_free(FRONT_PORT)):
        pytest.skip(f"ports {BACK_PORT}/{FRONT_PORT} are busy")
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            p.chromium.launch().close()
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"Playwright Chromium is not installed: {exc}")
    env = {**os.environ, "PORT": str(BACK_PORT), "E2E_LIMITS": os.environ.get("E2E_LIMITS", "")}
    back = subprocess.Popen([sys.executable, os.path.join(ROOT, "scripts", "e2e_backend.py")], cwd=ROOT, env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    front = subprocess.Popen([npx, "vite", "preview", "--outDir", "dist-e2e", "--port", str(FRONT_PORT), "--strictPort"], cwd=FRONT, env=os.environ,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, shell=(os.name == "nt"))
    try:
        if not (_wait(f"http://127.0.0.1:{BACK_PORT}/api/ping") and _wait(BASE + "/")):
            pytest.fail("the e2e stack did not start")
        yield BASE
    finally:
        for proc in (front, back):
            try:
                if os.name == "nt":
                    subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True)
                else:
                    proc.terminate()
            except Exception:  # noqa: BLE001
                pass


@pytest.fixture(scope="session")
def browser(stack):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


@pytest.fixture()
def advocate(browser, stack, request):
    """A fresh signed-in advocate in a new browser context; console errors and failed requests are collected."""
    ctx = browser.new_context(base_url=stack, viewport={"width": 1280, "height": 900}, accept_downloads=True)
    email = f"adv{int(time.time() * 1000)}{abs(hash(request.node.name)) % 1000}@example.com"
    r = ctx.request.post("/api/auth/register", data={"email": email, "password": "TestPass123!", "name": "Priya Raman"})
    assert r.status == 201, r.text()
    # Run under the CSP that firebase.json deploys, so a policy that would break the app fails here, not in production.
    csp = json.load(open(os.path.join(ROOT, "firebase.json"), encoding="utf-8"))["hosting"]["headers"][0]["headers"]
    csp = next(h["value"] for h in csp if h["key"] == "Content-Security-Policy")

    def add_csp(route):
        resp = route.fetch()
        headers = {**resp.headers, "content-security-policy": csp}
        route.fulfill(response=resp, headers=headers)
    ctx.route("**/*", lambda route: add_csp(route) if route.request.resource_type == "document" else route.continue_())
    ctx.add_init_script("document.addEventListener('securitypolicyviolation', e => { (window.__csp = window.__csp || []).push(e.violatedDirective + ' ' + e.blockedURI); });")
    page = ctx.new_page()
    page.email = email
    page.console_errors, page.bad_responses = [], []
    page.on("console", lambda m: page.console_errors.append(m.text) if m.type == "error" else None)
    page.on("response", lambda resp: page.bad_responses.append(f"{resp.status} {resp.url}") if resp.status >= 500 else None)
    page.on("pageerror", lambda e: page.console_errors.append(f"pageerror: {e}"))
    yield page
    try:
        violations = page.evaluate("window.__csp || []")
    except Exception:  # noqa: BLE001 - the page may have been closed by the test
        violations = []
    assert not violations, f"Content-Security-Policy violations: {violations}"
    rep = getattr(request.node, "rep_call", None)
    if rep is not None and rep.failed:
        try:
            os.makedirs(ARTIFACTS, exist_ok=True)
            safe = "".join(c if c.isalnum() else "_" for c in request.node.name)[:80]
            page.screenshot(path=os.path.join(ARTIFACTS, safe + ".png"), full_page=True)
            with open(os.path.join(ARTIFACTS, safe + ".txt"), "w", encoding="utf-8") as fh:
                fh.write(f"URL: {page.url}\nconsole errors: {page.console_errors}\nbad responses: {page.bad_responses}\n\n")
                fh.write(page.locator("body").inner_text()[:4000])
        except Exception:  # noqa: BLE001
            pass
    ctx.close()
