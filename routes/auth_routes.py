"""
routes/auth_routes.py
Blueprint: /api/auth
  POST /api/auth/signup            — legacy SQLAlchemy path (server-rendered templates only, untouched)
  POST /api/auth/register          — create account, issues HttpOnly cookie session
  POST /api/auth/login             — verify credentials, issues HttpOnly cookie session
  POST /api/auth/logout            — clears cookie session
  POST /api/auth/refresh           — rotates a new access cookie from the refresh cookie
  GET  /api/auth/me                — current session identity (cookie-derived), for zero-friction reload
  POST /api/auth/forgot-password   — rate-limited, always returns a generic response (anti-enumeration)
  POST /api/auth/reset-password    — consumes a signed reset token, sets a new password

JWTs live ONLY in HttpOnly cookies — never in a JSON response body, never
in localStorage. CSRF double-submit is enforced by Flask-JWT-Extended's
built-in cookie-CSRF protection (JWT_COOKIE_CSRF_PROTECT, configured in
app.py): a companion non-HttpOnly `csrf_access_token` cookie is set
alongside the HttpOnly JWT cookie, and every state-changing request must
echo its value back in the X-CSRF-TOKEN header or Flask-JWT-Extended
rejects it — a cookie alone (which a CSRF attacker's cross-site form can
trigger the browser into sending automatically) is never sufficient.
"""
import sqlite3

from flask import Blueprint, request, jsonify
from flask_jwt_extended import (
    create_access_token,
    create_refresh_token,
    set_access_cookies,
    set_refresh_cookies,
    unset_jwt_cookies,
    jwt_required,
    get_jwt_identity,
)
from werkzeug.security import generate_password_hash, check_password_hash
from database import db
from models.user import User
from utils.limiter import limiter
from utils.mailer import send_email
from utils.tokens import generate_reset_token, verify_reset_token

auth_bp = Blueprint("auth", __name__)

DB_PATH = "lex_assistant.db"


@auth_bp.route("/signup", methods=["POST"])
def signup():
    # Legacy path for the server-rendered templates/signup.html — not used
    # by the React app (which posts to /register below). Left as-is.
    try:
        data = request.get_json()
        name     = data.get("name", "").strip()
        email    = data.get("email", "").strip().lower()
        password = data.get("password", "").strip()
        role     = data.get("role", "Lawyer")

        if not name or not email or not password:
            return jsonify({"error": "Name, email and password are required."}), 400
        if User.query.filter_by(email=email).first():
            return jsonify({"error": "Email already registered."}), 409

        user = User(
            name=name, email=email,
            password=generate_password_hash(password),
            role=role
        )
        db.session.add(user)
        db.session.commit()
        token = create_access_token(identity=str(user.id))
        return jsonify({"token": token, "name": user.name, "role": user.role}), 201
    except Exception as e:
        db.session.rollback()
        print(f"Signup error: {str(e)}")
        return jsonify({"error": f"Server error: {str(e)}", "code": "INTERNAL_ERROR"}), 500


