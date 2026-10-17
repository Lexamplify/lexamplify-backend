"""
tests/test_widget_otp.py

MSG91 OTP Widget mode (SMS_PROVIDER=msg91_widget): MSG91 sends and checks the
code in the browser; our server only confirms the access token it returns.
MSG91 is mocked, so these prove OUR rules (number binding, single use, fail-closed),
not MSG91's live behaviour.
"""
import base64
import json

import pytest

from test_auth_otp import client, PASSWORD, PHONE, E164  # noqa: F401  (fixtures)


class FakeResp:
    def __init__(self, body, ok=True, status=200):
        self._b, self.ok, self.status_code = body, ok, status

    def json(self):
        return self._b


@pytest.fixture()
def widget(client, monkeypatch):
    import utils.sms as sms
    monkeypatch.setattr(sms, "SMS_PROVIDER", "msg91_widget")
    monkeypatch.setenv("MSG91_AUTH_KEY", "test-authkey-secret")
    monkeypatch.setenv("MSG91_WIDGET_ID", "wid123")
    monkeypatch.setenv("MSG91_WIDGET_TOKEN", "tok456")
    calls = []
    state = {"body": {"type": "success", "message": E164.lstrip("+")}}

    def fake_post(url, **kw):
        calls.append((url, kw))
        return FakeResp(state["body"])

    monkeypatch.setattr(sms.requests, "post", fake_post)
    client.calls, client.state = calls, state
    return client


def _jwt(payload):
    enc = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")
    return f"{enc({'alg': 'none'})}.{enc(payload)}.sig"


def test_config_exposes_only_public_widget_values(widget):
    cfg = widget.get("/api/auth/config").get_json()
    assert cfg["otp_mode"] == "widget"
    assert cfg["msg91_widget"] == {"widget_id": "wid123", "token_auth": "tok456"}
    assert "test-authkey-secret" not in json.dumps(cfg)


def test_server_does_not_send_codes_in_widget_mode(widget):
    r = widget.post("/api/auth/otp/send", json={"phone": PHONE, "purpose": "signup"})
    assert r.status_code == 400 and r.get_json()["code"] == "USE_WIDGET"


def test_signup_with_widget_token(widget):
    v = widget.post("/api/auth/otp/verify", json={"phone": PHONE, "access_token": "good-token-1"})
    assert v.status_code == 200, v.get_json()
    url, kw = widget.calls[-1]
    assert url.endswith("/api/v5/widget/verifyAccessToken")
    assert kw["json"] == {"authkey": "test-authkey-secret", "access-token": "good-token-1"}
    r = widget.post("/api/auth/register", json={"name": "Adv", "email": "w@example.com", "password": PASSWORD,
                                                "phone": PHONE, "phone_token": v.get_json()["phone_token"]})
    assert r.status_code == 201 and r.get_json()["user"]["phone"] == E164


def test_token_is_single_use(widget):
    assert widget.post("/api/auth/otp/verify", json={"phone": PHONE, "access_token": "once"}).status_code == 200
    again = widget.post("/api/auth/otp/verify", json={"phone": PHONE, "access_token": "once"})
    assert again.status_code == 400


def test_msg91_rejection_is_refused(widget):
    widget.state["body"] = {"type": "error", "message": "invalid token"}
    r = widget.post("/api/auth/otp/verify", json={"phone": PHONE, "access_token": "bad"})
    assert r.status_code == 400 and "register" not in r.get_json()


def test_token_for_another_number_is_refused(widget):
    widget.state["body"] = {"type": "success", "message": "919123456780"}   # someone else's number
    r = widget.post("/api/auth/otp/verify", json={"phone": PHONE, "access_token": "t-other"})
    assert r.status_code == 400


def test_fails_closed_when_number_cannot_be_seen(widget):
    widget.state["body"] = {"type": "success", "message": "verified"}
    r = widget.post("/api/auth/otp/verify", json={"phone": PHONE, "access_token": "t-nonum"})
    assert r.status_code == 400


def test_number_found_inside_the_token_payload(widget):
    widget.state["body"] = {"type": "success", "message": "verified"}
    tok = _jwt({"identifier": "91" + PHONE.replace(" ", "")})
    r = widget.post("/api/auth/otp/verify", json={"phone": PHONE, "access_token": tok})
    assert r.status_code == 200


def test_missing_or_oversized_token_is_refused(widget):
    assert widget.post("/api/auth/otp/verify", json={"phone": PHONE}).status_code == 400
    assert widget.post("/api/auth/otp/verify", json={"phone": PHONE, "access_token": "x" * 5000}).status_code == 400
    assert widget.post("/api/auth/otp/verify", json={"phone": PHONE, "access_token": {"a": 1}}).status_code == 400


def test_login_with_widget_token_and_verified_number_only(widget):
    v = widget.post("/api/auth/otp/verify", json={"phone": PHONE, "access_token": "su-1"})
    widget.post("/api/auth/register", json={"name": "Adv", "email": "l@example.com", "password": PASSWORD,
                                            "phone": PHONE, "phone_token": v.get_json()["phone_token"]})
    widget.post("/api/auth/logout")
    ok = widget.post("/api/auth/otp/login", json={"phone": PHONE, "access_token": "li-1"})
    assert ok.status_code == 200, ok.get_json()
    replay = widget.post("/api/auth/otp/login", json={"phone": PHONE, "access_token": "li-1"})
    assert replay.status_code == 401


def test_signup_cannot_take_a_verified_number(widget):
    v = widget.post("/api/auth/otp/verify", json={"phone": PHONE, "access_token": "su-a"})
    widget.post("/api/auth/register", json={"name": "A", "email": "a1@example.com", "password": PASSWORD,
                                            "phone": PHONE, "phone_token": v.get_json()["phone_token"]})
    again = widget.post("/api/auth/otp/verify", json={"phone": PHONE, "access_token": "su-b"})
    assert again.status_code == 400


def test_secret_never_logged(widget, capsys):
    widget.state["body"] = {"type": "error", "message": "nope"}
    widget.post("/api/auth/otp/verify", json={"phone": PHONE, "access_token": "tok-visible-test"})
    out = capsys.readouterr().out
    assert "test-authkey-secret" not in out and "tok-visible-test" not in out
