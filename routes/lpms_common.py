"""
routes/lpms_common.py - the plumbing shared by the Practice (Legal Practice Management) route modules:
errors, input checking, and `Env`, which gives every route its database connection, the signed-in member,
the firm's settings and the permission checks (role, IP allow-list, two-step requirement) in one decorator.
"""
import contextlib
import functools
import re

from flask import g, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from utils import lpms_store as L


class ApiError(Exception):
    def __init__(self, message, status=400, **extra):
        super().__init__(message)
        self.message, self.status, self.extra = message, status, extra


def err(message, status=400, **extra):
    return jsonify({"error": True, "message": message, **extra}), status


def as_int(v, default=None):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def truthy(v):
    return str(v).lower() in ("1", "true", "yes", "on")


def text(v, limit, label="This field", required=False):
    s = "" if v is None else str(v).strip()
    if required and not s:
        raise ApiError(f"{label} is required.", 400, field=label)
    if len(s) > limit:
        raise ApiError(f"{label} is too long (at most {limit} characters).", 400)
    return s or None


def date_of(v, label="Date", required=False):
    if v in (None, ""):
        if required:
            raise ApiError(f"{label} is required.", 400)
        return None
    try:
        return L.parse_date(v).isoformat()
    except (ValueError, TypeError):
        raise ApiError(f"{label} must be a date like 2026-10-31.", 400)


def time_of(v, label="Time"):
    if v in (None, ""):
        return None
    s = str(v).strip()
    if not L._TIME_RE.match(s):
        raise ApiError(f"{label} must be like 10:30.", 400)
    return s


def choice(v, options, label, default=None, required=False):
    if v in (None, ""):
        if default is not None:
            return default
        if required:
            raise ApiError(f"{label} is required.", 400)
        return None
    s = str(v).strip()
    for o in options:
        if o.lower() == s.lower():
            return o
    raise ApiError(f"{label} must be one of: {', '.join(options)}.", 400)


def email_of(v, label="Email"):
    s = text(v, 160, label)
    if s and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", s):
        raise ApiError(f"{label} does not look right.", 400)
    return s.lower() if s else None


def phone_of(v, label="Phone"):
    s = text(v, 30, label)
    if s and not re.fullmatch(r"[0-9+()\-\s.]{6,30}", s):
        raise ApiError(f"{label} may only contain digits, spaces and + - ( ).", 400)
    return s


def like(q):
    """Escape nothing fancy: LIKE here is only ever used on lower-cased text with % wildcards we add ourselves."""
    return f"%{(q or '').strip().lower()}%"


