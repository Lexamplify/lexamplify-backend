"""
routes/lpms_conflicts.py - Practice: the conflict-of-interest check against the firm's own clients, cases and parties.
Mounted under /api/practice by routes/lpms_routes.py, so it shares sign-in, firm scoping, restricted-case rules and audit.
"""
from flask import jsonify, request

from routes.lpms_common import ApiError, text
from utils.conflict_check import MAX_NAMES, run_check


def register(env):
    @env.api("/conflicts/check", methods=("POST",))
    def conflicts_check():
        b = request.get_json(silent=True) or {}
        client = text(b.get("client_name"), 160, "Client name")
        raw = b.get("opposing_names")
        if raw is None and b.get("opposing_party"):
            raw = [b.get("opposing_party")]
        if raw is not None and not isinstance(raw, list):
            raise ApiError("The other side must be a list of names.", 400)
        opposing = [text(n, 160, "Name of the other side") for n in (raw or [])][:MAX_NAMES]
        opposing = [n for n in opposing if n]
        if not client and not opposing:
            raise ApiError("Type the name of the person who wants to hire you, or the name of the other side.", 400)
        result = run_check(env.conn(), env.m, client, opposing)
        with env.tx():
            env.audit("conflict_check", "firm", env.m["firm_id"],
                      f"Conflict check run for {client or '(no client)'}" + (f" against {', '.join(opposing)}" if opposing else ""),
                      {"status": result["status"], "matches": len(result["findings"])})
        return jsonify(result)
