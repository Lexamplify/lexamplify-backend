"""
routes/lpms_cases.py - Practice: cases, parties, hearings & the cause list, daily proceedings, the case timeline,
internal notes, client communication (WhatsApp link / e-mail) and follow-ups.
"""
import uuid
from datetime import timedelta

from flask import jsonify, request

from routes.lpms_common import ApiError, as_int, choice, date_of, email_of, like, phone_of, text, time_of, truthy
from utils import lpms_reports as R
from utils import lpms_store as L

CASE_FIELDS_LABEL = {"case_no": "case number", "court": "court", "title": "title", "category": "category", "case_type": "type", "filing_date": "filing date",
                     "reg_no": "registration number", "hall_no": "court hall", "judge": "judge", "opposite_party": "opposite party", "client_id": "client",
                     "advocate_id": "assigned advocate", "priority": "priority", "status": "status", "next_action": "next action",
                     "next_action_due": "action due date", "remarks": "remarks", "restricted": "confidentiality", "outcome": "outcome"}

CASE_SELECT = (
    "SELECT c.*, cl.name AS client_name, cl.phone AS client_phone, cl.email AS client_email, ad.name AS advocate_name, "
    "(SELECT MIN(h.hearing_date) FROM lpms_hearings h WHERE h.case_id = c.id AND h.status = 'scheduled' AND h.hearing_date >= :today) AS next_hearing, "
    "(SELECT MAX(h.hearing_date) FROM lpms_hearings h WHERE h.case_id = c.id AND h.status IN ('heard','adjourned')) AS last_hearing, "
    "EXISTS (SELECT 1 FROM lpms_hearings h WHERE h.case_id = c.id AND h.status = 'scheduled' AND h.hearing_date < :today) AS overdue_update "
    "FROM lpms_cases c LEFT JOIN lpms_clients cl ON cl.id = c.client_id LEFT JOIN lpms_members ad ON ad.id = c.advocate_id "
)


def case_dict(r, detail=False):
    d = {k: r[k] for k in ("id", "case_no", "court", "title", "category", "case_type", "filing_date", "reg_no", "hall_no", "judge", "opposite_party", "client_id",
                           "advocate_id", "priority", "status", "next_action", "next_action_due", "remarks", "outcome", "closed_at", "archived_at", "created_at", "updated_at",
                           "client_name", "advocate_name", "next_hearing", "last_hearing")}
    d["restricted"] = bool(r["restricted"])
    d["overdue_update"] = bool(r["overdue_update"])
    d["closed"] = bool(r["closed_at"])
    d["archived"] = bool(r["archived_at"])
    if detail:
        d["client_phone"], d["client_email"] = r["client_phone"], r["client_email"]
    return d


