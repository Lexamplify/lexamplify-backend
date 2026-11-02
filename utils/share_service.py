"""Universal share service — plan phase B4.

ONE function, create_share(), that every tool's Share dialog uses so the
business rules live in one place:

  1. Sender must have access to the case.
  2. Every recipient must have access to the case — if even one does not,
     abort with 403 + the blocked user_ids. We DO NOT silently drop
     ineligible recipients (spec §10: "Do not silently add an unauthorized
     recipient"). The frontend will then prompt the user to remove them.
  3. If the resource is a contract_analysis with no case_id yet, we set
     it to this case so the analysis has a canonical case home (spec §9
     single-source-of-truth).
  4. Insert case_messages (kind='share', body=…) + case_message_resources.
  5. Fan out via utils.lpms_store.L.notify so recipients get the in-app
     + optional e-mail notification routed through the existing bell
     pane without a parallel notifications table.
  6. utils.audit_log.record() with structured target_type/target_id so a
     firm admin can later filter "all shares of contract 42".
  7. Return the created message hydrated with resource references.
"""
from __future__ import annotations
from typing import Iterable

from utils import lpms_store as L
from utils.case_access import require_case_access
from utils import audit_log


class ShareError(Exception):
    def __init__(self, message: str, status: int = 400, code: str = "SHARE_ERROR", blocked=None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.blocked = blocked or []


def create_share(
    *,
    user_id: int,
    case_id: int,
    resource_type: str,
    resource_id: str,
    recipient_user_ids: Iterable[int],
    body: str,
    conn,
) -> dict:
    """Perform the share. See module docstring for the business rules.
    Caller supplies a sqlite connection (same request-scoped one the
    collab blueprint uses) so this participates in the request's
    transaction instead of opening another handle."""
    recipients = list({int(r) for r in recipient_user_ids if r is not None})

    # 1 & 2. Access gates. require_case_access reads via its own connection
    # on top of _lpms_db_path, so we do NOT need to pass conn here —
    # keeps the authorization check isolated from this request's txn.
    if not require_case_access(user_id, case_id):
        raise ShareError("You don't have access to this case.", status=403, code="FORBIDDEN")

    blocked = [uid for uid in recipients if not require_case_access(uid, case_id)]
    if blocked:
        raise ShareError(
            "Some recipients don't have access to this case.",
            status=403, code="RECIPIENT_INELIGIBLE", blocked=blocked,
        )

    # The firm_id and case title come straight off lpms_cases.
    case_row = conn.execute(
        "SELECT id, firm_id, workspace_id, title FROM lpms_cases WHERE id = ?",
        (int(case_id),),
    ).fetchone()
    if not case_row:
        raise ShareError("Case not found.", status=404, code="CASE_NOT_FOUND")

    firm_id = int(case_row["firm_id"])
    workspace_id = case_row["workspace_id"]
    case_title = case_row["title"] or "a case"

    # 3. Link the contract analysis to this case if it hasn't been linked
    # yet — single source of truth (spec §9). Only touches rows that
    # genuinely don't have a home; never overwrites a prior case binding.
    if resource_type == "contract_analysis":
        try:
            conn.execute(
                "UPDATE contract_analyses SET case_id = ? "
                "WHERE id = ? AND (case_id IS NULL OR case_id = 0)",
                (int(case_id), int(resource_id)),
            )
        except Exception:  # noqa: BLE001
            # UPDATE failing (e.g. non-int resource_id) must not take the
            # whole share down — the message + reference still get written.
            pass

    # 4. Message + resource reference + mention rows, same transaction.
    # Visibility mirrors the chat composer's rule: a share with specific
    # recipient_user_ids is a DM-style private card (only author +
    # recipients + firm seniors see it); a share with no recipients (or
    # a @all / @everyone / @channel body token) is a public broadcast.
    # Without this, a vault_doc shared "to Arjun only" would still show
    # up in the feed for every case member — exactly the leak the user
    # flagged on text messages before.
    _broadcast_tok = any(t in (body or "").lower() for t in ("@all", "@everyone", "@channel"))
    _visibility = "public" if (_broadcast_tok or not recipients) else "private"
    with conn:
        cur = conn.execute(
            "INSERT INTO case_messages "
            "(firm_id, workspace_id, case_id, author_user_id, kind, body, visibility) "
            "VALUES (?, ?, ?, ?, 'share', ?, ?)",
            (firm_id, workspace_id, int(case_id), int(user_id), body, _visibility),
        )
        message_id = cur.lastrowid
        conn.execute(
            "INSERT INTO case_message_resources "
            "(message_id, resource_type, resource_id) VALUES (?, ?, ?)",
            (message_id, str(resource_type)[:40], str(resource_id)[:120]),
        )
        # Record each recipient as a mention so the GET /messages
        # visibility filter ("public OR author OR mentioned") lets the
        # recipient see the card and the download fallback honors it.
        for _uid in recipients:
            if int(_uid) == int(user_id):
                continue
            try:
                conn.execute(
                    "INSERT INTO case_message_mentions (message_id, mentioned_user_id) VALUES (?, ?)",
                    (message_id, int(_uid)),
                )
            except Exception:  # noqa: BLE001
                # Duplicate / schema drift — don't tank the whole share.
                pass

        # 5. Fan out notifications. We use L.notify (not notify_case) so
        # the notification kind lands as "share.received" and the link
        # deep-points at the message itself, not the generic case view.
        link = f"/matters/{int(case_id)}#collab-{message_id}"
        title_tpl = {
            "contract_analysis": "A contract analysis was shared with you",
            "vault_doc":         "A document was shared with you",
            "case_document":     "A case document was shared with you",
            "draft_session":     "A draft was shared with you",
        }.get(resource_type, "Something was shared with you")
        title = f"{title_tpl} in {case_title}"

        for uid in recipients:
            if uid == int(user_id):
                continue
            L.notify(conn, firm_id, uid,
                     "share.received", title, body=body[:300] if body else None,
                     link=link, case_id=int(case_id),
                     dedupe_key=f"share:{message_id}:{uid}", email=False)

    # 6. Audit log — structured target so a firm admin can filter later.
    try:
        audit_log.record(
            action="shared",
            user_id=int(user_id),
            detail=f"case_id={case_id} recipients={len(recipients)}",
            target_type=f"{resource_type}",
            target_id=str(resource_id),
        )
    except Exception:  # noqa: BLE001
        # Audit failures must never fail the share itself.
        pass

    # 7. Return a hydrated message so the frontend can render the share
    # card without a second round-trip.
    return {
        "message": {
            "id": message_id,
            "case_id": int(case_id),
            "author_user_id": int(user_id),
            "kind": "share",
            "body": body,
            "visibility": _visibility,
            "resources": [{
                "resource_type": resource_type,
                "resource_id": str(resource_id),
                "resource_version": None,
            }],
            "mentions": [int(u) for u in recipients if int(u) != int(user_id)],
        },
        "notified_user_ids": [uid for uid in recipients if uid != int(user_id)],
    }


__all__ = ["create_share", "ShareError"]
