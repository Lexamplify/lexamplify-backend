"""
utils/lpms_reports.py - the Practice module's reports, and their PDF / Excel renderers.

Every report builds the same plain structure, so one renderer serves them all:

    {"key": ..., "title": ..., "period": "1 Sep 2026 - 30 Sep 2026", "generated": ..., "firm": ...,
     "summary": [{"label", "value"}],
     "tables":  [{"title", "columns": [{"key", "label", "align"?}], "rows": [{key: value}]}]}

Only cases the asking member may see are ever counted (restricted cases stay hidden from other juniors and staff).
"""
import io
import os
import sqlite3
from datetime import date, timedelta

from utils import lpms_store as L

REPORTS = {
    "monthly_summary": "Monthly case summary",
    "advocate_performance": "Advocate performance",
    "case_status": "Case status report",
    "upcoming_hearings": "Upcoming hearings",
    "closed_cases": "Closed cases",
    "client_activity": "Client activity",
    "cause_list": "Daily cause list",
}

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def nice(d):
    if not d:
        return ""
    try:
        x = d if isinstance(d, date) else date.fromisoformat(str(d)[:10])
    except ValueError:
        return str(d)
    return f"{x.day} {MONTHS[x.month - 1]} {x.year}"


def _period(a, b):
    return nice(a) if a == b else f"{nice(a)} – {nice(b)}"


def _month_range(month):
    y, m = int(month[:4]), int(month[5:7])
    a = date(y, m, 1)
    b = (date(y + (m == 12), (m % 12) + 1, 1)) - timedelta(days=1)
    return a, b


def _docs_count(c, case_ids, a, b):
    """Documents uploaded to these cases in the period (from the Document Hub's tables, when present)."""
    if not case_ids:
        return {}
    try:
        marks = ",".join("?" for _ in case_ids)
        out = {}
        for r in c.execute(f"SELECT cv.case_id AS cid, COUNT(*) AS n FROM dms_docs d JOIN case_vault cv ON cv.id = d.doc_id "
                           f"WHERE cv.case_id IN ({marks}) AND d.deleted_at IS NULL AND date(d.created_at) BETWEEN ? AND ? GROUP BY cv.case_id",
                           [f"lpms:{i}" for i in case_ids] + [a.isoformat(), b.isoformat()]):
            out[int(r["cid"].split(":")[1])] = r["n"]
        return out
    except sqlite3.OperationalError:
        return {}


def _visible_cases(c, member, extra="", params=None):
    vis, p = L.case_visible_sql(member, "c")
    p.update(params or {})
    return L.rows(c, f"SELECT c.*, cl.name AS client_name, ad.name AS advocate_name FROM lpms_cases c "
                     f"LEFT JOIN lpms_clients cl ON cl.id = c.client_id LEFT JOIN lpms_members ad ON ad.id = c.advocate_id "
                     f"WHERE {vis} {extra}", p)


def _hearing_rows(c, member, extra="", params=None, order="h.hearing_date, h.hearing_time, c.court, h.hall_no, h.serial_no"):
    vis, p = L.case_visible_sql(member, "c")
    p.update(params or {})
    return L.rows(c, f"SELECT h.*, c.case_no, c.title, c.case_type, c.category, c.court AS case_court, c.client_id, c.advocate_id AS case_adv, "
                     f"cl.name AS client_name, cl.phone AS client_phone, ad.name AS advocate_name FROM lpms_hearings h JOIN lpms_cases c ON c.id = h.case_id "
                     f"LEFT JOIN lpms_clients cl ON cl.id = c.client_id LEFT JOIN lpms_members ad ON ad.id = COALESCE(h.advocate_id, c.advocate_id) "
                     f"WHERE {vis} AND c.archived_at IS NULL {extra} ORDER BY {order}", p)


hearing_rows = _hearing_rows
visible_cases = _visible_cases


def _days_between(a, b):
    try:
        return (date.fromisoformat(str(b)[:10]) - date.fromisoformat(str(a)[:10])).days
    except (TypeError, ValueError):
        return None


def _count_by(items, key, blank="—"):
    out = {}
    for it in items:
        k = it.get(key) or blank
        out[k] = out.get(k, 0) + 1
    return out