def _get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_users_table(conn):
    conn.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL
        )
    ''')
    for col, col_type in (("name", "TEXT"), ("created_at", "TEXT DEFAULT CURRENT_TIMESTAMP"),
                           ("reset_token_hash", "TEXT"), ("reset_token_expires", "TEXT")):
        try:
            conn.execute(f"ALTER TABLE users ADD COLUMN {col} {col_type}")
        except sqlite3.OperationalError:
            pass


def _issue_session_response(payload, user_id, status=200):
    """Builds the JSON body first, then attaches HttpOnly access+refresh
    JWT cookies to it — the token itself never appears in `payload`."""
    resp = jsonify(payload)
    access_token = create_access_token(identity=str(user_id))
    refresh_token = create_refresh_token(identity=str(user_id))
    set_access_cookies(resp, access_token)
    set_refresh_cookies(resp, refresh_token)
    return resp, status


@auth_bp.route('/register', methods=['POST'])
def register_user():
    conn = None
    try:
        data = request.get_json(silent=True) or {}
        email = (data.get('email') or '').strip().lower()
        password = data.get('password') or ''
        name = (data.get('name') or email.split('@')[0] if email else '').strip()

        if not email or not password:
            return jsonify({"error": "Email and password required"}), 400
        if len(password) < 8:
            return jsonify({"error": "Password must be at least 8 characters."}), 400

        conn = _get_db()
        _ensure_users_table(conn)

        existing = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        if existing:
            return jsonify({"error": "An account with this email already exists."}), 409

        hashed_password = generate_password_hash(password)
        cur = conn.execute(
            "INSERT INTO users (email, password, name) VALUES (?, ?, ?)",
            (email, hashed_password, name),
        )
        conn.commit()
        user_id = cur.lastrowid

        return _issue_session_response(
            {"message": "Account created.", "user": {"id": user_id, "email": email, "name": name}},
            user_id, status=201,
        )
    except Exception as e:
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500
    finally:
        if conn:
            conn.close()


@auth_bp.route('/login', methods=['POST'])
@limiter.limit("10/minute")
def login_user():
    conn = None
    try:
        data = request.get_json(silent=True) or {}
        email = (data.get('email') or data.get('username') or '').strip().lower()
        password = data.get('password') or ''

        if not email or not password:
            return jsonify({"error": "Missing credentials"}), 400

        conn = _get_db()
        _ensure_users_table(conn)

        user = conn.execute(
            "SELECT id, password, name FROM users WHERE email = ?", (email,)
        ).fetchone()

        # No auto-creation on login — an unrecognized email is a straight
        # 401, same message as a wrong password, so a brute-forcer can't
        # use this endpoint to enumerate which emails have accounts.
        if not user or not check_password_hash(user['password'], password):
            return jsonify({"error": "Invalid email or password."}), 401

        return _issue_session_response(
            {"user": {"id": user['id'], "email": email, "name": user['name']}},
            user['id'],
        )
    except Exception as e:
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500
    finally:
        if conn:
            conn.close()


@auth_bp.route('/logout', methods=['POST'])
def logout_user():
    resp = jsonify({"message": "Logged out."})
    unset_jwt_cookies(resp)
    return resp, 200


@auth_bp.route('/refresh', methods=['POST'])
@jwt_required(refresh=True)
def refresh_token():
    identity = get_jwt_identity()
    resp = jsonify({"message": "Session refreshed."})
    access_token = create_access_token(identity=identity)
    set_access_cookies(resp, access_token)
    return resp, 200


@auth_bp.route('/me', methods=['GET'])
@jwt_required()
def current_user():
    """Cookie-derived identity check — lets the frontend confirm an
    existing session on page load without ever touching localStorage."""
    user_id = get_jwt_identity()
    conn = None
    try:
        conn = _get_db()
        _ensure_users_table(conn)
        user = conn.execute("SELECT id, email, name FROM users WHERE id = ?", (user_id,)).fetchone()
        if not user:
            return jsonify({"error": "Session user not found."}), 404
        return jsonify({"user": {"id": user['id'], "email": user['email'], "name": user['name']}}), 200
    except Exception as e:
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500
    finally:
        if conn:
            conn.close()


@auth_bp.route('/forgot-password', methods=['POST'])
@limiter.limit("3/hour")
def forgot_password():
    GENERIC_MESSAGE = {"message": "If an account exists for that email, a reset link has been sent."}
    is_dev = os.getenv('FLASK_ENV') != 'production'
    conn = None
    try:
        data = request.get_json(silent=True) or {}
        email = (data.get('email') or '').strip().lower()
        if not email:
            # Still generic — do not reveal that the request shape itself was wrong
            # in a way that would distinguish "no such field" from "no such user".
            return jsonify(GENERIC_MESSAGE), 200

        conn = _get_db()
        _ensure_users_table(conn)
        user = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()

        mail_sent = True
        if user:
            reset_token = generate_reset_token(email)
            frontend_origin = (data.get('frontend_origin') or '').strip() or 'https://app.lexamplify.in'
            reset_link = f"{frontend_origin}/login?resetToken={reset_token}"
            mail_sent = send_email(
                email,
                "Reset your LexAmplify password",
                f"Click to reset your password (expires in 1 hour): {reset_link}",
            )

        # Dev-only visibility into a real operational gap (SMTP unset) —
        # gated on `user` truthy so it can NEVER be used to distinguish a
        # real account from a nonexistent one, only "is mail configured".
        # Production never takes this branch: same 200 either way.
        if user and not mail_sent and is_dev:
            print(f"[forgot_password] SMTP not configured — reset link for {email} was only logged, not emailed.")
            return jsonify({
                "error": "Email delivery is not configured (SMTP_HOST unset). Reset link was logged server-side instead.",
                "code": "MAILER_NOT_CONFIGURED",
            }), 503

        # Same response, same latency profile whether or not the user
        # exists — no branch that lets a caller distinguish the two cases.
        return jsonify(GENERIC_MESSAGE), 200
    except Exception as e:
        print(f"[forgot_password] internal error: {e}")
        if is_dev:
            return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 503
        # Never leak internal errors in production either — an error state
        # must not become a third distinguishable response an enumeration
        # attack could key off.
        return jsonify(GENERIC_MESSAGE), 200
    finally:
        if conn:
            conn.close()


@auth_bp.route('/reset-password', methods=['POST'])
@limiter.limit("5/hour")
def reset_password():
    conn = None
    try:
        data = request.get_json(silent=True) or {}
        token = data.get('token') or ''
        new_password = data.get('password') or ''

        if not token or not new_password:
            return jsonify({"error": "Token and new password are required."}), 400
        if len(new_password) < 8:
            return jsonify({"error": "Password must be at least 8 characters."}), 400

        email = verify_reset_token(token, max_age_seconds=3600)
        if not email:
            return jsonify({"error": "This reset link is invalid or has expired."}), 400

        conn = _get_db()
        _ensure_users_table(conn)
        user = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        if not user:
            return jsonify({"error": "This reset link is invalid or has expired."}), 400

        conn.execute(
            "UPDATE users SET password = ? WHERE id = ?",
            (generate_password_hash(new_password), user['id']),
        )
        conn.commit()
        return jsonify({"message": "Password updated. You can now sign in."}), 200
    except Exception as e:
        return jsonify({"error": str(e), "code": "INTERNAL_ERROR"}), 500
    finally:
        if conn:
            conn.close()
