"""The assistant's own conversation history. New tables only; nothing existing is touched.

Deliberate choices:
  * No ForeignKey to users, workspaces or anything else. These tables are additive, so they can be created on a database
    that pre-dates them without an ALTER anywhere, and dropping them later breaks nothing.
  * Every row carries user_id AND workspace_id, and every read filters on both: history belongs to one person in one
    client workspace, and is never visible across either.
  * Only what the lawyer already saw is stored, cut short (TEXT_LIMIT). No document text, no case or client records,
    no prompts, no audio.
"""
from datetime import datetime

from database import db

TEXT_LIMIT = 300          # the command (or the one-line summary) is stored cut to this; never a document body
TITLE_LIMIT = 120


class AssistantConversation(db.Model):
    __tablename__ = "assistant_conversations"

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, nullable=False, index=True)
    workspace_id = db.Column(db.Integer, nullable=False, index=True)
    title = db.Column(db.String(TITLE_LIMIT))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AssistantMessage(db.Model):
    __tablename__ = "assistant_messages"

    id = db.Column(db.Integer, primary_key=True)
    conversation_id = db.Column(db.Integer, nullable=False, index=True)   # no FK on purpose - see the module docstring
    user_id = db.Column(db.Integer, nullable=False, index=True)
    workspace_id = db.Column(db.Integer, nullable=False, index=True)
    role = db.Column(db.String(16), nullable=False)        # "user" | "assistant"
    text = db.Column(db.String(TEXT_LIMIT))
    intent = db.Column(db.String(24))
    feature = db.Column(db.String(48))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
