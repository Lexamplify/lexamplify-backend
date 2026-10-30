from database import db
from datetime import datetime

class Document(db.Model):
    __tablename__ = "documents"

    id          = db.Column(db.Integer, primary_key=True)
    user_id     = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    case_id     = db.Column(db.Integer, db.ForeignKey("cases.id", ondelete="CASCADE"), nullable=True)  # Associated Case Vault link
    filename    = db.Column(db.String(256), nullable=False)
    filetype    = db.Column(db.String(20))
    summary     = db.Column(db.Text)
    tags        = db.Column(db.String(200))
    created_at  = db.Column(db.DateTime, default=datetime.utcnow)

    def __repr__(self):
        return f"<Document id={self.id} filename='{self.filename}'>"
