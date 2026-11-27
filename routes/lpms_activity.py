"""
routes/lpms_activity.py
Collaborative activity feed + rollback for the practice (the "git for your
chamber" surface).

  GET  /api/practice/activity            the firm's change feed (who did what),
                                         filterable by ?entity= &entity_id= &actor_id= &since= &limit= &offset=
  GET  /api/practice/activity/<id>       one entry (with its before/after diff)
  POST /api/practice/activity/<id>/revert  undo that change — re-applies the
                                         prior state, records the revert as a
                                         new (itself-reversible) entry.

Who can revert: you can always undo your OWN action; undoing a TEAMMATE's action
needs the `manage_team` permission (Senior Advocate / owner). Reverts are logged
to the tamper-evident compliance chain (lpms_audit) too.

Only reversible actions expose a revert: a field UPDATE (re-apply old values) and
an ARCHIVE (un-archive). Creates are not auto-undone (deleting real work on one
click is worse than leaving it); the feed marks them non-revertable.
"""
from flask import jsonify, request

from routes.lpms_common import ApiError
from utils import lpms_store as L


# Entities whose updates/archives we know how to reverse, mapped to their table.
_REVERTABLE_TABLES = {
    "case": "lpms_cases",
    "client": "lpms_clients",
}


def register(env):
    @env.api("/activity")
    def activity_feed():
        c, m = env.conn(), env.m
        args = request.args
        def _int(name):
            v = args.get(name)
            try:
                return int(v) if v not in (None, "") else None
            except (TypeError, ValueError):
                return None
        rows = L.activity_list(
            c, m["firm_id"],
            limit=_int("limit") or 100, offset=_int("offset") or 0,
            entity=(args.get("entity") or None), entity_id=_int("entity_id"),
            actor_id=_int("actor_id"), since=(args.get("since") or None),
        )
        # A row is revertable if it's a reversible action, not already reverted,
        # and the current user is allowed to revert it.
        can_manage = bool(env.perms.get("manage_team"))
        for r in rows:
            reversible_action = r["action"] in ("update", "archive") and r["entity"] in _REVERTABLE_TABLES
            mine = r["actor_id"] == m["user_id"]
            r["can_revert"] = bool(reversible_action and not r["reverted"] and (mine or can_manage))
        return jsonify({"activity": rows})

    @env.api("/activity/<int:activity_id>")
    def activity_one(activity_id):
        act = L.activity_get(env.conn(), env.m["firm_id"], activity_id)
        if not act:
            raise ApiError("That activity entry does not exist.", 404, code="NOT_FOUND")
        return jsonify({"activity": act})

    @env.api("/activity/<int:activity_id>/revert", methods=("POST",))
    def activity_revert(activity_id):
        c, m = env.conn(), env.m
        act = L.activity_get(c, m["firm_id"], activity_id)
        if not act:
            raise ApiError("That activity entry does not exist.", 404, code="NOT_FOUND")
        if act["reverted"]:
            raise ApiError("That change has already been reverted.", 409, code="ALREADY_REVERTED")

        # Permission: own action always; a teammate's action needs manage_team.
        if act["actor_id"] != m["user_id"] and not env.perms.get("manage_team"):
            raise ApiError("Only a Senior Advocate can undo a teammate's change. You can undo your own.",
                           403, code="FORBIDDEN")

        table = _REVERTABLE_TABLES.get(act["entity"])
        if not table or act["action"] not in ("update", "archive"):
            raise ApiError("This kind of action can't be undone automatically.", 400, code="NOT_REVERTABLE")

        row = c.execute(f"SELECT * FROM {table} WHERE firm_id = ? AND id = ?",
                        (m["firm_id"], act["entity_id"])).fetchone()
        if not row:
            raise ApiError("The item this change applied to no longer exists.", 409, code="GONE")
        valid_cols = set(row.keys())
        actor = m["name"]
        now = L.now_iso()

        if act["action"] == "update":
            changes = act["changes"] or {}
            # Re-apply the OLD value of each changed field (guard to real columns).
            to_set = {k: v[0] for k, v in changes.items()
                      if isinstance(v, list) and len(v) == 2 and k in valid_cols and k not in ("id", "firm_id")}
            if not to_set:
                raise ApiError("There's nothing in this change that can be undone.", 400, code="NOT_REVERTABLE")
            inverse = {k: [changes[k][1], changes[k][0]] for k in to_set}  # for the revert entry's diff
            with env.tx() as tc:
                assigns = ", ".join(f"{k} = ?" for k in to_set)
                tc.execute(f"UPDATE {table} SET {assigns}, updated_at = ? WHERE id = ? AND firm_id = ?",
                           (*to_set.values(), now, act["entity_id"], m["firm_id"]))
                if act["entity"] == "case" and "case_no" in to_set:
                    tc.execute("UPDATE lpms_cases SET case_key = ? WHERE id = ?",
                               (L.case_key(to_set["case_no"] or ""), act["entity_id"]))
                L.activity_mark_reverted(tc, m["firm_id"], activity_id, m["user_id"], actor)
                L.activity_add(tc, m["firm_id"], m["user_id"], actor, "revert", act["entity"],
                               act["entity_id"], label=act["label"], changes=inverse, revert_of=activity_id)
                L.audit(tc, m["firm_id"], m["user_id"], actor, "activity_revert", act["entity"],
                        act["entity_id"], f"Reverted a change to {act['label'] or act['entity']}",
                        {"activity_id": activity_id, "fields": list(to_set)}, env.ip())
            env.kick_email()
            return jsonify({"ok": True, "reverted": activity_id, "fields": list(to_set)})

        # action == "archive"  → un-archive. Practice entities mark the archive
        # with archived_at (NULL = active); some also carry a boolean `archived`.
        with env.tx() as tc:
            set_cols = []
            if "archived_at" in valid_cols:
                set_cols.append("archived_at = NULL")
            if "archived" in valid_cols:
                set_cols.append("archived = 0")
            if set_cols:
                extra = ", updated_at = ?" if "updated_at" in valid_cols else ""
                params = ([now] if extra else []) + [act["entity_id"], m["firm_id"]]
                tc.execute(f"UPDATE {table} SET {', '.join(set_cols)}{extra} WHERE id = ? AND firm_id = ?", params)
            L.activity_mark_reverted(tc, m["firm_id"], activity_id, m["user_id"], actor)
            L.activity_add(tc, m["firm_id"], m["user_id"], actor, "unarchive", act["entity"],
                           act["entity_id"], label=act["label"], revert_of=activity_id)
            L.audit(tc, m["firm_id"], m["user_id"], actor, "activity_revert", act["entity"],
                    act["entity_id"], f"Restored {act['label'] or act['entity']} from the archive",
                    {"activity_id": activity_id}, env.ip())
        env.kick_email()
        return jsonify({"ok": True, "reverted": activity_id, "unarchived": True})
