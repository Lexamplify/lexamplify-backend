"""
routes/auth_routes.py
Blueprint: /api/auth
  POST /api/auth/signup            — legacy alias, same User-model path as /register (server-rendered templates only)
  POST /api/auth/register          — create account, issues HttpOnly cookie session
  POST /api/auth/login             — verify credentials, issues HttpOnly cookie session
  POST /api/auth/logout            — clears cookie session
  POST /api/auth/refresh           — rotates a new access cookie from the refresh cookie
  GET  /api/auth/me                — current session identity (cookie-derived), for zero-friction reload
  POST /api/auth/forgot-password   — rate-limited, always returns a generic response (anti-enumeration)
  POST /api/auth/reset-password    — consumes a signed reset token, sets a new password

All five persist through the real SQLAlchemy `User` model (see models/user.py),
which reaches whatever DATABASE_URL is configured — Neon Postgres in
production. This used to NOT be true: register/login/me/forgot-password/
reset-password each read and wrote a private raw-sqlite3 file
(lex_assistant.db) directly, completely bypassing `db`/`User` — the actual
root cause of registrations never appearing in the Neon `users` table (the
code was never trying to reach it). services/legacy_user_migration.py
carries over anyone who registered through that old path.

JWTs live ONLY in HttpOnly cookies — never in a JSON response body, never
in localStorage. CSRF double-submit is enforced by Flask-JWT-Extended's
built-in cookie-CSRF protection (JWT_COOKIE_CSRF_PROTECT, configured in
app.py): a companion non-HttpOnly `csrf_access_token` cookie is set
alongside the HttpOnly JWT cookie, and every state-changing request must
echo its value back in the X-CSRF-TOKEN header or Flask-JWT-Extended
rejects it — a cookie alone (which a CSRF attacker's cross-site form can
trigger the browser into sending automatically) is never sufficient.
"""
import os
import re
import secrets
from datetime import datetime, timedelta

from flask import Blueprint, current_app, request, jsonify
from flask_jwt_extended import (
    create_access_token,
    create_refresh_token,
    set_access_cookies,
    set_refresh_cookies,
    unset_jwt_cookies,
    jwt_required,
    get_jwt_identity,
)
from sqlalchemy.exc import DBAPIError
from werkzeug.security import generate_password_hash, check_password_hash
from database import db
from models.user import User
from models.phone_otp import PhoneOtp
from utils.limiter import limiter
from utils.mailer import send_email
from utils.sms import send_otp_sms, sms_configured, widget_mode, widget_public_config, verify_widget_token
from utils.tokens import (
    generate_login_step_token, verify_login_step_token,
    generate_reset_token, verify_reset_token, reset_fingerprint_matches,
    generate_phone_token, verify_phone_token, hmac_hex,
)

auth_bp = Blueprint("auth", __name__)

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")
MAX_PASSWORD_LEN = 128  # bcrypt-style hashes get slow on huge inputs - cap it (DoS guard)
OTP_TTL = timedelta(minutes=5)
OTP_RESEND_COOLDOWN = timedelta(seconds=30)
OTP_MAX_ATTEMPTS = 5
OTP_MAX_SENDS_PER_HOUR = 5
OTP_MAX_GUESSES_PER_HOUR = 15   # across every code issued to one number


def _phone_otp_required() -> bool:
    """New accounts must prove they own the mobile number once an SMS provider
    is configured (PHONE_OTP_REQUIRED=true/false overrides). Without a provider
    nobody could ever receive a code, so signup stays open rather than locking
    every new advocate out."""
    flag = (os.getenv("PHONE_OTP_REQUIRED") or "auto").strip().lower()
    if flag in ("1", "true", "yes"):
        return True
    if flag in ("0", "false", "no"):
        return False
    return sms_configured()


def normalize_phone(raw):
    """Indian mobile numbers -> E.164 (+91XXXXXXXXXX). Returns None if invalid.
    Accepts '98765 43210', '+91 98765-43210', '09876543210', '919876543210'."""
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if len(digits) == 10 and digits[0] in "6789":
        return f"+91{digits}"
    return None


def _phone_variants(e164):
    ten = e164[-10:]
    return [e164, ten, f"91{ten}", f"0{ten}", f"+91 {ten}", f"+91 {ten[:5]} {ten[5:]}"]


