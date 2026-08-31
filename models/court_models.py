from database import db
from datetime import datetime


class JudicialOfficer(db.Model):
    __tablename__ = "judicial_officers"

    id            = db.Column(db.String(50), primary_key=True)
    district_key  = db.Column(db.String(50), index=True, nullable=False)
    hmj           = db.Column(db.String(200))
    designation   = db.Column(db.String(150))
    court_room    = db.Column(db.String(20))
    vc_link       = db.Column(db.String(500))
    vc_meeting_id = db.Column(db.String(50))
    email_id      = db.Column(db.String(200))
    is_on_leave   = db.Column(db.Boolean, default=False)
    updated_at    = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "district_key": self.district_key,
            "hmj": self.hmj,
            "designation": self.designation,
            "court_room": self.court_room,
            "vc_link": self.vc_link,
            "vc_meeting_id": self.vc_meeting_id,
            "email_id": self.email_id,
            "is_on_leave": self.is_on_leave,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

    def __repr__(self):
        return f"<JudicialOfficer id={self.id} hmj='{self.hmj}'>"