# ── builders ─────────────────────────────────────────────────────────────────────────
def build(kind, c, member, settings, params):
    if kind not in REPORTS:
        raise ValueError("Unknown report.")
    fn = globals()["_r_" + kind]
    rep = fn(c, member, settings, params)
    firm = L.one(c, "SELECT name FROM lpms_firms WHERE id = ?", (member["firm_id"],))
    rep.update({"key": kind, "title": REPORTS[kind], "firm": firm["name"] if firm else "", "generated": L.now_dt().strftime("%d %b %Y, %H:%M")})
    return rep


def _r_monthly_summary(c, member, st, p):
    month = p.get("month") or L.today_ist().strftime("%Y-%m")
    a, b = _month_range(month)
    a_s, b_s = a.isoformat(), b.isoformat()
    cases = _visible_cases(c, member)
    ids = [x["id"] for x in cases]
    opened = [x for x in cases if (x["created_at"] or "")[:10] >= a_s and (x["created_at"] or "")[:10] <= b_s]
    closed = [x for x in cases if x["closed_at"] and a_s <= x["closed_at"][:10] <= b_s]
    vis, vp = L.case_visible_sql(member, "c")
    held = L.rows(c, f"SELECT h.status, h.advocate_id, c.advocate_id AS cadv FROM lpms_hearings h JOIN lpms_cases c ON c.id = h.case_id "
                     f"WHERE {vis} AND h.hearing_date BETWEEN :a AND :b AND h.status IN ('heard','adjourned')", {**vp, "a": a_s, "b": b_s})
    procs = c.execute(f"SELECT COUNT(*) FROM lpms_proceedings pr JOIN lpms_cases c ON c.id = pr.case_id WHERE {vis} AND pr.proc_date BETWEEN :a AND :b",
                      {**vp, "a": a_s, "b": b_s}).fetchone()[0]
    docs = sum(_docs_count(c, ids, a, b).values())
    active_now = sum(1 for x in cases if not x["closed_at"] and not x["archived_at"])
    types = {}
    for x in cases:
        t = types.setdefault(x["case_type"], {"type": x["case_type"], "opened": 0, "closed": 0, "active": 0})
        t["opened"] += 1 if x in opened else 0
        t["closed"] += 1 if x in closed else 0
        t["active"] += 1 if (not x["closed_at"] and not x["archived_at"]) else 0
    advs = {}
    for x in cases:
        n = x["advocate_name"] or "Unassigned"
        r = advs.setdefault(n, {"advocate": n, "opened": 0, "closed": 0, "active": 0})
        r["opened"] += 1 if x in opened else 0
        r["closed"] += 1 if x in closed else 0
        r["active"] += 1 if (not x["closed_at"] and not x["archived_at"]) else 0
    cats = {}
    for x in opened:
        k = x["category"] or "Uncategorised"
        cats[k] = cats.get(k, 0) + 1
    return {
        "period": f"{MONTHS[a.month - 1]} {a.year}",
        "summary": [{"label": "New cases", "value": len(opened)}, {"label": "Cases closed", "value": len(closed)},
                    {"label": "Hearings held or adjourned", "value": len(held)}, {"label": "Proceedings recorded", "value": procs},
                    {"label": "Documents uploaded", "value": docs}, {"label": "Active cases today", "value": active_now}],
        "tables": [
            {"title": "By case type", "columns": [{"key": "type", "label": "Case type"}, {"key": "opened", "label": "Opened", "align": "r"},
                                                   {"key": "closed", "label": "Closed", "align": "r"}, {"key": "active", "label": "Active now", "align": "r"}],
             "rows": sorted(types.values(), key=lambda r: -r["opened"])},
            {"title": "By advocate", "columns": [{"key": "advocate", "label": "Advocate"}, {"key": "opened", "label": "Opened", "align": "r"},
                                                  {"key": "closed", "label": "Closed", "align": "r"}, {"key": "active", "label": "Active now", "align": "r"}],
             "rows": sorted(advs.values(), key=lambda r: -r["active"])},
            {"title": "New cases by category", "columns": [{"key": "category", "label": "Category"}, {"key": "n", "label": "Cases", "align": "r"}],
             "rows": [{"category": k, "n": v} for k, v in sorted(cats.items(), key=lambda kv: -kv[1])]},
            {"title": "Closed this month", "columns": [{"key": "case_no", "label": "Case no."}, {"key": "title", "label": "Title"}, {"key": "court", "label": "Court"},
                                                       {"key": "status", "label": "Result"}, {"key": "closed", "label": "Closed on"}],
             "rows": [{"case_no": x["case_no"], "title": x["title"], "court": x["court"], "status": x["status"], "closed": nice(x["closed_at"])} for x in closed]},
        ],
    }