def _user_by_phone(e164, verified_only=True):
    """Account that owns this number. Only numbers the holder proved with a code
    count by default: an unverified number is a contact detail, not an identity."""
    q = User.query.filter(User.phone.in_(_phone_variants(e164)))
    if verified_only:
        q = q.filter(User.phone_verified.is_(True))
    return q.first()


def _is_production() -> bool:
    return os.getenv("FLASK_ENV") == "production" or os.getenv("RENDER") == "true"


def _frontend_origin(requested):
    """Where emailed links point. The browser-supplied origin is only honoured
    if it is on the allow-list - otherwise anyone could request a reset for a
    victim with frontend_origin=https://evil.example and receive the live
    reset token in the victim's inbox link (account takeover)."""
    allowed = [o.strip().rstrip("/") for o in (os.getenv("FRONTEND_ORIGINS") or "").split(",") if o.strip()]
    default = (os.getenv("FRONTEND_URL") or "https://app.lexamplify.in").rstrip("/")
    candidate = (requested or "").strip().rstrip("/")
    if candidate and (candidate == default or candidate in allowed):
        return candidate
    if not _is_production() and re.match(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$", candidate):
        return candidate
    return default


@auth_bp.route("/signup", methods=["POST"])
def signup():
    # Retired. This legacy endpoint returned a bearer token in the response
    # body, skipped the password rules and let the CALLER choose their own
    # `role`. The React app uses /register.
    return jsonify({"error": "This endpoint has been retired. Use /api/auth/register."}), 410


@auth_bp.route("/config", methods=["GET"])
def auth_config():
    """Public, non-sensitive switches the sign-in page needs to decide what to show."""
    out = {"phone_otp_required": _phone_otp_required(), "sms_enabled": sms_configured(), "otp_mode": "api"}
    if widget_mode() and sms_configured():
        out["otp_mode"] = "widget"
        out["msg91_widget"] = widget_public_config()   # public browser values, not secrets
    return jsonify(out), 200


def _widget_proof(phone, access_token):
    """True if MSG91's widget confirmed this number with a fresh, never-used access
    token. Each token works once: a captured token cannot be replayed."""
    token = (access_token or "").strip() if isinstance(access_token, str) else ""
    if not token or not (widget_mode() and sms_configured()):
        return False
    marker = hmac_hex(token, "widget")
    if PhoneOtp.query.filter_by(purpose="widget_used", code_hash=marker).first():
        return False
    if not verify_widget_token(token, phone, normalize_phone):
        return False
    db.session.add(PhoneOtp(phone=phone, purpose="widget_used", code_hash=marker, consumed=True,
                            expires_at=datetime.utcnow() + timedelta(days=1)))
    db.session.commit()
    return True


# ── Phone OTP ────────────────────────────────────────────────────────────────
@auth_bp.route("/otp/send", methods=["POST"])
@limiter.limit("5/minute")
@limiter.limit("20/hour")
def otp_send():
    """Send a 6-digit code to a mobile number.
    purpose='signup': number must not belong to an account yet.
    purpose='login' : number must belong to an account.
    Either way the response is the same generic 200, so this endpoint cannot be
    used to discover which numbers are registered."""
    if widget_mode():
        # In widget mode MSG91 sends and checks the code from the browser.
        return jsonify({"error": "Codes are sent by the verification widget.", "code": "USE_WIDGET"}), 400
    data = request.get_json(silent=True) or {}
    purpose = data.get("purpose")
    phone = normalize_phone(data.get("phone"))
    if purpose not in ("signup", "login") or not phone:
        return jsonify({"error": "Enter a valid 10-digit Indian mobile number."}), 400

    generic = {"message": "If this number can receive a code, it is on its way.", "resend_in": int(OTP_RESEND_COOLDOWN.total_seconds())}
    try:
        exists = _user_by_phone(phone) is not None   # verified holders only
        if (purpose == "login" and not exists) or (purpose == "signup" and exists):
            return jsonify(generic), 200

        last = (PhoneOtp.query.filter_by(phone=phone, purpose=purpose)
                .order_by(PhoneOtp.created_at.desc()).first())
        if last and datetime.utcnow() - last.created_at < OTP_RESEND_COOLDOWN:
            return jsonify(generic), 200
        # Per-number cap, independent of who is asking: stops SMS-bombing a victim
        # and bounds how many guesses can ever be made against one number per hour.
        # Answers with the same generic 200 so the cap itself reveals nothing.
        hour_ago = datetime.utcnow() - timedelta(hours=1)
        sent_last_hour = PhoneOtp.query.filter(
            PhoneOtp.phone == phone, PhoneOtp.purpose == purpose, PhoneOtp.created_at >= hour_ago).count()
        if sent_last_hour >= OTP_MAX_SENDS_PER_HOUR:
            return jsonify(generic), 200

        code = f"{secrets.randbelow(1_000_000):06d}"
        db.session.add(PhoneOtp(
            phone=phone, purpose=purpose, code_hash=hmac_hex(f"{phone}:{purpose}:{code}", "otp"),
            expires_at=datetime.utcnow() + OTP_TTL,
        ))
        db.session.commit()
        if not send_otp_sms(phone, code) and sms_configured():
            return jsonify({"error": "We could not send the code right now. Please try again shortly.", "code": "SMS_FAILED"}), 503
        return jsonify(generic), 200
    except Exception as e:
        db.session.rollback()
        print(f"[otp_send] error: {e}")
        return jsonify({"error": "Something went wrong. Please try again.", "code": "INTERNAL_ERROR"}), 500


def _consume_otp(phone, purpose, code):
    """True if `code` is the live, unused code for this number. Counts every
    wrong guess; after OTP_MAX_ATTEMPTS the code is dead and must be re-sent."""
    hour_ago = datetime.utcnow() - timedelta(hours=1)
    guesses = db.session.query(db.func.coalesce(db.func.sum(PhoneOtp.attempts), 0)).filter(
        PhoneOtp.phone == phone, PhoneOtp.purpose == purpose, PhoneOtp.created_at >= hour_ago).scalar() or 0
    if guesses >= OTP_MAX_GUESSES_PER_HOUR:
        return False
    row = (PhoneOtp.query.filter_by(phone=phone, purpose=purpose, consumed=False)
           .order_by(PhoneOtp.created_at.desc()).first())
    if not row or row.expires_at < datetime.utcnow() or row.attempts >= OTP_MAX_ATTEMPTS:
        return False
    row.attempts += 1
    ok = bool(re.fullmatch(r"\d{6}", code or "")) and secrets.compare_digest(
        row.code_hash, hmac_hex(f"{phone}:{purpose}:{code}", "otp"))
    if ok:
        row.consumed = True
    db.session.commit()
    return ok


@auth_bp.route("/otp/verify", methods=["POST"])
@limiter.limit("10/minute")
def otp_verify():
    """Check a signup code. Returns a short-lived signed phone_token that
    /register requires, so the number on the account is one the person holds."""
    data = request.get_json(silent=True) or {}
    phone = normalize_phone(data.get("phone"))
    if not phone:
        return jsonify({"error": "Enter a valid 10-digit Indian mobile number."}), 400
    try:
        if widget_mode():
            proved = _widget_proof(phone, data.get("access_token")) and _user_by_phone(phone) is None
        else:
            proved = _consume_otp(phone, "signup", (data.get("code") or "").strip())
        if not proved:
            return jsonify({"error": "That code is incorrect or has expired.", "code": "OTP_INVALID"}), 400
        return jsonify({"phone": phone, "phone_token": generate_phone_token(phone)}), 200
    except Exception as e:
        db.session.rollback()
        print(f"[otp_verify] error: {e}")
        return jsonify({"error": "Something went wrong. Please try again.", "code": "INTERNAL_ERROR"}), 500


@auth_bp.route("/otp/login", methods=["POST"])
@limiter.limit("10/minute")
def otp_login():
    """Sign in with mobile number + code (no password)."""
    data = request.get_json(silent=True) or {}
    phone = normalize_phone(data.get("phone"))
    if not phone:
        return jsonify({"error": "Enter a valid 10-digit Indian mobile number."}), 400
    try:
        user = _user_by_phone(phone)
        step = verify_login_step_token(data.get("login_token") or "") if data.get("login_token") else None
        if step:
            # Second request of a two-step sign-in: the SMS code was already spent, the token proves it.
            if not user or step != (user.id, phone):
                return jsonify({"error": "That sign-in has expired. Start again.", "code": "OTP_INVALID"}), 401
        elif not user or not (_widget_proof(phone, data.get("access_token")) if widget_mode()
                              else _consume_otp(phone, "login", (data.get("code") or "").strip())):
            # Same error for "no such account" and "wrong code".
            return jsonify({"error": "That code is incorrect or has expired.", "code": "OTP_INVALID"}), 401
        # A phone code is one factor. Accounts that switched on authenticator two-step
        # sign-in must still pass it, or SIM-swap would bypass it entirely.
        gate = current_app.extensions.get("lpms_login_gate")
        if gate:
            try:
                blocked = gate(user, data.get("totp"))
            except Exception as exc:
                print(f"[otp_login] practice gate skipped: {exc}")
                blocked = None
            if blocked:
                body = dict(blocked[0])
                if body.get("code") == "MFA_REQUIRED":
                    body["login_token"] = generate_login_step_token(user.id, phone)
                return jsonify(body), blocked[1]
        _practice_event("lpms_login_event", user, True)
        return _issue_session_response({"user": {"id": user.id, "email": user.email, "name": user.name}}, user.id)
    except Exception as e:
        db.session.rollback()
        print(f"[otp_login] error: {e}")
        return jsonify({"error": "Something went wrong. Please try again.", "code": "INTERNAL_ERROR"}), 500


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
@limiter.limit("10/hour")
def register_user():
    try:
        data = request.get_json(silent=True) or {}
        email = (data.get('email') or '').strip().lower()
        password = data.get('password') or ''
        name = (data.get('name') or data.get('full_name') or (email.split('@')[0] if email else '')).strip()

        if not email or not password:
            return jsonify({"error": "Email and password required"}), 400
        if not EMAIL_RE.match(email) or len(email) > 120:
            return jsonify({"error": "Enter a valid email address."}), 400
        if len(password) < 8:
            return jsonify({"error": "Password must be at least 8 characters."}), 400
        if len(password) > MAX_PASSWORD_LEN:
            return jsonify({"error": f"Password must be at most {MAX_PASSWORD_LEN} characters."}), 400
        if not name or len(name) > 120:
            return jsonify({"error": "Enter your full name (up to 120 characters)."}), 400

        # Mobile number: when SMS is live it must be the one the person just
        # verified with a code; otherwise it is stored as a normalised number.
        phone = normalize_phone(data.get('phone'))
        if data.get('phone') and not phone:
            return jsonify({"error": "Enter a valid 10-digit Indian mobile number."}), 400
        if _phone_otp_required():
            verified = verify_phone_token(data.get('phone_token') or '')
            if not phone or verified != phone:
                return jsonify({"error": "Please verify your mobile number with the code we send you.", "code": "PHONE_NOT_VERIFIED"}), 400

        if User.query.filter_by(email=email).first():
            return jsonify({"error": "An account with this email already exists. Try signing in instead."}), 409
        # Only a number somebody has already proved blocks a new claim. Anyone who
        # proves a number now takes it over from unverified entries (typos, squatting).
        phone_proved = bool(phone) and _phone_otp_required()
        if phone and _user_by_phone(phone):
            return jsonify({"error": "An account with this mobile number already exists. Try signing in instead."}), 409

        user = User(
            email=email,
            password=generate_password_hash(password),
            name=name,
            phone=phone,
            phone_verified=phone_proved,
        )
        try:
            if phone_proved:
                User.query.filter(User.phone.in_(_phone_variants(phone)), User.phone_verified.is_(False)).update(
                    {"phone": None}, synchronize_session=False)
            db.session.add(user)
            db.session.commit()
        except Exception as e:
            db.session.rollback()
            print(f"[register] commit failed: {e}")
            return jsonify({"error": "Registration failed. Please try again.", "code": "INTERNAL_ERROR"}), 500

        return _issue_session_response(
            {"message": "Account created.", "user": {"id": user.id, "email": user.email, "name": user.name, "phone": user.phone}},
            user.id, status=201,
        )
    except Exception as e:
        db.session.rollback()
        print(f"[register] error: {e}")
        return jsonify({"error": "Registration failed. Please try again.", "code": "INTERNAL_ERROR"}), 500


def _practice_event(name, user, ok, reason=None):
    """Tell the Practice module about a sign-in (it keeps the login history). Never raises."""
    fn = current_app.extensions.get(name)
    if fn and user is not None:
        try:
            fn(user, ok, reason)
        except Exception as exc:
            print(f"[login] practice log skipped: {exc}")


@auth_bp.route('/login', methods=['POST'])
@limiter.limit("10/minute")
def login_user():
    try:
        data = request.get_json(silent=True) or {}
        email = (data.get('email') or data.get('username') or '').strip().lower()
        password = data.get('password') or ''

        if not email or not password:
            return jsonify({"error": "Missing credentials"}), 400

        # A Neon database that went to sleep (or dropped an idle pooled connection) fails the first query
        # with an OperationalError; the same query a moment later succeeds. Retry once on a fresh
        # connection before giving up, so the person never sees that first failure.
        try:
            user = User.query.filter_by(email=email).first()
        except DBAPIError:
            db.session.rollback()
            db.session.remove()
            user = User.query.filter_by(email=email).first()

        # No auto-creation on login — an unrecognized email is a straight
        # 401, same message as a wrong password, so a brute-forcer can't
        # use this endpoint to enumerate which emails have accounts.
        if not user or not check_password_hash(user.password, password):
            _practice_event("lpms_login_event", user, False, "Wrong password")
            return jsonify({"error": "Invalid email or password."}), 401

        # Practice module: two-step sign-in (TOTP) for accounts that turned it on. Only an explicit "code needed / wrong code"
        # stops the login; a problem inside the Practice module never locks anyone out of the app.
        gate = current_app.extensions.get("lpms_login_gate")
        if gate:
            try:
                blocked = gate(user, data.get("otp"))
            except Exception as exc:
                print(f"[login] practice gate skipped: {exc}")
                blocked = None
            if blocked:
                return jsonify(blocked[0]), blocked[1]
        _practice_event("lpms_login_event", user, True)

        return _issue_session_response(
            {"user": {"id": user.id, "email": user.email, "name": user.name}},
            user.id,
        )
    except DBAPIError as e:
        # The database is still waking up: say so (503), which the login page retries by itself.
        db.session.rollback()
        print(f"[login] database not ready: {e}")
        return jsonify({"error": "The database is waking up. Please try again in a few seconds.", "code": "DB_WAKING"}), 503
    except Exception as e:
        print(f"[login] error: {e}")
        return jsonify({"error": "Sign-in failed. Please try again.", "code": "INTERNAL_ERROR"}), 500


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


def _user_payload(user):
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "phone": user.phone,
        "role": user.role,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }


