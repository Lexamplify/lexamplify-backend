"""Shared helpers: an isolated real app (throw-away SQLite) and signed-in clients that send the CSRF header."""
import os
import sys
from pathlib import Path

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


REPO = Path(__file__).resolve().parents[1]


class UnsafeAppSetup(AssertionError):
    """The app was about to be built where it could read or write the developer's real data."""


def _norm(path):
    return os.path.normcase(os.path.realpath(str(path)))


def _inside_repo(path):
    p, r = _norm(path), _norm(REPO)
    return p == r or p.startswith(r + os.sep)


def _isolate_paths(monkeypatch, tmp):
    """Point the three data paths that are built from __file__ (so a changed working folder does not move them) at files inside
    tmp. monkeypatch undoes it after the test. raising=True: if a name is ever renamed, the test fails instead of silently
    going back to the real file."""
    tmp = Path(tmp)
    import routes.court_routes as court_routes
    import services.legacy_user_migration as legacy
    monkeypatch.setattr(court_routes, "_DB_PATH", str(tmp / "instance" / "client_data.db"), raising=True)
    monkeypatch.setattr(court_routes, "_BAR_ASSOC_JSON", str(tmp / "instance" / "bar_associations.json"), raising=True)
    monkeypatch.setattr(legacy, "_LEGACY_DB_PATH", str(tmp / "lex_assistant.db"), raising=True)
    return court_routes, legacy


def _check_database_url(url):
    """Refuse anything that is not a SQLite file outside the repo. A RELATIVE sqlite path is refused too: Flask-SQLAlchemy 3
    resolves it against the app's instance/ folder inside the repo, whatever the working folder is."""
    url = (url or "").strip()
    if not url:
        # Unset means the app's own default, sqlite:///database.db = <repo>/instance/database.db. The only safe case is a
        # production-mode start, which refuses to run (app.py, "Refusing to start") before it opens anything.
        if os.environ.get("FLASK_ENV") == "production" or os.environ.get("RENDER") == "true":
            return
        raise UnsafeAppSetup("DATABASE_URL is empty: the app would fall back to the real instance/database.db")
    if url.lower() == "sqlite://":
        return                                              # in memory
    if not url.lower().startswith("sqlite:///"):
        raise UnsafeAppSetup(f"DATABASE_URL is not a plain sqlite URL (scheme {url.split(':', 1)[0]!r}): refusing to build the app")
    path = url[len("sqlite:///"):].split("?", 1)[0]
    if path in ("", ":memory:"):
        return
    if not os.path.isabs(path):
        raise UnsafeAppSetup(f"DATABASE_URL has a relative sqlite path ({path!r}); it would resolve inside the repo's instance/ folder")
    if _inside_repo(path):
        raise UnsafeAppSetup(f"DATABASE_URL points inside the repo: {path}")


def create_app_here(app_module=None, monkeypatch=None):
    """Build the real app from the CURRENT working folder, after checking that nothing it can reach is in the repo.

    For tests that must call create_app themselves (start-up checks, module-scoped fixtures). The test sets its own folder and
    environment first (chdir into a temp folder, DATABASE_URL, ...); this redirects the __file__-based paths, checks everything,
    and only then builds the app. Pass the test's own module object (it may have been importlib.reload()ed) and its monkeypatch."""
    if app_module is None:
        import app as app_module                            # looked up now, never at import time: tests reload `app`
    if monkeypatch is None:
        raise TypeError("create_app_here needs the test's monkeypatch, so the path redirects are undone after the test")
    if getattr(app_module, "__name__", None) == "app" and sys.modules.get("app") is not app_module:
        raise UnsafeAppSetup("the module passed in is not sys.modules['app']")
    cwd = os.getcwd()
    if _inside_repo(cwd):
        raise UnsafeAppSetup(f"working folder is inside the repo ({cwd}): the app would open lex_assistant.db and instance/ there")
    court_routes, legacy = _isolate_paths(monkeypatch, cwd)
    _check_database_url(os.environ.get("DATABASE_URL"))
    for label, value in (("routes.court_routes._DB_PATH", court_routes._DB_PATH),
                         ("routes.court_routes._BAR_ASSOC_JSON", court_routes._BAR_ASSOC_JSON),
                         ("services.legacy_user_migration._LEGACY_DB_PATH", legacy._LEGACY_DB_PATH)):
        if _inside_repo(value):
            raise UnsafeAppSetup(f"{label} is inside the repo: {value}")
    return app_module.create_app()


def make_app(tmp_path, monkeypatch, name="t.db"):
    """An isolated real app. It runs from tmp_path, because parts of the app open lex_assistant.db / instance/ relative to
    the working directory (the Practice module among them): without this, tests would read and write the developer's data."""
    import app as app_module
    monkeypatch.chdir(tmp_path)
    from utils import tenancy
    tenancy.reset_cache()
    monkeypatch.setenv("LPMS_SCHEDULER", "0")
    monkeypatch.setenv("LEGACY_USER_MIGRATION", "off")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / name}")
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret-key-for-engine-tests-0123456789ab")
    monkeypatch.setenv("PHONE_OTP_REQUIRED", "false")
    for name in ("GROQ_API_KEY", "OPENAI_API_KEY", "PINECONE_API_KEY", "PINECONE_HOST", "ZENROWS_API_KEY", "TAVILY_API_KEY"):
        monkeypatch.setenv(name, "")      # empty (not deleted): python-dotenv would refill a deleted one from .env
    monkeypatch.setenv("MAX_CONTENT_LENGTH", str(100 * 1024 * 1024))   # a developer .env may set a smaller cap
    # A developer .env can set these to real, absolute places; each is read by the app (app.py, utils/dms_store.py,
    # utils/local_search.py, routes/court_routes.py). Empty PERSISTENT_DATA_DIR / ADMIN_SYNC_TOKEN count as unset.
    monkeypatch.setenv("PERSISTENT_DATA_DIR", "")
    monkeypatch.setenv("ADMIN_SYNC_TOKEN", "")
    monkeypatch.setenv("DMS_STORAGE_DIR", str(tmp_path / "instance" / "dms_files"))
    monkeypatch.setenv("UPLOAD_FOLDER", str(tmp_path / "static" / "uploads"))
    monkeypatch.setenv("CHROMA_PATH", str(tmp_path / "chroma_data"))
    if "utils.local_search" in sys.modules:                  # CHROMA_PATH is read once, when that module is first imported
        monkeypatch.setattr(sys.modules["utils.local_search"], "CHROMA_PATH", str(tmp_path / "chroma_data"), raising=True)
    flask_app = create_app_here(app_module, monkeypatch)
    flask_app.config.update(TESTING=True)
    from utils.limiter import limiter
    limiter.enabled = False
    return flask_app


def register(flask_app, email, password="TestPass123!", name="Test User"):
    c = flask_app.test_client()
    r = c.post("/api/auth/register", json={"email": email, "password": password, "name": name})
    assert r.status_code == 201, r.get_json()
    return SignedIn(c, email)
