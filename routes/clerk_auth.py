"""Clerk → app-session bridge.

The frontend signs in with Clerk (Clerk owns the login UI + Google/OAuth +
email). It then posts the Clerk session JWT here; we verify it against Clerk's
JWKS, resolve the user's email via Clerk's Backend API, find-or-create the app
user, and issue THIS app's own HttpOnly JWT cookie — the same session every
other route already understands. So Clerk is just the identity front door; the
app's user / firm / workspace model and all `/api/*` auth stay exactly as they
are (mirrors the Authlib SSO pattern in routes/sso_routes.py).

Config (env): all inert until set, so this ships disabled.
  CLERK_SECRET_KEY   sk_test_… (dev instance) or sk_live_… (prod). REQUIRED.
  CLERK_ISSUER       the Clerk Frontend-API origin that signs the tokens, e.g.
                     https://clerk.lexamplify.com (prod) or
                     https://<slug>.clerk.accounts.dev (dev). REQUIRED.
  CLERK_API_URL      Backend API base (default https://api.clerk.com).
"""
from __future__ import annotations
import base64
import os
import secrets

import jwt
import requests
from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import create_access_token, create_refresh_token, set_access_cookies, set_refresh_cookies
from werkzeug.security import generate_password_hash
from sqlalchemy.exc import IntegrityError

clerk_bp = Blueprint("clerk_auth", __name__, url_prefix="/api/auth/clerk")

_jwk_clients: dict = {}  # jwks_url -> PyJWKClient (caches keys internally)


def _issuer_from_pk(pk: str):
    """A Clerk publishable key encodes its Frontend-API domain:
    pk_(live|test)_<base64("<fapi-domain>$")>. Derive the token issuer from it
    so the operator only needs to set the publishable + secret keys."""
    try:
        b64 = pk.split("_", 2)[2]
        domain = base64.b64decode(b64 + "===").decode("utf-8").rstrip("$").strip()
        return f"https://{domain}" if domain else None
    except Exception:
        return None


def _cfg():
    secret = os.getenv("CLERK_SECRET_KEY")
    issuer = (os.getenv("CLERK_ISSUER") or "").rstrip("/")
    if not issuer:
        pk = os.getenv("CLERK_PUBLISHABLE_KEY") or os.getenv("VITE_CLERK_PUBLISHABLE_KEY") or ""
        issuer = (_issuer_from_pk(pk) or "").rstrip("/") if pk else ""
    api = (os.getenv("CLERK_API_URL") or "https://api.clerk.com").rstrip("/")
    return (secret, issuer, api)


def _configured() -> bool:
    secret, issuer, _ = _cfg()
    return bool(secret and issuer)


def _jwk_client(issuer: str):
    url = f"{issuer}/.well-known/jwks.json"
    c = _jwk_clients.get(url)
    if c is None:
        c = jwt.PyJWKClient(url)
        _jwk_clients[url] = c
    return c


def _verify_clerk_token(token: str, issuer: str) -> dict:
    """Verify a Clerk session JWT (RS256) against the instance JWKS. Raises on
    any failure. We validate signature + issuer + exp/nbf; Clerk session tokens
    carry `azp` (origin), not a fixed `aud`, so audience is not enforced here."""
    signing_key = _jwk_client(issuer).get_signing_key_from_jwt(token)
    return jwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256"],
        issuer=issuer,
        options={"verify_aud": False, "require": ["exp", "iat", "sub"]},
        leeway=10,
    )


def _clerk_user_email_name(sub: str):
    """Resolve the verified user's primary email + name via Clerk Backend API."""
    secret, _, api = _cfg()
    r = requests.get(
        f"{api}/v1/users/{sub}",
        headers={"Authorization": f"Bearer {secret}"},
        timeout=10,
    )
    r.raise_for_status()
    u = r.json()
    emails = u.get("email_addresses") or []
    primary_id = u.get("primary_email_address_id")
    email = None
    for e in emails:
        if e.get("id") == primary_id:
            email = e.get("email_address")
            break
    if not email and emails:
        email = emails[0].get("email_address")
    name = " ".join(x for x in (u.get("first_name"), u.get("last_name")) if x).strip() or None
    return email, name


def _find_or_create_user(email: str, name):
    """Same contract as sso_routes._find_or_create_sso_user (kept local to avoid
    import-order coupling)."""
    from models.user import User
    from database import db
    email = (email or "").strip().lower()
    user = User.query.filter_by(email=email).first()
    if user:
        return user.id
    display = (name or "").strip() or email.split("@")[0]
    user = User(email=email, password=generate_password_hash(secrets.token_hex(32)), name=display[:120])
    try:
        db.session.add(user)
        db.session.commit()
        return user.id
    except IntegrityError:
        db.session.rollback()
        again = User.query.filter_by(email=email).first()
        if again:
            return again.id
        raise
    except Exception:
        db.session.rollback()
        raise


def _bearer_or_body_token() -> str | None:
    auth = request.headers.get("Authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    body = request.get_json(silent=True) or {}
    return (body.get("token") or "").strip() or None


@clerk_bp.route("/session", methods=["POST"])
def clerk_session():
    """Exchange a verified Clerk session JWT for this app's cookie session."""
    secret, issuer, _ = _cfg()
    if not _configured():
        return jsonify({"error": True, "code": "clerk_not_configured",
                        "message": "Clerk is not configured on this environment."}), 503

    token = _bearer_or_body_token()
    if not token:
        return jsonify({"error": True, "code": "missing_token", "message": "No Clerk session token provided."}), 400

    try:
        claims = _verify_clerk_token(token, issuer)
    except Exception as e:  # noqa: BLE001
        current_app.logger.warning(f"[clerk] token verify failed: {type(e).__name__}: {e}")
        return jsonify({"error": True, "code": "invalid_token", "message": "Could not verify the Clerk session."}), 401

    sub = claims.get("sub")
    try:
        email, name = _clerk_user_email_name(sub)
    except Exception as e:  # noqa: BLE001
        current_app.logger.warning(f"[clerk] user lookup failed for {sub}: {type(e).__name__}: {e}")
        return jsonify({"error": True, "code": "user_lookup_failed", "message": "Could not load the Clerk user."}), 502
    if not email:
        return jsonify({"error": True, "code": "no_email", "message": "This Clerk account has no email address."}), 400

    try:
        uid = _find_or_create_user(email, name)
    except Exception as e:  # noqa: BLE001
        current_app.logger.exception("[clerk] find_or_create failed")
        return jsonify({"error": True, "code": "user_create_failed", "message": "Could not create the account."}), 500

    resp = jsonify({"ok": True, "user": {"id": uid, "email": email, "name": name}})
    access = create_access_token(identity=str(uid))
    refresh = create_refresh_token(identity=str(uid))
    set_access_cookies(resp, access)
    set_refresh_cookies(resp, refresh)
    return resp, 200


@clerk_bp.route("/status", methods=["GET"])
def clerk_status():
    """Lets the frontend know whether Clerk login is enabled on this backend."""
    _, issuer, _ = _cfg()
    return jsonify({"enabled": _configured(), "issuer": issuer or None})


def init_clerk(app):
    """Register the Clerk blueprint. Always registers; the routes 503 until
    CLERK_SECRET_KEY + CLERK_ISSUER are set (same pattern as SSO)."""
    app.register_blueprint(clerk_bp)
    if _configured():
        app.logger.info("[clerk] enabled (issuer=%s)", _cfg()[1])
    else:
        app.logger.info("[clerk] registered but disabled (set CLERK_SECRET_KEY + CLERK_ISSUER)")
