"""Conflict-of-interest check against the firm's OWN Practice records (clients, cases, parties).

Nothing here is sample data: it reads lpms_clients, lpms_cases and lpms_parties for one firm. If the firm has no
records the answer is "nothing to check against", never "clear".
"""
import re

from utils import lpms_store as L
from utils.name_match import block_keys, compare as _compare

LEVEL_ORDER = {"same": 3, "likely": 2, "possible": 1}
SPLIT = re.compile(r"\s*(?:;|\band\b(?=\s+[A-Z])|\bvs?\.?\b|\bversus\b|\n|\|)\s*|,(?=\s*[A-Z][a-z]+\s+(?:[A-Z]|Pvt|Ltd))")
MAX_NAMES = 10


class _Cmp:
    """compare() with a cheap candidate filter in front: names that share no sound, consonant or 4-letter key cannot match."""

    def __init__(self):
        self.cache = {}

    def __call__(self, a, b):
        if not block_keys(a) & block_keys(b):
            return _NONE
        k = (a, b)
        r = self.cache.get(k)
        if r is None:
            r = self.cache[k] = _compare(a, b)
        return r


_NONE = {"level": "none", "score": 0.0, "why": ""}


def _split_names(text):
    """Opposite party fields hold one or several names ('A; B', 'A and B')."""
    parts = [p.strip(" ,.;") for p in SPLIT.split(text or "") if p and p.strip(" ,.;")]
    return parts or ([text.strip()] if (text or "").strip() else [])


def _record(case, visible, role=None):
    if visible:
        return {"type": "case", "case_id": case["id"], "case_no": case["case_no"], "court": case["court"], "title": case["title"],
                "status": case["status"], "closed": bool(case.get("archived_at")) or case["status"] in L.CLOSED_STATUSES,
                "role": role, "visible": True}
    return {"type": "case", "case_id": None, "case_no": None, "court": None, "title": "A restricted matter in your firm",
            "status": None, "closed": None, "role": role, "visible": False}