@auth_bp.route('/me', methods=['GET'])
@jwt_required()
def current_user():
    """Cookie-derived identity check — lets the frontend confirm an
    existing session on page load without ever touching localStorage."""
    user_id = get_jwt_identity()
    try:
        user = User.query.get(int(user_id))
        if not user:
            return jsonify({"error": "Session user not found."}), 404
        return jsonify({"user": _user_payload(user)}), 200
    except Exception as e:
        print(f"[auth] unexpected error: {e}")
        return jsonify({"error": "Something went wrong. Please try again.", "code": "INTERNAL_ERROR"}), 500


@auth_bp.route('/me', methods=['PATCH'])
@jwt_required()
def update_current_user():
    """Account Settings → Profile: updates the advocate's own display name
    and phone number. Email is intentionally read-only here — it is the
    sign-in identity, so changing it belongs in a dedicated, verified flow,
    not a quiet profile-form field."""
    user_id = get_jwt_identity()
    try:
        user = User.query.get(int(user_id))
        if not user:
            return jsonify({"error": "Session user not found."}), 404

        data = request.get_json(silent=True) or {}

        if 'name' in data:
            name = (data.get('name') or '').strip()
            if not name:
                return jsonify({"error": "Name cannot be empty."}), 400
            if len(name) > 120:
                return jsonify({"error": "Name is too long."}), 400
            user.name = name

        if 'phone' in data:
            phone = (data.get('phone') or '').strip()
            if phone and len(phone) > 20:
                return jsonify({"error": "Phone number is too long."}), 400
            if (phone or None) != user.phone:
                user.phone = phone or None
                user.phone_verified = False   # a changed number has not been proved

        db.session.commit()
        return jsonify({"user": _user_payload(user)}), 200
    except Exception as e:
        db.session.rollback()
        print(f"[auth] unexpected error: {e}")
        return jsonify({"error": "Something went wrong. Please try again.", "code": "INTERNAL_ERROR"}), 500


