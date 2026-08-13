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
from urllib.parse import urlsplit, urlunsplit, urlencode

from flask import Blueprint, redirect, url_for, session
from authlib.integrations.flask_client import OAuth
from flask_jwt_extended import create_access_token, create_refresh_token, set_access_cookies, set_refresh_cookies

sso_bp = Blueprint("sso", __name__, url_prefix="/api/auth/sso")
oauth = OAuth()

DB_PATH = "lex_assistant.db"
FRONTEND_REDIRECT = os.getenv("SSO_FRONTEND_REDIRECT", "http://localhost:5173/dashboard")
# Same origin as FRONTEND_REDIRECT, path swapped to /login — where an
# unavailable/failed provider sends the browser back to instead of a bare
# JSON body (see _sso_unavailable_response/_sso_error_response below).
_frontend_parts = urlsplit(FRONTEND_REDIRECT)
FRONTEND_LOGIN_URL = urlunsplit((_frontend_parts.scheme, _frontend_parts.netloc, "/login", "", ""))


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


def _sso_redirect_with_error(provider, code, dev_detail):
    # Every route in this file is reached by a real top-level browser
    # navigation (the login link, then Google/Microsoft's own redirect back
    # to our callback) — never by fetch/XHR. Returning a bare JSON body used
    # to land the user on a blank page showing raw {"error": ...} instead of
    # back on the styled login screen. Redirecting with the error in the
    # query string lets LoginPage.jsx show it as a normal toast instead.
    params = {"sso_error": code, "provider": provider}
    if _is_dev():
        params["detail"] = dev_detail
    return redirect(f"{FRONTEND_LOGIN_URL}?{urlencode(params)}")


def _sso_unavailable_response(provider):
    # Always log the real reason server-side. The client only sees the
    # setup-detail ("not configured") when FLASK_ENV == development —
    # production gets a generic, non-diagnostic message so an outsider
    # probing these routes can't fingerprint which providers are wired up.
    print(f"[sso] {provider} login attempted but is not configured (missing client id/secret).")
    return _sso_redirect_with_error(provider, "unavailable", f"{provider} SSO is not configured on this environment.")


def _sso_error_response(provider, exc):
    print(f"[sso] {provider} SSO failed: {exc}")
    return _sso_redirect_with_error(provider, "failed", f"{provider} SSO failed: {exc}")


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
            return _sso_redirect_with_error("Microsoft", "no_email", "Microsoft did not return an email claim.")
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
            return _sso_redirect_with_error("Google", "no_email", "Google did not return an email claim.")
        user_id = _find_or_create_sso_user(email, name)
        return _issue_cookie_redirect(user_id)
    except Exception as e:
        return _sso_error_response("Google", e)