class Env:
    """One per blueprint. `api(...)` wraps a view with: JWT, OPTIONS, the member lookup, IP allow-list, two-step requirement,
    and an optional permission check."""

    def __init__(self, bp, deps):
        self.bp, self.deps = bp, deps
        self.db_path = deps["db_path"]
        self.get_user = deps.get("get_user") or (lambda uid: None)
        self.find_user = deps.get("find_user") or (lambda email: None)
        self.create_user = deps.get("create_user")
        self.set_password = deps.get("set_password")
        self.send_email = deps.get("send_email") or (lambda to, subject, body: False)
        self.email_configured = deps.get("email_configured") or (lambda: False)
        self.log = deps.get("log") or (lambda m: None)
        self.scheduler = None
        self._kick = None

    # ── connection / tx ─────────────────────────────────────────────────────────────
    def conn(self):
        c = getattr(g, "_lpms_conn", None)
        if c is None:
            c = g._lpms_conn = L.connect(self.db_path)
        return c

    def begin(self):
        c = self.conn()
        if c.in_transaction:
            c.commit()
        c.execute("BEGIN IMMEDIATE")
        return c

    def tx(self):
        env = self

        class Tx:
            def __enter__(self):
                return env.begin()

            def __exit__(self, et, ev, tb):
                c = env.conn()
                if et is None:
                    c.commit()
                else:
                    c.rollback()
                return False

        return Tx()

    def close(self):
        c = getattr(g, "_lpms_conn", None)
        if c is not None:
            with contextlib.suppress(Exception):
                c.rollback()
                c.close()
            g._lpms_conn = None

    # ── who is asking ───────────────────────────────────────────────────────────────
    @staticmethod
    def uid():
        return int(get_jwt_identity())

    @staticmethod
    def ip():
        return request.remote_addr or ""

    @property
    def m(self):
        return g.lpms_member

    @property
    def settings(self):
        return g.lpms_settings

    @property
    def perms(self):
        return g.lpms_perms

    def need(self, perm, message=None):
        if not self.perms.get(perm):
            raise ApiError(message or "Your role does not allow this.", 403, code="FORBIDDEN")

    def audit(self, action, entity=None, entity_id=None, summary=None, detail=None, member=None):
        m = member or self.m
        L.audit(self.conn(), m["firm_id"], m["user_id"], m["name"], action, entity, entity_id, summary, detail, self.ip())

    def kick_email(self):
        if self._kick:
            self._kick()

    # ── the decorator ───────────────────────────────────────────────────────────────
    def api(self, rule, methods=("GET",), perm=None, firm=True, exempt_ip=False, exempt_mfa=False, settings_route=False):
        env = self

        def deco(fn):
            @env.bp.route(rule, methods=list(methods) + ["OPTIONS"], endpoint=fn.__name__)
            @jwt_required()
            @functools.wraps(fn)
            def wrapper(*a, **kw):
                if request.method == "OPTIONS":
                    return jsonify({}), 200
                c = env.conn()
                uid = env.uid()
                if firm:
                    m = L.member_for_user(c, uid)
                    if not m:
                        raise ApiError("Set up your practice first, or ask your Senior Advocate to add you.", 403, code="NO_FIRM")
                    st = L.firm_settings(c, m["firm_id"])
                    g.lpms_member, g.lpms_settings, g.lpms_perms = m, st, L.permissions(m, st)
                    if st.get("ip_enabled") and not L.ip_allowed(env.ip(), st.get("ip_allow")):
                        if not (exempt_ip or (settings_route and m["role"] == "senior")):
                            raise ApiError("This network is not on your firm's list of allowed addresses.", 403, code="IP_BLOCKED", ip=env.ip())
                    if st.get("mfa_required") and not exempt_mfa and not L.mfa_enabled(c, uid):
                        raise ApiError("Your firm requires two-step sign-in. Set it up to continue.", 403, code="MFA_SETUP")
                if perm:
                    env.need(perm)
                return fn(*a, **kw)
            return wrapper
        return deco

    # ── lookups every module needs ──────────────────────────────────────────────────
    def get_case(self, case_id, write=False, full=False, allow_archived=False):
        """A case the member may see (404 otherwise). write -> must be allowed to update it; full -> senior only."""
        c, m = self.conn(), self.m
        vis, p = L.case_visible_sql(m, "c")
        row = L.one(c, f"SELECT c.* FROM lpms_cases c WHERE c.id = :id AND {vis}", {**p, "id": case_id})
        if not row:
            raise ApiError("Case not found.", 404)
        level = L.case_write_level(m, self.settings, row, c)
        row["_level"] = level
        if full and level != "full":
            raise ApiError("Only a Senior Advocate can do this.", 403, code="FORBIDDEN")
        if write and level is None:
            raise ApiError("You can update only the cases assigned to you. Ask a Senior Advocate if you need access to this one.", 403, code="FORBIDDEN")
        if write and row["archived_at"] and not allow_archived:
            raise ApiError("This case is archived. Restore it to make changes.", 409, code="ARCHIVED")
        return row

    def member_in_firm(self, member_id, label="Advocate", advocates_only=False, required=False):
        if member_id in (None, ""):
            if required:
                raise ApiError(f"{label} is required.", 400)
            return None
        mid = as_int(member_id)
        r = L.one(self.conn(), "SELECT * FROM lpms_members WHERE id = ? AND firm_id = ? AND active = 1", (mid, self.m["firm_id"]))
        if not r:
            raise ApiError(f"{label} was not found in your firm.", 400)
        if advocates_only and r["role"] == "staff":
            raise ApiError("Office staff cannot be assigned as the advocate on a case.", 400)
        return r["id"]

    def client_in_firm(self, client_id):
        if client_id in (None, ""):
            return None
        cid = as_int(client_id)
        r = L.one(self.conn(), "SELECT id FROM lpms_clients WHERE id = ? AND firm_id = ?", (cid, self.m["firm_id"]))
        if not r:
            raise ApiError("That client was not found.", 400)
        return r["id"]

    def names(self, ids):
        ids = [i for i in set(ids) if i]
        if not ids:
            return {}
        marks = ",".join("?" for _ in ids)
        return {r["id"]: r["name"] for r in self.conn().execute(f"SELECT id, name FROM lpms_members WHERE id IN ({marks})", ids)}

    def holiday_warnings(self, day_iso):
        """Soft warnings for a hearing date: a weekend, or a court holiday the firm has recorded."""
        out = []
        try:
            d = L.parse_date(day_iso)
        except ValueError:
            return out
        if d.weekday() == 6:
            out.append("That date is a Sunday.")
        elif d.weekday() == 5:
            out.append("That date is a Saturday.")
        h = L.one(self.conn(), "SELECT title FROM lpms_events WHERE firm_id = ? AND kind = 'holiday' AND ? BETWEEN start_date AND COALESCE(end_date, start_date) LIMIT 1",
                  (self.m["firm_id"], day_iso))
        if h:
            out.append(f"That date is marked as a court holiday: {h['title']}.")
        return out