def run_check(conn, member, client_name, opposing_names):
    """Returns the full result dict. `client_name` is the person asking you to act, `opposing_names` the other side."""
    client_name = (client_name or "").strip()
    opposing = [n.strip() for n in (opposing_names or []) if n and n.strip()][:MAX_NAMES]
    fid = member["firm_id"]
    vis_sql, vp = L.case_visible_sql(member, "c")
    visible_ids = {r["id"] for r in L.rows(conn, f"SELECT c.id FROM lpms_cases c WHERE {vis_sql}", vp)}

    clients = L.rows(conn, "SELECT id, name, archived FROM lpms_clients WHERE firm_id = ?", (fid,))
    cases = L.rows(conn, "SELECT c.id, c.case_no, c.court, c.title, c.status, c.opposite_party, c.client_id, c.archived_at, "
                         "cl.name AS client_name FROM lpms_cases c LEFT JOIN lpms_clients cl ON cl.id = c.client_id WHERE c.firm_id = ?", (fid,))
    case_by_id = {c["id"]: c for c in cases}
    parties = L.rows(conn, "SELECT p.case_id, p.role, p.name FROM lpms_parties p JOIN lpms_cases c ON c.id = p.case_id WHERE c.firm_id = ?", (fid,))
    searched = {"clients": len(clients), "cases": len(cases), "parties": len(parties)}

    compare = _Cmp()
    findings = []

    def add(kind, level, checked, matched, m, record, message):
        findings.append({"kind": kind, "level": level, "checked_name": checked, "matched_name": matched,
                         "match": {"level": m["level"], "score": m["score"], "why": m["why"]}, "record": record, "message": message})

    def strong(m):
        return m["level"] in ("same", "likely")

    # who is OUR side in each case: its client; who is the OTHER side: opposite_party names
    for case in cases:
        vis = case["id"] in visible_ids
        ours = case["client_name"] or ""
        for other in _split_names(case["opposite_party"]):
            if client_name:
                m = compare(client_name, other)
                if m["level"] != "none":
                    add("client_is_opposed_elsewhere", "conflict" if strong(m) else "possible", client_name, other, m, _record(case, vis, "opposite party"),
                        f"You act against “{other}” in another matter. Taking {client_name} on may be a conflict." if strong(m)
                        else f"“{other}” in another matter may be the same person as {client_name}. Please check.")
            for o in opposing:
                m = compare(o, other)
                if strong(m):
                    add("already_opposed", "info", o, other, m, _record(case, vis, "opposite party"),
                        f"“{other}” is already the opposite party in another matter you handle.")
        if ours:
            for o in opposing:
                m = compare(o, ours)
                if m["level"] != "none":
                    add("opposite_is_our_client", "conflict" if strong(m) else "possible", o, ours, m, _record(case, vis, "our client"),
                        f"You act for “{ours}” in another matter, and they would be the other side here. This is a conflict." if strong(m)
                        else f"“{ours}” (your client in another matter) may be the same person as {o}. Please check.")
            if client_name:
                m = compare(client_name, ours)
                if strong(m):
                    add("existing_client_matter", "info", client_name, ours, m, _record(case, vis, "our client"),
                        f"{client_name} is already your client in another matter.")

    for p in parties:
        case = case_by_id.get(p["case_id"])
        if not case:
            continue
        vis = case["id"] in visible_ids
        role = p["role"].replace("_", " ")
        if p["role"] in ("witness", "opposing_counsel"):
            for name in ([client_name] if client_name else []) + opposing:
                m = compare(name, p["name"])
                if strong(m):
                    add("appears_as_" + p["role"], "possible", name, p["name"], m, _record(case, vis, role),
                        f"“{p['name']}” appears as {role} in another matter. Check whether that affects this one.")
            continue
        # petitioner / respondent / other: which side they are on is not recorded, so a match is only "possible"
        if client_name:
            m = compare(client_name, p["name"])
            ours = case["client_name"] or ""
            if strong(m) and not (ours and compare(ours, p["name"])["level"] in ("same", "likely")):
                add("client_is_party_elsewhere", "possible", client_name, p["name"], m, _record(case, vis, role),
                    f"“{p['name']}” is named as {role} in another matter, and is not your client there. Please check which side they are on.")
        for o in opposing:
            m = compare(o, p["name"])
            ours = case["client_name"] or ""
            if strong(m) and ours and compare(ours, p["name"])["level"] in ("same", "likely"):
                add("opposite_is_our_party", "conflict", o, p["name"], m, _record(case, vis, role),
                    f"“{p['name']}” is on your client’s side as {role} in another matter, and would be the other side here.")

    for c in clients:
        former = bool(c["archived"])
        if client_name:
            m = compare(client_name, c["name"])
            if strong(m):
                add("existing_client", "info", client_name, c["name"], m,
                    {"type": "client", "client_id": c["id"], "title": c["name"], "visible": True, "closed": former},
                    f"{client_name} is {'a former' if former else 'already a'} client of your firm.")
        for o in opposing:
            m = compare(o, c["name"])
            if m["level"] != "none":
                add("opposite_is_client", "conflict" if (strong(m) and not former) else "possible", o, c["name"], m,
                    {"type": "client", "client_id": c["id"], "title": c["name"], "visible": True, "closed": former},
                    (f"{c['name']} is {'a former' if former else 'a current'} client of your firm and would be the other side here."
                     + (" Duties to former clients can still apply." if former else "")) if strong(m)
                    else f"“{c['name']}” (a client of your firm) may be the same person as {o}. Please check.")

    # one row per (kind, matched record): keep the strongest; order conflicts first
    seen, unique = {}, []
    for f in findings:
        key = (f["kind"], f["checked_name"], f["matched_name"], f["record"].get("case_id"), f["record"].get("client_id"))
        if key not in seen or LEVEL_ORDER.get(f["match"]["level"], 0) > LEVEL_ORDER.get(seen[key]["match"]["level"], 0):
            seen[key] = f
    unique = list(seen.values())
    rank = {"conflict": 0, "possible": 1, "info": 2}
    unique.sort(key=lambda f: (rank[f["level"]], -f["match"]["score"]))

    if searched["clients"] == 0 and searched["cases"] == 0:
        status, headline = "no_records", ("There are no clients or cases in Practice yet, so there is nothing to check against. "
                                          "This is not a clearance. Add your clients and cases first.")
    elif any(f["level"] == "conflict" for f in unique):
        status, headline = "conflict", "Possible conflict of interest found. Do not accept the matter until you have reviewed the matches below."
    elif any(f["level"] == "possible" for f in unique):
        status, headline = "possible", "No certain conflict, but some names look similar. Please review the matches below."
    else:
        status, headline = "clear", (f"No match found among {searched['clients']} client{'s' if searched['clients'] != 1 else ''} and "
                                     f"{searched['cases']} case{'s' if searched['cases'] != 1 else ''} in Practice.")
    return {
        "status": status, "headline": headline, "findings": unique, "searched": searched,
        "checked": {"client": client_name, "opposing": opposing},
        "limits": ["Only names recorded in Practice (clients, cases, parties) are searched. Documents in the vault and other firms are not.",
                   "Names in Indian scripts are matched letter for letter, not by sound.",
                   "A search cannot replace your own knowledge of your clients."],
    }
