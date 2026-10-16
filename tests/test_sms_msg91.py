"""MSG91 delivery: request shape, success, provider rejection, network failure."""
import importlib
from unittest import mock

import pytest


@pytest.fixture
def sms(monkeypatch):
    monkeypatch.setenv("SMS_PROVIDER", "msg91")
    monkeypatch.setenv("MSG91_AUTH_KEY", "test-key")
    monkeypatch.setenv("MSG91_TEMPLATE_ID", "tmpl123")
    import utils.sms as mod
    return importlib.reload(mod)


def _resp(ok=True, status=200, body=None):
    r = mock.Mock()
    r.ok, r.status_code = ok, status
    r.json.return_value = body if body is not None else {}
    return r


def test_configured_requires_both_values(monkeypatch):
    monkeypatch.setenv("SMS_PROVIDER", "msg91")
    monkeypatch.setenv("MSG91_AUTH_KEY", "k")
    monkeypatch.delenv("MSG91_TEMPLATE_ID", raising=False)
    import utils.sms as mod
    assert importlib.reload(mod).sms_configured() is False


def test_request_shape_and_success(sms):
    with mock.patch.object(sms.requests, "post", return_value=_resp(body={"type": "success", "message": "req"})) as post:
        assert sms.send_otp_sms("+919876543210", "123456") is True
    args, kwargs = post.call_args
    assert args[0] == "https://control.msg91.com/api/v5/otp"
    assert kwargs["params"]["mobile"] == "919876543210"
    assert kwargs["params"]["otp"] == "123456"
    assert kwargs["params"]["template_id"] == "tmpl123"
    assert kwargs["headers"]["authkey"] == "test-key"


def test_provider_error_is_false_and_never_logs_code(sms, capsys):
    bad = _resp(body={"type": "error", "message": "Template not found"})
    with mock.patch.object(sms.requests, "post", return_value=bad):
        assert sms.send_otp_sms("+919876543210", "654321") is False
    out = capsys.readouterr().out
    assert "Template not found" in out
    assert "654321" not in out and "test-key" not in out


def test_network_failure_does_not_raise(sms):
    with mock.patch.object(sms.requests, "post", side_effect=sms.requests.ConnectionError("down")):
        assert sms.send_otp_sms("+919876543210", "111111") is False
