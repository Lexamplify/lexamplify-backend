"""
routes/lpms_core.py - Practice: the firm, the team, settings & security, notifications, the audit log,
search and the dashboard.
"""
import csv
import io
import threading
import time
from datetime import timedelta

from flask import Response, jsonify, request

from routes.lpms_common import ApiError, as_int, choice, date_of, email_of, like, phone_of, text, truthy
from utils import lpms_reports as R
from utils import lpms_store as L

AUDIT_GROUPS = {
    "sign-in": ["login", "login_failed", "logout", "mfa_ok", "mfa_failed", "mfa_locked", "mfa_enabled", "mfa_disabled", "mfa_reset", "mfa_recovery"],
    "cases": ["case_%"], "hearings": ["hearing_%", "proceeding_%"], "documents": ["document_%"], "clients": ["client_%", "followup_%", "comm_%"],
    "rti": ["rti_%"], "calendar": ["event_%"], "team": ["member_%", "settings_%", "firm_%"], "notifications": ["notification_%"],
    "reports": ["report_%", "backup_%"],
}
ALLOWED_REMINDER_DAYS = [0, 1, 2, 3, 5, 7, 10, 14, 30]


def meta_payload():
    return {"roles": [{"key": k, "label": L.ROLE_LABEL[k]} for k in L.ROLES], "case_types": L.CASE_TYPES, "statuses": L.STATUSES,
            "closed_statuses": list(L.CLOSED_STATUSES), "priorities": L.PRIORITIES, "hearing_statuses": L.HEARING_STATUSES, "outcomes": L.OUTCOMES,
            "party_roles": L.PARTY_ROLES, "comm_channels": L.COMM_CHANNELS, "comm_prefs": L.COMM_PREFS, "rti_statuses": L.RTI_STATUSES,
            "event_kinds": L.EVENT_KINDS, "id_types": L.ID_TYPES, "audit_groups": list(AUDIT_GROUPS), "reminder_days": ALLOWED_REMINDER_DAYS}


