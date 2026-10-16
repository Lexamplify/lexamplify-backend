"""
utils/sms.py
Provider-agnostic SMS sender for one-time passcodes.

Pick a provider with SMS_PROVIDER:
  msg91   - MSG91 OTP/Flow API (the usual choice in India; needs DLT-approved template)
            MSG91_AUTH_KEY, MSG91_TEMPLATE_ID
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


def sms_configured() -> bool:
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
        if os.getenv("FLASK_ENV") != "production":
            print(f"[sms] no provider configured - dev passcode for {phone_e164}: {code}")
        else:
            print("[sms] no SMS provider configured in production - passcode NOT sent")
        return False
    except Exception as exc:  # network failure, bad JSON, ...
        print(f"[sms] send failed: {exc}")
        return False
