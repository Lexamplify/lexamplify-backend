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
os.environ["MAX_CONTENT_LENGTH"] = str(100 * 1024 * 1024)
os.environ.pop("GROQ_API_KEY", None)
os.environ.pop("FLASK_ENV", None)
sys.path.insert(0, ROOT)
os.chdir(work)

import app as app_module  # noqa: E402  (after the environment is prepared)

app_module.init_db()
flask_app = app_module.create_app()
from utils.limiter import limiter  # noqa: E402

limiter.enabled = os.environ.get("E2E_LIMITS", "") == "1"
print(f"[e2e] working directory {work}", flush=True)
flask_app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5000")), threaded=True, use_reloader=False)