def _r_advocate_performance(c, member, st, p):
    today = L.today_ist()
    a = L.parse_date(p.get("from")) or today.replace(day=1)
    b = L.parse_date(p.get("to")) or today
    a_s, b_s = a.isoformat(), b.isoformat()
    vis, vp = L.case_visible_sql(member, "c")
    out = []
    for m in L.members_of(c, member["firm_id"], active_only=False):
        if m["role"] == "staff":
            continue
        cs = L.rows(c, f"SELECT c.* FROM lpms_cases c WHERE {vis} AND c.advocate_id = :m", {**vp, "m": m["id"]})
        active = [x for x in cs if not x["closed_at"] and not x["archived_at"]]
        assigned = [x for x in cs if a_s <= (x["created_at"] or "")[:10] <= b_s]
        closed = [x for x in cs if x["closed_at"] and a_s <= x["closed_at"][:10] <= b_s]
        days = [d for d in (_days_between(x["filing_date"] or x["created_at"], x["closed_at"]) for x in closed) if d is not None and d >= 0]
        att = c.execute(f"SELECT COUNT(*) FROM lpms_hearings h JOIN lpms_cases c ON c.id = h.case_id WHERE {vis} "
                        f"AND COALESCE(h.advocate_id, c.advocate_id) = :m AND h.hearing_date BETWEEN :a AND :b AND h.status IN ('heard','adjourned')",
                        {**vp, "m": m["id"], "a": a_s, "b": b_s}).fetchone()[0]
        nxt = c.execute(f"SELECT COUNT(*) FROM lpms_hearings h JOIN lpms_cases c ON c.id = h.case_id WHERE {vis} AND h.status = 'scheduled' "
                        f"AND COALESCE(h.advocate_id, c.advocate_id) = :m AND h.hearing_date BETWEEN :t AND :t30",
                        {**vp, "m": m["id"], "t": today.isoformat(), "t30": (today + timedelta(days=30)).isoformat()}).fetchone()[0]
        procs = c.execute(f"SELECT COUNT(*) FROM lpms_proceedings pr JOIN lpms_cases c ON c.id = pr.case_id WHERE {vis} AND pr.author_id = :m "
                          f"AND pr.proc_date BETWEEN :a AND :b", {**vp, "m": m["id"], "a": a_s, "b": b_s}).fetchone()[0]
        overdue = L.pending_counts(c, m, st, today)["hearings"] if m["active"] else 0
        out.append({"advocate": m["name"] + ("" if m["active"] else " (inactive)"), "role": L.ROLE_LABEL[m["role"]], "active": len(active), "assigned": len(assigned),
                    "closed": len(closed), "hearings": att, "upcoming": nxt, "proceedings": procs,
                    "avg_days": round(sum(days) / len(days)) if days else "", "overdue": overdue})
    tot = lambda k: sum(r[k] for r in out)
    return {
        "period": _period(a, b),
        "summary": [{"label": "Advocates", "value": len(out)}, {"label": "Active cases", "value": tot("active")}, {"label": "Cases closed", "value": tot("closed")},
                    {"label": "Hearings attended", "value": tot("hearings")}, {"label": "Proceedings logged", "value": tot("proceedings")}],
        "tables": [{"title": "Per advocate", "columns": [
            {"key": "advocate", "label": "Advocate"}, {"key": "role", "label": "Role"}, {"key": "active", "label": "Active cases", "align": "r"},
            {"key": "assigned", "label": "Newly assigned", "align": "r"}, {"key": "closed", "label": "Closed", "align": "r"},
            {"key": "hearings", "label": "Hearings attended", "align": "r"}, {"key": "proceedings", "label": "Proceedings logged", "align": "r"},
            {"key": "upcoming", "label": "Next 30 days", "align": "r"}, {"key": "avg_days", "label": "Avg days to close", "align": "r"},
            {"key": "overdue", "label": "Updates overdue", "align": "r"}], "rows": out}],
    }


