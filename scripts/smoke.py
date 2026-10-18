"""Smoke test for a deployed (or local) LexAmplify API: sign in, check health, draft a notice, export it, make a draft and delete it.

    set SMOKE_EMAIL=you@example.com
    set SMOKE_PASSWORD=your password
    python scripts/smoke.py https://api.lexamplify.com

The password is read from the environment only (never from the command line, so it is not left in shell history).
Use an account made for this purpose. The script creates one throw-away draft and deletes it again; it changes nothing else.
For a local backend only, `--register` creates the test account first (refused for any other address).

Exit code 0 = every check passed, 1 = something failed (each failure says what to look at).
"""
import os
import sys
import time
import uuid

import requests

FACTS = {
    "sender_name": "M/s Smoke Test Agencies", "sender_address": "1 Test Road, Chennai - 600001", "advocate_name": "Adv. Smoke Tester",
    "drawer_name": "M/s Example Traders Pvt Ltd", "drawer_address": "2 Sample Street, Hosur - 635109", "cheque_no": "123456",
    "cheque_date": "12 June 2026", "cheque_amount": "100000", "drawn_bank": "State Bank of India, Hosur Main Branch",
    "payee_bank": "HDFC Bank, T. Nagar", "presentation_date": "20 June 2026", "return_reason": "Funds insufficient",
    "return_memo_date": "22 June 2026", "info_received_date": "23 June 2026", "debt_nature": "That goods were supplied under invoice no. 1.",
    "notice_date": "30 June 2026",
}


class Smoke:
    def __init__(self, base):
        self.base = base.rstrip("/")
        self.s = requests.Session()
        self.failures = []

    def step(self, name, fn):
        t0 = time.time()
        try:
            fn()
            print(f"  PASS  {name}  ({time.time() - t0:.1f}s)")
        except Exception as exc:  # noqa: BLE001
            self.failures.append(name)
            print(f"  FAIL  {name}: {exc}")

    def url(self, path):
        return self.base + path

    def headers(self):
        token = self.s.cookies.get("csrf_access_token")
        return {"X-CSRF-TOKEN": token} if token else {}

    def get(self, path, **kw):
        return self.s.get(self.url(path), timeout=60, **kw)

    def post(self, path, **kw):
        return self.s.post(self.url(path), headers=self.headers(), timeout=90, **kw)

    def delete(self, path):
        return self.s.delete(self.url(path), headers=self.headers(), timeout=60)


def expect(r, *codes):
    assert r.status_code in codes, f"HTTP {r.status_code}: {r.text[:200]}"
    return r


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    base = argv[1]
    local = base.startswith(("http://127.0.0.1", "http://localhost"))
    email, password = os.environ.get("SMOKE_EMAIL", ""), os.environ.get("SMOKE_PASSWORD", "")
    sm = Smoke(base)
    print(f"Smoke test against {sm.base}")
    if "--register" in argv:
        if not local:
            print("--register is only allowed for a local address.")
            return 2
        email, password = f"smoke{uuid.uuid4().hex[:8]}@example.com", "SmokePass123!"
        expect(sm.s.post(sm.url("/api/auth/register"), json={"email": email, "password": password, "name": "Smoke Tester"}, timeout=60), 201)
    if not email or not password:
        print("Set SMOKE_EMAIL and SMOKE_PASSWORD (an account made for testing).")
        return 2

    state = {}
    sm.step("server answers /api/ping and the database replied", lambda: expect(sm.get("/api/ping"), 200) and state.update(ping=sm.get("/api/ping").json()))
    sm.step("sign in", lambda: expect(sm.s.post(sm.url("/api/auth/login"), json={"email": email, "password": password}, timeout=60), 200))
    sm.step("signed-in status is healthy", lambda: (lambda r: (expect(r, 200), state.update(status=r.json())))(sm.get("/api/status")))
    sm.step("signed-out requests are refused", lambda: expect(requests.get(sm.url("/api/drafts/types"), timeout=30), 401))
    sm.step("document types are listed", lambda: (lambda r: (expect(r, 200), (_ for _ in ()).throw(AssertionError("no s.138 type")) if not any(t["id"] == "notice_138" for t in r.json()["types"]) else None))(sm.get("/api/drafts/types")))

    def render():
        r = expect(sm.post("/api/drafts/render", json={"type": "notice_138", "facts": FACTS}), 200)
        doc = r.json()
        assert not doc["unresolved"], f"unresolved details: {doc['unresolved']}"
        text = " ".join(b.get("text", "") for b in doc["blocks"])
        assert "₹1,00,000" in text and "Rupees One Lakh Only" in text, "amount or amount in words missing"
        state["doc"] = doc
    sm.step("a notice is drafted from the details, none invented", render)

    def export(fmt, magic):
        r = expect(sm.post("/api/drafts/export", json={"document": state["doc"], "format": fmt}), 200)
        assert r.content[:len(magic)] == magic, f"not a real {fmt} file"
        assert r.headers.get("X-Unresolved-Count") == "0"
    sm.step("Word export", lambda: export("docx", b"PK"))
    sm.step("PDF export", lambda: export("pdf", b"%PDF-"))

    def session():
        r = expect(sm.post("/api/drafts/sessions", json={"type": "notice_138", "facts": {"sender_name": "Smoke"}, "title": "Smoke test draft"}), 201)
        sid = r.json()["id"]
        expect(sm.s.put(sm.url(f"/api/drafts/sessions/{sid}"), json={"facts": FACTS}, headers=sm.headers(), timeout=60), 200)
        expect(sm.delete(f"/api/drafts/sessions/{sid}"), 200)
    sm.step("a draft can be saved, updated and deleted", session)
    sm.step("conflict check answers (200, or a plain 'set up your practice' 403)", lambda: expect(sm.post("/api/practice/conflicts/check", json={"client_name": "Smoke Test"}), 200, 403))
    sm.step("own activity is listed", lambda: expect(sm.get("/api/audit/me"), 200))
    sm.step("sign out", lambda: expect(sm.s.post(sm.url("/api/auth/logout"), timeout=30), 200))
    sm.step("a signed-out session is really signed out", lambda: expect(sm.get("/api/drafts/types"), 401))

    print()
    if sm.failures:
        print(f"{len(sm.failures)} check(s) FAILED: {', '.join(sm.failures)}")
        return 1
    ai = (state.get("status") or {}).get("checks", {}).get("ai_configured")
    print("All checks passed." + (f" (AI configured on the server: {ai})" if ai else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
