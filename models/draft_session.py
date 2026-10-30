from database import db
from datetime import datetime


class DraftSession(db.Model):
    """One in-progress or finished guided draft. Owned by exactly one user; every query filters on user_id."""
    __tablename__ = "draft_sessions"

    id         = db.Column(db.Integer, primary_key=True)
    user_id    = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    doc_type   = db.Column(db.String(64), nullable=False)
    title      = db.Column(db.String(200))
    case_ref   = db.Column(db.String(64))            # id of the practice case it was started from, if any
    facts_json = db.Column(db.Text, nullable=False, default="{}")
    step       = db.Column(db.String(24), default="details")
    status     = db.Column(db.String(16), default="draft")   # draft | done
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class DraftVersion(db.Model):
    """Snapshot of a generated document, kept so an advocate can go back. The last 10 per session are kept."""
    __tablename__ = "draft_versions"

    id            = db.Column(db.Integer, primary_key=True)
    session_id    = db.Column(db.Integer, db.ForeignKey("draft_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id       = db.Column(db.Integer, nullable=False, index=True)
    facts_hash    = db.Column(db.String(32))
    document_json = db.Column(db.Text, nullable=False)
    note          = db.Column(db.String(120))
    created_at    = db.Column(db.DateTime, default=datetime.utcnow)


class UserFlag(db.Model):
    """Tiny per-user key/value store (first-run guide dismissed, etc.) so it follows the person across devices."""
    __tablename__ = "user_flags"

    id      = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    key     = db.Column(db.String(48), nullable=False)
    value   = db.Column(db.String(200))
    __table_args__ = (db.UniqueConstraint("user_id", "key", name="uq_user_flag"),)