def case_filters_sql(p, params):
    """The case-list filters, shared by the Cases screen and the status report. Returns extra SQL (starting with AND)."""
    parts = []
    arch = p.get("archived")
    if arch == "1":
        parts.append("AND c.archived_at IS NOT NULL")
    elif arch != "all":
        parts.append("AND c.archived_at IS NULL")
    for key, col in (("status", "c.status"), ("case_type", "c.case_type"), ("priority", "c.priority"), ("category", "c.category"), ("court", "c.court")):
        v = p.get(key)
        if v:
            vals = [x for x in str(v).split(",") if x][:12]
            names = []
            for i, x in enumerate(vals):
                params[f"{key}{i}"] = x
                names.append(f":{key}{i}")
            parts.append(f"AND {col} IN ({','.join(names)})")
    if p.get("state") == "open":
        parts.append("AND c.closed_at IS NULL")
    elif p.get("state") == "closed":
        parts.append("AND c.closed_at IS NOT NULL")
    if str(p.get("advocate_id") or "").lstrip("-").isdigit():
        if int(p["advocate_id"]) == 0:
            parts.append("AND c.advocate_id IS NULL")
        else:
            parts.append("AND c.advocate_id = :f_adv")
            params["f_adv"] = int(p["advocate_id"])
    if str(p.get("client_id") or "").isdigit():
        parts.append("AND c.client_id = :f_client")
        params["f_client"] = int(p["client_id"])
    if p.get("hearing_from") or p.get("hearing_to"):
        sub = "EXISTS (SELECT 1 FROM lpms_hearings h WHERE h.case_id = c.id AND h.status = 'scheduled'"
        if p.get("hearing_from"):
            sub += " AND h.hearing_date >= :hf"
            params["hf"] = str(p["hearing_from"])[:10]
        if p.get("hearing_to"):
            sub += " AND h.hearing_date <= :ht"
            params["ht"] = str(p["hearing_to"])[:10]
        parts.append("AND " + sub + ")")
    if p.get("filed_from"):
        parts.append("AND c.filing_date >= :ff")
        params["ff"] = str(p["filed_from"])[:10]
    if p.get("filed_to"):
        parts.append("AND c.filing_date <= :ft")
        params["ft"] = str(p["filed_to"])[:10]
    q = (p.get("q") or "").strip()
    if q:
        like = f"%{q.lower()}%"
        key_like = f"%{L.norm_key(q)}%" if L.norm_key(q) else "%\u0000%"
        params["q_like"], params["q_key"] = like, key_like
        parts.append("AND (c.case_key LIKE :q_key OR LOWER(c.title) LIKE :q_like OR LOWER(c.court) LIKE :q_like OR LOWER(COALESCE(c.opposite_party,'')) LIKE :q_like "
                     "OR LOWER(COALESCE(c.judge,'')) LIKE :q_like OR LOWER(COALESCE(c.category,'')) LIKE :q_like OR LOWER(COALESCE(c.reg_no,'')) LIKE :q_like "
                     "OR LOWER(COALESCE(cl.name,'')) LIKE :q_like OR LOWER(COALESCE(ad.name,'')) LIKE :q_like "
                     "OR EXISTS (SELECT 1 FROM lpms_parties pt WHERE pt.case_id = c.id AND LOWER(pt.name) LIKE :q_like))")
    if p.get("party"):
        params["party_like"] = f"%{str(p['party']).lower()}%"
        parts.append("AND (LOWER(COALESCE(c.opposite_party,'')) LIKE :party_like OR EXISTS (SELECT 1 FROM lpms_parties pt WHERE pt.case_id = c.id AND LOWER(pt.name) LIKE :party_like))")
    return " ".join(parts)


