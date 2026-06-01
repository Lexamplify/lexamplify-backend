from database import db
from datetime import datetime

class DocumentChunk(db.Model):
    __tablename__ = "document_chunks"

    id          = db.Column(db.Integer, primary_key=True)
    user_id     = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    case_id     = db.Column(db.Integer, db.ForeignKey("cases.id", ondelete="CASCADE"), nullable=True)
    document_id = db.Column(db.Integer, db.ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    chunk_index = db.Column(db.Integer, nullable=False)
    chunk_text  = db.Column(db.Text, nullable=False)
    embedding   = db.Column(db.Text, nullable=False)  # Serialized JSON string of the float embedding vector
    created_at  = db.Column(db.DateTime, default=datetime.utcnow)

    def __repr__(self):
        return f"<DocumentChunk doc={self.document_id} index={self.chunk_index}>"