def register(env):
    deps = env.deps
    _sweep_at = {}

    # ── e-mail outbox ───────────────────────────────────────────────────────────────
    def kick():
        if not env.email_configured():
            L.mark_unconfigured_outbox(env.db_path)
        elif deps.get("sync_email"):
            L.flush_outbox(env.db_path, env.send_email)
        else:
            threading.Thread(target=L.flush_outbox, args=(env.db_path, env.send_email), daemon=True).start()
    env._kick = kick

    def sweep_if_due(max_age=900):
        """Run the reminder engine for this firm when nothing has run lately - so a host that was asleep catches up as soon
        as anyone opens the app. De-duplication keys make a repeat harmless."""
        m, c = env.m, env.conn()
        now = time.time()
        if now - _sweep_at.get(m["firm_id"], 0) < 60:
            return
        _sweep_at[m["firm_id"]] = now
        last = c.execute("SELECT ran_at FROM lpms_reminder_runs WHERE firm_id = ?", (m["firm_id"],)).fetchone()
        if last and now - last[0] < max_age:
            return
        try:
            with env.tx() as tc:
                L.run_reminders(tc, m["firm_id"])
            kick()
        except Exception as exc:
            env.log(f"reminder catch-up failed: {exc}")

    env.sweep_if_due = sweep_if_due

    # ── me / firm ───────────────────────────────────────────────────────────────────
    def me_payload(uid):
        c = env.conn()
        user = env.get_user(uid) or {}
        m = L.member_for_user(c, uid)
        out = {"user": {"id": uid, "name": user.get("name"), "email": user.get("email")}, "member": None, "meta": meta_payload(),
               "email_configured": bool(env.email_configured()), "ip": env.ip()}
        mfa = L.mfa_row(c, uid)
        out["mfa"] = {"enabled": bool(mfa and mfa["enabled"]), "recovery_left": len(L.jloads(mfa["recovery"], [])) if mfa and mfa["enabled"] else 0}
        if not m:
            return out
        st = L.firm_settings(c, m["firm_id"])
        perms = L.permissions(m, st)
        blocked = bool(st.get("ip_enabled") and not L.ip_allowed(env.ip(), st.get("ip_allow")))
        out["mfa"]["required"] = bool(st.get("mfa_required"))
        out["mfa"]["pending"] = bool(st.get("mfa_required") and not out["mfa"]["enabled"])
        out["blocked"] = "ip" if blocked else None
        out["member"] = {"id": m["id"], "name": m["name"], "role": m["role"], "role_label": L.ROLE_LABEL[m["role"]], "email": m["email"], "phone": m["phone"],
                         "email_notify": bool(m["email_notify"])}
        out["firm"] = {"id": m["firm_id"], "name": m["firm_name"], "whatsapp": bool(st["channels"].get("whatsapp", True))}
        out["perms"] = perms
        if not blocked:
            out["unread"] = c.execute("SELECT COUNT(*) FROM lpms_notifications WHERE user_id = ? AND read_at IS NULL", (uid,)).fetchone()[0]
        return out

    @env.api("/me", firm=False)
    def me():
        uid = env.uid()
        c = env.conn()
        m = L.member_for_user(c, uid)
        if m and (not m["last_seen"] or time.time() - time.mktime(time.strptime(m["last_seen"], "%Y-%m-%d %H:%M:%S")) + time.timezone > 600):
            with env.tx() as tc:
                tc.execute("UPDATE lpms_members SET last_seen = ? WHERE id = ?", (L.now_iso(), m["id"]))
        return jsonify(me_payload(uid))

    @env.api("/me", methods=("PATCH",))
    def update_me():
        b = request.get_json(silent=True) or {}
        with env.tx() as c:
            name = text(b["name"], 120, "Name", required=True) if "name" in b else env.m["name"]
            phone = phone_of(b["phone"]) if "phone" in b else env.m["phone"]
            notify_me = 1 if truthy(b.get("email_notify", env.m["email_notify"])) else 0
            c.execute("UPDATE lpms_members SET name = ?, phone = ?, email_notify = ? WHERE id = ?", (name, phone, notify_me, env.m["id"]))
        return jsonify(me_payload(env.uid()))

    @env.api("/firm", methods=("POST",), firm=False)
    def create_firm():
        uid, c = env.uid(), env.conn()
        if L.member_for_user(c, uid):
            raise ApiError("You are already part of a practice.", 409)
        b = request.get_json(silent=True) or {}
        name = text(b.get("name"), 120, "Practice name", required=True)
        if len(name) < 2:
            raise ApiError("Give the practice a name of at least two letters.", 400)
        user = env.get_user(uid) or {}
        with env.tx() as tc:
            fid = tc.execute("INSERT INTO lpms_firms (name, owner_user_id, settings, created_at) VALUES (?,?,?,?)",
                             (name, uid, "{}", L.now_iso())).lastrowid
            tc.execute("INSERT INTO lpms_members (firm_id, user_id, role, name, email, phone, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)",
                             (fid, uid, "senior", text(b.get("your_name"), 120) or user.get("name") or "Senior Advocate", user.get("email"),
                              phone_of(b.get("phone")) or user.get("phone"), uid, L.now_iso()))
            L.audit(tc, fid, uid, user.get("name"), "firm_create", "firm", fid, f"Practice “{name}” created", ip=env.ip())
        return jsonify(me_payload(uid)), 201

    # ── team ────────────────────────────────────────────────────────────────────────
    def member_dict(r, full):
        d = {"id": r["id"], "user_id": r["user_id"], "name": r["name"], "role": r["role"], "role_label": L.ROLE_LABEL[r["role"]], "email": r["email"],
             "phone": r["phone"], "active": bool(r["active"])}
        if full:
            d.update({"last_seen": r["last_seen"], "managed": bool(r["managed"]), "created_at": r["created_at"]})
        return d

    @env.api("/members")
    def members():
        c, m = env.conn(), env.m
        rows_ = L.members_of(c, m["firm_id"], active_only=not truthy(request.args.get("all")) or m["role"] != "senior")
        full = m["role"] == "senior"
        out = [member_dict(r, full) for r in rows_]
        counts = {r["advocate_id"]: r["n"] for r in c.execute(
            "SELECT advocate_id, COUNT(*) AS n FROM lpms_cases WHERE firm_id = ? AND closed_at IS NULL AND archived_at IS NULL GROUP BY advocate_id", (m["firm_id"],))}
        for d in out:
            d["active_cases"] = counts.get(d["id"], 0)
            if full:
                d["mfa"] = L.mfa_enabled(c, d["user_id"])
        return jsonify({"members": out})

    def _last_senior_guard(c, target, new_role=None, new_active=None):
        if target["role"] == "senior" and ((new_role and new_role != "senior") or new_active == 0):
            n = c.execute("SELECT COUNT(*) FROM lpms_members WHERE firm_id = ? AND role = 'senior' AND active = 1 AND id != ?", (target["firm_id"], target["id"])).fetchone()[0]
            if n == 0:
                raise ApiError("A practice needs at least one Senior Advocate. Make someone else a Senior Advocate first.", 409)

    @env.api("/members", methods=("POST",), perm="manage_team")
    def add_member():
        b = request.get_json(silent=True) or {}
        c, m = env.conn(), env.m
        email = email_of(b.get("email"), "Email")
        if not email:
            raise ApiError("Email is required.", 400)
        role = choice(b.get("role"), L.ROLES, "Role", default="junior")
        name = text(b.get("name"), 120, "Name")
        phone = phone_of(b.get("phone"))
        existing = env.find_user(email)
        managed, password = 0, b.get("password") or ""
        if existing:
            if not truthy(b.get("link_existing")):
                raise ApiError("That email already has a LexAmplify account. You can add that person to your practice; they will keep their own password.",
                               409, code="EXISTS", existing_name=existing.get("name"))
            uid = int(existing["id"])
            if L.member_for_user(c, uid):
                raise ApiError("That person already belongs to a practice.", 409)
            name = name or existing.get("name") or email.split("@")[0]
        else:
            if not name:
                raise ApiError("Name is required.", 400)
            if len(password) < 8:
                raise ApiError("Give them a temporary password of at least 8 characters.", 400)
            if not env.create_user:
                raise ApiError("Creating accounts is not available here.", 501)
            uid, managed = int(env.create_user(name, email, password, phone)), 1
        with env.tx() as tc:
            old = L.one(tc, "SELECT id FROM lpms_members WHERE user_id = ? AND firm_id = ?", (uid, m["firm_id"]))
            if old:
                tc.execute("UPDATE lpms_members SET active = 1, role = ?, name = ?, email = ?, phone = ? WHERE id = ?", (role, name, email, phone, old["id"]))
                mid = old["id"]
            else:
                mid = tc.execute("INSERT INTO lpms_members (firm_id, user_id, role, name, email, phone, managed, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                                 (m["firm_id"], uid, role, name, email, phone, managed, env.uid(), L.now_iso())).lastrowid
            env.audit("member_add", "member", mid, f"{name} added as {L.ROLE_LABEL[role]}", {"email": email, "linked_existing": not managed})
            L.notify(tc, m["firm_id"], uid, "assignment", f"Welcome to {m['firm_name']}", f"{m['name']} added you as {L.ROLE_LABEL[role]}.", "/practice", None, f"welcome:{mid}")
        return jsonify({"ok": True, "member": member_dict(L.one(env.conn(), "SELECT * FROM lpms_members WHERE id = ?", (mid,)), True), "managed": bool(managed)}), 201

    def _target_member(member_id):
        t = L.one(env.conn(), "SELECT * FROM lpms_members WHERE id = ? AND firm_id = ?", (member_id, env.m["firm_id"]))
        if not t:
            raise ApiError("Team member not found.", 404)
        return t

    @env.api("/members/<int:member_id>", methods=("PATCH",), perm="manage_team")
    def edit_member(member_id):
        b = request.get_json(silent=True) or {}
        t = _target_member(member_id)
        c = env.conn()
        role = choice(b.get("role"), L.ROLES, "Role", default=t["role"])
        active = 1 if truthy(b.get("active", t["active"])) else 0
        name = text(b["name"], 120, "Name", required=True) if "name" in b else t["name"]
        phone = phone_of(b["phone"]) if "phone" in b else t["phone"]
        _last_senior_guard(c, t, role, active)
        if t["id"] == env.m["id"] and active == 0:
            raise ApiError("You cannot deactivate your own account here. Use “Leave practice” instead.", 409)
        if active and not t["active"] and L.member_for_user(c, t["user_id"]):
            raise ApiError("That person now belongs to another practice.", 409)
        orphaned = 0
        with env.tx() as tc:
            tc.execute("UPDATE lpms_members SET role = ?, active = ?, name = ?, phone = ? WHERE id = ?", (role, active, name, phone, member_id))
            if active == 0:
                orphaned = tc.execute("SELECT COUNT(*) FROM lpms_cases WHERE advocate_id = ? AND closed_at IS NULL AND archived_at IS NULL", (member_id,)).fetchone()[0]
            bits = [x for x in (f"role {L.ROLE_LABEL[t['role']]} → {L.ROLE_LABEL[role]}" if role != t["role"] else "",
                                ("deactivated" if not active else "reactivated") if active != t["active"] else "") if x]
            env.audit("member_update", "member", member_id, f"{t['name']}: " + (", ".join(bits) or "details changed"), {"role": role, "active": active})
        return jsonify({"ok": True, "member": member_dict(L.one(env.conn(), "SELECT * FROM lpms_members WHERE id = ?", (member_id,)), True), "orphaned_cases": orphaned})

    def _still_ours(t):
        """An old membership row proves nothing: the person must be an active member of THIS firm right now (not removed, not moved to another practice)."""
        cur = L.member_for_user(env.conn(), t["user_id"])
        if not t["active"] or not cur or cur["id"] != t["id"] or cur["firm_id"] != env.m["firm_id"]:
            raise ApiError("This person is no longer an active member of your practice.", 403, code="FORBIDDEN")

    @env.api("/members/<int:member_id>/password", methods=("POST",), perm="manage_team")
    def reset_member_password(member_id):
        t = _target_member(member_id)
        _still_ours(t)
        if not t["managed"]:
            raise ApiError("This person had their own LexAmplify account before joining, so only they can change its password (use “Forgot password” on the sign-in page).", 403)
        pw = (request.get_json(silent=True) or {}).get("password") or ""
        if len(pw) < 8:
            raise ApiError("The new password must be at least 8 characters.", 400)
        if not env.set_password:
            raise ApiError("Password changes are not available here.", 501)
        env.set_password(int(t["user_id"]), pw)
        with env.tx():
            env.audit("member_password", "member", member_id, f"Password reset for {t['name']}")
        return jsonify({"ok": True})

    @env.api("/members/<int:member_id>/mfa-reset", methods=("POST",), perm="manage_team")
    def reset_member_mfa(member_id):
        t = _target_member(member_id)
        _still_ours(t)
        with env.tx() as tc:
            tc.execute("DELETE FROM lpms_mfa WHERE user_id = ?", (t["user_id"],))
            env.audit("mfa_reset", "member", member_id, f"Two-step sign-in reset for {t['name']}")
        return jsonify({"ok": True})

    @env.api("/members/leave", methods=("POST",))
    def leave_practice():
        t, c = env.m, env.conn()
        _last_senior_guard(c, t, new_active=0)
        with env.tx() as tc:
            tc.execute("UPDATE lpms_members SET active = 0 WHERE id = ?", (t["id"],))
            env.audit("member_leave", "member", t["id"], f"{t['name']} left the practice", member=t)
        return jsonify({"ok": True})

    # ── settings ────────────────────────────────────────────────────────────────────
    def settings_payload():
        c, m, st = env.conn(), env.m, env.settings
        out = {"firm_name": m["firm_name"], "channels": st["channels"], "triggers": st["triggers"], "reminder_days": st["reminder_days"],
               "recipients": st["recipients"], "client_email_reminders": st["client_email_reminders"], "junior_create_cases": st["junior_create_cases"],
               "junior_scope": st["junior_scope"], "default_court": st["default_court"], "mfa_required": st["mfa_required"],
               "ip_enabled": st["ip_enabled"], "ip_allow": st["ip_allow"], "your_ip": env.ip(), "email_configured": bool(env.email_configured())}
        if m["role"] != "senior":
            out["ip_allow"] = []                                  # the firm's network addresses are for Senior Advocates only
        if m["role"] == "senior":
            out["outbox"] = {r["status"]: r["n"] for r in c.execute("SELECT status, COUNT(*) AS n FROM lpms_outbox WHERE firm_id = ? GROUP BY status", (m["firm_id"],))}
            run = L.one(c, "SELECT ran_at, summary FROM lpms_reminder_runs WHERE firm_id = ?", (m["firm_id"],))
            out["last_run"] = {"at": run["ran_at"], "summary": L.jloads(run["summary"], {})} if run else None
        return out

    @env.api("/settings", settings_route=True)
    def get_settings():
        return jsonify(settings_payload())

    @env.api("/settings", methods=("PUT",), perm="manage_settings", settings_route=True, exempt_mfa=False)
    def put_settings():
        b = request.get_json(silent=True) or {}
        c, m = env.conn(), env.m
        cur = dict(env.settings)
        new = {k: (dict(v) if isinstance(v, dict) else v) for k, v in cur.items()}
        if "reminder_days" in b:
            raw_days = b["reminder_days"] if b["reminder_days"] is not None else []
            if not isinstance(raw_days, list) or any(isinstance(x, (bool, dict, list)) or as_int(x) is None for x in raw_days):
                raise ApiError("Reminder days must be a list of numbers, like [7, 3, 1].", 400)
            days = sorted({as_int(x) for x in raw_days})
            if any(d not in ALLOWED_REMINDER_DAYS for d in days):
                raise ApiError(f"Reminder days can be any of: {', '.join(map(str, ALLOWED_REMINDER_DAYS))}.", 400)
            new["reminder_days"] = sorted(days, reverse=True)
        for key in ("channels", "triggers"):
            if isinstance(b.get(key), dict):
                new[key].update({k: bool(v) for k, v in b[key].items() if k in new[key]})
        if "recipients" in b:
            new["recipients"] = choice(b["recipients"], ["advocate", "advocate_and_seniors"], "Recipients")
        if "junior_scope" in b:
            new["junior_scope"] = choice(b["junior_scope"], ["assigned", "all"], "Junior access")
        for k in ("client_email_reminders", "junior_create_cases"):
            if k in b:
                new[k] = bool(b[k])
        if "default_court" in b:
            new["default_court"] = text(b["default_court"], 120) or ""
        if "mfa_required" in b:
            want = bool(b["mfa_required"])
            if want and not L.mfa_enabled(c, env.uid()):
                raise ApiError("Turn on two-step sign-in for your own account first, then require it for everyone.", 400, code="MFA_SELF")
            new["mfa_required"] = want
        if "ip_allow" in b or "ip_enabled" in b:
            allow = b.get("ip_allow", new["ip_allow"])
            if isinstance(allow, str):
                allow = [x for x in allow.replace(",", "\n").split() if x]
            if allow is not None and (not isinstance(allow, list) or not all(isinstance(x, str) for x in allow)):
                raise ApiError("The allowed addresses must be a list of IP addresses or ranges.", 400)
            clean = []
            for a in allow or []:
                try:
                    L.parse_ip_entry(a)
                except ValueError:
                    raise ApiError(f"“{a}” is not a valid IP address or range (like 203.0.113.7 or 203.0.113.0/24).", 400)
                if a.strip() not in clean:
                    clean.append(a.strip())
            enabled = bool(b.get("ip_enabled", new["ip_enabled"]))
            if enabled and not clean:
                raise ApiError("Add at least one allowed address before turning the list on.", 400)
            if enabled and not L.ip_allowed(env.ip(), clean):
                raise ApiError(f"Your own address ({env.ip()}) is not on this list, and saving it would lock you out. Add it first.", 400, code="IP_SELF_LOCKOUT")
            new["ip_allow"], new["ip_enabled"] = clean, enabled
        name = text(b["firm_name"], 120, "Practice name", required=True) if "firm_name" in b else m["firm_name"]
        changed = [k for k in new if new[k] != cur.get(k)] + (["firm_name"] if name != m["firm_name"] else [])
        with env.tx() as tc:
            tc.execute("UPDATE lpms_firms SET name = ?, settings = ? WHERE id = ?", (name, L.jdump({k: v for k, v in new.items()}), m["firm_id"]))
            if changed:
                env.audit("settings_update", "firm", m["firm_id"], "Settings changed: " + ", ".join(changed), {"changed": changed})
        g_m = L.member_for_user(env.conn(), env.uid())
        from flask import g
        g.lpms_member, g.lpms_settings = g_m, L.firm_settings(env.conn(), m["firm_id"])
        return jsonify(settings_payload())

    @env.api("/reminders/run", methods=("POST",), perm="manage_settings")
    def run_reminders_now():
        with env.tx() as c:
            counts = L.run_reminders(c, env.m["firm_id"])
            env.audit("notification_run", "firm", env.m["firm_id"], "Reminder check run", counts)
        kick()
        return jsonify({"ok": True, "counts": counts})

    # ── two-step sign-in ────────────────────────────────────────────────────────────
    def _audit_user(c, action, summary):
        m = L.member_for_user(c, env.uid())
        if m:
            L.audit(c, m["firm_id"], m["user_id"], m["name"], action, "user", m["user_id"], summary, ip=env.ip())

    @env.api("/mfa", firm=False)
    def mfa_state():
        return jsonify(me_payload(env.uid())["mfa"])

    @env.api("/mfa/setup", methods=("POST",), firm=False)
    def mfa_setup():
        uid, c = env.uid(), env.conn()
        if L.mfa_enabled(c, uid):
            raise ApiError("Two-step sign-in is already on. Turn it off first to set it up again.", 409)
        user = env.get_user(uid) or {}
        secret = L.new_totp_secret()
        with env.tx() as tc:
            tc.execute("INSERT INTO lpms_mfa (user_id, secret, enabled, created_at) VALUES (?,?,0,?) ON CONFLICT(user_id) DO UPDATE SET secret = excluded.secret, enabled = 0, "
                       "last_step = 0, failures = 0, locked_until = 0, recovery = '[]'", (uid, L.seal(secret), L.now_iso()))
        uri = L.otpauth_uri(secret, user.get("email") or f"user{uid}")
        return jsonify({"secret": " ".join(secret[i:i + 4] for i in range(0, len(secret), 4)), "uri": uri, "qr": L.qr_svg(uri)})

    @env.api("/mfa/enable", methods=("POST",), firm=False)
    def mfa_enable():
        uid, c = env.uid(), env.conn()
        r = L.mfa_row(c, uid)
        if not r or r["enabled"]:
            raise ApiError("Start the setup first.", 409)
        step = L.totp_check(L.unseal(r["secret"]), (request.get_json(silent=True) or {}).get("code"), 0)
        if not step:
            raise ApiError("That code is not right. Check the app and try again — the code changes every 30 seconds.", 400, code="MFA_INVALID")
        codes, hashes = L.make_recovery_codes()
        with env.tx() as tc:
            tc.execute("UPDATE lpms_mfa SET enabled = 1, last_step = ?, recovery = ?, enabled_at = ?, failures = 0 WHERE user_id = ?", (step, L.jdump(hashes), L.now_iso(), uid))
            _audit_user(tc, "mfa_enabled", "Two-step sign-in turned on")
        return jsonify({"ok": True, "recovery_codes": codes})

    @env.api("/mfa/disable", methods=("POST",), firm=False, exempt_mfa=True)
    def mfa_disable():
        uid, c = env.uid(), env.conn()
        m = L.member_for_user(c, uid)
        if m and L.firm_settings(c, m["firm_id"]).get("mfa_required"):
            raise ApiError("Your practice requires two-step sign-in, so it cannot be turned off.", 409)
        with env.tx() as tc:
            res, detail = L.mfa_verify(tc, uid, (request.get_json(silent=True) or {}).get("code"))
            if res == "ok":
                tc.execute("DELETE FROM lpms_mfa WHERE user_id = ?", (uid,))
                _audit_user(tc, "mfa_disabled", "Two-step sign-in turned off")
        if res == "locked":
            raise ApiError(f"Too many wrong codes. Try again in {max(1, detail // 60)} minute(s).", 429, code="MFA_LOCKED")
        if res == "bad":
            raise ApiError("That code is not right.", 400, code="MFA_INVALID")
        return jsonify({"ok": True})

    @env.api("/mfa/recovery", methods=("POST",), firm=False)
    def mfa_new_recovery():
        uid = env.uid()
        codes, hashes = L.make_recovery_codes()
        with env.tx() as tc:
            res, detail = L.mfa_verify(tc, uid, (request.get_json(silent=True) or {}).get("code"))
            if res == "ok" and L.mfa_enabled(tc, uid):
                tc.execute("UPDATE lpms_mfa SET recovery = ? WHERE user_id = ?", (L.jdump(hashes), uid))
                _audit_user(tc, "mfa_recovery", "New recovery codes created")
        if res != "ok" or not L.mfa_enabled(env.conn(), uid):
            raise ApiError("That code is not right." if res == "bad" else "Two-step sign-in is not on.", 400, code="MFA_INVALID")
        return jsonify({"ok": True, "recovery_codes": codes})

    # ── notifications ───────────────────────────────────────────────────────────────
    @env.api("/notifications")
    def notifications():
        sweep_if_due()
        c, uid = env.conn(), env.uid()
        lim = min(max(as_int(request.args.get("limit"), 30), 1), 100)
        where, params = "user_id = ?", [uid]
        if truthy(request.args.get("unread")):
            where += " AND read_at IS NULL"
        if as_int(request.args.get("before")):
            where += " AND id < ?"
            params.append(as_int(request.args.get("before")))
        items = L.rows(c, f"SELECT id, kind, title, body, link, case_id, created_at, read_at FROM lpms_notifications WHERE {where} ORDER BY id DESC LIMIT ?", params + [lim + 1])
        more = len(items) > lim
        unread = c.execute("SELECT COUNT(*) FROM lpms_notifications WHERE user_id = ? AND read_at IS NULL", (uid,)).fetchone()[0]
        return jsonify({"items": items[:lim], "more": more, "unread": unread})

    @env.api("/notifications/<int:nid>/read", methods=("POST",))
    def read_notification(nid):
        with env.tx() as c:
            c.execute("UPDATE lpms_notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?", (L.now_iso(), nid, env.uid()))
        return jsonify({"ok": True})

    @env.api("/notifications/read-all", methods=("POST",))
    def read_all_notifications():
        with env.tx() as c:
            c.execute("UPDATE lpms_notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL", (L.now_iso(), env.uid()))
        return jsonify({"ok": True})

    # ── audit ───────────────────────────────────────────────────────────────────────
    def audit_where():
        a = request.args
        where, params = ["firm_id = :fid"], {"fid": env.m["firm_id"]}
        if a.get("group") in AUDIT_GROUPS:
            ors = []
            for i, pat in enumerate(AUDIT_GROUPS[a["group"]]):
                params[f"g{i}"] = pat
                ors.append(f"action LIKE :g{i}" if "%" in pat else f"action = :g{i}")
            where.append("(" + " OR ".join(ors) + ")")
        if a.get("action"):
            params["act"] = a["action"]
            where.append("action = :act")
        if as_int(a.get("user_id")):
            params["uid"] = as_int(a.get("user_id"))
            where.append("user_id = :uid")
        if a.get("q"):
            params["q"] = like(a["q"])
            where.append("(LOWER(summary) LIKE :q OR LOWER(COALESCE(actor,'')) LIKE :q OR COALESCE(ip,'') LIKE :q)")
        if a.get("from"):
            params["f"] = date_of(a["from"])
            where.append("date(at) >= :f")
        if a.get("to"):
            params["t"] = date_of(a["to"])
            where.append("date(at) <= :t")
        return " AND ".join(where), params

    @env.api("/audit", perm="view_audit")
    def audit_list():
        c = env.conn()
        where, params = audit_where()
        per = min(max(as_int(request.args.get("per_page"), 40), 1), 200)
        page = min(max(as_int(request.args.get("page"), 1), 1), 100000)
        total = c.execute(f"SELECT COUNT(*) FROM lpms_audit WHERE {where}", params).fetchone()[0]
        items = L.rows(c, f"SELECT id, user_id, actor, action, entity, entity_id, summary, detail, ip, at FROM lpms_audit WHERE {where} ORDER BY id DESC LIMIT :lim OFFSET :off",
                       {**params, "lim": per, "off": (page - 1) * per})
        for it in items:
            it["detail"] = L.jloads(it["detail"], None)
        return jsonify({"items": items, "total": total, "page": page, "per_page": per})

    @env.api("/audit/verify", perm="view_audit")
    def audit_verify():
        return jsonify(L.verify_audit(env.conn(), env.m["firm_id"]))

    @env.api("/audit/export.csv", perm="view_audit")
    def audit_csv():
        c = env.conn()
        where, params = audit_where()
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["When (UTC)", "Who", "Action", "What", "Address"])
        safe = lambda v: ("'" + str(v)) if str(v or "")[:1] in ("=", "+", "-", "@", "\t", "\r") else ("" if v is None else str(v))
        for r in c.execute(f"SELECT at, actor, action, summary, ip FROM lpms_audit WHERE {where} ORDER BY id DESC LIMIT 20000", params):
            w.writerow([safe(r["at"]), safe(r["actor"]), safe(r["action"]), safe(r["summary"]), safe(r["ip"])])
        with env.tx():
            env.audit("report_export", "audit", None, "Audit log exported as CSV")
        return Response(buf.getvalue().encode("utf-8-sig"), mimetype="text/csv", headers={"Content-Disposition": 'attachment; filename="audit-log.csv"'})

    @env.api("/me/logins")
    def my_logins():
        items = L.rows(env.conn(), "SELECT action, summary, ip, at FROM lpms_audit WHERE firm_id = ? AND user_id = ? AND action IN ('login','login_failed','mfa_failed','mfa_locked') "
                                   "ORDER BY id DESC LIMIT 15", (env.m["firm_id"], env.uid()))
        return jsonify({"items": items})

    # ── search ──────────────────────────────────────────────────────────────────────
    @env.api("/search")
    def search():
        q = (request.args.get("q") or "").strip()
        if len(q) < 2:
            return jsonify({"cases": [], "clients": [], "parties": [], "rti": [], "members": []})
        c, m = env.conn(), env.m
        vis, vp = L.case_visible_sql(m, "c")
        params = {"q": q}
        extra = R.case_filters_sql({"q": q, "archived": "all"}, params)
        params.update(vp)
        today = L.today_ist().isoformat()
        cases = L.rows(c, "SELECT c.id, c.case_no, c.title, c.court, c.status, c.case_type, c.archived_at, cl.name AS client_name, ad.name AS advocate_name, "
                          "(SELECT MIN(h.hearing_date) FROM lpms_hearings h WHERE h.case_id = c.id AND h.status = 'scheduled' AND h.hearing_date >= :today) AS next_hearing "
                          f"FROM lpms_cases c LEFT JOIN lpms_clients cl ON cl.id = c.client_id LEFT JOIN lpms_members ad ON ad.id = c.advocate_id WHERE {vis} {extra} "
                          "ORDER BY (c.case_key = :exact) DESC, c.updated_at DESC LIMIT 8", {**params, "today": today, "exact": L.norm_key(q)})
        lk = like(q)
        clients = L.rows(c, "SELECT id, name, phone, email FROM lpms_clients WHERE firm_id = ? AND archived = 0 AND (LOWER(name) LIKE ? OR COALESCE(phone,'') LIKE ? OR LOWER(COALESCE(email,'')) LIKE ?) "
                            "ORDER BY name COLLATE NOCASE LIMIT 6", (m["firm_id"], lk, lk, lk))
        parties = L.rows(c, "SELECT pt.id, pt.name, pt.role, c.id AS case_id, c.case_no, c.title FROM lpms_parties pt JOIN lpms_cases c ON c.id = pt.case_id "
                            f"WHERE {vis} AND LOWER(pt.name) LIKE :lk ORDER BY pt.name COLLATE NOCASE LIMIT 6", {**vp, "lk": lk})
        gate_r, gp = env.case_gate("r.case_id")
        rti = L.rows(c, "SELECT r.id, r.subject, r.department, r.status FROM lpms_rti r WHERE r.firm_id = :fid AND (LOWER(r.subject) LIKE :lk OR LOWER(r.department) LIKE :lk OR LOWER(COALESCE(r.reference_no,'')) LIKE :lk) "
                     f"AND {gate_r} LIMIT 4", {**gp, "lk": lk})
        members_ = L.rows(c, "SELECT id, name, role FROM lpms_members WHERE firm_id = ? AND active = 1 AND LOWER(name) LIKE ? LIMIT 4", (m["firm_id"], lk))
        return jsonify({"cases": cases, "clients": clients, "parties": parties, "rti": rti, "members": members_})

    # ── dashboard ───────────────────────────────────────────────────────────────────
    @env.api("/dashboard")
    def dashboard():
        sweep_if_due()
        c, m, st = env.conn(), env.m, env.settings
        scope = request.args.get("scope") if request.args.get("scope") in ("mine", "firm") else ("firm" if m["role"] == "senior" else "mine")
        today = L.today_ist()
        t_s = today.isoformat()
        vis, vp = L.case_visible_sql(m, "c")
        mine_c = " AND c.advocate_id = :mid" if scope == "mine" else ""
        mine_h = " AND COALESCE(h.advocate_id, c.advocate_id) = :mid" if scope == "mine" else ""
        base = {**vp, "today": t_s}
        gate_r, gp = env.case_gate("r.case_id")
        gate_f, gpf = env.case_gate("f.case_id")

        today_h = R.hearing_rows(c, m, f"AND h.hearing_date = :d AND h.status != 'cancelled'{mine_h}", {"d": t_s, "mid": m["id"]},
                                 order="COALESCE(h.court, c.court), h.hall_no, CAST(h.serial_no AS INTEGER), h.hearing_time")
        upcoming = R.hearing_rows(c, m, f"AND h.status = 'scheduled' AND h.hearing_date > :d AND h.hearing_date <= :e{mine_h}",
                                  {"d": t_s, "e": (today + timedelta(days=14)).isoformat(), "mid": m["id"]})[:30]

        def hrow(h):
            return {"id": h["id"], "case_id": h["case_id"], "case_no": h["case_no"], "title": h["title"], "date": h["hearing_date"], "time": h["hearing_time"],
                    "court": h["court"] or h["case_court"], "hall_no": h["hall_no"], "serial_no": h["serial_no"], "purpose": h["purpose"], "status": h["status"],
                    "advocate": h["advocate_name"], "client": h["client_name"], "has_phone": bool(h["client_phone"])}

        counts = {
            "active": c.execute(f"SELECT COUNT(*) FROM lpms_cases c WHERE {vis} AND c.closed_at IS NULL AND c.archived_at IS NULL{mine_c}", {**base, "mid": m["id"]}).fetchone()[0],
            "closed_month": c.execute(f"SELECT COUNT(*) FROM lpms_cases c WHERE {vis} AND c.closed_at >= :ms{mine_c}", {**base, "ms": today.replace(day=1).isoformat(), "mid": m["id"]}).fetchone()[0],
            "today": len(today_h),
            "week": c.execute(f"SELECT COUNT(*) FROM lpms_hearings h JOIN lpms_cases c ON c.id = h.case_id WHERE {vis} AND c.archived_at IS NULL AND h.status = 'scheduled' "
                              f"AND h.hearing_date BETWEEN :today AND :e{mine_h}", {**base, "e": (today + timedelta(days=6)).isoformat(), "mid": m["id"]}).fetchone()[0],
            "rti_open": c.execute(f"SELECT COUNT(*) FROM lpms_rti r WHERE r.firm_id = :fid AND r.status NOT IN ('closed','draft') AND {gate_r}", gp).fetchone()[0],
        }

        # pending actions: things somebody has to do
        pending = []
        for h in c.execute("SELECT h.id, h.hearing_date, c.id AS cid, c.case_no, c.title FROM lpms_hearings h JOIN lpms_cases c ON c.id = h.case_id "
                           f"WHERE {vis} AND c.archived_at IS NULL AND h.status = 'scheduled' AND h.hearing_date < :today{mine_h} ORDER BY h.hearing_date LIMIT 8",
                           {**base, "mid": m["id"]}):
            pending.append({"kind": "hearing_update", "severity": "overdue", "title": f"Record what happened — {h['title']}", "sub": f"{h['case_no']} · hearing was on {L.nice_date(h['hearing_date'])}",
                            "link": f"/practice/cases/{h['cid']}?tab=proceedings&hearing={h['id']}", "date": h["hearing_date"]})
        for cs in c.execute(f"SELECT c.id, c.case_no, c.title, c.next_action, c.next_action_due FROM lpms_cases c WHERE {vis} AND c.archived_at IS NULL AND c.closed_at IS NULL "
                            f"AND c.next_action IS NOT NULL AND c.next_action != '' AND c.next_action_due IS NOT NULL AND c.next_action_due <= :soon{mine_c} "
                            "ORDER BY c.next_action_due LIMIT 8", {**base, "soon": (today + timedelta(days=3)).isoformat(), "mid": m["id"]}):
            late = cs["next_action_due"] < t_s
            pending.append({"kind": "action", "severity": "overdue" if late else "soon", "title": cs["next_action"], "sub": f"{cs['title']} · due {L.nice_date(cs['next_action_due'])}",
                            "link": f"/practice/cases/{cs['id']}", "date": cs["next_action_due"]})
        for r in c.execute(f"SELECT r.id, r.subject, r.department, r.status, r.response_due, r.appeal_due FROM lpms_rti r WHERE r.firm_id = :fid AND r.status IN ('filed','replied','partial','rejected') AND {gate_r}", gp):
            due = r["response_due"] if r["status"] == "filed" else r["appeal_due"]
            if due and due <= (today + timedelta(days=7)).isoformat():
                pending.append({"kind": "rti", "severity": "overdue" if due < t_s else "soon", "title": ("RTI reply due: " if r["status"] == "filed" else "RTI appeal due: ") + r["subject"],
                                "sub": f"{r['department']} · {L.nice_date(due)}", "link": "/practice/rti", "date": due})
        for f in c.execute("SELECT f.id, f.note, f.due_date, f.case_id, cl.name FROM lpms_followups f LEFT JOIN lpms_clients cl ON cl.id = f.client_id "
                           f"WHERE f.firm_id = :fid AND f.status = 'open' AND f.due_date <= :t AND {gate_f} ORDER BY f.due_date LIMIT 6", {**gpf, "t": t_s}):
            pending.append({"kind": "followup", "severity": "overdue" if f["due_date"] < t_s else "soon", "title": f"Follow up{(' with ' + f['name']) if f['name'] else ''}",
                            "sub": f"{f['note']} · {L.nice_date(f['due_date'])}", "link": f"/practice/cases/{f['case_id']}" if f["case_id"] else "/practice/clients", "date": f["due_date"]})
        nodate = L.rows(c, f"SELECT c.id, c.case_no, c.title FROM lpms_cases c WHERE {vis} AND c.closed_at IS NULL AND c.archived_at IS NULL AND c.status = 'Active'{mine_c} "
                           "AND NOT EXISTS (SELECT 1 FROM lpms_hearings h WHERE h.case_id = c.id AND h.status = 'scheduled' AND h.hearing_date >= :today) "
                           "ORDER BY c.updated_at DESC LIMIT 4", {**base, "mid": m["id"]})
        for x in nodate:
            pending.append({"kind": "no_date", "severity": "info", "title": f"No next hearing date — {x['title']}", "sub": x["case_no"], "link": f"/practice/cases/{x['id']}", "date": None})
        rank = {"overdue": 0, "soon": 1, "info": 2}
        pending.sort(key=lambda p: (rank[p["severity"]], p["date"] or "9999"))

        recent = L.rows(c, "SELECT c.id, c.case_no, c.title, c.court, c.status, c.priority, c.updated_at, cl.name AS client_name, ad.name AS advocate_name, "
                           "(SELECT t.title FROM lpms_timeline t WHERE t.case_id = c.id ORDER BY t.id DESC LIMIT 1) AS last_event "
                           f"FROM lpms_cases c LEFT JOIN lpms_clients cl ON cl.id = c.client_id LEFT JOIN lpms_members ad ON ad.id = c.advocate_id WHERE {vis} AND c.archived_at IS NULL{mine_c} "
                           "ORDER BY c.updated_at DESC, c.id DESC LIMIT 8", {**vp, "mid": m["id"]})

        notes = L.rows(c, "SELECT id, kind, title, body, link, created_at, read_at FROM lpms_notifications WHERE user_id = ? ORDER BY id DESC LIMIT 6", (env.uid(),))
        unread = c.execute("SELECT COUNT(*) FROM lpms_notifications WHERE user_id = ? AND read_at IS NULL", (env.uid(),)).fetchone()[0]

        docs = []
        try:
            raw = L.rows(c, "SELECT d.doc_id, COALESCE(cv.smart_title, cv.title) AS title, d.doc_class, d.created_at, d.uploaded_by, cv.case_id FROM dms_docs d JOIN case_vault cv ON cv.id = d.doc_id "
                            "WHERE cv.case_id LIKE 'lpms:%' AND d.deleted_at IS NULL AND d.is_current = 1 ORDER BY d.created_at DESC, d.doc_id DESC LIMIT 60")
            ids = [int(r["case_id"].split(":")[1]) for r in raw if r["case_id"].split(":")[1].isdigit()]
            if ids:
                ok = {r["id"]: r for r in L.rows(c, f"SELECT c.id, c.title, c.case_no FROM lpms_cases c WHERE {vis} AND c.id IN ({','.join(str(int(i)) for i in ids)})", vp)}
                by_user = {r["user_id"]: r["name"] for r in L.members_of(c, m["firm_id"], active_only=False)}
                for r in raw:
                    cid = int(r["case_id"].split(":")[1])
                    if cid in ok and len(docs) < 8:
                        docs.append({"id": r["doc_id"], "title": r["title"], "doc_class": r["doc_class"] or "Unclassified", "created_at": r["created_at"], "case_id": cid,
                                     "case_title": ok[cid]["title"], "case_no": ok[cid]["case_no"], "by": by_user.get(r["uploaded_by"])})
        except Exception:                                    # the Document Hub tables may not exist on a brand-new database
            docs = []

        act = {"c.case_type": "types", "COALESCE(c.category, 'Uncategorised')": "categories", "c.status": "statuses"}
        cats = {}
        for col, key in act.items():
            cats[key] = L.rows(c, f"SELECT {col} AS label, COUNT(*) AS n FROM lpms_cases c WHERE {vis} AND c.archived_at IS NULL{mine_c} AND "
                                  f"{'c.closed_at IS NULL' if key != 'statuses' else '1=1'} GROUP BY label ORDER BY n DESC LIMIT 10", {**vp, "mid": m["id"]})

        workload = []
        vis_all, vp_all = L.case_visible_sql(m, "c")
        for a in L.members_of(c, m["firm_id"]):
            if a["role"] == "staff":
                continue
            p_ = {**vp_all, "a": a["id"], "today": t_s, "w": (today + timedelta(days=6)).isoformat()}
            workload.append({
                "id": a["id"], "name": a["name"], "role": a["role"],
                "active": c.execute(f"SELECT COUNT(*) FROM lpms_cases c WHERE {vis_all} AND c.advocate_id = :a AND c.closed_at IS NULL AND c.archived_at IS NULL", p_).fetchone()[0],
                "today": c.execute(f"SELECT COUNT(*) FROM lpms_hearings h JOIN lpms_cases c ON c.id = h.case_id WHERE {vis_all} AND COALESCE(h.advocate_id, c.advocate_id) = :a "
                                   "AND h.hearing_date = :today AND h.status != 'cancelled' AND c.archived_at IS NULL", p_).fetchone()[0],
                "week": c.execute(f"SELECT COUNT(*) FROM lpms_hearings h JOIN lpms_cases c ON c.id = h.case_id WHERE {vis_all} AND COALESCE(h.advocate_id, c.advocate_id) = :a "
                                  "AND h.hearing_date BETWEEN :today AND :w AND h.status = 'scheduled' AND c.archived_at IS NULL", p_).fetchone()[0],
                "overdue": L.pending_counts(c, a, st, today)["hearings"],
            })
        return jsonify({"scope": scope, "date": t_s, "counts": counts, "today": [hrow(h) for h in today_h], "upcoming": [hrow(h) for h in upcoming], "pending": pending[:14],
                        "pending_total": len(pending), "recent": recent, "notifications": notes, "unread": unread, "documents": docs, "summary": cats, "workload": workload})
