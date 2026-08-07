"""
utils/tokens.py
Signed, expiring tokens for password-reset links. Uses the app's
JWT_SECRET_KEY as the signing key so no new secret needs provisioning.
"""
import os
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

RESET_SALT = "lexamplify-password-reset"


def _serializer():
    secret = os.getenv("JWT_SECRET_KEY", "secret")
    return URLSafeTimedSerializer(secret_key=secret)


def generate_reset_token(email: str) -> str:
    return _serializer().dumps(email, salt=RESET_SALT)


def verify_reset_token(token: str, max_age_seconds: int = 3600):
    """Returns the email the token was issued for, or None if invalid/expired."""
    try:
        return _serializer().loads(token, salt=RESET_SALT, max_age=max_age_seconds)
    except (BadSignature, SignatureExpired):
        return None
