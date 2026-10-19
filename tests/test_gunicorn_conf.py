"""The server must use threaded workers: a plain worker is killed after 30 s, taking running analyses with it."""
import importlib.util
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load():
    spec = importlib.util.spec_from_file_location("gunicorn_conf_under_test", os.path.join(ROOT, "gunicorn.conf.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_workers_are_threaded_and_not_killed_by_a_slow_request():
    conf = _load()
    assert conf.worker_class == "gthread" and conf.threads >= 4 and conf.timeout >= 120 and conf.workers >= 1


def test_the_settings_can_be_changed_from_the_environment(monkeypatch):
    monkeypatch.setenv("GUNICORN_THREADS", "16")
    monkeypatch.setenv("WEB_CONCURRENCY", "2")
    conf = _load()
    assert conf.threads == 16 and conf.workers == 2
