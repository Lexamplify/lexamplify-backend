"""
utils/sms.py
Provider-agnostic SMS sender for one-time passcodes.

Pick a provider with SMS_PROVIDER:
  msg91   - MSG91 OTP/Flow API (the usual choice in India; needs DLT-approved template)
            MSG91_AUTH_KEY, MSG91_TEMPLATE_ID
  msg91_widget - MSG91 OTP Widget with MSG91's default template/sender: no DLT of
            our own needed. MSG91 sends and checks the code; our server only
            confirms the access token the widget returns.
            MSG91_AUTH_KEY (secret), MSG91_WIDGET_ID, MSG91_WIDGET_TOKEN (both public, used in the browser)
  twilio  - Twilio Messages API
            TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM
  (unset) - nothing is sent. The passcode is only printed to the server log
            and ONLY outside production, so local development works without
            a provider.

send_otp_sms() returns True when the provider accepted the message and never
raises, so a provider outage cannot take the login page down.
"""
import os

import requests

SMS_PROVIDER = (os.getenv("SMS_PROVIDER") or "").strip().lower()


def widget_mode() -> bool:
    return SMS_PROVIDER == "msg91_widget"


def widget_public_config() -> dict:
    """What the browser needs to start the widget. Neither value is a secret."""
    return {"widget_id": os.getenv("MSG91_WIDGET_ID") or "", "token_auth": os.getenv("MSG91_WIDGET_TOKEN") or ""}


def _leaf_values(obj, depth=0):
    if depth > 6:
        return
    if isinstance(obj, dict):
        for v in obj.values():
            yield from _leaf_values(v, depth + 1)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            yield from _leaf_values(v, depth + 1)
    elif isinstance(obj, (str, int)) and not isinstance(obj, bool):
        yield str(obj)


def _jwt_payload(token):
    """Decode (without trusting) a JWT payload. Only used to find which number the
    token was issued for; MSG91 has already confirmed the token is genuine."""
    import base64, json
    try:
        part = token.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
    except Exception:
        return {}


def verify_widget_token(access_token: str, phone_e164: str, normalize) -> bool:
    """True only if MSG91 confirms the widget access token AND it was issued for
    this mobile number. If MSG91 confirms the token but we cannot see which number
    it belongs to, we refuse: otherwise someone could verify their own phone and
    claim somebody else's number. Never raises, never logs the token or key."""
    try:
        if not (widget_mode() and sms_configured()) or not access_token or len(access_token) > 4096:
            return False
        resp = requests.post(
            "https://control.msg91.com/api/v5/widget/verifyAccessToken",
            json={"authkey": os.getenv("MSG91_AUTH_KEY"), "access-token": access_token},
            headers={"accept": "application/json", "content-type": "application/json"},
            timeout=10,
        )
        try:
            body = resp.json()
        except ValueError:
            body = {}
        if not (resp.ok and str(body.get("type", "")).lower() == "success"):
            print(f"[sms] MSG91 widget token rejected: http={resp.status_code} body={str(body)[:200]}")
            return False
        seen = list(_leaf_values(body)) + list(_leaf_values(_jwt_payload(access_token)))
        if any(normalize(v) == phone_e164 for v in seen):
            return True
        print(f"[sms] MSG91 confirmed the token but no mobile number was visible to bind it; response keys={sorted(body.keys()) if isinstance(body, dict) else type(body).__name__}")
        return False
    except Exception as exc:
        print(f"[sms] widget verification failed: {exc}")
        return False


def sms_configured() -> bool:
    if SMS_PROVIDER == "msg91_widget":
        return bool(os.getenv("MSG91_AUTH_KEY") and os.getenv("MSG91_WIDGET_ID") and os.getenv("MSG91_WIDGET_TOKEN"))
    if SMS_PROVIDER == "msg91":
        return bool(os.getenv("MSG91_AUTH_KEY") and os.getenv("MSG91_TEMPLATE_ID"))
    if SMS_PROVIDER == "twilio":
        return bool(os.getenv("TWILIO_ACCOUNT_SID") and os.getenv("TWILIO_AUTH_TOKEN") and os.getenv("TWILIO_FROM"))
    return False


def send_otp_sms(phone_e164: str, code: str) -> bool:
    try:
        if SMS_PROVIDER == "msg91" and sms_configured():
            # MSG91 "Send OTP" API v5. We generate and store the code ourselves
            # (hashed) and hand MSG91 the value to deliver through the DLT
            # template, whose body must contain the ##OTP## variable.
            resp = requests.post(
                "https://control.msg91.com/api/v5/otp",
                params={
                    "template_id": os.getenv("MSG91_TEMPLATE_ID"),
                    "mobile": phone_e164.lstrip("+"),      # 91XXXXXXXXXX
                    "otp": code,
                    "otp_expiry": 5,                       # minutes, matches OTP_TTL
                },
                json={},
                headers={"authkey": os.getenv("MSG91_AUTH_KEY"), "accept": "application/json", "content-type": "application/json"},
                timeout=10,
            )
            try:
                body = resp.json()
            except ValueError:
                body = {}
            if resp.ok and body.get("type") == "success":
                return True
            # Never log the code or the auth key; the provider message is what
            # tells you whether it is DLT, template, balance or IP whitelisting.
            print(f"[sms] MSG91 rejected the request: http={resp.status_code} body={str(body)[:300]}")
            return False
        if SMS_PROVIDER == "twilio" and sms_configured():
            sid = os.getenv("TWILIO_ACCOUNT_SID")
            resp = requests.post(
                f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
                data={
                    "To": phone_e164,
                    "From": os.getenv("TWILIO_FROM"),
                    "Body": f"{code} is your LexAmplify verification code. It expires in 5 minutes. Do not share it with anyone.",
                },
                auth=(sid, os.getenv("TWILIO_AUTH_TOKEN")),
                timeout=10,
            )
            return resp.status_code in (200, 201)
        if os.getenv("FLASK_ENV") != "production" and os.getenv("RENDER") != "true":
            print(f"[sms] no provider configured - dev passcode for {phone_e164}: {code}")
        else:
            print("[sms] no SMS provider configured in production - passcode NOT sent")
        return False
    except Exception as exc:  # network failure, bad JSON, ...
        print(f"[sms] send failed: {exc}")
        return False
