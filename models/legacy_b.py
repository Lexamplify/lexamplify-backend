"""SQLAlchemy models for tables historically stored in `instance/client_data.db`.

Rules match legacy_a.py. Two tables are intentionally NOT redeclared here —
`calendar_events` and `user_notification_settings` — because they also exist
in DB A and the DB A versions carry the canonical (richer) schemas. The
consolidation script merges the DB B rows into the DB A versions.
"""
from sqlalchemy import (
    Column, DateTime, Date, Float, Integer, Text, Index,
)
from sqlalchemy import text as sql_text
from database import db


class BarAssociation(db.Model):
    __tablename__ = "bar_associations"
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(Text, nullable=False)
    kind = Column(Text)
    state = Column(Text)
    url = Column(Text, nullable=False, unique=True)
    phone = Column(Text)
    email = Column(Text)
    created_at = Column(DateTime, nullable=False, server_default=sql_text("CURRENT_TIMESTAMP"))
    updated_at = Column(DateTime, nullable=False, server_default=sql_text("CURRENT_TIMESTAMP"))


class CaptureRun(db.Model):
    __tablename__ = "capture_runs"
    id = Column(Integer, primary_key=True, autoincrement=True)
    task = Column(Text, nullable=False)
    status = Column(Text, nullable=False)
    detail = Column(Text)
    item_count = Column(Integer)
    ran_at = Column(DateTime, nullable=False, server_default=sql_text("CURRENT_TIMESTAMP"))


class Client(db.Model):
    __tablename__ = "clients"
    __table_args__ = (Index("idx_clients_owner_user_id", "owner_user_id"),)
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(Text, nullable=False)
    phone = Column(Text)
    email = Column(Text)
    address = Column(Text)
    client_type = Column(Text, default="Individual")
    notes = Column(Text)
    created_at = Column(DateTime, server_default=sql_text("CURRENT_TIMESTAMP"))
    contact = Column(Text)
    company = Column(Text)
    owner_user_id = Column(Integer)


class CourtRoster(db.Model):
    __tablename__ = "court_rosters"
    id = Column(Integer, primary_key=True, autoincrement=True)
    court = Column(Text, nullable=False)
    title = Column(Text, nullable=False)
    category = Column(Text)
    effective_date = Column(Text)
    url = Column(Text, nullable=False, unique=True)
    captured_at = Column(DateTime, nullable=False, server_default=sql_text("CURRENT_TIMESTAMP"))
    updated_at = Column(DateTime, nullable=False, server_default=sql_text("CURRENT_TIMESTAMP"))


class EventCache(db.Model):
    __tablename__ = "event_cache"
    event_id = Column(Text, primary_key=True)
    title = Column(Text)
    description = Column(Text)
    event_date = Column(Text)
    venue = Column(Text)
    organizer = Column(Text)
    register_url = Column(Text)
    raw_content = Column(Text)
    source_url = Column(Text)
    cached_at = Column(DateTime, nullable=False, server_default=sql_text("CURRENT_TIMESTAMP"))


class Invoice(db.Model):
    __tablename__ = "invoices"
    id = Column(Integer, primary_key=True, autoincrement=True)
    client_id = Column(Integer)
    invoice_number = Column(Text)
    amount = Column(Float)
    gst = Column(Float)
    total = Column(Float)
    status = Column(Text, default="Draft")
    due_date = Column(Date)
    paid_date = Column(Date)
    notes = Column(Text)
    created_at = Column(DateTime, server_default=sql_text("CURRENT_TIMESTAMP"))


class IpAsset(db.Model):
    __tablename__ = "ip_assets"
    __table_args__ = (Index("idx_ip_assets_owner_user_id", "owner_user_id"),)
    id = Column(Integer, primary_key=True, autoincrement=True)
    ip_type = Column(Text)
    title = Column(Text)
    registration_number = Column(Text)
    filing_date = Column(Date)
    renewal_due = Column(Date)
    status = Column(Text, default="Active")
    notes = Column(Text)
    created_at = Column(DateTime, server_default=sql_text("CURRENT_TIMESTAMP"))
    owner_user_id = Column(Integer)


class Task(db.Model):
    __tablename__ = "tasks"
    __table_args__ = (Index("idx_tasks_owner_user_id", "owner_user_id"),)
    id = Column(Integer, primary_key=True, autoincrement=True)
    title = Column(Text)
    assigned_to = Column(Integer)
    case_id = Column(Integer)
    due_date = Column(Date)
    priority = Column(Text, default="Normal")
    status = Column(Text, default="todo")
    notes = Column(Text)
    created_at = Column(DateTime, server_default=sql_text("CURRENT_TIMESTAMP"))
    owner_user_id = Column(Integer)


class TeamMember(db.Model):
    __tablename__ = "team_members"
    __table_args__ = (Index("idx_team_members_owner_user_id", "owner_user_id"),)
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(Text)
    email = Column(Text)
    role = Column(Text)
    created_at = Column(DateTime, server_default=sql_text("CURRENT_TIMESTAMP"))
    user_id = Column(Integer)
    owner_user_id = Column(Integer)


class TimeEntry(db.Model):
    __tablename__ = "time_entries"
    id = Column(Integer, primary_key=True, autoincrement=True)
    client_id = Column(Integer)
    case_id = Column(Integer)
    date = Column(Date)
    hours = Column(Float)
    rate = Column(Float)
    description = Column(Text)
    created_at = Column(DateTime, server_default=sql_text("CURRENT_TIMESTAMP"))


class TrackedCase(db.Model):
    __tablename__ = "tracked_cases"
    __table_args__ = (Index("idx_tracked_cases_owner_user_id", "owner_user_id"),)
    id = Column(Integer, primary_key=True, autoincrement=True)
    case_name = Column(Text, nullable=False)
    case_number = Column(Text)
    cnr_number = Column(Text)
    court = Column(Text)
    client_name = Column(Text)
    case_type = Column(Text)
    next_hearing = Column(Date)
    last_hearing = Column(Date)
    status = Column(Text, default="Active")
    notes = Column(Text)
    created_at = Column(DateTime, server_default=sql_text("CURRENT_TIMESTAMP"))
    cnr = Column(Text)
    title = Column(Text)
    next_hearing_date = Column(Date)
    owner_user_id = Column(Integer)


__all__ = [
    "BarAssociation", "CaptureRun", "Client", "CourtRoster", "EventCache",
    "Invoice", "IpAsset", "Task", "TeamMember", "TimeEntry", "TrackedCase",
]
