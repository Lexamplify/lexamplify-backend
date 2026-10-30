"""
routes/lpms_more.py - Practice: clients, the RTI tracker, the calendar (events, court holidays, deadlines),
reports with PDF / Excel export, and the firm backup download.
"""
import io
import json
import re
import zipfile
from datetime import date, timedelta

from flask import Response, jsonify, request

from routes.lpms_common import ApiError, as_int, choice, date_of, email_of, like, phone_of, text, time_of, truthy
from utils import lpms_reports as R
from utils import lpms_store as L

FIXED_HOLIDAYS = [("01-26", "Republic Day"), ("04-14", "Dr. Ambedkar Jayanti"), ("08-15", "Independence Day"), ("10-02", "Gandhi Jayanti"), ("12-25", "Christmas Day")]
RTI_OPEN = ("filed", "replied", "partial", "rejected", "appeal1", "appeal2")


def mask(s):
    s = (s or "").strip()
    return ("•" * max(0, len(s) - 4) + s[-4:]) if len(s) > 4 else s


def digits(s):
    return re.sub(r"\D+", "", s or "")[-10:]


def register(env):
    # ── clients ─────────────────────────────────────────────────────────────────────
    def client_fields(b, existing=None):
        out = {}
        if "name" in b or not existing:
            out["name"] = text(b.get("name"), 160, "Client name", required=True)
        for k, n, lab in (("address", 500, "Address"), ("occupation", 120, "Occupation"), ("notes", 3000, "Notes"), ("id_number", 60, "ID number")):
            if k in b:
                out[k] = text(b[k], n, lab)
        if "phone" in b:
            out["phone"] = phone_of(b["phone"])
        if "email" in b:
            out["email"] = email_of(b["email"])
        if "id_type" in b:
            out["id_type"] = choice(b["id_type"], L.ID_TYPES, "ID type")
        if "comm_pref" in b:
            out["comm_pref"] = choice(b["comm_pref"], L.COMM_PREFS, "Preferred contact")
        return out

    def client_dict(r, detail=False):
        d = {k: r[k] for k in ("id", "name", "phone", "email", "address", "occupation", "comm_pref", "id_type", "archived", "created_at")}
        d["archived"] = bool(r["archived"])
        d["id_number"] = r["id_number"] if detail else mask(r["id_number"])
        if detail:
            d["notes"] = r["notes"]
        return d

    @env.api("/clients")
    def list_clients():
        a = request.args
        c, m = env.conn(), env.m
        where, params = ["cl.firm_id = :fid", "cl.archived = :arch"], {"fid": m["firm_id"], "arch": 1 if truthy(a.get("archived")) else 0}
        if (a.get("q") or "").strip():
            params["q"] = like(a["q"])
            where.append("(LOWER(cl.name) LIKE :q OR COALESCE(cl.phone,'') LIKE :q OR LOWER(COALESCE(cl.email,'')) LIKE :q)")
        per = min(max(as_int(a.get("per_page"), 40), 1), 200)
        page = min(max(as_int(a.get("page"), 1), 1), 100000)
        total = c.execute(f"SELECT COUNT(*) FROM lpms_clients cl WHERE {' AND '.join(where)}", params).fetchone()[0]
        rows_ = L.rows(c, f"SELECT cl.* FROM lpms_clients cl WHERE {' AND '.join(where)} ORDER BY cl.name COLLATE NOCASE LIMIT :lim OFFSET :off", {**params, "lim": per, "off": (page - 1) * per})
        vis, vp = L.case_visible_sql(m, "c")
        out = []
        gate_f, gpf = env.case_gate("f.case_id")
        for r in rows_:
            d = client_dict(r)
            cs = L.rows(c, f"SELECT c.closed_at, c.archived_at FROM lpms_cases c WHERE {vis} AND c.client_id = :cl", {**vp, "cl": r["id"]})
            d["cases"] = len(cs)
            d["active_cases"] = sum(1 for x in cs if not x["closed_at"] and not x["archived_at"])
            d["open_followups"] = c.execute(f"SELECT COUNT(*) FROM lpms_followups f WHERE f.client_id = :cl AND f.status = 'open' AND {gate_f}", {**gpf, "cl": r["id"]}).fetchone()[0]
            out.append(d)
        return jsonify({"clients": out, "total": total, "page": page, "per_page": per})

    @env.api("/clients", methods=("POST",), perm="manage_clients")
    def create_client():
        b = request.get_json(silent=True) or {}
        f = client_fields(b)
        c = env.conn()
        if not truthy(b.get("force")):
            for r in c.execute("SELECT id, name, phone, email FROM lpms_clients WHERE firm_id = ? AND archived = 0", (env.m["firm_id"],)):
                if (f.get("phone") and digits(r["phone"]) and digits(r["phone"]) == digits(f["phone"])) or (f.get("email") and r["email"] and r["email"].lower() == f["email"]):
                    raise ApiError(f"{r['name']} already has this phone number or e-mail. Open that client, or save anyway if this is a different person.", 409,
                                   code="DUPLICATE_CLIENT", existing={"id": r["id"], "name": r["name"]})
        with env.tx() as tc:
            now = L.now_iso()
            cols = {**f, "firm_id": env.m["firm_id"], "created_by": env.m["id"], "created_at": now, "updated_at": now}
            cid = tc.execute(f"INSERT INTO lpms_clients ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})", list(cols.values())).lastrowid
            env.audit("client_create", "client", cid, f"Client “{f['name']}” added")
        return jsonify({"ok": True, "client": client_dict(L.one(env.conn(), "SELECT * FROM lpms_clients WHERE id = ?", (cid,)), True)}), 201

    def get_client_row(cid):
        r = L.one(env.conn(), "SELECT * FROM lpms_clients WHERE id = ? AND firm_id = ?", (cid, env.m["firm_id"]))
        if not r:
            raise ApiError("Client not found.", 404)
        return r

    @env.api("/clients/<int:cid>")
    def get_client(cid):
        r = get_client_row(cid)
        c, m = env.conn(), env.m
        vis, vp = L.case_visible_sql(m, "c")
        cases = L.rows(c, f"SELECT c.id, c.case_no, c.title, c.court, c.status, c.case_type, c.archived_at, c.closed_at, ad.name AS advocate_name, "
                          f"(SELECT MIN(h.hearing_date) FROM lpms_hearings h WHERE h.case_id = c.id AND h.status = 'scheduled' AND h.hearing_date >= :today) AS next_hearing "
                          f"FROM lpms_cases c LEFT JOIN lpms_members ad ON ad.id = c.advocate_id WHERE {vis} AND c.client_id = :cl ORDER BY c.updated_at DESC",
                       {**vp, "cl": cid, "today": L.today_ist().isoformat()})
        d = client_dict(r, True)
        d["case_list"] = cases
        return jsonify({"client": d})

    @env.api("/clients/<int:cid>", methods=("PATCH",), perm="manage_clients")
    def edit_client(cid):
        r = get_client_row(cid)
        f = client_fields(request.get_json(silent=True) or {}, existing=r)
        changes = [k for k, v in f.items() if (r[k] or None) != (v or None)]
        if changes:
            with env.tx() as c:
                c.execute(f"UPDATE lpms_clients SET {', '.join(k + ' = ?' for k in f)}, updated_at = ? WHERE id = ?", list(f.values()) + [L.now_iso(), cid])
                env.audit("client_update", "client", cid, f"Client “{r['name']}” updated: " + ", ".join(changes))
        return jsonify({"ok": True, "client": client_dict(L.one(env.conn(), "SELECT * FROM lpms_clients WHERE id = ?", (cid,)), True)})

    @env.api("/clients/<int:cid>/archive", methods=("POST",), perm="manage_clients")
    def archive_client(cid):
        r = get_client_row(cid)
        archive = truthy((request.get_json(silent=True) or {}).get("archive", True))
        with env.tx() as c:
            c.execute("UPDATE lpms_clients SET archived = ?, updated_at = ? WHERE id = ?", (1 if archive else 0, L.now_iso(), cid))
            env.audit("client_update", "client", cid, f"Client “{r['name']}” {'archived' if archive else 'restored'}")
        return jsonify({"ok": True})

    # ── RTI tracker ─────────────────────────────────────────────────────────────────
    RTI_LABEL = {"draft": "Draft", "filed": "Filed — waiting for reply", "replied": "Replied", "partial": "Partly answered", "rejected": "Rejected / refused",
                 "appeal1": "First appeal filed", "appeal2": "Second appeal filed", "closed": "Closed"}

    def plus(day, n):
        try:
            return (date.fromisoformat(day) + timedelta(days=n)).isoformat() if day else None
        except (ValueError, OverflowError):
            return None

    def rti_dict(r, names=None):
        d = {k: r[k] for k in ("id", "case_id", "client_id", "subject", "department", "pio", "reference_no", "filing_date", "mode", "fee", "response_due", "response_date", "appeal_due",
                               "appeal1_date", "appeal2_due", "appeal2_date", "status", "outcome", "assignee_id", "notes", "created_at", "updated_at")}
        d["status_label"] = RTI_LABEL[r["status"]]
        today = L.today_ist()
        nxt = None
        for field, label, applies in (("response_due", "Reply due", r["status"] == "filed"), ("appeal_due", "First appeal due", r["status"] in ("replied", "partial", "rejected")),
                                      ("appeal2_due", "Second appeal due", r["status"] == "appeal1")):
            if applies and r[field]:
                try:
                    nxt = {"label": label, "date": r[field], "days": (date.fromisoformat(r[field]) - today).days}
                except ValueError:
                    pass
        d["next_deadline"] = nxt
        d["assignee"] = (names or {}).get(r["assignee_id"])
        d["client_name"] = r.get("client_name")
        d["case_title"] = r.get("case_title")
        return d

    RTI_SELECT = "SELECT r.*, cl.name AS client_name, c.title AS case_title FROM lpms_rti r LEFT JOIN lpms_clients cl ON cl.id = r.client_id LEFT JOIN lpms_cases c ON c.id = r.case_id "

    def rti_fields(b, existing=None):
        out = {}
        if "subject" in b or not existing:
            out["subject"] = text(b.get("subject"), 300, "What the application asks for", required=True)
        if "department" in b or not existing:
            out["department"] = text(b.get("department"), 200, "Department / public authority", required=True)
        for k, n, lab in (("pio", 200, "PIO"), ("reference_no", 80, "Reference number"), ("mode", 40, "Mode"), ("fee", 40, "Fee"), ("outcome", 1000, "Outcome"), ("notes", 3000, "Notes")):
            if k in b:
                out[k] = text(b[k], n, lab)
        for k, lab in (("filing_date", "Filing date"), ("response_due", "Reply due date"), ("response_date", "Date reply received"), ("appeal_due", "First appeal deadline"),
                       ("appeal1_date", "First appeal filed on"), ("appeal2_due", "Second appeal deadline"), ("appeal2_date", "Second appeal filed on")):
            if k in b:
                out[k] = date_of(b[k], lab)
        if "status" in b:
            out["status"] = choice(b["status"], L.RTI_STATUSES, "Status", required=True)
        if "case_id" in b:
            out["case_id"] = env.get_case(as_int(b["case_id"]))["id"] if b["case_id"] not in (None, "") else None
        if "client_id" in b:
            out["client_id"] = env.client_in_firm(b["client_id"])
        if "assignee_id" in b:
            out["assignee_id"] = env.member_in_firm(b["assignee_id"], "Assignee") if b["assignee_id"] not in (None, "") else None
        return out

    def suggest_dates(merged, prev=None):
        """RTI Act timelines as helpful defaults only: 30 days for the reply, 30 days to file the first appeal. Anything the person
        typed is never overwritten."""
        prev = prev or {}
        if merged.get("filing_date") and not merged.get("response_due") and merged.get("status") != "draft":
            merged["response_due"] = plus(merged["filing_date"], 30)
        if merged.get("status") in ("replied", "partial", "rejected") and not merged.get("appeal_due"):
            base = merged.get("response_date") or merged.get("response_due")
            merged["appeal_due"] = plus(base, 30)
        return merged

    @env.api("/rti")
    def list_rti():
        a = request.args
        where, params = ["r.firm_id = ?"], [env.m["firm_id"]]
        if a.get("status") == "open":
            where.append(f"r.status IN ({','.join(repr(s) for s in RTI_OPEN)})")
        elif a.get("status") in L.RTI_STATUSES:
            where.append("r.status = ?")
            params.append(a["status"])
        if as_int(a.get("case_id")):
            where.append("r.case_id = ?")
            params.append(as_int(a["case_id"]))
        if (a.get("q") or "").strip():
            where.append("(LOWER(r.subject) LIKE ? OR LOWER(r.department) LIKE ? OR LOWER(COALESCE(r.reference_no,'')) LIKE ?)")
            params += [like(a["q"])] * 3
        rows_ = L.rows(env.conn(), RTI_SELECT + f"WHERE {' AND '.join(where)} ORDER BY CASE r.status WHEN 'closed' THEN 1 ELSE 0 END, COALESCE(r.response_due, '9999'), r.id DESC LIMIT 500", params)
        names = env.names([r["assignee_id"] for r in rows_])
        vis, vp = L.case_visible_sql(env.m, "c")
        ok = {r["id"] for r in env.conn().execute(f"SELECT c.id FROM lpms_cases c WHERE {vis}", vp)}
        out = [rti_dict(r, names) for r in rows_ if not r["case_id"] or r["case_id"] in ok]
        counts = {}
        for r in out:
            counts[r["status"]] = counts.get(r["status"], 0) + 1
        return jsonify({"rti": out, "counts": counts})

    def rti_event(c, rid, kind, note):
        c.execute("INSERT INTO lpms_rti_events (rti_id, kind, note, actor_id, at) VALUES (?,?,?,?,?)", (rid, kind, note, env.m["id"], L.now_iso()))

    @env.api("/rti", methods=("POST",), perm="manage_rti")
    def create_rti():
        f = suggest_dates({"status": "draft", **rti_fields(request.get_json(silent=True) or {})})
        f.setdefault("assignee_id", env.m["id"])
        if f["status"] != "draft" and not f.get("filing_date"):
            raise ApiError("Enter the filing date for an application that has been filed.", 400)
        with env.tx() as c:
            now = L.now_iso()
            cols = {**f, "firm_id": env.m["firm_id"], "created_by": env.m["id"], "created_at": now, "updated_at": now}
            rid = c.execute(f"INSERT INTO lpms_rti ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})", list(cols.values())).lastrowid
            rti_event(c, rid, "created", f"Application recorded ({RTI_LABEL[f['status']]})")
            if f.get("case_id"):
                L.timeline(c, env.m["firm_id"], f["case_id"], "rti", f"RTI application: {f['subject'][:120]}", f["department"], env.m["id"], rid)
            env.audit("rti_create", "rti", rid, f"RTI application added: {f['subject'][:100]}", {"department": f["department"]})
        return jsonify({"ok": True, "rti": rti_dict(L.one(env.conn(), RTI_SELECT + "WHERE r.id = ?", (rid,)), env.names([f.get("assignee_id")]))}), 201

    def get_rti_row(rid):
        r = L.one(env.conn(), RTI_SELECT + "WHERE r.id = ? AND r.firm_id = ?", (rid, env.m["firm_id"]))
        if not r:
            raise ApiError("RTI application not found.", 404)
        if r["case_id"]:
            env.get_case(r["case_id"])
        return r

    @env.api("/rti/<int:rid>")
    def get_rti(rid):
        r = get_rti_row(rid)
        events = L.rows(env.conn(), "SELECT e.id, e.kind, e.note, e.at, a.name AS actor FROM lpms_rti_events e LEFT JOIN lpms_members a ON a.id = e.actor_id WHERE e.rti_id = ? ORDER BY e.id DESC", (rid,))
        return jsonify({"rti": rti_dict(r, env.names([r["assignee_id"]])), "events": events})

    @env.api("/rti/<int:rid>", methods=("PATCH",), perm="manage_rti")
    def edit_rti(rid):
        r = get_rti_row(rid)
        f = rti_fields(request.get_json(silent=True) or {}, existing=r)
        merged = suggest_dates({**{k: r[k] for k in r.keys()}, **f}, r)
        for k in ("response_due", "appeal_due"):
            if merged.get(k) != r[k] and k not in f:
                f[k] = merged[k]
        if merged["status"] != "draft" and not merged.get("filing_date"):
            raise ApiError("Enter the filing date for an application that has been filed.", 400)
        changes = [k for k, v in f.items() if (r[k] or None) != (v or None)]
        if changes:
            with env.tx() as c:
                c.execute(f"UPDATE lpms_rti SET {', '.join(k + ' = ?' for k in f)}, updated_at = ? WHERE id = ?", list(f.values()) + [L.now_iso(), rid])
                if "status" in f and f["status"] != r["status"]:
                    rti_event(c, rid, "status", f"{RTI_LABEL[r['status']]} → {RTI_LABEL[f['status']]}")
                    if r["case_id"]:
                        L.timeline(c, env.m["firm_id"], r["case_id"], "rti", f"RTI “{r['subject'][:80]}”: {RTI_LABEL[f['status']]}", None, env.m["id"], rid)
                rest = [k for k in changes if k != "status"]
                if rest:
                    rti_event(c, rid, "updated", "Updated " + ", ".join(k.replace("_", " ") for k in rest))
                env.audit("rti_update", "rti", rid, f"RTI “{r['subject'][:80]}” updated: " + ", ".join(changes))
        row = L.one(env.conn(), RTI_SELECT + "WHERE r.id = ?", (rid,))
        return jsonify({"ok": True, "rti": rti_dict(row, env.names([row["assignee_id"]]))})

    @env.api("/rti/<int:rid>/events", methods=("POST",), perm="manage_rti")
    def add_rti_event(rid):
        r = get_rti_row(rid)
        note = text((request.get_json(silent=True) or {}).get("note"), 1500, "Note", required=True)
        with env.tx() as c:
            rti_event(c, rid, "note", note)
            c.execute("UPDATE lpms_rti SET updated_at = ? WHERE id = ?", (L.now_iso(), rid))
            env.audit("rti_update", "rti", rid, f"Note added to RTI “{r['subject'][:80]}”")
        return jsonify({"ok": True}), 201

    @env.api("/rti/<int:rid>", methods=("DELETE",), perm="manage_settings")
    def delete_rti(rid):
        r = get_rti_row(rid)
        with env.tx() as c:
            c.execute("DELETE FROM lpms_rti_events WHERE rti_id = ?", (rid,))
            c.execute("DELETE FROM lpms_rti WHERE id = ?", (rid,))
            env.audit("rti_delete", "rti", rid, f"RTI application deleted: {r['subject'][:100]}")
        return jsonify({"ok": True})

    # ── calendar ────────────────────────────────────────────────────────────────────
    EVENT_SELECT = "SELECT e.*, a.name AS member_name FROM lpms_events e LEFT JOIN lpms_members a ON a.id = e.member_id "

    def event_dict(e):
        return {k: e[k] for k in ("id", "kind", "title", "start_date", "end_date", "start_time", "end_time", "location", "notes", "case_id", "client_id", "member_id", "created_by")} | {
            "member_name": e.get("member_name"), "can_edit": e["created_by"] == env.m["id"] or env.m["role"] == "senior"}

    def event_fields(b, existing=None):
        out = {}
        if "title" in b or not existing:
            out["title"] = text(b.get("title"), 200, "Title", required=True)
        if "kind" in b or not existing:
            out["kind"] = choice(b.get("kind"), L.EVENT_KINDS, "Type", default="meeting")
        if "start_date" in b or not existing:
            out["start_date"] = date_of(b.get("start_date"), "Date", required=True)
        for k, lab in (("end_date", "End date"),):
            if k in b:
                out[k] = date_of(b[k], lab)
        for k in ("start_time", "end_time"):
            if k in b:
                out[k] = time_of(b[k])
        if "location" in b:
            out["location"] = text(b["location"], 200, "Location")
        if "notes" in b:
            out["notes"] = text(b["notes"], 2000, "Notes")
        if "case_id" in b:
            out["case_id"] = env.get_case(as_int(b["case_id"]))["id"] if b["case_id"] not in (None, "") else None
        if "client_id" in b:
            out["client_id"] = env.client_in_firm(b["client_id"])
        if "member_id" in b:
            out["member_id"] = env.member_in_firm(b["member_id"], "Attendee") if b["member_id"] not in (None, "") else None
        sd, ed = out.get("start_date", existing and existing["start_date"]), out.get("end_date", existing and existing["end_date"])
        if sd and ed and ed < sd:
            raise ApiError("The end date cannot be before the start date.", 400)
        if out.get("kind") == "holiday" or (existing and existing["kind"] == "holiday" and "kind" not in out):
            env.need("add_holidays", "Only a Senior Advocate can add court holidays.")
        return out

    @env.api("/calendar")
    def calendar():
        a = request.args
        m, c = env.m, env.conn()
        lo = date_of(a.get("from"), "From", required=True)
        hi = date_of(a.get("to"), "To", required=True)
        if hi < lo or (date.fromisoformat(hi) - date.fromisoformat(lo)).days > 400:
            raise ApiError("Pick a range of at most 400 days.", 400)
        items = []
        vis, vp = L.case_visible_sql(m, "c")
        for h in R.hearing_rows(c, m, "AND h.hearing_date BETWEEN :lo AND :hi AND h.status != 'cancelled'", {"lo": lo, "hi": hi}):
            items.append({"type": "hearing", "id": h["id"], "date": h["hearing_date"], "time": h["hearing_time"], "title": h["title"], "sub": f"{h['case_no']} · {h['court'] or h['case_court']}",
                          "link": f"/practice/cases/{h['case_id']}", "status": h["status"], "case_id": h["case_id"]})
        gate_e, gpe = env.case_gate("e.case_id")
        gate_r, gpr = env.case_gate("r.case_id")
        gate_f, gpf = env.case_gate("f.case_id")
        for e in L.rows(c, EVENT_SELECT + f"WHERE e.firm_id = :fid AND e.start_date <= :hi AND COALESCE(e.end_date, e.start_date) >= :lo AND {gate_e}", {**gpe, "lo": lo, "hi": hi}):
            first, last = max(e["start_date"], lo), min(e["end_date"] or e["start_date"], hi)
            d0 = date.fromisoformat(first)
            for i in range((date.fromisoformat(last) - d0).days + 1):
                items.append({"type": e["kind"], "id": e["id"], "date": (d0 + timedelta(days=i)).isoformat(), "time": e["start_time"], "end_time": e["end_time"], "title": e["title"],
                              "sub": " · ".join(x for x in (e["location"], e["member_name"]) if x), "event": event_dict(e), "case_id": e["case_id"],
                              "link": f"/practice/cases/{e['case_id']}" if e["case_id"] else None})
        for cs in L.rows(c, f"SELECT c.id, c.case_no, c.title, c.next_action, c.next_action_due FROM lpms_cases c WHERE {vis} AND c.archived_at IS NULL AND c.closed_at IS NULL "
                            "AND c.next_action_due BETWEEN :lo AND :hi AND c.next_action IS NOT NULL AND c.next_action != ''", {**vp, "lo": lo, "hi": hi}):
            items.append({"type": "deadline", "id": cs["id"], "date": cs["next_action_due"], "time": None, "title": cs["next_action"], "sub": f"{cs['title']} · {cs['case_no']}",
                          "link": f"/practice/cases/{cs['id']}", "case_id": cs["id"], "source": "case"})
        for r in L.rows(c, f"SELECT r.* FROM lpms_rti r WHERE r.firm_id = :fid AND r.status IN ('filed','replied','partial','rejected','appeal1') AND {gate_r}", gpr):
            field, label = ("response_due", "RTI reply due") if r["status"] == "filed" else (("appeal2_due", "RTI second appeal due") if r["status"] == "appeal1" else ("appeal_due", "RTI first appeal due"))
            if r[field] and lo <= r[field] <= hi:
                items.append({"type": "rti", "id": r["id"], "date": r[field], "time": None, "title": f"{label}: {r['subject'][:80]}", "sub": r["department"], "link": "/practice/rti"})
        for f in L.rows(c, "SELECT f.*, cl.name AS client_name FROM lpms_followups f LEFT JOIN lpms_clients cl ON cl.id = f.client_id WHERE f.firm_id = :fid AND f.status = 'open' AND f.due_date BETWEEN :lo AND :hi AND " + gate_f,
                        {**gpf, "lo": lo, "hi": hi}):
            items.append({"type": "followup", "id": f["id"], "date": f["due_date"], "time": None, "title": f"Follow up{(' with ' + f['client_name']) if f['client_name'] else ''}", "sub": f["note"],
                          "link": f"/practice/cases/{f['case_id']}" if f["case_id"] else "/practice/clients"})
        items.sort(key=lambda i: (i["date"], i["time"] or "99:99", i["type"]))
        return jsonify({"items": items, "from": lo, "to": hi, "today": L.today_ist().isoformat()})

    @env.api("/events", methods=("POST",), perm="manage_calendar")
    def create_event():
        f = event_fields(request.get_json(silent=True) or {})
        f.setdefault("member_id", None)
        with env.tx() as c:
            cols = {**f, "firm_id": env.m["firm_id"], "created_by": env.m["id"], "created_at": L.now_iso()}
            eid = c.execute(f"INSERT INTO lpms_events ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})", list(cols.values())).lastrowid
            env.audit("event_create", "event", eid, f"{f['kind'].title()} added: {f['title']} ({f['start_date']})")
            if f.get("member_id") and f["member_id"] != env.m["id"] and f["kind"] != "holiday":
                who = L.one(c, "SELECT user_id FROM lpms_members WHERE id = ?", (f["member_id"],))
                if who:
                    L.notify(c, env.m["firm_id"], who["user_id"], "assignment", f"{f['kind'].title()}: {f['title']}", f"{f['start_date']} {f.get('start_time') or ''}".strip(), "/practice/calendar", f.get("case_id"),
                             f"evnew:{eid}", email=True)
        env.kick_email()
        return jsonify({"ok": True, "event": event_dict(L.one(env.conn(), EVENT_SELECT + "WHERE e.id = ?", (eid,)))}), 201

    def get_event(eid):
        e = L.one(env.conn(), EVENT_SELECT + "WHERE e.id = ? AND e.firm_id = ?", (eid, env.m["firm_id"]))
        if not e:
            raise ApiError("Event not found.", 404)
        if e["created_by"] != env.m["id"] and env.m["role"] != "senior":
            raise ApiError("Only the person who created this, or a Senior Advocate, can change it.", 403, code="FORBIDDEN")
        return e

    @env.api("/events/<int:eid>", methods=("PATCH",), perm="manage_calendar")
    def edit_event(eid):
        e = get_event(eid)
        f = event_fields(request.get_json(silent=True) or {}, existing=e)
        if f:
            with env.tx() as c:
                c.execute(f"UPDATE lpms_events SET {', '.join(k + ' = ?' for k in f)} WHERE id = ?", list(f.values()) + [eid])
                env.audit("event_update", "event", eid, f"{e['kind'].title()} updated: {f.get('title', e['title'])}")
        return jsonify({"ok": True, "event": event_dict(L.one(env.conn(), EVENT_SELECT + "WHERE e.id = ?", (eid,)))})

    @env.api("/events/<int:eid>", methods=("DELETE",), perm="manage_calendar")
    def delete_event(eid):
        e = get_event(eid)
        if e["kind"] == "holiday":
            env.need("add_holidays", "Only a Senior Advocate can remove court holidays.")
        with env.tx() as c:
            c.execute("DELETE FROM lpms_events WHERE id = ?", (eid,))
            env.audit("event_delete", "event", eid, f"{e['kind'].title()} removed: {e['title']}")
        return jsonify({"ok": True})

    @env.api("/events/holidays/fixed", methods=("POST",), perm="add_holidays")
    def add_fixed_holidays():
        year = as_int((request.get_json(silent=True) or {}).get("year"), L.today_ist().year)
        if not 2000 <= year <= 2100:
            raise ApiError("Pick a year between 2000 and 2100.", 400)
        added = 0
        with env.tx() as c:
            for md, title in FIXED_HOLIDAYS:
                day = f"{year}-{md}"
                if not c.execute("SELECT 1 FROM lpms_events WHERE firm_id = ? AND kind = 'holiday' AND start_date = ? AND title = ?", (env.m["firm_id"], day, title)).fetchone():
                    c.execute("INSERT INTO lpms_events (firm_id, kind, title, start_date, created_by, created_at) VALUES (?,?,?,?,?,?)", (env.m["firm_id"], "holiday", title, day, env.m["id"], L.now_iso()))
                    added += 1
            env.audit("event_create", "event", None, f"{added} fixed-date national holidays added for {year}")
        return jsonify({"ok": True, "added": added})

    # ── reports ─────────────────────────────────────────────────────────────────────
    @env.api("/reports")
    def report_list():
        return jsonify({"reports": [{"key": k, "title": R.REPORTS[k]} for k in env.perms["reports"]]})

    @env.api("/reports/<kind>")
    def report(kind):
        if kind not in R.REPORTS:
            raise ApiError("Unknown report.", 404)
        if kind not in env.perms["reports"]:
            raise ApiError("Your role does not include this report.", 403, code="FORBIDDEN")
        a = dict(request.args.items())
        for k in ("from", "to", "date"):
            if a.get(k):
                date_of(a[k], k.title())
        if a.get("month") and not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", a["month"]):
            raise ApiError("Month must be like 2026-09.", 400)
        if kind == "case_status" and truthy(a.get("mine")):
            a["advocate_id"] = str(env.m["id"])
        rep = R.build(kind, env.conn(), env.m, env.settings, a)
        fmt = (a.get("format") or "json").lower()
        if fmt == "json":
            return jsonify(rep)
        if fmt not in ("pdf", "xlsx"):
            raise ApiError("Format must be json, pdf or xlsx.", 400)
        slug = re.sub(r"[^a-z0-9]+", "-", f"{kind}-{rep['period']}".lower()).strip("-")
        data = R.to_pdf(rep) if fmt == "pdf" else R.to_xlsx(rep)
        with env.tx():
            env.audit("report_export", "report", None, f"{R.REPORTS[kind]} exported as {fmt.upper()} ({rep['period']})")
        mime = "application/pdf" if fmt == "pdf" else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        return Response(data, mimetype=mime, headers={"Content-Disposition": f'attachment; filename="{slug}.{fmt}"', "Cache-Control": "no-store"})

    # ── backup ──────────────────────────────────────────────────────────────────────
    BACKUP_TABLES = {
        "firm": "SELECT id, name, settings, created_at FROM lpms_firms WHERE id = :fid",
        "members": "SELECT id, role, name, email, phone, active, created_at FROM lpms_members WHERE firm_id = :fid",
        "clients": "SELECT * FROM lpms_clients WHERE firm_id = :fid",
        "cases": "SELECT * FROM lpms_cases WHERE firm_id = :fid",
        "parties": "SELECT p.* FROM lpms_parties p JOIN lpms_cases c ON c.id = p.case_id WHERE c.firm_id = :fid",
        "hearings": "SELECT * FROM lpms_hearings WHERE firm_id = :fid",
        "proceedings": "SELECT * FROM lpms_proceedings WHERE firm_id = :fid",
        "timeline": "SELECT * FROM lpms_timeline WHERE firm_id = :fid",
        "notes": "SELECT * FROM lpms_notes WHERE firm_id = :fid",
        "communications": "SELECT * FROM lpms_comms WHERE firm_id = :fid",
        "followups": "SELECT * FROM lpms_followups WHERE firm_id = :fid",
        "rti": "SELECT * FROM lpms_rti WHERE firm_id = :fid",
        "rti_events": "SELECT e.* FROM lpms_rti_events e JOIN lpms_rti r ON r.id = e.rti_id WHERE r.firm_id = :fid",
        "events": "SELECT * FROM lpms_events WHERE firm_id = :fid",
        "audit_log": "SELECT * FROM lpms_audit WHERE firm_id = :fid",
    }

    @env.api("/backup/export", perm="export_backup")
    def backup():
        c, m = env.conn(), env.m
        buf = io.BytesIO()
        counts = {}
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for name, sql in BACKUP_TABLES.items():
                rows_ = L.rows(c, sql, {"fid": m["firm_id"]})
                counts[name] = len(rows_)
                z.writestr(f"{name}.json", json.dumps(rows_, ensure_ascii=False, indent=1, default=str))
            try:
                z.writestr("cases.xlsx", R.to_xlsx(R.build("case_status", c, m, env.settings, {"archived": "all"})))
            except Exception as exc:                          # the spreadsheet is a convenience; the JSON is the backup
                env.log(f"backup xlsx skipped: {exc}")
            z.writestr("README.txt", f"LexAmplify Practice backup for {m['firm_name']}\nCreated {L.now_dt().strftime('%d %b %Y %H:%M')} by {m['name']}\n\n"
                                     "Each .json file is one table, exactly as stored. Documents are kept in the Document Hub and are not part of this file\n"
                                     "(use the Hub's “Download as ZIP” for those). Passwords and two-step secrets are never exported.\n\n" +
                                     "\n".join(f"{k}: {v} record(s)" for k, v in counts.items()))
        with env.tx():
            env.audit("backup_export", "firm", m["firm_id"], "Practice data downloaded as a backup file", counts)
        name = f"practice-backup-{L.today_ist().isoformat()}.zip"
        return Response(buf.getvalue(), mimetype="application/zip", headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"})
