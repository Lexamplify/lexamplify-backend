from database import db
from datetime import datetime


class AuditEvent(db.Model):
    """Who did what, and when: sign-ins (including failed ones), document create/export/delete, shares. Append-only."""
    __tablename__ = "audit_events"

    id      = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, index=True)                 # null for a failed sign-in that matched nobody
    action  = db.Column(db.String(40), nullable=False, index=True)
    detail  = db.Column(db.String(300))
    ip      = db.Column(db.String(64))
    at      = db.Column(db.DateTime, default=datetime.utcnow, index=True)
    # Structured target of the audited action (plan B6). Both nullable so
    # pre-existing rows keep working; a share writes
    # target_type='contract_analysis', target_id='<id>' instead of burying
    # that information in the free-text `detail` column.
    target_type = db.Column(db.String(40), index=True)
    target_id   = db.Column(db.String(64), index=True)