@auth_bp.route('/change-password', methods=['POST'])
@jwt_required()
def change_password():
    """Account Settings → Security: change password while already signed
    in (requires the current password), as distinct from the existing
    signed-out forgot/reset-password email flow above."""
    user_id = get_jwt_identity()
    try:
        user = User.query.get(int(user_id))
        if not user:
            return jsonify({"error": "Session user not found."}), 404

        data = request.get_json(silent=True) or {}
        current_password = (data.get('current_password') or '').strip()
        new_password = (data.get('new_password') or '').strip()

        if not current_password or not new_password:
            return jsonify({"error": "Current and new password are required."}), 400
        if len(new_password) < 8:
            return jsonify({"error": "New password must be at least 8 characters."}), 400
        if not check_password_hash(user.password, current_password):
            return jsonify({"error": "Current password is incorrect."}), 401

        user.password = generate_password_hash(new_password)
        db.session.commit()
        return jsonify({"message": "Password updated."}), 200
    except Exception as e:
        db.session.rollback()
        print(f"[auth] unexpected error: {e}")
        return jsonify({"error": "Something went wrong. Please try again.", "code": "INTERNAL_ERROR"}), 500


@auth_bp.route('/forgot-password', methods=['POST'])
@limiter.limit("3/hour")
def forgot_password():
    GENERIC_MESSAGE = {"message": "If an account exists for that email, a reset link has been sent."}
    is_dev = os.getenv('FLASK_ENV') != 'production'
    try:
        data = request.get_json(silent=True) or {}
        email = (data.get('email') or '').strip().lower()
        if not email:
            # Still generic — do not reveal that the request shape itself was wrong
            # in a way that would distinguish "no such field" from "no such user".
            return jsonify(GENERIC_MESSAGE), 200

        user = User.query.filter_by(email=email).first()

        mail_sent = True
        if user:
            reset_token = generate_reset_token(email, user.password)
            frontend_origin = _frontend_origin(data.get('frontend_origin'))
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
            print(f"[auth] unexpected error: {e}")
            return jsonify({"error": "Something went wrong. Please try again.", "code": "INTERNAL_ERROR"}), 503
        # Never leak internal errors in production either — an error state
        # must not become a third distinguishable response an enumeration
        # attack could key off.
        return jsonify(GENERIC_MESSAGE), 200