def _r_case_status(c, member, st, p):
    params = {}
    extra = case_filters_sql(p, params)
    vis, vp = L.case_visible_sql(member, "c")
    params.update(vp)
    today = L.today_ist().isoformat()
    params["today"] = today
    items = L.rows(c, "SELECT c.*, cl.name AS client_name, ad.name AS advocate_name, "
                      "(SELECT MIN(h.hearing_date) FROM lpms_hearings h WHERE h.case_id = c.id AND h.status = 'scheduled' AND h.hearing_date >= :today) AS next_hearing, "
                      "(SELECT MAX(h.hearing_date) FROM lpms_hearings h WHERE h.case_id = c.id AND h.status IN ('heard','adjourned')) AS last_hearing "
                      f"FROM lpms_cases c LEFT JOIN lpms_clients cl ON cl.id = c.client_id LEFT JOIN lpms_members ad ON ad.id = c.advocate_id WHERE {vis} {extra} "
                      "ORDER BY c.status, c.court, c.case_no", params)
    by = _count_by(items, "status")
    rows = [{"case_no": x["case_no"], "title": x["title"], "court": x["court"], "case_type": x["case_type"], "category": x["category"] or "",
             "client": x["client_name"] or "", "advocate": x["advocate_name"] or "", "priority": x["priority"].title(), "status": x["status"],
             "last_hearing": nice(x["last_hearing"]), "next_hearing": nice(x["next_hearing"]), "next_action": x["next_action"] or "",
             "archived": "Yes" if x["archived_at"] else ""} for x in items]
    return {
        "period": "As of " + nice(today),
        "summary": [{"label": "Cases", "value": len(items)}] + [{"label": k, "value": v} for k, v in sorted(by.items(), key=lambda kv: -kv[1])],
        "tables": [{"title": "Cases", "columns": [
            {"key": "case_no", "label": "Case no."}, {"key": "title", "label": "Title"}, {"key": "court", "label": "Court"},
            {"key": "case_type", "label": "Type"}, {"key": "client", "label": "Client"}, {"key": "advocate", "label": "Advocate"},
            {"key": "priority", "label": "Priority"}, {"key": "status", "label": "Status"}, {"key": "last_hearing", "label": "Last hearing"},
            {"key": "next_hearing", "label": "Next hearing"}, {"key": "next_action", "label": "Next action"}], "rows": rows}],
    }


def _hearing_table(rows_):
    return {"title": "Hearings", "columns": [
        {"key": "date", "label": "Date"}, {"key": "time", "label": "Time"}, {"key": "court", "label": "Court"}, {"key": "hall", "label": "Hall"},
        {"key": "serial", "label": "Item"}, {"key": "case_no", "label": "Case no."}, {"key": "title", "label": "Title"},
        {"key": "purpose", "label": "Purpose"}, {"key": "advocate", "label": "Advocate"}, {"key": "client", "label": "Client"}, {"key": "status", "label": "Status"}],
        "rows": [{"date": nice(h["hearing_date"]), "time": h["hearing_time"] or "", "court": h["court"] or h["case_court"], "hall": h["hall_no"] or "",
                  "serial": h["serial_no"] or "", "case_no": h["case_no"], "title": h["title"], "purpose": h["purpose"] or "",
                  "advocate": h["advocate_name"] or "", "client": h["client_name"] or "", "status": h["status"].title()} for h in rows_]}


def _r_upcoming_hearings(c, member, st, p):
    today = L.today_ist()
    a = L.parse_date(p.get("from")) or today
    b = L.parse_date(p.get("to")) or (a + timedelta(days=30))
    extra, params = "AND h.status = 'scheduled' AND h.hearing_date BETWEEN :a AND :b", {"a": a.isoformat(), "b": b.isoformat()}
    if str(p.get("advocate_id") or "").isdigit():
        extra += " AND COALESCE(h.advocate_id, c.advocate_id) = :adv"
        params["adv"] = int(p["advocate_id"])
    hs = _hearing_rows(c, member, extra, params)
    courts = _count_by([{"court": h["court"] or h["case_court"]} for h in hs], "court")
    return {"period": _period(a, b),
            "summary": [{"label": "Hearings", "value": len(hs)}, {"label": "Cases", "value": len({h["case_id"] for h in hs})}, {"label": "Courts", "value": len(courts)}],
            "tables": [_hearing_table(hs)]}


