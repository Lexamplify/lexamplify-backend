"""Operations: request ids, one error envelope, refusing weak production config, status, and the audit trail."""
import csv
import io
import re

import pytest

from tests.helpers_app import make_app, register


@pytest.fixture()
def world(tmp_path, monkeypatch):
    flask_app = make_app(tmp_path, monkeypatch)
    return flask_app, register(flask_app, "a@example.com"), register(flask_app, "b@example.com"), monkeypatch


def test_every_response_carries_a_request_id_and_a_callers_id_is_kept_but_cleaned(world):
    flask_app, a, _b, _mp = world
    assert re.fullmatch(r"[0-9a-f]{12}", a.get("/api/drafts/types").headers["X-Request-ID"])
    assert flask_app.test_client().get("/api/drafts/types").headers["X-Request-ID"]          # even a 401
    r = a.get("/api/drafts/types", headers={"X-Request-ID": "trace-123"})
    assert r.headers["X-Request-ID"] == "trace-123"
    r = a.get("/api/drafts/types", headers={"X-Request-ID": "x\"><script>alert(1)</script>" + "A" * 200})
    rid = r.headers["X-Request-ID"]
    assert re.fullmatch(r"[A-Za-z0-9\-]{1,40}", rid) and "<" not in rid and "script" in rid.lower()


def test_errors_use_one_envelope_and_never_carry_internals(world):
    flask_app, a, _b, mp = world
    r = a.get("/api/does-not-exist")
    body = r.get_json()
    assert r.status_code == 404 and body["code"] == "HTTP_404" and body["message"] and body["request_id"] == r.headers["X-Request-ID"]
    r = a.post("/api/drafts/types", json={})
    assert r.status_code == 405 and r.get_json()["code"] == "HTTP_405"

    def boom():
        raise RuntimeError("secret internal detail: /srv/app/db.py line 42 password=hunter2")
    mp.setitem(flask_app.view_functions, "drafts.types", boom)
    r = a.get("/api/drafts/types")
    body = r.get_json()
    assert r.status_code == 500 and body["code"] == "SERVER_ERROR" and body["request_id"]
    assert "hunter2" not in r.get_data(as_text=True) and "db.py" not in r.get_data(as_text=True) and "Server error:" not in r.get_data(as_text=True)


def test_rate_limit_answers_in_plain_words_with_retry_after(tmp_path, monkeypatch):
    flask_app = make_app(tmp_path, monkeypatch)
    from utils.limiter import limiter
    limiter.enabled = True
    try:
        c = flask_app.test_client()
        last = None
        for _ in range(25):
            last = c.post("/api/auth/login", json={"email": "nobody@example.com", "password": "wrong-password-1"})
            if last.status_code == 429:
                break
        assert last.status_code == 429
        body = last.get_json()
        assert body["code"] == "RATE_LIMITED" and "too quickly" in body["message"] and "Traceback" not in str(body)
    finally:
        limiter.enabled = False


def test_production_refuses_to_start_with_weak_or_missing_secrets(tmp_path, monkeypatch):
    import app as app_module
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("FLASK_ENV", "production")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'x.db'}")
    monkeypatch.setenv("JWT_SECRET_KEY", "changeme")
    with pytest.raises(RuntimeError, match="JWT_SECRET_KEY is too short or guessable"):
        app_module.create_app()
    monkeypatch.setenv("JWT_SECRET_KEY", "a" * 31)
    with pytest.raises(RuntimeError, match="too short"):
        app_module.create_app()
    monkeypatch.setenv("JWT_SECRET_KEY", "k" * 48)
    monkeypatch.setenv("DATABASE_URL", "")
    with pytest.raises(RuntimeError, match="DATABASE_URL is not set"):
        app_module.create_app()


def test_status_needs_sign_in_and_reports_the_database(world):
    flask_app, a, _b, _mp = world
    assert flask_app.test_client().get("/api/status").status_code == 401
    r = a.get("/api/status")
    body = r.get_json()
    assert r.status_code == 200 and body["ok"] is True and body["checks"]["database"] == "ok" and body["checks"]["ai_configured"] == "no"
    assert "responses_2xx" in body["metrics"]["counts"] and "restart" in body["note"].lower()
    assert "secret" not in str(body).lower() and "password" not in str(body).lower()


def test_audit_records_sign_ins_failures_exports_and_deletions_per_user(world):
    flask_app, a, b, _mp = world
    c = flask_app.test_client()
    c.post("/api/auth/login", json={"email": "a@example.com", "password": "TestPass123!"})
    c.post("/api/auth/login", json={"email": "a@example.com", "password": "WrongPass999!"})
    s = a.post("/api/drafts/sessions", json={"type": "notice_138", "facts": {}}).get_json()
    doc = a.post("/api/drafts/render", json={"type": "notice_138", "facts": {}}).get_json()
    a.post("/api/drafts/export", json={"document": doc, "format": "docx"})
    a.delete(f"/api/drafts/sessions/{s['id']}")
    mine = a.get("/api/audit/me").get_json()["events"]
    actions = [e["action"] for e in mine]
    assert {"register", "login", "draft_started", "draft_exported", "draft_deleted"} <= set(actions)
    assert any(e["action"] == "draft_exported" and "docx" in e["detail"] for e in mine)
    assert all(e["at"].endswith("Z") for e in mine)
    assert "login_failed" not in actions                          # a failed sign-in has no user to attach to
    assert not [e for e in b.get("/api/audit/me").get_json()["events"] if e["action"] in ("draft_exported", "draft_started", "draft_deleted")]


def test_failed_sign_ins_are_recorded_without_a_password(world):
    flask_app, a, _b, _mp = world
    from models.audit_event import AuditEvent
    flask_app.test_client().post("/api/auth/login", json={"email": "a@example.com", "password": "SuperSecretWrong1!"})
    with flask_app.app_context():
        rows = AuditEvent.query.filter_by(action="login_failed").all()
        assert rows and rows[-1].detail == "a@example.com" and rows[-1].user_id is None
        assert all("SuperSecret" not in (r.detail or "") for r in AuditEvent.query.all())


def test_the_csv_export_cannot_run_as_a_spreadsheet_formula(world):
    flask_app, a, _b, _mp = world
    flask_app.test_client().post("/api/auth/login", json={"email": "=HYPERLINK(\"http://evil\")@x.com", "password": "x"})
    from utils import audit_log
    with flask_app.test_request_context("/"):
        from models.audit_event import AuditEvent
        from database import db
        db.session.add(AuditEvent(user_id=1, action="note", detail="=cmd|' /C calc'!A0"))
        db.session.add(AuditEvent(user_id=1, action="note", detail="+SUM(1,1)"))
        db.session.commit()
    r = a.get("/api/audit/me.csv")
    assert r.status_code == 200 and r.mimetype == "text/csv" and "attachment" in r.headers["Content-Disposition"]
    rows = list(csv.reader(io.StringIO(r.get_data(as_text=True).lstrip("﻿"))))
    assert rows[0] == ["when (UTC)", "what", "detail", "ip address"]
    assert all(not cell.startswith(("=", "+", "-", "@")) for row in rows for cell in row)
    assert audit_log._safe("=1+1") == "'=1+1" and audit_log._safe("plain") == "plain"