@auth_bp.route('/reset-password', methods=['POST'])
@limiter.limit("5/hour")
def reset_password():
    try:
        data = request.get_json(silent=True) or {}
        token = data.get('token') or ''
        new_password = data.get('password') or ''

        if not token or not new_password:
            return jsonify({"error": "Token and new password are required."}), 400
        if len(new_password) < 8:
            return jsonify({"error": "Password must be at least 8 characters."}), 400
        if len(new_password) > MAX_PASSWORD_LEN:
            return jsonify({"error": f"Password must be at most {MAX_PASSWORD_LEN} characters."}), 400

        verified = verify_reset_token(token, max_age_seconds=3600)
        if not verified:
            return jsonify({"error": "This reset link is invalid or has expired."}), 400
        email, fingerprint = verified

        user = User.query.filter_by(email=email).first()
        # fingerprint check = single use: once the password changes, this link is dead.
        if not user or not reset_fingerprint_matches(fingerprint, user.password):
            return jsonify({"error": "This reset link is invalid or has expired."}), 400

        user.password = generate_password_hash(new_password)
        db.session.commit()
        return jsonify({"message": "Password updated. You can now sign in."}), 200
    except Exception as e:
        db.session.rollback()
        print(f"[reset_password] error: {e}")
        return jsonify({"error": "Could not reset the password. Please try again.", "code": "INTERNAL_ERROR"}), 500