def _r_cause_list(c, member, st, p):
    day = L.parse_date(p.get("date")) or L.today_ist()
    extra, params = "AND h.hearing_date = :d AND h.status != 'cancelled'", {"d": day.isoformat()}
    if p.get("court"):
        extra += " AND COALESCE(h.court, c.court) = :court"
        params["court"] = p["court"]
    if str(p.get("advocate_id") or "").isdigit():
        extra += " AND COALESCE(h.advocate_id, c.advocate_id) = :adv"
        params["adv"] = int(p["advocate_id"])
    hs = _hearing_rows(c, member, extra, params, order="COALESCE(h.court, c.court), h.hall_no, CAST(h.serial_no AS INTEGER), h.serial_no, h.hearing_time")
    courts = _count_by([{"court": h["court"] or h["case_court"]} for h in hs], "court")
    tab = _hearing_table(hs)
    tab["title"] = "Cause list"
    tab["columns"] = [col for col in tab["columns"] if col["key"] != "date"]
    return {"period": nice(day), "summary": [{"label": "Matters listed", "value": len(hs)}, {"label": "Courts", "value": len(courts)}], "tables": [tab]}


def _r_closed_cases(c, member, st, p):
    today = L.today_ist()
    a = L.parse_date(p.get("from")) or today.replace(day=1)
    b = L.parse_date(p.get("to")) or today
    items = _visible_cases(c, member, "AND c.closed_at IS NOT NULL AND date(c.closed_at) BETWEEN :a AND :b ORDER BY c.closed_at DESC",
                           {"a": a.isoformat(), "b": b.isoformat()})
    by = _count_by(items, "status")
    rows = []
    for x in items:
        d = _days_between(x["filing_date"] or x["created_at"], x["closed_at"])
        rows.append({"case_no": x["case_no"], "title": x["title"], "court": x["court"], "case_type": x["case_type"], "client": x["client_name"] or "",
                     "advocate": x["advocate_name"] or "", "status": x["status"], "filed": nice(x["filing_date"]), "closed": nice(x["closed_at"]),
                     "days": d if d is not None and d >= 0 else "", "outcome": x["outcome"] or ""})
    return {"period": _period(a, b),
            "summary": [{"label": "Closed cases", "value": len(items)}] + [{"label": k, "value": v} for k, v in by.items()],
            "tables": [{"title": "Closed cases", "columns": [
                {"key": "case_no", "label": "Case no."}, {"key": "title", "label": "Title"}, {"key": "court", "label": "Court"}, {"key": "client", "label": "Client"},
                {"key": "advocate", "label": "Advocate"}, {"key": "status", "label": "Result"}, {"key": "filed", "label": "Filed"}, {"key": "closed", "label": "Closed"},
                {"key": "days", "label": "Days", "align": "r"}, {"key": "outcome", "label": "Outcome"}], "rows": rows}]}


def _r_client_activity(c, member, st, p):
    today = L.today_ist()
    a = L.parse_date(p.get("from")) or today.replace(day=1)
    b = L.parse_date(p.get("to")) or today
    a_s, b_s = a.isoformat(), b.isoformat()
    vis, vp = L.case_visible_sql(member, "c")
    out = []
    for cl in L.rows(c, "SELECT * FROM lpms_clients WHERE firm_id = ? AND archived = 0 ORDER BY name COLLATE NOCASE", (member["firm_id"],)):
        cs = L.rows(c, f"SELECT c.id, c.closed_at, c.archived_at FROM lpms_cases c WHERE {vis} AND c.client_id = :cl", {**vp, "cl": cl["id"]})
        ids = [x["id"] for x in cs]
        hear = c.execute(f"SELECT COUNT(*) FROM lpms_hearings h JOIN lpms_cases c ON c.id = h.case_id WHERE {vis} AND c.client_id = :cl "
                         f"AND h.hearing_date BETWEEN :a AND :b AND h.status IN ('heard','adjourned')", {**vp, "cl": cl["id"], "a": a_s, "b": b_s}).fetchone()[0]
        comms = c.execute("SELECT COUNT(*), MAX(created_at) FROM lpms_comms WHERE client_id = ? AND date(created_at) BETWEEN ? AND ?", (cl["id"], a_s, b_s)).fetchone()
        last = c.execute("SELECT MAX(created_at) FROM lpms_comms WHERE client_id = ?", (cl["id"],)).fetchone()[0]
        fu = c.execute("SELECT COUNT(*) FROM lpms_followups WHERE client_id = ? AND status = 'open'", (cl["id"],)).fetchone()[0]
        out.append({"client": cl["name"], "phone": cl["phone"] or "", "cases": len(ids), "active": sum(1 for x in cs if not x["closed_at"] and not x["archived_at"]),
                    "hearings": hear, "documents": sum(_docs_count(c, ids, a, b).values()), "contacts": comms[0], "last_contact": nice(last[:10]) if last else "",
                    "followups": fu})
    out = [r for r in out if r["cases"] or r["contacts"]]
    out.sort(key=lambda r: (-r["active"], r["client"].lower()))
    return {"period": _period(a, b),
            "summary": [{"label": "Clients with activity", "value": len(out)}, {"label": "Hearings", "value": sum(r["hearings"] for r in out)},
                        {"label": "Documents", "value": sum(r["documents"] for r in out)}, {"label": "Contacts logged", "value": sum(r["contacts"] for r in out)}],
            "tables": [{"title": "Per client", "columns": [
                {"key": "client", "label": "Client"}, {"key": "phone", "label": "Phone"}, {"key": "cases", "label": "Cases", "align": "r"},
                {"key": "active", "label": "Active", "align": "r"}, {"key": "hearings", "label": "Hearings", "align": "r"},
                {"key": "documents", "label": "Documents", "align": "r"}, {"key": "contacts", "label": "Contacts", "align": "r"},
                {"key": "last_contact", "label": "Last contact"}, {"key": "followups", "label": "Open follow-ups", "align": "r"}], "rows": out}]}


