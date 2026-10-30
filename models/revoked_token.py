from database import db
from datetime import datetime


class RevokedToken(db.Model):
    """A JWT that was signed out. The check is by token id (jti); rows are dropped once the token would have expired anyway."""
    __tablename__ = "revoked_tokens"

    id         = db.Column(db.Integer, primary_key=True)
    jti        = db.Column(db.String(64), nullable=False, unique=True, index=True)
    expires_at = db.Column(db.DateTime, nullable=False, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
