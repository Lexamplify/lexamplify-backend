"""
utils/tokens.py
Signed, expiring tokens (password reset, phone verification). Signed with the
app's JWT_SECRET_KEY - read from the live app config so dev (random per-boot
key) and production (required env var) both use the real key, never a
hardcoded fallback.
"""
import hashlib
import hmac

from flask import current_app
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

RESET_SALT = "lexamplify-password-reset"
PHONE_SALT = "lexamplify-phone-verified"
LOGIN_STEP_SALT = "lexamplify-login-step"


def _secret() -> str:
    return current_app.config["JWT_SECRET_KEY"]


def _serializer():
    return URLSafeTimedSerializer(secret_key=_secret())


def hmac_hex(value: str, purpose: str) -> str:
    """Keyed hash used to store OTP codes at rest (the 6-digit space is tiny,
    so an unkeyed hash would be trivially reversible)."""
    return hmac.new(f"{_secret()}:{purpose}".encode(), value.encode(), hashlib.sha256).hexdigest()


def _pw_fingerprint(password_hash: str) -> str:
    return hashlib.sha256((password_hash or "").encode()).hexdigest()[:16]


def generate_reset_token(email: str, password_hash: str = "") -> str:
    # The token carries a fingerprint of the CURRENT password hash, so it dies
    # the moment the password changes: a reset link works exactly once.
    return _serializer().dumps({"e": email, "f": _pw_fingerprint(password_hash)}, salt=RESET_SALT)


def verify_reset_token(token: str, max_age_seconds: int = 3600):
    """Returns (email, fingerprint) for a valid, unexpired token, else None."""
    try:
        data = _serializer().loads(token, salt=RESET_SALT, max_age=max_age_seconds)
        return data["e"], data["f"]
    except (BadSignature, SignatureExpired, KeyError, TypeError):
        return None


def reset_fingerprint_matches(fingerprint: str, password_hash: str) -> bool:
    return hmac.compare_digest(fingerprint, _pw_fingerprint(password_hash))


def generate_phone_token(phone_e164: str) -> str:
    return _serializer().dumps(phone_e164, salt=PHONE_SALT)


def verify_phone_token(token: str, max_age_seconds: int = 900):
    """Returns the verified E.164 phone number, or None."""
    try:
        return _serializer().loads(token, salt=PHONE_SALT, max_age=max_age_seconds)
    except (BadSignature, SignatureExpired):
        return None


def generate_login_step_token(user_id: int, phone_e164: str) -> str:
    """Issued after a correct phone code when a second factor is still owed, so the
    one-time SMS code can stay single-use while the person fetches their authenticator."""
    return _serializer().dumps({"u": int(user_id), "p": phone_e164}, salt=LOGIN_STEP_SALT)


def verify_login_step_token(token: str, max_age_seconds: int = 300):
    """Returns (user_id, phone) or None."""
    try:
        d = _serializer().loads(token, salt=LOGIN_STEP_SALT, max_age=max_age_seconds)
        return int(d["u"]), d["p"]
    except (BadSignature, SignatureExpired, KeyError, TypeError, ValueError):
        return None
