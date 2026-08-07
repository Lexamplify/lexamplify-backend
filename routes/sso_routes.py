"""
routes/sso_routes.py
Blueprint: /api/auth/sso — Enterprise SSO scaffold (Authlib).
  GET /api/auth/sso/microsoft/login      — redirect to Microsoft 365 (Azure AD) consent
  GET /api/auth/sso/microsoft/callback   — exchange code, find-or-create user, issue cookie session
  GET /api/auth/sso/google/login         — redirect to Google Workspace consent
  GET /api/auth/sso/google/callback      — exchange code, find-or-create user, issue cookie session

Requires env vars (unset -> route responds 503, does not crash the app):
  AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID (or "common")
  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
  SSO_FRONTEND_REDIRECT (where to land the browser after a successful login, e.g. https://app.lexamplify.in/dashboard)
"""
import os
import sqlite3
import secrets

from flask import Blueprint, redirect, url_for, session
from authlib.integrations.flask_client import OAuth
from flask_jwt_extended import create_access_token, create_refresh_token, set_access_cookies, set_refresh_cookies

sso_bp = Blueprint("sso", __name__, url_prefix="/api/auth/sso")
oauth = OAuth()

DB_PATH = "lex_assistant.db"
FRONTEND_REDIRECT = os.getenv("SSO_FRONTEND_REDIRECT", "http://localhost:5173/dashboard")


def init_sso(app):
    """Called once from create_app(). Registers whichever providers have
    credentials configured — an unconfigured provider's routes 503 instead
    of the app failing to boot."""
    oauth.init_app(app)
    app.secret_key = app.config.get("JWT_SECRET_KEY", "secret")

    if os.getenv("AZURE_CLIENT_ID") and os.getenv("AZURE_CLIENT_SECRET"):
        tenant = os.getenv("AZURE_TENANT_ID", "common")
        oauth.register(
            name="microsoft",
            client_id=os.getenv("AZURE_CLIENT_ID"),
            client_secret=os.getenv("AZURE_CLIENT_SECRET"),
            server_metadata_url=f"https://login.microsoftonline.com/{tenant}/v2.0/.well-known/openid-configuration",
            client_kwargs={"scope": "openid email profile"},
        )

    if os.getenv("GOOGLE_CLIENT_ID") and os.getenv("GOOGLE_CLIENT_SECRET"):
        oauth.register(
            name="google",
            client_id=os.getenv("GOOGLE_CLIENT_ID"),
            client_secret=os.getenv("GOOGLE_CLIENT_SECRET"),
            server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
            client_kwargs={"scope": "openid email profile"},
        )


def _find_or_create_sso_user(email, name):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL
            )
        ''')
        for col, col_type in (("name", "TEXT"), ("created_at", "TEXT DEFAULT CURRENT_TIMESTAMP"), ("sso_provider", "TEXT")):
            try:
                conn.execute(f"ALTER TABLE users ADD COLUMN {col} {col_type}")
            except sqlite3.OperationalError:
                pass

        row = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        if row:
            return row["id"]

        # SSO accounts get an unusable random password hash — they can only
        # ever authenticate via the provider, never via /api/auth/login.
        unusable_password = secrets.token_hex(32)
        cur = conn.execute(
            "INSERT INTO users (email, password, name) VALUES (?, ?, ?)",
            (email, unusable_password, name or email.split("@")[0]),
        )
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def _issue_cookie_redirect(user_id):
    resp = redirect(FRONTEND_REDIRECT)
    access_token = create_access_token(identity=str(user_id))
    refresh_token = create_refresh_token(identity=str(user_id))
    set_access_cookies(resp, access_token)
    set_refresh_cookies(resp, refresh_token)
    return resp


def _is_dev():
    return os.getenv('FLASK_ENV') != 'production'


def _sso_unavailable_response(provider):
    # Always log the real reason server-side. The client only sees the
    # setup-detail ("not configured") when FLASK_ENV == development —
    # production gets a generic, non-diagnostic message so an outsider
    # probing these routes can't fingerprint which providers are wired up.
    print(f"[sso] {provider} login attempted but is not configured (missing client id/secret).")
    if _is_dev():
        return {"error": f"{provider} SSO is not configured on this environment.", "code": "SSO_NOT_CONFIGURED"}, 503
    return {"error": "This sign-in method is currently unavailable.", "code": "SSO_UNAVAILABLE"}, 503


def _sso_error_response(provider, exc):
    print(f"[sso] {provider} SSO failed: {exc}")
    if _is_dev():
        return {"error": f"{provider} SSO failed: {exc}", "code": "SSO_ERROR"}, 502
    return {"error": "Sign-in failed. Please try again.", "code": "SSO_ERROR"}, 502


@sso_bp.route("/microsoft/login")
def microsoft_login():
    if "microsoft" not in oauth._clients:
        return _sso_unavailable_response("Microsoft")
    redirect_uri = url_for("sso.microsoft_callback", _external=True)
    return oauth.microsoft.authorize_redirect(redirect_uri)


@sso_bp.route("/microsoft/callback")
def microsoft_callback():
    if "microsoft" not in oauth._clients:
        return _sso_unavailable_response("Microsoft")
    try:
        token = oauth.microsoft.authorize_access_token()
        claims = token.get("userinfo") or oauth.microsoft.parse_id_token(token)
        email = (claims.get("email") or claims.get("preferred_username") or "").strip().lower()
        name = claims.get("name") or ""
        if not email:
            return {"error": "Microsoft did not return an email claim.", "code": "SSO_NO_EMAIL"}, 400
        user_id = _find_or_create_sso_user(email, name)
        return _issue_cookie_redirect(user_id)
    except Exception as e:
        return _sso_error_response("Microsoft", e)


@sso_bp.route("/google/login")
def google_login():
    if "google" not in oauth._clients:
        return _sso_unavailable_response("Google")
    redirect_uri = url_for("sso.google_callback", _external=True)
    return oauth.google.authorize_redirect(redirect_uri)


@sso_bp.route("/google/callback")
def google_callback():
    if "google" not in oauth._clients:
        return _sso_unavailable_response("Google")
    try:
        token = oauth.google.authorize_access_token()
        claims = token.get("userinfo") or oauth.google.parse_id_token(token)
        email = (claims.get("email") or "").strip().lower()
        name = claims.get("name") or ""
        if not email:
            return {"error": "Google did not return an email claim.", "code": "SSO_NO_EMAIL"}, 400
        user_id = _find_or_create_sso_user(email, name)
        return _issue_cookie_redirect(user_id)
    except Exception as e:
        return _sso_error_response("Google", e)