def register(env):
    # ── helpers ─────────────────────────────────────────────────────────────────────
    def fetch_case(case_id):
        r = L.one(env.conn(), CASE_SELECT + "WHERE c.id = :id", {"id": case_id, "today": L.today_ist().isoformat()})
        return r

    def parse_case(b, existing=None):
        """Validated column values from a request body (only the keys that were sent)."""
        out = {}
        st = env.settings
        if "case_no" in b or not existing:
            out["case_no"] = text(b.get("case_no"), 80, "Case number", required=True)
        if "court" in b or not existing:
            out["court"] = text(b.get("court") or (st.get("default_court") if not existing else None), 160, "Court", required=True)
        if "title" in b or not existing:
            out["title"] = text(b.get("title"), 200, "Case title", required=True)
        if "category" in b:
            out["category"] = text(b["category"], 60, "Category")
        if "case_type" in b or not existing:
            out["case_type"] = choice(b.get("case_type"), L.CASE_TYPES, "Case type", default="Civil")
        if "filing_date" in b:
            out["filing_date"] = date_of(b["filing_date"], "Filing date")
        for k, n, lab in (("reg_no", 80, "Registration number"), ("hall_no", 30, "Court hall"), ("judge", 120, "Judge"), ("opposite_party", 200, "Opposite party"),
                          ("next_action", 200, "Next action")):
            if k in b:
                out[k] = text(b[k], n, lab)
        if "next_action_due" in b:
            out["next_action_due"] = date_of(b["next_action_due"], "Action due date")
        if "remarks" in b:
            out["remarks"] = text(b["remarks"], 4000, "Remarks")
        if "outcome" in b:
            out["outcome"] = text(b["outcome"], 500, "Outcome")
        if "priority" in b or not existing:
            out["priority"] = choice(b.get("priority"), L.PRIORITIES, "Priority", default="normal")
        if "status" in b or not existing:
            out["status"] = choice(b.get("status"), L.STATUSES, "Status", default="Active")
        if "client_id" in b:
            out["client_id"] = env.client_in_firm(b["client_id"])
        if "advocate_id" in b:
            out["advocate_id"] = env.member_in_firm(b["advocate_id"], "Advocate", advocates_only=True)
        if "restricted" in b:
            out["restricted"] = 1 if truthy(b["restricted"]) else 0
        return out

    def dup_case(firm_id, case_no, court, except_id=None):
        r = L.one(env.conn(), "SELECT id FROM lpms_cases WHERE firm_id = ? AND case_key = ? AND LOWER(court) = LOWER(?) AND id != ?",
                  (firm_id, L.norm_key(case_no), court, except_id or 0))
        return r

    def new_client_inline(c, spec):
        name = text(spec.get("name"), 160, "Client name", required=True)
        cid = c.execute("INSERT INTO lpms_clients (firm_id, name, phone, email, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
                        (env.m["firm_id"], name, phone_of(spec.get("phone")), email_of(spec.get("email")), env.m["id"], L.now_iso(), L.now_iso())).lastrowid
        env.audit("client_create", "client", cid, f"Client “{name}” added")
        return cid

    # ── cases: list / create ────────────────────────────────────────────────────────
    SORTS = {
        "updated": "c.updated_at DESC, c.id DESC",
        "next_hearing": "(next_hearing IS NULL), next_hearing ASC, c.id DESC",
        "case_no": "c.case_no COLLATE NOCASE ASC",
        "title": "c.title COLLATE NOCASE ASC",
        "priority": "CASE c.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, c.updated_at DESC",
        "filing": "(c.filing_date IS NULL), c.filing_date DESC",
        "created": "c.id DESC",
    }

    @env.api("/cases")
    def list_cases():
        c, m = env.conn(), env.m
        args = request.args
        vis, vp = L.case_visible_sql(m, "c")
        params = {**vp, "today": L.today_ist().isoformat()}
        a = dict(args.items())
        if truthy(a.get("mine")):
            a["advocate_id"] = str(m["id"])
        extra = R.case_filters_sql(a, params)
        per = min(max(as_int(a.get("per_page"), 25), 1), 100)
        page = max(as_int(a.get("page"), 1), 1)
        total = c.execute(f"SELECT COUNT(*) FROM lpms_cases c LEFT JOIN lpms_clients cl ON cl.id = c.client_id LEFT JOIN lpms_members ad ON ad.id = c.advocate_id WHERE {vis} {extra}", params).fetchone()[0]
        order = SORTS.get(a.get("sort"), SORTS["updated"])
        rows_ = L.rows(c, f"{CASE_SELECT} WHERE {vis} {extra} ORDER BY {order} LIMIT :lim OFFSET :off", {**params, "lim": per, "off": (page - 1) * per})
        facets = {
            "courts": [r[0] for r in c.execute(f"SELECT DISTINCT c.court FROM lpms_cases c WHERE {vis} ORDER BY c.court COLLATE NOCASE LIMIT 100", vp)],
            "categories": [r[0] for r in c.execute(f"SELECT DISTINCT c.category FROM lpms_cases c WHERE {vis} AND c.category IS NOT NULL AND c.category != '' ORDER BY c.category COLLATE NOCASE LIMIT 100", vp)],
        }
        return jsonify({"cases": [case_dict(r) for r in rows_], "total": total, "page": page, "per_page": per, "facets": facets})

    @env.api("/cases", methods=("POST",), perm="create_case")
    def create_case():
        b = request.get_json(silent=True) or {}
        m = env.m
        fields = parse_case(b)
        if dup_case(m["firm_id"], fields["case_no"], fields["court"]) and not truthy(b.get("force")):
            raise ApiError("A case with this number already exists in this court. Open it instead, or save anyway if it is a different matter.", 409, code="DUPLICATE_CASE")
        if "advocate_id" not in fields or not fields.get("advocate_id"):
            fields["advocate_id"] = m["id"] if m["role"] in ("senior", "junior") else None
        if m["role"] == "junior" and fields.get("advocate_id") != m["id"]:
            raise ApiError("You can create cases for yourself. A Senior Advocate can assign them to someone else.", 403, code="FORBIDDEN")
        if fields["status"] in L.CLOSED_STATUSES:
            fields["closed_at"] = L.now_iso()
        warnings = []
        with env.tx() as c:
            if isinstance(b.get("client"), dict) and not fields.get("client_id"):
                fields["client_id"] = new_client_inline(c, b["client"])
            now = L.now_iso()
            cols = {**fields, "firm_id": m["firm_id"], "case_key": L.norm_key(fields["case_no"]), "created_by": m["id"], "created_at": now, "updated_at": now}
            cid = c.execute(f"INSERT INTO lpms_cases ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})", list(cols.values())).lastrowid
            L.timeline(c, m["firm_id"], cid, "created", f"Case created — {fields['case_no']}", f"{fields['court']} · {fields['case_type']}", m["id"])
            env.audit("case_create", "case", cid, f"Case {fields['case_no']} created: {fields['title']}", {"court": fields["court"], "advocate_id": fields.get("advocate_id")})
            first = b.get("first_hearing")
            if isinstance(first, dict) and first.get("date"):
                case = L.one(c, "SELECT * FROM lpms_cases WHERE id = ?", (cid,))
                _, w = make_hearing(c, case, first, m, notify=False)
                warnings += w
            if fields.get("advocate_id") and fields["advocate_id"] != m["id"]:
                case = L.one(c, "SELECT * FROM lpms_cases WHERE id = ?", (cid,))
                adv = L.one(c, "SELECT user_id FROM lpms_members WHERE id = ?", (fields["advocate_id"],))
                if adv:
                    L.notify(c, m["firm_id"], adv["user_id"], "assignment", f"New case assigned: {fields['title']}", f"{m['name']} assigned {fields['case_no']} ({fields['court']}) to you.",
                             f"/practice/cases/{cid}", cid, f"assign:{cid}:{fields['advocate_id']}", email=True)
        env.kick_email()
        return jsonify({"ok": True, "case": case_dict(fetch_case(cid), True), "warnings": warnings}), 201

    # ── case detail / update / archive ──────────────────────────────────────────────
    def doc_count(case_id):
        try:
            return env.conn().execute("SELECT COUNT(*) FROM dms_docs d JOIN case_vault cv ON cv.id = d.doc_id WHERE cv.case_id = ? AND d.deleted_at IS NULL AND d.is_current = 1",
                                      (f"lpms:{case_id}",)).fetchone()[0]
        except Exception:
            return 0

    @env.api("/cases/<int:case_id>")
    def get_case(case_id):
        case = env.get_case(case_id)
        c = env.conn()
        r = fetch_case(case_id)
        d = case_dict(r, True)
        level = case["_level"]
        d["level"] = level
        d["can"] = {"edit": level == "full", "update": level is not None and not case["archived_at"], "archive": env.perms["archive_case"], "assign": env.perms["assign_case"],
                    "upload": env.perms["upload_documents"] and not case["archived_at"]}
        d["parties"] = L.rows(c, "SELECT * FROM lpms_parties WHERE case_id = ? ORDER BY CASE role WHEN 'petitioner' THEN 0 WHEN 'respondent' THEN 1 WHEN 'opposing_counsel' THEN 2 WHEN 'witness' THEN 3 ELSE 4 END, id", (case_id,))
        d["hearings"] = hearing_list(case_id)
        d["counts"] = {"proceedings": c.execute("SELECT COUNT(*) FROM lpms_proceedings WHERE case_id = ?", (case_id,)).fetchone()[0],
                       "documents": doc_count(case_id), "notes": c.execute("SELECT COUNT(*) FROM lpms_notes WHERE case_id = ?", (case_id,)).fetchone()[0],
                       "comms": c.execute("SELECT COUNT(*) FROM lpms_comms WHERE case_id = ?", (case_id,)).fetchone()[0]}
        d["whatsapp"] = bool(env.settings["channels"].get("whatsapp", True))
        return jsonify({"case": d})

    @env.api("/cases/<int:case_id>", methods=("PATCH",))
    def update_case(case_id):
        case = env.get_case(case_id, write=True)
        b = request.get_json(silent=True) or {}
        level, m = case["_level"], env.m
        fields = parse_case(b, existing=case)
        if level == "limited":
            bad = [k for k in fields if k not in L.LIMITED_CASE_FIELDS]
            if bad:
                raise ApiError("You can update the status, next action, remarks, hall and judge. A Senior Advocate can change the other details: "
                               + ", ".join(CASE_FIELDS_LABEL.get(k, k) for k in bad) + ".", 403, code="FORBIDDEN")
        if "advocate_id" in fields and not env.perms["assign_case"]:
            raise ApiError("Only a Senior Advocate can reassign a case.", 403, code="FORBIDDEN")
        if ("case_no" in fields or "court" in fields) and dup_case(m["firm_id"], fields.get("case_no", case["case_no"]), fields.get("court", case["court"]), case_id) \
                and not truthy(b.get("force")):
            raise ApiError("Another case already has this number in this court.", 409, code="DUPLICATE_CASE")
        changes = {k: [case.get(k), v] for k, v in fields.items() if (case.get(k) or None) != (v or None) and not (k == "restricted" and bool(case.get(k)) == bool(v))}
        if not changes:
            return jsonify({"ok": True, "case": case_dict(fetch_case(case_id), True), "changed": []})
        with env.tx() as c:
            sets = dict(fields)
            if "case_no" in sets:
                sets["case_key"] = L.norm_key(sets["case_no"])
            if "status" in changes:
                if fields["status"] in L.CLOSED_STATUSES:
                    sets["closed_at"] = case["closed_at"] or L.now_iso()
                else:
                    sets["closed_at"], sets["outcome"] = None, case["outcome"]
            sets["updated_at"] = L.now_iso()
            c.execute(f"UPDATE lpms_cases SET {', '.join(k + ' = ?' for k in sets)} WHERE id = ?", list(sets.values()) + [case_id])
            if "status" in changes:
                reopened = case["closed_at"] and fields["status"] not in L.CLOSED_STATUSES
                L.timeline(c, m["firm_id"], case_id, "status", f"Status: {case['status']} → {fields['status']}" + (" (reopened)" if reopened else ""), None, m["id"])
            other = [k for k in changes if k not in ("status", "advocate_id")]
            if other:
                L.timeline(c, m["firm_id"], case_id, "updated", "Updated " + ", ".join(CASE_FIELDS_LABEL.get(k, k) for k in other), None, m["id"])
            if "advocate_id" in changes:
                names = env.names([case["advocate_id"], fields["advocate_id"]])
                L.timeline(c, m["firm_id"], case_id, "assigned", f"Assigned to {names.get(fields['advocate_id'], 'nobody')}" +
                           (f" (was {names[case['advocate_id']]})" if names.get(case["advocate_id"]) else ""), None, m["id"])
                adv = L.one(c, "SELECT user_id FROM lpms_members WHERE id = ?", (fields["advocate_id"],)) if fields["advocate_id"] else None
                if adv and adv["user_id"] != m["user_id"]:
                    L.notify(c, m["firm_id"], adv["user_id"], "assignment", f"Case assigned to you: {case['title']}", f"{m['name']} assigned {case['case_no']} ({case['court']}) to you.",
                             f"/practice/cases/{case_id}", case_id, f"assign:{case_id}:{fields['advocate_id']}", email=True)
            readable = {k: [v[0], v[1]] for k, v in changes.items() if k != "remarks"}
            env.audit("case_update", "case", case_id, f"Case {case['case_no']} updated: " + ", ".join(CASE_FIELDS_LABEL.get(k, k) for k in changes), {"changes": readable})
            updated = L.one(c, "SELECT * FROM lpms_cases WHERE id = ?", (case_id,))
            if ("status" in changes or other) and "advocate_id" not in changes:
                L.notify_case(c, m["firm_id"], updated, m, "case_update", "case_update", f"Case updated: {case['title']}",
                              f"{m['name']} updated {case['case_no']}: " + ", ".join(CASE_FIELDS_LABEL.get(k, k) for k in changes) + ".",
                              dedupe=f"upd:{case_id}:{uuid.uuid4().hex[:8]}")
        env.kick_email()
        return jsonify({"ok": True, "case": case_dict(fetch_case(case_id), True), "changed": list(changes)})

    @env.api("/cases/<int:case_id>/archive", methods=("POST",), perm="archive_case")
    def archive_case(case_id):
        case = env.get_case(case_id, full=True)
        archive = truthy((request.get_json(silent=True) or {}).get("archive", True))
        if archive and case["archived_at"] or (not archive and not case["archived_at"]):
            return jsonify({"ok": True, "case": case_dict(fetch_case(case_id), True)})
        with env.tx() as c:
            c.execute("UPDATE lpms_cases SET archived_at = ?, updated_at = ? WHERE id = ?", (L.now_iso() if archive else None, L.now_iso(), case_id))
            L.timeline(c, env.m["firm_id"], case_id, "archived" if archive else "restored", "Case archived" if archive else "Case restored from the archive", None, env.m["id"])
            env.audit("case_archive" if archive else "case_restore", "case", case_id, f"Case {case['case_no']} {'archived' if archive else 'restored'}")
        return jsonify({"ok": True, "case": case_dict(fetch_case(case_id), True)})

    # ── parties ─────────────────────────────────────────────────────────────────────
    def party_fields(b):
        return (choice(b.get("role"), L.PARTY_ROLES, "Role", required=True), text(b.get("name"), 160, "Name", required=True), text(b.get("contact"), 120, "Contact"), text(b.get("notes"), 500, "Notes"))

    @env.api("/cases/<int:case_id>/parties", methods=("POST",))
    def add_party(case_id):
        case = env.get_case(case_id, write=True)
        role, name, contact, notes = party_fields(request.get_json(silent=True) or {})
        with env.tx() as c:
            pid = c.execute("INSERT INTO lpms_parties (case_id, role, name, contact, notes, created_at) VALUES (?,?,?,?,?,?)", (case_id, role, name, contact, notes, L.now_iso())).lastrowid
            L.timeline(c, env.m["firm_id"], case_id, "party", f"{role.replace('_', ' ').title()} added: {name}", None, env.m["id"])
            env.audit("case_update", "case", case_id, f"Party added to {case['case_no']}: {name} ({role})")
        return jsonify({"ok": True, "party": L.one(env.conn(), "SELECT * FROM lpms_parties WHERE id = ?", (pid,))}), 201

    def party_case(party_id, write=True):
        p = L.one(env.conn(), "SELECT * FROM lpms_parties WHERE id = ?", (party_id,))
        if not p:
            raise ApiError("Party not found.", 404)
        env.get_case(p["case_id"], write=write)
        return p

    @env.api("/parties/<int:party_id>", methods=("PATCH",))
    def edit_party(party_id):
        p = party_case(party_id)
        b = request.get_json(silent=True) or {}
        role, name, contact, notes = party_fields({**p, **b})
        with env.tx() as c:
            c.execute("UPDATE lpms_parties SET role = ?, name = ?, contact = ?, notes = ? WHERE id = ?", (role, name, contact, notes, party_id))
            env.audit("case_update", "case", p["case_id"], f"Party edited: {name}")
        return jsonify({"ok": True, "party": L.one(env.conn(), "SELECT * FROM lpms_parties WHERE id = ?", (party_id,))})

    @env.api("/parties/<int:party_id>", methods=("DELETE",))
    def delete_party(party_id):
        p = party_case(party_id)
        with env.tx() as c:
            c.execute("DELETE FROM lpms_parties WHERE id = ?", (party_id,))
            env.audit("case_update", "case", p["case_id"], f"Party removed: {p['name']}")
        return jsonify({"ok": True})

    # ── hearings & the cause list ───────────────────────────────────────────────────
    def hearing_dict(h, member=None, case_adv=None):
        m = member or env.m
        d = {k: h[k] for k in ("id", "case_id", "hearing_date", "hearing_time", "court", "hall_no", "judge", "purpose", "serial_no", "advocate_id", "status", "note")}
        adv = h.get("advocate_id") or case_adv
        d["writable"] = m["role"] == "senior" or (m["role"] == "junior" and (env.settings.get("junior_scope") == "all" or adv == m["id"] or case_adv == m["id"]))
        return d

    def hearing_list(case_id):
        c = env.conn()
        case = L.one(c, "SELECT advocate_id FROM lpms_cases WHERE id = ?", (case_id,))
        rows_ = L.rows(c, "SELECT h.*, ad.name AS advocate_name FROM lpms_hearings h LEFT JOIN lpms_members ad ON ad.id = h.advocate_id WHERE h.case_id = ? ORDER BY h.hearing_date DESC, h.id DESC", (case_id,))
        out = []
        for h in rows_:
            d = hearing_dict(h, case_adv=case["advocate_id"])
            d["advocate_name"] = h["advocate_name"]
            out.append(d)
        return out

    def clash_warnings(c, hearing, exclude_id=None):
        out = []
        adv = hearing["advocate_id"]
        if adv and hearing["hearing_time"]:
            r = L.one(c, "SELECT h.id, ca.title FROM lpms_hearings h JOIN lpms_cases ca ON ca.id = h.case_id WHERE h.firm_id = ? AND h.advocate_id = ? AND h.hearing_date = ? "
                         "AND h.hearing_time = ? AND h.status = 'scheduled' AND h.id != ? AND h.case_id != ? LIMIT 1",
                      (hearing["firm_id"], adv, hearing["hearing_date"], hearing["hearing_time"], exclude_id or 0, hearing["case_id"]))
            if r:
                out.append(f"This advocate already has “{r['title']}” listed at {hearing['hearing_time']} the same day.")
        return out

    def make_hearing(c, case, b, actor, notify=True):
        """Insert a hearing for a case (the shared path for the hearing form, the first date on a new case, and 'next date' on a proceeding)."""
        day = date_of(b.get("date") or b.get("hearing_date"), "Hearing date", required=True)
        if L.one(c, "SELECT id FROM lpms_hearings WHERE case_id = ? AND hearing_date = ? AND status = 'scheduled'", (case["id"], day)):
            raise ApiError("This case already has a hearing on that date.", 409, code="DUPLICATE_HEARING")
        adv = env.member_in_firm(b["advocate_id"], "Advocate", advocates_only=True) if b.get("advocate_id") not in (None, "") else case["advocate_id"]
        now = L.now_iso()
        row = {"firm_id": case["firm_id"], "case_id": case["id"], "hearing_date": day, "hearing_time": time_of(b.get("time") or b.get("hearing_time")),
               "court": text(b.get("court"), 160, "Court") or case["court"], "hall_no": text(b.get("hall_no"), 30, "Hall") or case["hall_no"],
               "judge": text(b.get("judge"), 120, "Judge") or case["judge"], "purpose": text(b.get("purpose"), 200, "Purpose"), "serial_no": text(b.get("serial_no"), 20, "Item number"),
               "advocate_id": adv, "status": "scheduled", "note": text(b.get("note"), 1000, "Note"), "created_by": actor["id"], "created_at": now, "updated_at": now}
        hid = c.execute(f"INSERT INTO lpms_hearings ({', '.join(row)}) VALUES ({', '.join('?' for _ in row)})", list(row.values())).lastrowid
        L.timeline(c, case["firm_id"], case["id"], "hearing", f"Hearing scheduled for {R.nice(day)}" + (f" — {row['purpose']}" if row["purpose"] else ""), None, actor["id"], hid)
        L.audit(c, case["firm_id"], actor["user_id"], actor["name"], "hearing_create", "hearing", hid, f"Hearing on {day} scheduled for {case['case_no']}", {"case_id": case["id"]}, env.ip())
        warns = env.holiday_warnings(day) + clash_warnings(c, {**row, "id": hid})
        if notify:
            L.notify_case(c, case["firm_id"], case, actor, "case_update", "case_update", f"Hearing scheduled: {case['title']}", f"{R.nice(day)}" + (f" at {row['hearing_time']}" if row["hearing_time"] else "") +
                          f" — {case['case_no']}", dedupe=f"hnew:{hid}")
        if adv and adv != case["advocate_id"] and adv != actor["id"]:
            who = L.one(c, "SELECT user_id FROM lpms_members WHERE id = ?", (adv,))
            if who:
                L.notify(c, case["firm_id"], who["user_id"], "assignment", f"You are listed for a hearing: {case['title']}", f"{R.nice(day)} — {case['case_no']}",
                         f"/practice/cases/{case['id']}", case["id"], f"hassign:{hid}", email=True)
        return hid, warns

    @env.api("/cases/<int:case_id>/hearings", methods=("POST",))
    def add_hearing(case_id):
        case = env.get_case(case_id, write=True)
        b = request.get_json(silent=True) or {}
        if "advocate_id" in b and b["advocate_id"] not in (None, "") and not env.perms["assign_case"] and as_int(b["advocate_id"]) != (case["advocate_id"] or env.m["id"]):
            raise ApiError("Only a Senior Advocate can list a hearing under someone else.", 403, code="FORBIDDEN")
        with env.tx() as c:
            hid, warns = make_hearing(c, case, b, env.m)
        env.kick_email()
        return jsonify({"ok": True, "hearing": hearing_dict(L.one(env.conn(), "SELECT * FROM lpms_hearings WHERE id = ?", (hid,)), case_adv=case["advocate_id"]), "warnings": warns}), 201

    def get_hearing(hid, write=True):
        h = L.one(env.conn(), "SELECT * FROM lpms_hearings WHERE id = ?", (hid,))
        if not h:
            raise ApiError("Hearing not found.", 404)
        case = env.get_case(h["case_id"], write=write)
        if write and case["_level"] == "limited" and not (case["advocate_id"] == env.m["id"] or h["advocate_id"] == env.m["id"] or env.settings.get("junior_scope") == "all"):
            raise ApiError("This hearing is not assigned to you.", 403, code="FORBIDDEN")
        return h, case

    @env.api("/hearings/<int:hid>", methods=("PATCH",))
    def edit_hearing(hid):
        h, case = get_hearing(hid)
        b = request.get_json(silent=True) or {}
        m = env.m
        upd = {}
        if "hearing_date" in b or "date" in b:
            upd["hearing_date"] = date_of(b.get("hearing_date") or b.get("date"), "Hearing date", required=True)
        if "hearing_time" in b or "time" in b:
            upd["hearing_time"] = time_of(b.get("hearing_time", b.get("time")))
        for k, n, lab in (("court", 160, "Court"), ("hall_no", 30, "Hall"), ("judge", 120, "Judge"), ("purpose", 200, "Purpose"), ("serial_no", 20, "Item number"), ("note", 1000, "Note")):
            if k in b:
                upd[k] = text(b[k], n, lab)
        if "status" in b:
            upd["status"] = choice(b["status"], L.HEARING_STATUSES, "Status", required=True)
        if "advocate_id" in b:
            if not env.perms["assign_case"] and as_int(b["advocate_id"]) != h["advocate_id"]:
                raise ApiError("Only a Senior Advocate can change who is listed for a hearing.", 403, code="FORBIDDEN")
            upd["advocate_id"] = env.member_in_firm(b["advocate_id"], "Advocate", advocates_only=True)
        changes = {k: [h[k], v] for k, v in upd.items() if (h[k] or None) != (v or None)}
        if not changes:
            return jsonify({"ok": True, "hearing": hearing_dict(h, case_adv=case["advocate_id"]), "warnings": []})
        if "hearing_date" in changes and L.one(env.conn(), "SELECT id FROM lpms_hearings WHERE case_id = ? AND hearing_date = ? AND status = 'scheduled' AND id != ?",
                                               (case["id"], upd["hearing_date"], hid)):
            raise ApiError("This case already has a hearing on that date.", 409, code="DUPLICATE_HEARING")
        warns = []
        with env.tx() as c:
            c.execute(f"UPDATE lpms_hearings SET {', '.join(k + ' = ?' for k in upd)}, updated_at = ? WHERE id = ?", list(upd.values()) + [L.now_iso(), hid])
            new = L.one(c, "SELECT * FROM lpms_hearings WHERE id = ?", (hid,))
            if "hearing_date" in changes:
                L.timeline(c, m["firm_id"], case["id"], "hearing", f"Hearing moved from {R.nice(h['hearing_date'])} to {R.nice(upd['hearing_date'])}", None, m["id"], hid)
                warns += env.holiday_warnings(upd["hearing_date"])
                L.notify_case(c, m["firm_id"], case, m, "case_update", "case_update", f"Hearing rescheduled: {case['title']}", f"{case['case_no']} is now on {R.nice(upd['hearing_date'])}.",
                              dedupe=f"hmove:{hid}:{upd['hearing_date']}")
            elif "status" in changes:
                L.timeline(c, m["firm_id"], case["id"], "hearing", f"Hearing on {R.nice(h['hearing_date'])} marked {upd['status']}", None, m["id"], hid)
            else:
                L.timeline(c, m["firm_id"], case["id"], "hearing", f"Hearing on {R.nice(new['hearing_date'])} edited", None, m["id"], hid)
            warns += clash_warnings(c, new, hid)
            env.audit("hearing_update", "hearing", hid, f"Hearing for {case['case_no']} changed: " + ", ".join(changes), {"changes": changes})
            if "advocate_id" in changes and upd["advocate_id"] and upd["advocate_id"] != m["id"]:
                who = L.one(c, "SELECT user_id FROM lpms_members WHERE id = ?", (upd["advocate_id"],))
                if who:
                    L.notify(c, m["firm_id"], who["user_id"], "assignment", f"You are listed for a hearing: {case['title']}", f"{R.nice(new['hearing_date'])} — {case['case_no']}",
                             f"/practice/cases/{case['id']}", case["id"], f"hassign:{hid}:{upd['advocate_id']}", email=True)
        env.kick_email()
        return jsonify({"ok": True, "hearing": hearing_dict(L.one(env.conn(), "SELECT * FROM lpms_hearings WHERE id = ?", (hid,)), case_adv=case["advocate_id"]), "warnings": warns})

    @env.api("/hearings/<int:hid>", methods=("DELETE",))
    def delete_hearing(hid):
        h, case = get_hearing(hid)
        c = env.conn()
        if h["status"] not in ("scheduled", "cancelled") or c.execute("SELECT 1 FROM lpms_proceedings WHERE hearing_id = ?", (hid,)).fetchone():
            raise ApiError("A hearing that already has a record cannot be deleted. Mark it cancelled instead.", 409)
        with env.tx() as tc:
            tc.execute("DELETE FROM lpms_hearings WHERE id = ?", (hid,))
            L.timeline(tc, env.m["firm_id"], case["id"], "hearing", f"Hearing on {R.nice(h['hearing_date'])} removed", None, env.m["id"])
            env.audit("hearing_delete", "hearing", hid, f"Hearing on {h['hearing_date']} removed from {case['case_no']}")
        return jsonify({"ok": True})

    @env.api("/hearings")
    def hearings():
        a = request.args
        m, c = env.m, env.conn()
        today = L.today_ist()
        if a.get("date"):
            lo = hi = date_of(a["date"])
        else:
            lo = date_of(a.get("from")) or today.isoformat()
            hi = date_of(a.get("to")) or lo
        if hi < lo:
            lo, hi = hi, lo
        if (L.parse_date(hi) - L.parse_date(lo)).days > 400:
            raise ApiError("Pick a range of at most 400 days.", 400)
        extra, params = "AND h.hearing_date BETWEEN :lo AND :hi", {"lo": lo, "hi": hi, "mid": m["id"]}
        if a.get("status"):
            sts = [s for s in a["status"].split(",") if s in L.HEARING_STATUSES]
            if sts:
                extra += f" AND h.status IN ({','.join(repr(s) for s in sts)})"
        if a.get("court"):
            extra += " AND COALESCE(h.court, c.court) = :court"
            params["court"] = a["court"]
        if as_int(a.get("advocate_id")):
            extra += " AND COALESCE(h.advocate_id, c.advocate_id) = :adv"
            params["adv"] = as_int(a["advocate_id"])
        if truthy(a.get("mine")):
            extra += " AND COALESCE(h.advocate_id, c.advocate_id) = :mid"
        if as_int(a.get("case_id")):
            extra += " AND c.id = :cid"
            params["cid"] = as_int(a["case_id"])
        order = "h.hearing_date, COALESCE(h.court, c.court), h.hall_no, CAST(h.serial_no AS INTEGER), h.hearing_time"
        hs = R.hearing_rows(c, m, extra, params, order=order)
        out = []
        for h in hs:
            d = hearing_dict(h, case_adv=h["case_adv"])
            d.update({"case_no": h["case_no"], "title": h["title"], "case_type": h["case_type"], "court": h["court"] or h["case_court"], "client_id": h["client_id"],
                      "client_name": h["client_name"], "has_phone": bool(h["client_phone"]), "advocate_name": h["advocate_name"]})
            out.append(d)
        holidays = {r["start_date"]: r["title"] for r in c.execute("SELECT start_date, title FROM lpms_events WHERE firm_id = ? AND kind = 'holiday' AND start_date BETWEEN ? AND ?", (m["firm_id"], lo, hi))}
        courts = sorted({h["court"] for h in out if h["court"]})
        return jsonify({"hearings": out, "from": lo, "to": hi, "holidays": holidays, "courts": courts, "today": today.isoformat()})

    # ── daily proceedings ───────────────────────────────────────────────────────────
    def proc_dict(p):
        return {k: p[k] for k in ("id", "case_id", "hearing_id", "proc_date", "outcome", "notes", "observations", "orders", "next_date", "next_purpose", "author_id", "created_at", "edited_at")} | {
            "author": p.get("author")}

    @env.api("/cases/<int:case_id>/proceedings")
    def list_proceedings(case_id):
        env.get_case(case_id)
        rows_ = L.rows(env.conn(), "SELECT p.*, a.name AS author FROM lpms_proceedings p LEFT JOIN lpms_members a ON a.id = p.author_id WHERE p.case_id = ? ORDER BY p.proc_date DESC, p.id DESC", (case_id,))
        return jsonify({"proceedings": [proc_dict(p) for p in rows_]})

    @env.api("/cases/<int:case_id>/proceedings", methods=("POST",))
    def add_proceeding(case_id):
        case = env.get_case(case_id, write=True)
        b = request.get_json(silent=True) or {}
        m = env.m
        c = env.conn()
        day = date_of(b.get("proc_date"), "Date") or L.today_ist().isoformat()
        if day > (L.today_ist() + timedelta(days=1)).isoformat():
            raise ApiError("A proceeding records what already happened — the date cannot be in the future.", 400)
        notes, obs, orders = text(b.get("notes"), 8000, "Hearing notes"), text(b.get("observations"), 8000, "Court observations"), text(b.get("orders"), 8000, "Orders passed")
        outcome = choice(b.get("outcome"), L.OUTCOMES, "Outcome")
        if not (notes or obs or orders or outcome):
            raise ApiError("Write something about the hearing — notes, observations, the order passed, or pick an outcome.", 400)
        next_date = date_of(b.get("next_date"), "Next hearing date")
        if next_date and next_date < day:
            raise ApiError("The next hearing date cannot be before this hearing.", 400)
        set_status = choice(b.get("set_status"), L.STATUSES, "Case status") if b.get("set_status") else None
        hearing = None
        if as_int(b.get("hearing_id")):
            hearing = L.one(c, "SELECT * FROM lpms_hearings WHERE id = ? AND case_id = ?", (as_int(b["hearing_id"]), case_id))
            if not hearing:
                raise ApiError("That hearing does not belong to this case.", 400)
        elif b.get("hearing_id") != "none":
            hearing = L.one(c, "SELECT * FROM lpms_hearings WHERE case_id = ? AND hearing_date = ? AND status = 'scheduled' ORDER BY id LIMIT 1", (case_id, day))
        warns, created = [], None
        with env.tx() as tc:
            pid = tc.execute("INSERT INTO lpms_proceedings (firm_id, case_id, hearing_id, proc_date, outcome, notes, observations, orders, next_date, next_purpose, author_id, created_at) "
                             "VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", (m["firm_id"], case_id, hearing["id"] if hearing else None, day, outcome, notes, obs, orders, next_date,
                                                                  text(b.get("next_purpose"), 200, "Purpose"), m["id"], L.now_iso())).lastrowid
            if hearing and hearing["status"] == "scheduled":
                tc.execute("UPDATE lpms_hearings SET status = ?, updated_at = ? WHERE id = ?", ("adjourned" if outcome == "adjourned" else "heard", L.now_iso(), hearing["id"]))
            if next_date:
                existing = L.one(tc, "SELECT id FROM lpms_hearings WHERE case_id = ? AND hearing_date = ? AND status = 'scheduled'", (case_id, next_date))
                if existing:
                    created = existing["id"]
                else:
                    base = {"date": next_date, "purpose": b.get("next_purpose"), "court": hearing["court"] if hearing else None, "hall_no": hearing["hall_no"] if hearing else None,
                            "judge": hearing["judge"] if hearing else None}
                    created, warns = make_hearing(tc, case, base, m, notify=False)
            label = {"heard": "Heard", "adjourned": "Adjourned", "reserved": "Orders reserved", "disposed": "Disposed", "other": "Recorded"}.get(outcome, "Recorded")
            title = f"{R.nice(day)}: {label}" + (f" — next date {R.nice(next_date)}" if next_date else "")
            detail = (orders or notes or obs or "")[:240]
            L.timeline(tc, m["firm_id"], case_id, "proceeding", title, detail, m["id"], pid)
            if set_status and set_status != case["status"]:
                sets = {"status": set_status, "updated_at": L.now_iso()}
                if set_status in L.CLOSED_STATUSES:
                    sets["closed_at"] = case["closed_at"] or L.now_iso()
                    if orders and not case["outcome"]:
                        sets["outcome"] = orders[:300]
                else:
                    sets["closed_at"] = None
                tc.execute(f"UPDATE lpms_cases SET {', '.join(k + ' = ?' for k in sets)} WHERE id = ?", list(sets.values()) + [case_id])
                L.timeline(tc, m["firm_id"], case_id, "status", f"Status: {case['status']} → {set_status}", None, m["id"])
            env.audit("proceeding_create", "case", case_id, f"Proceeding recorded for {case['case_no']} ({R.nice(day)})", {"proceeding_id": pid, "outcome": outcome, "next_date": next_date})
            updated = L.one(tc, "SELECT * FROM lpms_cases WHERE id = ?", (case_id,))
            L.notify_case(tc, m["firm_id"], updated, m, "case_update", "case_update", f"Proceeding recorded: {case['title']}",
                          f"{m['name']} — {title}" + (f". {detail}" if detail else ""), dedupe=f"proc:{pid}")
        env.kick_email()
        p = L.one(env.conn(), "SELECT p.*, a.name AS author FROM lpms_proceedings p LEFT JOIN lpms_members a ON a.id = p.author_id WHERE p.id = ?", (pid,))
        return jsonify({"ok": True, "proceeding": proc_dict(p), "next_hearing_id": created, "warnings": warns, "case": case_dict(fetch_case(case_id), True)}), 201

    @env.api("/proceedings/<int:pid>", methods=("PATCH",))
    def edit_proceeding(pid):
        p = L.one(env.conn(), "SELECT * FROM lpms_proceedings WHERE id = ?", (pid,))
        if not p:
            raise ApiError("Proceeding not found.", 404)
        case = env.get_case(p["case_id"], write=True)
        if p["author_id"] != env.m["id"] and env.m["role"] != "senior":
            raise ApiError("Only the person who wrote this entry, or a Senior Advocate, can edit it.", 403, code="FORBIDDEN")
        b = request.get_json(silent=True) or {}
        new = {"notes": text(b["notes"], 8000, "Hearing notes") if "notes" in b else p["notes"], "observations": text(b["observations"], 8000, "Court observations") if "observations" in b else p["observations"],
               "orders": text(b["orders"], 8000, "Orders passed") if "orders" in b else p["orders"], "outcome": choice(b["outcome"], L.OUTCOMES, "Outcome") if "outcome" in b else p["outcome"]}
        if not (new["notes"] or new["observations"] or new["orders"] or new["outcome"]):
            raise ApiError("An entry cannot be left empty.", 400)
        changes = {k: [p[k], v] for k, v in new.items() if (p[k] or None) != (v or None)}
        if not changes:
            return jsonify({"ok": True})
        with env.tx() as c:
            c.execute("UPDATE lpms_proceedings SET notes = ?, observations = ?, orders = ?, outcome = ?, edited_at = ? WHERE id = ?",
                      (new["notes"], new["observations"], new["orders"], new["outcome"], L.now_iso(), pid))
            L.timeline(c, env.m["firm_id"], case["id"], "proceeding", f"Entry of {R.nice(p['proc_date'])} edited", None, env.m["id"], pid)
            env.audit("proceeding_update", "case", case["id"], f"Proceeding of {p['proc_date']} edited on {case['case_no']}", {"proceeding_id": pid, "changes": changes})
        row = L.one(env.conn(), "SELECT p.*, a.name AS author FROM lpms_proceedings p LEFT JOIN lpms_members a ON a.id = p.author_id WHERE p.id = ?", (pid,))
        return jsonify({"ok": True, "proceeding": proc_dict(row)})

    @env.api("/cases/<int:case_id>/timeline")
    def case_timeline(case_id):
        env.get_case(case_id)
        a = request.args
        where, params = "t.case_id = ?", [case_id]
        if a.get("kind"):
            kinds = [k for k in a["kind"].split(",") if k]
            where += f" AND t.kind IN ({','.join('?' for _ in kinds)})"
            params += kinds
        lim = min(max(as_int(a.get("limit"), 100), 1), 500)
        items = L.rows(env.conn(), f"SELECT t.id, t.kind, t.title, t.detail, t.ref_id, t.at, a.name AS actor FROM lpms_timeline t LEFT JOIN lpms_members a ON a.id = t.actor_id "
                                   f"WHERE {where} ORDER BY t.id DESC LIMIT ?", params + [lim])
        return jsonify({"items": items})

    # ── notes ───────────────────────────────────────────────────────────────────────
    def note_dict(n):
        return {"id": n["id"], "case_id": n["case_id"], "author_id": n["author_id"], "author": n.get("author"), "body": n["body"], "pinned": bool(n["pinned"]),
                "created_at": n["created_at"], "edited_at": n["edited_at"],
                "mine": n["author_id"] == env.m["id"], "can_edit": n["author_id"] == env.m["id"] or env.m["role"] == "senior"}

    NOTE_SELECT = "SELECT n.*, a.name AS author FROM lpms_notes n LEFT JOIN lpms_members a ON a.id = n.author_id "

    @env.api("/cases/<int:case_id>/notes")
    def case_notes(case_id):
        env.get_case(case_id)
        rows_ = L.rows(env.conn(), NOTE_SELECT + "WHERE n.case_id = ? ORDER BY n.pinned DESC, n.id DESC", (case_id,))
        return jsonify({"notes": [note_dict(n) for n in rows_]})

    @env.api("/cases/<int:case_id>/notes", methods=("POST",))
    def add_case_note(case_id):
        case = env.get_case(case_id, write=False)
        if case["archived_at"]:
            raise ApiError("This case is archived. Restore it to add notes.", 409, code="ARCHIVED")
        body = text((request.get_json(silent=True) or {}).get("body"), 4000, "Note", required=True)
        with env.tx() as c:
            nid = c.execute("INSERT INTO lpms_notes (firm_id, case_id, author_id, body, created_at) VALUES (?,?,?,?,?)", (env.m["firm_id"], case_id, env.m["id"], body, L.now_iso())).lastrowid
            L.timeline(c, env.m["firm_id"], case_id, "note", "Team note: " + (body[:90] + ("…" if len(body) > 90 else "")), None, env.m["id"], nid)
        return jsonify({"ok": True, "note": note_dict(L.one(env.conn(), NOTE_SELECT + "WHERE n.id = ?", (nid,)))}), 201

    @env.api("/notes")
    def firm_notes():
        rows_ = L.rows(env.conn(), NOTE_SELECT + "WHERE n.firm_id = ? AND n.case_id IS NULL AND n.client_id IS NULL ORDER BY n.pinned DESC, n.id DESC LIMIT 200", (env.m["firm_id"],))
        return jsonify({"notes": [note_dict(n) for n in rows_]})

    @env.api("/notes", methods=("POST",))
    def add_firm_note():
        body = text((request.get_json(silent=True) or {}).get("body"), 4000, "Note", required=True)
        with env.tx() as c:
            nid = c.execute("INSERT INTO lpms_notes (firm_id, author_id, body, created_at) VALUES (?,?,?,?)", (env.m["firm_id"], env.m["id"], body, L.now_iso())).lastrowid
        return jsonify({"ok": True, "note": note_dict(L.one(env.conn(), NOTE_SELECT + "WHERE n.id = ?", (nid,)))}), 201

    def own_note(nid):
        n = L.one(env.conn(), NOTE_SELECT + "WHERE n.id = ? AND n.firm_id = ?", (nid, env.m["firm_id"]))
        if not n:
            raise ApiError("Note not found.", 404)
        if n["case_id"]:
            env.get_case(n["case_id"])
        if n["author_id"] != env.m["id"] and env.m["role"] != "senior":
            raise ApiError("Only the author or a Senior Advocate can change this note.", 403, code="FORBIDDEN")
        return n

    @env.api("/notes/<int:nid>", methods=("PATCH",))
    def edit_note(nid):
        n = own_note(nid)
        b = request.get_json(silent=True) or {}
        body = text(b["body"], 4000, "Note", required=True) if "body" in b else n["body"]
        pinned = 1 if truthy(b.get("pinned", n["pinned"])) else 0
        with env.tx() as c:
            c.execute("UPDATE lpms_notes SET body = ?, pinned = ?, edited_at = ? WHERE id = ?", (body, pinned, L.now_iso() if body != n["body"] else n["edited_at"], nid))
        return jsonify({"ok": True, "note": note_dict(L.one(env.conn(), NOTE_SELECT + "WHERE n.id = ?", (nid,)))})

    @env.api("/notes/<int:nid>", methods=("DELETE",))
    def delete_note(nid):
        own_note(nid)
        with env.tx() as c:
            c.execute("DELETE FROM lpms_notes WHERE id = ?", (nid,))
        return jsonify({"ok": True})

    # ── client communication ────────────────────────────────────────────────────────
    def comm_dict(r):
        return {k: r[k] for k in ("id", "case_id", "client_id", "channel", "direction", "subject", "body", "status", "to_addr", "created_at")} | {"by": r.get("by_name")}

    def log_comm(c, case, channel, subject, body, status, to_addr, direction="out", client_id=None):
        return c.execute("INSERT INTO lpms_comms (firm_id, case_id, client_id, channel, direction, subject, body, status, to_addr, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                         (env.m["firm_id"], case["id"] if case else None, client_id or (case["client_id"] if case else None), channel, direction, subject, body, status, to_addr,
                          env.m["id"], L.now_iso())).lastrowid

    @env.api("/comms")
    def comms():
        a = request.args
        c = env.conn()
        where, params = ["m.firm_id = ?"], [env.m["firm_id"]]
        if as_int(a.get("case_id")):
            env.get_case(as_int(a["case_id"]))
            where.append("m.case_id = ?")
            params.append(as_int(a["case_id"]))
        elif as_int(a.get("client_id")):
            env.client_in_firm(a["client_id"])
            where.append("m.client_id = ?")
            params.append(as_int(a["client_id"]))
        else:
            raise ApiError("Say which case or client.", 400)
        if a.get("channel") in L.COMM_CHANNELS:
            where.append("m.channel = ?")
            params.append(a["channel"])
        rows_ = L.rows(c, f"SELECT m.*, u.name AS by_name FROM lpms_comms m LEFT JOIN lpms_members u ON u.id = m.created_by WHERE {' AND '.join(where)} ORDER BY m.id DESC LIMIT 200", params)
        # a restricted case's messages never leak through its client's page
        if as_int(a.get("client_id")):
            vis, vp = L.case_visible_sql(env.m, "c")
            ok = {r["id"] for r in c.execute(f"SELECT c.id FROM lpms_cases c WHERE {vis}", vp)}
            rows_ = [r for r in rows_ if not r["case_id"] or r["case_id"] in ok]
        return jsonify({"comms": [comm_dict(r) for r in rows_]})

    @env.api("/comms", methods=("POST",), perm="log_comms")
    def add_comm():
        b = request.get_json(silent=True) or {}
        case = env.get_case(as_int(b.get("case_id"))) if as_int(b.get("case_id")) else None
        client_id = env.client_in_firm(b.get("client_id")) if b.get("client_id") else (case["client_id"] if case else None)
        if not case and not client_id:
            raise ApiError("Say which case or client this is about.", 400)
        channel = choice(b.get("channel"), L.COMM_CHANNELS, "Type", required=True)
        body = text(b.get("body"), 4000, "What was discussed", required=True)
        with env.tx() as c:
            cid = log_comm(c, case, channel, text(b.get("subject"), 200, "Subject"), body, "logged", None, choice(b.get("direction"), ["in", "out"], "Direction", default="out"), client_id)
            if case:
                L.timeline(c, env.m["firm_id"], case["id"], "comm", f"Client contact logged ({channel})", body[:120], env.m["id"], cid)
            env.audit("comm_log", "client", client_id, f"{channel.title()} contact logged")
        return jsonify({"ok": True, "comm": comm_dict(L.one(env.conn(), "SELECT m.*, u.name AS by_name FROM lpms_comms m LEFT JOIN lpms_members u ON u.id = m.created_by WHERE m.id = ?", (cid,)))}), 201

    def reminder_for(case, hearing_id):
        c = env.conn()
        if hearing_id:
            h = L.one(c, "SELECT * FROM lpms_hearings WHERE id = ? AND case_id = ?", (hearing_id, case["id"]))
        else:
            h = L.one(c, "SELECT * FROM lpms_hearings WHERE case_id = ? AND status = 'scheduled' AND hearing_date >= ? ORDER BY hearing_date LIMIT 1", (case["id"], L.today_ist().isoformat()))
        if not h:
            raise ApiError("There is no upcoming hearing to remind about. Add the next date first, or write your own message.", 409, code="NO_HEARING")
        client = L.one(c, "SELECT * FROM lpms_clients WHERE id = ?", (case["client_id"],)) if case["client_id"] else None
        text_ = L.client_reminder_text(client["name"] if client else "Sir/Madam", env.m["firm_name"], case["title"], case["case_no"], h["hearing_date"], h["hearing_time"],
                                       h["court"] or case["court"], h["hall_no"])
        return client, h, text_

    @env.api("/cases/<int:case_id>/message-draft")
    def message_draft(case_id):
        case = env.get_case(case_id)
        client, h, body = reminder_for(case, as_int(request.args.get("hearing_id")))
        return jsonify({"subject": f"Reminder: hearing on {R.nice(h['hearing_date'])}", "body": body, "hearing_id": h["id"],
                        "client": {"name": client["name"] if client else None, "phone": bool(client and client["phone"]), "email": bool(client and client["email"])} if client else None})

    @env.api("/cases/<int:case_id>/whatsapp", methods=("POST",), perm="log_comms")
    def whatsapp(case_id):
        case = env.get_case(case_id)
        if not env.settings["channels"].get("whatsapp", True):
            raise ApiError("WhatsApp reminders are switched off in Settings.", 409)
        b = request.get_json(silent=True) or {}
        client = L.one(env.conn(), "SELECT * FROM lpms_clients WHERE id = ?", (case["client_id"],)) if case["client_id"] else None
        if not client:
            raise ApiError("This case has no client yet. Add one first.", 409, code="NO_CLIENT")
        msg = text(b.get("text"), 1500, "Message")
        if not msg:
            _, _, msg = reminder_for(case, as_int(b.get("hearing_id")))
        url = L.whatsapp_url(client["phone"], msg)
        if not url:
            raise ApiError(f"{client['name']} has no usable phone number on file. Add one on the client's page.", 409, code="NO_PHONE")
        with env.tx() as c:
            cid = log_comm(c, case, "whatsapp", "WhatsApp reminder", msg, "opened", client["phone"])
            L.timeline(c, env.m["firm_id"], case_id, "comm", "WhatsApp message opened for " + client["name"], msg[:120], env.m["id"], cid)
            env.audit("notification_whatsapp", "case", case_id, f"WhatsApp message opened for {client['name']} ({case['case_no']})")
        return jsonify({"ok": True, "url": url, "text": msg, "note": "WhatsApp opens with the message ready. It is sent only when you press Send there."})

    @env.api("/cases/<int:case_id>/email", methods=("POST",), perm="log_comms")
    def email_client(case_id):
        case = env.get_case(case_id)
        b = request.get_json(silent=True) or {}
        client = L.one(env.conn(), "SELECT * FROM lpms_clients WHERE id = ?", (case["client_id"],)) if case["client_id"] else None
        if not client:
            raise ApiError("This case has no client yet. Add one first.", 409, code="NO_CLIENT")
        if not client["email"]:
            raise ApiError(f"{client['name']} has no e-mail address on file. Add one on the client's page.", 409, code="NO_EMAIL")
        subject, body = text(b.get("subject"), 200, "Subject"), text(b.get("body"), 6000, "Message")
        if not body:
            _, h, body = reminder_for(case, as_int(b.get("hearing_id")))
            subject = subject or f"Reminder: hearing on {R.nice(h['hearing_date'])}"
        subject = subject or f"Regarding {case['title']}"
        configured = bool(env.email_configured())
        delivered = False
        if configured:
            try:
                delivered = bool(env.send_email(client["email"], subject, body))
            except Exception as exc:
                env.log(f"client email failed: {exc}")
        status = "sent" if delivered else ("failed" if configured else "not_sent")
        with env.tx() as c:
            cid = log_comm(c, case, "email", subject, body, status, client["email"])
            L.timeline(c, env.m["firm_id"], case_id, "comm", ("E-mail sent to " if delivered else "E-mail NOT delivered to ") + client["name"], subject, env.m["id"], cid)
            env.audit("notification_email", "case", case_id, f"E-mail to {client['name']} — {status}", {"subject": subject})
        msg = ("E-mail sent." if delivered else ("The e-mail could not be delivered. Check the SMTP settings on the server." if configured else
                                                 "E-mail is not set up on this server yet (SMTP settings are missing), so nothing was sent. The attempt is saved in the history."))
        return jsonify({"ok": True, "delivered": delivered, "configured": configured, "message": msg})

    # ── follow-ups ──────────────────────────────────────────────────────────────────
    def fu_dict(f):
        return {k: f[k] for k in ("id", "client_id", "case_id", "due_date", "note", "channel", "assignee_id", "status", "created_at", "done_at")} | {
            "client_name": f.get("client_name"), "assignee": f.get("assignee"), "case_title": f.get("case_title"), "overdue": f["status"] == "open" and f["due_date"] < L.today_ist().isoformat()}

    FU_SELECT = ("SELECT f.*, cl.name AS client_name, a.name AS assignee, c.title AS case_title FROM lpms_followups f LEFT JOIN lpms_clients cl ON cl.id = f.client_id "
                 "LEFT JOIN lpms_members a ON a.id = f.assignee_id LEFT JOIN lpms_cases c ON c.id = f.case_id ")

    @env.api("/followups")
    def followups():
        a = request.args
        where, params = ["f.firm_id = ?"], [env.m["firm_id"]]
        st = a.get("status", "open")
        if st in ("open", "done"):
            where.append("f.status = ?")
            params.append(st)
        for k, col in (("client_id", "f.client_id"), ("case_id", "f.case_id")):
            if as_int(a.get(k)):
                where.append(f"{col} = ?")
                params.append(as_int(a[k]))
        if truthy(a.get("mine")):
            where.append("f.assignee_id = ?")
            params.append(env.m["id"])
        vis, vp = L.case_visible_sql(env.m, "c")
        ok = {r["id"] for r in env.conn().execute(f"SELECT c.id FROM lpms_cases c WHERE {vis}", vp)}
        rows_ = L.rows(env.conn(), FU_SELECT + f"WHERE {' AND '.join(where)} ORDER BY f.status DESC, f.due_date, f.id LIMIT 300", params)
        return jsonify({"followups": [fu_dict(f) for f in rows_ if not f["case_id"] or f["case_id"] in ok]})

    @env.api("/followups", methods=("POST",), perm="log_comms")
    def add_followup():
        b = request.get_json(silent=True) or {}
        case = env.get_case(as_int(b.get("case_id"))) if as_int(b.get("case_id")) else None
        client_id = env.client_in_firm(b.get("client_id")) if b.get("client_id") else (case["client_id"] if case else None)
        if not case and not client_id:
            raise ApiError("Say which client or case this follow-up is for.", 400)
        due = date_of(b.get("due_date"), "Due date", required=True)
        note = text(b.get("note"), 500, "What needs to be done", required=True)
        assignee = env.member_in_firm(b.get("assignee_id"), "Assignee") if b.get("assignee_id") else env.m["id"]
        with env.tx() as c:
            fid = c.execute("INSERT INTO lpms_followups (firm_id, client_id, case_id, due_date, note, channel, assignee_id, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
                            (env.m["firm_id"], client_id, case["id"] if case else None, due, note, choice(b.get("channel"), L.COMM_CHANNELS, "Channel"), assignee, env.m["id"], L.now_iso())).lastrowid
            env.audit("followup_create", "client", client_id, f"Follow-up set for {due}: {note[:80]}")
        return jsonify({"ok": True, "followup": fu_dict(L.one(env.conn(), FU_SELECT + "WHERE f.id = ?", (fid,)))}), 201

    @env.api("/followups/<int:fid>", methods=("PATCH",))
    def edit_followup(fid):
        f = L.one(env.conn(), FU_SELECT + "WHERE f.id = ? AND f.firm_id = ?", (fid, env.m["firm_id"]))
        if not f:
            raise ApiError("Follow-up not found.", 404)
        if f["case_id"]:
            env.get_case(f["case_id"])
        b = request.get_json(silent=True) or {}
        due = date_of(b["due_date"], "Due date", required=True) if "due_date" in b else f["due_date"]
        note = text(b["note"], 500, "What needs to be done", required=True) if "note" in b else f["note"]
        status = choice(b.get("status"), ["open", "done"], "Status", default=f["status"])
        with env.tx() as c:
            c.execute("UPDATE lpms_followups SET due_date = ?, note = ?, status = ?, done_at = ? WHERE id = ?", (due, note, status, L.now_iso() if status == "done" and f["status"] != "done" else (f["done_at"] if status == "done" else None), fid))
            env.audit("followup_update", "client", f["client_id"], f"Follow-up {'completed' if status == 'done' else 'updated'}: {note[:80]}")
        return jsonify({"ok": True, "followup": fu_dict(L.one(env.conn(), FU_SELECT + "WHERE f.id = ?", (fid,)))})

    @env.api("/followups/<int:fid>", methods=("DELETE",))
    def delete_followup(fid):
        f = L.one(env.conn(), "SELECT * FROM lpms_followups WHERE id = ? AND firm_id = ?", (fid, env.m["firm_id"]))
        if not f:
            raise ApiError("Follow-up not found.", 404)
        with env.tx() as c:
            c.execute("DELETE FROM lpms_followups WHERE id = ?", (fid,))
        return jsonify({"ok": True})

    env.fetch_case, env.case_dict, env.hearing_list = fetch_case, case_dict, hearing_list
    _ = like
