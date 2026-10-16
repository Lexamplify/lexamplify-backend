from database import db
from datetime import datetime

class User(db.Model):
    __tablename__ = "users"
    id         = db.Column(db.Integer, primary_key=True)
    name       = db.Column(db.String(120), nullable=False)
    email      = db.Column(db.String(120), unique=True, nullable=False)
    password   = db.Column(db.String(256), nullable=False)
    phone      = db.Column(db.String(20), nullable=True)
    # True only when the holder proved the number with a one-time code. A number
    # an admin typed in for a teammate (or entered while SMS was off) is just a
    # contact detail, and must never be enough to sign in.
    phone_verified = db.Column(db.Boolean, nullable=False, default=False, server_default=db.false())
    role       = db.Column(db.String(30), default="Lawyer")
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
