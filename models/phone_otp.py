from datetime import datetime

from database import db


class PhoneOtp(db.Model):
    """One-time passcode sent to a mobile number.

    Only a keyed hash of the code is stored - never the code itself - so a
    database leak does not hand out working passcodes. A row is single-use:
    it is marked consumed on the first successful verification.
    """
    __tablename__ = "phone_otps"

    id = db.Column(db.Integer, primary_key=True)
    phone = db.Column(db.String(20), nullable=False, index=True)  # E.164, e.g. +919876543210
    purpose = db.Column(db.String(12), nullable=False)            # 'signup' | 'login'
    code_hash = db.Column(db.String(64), nullable=False)
    attempts = db.Column(db.Integer, nullable=False, default=0)
    consumed = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    expires_at = db.Column(db.DateTime, nullable=False)
