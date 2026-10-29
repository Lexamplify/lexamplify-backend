"""The isolation helpers themselves: make_app / create_app_here must keep every data path out of the repo, refuse to build the
app when they cannot, and give everything back after the test.

Nothing here can touch real data: the tripwire tests use a stub in place of the app, and the app builds run in a temp folder.
"""
import os
import types
from pathlib import Path

import pytest

from tests.helpers_app import REPO, UnsafeAppSetup, create_app_here, make_app, register


def _inside(path):
    p = os.path.normcase(os.path.realpath(str(path)))
    r = os.path.normcase(os.path.realpath(str(REPO)))
    return p == r or p.startswith(r + os.sep)


def _db_file(url):
    assert url.startswith("sqlite:///"), url
    return url[len("sqlite:///"):]


def _stub():
    calls = []
    return types.SimpleNamespace(create_app=lambda: calls.append("called")), calls


# ── part a: after make_app / create_app_here everything the app can reach is outside the repo ──────────────────────
def _assert_all_outside_the_repo():
    import routes.court_routes as court_routes
    import services.legacy_user_migration as legacy
    assert not _inside(os.getcwd()), os.getcwd()
    assert not _inside(_db_file(os.environ["DATABASE_URL"])), os.environ["DATABASE_URL"]
    assert not _inside(court_routes._DB_PATH), court_routes._DB_PATH
    assert not _inside(court_routes._BAR_ASSOC_JSON), court_routes._BAR_ASSOC_JSON
    assert not _inside(legacy._LEGACY_DB_PATH), legacy._LEGACY_DB_PATH


def test_make_app_keeps_every_data_path_outside_the_repo(tmp_path, monkeypatch):
    make_app(tmp_path, monkeypatch)
    _assert_all_outside_the_repo()
    for name in ("DMS_STORAGE_DIR", "UPLOAD_FOLDER", "CHROMA_PATH"):
        assert not _inside(os.environ[name]), (name, os.environ[name])
    assert os.environ["PERSISTENT_DATA_DIR"] == "" and os.environ["ADMIN_SYNC_TOKEN"] == ""


def test_the_court_routes_write_into_the_temp_folder_not_the_repo(tmp_path, monkeypatch):
    flask_app = make_app(tmp_path, monkeypatch)
    advocate = register(flask_app, "court@example.com")
    r = advocate.get("/api/court-bar-associations")          # seeds from the built-in list, no network
    assert r.status_code == 200 and r.get_json()["bar_associations"]
    assert (tmp_path / "instance" / "client_data.db").is_file()


def test_create_app_here_builds_a_real_app_from_the_temp_folder(tmp_path, monkeypatch):
    import app as app_module
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'h.db'}")
    monkeypatch.setenv("JWT_SECRET_KEY", "test-secret-key-for-the-isolation-tests-0123456789")
    monkeypatch.setenv("LPMS_SCHEDULER", "0")
    monkeypatch.setenv("LEGACY_USER_MIGRATION", "off")
    monkeypatch.setenv("PERSISTENT_DATA_DIR", "")
    monkeypatch.setenv("DMS_STORAGE_DIR", str(tmp_path / "files"))
    monkeypatch.setenv("UPLOAD_FOLDER", str(tmp_path / "uploads"))
    flask_app = create_app_here(app_module, monkeypatch)
    assert flask_app.url_map.iter_rules()
    _assert_all_outside_the_repo()
    assert (tmp_path / "lex_assistant.db").is_file()          # the app opened its own database in the temp folder


def test_the_redirects_are_undone_after_the_test(tmp_path):
    import routes.court_routes as court_routes
    import services.legacy_user_migration as legacy
    before = (court_routes._DB_PATH, court_routes._BAR_ASSOC_JSON, legacy._LEGACY_DB_PATH, os.getcwd())
    mp = pytest.MonkeyPatch()
    try:
        make_app(tmp_path, mp)
        assert (court_routes._DB_PATH, court_routes._BAR_ASSOC_JSON, legacy._LEGACY_DB_PATH) != before[:3]
    finally:
        mp.undo()
    assert (court_routes._DB_PATH, court_routes._BAR_ASSOC_JSON, legacy._LEGACY_DB_PATH, os.getcwd()) == before


# ── part b: the tripwire stops the build BEFORE create_app is called ───────────────────────────────────────────────
def test_it_refuses_when_the_working_folder_is_inside_the_repo(monkeypatch):
    stub, calls = _stub()
    monkeypatch.chdir(REPO)
    with pytest.raises(UnsafeAppSetup, match="working folder is inside the repo"):
        create_app_here(stub, monkeypatch)
    assert calls == []


@pytest.mark.parametrize("url", ["postgresql://user:pw@db.invalid/neon", "postgres://user:pw@db.invalid/neon",
                                 "postgresql+psycopg2://user:pw@db.invalid/neon", "mysql://u:p@db.invalid/x", "not a url"])
def test_it_refuses_a_database_that_is_not_a_plain_sqlite_file(tmp_path, monkeypatch, url):
    stub, calls = _stub()
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATABASE_URL", url)
    with pytest.raises(UnsafeAppSetup, match="not a plain sqlite URL"):
        create_app_here(stub, monkeypatch)
    assert calls == []


def test_it_refuses_a_relative_or_in_repo_sqlite_path_and_an_empty_url(tmp_path, monkeypatch):
    stub, calls = _stub()
    monkeypatch.chdir(tmp_path)
    for url, why in (("sqlite:///database.db", "relative sqlite path"),
                     (f"sqlite:///{REPO / 'instance' / 'client_data.db'}", "points inside the repo"),
                     ("", "DATABASE_URL is empty")):
        monkeypatch.setenv("DATABASE_URL", url)
        monkeypatch.delenv("FLASK_ENV", raising=False)
        monkeypatch.delenv("RENDER", raising=False)
        with pytest.raises(UnsafeAppSetup, match=why):
            create_app_here(stub, monkeypatch)
    monkeypatch.delenv("DATABASE_URL")
    with pytest.raises(UnsafeAppSetup, match="DATABASE_URL is empty"):
        create_app_here(stub, monkeypatch)
    assert calls == []


def test_an_empty_database_url_is_allowed_only_for_a_production_start(tmp_path, monkeypatch):
    stub, calls = _stub()
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATABASE_URL", "")
    monkeypatch.setenv("FLASK_ENV", "production")           # the real app refuses to start here, before it opens anything
    create_app_here(stub, monkeypatch)
    assert calls == ["called"]


def test_it_refuses_a_module_that_is_not_the_live_app_module(tmp_path, monkeypatch):
    calls = []
    impostor = types.SimpleNamespace(__name__="app", create_app=lambda: calls.append("called"))
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'x.db'}")
    with pytest.raises(UnsafeAppSetup, match="not sys.modules"):
        create_app_here(impostor, monkeypatch)
    assert calls == []


def test_it_needs_the_tests_own_monkeypatch(tmp_path, monkeypatch):
    stub, calls = _stub()
    monkeypatch.chdir(tmp_path)
    with pytest.raises(TypeError):
        create_app_here(stub)
    assert calls == []


def test_a_safe_setup_does_reach_create_app(tmp_path, monkeypatch):
    stub, calls = _stub()
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'ok.db'}")
    create_app_here(stub, monkeypatch)
    assert calls == ["called"]
    assert Path(os.getcwd()).resolve() == tmp_path.resolve()
