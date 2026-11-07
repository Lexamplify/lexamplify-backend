"""Reading and writing the assistant's own history, without ever being able to break a command.

Every function here is best effort: if the two tables do not exist (an older database that has not had create_all() run
against it), the assistant keeps working and simply has no history. Nothing else in the app is touched.

What is stored: the command as the lawyer typed or spoke it, cut to TEXT_LIMIT, plus the one-line "what I understood",
the intent and the feature id. Never a document, a case record, a client note or a prompt.
"""
from __future__ import annotations

import logging
from datetime import timezone

from sqlalchemy.exc import SQLAlchemyError

log = logging.getLogger("app")

MAX_HISTORY_ROWS = 20
MAX_CONVERSATIONS = 20
_warned = False


def iso_utc(dt):
    """ISO-8601 string with an explicit UTC offset, or None.

    The timestamps in these tables are stored with ``datetime.utcnow`` (naive UTC). A naive value is read as UTC; an
    aware value is converted to UTC. Emitting the offset (…+00:00) stops the browser parsing a zoneless string as local
    time — the cause of the "6h ago" skew for a row made seconds ago in IST.
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.isoformat()


def _tables_missing_warning():
    global _warned
    if not _warned:
        _warned = True
        log.warning("assistant: history tables are not present; the assistant runs without history")


def record_turn(*, user_id, workspace_id, conversation_id, text, intent, feature, understood):
    """Save one exchange. Returns the conversation id, or None when history is unavailable.

    A conversation id from the client is only reused when that conversation really belongs to this user AND this
    workspace; otherwise a new one is started. That way a guessed id can never append to, or read, someone else's thread.
    """
    from database import db
    from models.assistant_history import TEXT_LIMIT, TITLE_LIMIT, AssistantConversation, AssistantMessage

    try:
        conversation = None
        if conversation_id is not None:
            conversation = (AssistantConversation.query
                            .filter_by(id=conversation_id, user_id=user_id, workspace_id=workspace_id).first())
        if conversation is None:
            conversation = AssistantConversation(user_id=user_id, workspace_id=workspace_id,
                                                 title=(text or "")[:TITLE_LIMIT])
            db.session.add(conversation)
            db.session.flush()

        db.session.add(AssistantMessage(conversation_id=conversation.id, user_id=user_id, workspace_id=workspace_id,
                                        role="user", text=(text or "")[:TEXT_LIMIT], intent=intent, feature=feature))
        if understood:
            db.session.add(AssistantMessage(conversation_id=conversation.id, user_id=user_id, workspace_id=workspace_id,
                                            role="assistant", text=str(understood)[:TEXT_LIMIT], intent=intent,
                                            feature=feature))
        db.session.commit()
        return conversation.id
    except SQLAlchemyError:
        db.session.rollback()
        _tables_missing_warning()
        return None
    except Exception:  # noqa: BLE001 - history must never be the reason a command fails
        db.session.rollback()
        _tables_missing_warning()
        return None


def read_recent(user_id, workspace_id, limit: int = MAX_HISTORY_ROWS):
    """This person's recent turns in THIS workspace, newest first. [] when history is unavailable."""
    from database import db
    from models.assistant_history import AssistantMessage

    try:
        rows = (AssistantMessage.query
                .filter_by(user_id=user_id, workspace_id=workspace_id)
                .order_by(AssistantMessage.id.desc())
                .limit(max(1, min(int(limit), MAX_HISTORY_ROWS)))
                .all())
        return [{"id": r.id, "conversationId": r.conversation_id, "role": r.role, "text": r.text,
                 "intent": r.intent, "feature": r.feature} for r in rows]
    except SQLAlchemyError:
        db.session.rollback()
        _tables_missing_warning()
        return []
    except Exception:  # noqa: BLE001
        db.session.rollback()
        _tables_missing_warning()
        return []


def list_conversations(user_id, workspace_id, limit: int = MAX_CONVERSATIONS):
    """This person's recent conversations in THIS workspace, newest first. [] when history is unavailable.

    Metadata only: the id, the short title (their own first command, already cut) and when it last changed. No message
    bodies, so nothing a document could have put into a reply travels in this list.
    """
    from database import db
    from models.assistant_history import AssistantConversation

    try:
        rows = (AssistantConversation.query
                .filter_by(user_id=user_id, workspace_id=workspace_id)
                .order_by(AssistantConversation.updated_at.desc(), AssistantConversation.id.desc())
                .limit(max(1, min(int(limit), MAX_CONVERSATIONS)))
                .all())
        return [{"id": r.id, "title": r.title or "Untitled",
                 "updatedAt": iso_utc(r.updated_at or r.created_at)}
                for r in rows]
    except SQLAlchemyError:
        db.session.rollback()
        _tables_missing_warning()
        return []
    except Exception:  # noqa: BLE001
        db.session.rollback()
        _tables_missing_warning()
        return []


def delete_conversation(user_id, workspace_id, conversation_id) -> bool:
    """Remove one conversation and its messages. Only the owner, only in their own workspace.

    Not reachable from a route yet - the Delete button arrives with the assistant page in 1C - but the rule it enforces
    (owner and workspace only) belongs with the storage, not with the button.
    """
    from database import db
    from models.assistant_history import AssistantConversation, AssistantMessage

    try:
        conversation = (AssistantConversation.query
                        .filter_by(id=conversation_id, user_id=user_id, workspace_id=workspace_id).first())
        if conversation is None:
            return False
        (AssistantMessage.query
         .filter_by(conversation_id=conversation.id, user_id=user_id, workspace_id=workspace_id)
         .delete(synchronize_session=False))
        db.session.delete(conversation)
        db.session.commit()
        return True
    except SQLAlchemyError:
        db.session.rollback()
        _tables_missing_warning()
        return False
