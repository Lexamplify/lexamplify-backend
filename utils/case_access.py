"""Case-level access control for the collaboration feature.

Spec §10 (plan compiled-scribbling-scott.md, B2): every room/share/mention
endpoint has to answer two questions in exactly one place:

  1. Who is eligible to receive a share for case <id>?
  2. May user <uid> see / post into case <id> at all?

Both resolve against the SAME union — assigned advocate + case team's
`team_memberships` + firm seniors — so the Share dialog's "All eligible"
option and the server's authorization gate can never disagree.

Lineage:
  users
    ├── lpms_members(firm_id, user_id, role) → firm roster, flags seniors
    └── team_memberships(team_id, user_id)   → matter team access
  lpms_cases
    ├── advocate_id INTEGER                  → single assignee (lpms_members.id)
    ├── team_id INTEGER (nullable)           → gates matter-team access
    └── firm_id INTEGER                      → scopes the firm roster

We read via raw sqlite3 for the same reason `routes/lpms_cases.py` and
`utils/workspace_access.py` do: stale-cache issues between SQLAlchemy and
the raw-SQL writers in LPMS. This keeps us consistent with the rest of
the Practice backend.
"""
from __future__ import annotations
import sqlite3
from flask import current_app


def _lpms_db_path() -> str:
    """Match the resolver every other LPMS route uses."""
    return current_app.extensions.get("lpms_db_path") or "lex_assistant.db"


def _conn():
    conn = sqlite3.connect(_lpms_db_path())
    conn.row_factory = sqlite3.Row
    return conn


def eligible_recipient_ids(case_id: int) -> set[int]:
    """Return the set of user_ids that are allowed to see case <case_id>:
      - the case's assigned advocate (via lpms_members.user_id),
      - every user_id in team_memberships for the case's team,
      - every lpms_members row in the same firm whose role includes 'senior'
        (seniors see every non-restricted case in their firm).

    Returns an empty set when the case doesn't exist. Does not swallow
    other errors — the caller should decide what to do with a DB failure
    (usually: fail closed, 500)."""
    try:
        cid = int(case_id)
    except (TypeError, ValueError):
        return set()

    conn = _conn()
    try:
        case = conn.execute(
            "SELECT id, firm_id, advocate_id, team_id, restricted "
            "FROM lpms_cases WHERE id = ?",
            (cid,),
        ).fetchone()
        if not case:
            return set()

        out: set[int] = set()

        # 1. Assigned advocate (lpms_members row -> user_id).
        if case["advocate_id"]:
            row = conn.execute(
                "SELECT user_id FROM lpms_members WHERE id = ? AND active = 1",
                (case["advocate_id"],),
            ).fetchone()
            if row and row["user_id"]:
                out.add(int(row["user_id"]))

        # 2. Team members (matter team gate).
        if case["team_id"]:
            for row in conn.execute(
                "SELECT user_id FROM team_memberships WHERE team_id = ?",
                (case["team_id"],),
            ).fetchall():
                if row["user_id"]:
                    out.add(int(row["user_id"]))

        # 3. Firm seniors — unless this is a restricted case (spec §10:
        # case restrictions override firm-level visibility).
        if not (case["restricted"] or 0):
            for row in conn.execute(
                "SELECT user_id FROM lpms_members "
                "WHERE firm_id = ? AND active = 1 "
                "  AND (role LIKE '%senior%' OR role LIKE '%partner%' OR role LIKE '%principal%')",
                (case["firm_id"],),
            ).fetchall():
                if row["user_id"]:
                    out.add(int(row["user_id"]))

        return out
    finally:
        conn.close()


def require_case_access(user_id, case_id) -> bool:
    """Thin predicate on top of eligible_recipient_ids(). Caller turns a
    False into a 403 (or 404 when the convention is to hide existence)."""
    try:
        uid = int(user_id)
    except (TypeError, ValueError):
        return False
    return uid in eligible_recipient_ids(case_id)


__all__ = ["eligible_recipient_ids", "require_case_access"]
