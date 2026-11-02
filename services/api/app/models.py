"""Database schema.

Every business-owned table carries `organization_id`. Routers never query these
tables directly by primary key; they go through `deps.get_scoped`, which adds the
organization filter so one workspace can never read another workspace's rows.

Raw uploaded files are stored outside the database (see storage.py) and are
never modified. Normalized time-series points live in `measurement_points`,
separate from the original file. Summary values that a report can cite live in
`measurements` and carry an explicit `kind` (measured / user_entered /
calculated / external / model_estimate) plus their source.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    TypeDecorator,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def new_id() -> str:
    return uuid.uuid4().hex


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UTCDateTime(TypeDecorator):
    """Stores naive UTC, always returns timezone-aware UTC (SQLite drops tzinfo)."""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: datetime | None, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).replace(tzinfo=None)

    def process_result_value(self, value: datetime | None, dialect):
        if value is None:
            return None
        return value.replace(tzinfo=timezone.utc)


def pk() -> Mapped[str]:
    return mapped_column(String(32), primary_key=True, default=new_id)


def org_fk() -> Mapped[str]:
    return mapped_column(String(32), ForeignKey("organizations.id", ondelete="CASCADE"), index=True)


def created_at_col() -> Mapped[datetime]:
    return mapped_column(UTCDateTime, default=utcnow, nullable=False)


# --------------------------------------------------------------------------- identity


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[str] = pk()
    name: Mapped[str] = mapped_column(String(200))
    legal_name: Mapped[str | None] = mapped_column(String(200))
    address: Mapped[str | None] = mapped_column(Text)
    phone: Mapped[str | None] = mapped_column(String(50))
    email: Mapped[str | None] = mapped_column(String(200))
    tax_id: Mapped[str | None] = mapped_column(String(50))  # e.g. GSTIN
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    # IANA zone used for "today" and for printing dates on reports and quotations.
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Kolkata")
    battery_id_prefix: Mapped[str] = mapped_column(String(10), default="BOS")
    battery_seq: Mapped[int] = mapped_column(Integer, default=0)
    quotation_seq: Mapped[int] = mapped_column(Integer, default=0)
    report_seq: Mapped[int] = mapped_column(Integer, default=0)
    batch_seq: Mapped[int] = mapped_column(Integer, default=0)
    quotation_terms: Mapped[str | None] = mapped_column(Text)
    quotation_validity_days: Mapped[int] = mapped_column(Integer, default=15)
    created_at: Mapped[datetime] = created_at_col()


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = pk()
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(String(200))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = created_at_col()
    last_login_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


class OrganizationMember(Base):
    __tablename__ = "organization_members"
    __table_args__ = (UniqueConstraint("organization_id", "user_id"),)

    id: Mapped[str] = pk()
    organization_id: Mapped[str] = org_fk()
    user_id: Mapped[str] = mapped_column(String(32), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(20))  # owner | admin | technician | staff
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = created_at_col()

    user: Mapped[User] = relationship(lazy="joined")
    organization: Mapped[Organization] = relationship(lazy="joined")


class Invitation(Base):
    __tablename__ = "invitations"

    id: Mapped[str] = pk()
    organization_id: Mapped[str] = org_fk()
    email: Mapped[str] = mapped_column(String(254))
    role: Mapped[str] = mapped_column(String(20))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    invited_by_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = created_at_col()
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    accepted_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    id: Mapped[str] = pk()
    user_id: Mapped[str] = mapped_column(String(32), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    current_organization_id: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("organizations.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = created_at_col()
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)
    last_seen_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    user_agent: Mapped[str | None] = mapped_column(String(300))
    ip_address: Mapped[str | None] = mapped_column(String(64))


# --------------------------------------------------------------------------- business records


class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[str] = pk()
    organization_id: Mapped[str] = org_fk()
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(20), default="customer")  # customer | supplier | both
    contact_name: Mapped[str | None] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(50))
    email: Mapped[str | None] = mapped_column(String(254))
    address: Mapped[str | None] = mapped_column(Text)
    tax_id: Mapped[str | None] = mapped_column(String(50))
    notes: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)


class BatteryBatch(Base):
    __tablename__ = "battery_batches"
    __table_args__ = (UniqueConstraint("organization_id", "reference"),)

    id: Mapped[str] = pk()
    organization_id: Mapped[str] = org_fk()
    reference: Mapped[str] = mapped_column(String(50))
    customer_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("customers.id", ondelete="SET NULL"))
    received_date: Mapped[date | None] = mapped_column(Date)
    description: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = created_at_col()

    customer: Mapped[Customer | None] = relationship(lazy="joined")


class Battery(Base):
    __tablename__ = "batteries"
    __table_args__ = (
        UniqueConstraint("organization_id", "bos_id"),
        Index("ix_batteries_org_status", "organization_id", "status"),
    )

    id: Mapped[str] = pk()
    organization_id: Mapped[str] = org_fk()
    bos_id: Mapped[str] = mapped_column(String(40))
    customer_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("customers.id", ondelete="SET NULL"))
    batch_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("battery_batches.id", ondelete="SET NULL"))
    received_date: Mapped[date | None] = mapped_column(Date)
    battery_type: Mapped[str] = mapped_column(String(30), default="unknown")
    chemistry: Mapped[str] = mapped_column(String(20), default="unknown")
    nominal_voltage_v: Mapped[float | None] = mapped_column(Float)
    rated_capacity_ah: Mapped[float | None] = mapped_column(Float)
    pack_configuration: Mapped[str | None] = mapped_column(String(50))
    manufacturer: Mapped[str | None] = mapped_column(String(200))
    model: Mapped[str | None] = mapped_column(String(200))
    serial_number: Mapped[str | None] = mapped_column(String(200))
    bms_info: Mapped[str | None] = mapped_column(String(300))
    intake_condition: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    warranty_expires_on: Mapped[date | None] = mapped_column(Date)
    # Where each identifying/technical value came from, e.g.
    # {"chemistry": "nameplate", "rated_capacity_ah": "customer_reported"}.
    provenance: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(30), default="received")
    status_changed_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    created_by_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("users.id", ondelete="SET NULL"))
    updated_by_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)

    customer: Mapped[Customer | None] = relationship(lazy="joined")
    batch: Mapped[BatteryBatch | None] = relationship(lazy="joined")


class Upload(Base):
    """An original file exactly as received. Never modified after creation."""

    __tablename__ = "uploads"

    id: Mapped[str] = pk()
    organization_id: Mapped[str] = org_fk()
    battery_id: Mapped[str] = mapped_column(String(32), ForeignKey("batteries.id", ondelete="CASCADE"), index=True)
    test_session_id: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("test_sessions.id", ondelete="SET NULL")
    )
    kind: Mapped[str] = mapped_column(String(20))  # csv | photo | document
    original_filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    storage_key: Mapped[str] = mapped_column(String(300))
    description: Mapped[str | None] = mapped_column(Text)
    # Free-form, user-supplied context about how the data was captured.
    test_metadata: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    uploaded_by_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("users.id", ondelete="SET NULL"))
    uploaded_at: Mapped[datetime] = created_at_col()

    uploaded_by: Mapped[User | None] = relationship(lazy="joined")


class Dataset(Base):
    """A normalized import of one CSV upload, with the exact parser settings,
    column mapping and validation report that produced it."""

    __tablename__ = "datasets"

    id: Mapped[str] = pk()
    organization_id: Mapped[str] = org_fk()
    battery_id: Mapped[str] = mapped_column(String(32), ForeignKey("batteries.id", ondelete="CASCADE"), index=True)
    upload_id: Mapped[str] = mapped_column(String(32), ForeignKey("uploads.id", ondelete="CASCADE"), index=True)
    test_session_id: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("test_sessions.id", ondelete="SET NULL")
    )
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | superseded
    parser_config: Mapped[dict[str, Any]] = mapped_column(JSON)
    column_mapping: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    validation: Mapped[dict[str, Any]] = mapped_column(JSON)
    acknowledged_warnings: Mapped[list[str]] = mapped_column(JSON, default=list)
    row_count: Mapped[int] = mapped_column(Integer)
    imported_rows: Mapped[int] = mapped_column(Integer)
    fields: Mapped[list[str]] = mapped_column(JSON, default=list)
    summary: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    imported_by_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("users.id", ondelete="SET NULL"))
    imported_at: Mapped[datetime] = created_at_col()

    upload: Mapped[Upload] = relationship(lazy="joined")
    imported_by: Mapped[User | None] = relationship(lazy="joined")


class MeasurementPoint(Base):
    """Normalized time-series sample derived from a Dataset (canonical units)."""

    __tablename__ = "measurement_points"
    __table_args__ = (Index("ix_points_dataset_seq", "dataset_id", "seq"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    organization_id: Mapped[str] = mapped_column(String(32), ForeignKey("organizations.id", ondelete="CASCADE"))
    dataset_id: Mapped[str] = mapped_column(String(32), ForeignKey("datasets.id", ondelete="CASCADE"))
    seq: Mapped[int] = mapped_column(Integer)
    source_row: Mapped[int] = mapped_column(Integer)
    t_s: Mapped[float] = mapped_column(Float)
    voltage_v: Mapped[float | None] = mapped_column(Float)
    current_a: Mapped[float | None] = mapped_column(Float)
    temperature_c: Mapped[float | None] = mapped_column(Float)
    soc_pct: Mapped[float | None] = mapped_column(Float)
    extra: Mapped[dict[str, Any] | None] = mapped_column(JSON)


class TestSession(Base):
    __tablename__ = "test_sessions"
    __test__ = False  # not a pytest test class

    id: Mapped[str] = pk()
    organization_id: Mapped[str] = org_fk()
    battery_id: Mapped[str] = mapped_column(String(32), ForeignKey("batteries.id", ondelete="CASCADE"), index=True)
    test_type: Mapped[str] = mapped_column(String(40))
    test_date: Mapped[date | None] = mapped_column(Date)
    method: Mapped[str | None] = mapped_column(Text)  # profile / procedure description
    equipment: Mapped[str | None] = mapped_column(String(300))
    operator_name: Mapped[str | None] = mapped_column(String(200))
    ambient_temp_c: Mapped[float | None] = mapped_column(Float)
    charge_current_a: Mapped[float | None] = mapped_column(Float)
    discharge_current_a: Mapped[float | None] = mapped_column(Float)
    charge_voltage_v: Mapped[float | None] = mapped_column(Float)
    cutoff_voltage_v: Mapped[float | None] = mapped_column(Float)
    notes: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = created_at_col()

    created_by: Mapped[User | None] = relationship(lazy="joined")


class Measurement(Base):
    """A single summary value with provenance. Never edited: corrections are made
    by voiding (with a reason) and recording a new value."""

    __tablename__ = "measurements"

    id: Mapped[str] = pk()
    organization_id: Mapped[str] = org_fk()
    battery_id: Mapped[str] = mapped_column(String(32), ForeignKey("batteries.id", ondelete="CASCADE"), index=True)
    test_session_id: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("test_sessions.id", ondelete="SET NULL")
    )
    dataset_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("datasets.id", ondelete="SET NULL"))
    source_upload_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("uploads.id", ondelete="SET NULL"))
    name: Mapped[str] = mapped_column(String(60))
    label: Mapped[str] = mapped_column(String(200))
    value_num: Mapped[float | None] = mapped_column(Float)
    value_text: Mapped[str | None] = mapped_column(String(500))
    unit: Mapped[str | None] = mapped_column(String(20))
    kind: Mapped[str] = mapped_column(String(20))  # measured | user_entered | calculated | external | model_estimate
    source_description: Mapped[str | None] = mapped_column(Text)
    conditions: Mapped[str | None] = mapped_column(Text)
    captured_at: Mapped[date | None] = mapped_column(Date)
    recorded_by_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = created_at_col()
    voided_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    voided_by_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("users.id", ondelete="SET NULL"))
    void_reason: Mapped[str | None] = mapped_column(Text)

    recorded_by: Mapped[User | None] = relationship(lazy="joined", foreign_keys=[recorded_by_id])


class TechnicianNote(Base):
    __tablename__ = "technician_notes"

    id: Mapped[str] = pk()
    organization_id: Mapped[str] = org_fk()
    battery_id: Mapped[str] = mapped_column(String(32), ForeignKey("batteries.id", ondelete="CASCADE"), index=True)
    test_session_id: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("test_sessions.id", ondelete="SET NULL")
    )
    note_type: Mapped[str] = mapped_column(String(20))  # observation | inspection | review | general
    body: Mapped[str] = mapped_column(Text, default="")
    # For inspection notes: [{"item": "casing", "result": "ok|issue|not_checked", "comment": "..."}]
    checklist: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON)
    author_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)

    author: Mapped[User | None] = relationship(lazy="joined")


class DiagnosticReport(Base):
    __tablename__ = "diagnostic_reports"

    id: Mapped[str] = pk()
    organization_id: Mapped[str] = org_fk()
    battery_id: Mapped[str] = mapped_column(String(32), ForeignKey("batteries.id", ondelete="CASCADE"), index=True)
    report_number: Mapped[str] = mapped_column(String(40))
    version: Mapped[int] = mapped_column(Integer, default=1)
    previous_version_id: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("diagnostic_reports.id", ondelete="SET NULL")
    )
    status: Mapped[str] = mapped_column(String(20), default="draft")  # draft | approved | superseded
    title: Mapped[str] = mapped_column(String(300))
    # Frozen snapshot of the selected source records, keyed by citation (B1, M1, D1, N1...).
    evidence: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    # [{"key","title","origin","paragraphs":[{"text","citations":[...]}]}]
    sections: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    checks: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    reviewer_conclusion: Mapped[str | None] = mapped_column(Text)
    generator: Mapped[str] = mapped_column(String(100))  # "anthropic:<model>" | "template"
    generated_by_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("users.id", ondelete="SET NULL"))
    generated_at: Mapped[datetime] = created_at_col()
    updated_by_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("users.id", ondelete="SET NULL"))
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    approved_by_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("users.id", ondelete="SET NULL"))
    approved_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    approved_by: Mapped[User | None] = relationship(lazy="joined", foreign_keys=[approved_by_id])
    generated_by: Mapped[User | None] = relationship(lazy="joined", foreign_keys=[generated_by_id])


class CatalogueItem(Base):
    __tablename__ = "catalogue_items"
    __table_args__ = (UniqueConstraint("organization_id", "code"),)

    id: Mapped[str] = pk()
    organization_id: Mapped[str] = org_fk()
    code: Mapped[str] = mapped_column(String(40))
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(30), default="service")  # diagnostic | repair | part | labour | service | other
    unit: Mapped[str] = mapped_column(String(20), default="each")
    unit_price_paise: Mapped[int] = mapped_column(BigInteger, default=0)
    tax_rate_bp: Mapped[int] = mapped_column(Integer, default=1800)  # basis points; 1800 = 18%
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    default_on_quotes: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)


class Quotation(Base):
    __tablename__ = "quotations"
    __table_args__ = (UniqueConstraint("organization_id", "number"),)

    id: Mapped[str] = pk()
    organization_id: Mapped[str] = org_fk()
    number: Mapped[str] = mapped_column(String(40))
    battery_id: Mapped[str] = mapped_column(String(32), ForeignKey("batteries.id", ondelete="CASCADE"), index=True)
    customer_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("customers.id", ondelete="SET NULL"))
    report_id: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("diagnostic_reports.id", ondelete="SET NULL")
    )
    # draft | approved | sent | accepted | declined | void
    status: Mapped[str] = mapped_column(String(20), default="draft")
    revision: Mapped[int] = mapped_column(Integer, default=1)
    issue_date: Mapped[date | None] = mapped_column(Date)
    valid_until: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(Text)
    terms: Mapped[str | None] = mapped_column(Text)
    subtotal_paise: Mapped[int] = mapped_column(BigInteger, default=0)
    tax_paise: Mapped[int] = mapped_column(BigInteger, default=0)
    total_paise: Mapped[int] = mapped_column(BigInteger, default=0)
    drafted_by: Mapped[str] = mapped_column(String(100), default="human")  # human | template | anthropic:<model>
    draft_notes: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = created_at_col()
    updated_by_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("users.id", ondelete="SET NULL"))
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, onupdate=utcnow)
    approved_by_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("users.id", ondelete="SET NULL"))
    approved_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    sent_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    decided_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    customer: Mapped[Customer | None] = relationship(lazy="joined")
    battery: Mapped[Battery] = relationship(lazy="joined")
    approved_by: Mapped[User | None] = relationship(lazy="joined", foreign_keys=[approved_by_id])
    lines: Mapped[list[QuotationLine]] = relationship(
        order_by="QuotationLine.position", cascade="all, delete-orphan", lazy="selectin"
    )


class QuotationLine(Base):
    __tablename__ = "quotation_lines"

    id: Mapped[str] = pk()
    organization_id: Mapped[str] = org_fk()
    quotation_id: Mapped[str] = mapped_column(String(32), ForeignKey("quotations.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column(Integer)
    catalogue_item_id: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("catalogue_items.id", ondelete="SET NULL")
    )
    description: Mapped[str] = mapped_column(Text)
    quantity: Mapped[float] = mapped_column(Float, default=1)
    unit: Mapped[str] = mapped_column(String(20), default="each")
    unit_price_paise: Mapped[int] = mapped_column(BigInteger)
    tax_rate_bp: Mapped[int] = mapped_column(Integer)
    line_subtotal_paise: Mapped[int] = mapped_column(BigInteger)
    line_tax_paise: Mapped[int] = mapped_column(BigInteger)
    line_total_paise: Mapped[int] = mapped_column(BigInteger)
    origin: Mapped[str] = mapped_column(String(20), default="human")  # human | ai | template
    rationale: Mapped[str | None] = mapped_column(Text)


class QuotationRevision(Base):
    __tablename__ = "quotation_revisions"

    id: Mapped[str] = pk()
    organization_id: Mapped[str] = org_fk()
    quotation_id: Mapped[str] = mapped_column(String(32), ForeignKey("quotations.id", ondelete="CASCADE"), index=True)
    revision: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20))
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSON)
    reason: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = created_at_col()


class ServiceEvent(Base):
    __tablename__ = "service_events"

    id: Mapped[str] = pk()
    organization_id: Mapped[str] = org_fk()
    battery_id: Mapped[str] = mapped_column(String(32), ForeignKey("batteries.id", ondelete="CASCADE"), index=True)
    # inspection | repair | replacement | maintenance | dispatch | warranty_claim | other
    event_type: Mapped[str] = mapped_column(String(30))
    description: Mapped[str] = mapped_column(Text)
    performed_by_name: Mapped[str | None] = mapped_column(String(200))
    performed_on: Mapped[date | None] = mapped_column(Date)
    created_by_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = created_at_col()

    created_by: Mapped[User | None] = relationship(lazy="joined")


class AuditEvent(Base):
    __tablename__ = "audit_events"
    __table_args__ = (
        Index("ix_audit_org_created", "organization_id", "created_at"),
        Index("ix_audit_battery", "battery_id", "created_at"),
    )

    id: Mapped[str] = pk()
    organization_id: Mapped[str] = mapped_column(String(32), ForeignKey("organizations.id", ondelete="CASCADE"))
    actor_user_id: Mapped[str | None] = mapped_column(String(32), ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(60))
    entity_type: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[str | None] = mapped_column(String(32))
    battery_id: Mapped[str | None] = mapped_column(String(32))
    summary: Mapped[str] = mapped_column(String(500))
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = created_at_col()

    actor: Mapped[User | None] = relationship(lazy="joined")