# ── renderers ────────────────────────────────────────────────────────────────────────
def _cell(v):
    return "" if v is None else v


def to_xlsx(rep):
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter
    wb = Workbook()
    ws = wb.active
    ws.title = "Summary"
    ws["A1"], ws["A1"].font = rep["title"], Font(bold=True, size=14)
    ws["A2"] = f"{rep['firm']} · {rep['period']} · generated {rep['generated']}"
    ws["A2"].font = Font(color="666666")
    r = 4
    for s in rep["summary"]:
        ws.cell(r, 1, s["label"]).font = Font(bold=True)
        ws.cell(r, 2, _cell(s["value"]))
        r += 1
    ws.column_dimensions["A"].width = 34
    ws.column_dimensions["B"].width = 18
    head_fill = PatternFill("solid", fgColor="1F3A5F")
    for t in rep["tables"]:
        sheet = wb.create_sheet(("".join(ch for ch in t["title"] if ch not in "[]:*?/\\")[:28]) or "Table")
        for j, col in enumerate(t["columns"], 1):
            cell = sheet.cell(1, j, col["label"])
            cell.font, cell.fill = Font(bold=True, color="FFFFFF"), head_fill
            cell.alignment = Alignment(horizontal="right" if col.get("align") == "r" else "left", vertical="center")
        for i, row in enumerate(t["rows"], 2):
            for j, col in enumerate(t["columns"], 1):
                v = _cell(row.get(col["key"]))
                if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r"):
                    v = "'" + v                           # a case title must never run as a formula
                cell = sheet.cell(i, j, v)
                cell.alignment = Alignment(wrap_text=True, vertical="top", horizontal="right" if col.get("align") == "r" else "left")
        for j, col in enumerate(t["columns"], 1):
            width = max([len(str(col["label"]))] + [len(str(_cell(rw.get(col["key"])))) for rw in t["rows"][:200]])
            sheet.column_dimensions[get_column_letter(j)].width = min(max(10, width + 2), 46)
        sheet.freeze_panes = "A2"
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


_FONT_CANDIDATES = [
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ("/usr/share/fonts/dejavu/DejaVuSans.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"),
    ("/usr/share/fonts/TTF/DejaVuSans.ttf", "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf"),
    ("/Library/Fonts/Arial Unicode.ttf", "/Library/Fonts/Arial Unicode.ttf"),
    ("C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/arialbd.ttf"),
]


def _find_font():
    env = os.getenv("LPMS_PDF_FONT")
    if env and os.path.exists(env):
        return env, os.getenv("LPMS_PDF_FONT_BOLD") or env
    for reg, bold in _FONT_CANDIDATES:
        if os.path.exists(reg) and os.path.exists(bold):
            return reg, bold
    return None


