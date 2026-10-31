"""Workspace + WorkspaceMember — the new case/project tenancy boundary.

Phase 2 of the workspaces-refactor. These models are INERT (no behaviour
change) until the WORKSPACES_ENABLED flag is on AND feature pages begin
sending the X-Workspace-Id header. During Phase 1-6 both tables simply
exist alongside the legacy data; routes don't filter on workspace_id
until each is explicitly scoped.

Design decisions (from the plan at
C:\\Users\\Dell\\.claude\\plans\\as-a-feature-wise-glowing-shannon.md):
  * Integer id (not UUID) — matches every other id in the app and keeps
    SQLA FKs cheap. Confirmed against fix_bug/Sociovia reference.
  * firm_id, not user_id — a workspace belongs to a chambers (firm). Access
    is granted via a workspace_members join on top of firm membership so
    the same workspace can be shared with juniors / paralegals without
    changing ownership.
  * `facts` + `parties` are free-form text / JSON because the AI
    context-builder in Phase 5 injects them verbatim into prompts; a
    rigid schema fights that use-case.
"""
from sqlalchemy import (
    Column, DateTime, Integer, Text, UniqueConstraint, Index,
)
from sqlalchemy import text as sql_text
from database import db


class Workspace(db.Model):
    __tablename__ = "workspaces"
    __table_args__ = (
        Index("ix_workspaces_firm", "firm_id", "status"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    firm_id = Column(Integer, nullable=False, index=True)   # → lpms_firms.id
    name = Column(Text, nullable=False)
    case_no = Column(Text)
    court = Column(Text)
    case_type = Column(Text)
    client_id = Column(Integer)                             # → lpms_clients.id (optional)
    lead_counsel_user_id = Column(Integer)                  # → users.id (optional)
    status = Column(Text, nullable=False, default="active") # active | archived
    archived_at = Column(DateTime)
    facts = Column(Text)                                    # case brief, free text
    parties = Column(Text)                                  # JSON array of {role, name, contact}
    created_by = Column(Integer, nullable=False)            # users.id of creator
    created_at = Column(DateTime, nullable=False, server_default=sql_text("CURRENT_TIMESTAMP"))
    updated_at = Column(DateTime, nullable=False, server_default=sql_text("CURRENT_TIMESTAMP"))

    def to_dict(self, *, with_members: list | None = None) -> dict:
        out = {
            "id": self.id,
            "firm_id": self.firm_id,
            "name": self.name,
            "case_no": self.case_no,
            "court": self.court,
            "case_type": self.case_type,
            "client_id": self.client_id,
            "lead_counsel_user_id": self.lead_counsel_user_id,
            "status": self.status,
            "archived_at": self.archived_at.isoformat() if self.archived_at else None,
            "facts": self.facts,
            "parties": self.parties,
            "created_by": self.created_by,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
        if with_members is not None:
            out["members"] = with_members
        return out


class WorkspaceMember(db.Model):
    __tablename__ = "workspace_members"
    __table_args__ = (
        UniqueConstraint("workspace_id", "firm_member_id", name="uq_ws_member"),
        Index("ix_ws_members_workspace", "workspace_id"),
        Index("ix_ws_members_fmember", "firm_member_id"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    workspace_id = Column(Integer, nullable=False)          # → workspaces.id
    firm_member_id = Column(Integer, nullable=False)        # → lpms_members.id
    role = Column(Text, nullable=False, default="member")   # owner | editor | member | viewer
    added_by = Column(Integer)                              # users.id of inviter
    added_at = Column(DateTime, nullable=False, server_default=sql_text("CURRENT_TIMESTAMP"))

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "workspace_id": self.workspace_id,
            "firm_member_id": self.firm_member_id,
            "role": self.role,
            "added_by": self.added_by,
            "added_at": self.added_at.isoformat() if self.added_at else None,
        }


__all__ = ["Workspace", "WorkspaceMember"]
