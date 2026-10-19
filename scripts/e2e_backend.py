"""Run the real Flask app against a throw-away database for browser (end-to-end) tests.

    python scripts/e2e_backend.py            # serves on http://localhost:5000 (what the Vite dev proxy expects)

It runs from a temporary working directory, so the legacy relative-path SQLite files (lex_assistant.db etc.) are
created fresh there and the developer's real data is never touched. No AI key is set, so AI calls fail the way they
would with the provider down; the drafting wizard does not need one.
"""
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
work = tempfile.mkdtemp(prefix="lex_e2e_")
os.environ["DATABASE_URL"] = f"sqlite:///{os.path.join(work, 'e2e.db')}"
os.environ["JWT_SECRET_KEY"] = "e2e-only-secret-0123456789abcdef0123456789abcdef"
os.environ["PHONE_OTP_REQUIRED"] = "false"
os.environ["LEGACY_USER_MIGRATION"] = "off"
os.environ["LPMS_SCHEDULER"] = "0"
os.environ["MAX_CONTENT_LENGTH"] = str(100 * 1024 * 1024)
for _name in ("GROQ_API_KEY", "OPENAI_API_KEY", "PINECONE_API_KEY", "PINECONE_HOST", "ZENROWS_API_KEY", "TAVILY_API_KEY"):
    os.environ[_name] = ""     # never use the developer's real keys; empty also stops dotenv refilling them
os.environ.pop("FLASK_ENV", None)
sys.path.insert(0, ROOT)
os.chdir(work)

import app as app_module  # noqa: E402  (after the environment is prepared)



def _install_fake_ai():
    """Deterministic stand-in for the language model so browser tests can walk the analyzer end to end.
    It flags two real sentences, always adds one made-up finding (which the grounding check must drop), and fails
    on text containing [[AI-DOWN]] to exercise the honest-failure path."""
    import re
    import routes.contract_routes as cr
    import utils.ai_helper as ah

    def fake_chunk(chunk, strategy="Defensive", **kw):
        if "[[AI-DOWN]]" in chunk:
            raise RuntimeError("simulated provider outage")
        found = []
        for pat, title, level in ((r"[^.\n]*without notice[^.\n]*\.", "Termination without notice", "High"), (r"[^.\n]*24% per month[^.\n]*\.", "Excessive interest", "Medium")):
            m = re.search(pat, chunk)
            if m:
                found.append({"title": title, "original_text": m.group(0).strip(), "risk_level": level, "explanation": "Simulated finding for browser tests.",
                              "location": "Clause", "playbook_rule": "Indian Contract Act, 1872", "suggested_revision": "Either party may terminate on 30 days written notice."})
        found.append({"title": "Invented finding", "original_text": "The Contractor shall indemnify the Client without any limit whatsoever for every loss.",
                      "risk_level": "High", "explanation": "Not in the document.", "location": "Clause 9", "playbook_rule": "x", "suggested_revision": "y"})
        return {"summary": "A service agreement between two companies.", "clauses": found}

    def fake_ask(*a, **k):
        raise RuntimeError("no model in browser tests")

    cr.analyze_contract_with_llm = fake_chunk
    ah.ask_groq = fake_ask


if os.environ.get("E2E_FAKE_AI", "1") == "1":
    _install_fake_ai()

app_module.init_db()
flask_app = app_module.create_app()
from utils.limiter import limiter  # noqa: E402

limiter.enabled = os.environ.get("E2E_LIMITS", "") == "1"
print(f"[e2e] working directory {work}", flush=True)
flask_app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5000")), threaded=True, use_reloader=False)