def to_pdf(rep):
    from fpdf import FPDF
    from fpdf.enums import TableCellFillMode
    font = _find_font()
    wide = any(len(t["columns"]) > 6 for t in rep["tables"])
    foot = {"fam": "Helvetica", "text": ""}

    class _Pdf(FPDF):
        def footer(self):                                      # runs on every page, inside the bottom margin, so it never adds a page of its own
            self.set_y(-11)
            self.set_font(foot["fam"], "", 7.5)
            self.set_text_color(130, 130, 130)
            self.cell(0, 5, f"{foot['text']}  ·  page {self.page_no()} of {{nb}}", align="C")

    pdf = _Pdf(orientation="L" if wide else "P", unit="mm", format="A4")
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(True, margin=14)
    pdf.set_margins(12, 12, 12)
    if font:
        pdf.add_font("LP", "", font[0])
        pdf.add_font("LP", "B", font[1])
        fam = "LP"
        clean = lambda s: str(s)
    else:                                                      # core fonts speak Latin-1 only: say so with '?' rather than crash
        fam = "Helvetica"
        clean = lambda s: str(s).encode("latin-1", "replace").decode("latin-1")
    foot["fam"] = fam
    foot["text"] = clean(f"{rep['firm']} · confidential · generated {rep['generated']}")
    pdf.add_page()
    navy = (31, 58, 95)
    pdf.set_font(fam, "B", 16)
    pdf.set_text_color(*navy)
    pdf.cell(0, 9, clean(rep["title"]), new_x="LMARGIN", new_y="NEXT")
    pdf.set_font(fam, "", 9)
    pdf.set_text_color(100, 100, 100)
    pdf.cell(0, 5, clean(f"{rep['firm']}  ·  {rep['period']}  ·  generated {rep['generated']}"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)
    if rep["summary"]:
        pdf.set_text_color(30, 30, 30)
        per_row = 4 if wide else 3
        w = (pdf.w - pdf.l_margin - pdf.r_margin) / per_row
        for i in range(0, len(rep["summary"]), per_row):
            chunk = rep["summary"][i:i + per_row]
            y0 = pdf.get_y()
            for k, s in enumerate(chunk):
                x = pdf.l_margin + k * w
                pdf.set_xy(x, y0)
                pdf.set_font(fam, "B", 15)
                pdf.set_text_color(*navy)
                pdf.cell(w, 7, clean(s["value"]), new_x="LEFT", new_y="NEXT")
                pdf.set_x(x)
                pdf.set_font(fam, "", 8)
                pdf.set_text_color(110, 110, 110)
                pdf.cell(w, 4, clean(s["label"]), new_x="LEFT", new_y="NEXT")
            pdf.set_y(y0 + 13)
        pdf.ln(2)
    for t in rep["tables"]:
        if not t["rows"] and len(rep["tables"]) > 1:
            continue
        pdf.set_font(fam, "B", 11)
        pdf.set_text_color(*navy)
        pdf.cell(0, 8, clean(t["title"]), new_x="LMARGIN", new_y="NEXT")
        if not t["rows"]:
            pdf.set_font(fam, "", 9)
            pdf.set_text_color(110, 110, 110)
            pdf.cell(0, 6, "Nothing to show for this period.", new_x="LMARGIN", new_y="NEXT")
            continue
        cols = t["columns"]
        weights = [max(6, min(34, max([len(str(c["label"]))] + [len(str(_cell(r.get(c["key"])))) for r in t["rows"][:60]]))) for c in cols]
        pdf.set_font(fam, "", 7.5 if len(cols) > 7 else 8.5)
        pdf.set_text_color(30, 30, 30)
        with pdf.table(col_widths=tuple(weights), line_height=4.6 if len(cols) > 7 else 5, text_align=tuple("RIGHT" if c.get("align") == "r" else "LEFT" for c in cols),
                       cell_fill_color=(244, 247, 251), cell_fill_mode=TableCellFillMode.ROWS, headings_style=_heading_style(fam)) as table:
            head = table.row()
            for c in cols:
                head.cell(clean(c["label"]))
            for r in t["rows"]:
                row = table.row()
                for c in cols:
                    row.cell(clean(_cell(r.get(c["key"]))))
        pdf.ln(4)
    return bytes(pdf.output())


def _heading_style(fam):
    from fpdf.fonts import FontFace
    return FontFace(family=fam, emphasis="BOLD", color=(255, 255, 255), fill_color=(31, 58, 95))
