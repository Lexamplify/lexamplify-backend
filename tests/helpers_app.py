"""Shared helpers: an isolated real app (throw-away SQLite) and signed-in clients that send the CSRF header."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)


class SignedIn:
    """A browser-like client: cookies persist, mutating calls carry the CSRF header from the cookie."""

    def __init__(self, client, email):
        self.c = client
        self.email = email

    def _csrf(self):
        ck = self.c.get_cookie("csrf_access_token")
        return {"X-CSRF-TOKEN": ck.value} if ck else {}

    def _h(self, kw):
        kw["headers"] = {**self._csrf(), **kw.get("headers", {})}
        return kw

    def get(self, *a, **kw):
        return self.c.get(*a, **kw)

    def post(self, *a, **kw):
        return self.c.post(*a, **self._h(kw))

    def put(self, *a, **kw):
        return self.c.put(*a, **self._h(kw))

    def patch(self, *a, **kw):
        return self.c.patch(*a, **self._h(kw))

    def delete(self, *a, **kw):
        return self.c.delete(*a, **self._h(kw))


def make_app(tmp_path, monkeypatch, name="t.db"):
    """An isolated real app. It runs from tmp_path, because parts of the app open lex_assistant.db / instance/ relative to
    the working directory (the Practice module among them): without this, tests would read and write the developer's data."""
    import app as app_module
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("LPMS_SCHEDULER", "0")
    monkeypatch.setenv("LEGACY_USER_MIGRATION", "off")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / name}")
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret-key-for-engine-tests-0123456789ab")
    monkeypatch.setenv("PHONE_OTP_REQUIRED", "false")
    for name in ("GROQ_API_KEY", "OPENAI_API_KEY", "PINECONE_API_KEY", "PINECONE_HOST", "ZENROWS_API_KEY", "TAVILY_API_KEY"):
        monkeypatch.setenv(name, "")      # empty (not deleted): python-dotenv would refill a deleted one from .env
    monkeypatch.setenv("MAX_CONTENT_LENGTH", str(100 * 1024 * 1024))   # a developer .env may set a smaller cap
    flask_app = app_module.create_app()
    flask_app.config.update(TESTING=True)
    from utils.limiter import limiter
    limiter.enabled = False
    return flask_app


def register(flask_app, email, password="TestPass123!", name="Test User"):
    c = flask_app.test_client()
    r = c.post("/api/auth/register", json={"email": email, "password": password, "name": name})
    assert r.status_code == 201, r.get_json()
    return SignedIn(c, email)
