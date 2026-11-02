"""Request bodies. Every write endpoint validates its input with one of these
models; unknown fields are rejected so typos never silently drop data."""

from __future__ import annotations

from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from . import domain


class In(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


def _blank_to_none(v: Any) -> Any:
    if isinstance(v, str) and not v.strip():
        return None
    return v


Role = Literal["owner", "admin", "technician", "staff"]
InviteRole = Literal["admin", "technician", "staff"]
Password = Field(min_length=10, max_length=200)


# --------------------------------------------------------------------------- auth & workspace


class SignupIn(In):
    organization_name: str = Field(min_length=2, max_length=200)
    full_name: str = Field(min_length=1, max_length=200)
    email: EmailStr
    password: str = Password


class LoginIn(In):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class SwitchOrgIn(In):
    organization_id: str


class WorkspaceCreateIn(In):
    name: str = Field(min_length=2, max_length=200)


class ChangePasswordIn(In):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Password


class ProfileIn(In):
    full_name: str = Field(min_length=1, max_length=200)


class OrgUpdateIn(In):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    legal_name: str | None = Field(default=None, max_length=200)
    address: str | None = Field(default=None, max_length=2000)
    phone: str | None = Field(default=None, max_length=50)
    email: EmailStr | None = None
    tax_id: str | None = Field(default=None, max_length=50)
    battery_id_prefix: str | None = Field(default=None, pattern=r"^[A-Z0-9]{2,8}$")
    quotation_terms: str | None = Field(default=None, max_length=5000)
    quotation_validity_days: int | None = Field(default=None, ge=1, le=365)
    timezone: str | None = Field(default=None, max_length=64)

    @field_validator("timezone")
    @classmethod
    def _valid_zone(cls, v: str | None) -> str | None:
        from .timeutil import is_valid_zone

        if v is not None and not is_valid_zone(v):
            raise ValueError("Unknown time zone. Use an IANA name such as Asia/Kolkata.")
        return v

    _blank = field_validator("legal_name", "address", "phone", "email", "tax_id", "quotation_terms", mode="before")(
        _blank_to_none
    )


class InviteIn(In):
    email: EmailStr
    role: InviteRole


class InviteAcceptIn(In):
    full_name: str | None = Field(default=None, max_length=200)
    password: str = Field(min_length=1, max_length=200)


class MemberUpdateIn(In):
    role: Role | None = None
    is_active: bool | None = None


# --------------------------------------------------------------------------- customers & batches


class CustomerIn(In):
    name: str = Field(min_length=1, max_length=200)
    kind: Literal["customer", "supplier", "both"] = "customer"
    contact_name: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=50)
    email: EmailStr | None = None
    address: str | None = Field(default=None, max_length=2000)
    tax_id: str | None = Field(default=None, max_length=50)
    notes: str | None = Field(default=None, max_length=5000)

    _blank = field_validator("contact_name", "phone", "email", "address", "tax_id", "notes", mode="before")(
        _blank_to_none
    )


class BatchIn(In):
    reference: str | None = Field(default=None, max_length=50)
    customer_id: str | None = None
    received_date: date | None = None
    description: str | None = Field(default=None, max_length=5000)

    _blank = field_validator("reference", "customer_id", "description", mode="before")(_blank_to_none)


# --------------------------------------------------------------------------- batteries

ProvenanceSource = Literal[
    "nameplate", "datasheet", "bms_reported", "customer_reported", "technician_verified", "unverified"
]


class BatteryFields(In):
    customer_id: str | None = None
    batch_id: str | None = None
    received_date: date | None = None
    battery_type: Literal[domain.BATTERY_TYPES] = "unknown"  # type: ignore[valid-type]
    chemistry: Literal[domain.CHEMISTRIES] = "unknown"  # type: ignore[valid-type]
    nominal_voltage_v: float | None = Field(default=None, gt=0, le=2000)
    rated_capacity_ah: float | None = Field(default=None, gt=0, le=100000)
    pack_configuration: str | None = Field(default=None, max_length=50)
    manufacturer: str | None = Field(default=None, max_length=200)
    model: str | None = Field(default=None, max_length=200)
    serial_number: str | None = Field(default=None, max_length=200)
    bms_info: str | None = Field(default=None, max_length=300)
    intake_condition: str | None = Field(default=None, max_length=5000)
    notes: str | None = Field(default=None, max_length=10000)
    warranty_expires_on: date | None = None
    provenance: dict[str, ProvenanceSource] = Field(default_factory=dict)

    _blank = field_validator(
        "customer_id",
        "batch_id",
        "pack_configuration",
        "manufacturer",
        "model",
        "serial_number",
        "bms_info",
        "intake_condition",
        "notes",
        "nominal_voltage_v",
        "rated_capacity_ah",
        "received_date",
        "warranty_expires_on",
        mode="before",
    )(_blank_to_none)

    @field_validator("provenance")
    @classmethod
    def _known_fields(cls, v: dict[str, str]) -> dict[str, str]:
        unknown = set(v) - set(domain.PROVENANCE_FIELDS)
        if unknown:
            raise ValueError(f"Provenance can only be recorded for: {', '.join(domain.PROVENANCE_FIELDS)}")
        return v


class BatteryCreateIn(BatteryFields):
    pass


class BatteryBulkCreateIn(In):
    count: int = Field(ge=1, le=200)
    template: BatteryFields
    serial_numbers: list[str] | None = Field(default=None, max_length=200)


class BatteryUpdateIn(BatteryFields):
    # On update every field is optional; only fields present in the body change.
    battery_type: Literal[domain.BATTERY_TYPES] | None = None  # type: ignore[valid-type]
    chemistry: Literal[domain.CHEMISTRIES] | None = None  # type: ignore[valid-type]
    provenance: dict[str, ProvenanceSource] | None = None  # type: ignore[assignment]


class StatusChangeIn(In):
    status: Literal[domain.BATTERY_STATUSES]  # type: ignore[valid-type]
    reason: str | None = Field(default=None, max_length=2000)
    via_assistant: bool = False


# --------------------------------------------------------------------------- uploads & import


class ParserOptions(In):
    encoding: Literal["utf-8", "utf-16", "cp1252", "latin-1"] | None = None
    delimiter: Literal[",", ";", "\t", "|"] | None = None
    header_row: int | None = Field(default=None, ge=0, le=1000)
    decimal: Literal[".", ","] | None = None
    dayfirst: bool | None = None
    current_sign: Literal["discharge_negative", "discharge_positive"] | None = None


class MappingEntry(In):
    column: str = Field(max_length=300)
    field: str = Field(max_length=40)
    unit: str = Field(max_length=20)
    unit_source: Literal["header", "user", "assumed"] = "user"


class PreviewIn(In):
    options: ParserOptions = Field(default_factory=ParserOptions)
    mapping: list[MappingEntry] | None = Field(default=None, max_length=300)


class ImportIn(PreviewIn):
    acknowledge_warnings: bool = False
    test_session_id: str | None = None


class UploadUpdateIn(In):
    description: str | None = Field(default=None, max_length=2000)
    test_session_id: str | None = None


# --------------------------------------------------------------------------- tests, measurements, notes


class TestSessionIn(In):
    test_type: Literal[domain.TEST_TYPES]  # type: ignore[valid-type]
    test_date: date | None = None
    method: str | None = Field(default=None, max_length=5000)
    equipment: str | None = Field(default=None, max_length=300)
    operator_name: str | None = Field(default=None, max_length=200)
    ambient_temp_c: float | None = Field(default=None, ge=-50, le=100)
    charge_current_a: float | None = Field(default=None, ge=0, le=5000)
    discharge_current_a: float | None = Field(default=None, ge=0, le=5000)
    charge_voltage_v: float | None = Field(default=None, gt=0, le=2000)
    cutoff_voltage_v: float | None = Field(default=None, gt=0, le=2000)
    notes: str | None = Field(default=None, max_length=10000)

    _blank = field_validator(
        "method",
        "equipment",
        "operator_name",
        "notes",
        "test_date",
        "ambient_temp_c",
        "charge_current_a",
        "discharge_current_a",
        "charge_voltage_v",
        "cutoff_voltage_v",
        mode="before",
    )(_blank_to_none)


class MeasurementIn(In):
    name: Literal[tuple(domain.MEASUREMENT_NAMES)]  # type: ignore[valid-type]
    label: str | None = Field(default=None, max_length=200)
    value_num: float | None = None
    value_text: str | None = Field(default=None, max_length=500)
    unit: str | None = Field(default=None, max_length=20)
    # "calculated" values are produced only by the system from imported data.
    kind: Literal["measured", "user_entered", "external", "model_estimate"]
    source_description: str | None = Field(default=None, max_length=2000)
    conditions: str | None = Field(default=None, max_length=2000)
    captured_at: date | None = None
    test_session_id: str | None = None
    source_upload_id: str | None = None

    _blank = field_validator(
        "label", "value_text", "unit", "source_description", "conditions", "test_session_id", "source_upload_id",
        "captured_at", "value_num", mode="before",
    )(_blank_to_none)


class VoidIn(In):
    reason: str = Field(min_length=3, max_length=2000)


class ChecklistItem(In):
    item: str = Field(max_length=40)
    result: Literal["ok", "issue", "not_checked"]
    comment: str | None = Field(default=None, max_length=1000)


class NoteIn(In):
    note_type: Literal[domain.NOTE_TYPES]  # type: ignore[valid-type]
    body: str = Field(default="", max_length=20000)
    checklist: list[ChecklistItem] | None = Field(default=None, max_length=40)
    test_session_id: str | None = None


class NoteUpdateIn(In):
    body: str | None = Field(default=None, max_length=20000)
    checklist: list[ChecklistItem] | None = Field(default=None, max_length=40)


class ServiceEventIn(In):
    event_type: Literal[domain.SERVICE_EVENT_TYPES]  # type: ignore[valid-type]
    description: str = Field(min_length=1, max_length=5000)
    performed_by_name: str | None = Field(default=None, max_length=200)
    performed_on: date | None = None

    _blank = field_validator("performed_by_name", "performed_on", mode="before")(_blank_to_none)


# --------------------------------------------------------------------------- reports


class ReportDraftIn(In):
    include: list[str] = Field(min_length=1, max_length=500)  # evidence source refs, e.g. "measurement:<id>"
    use_ai: bool = True
    title: str | None = Field(default=None, max_length=300)


class Paragraph(In):
    text: str = Field(max_length=10000)
    citations: list[str] = Field(default_factory=list, max_length=50)


class Section(In):
    key: str = Field(max_length=40)
    title: str = Field(max_length=200)
    origin: Literal["ai", "ai_edited", "template", "template_edited", "human"]
    paragraphs: list[Paragraph] = Field(max_length=100)


class ReportUpdateIn(In):
    title: str | None = Field(default=None, max_length=300)
    sections: list[Section] | None = Field(default=None, max_length=20)
    reviewer_conclusion: str | None = Field(default=None, max_length=10000)


class ReportApproveIn(In):
    acknowledge_checks: bool = False


# --------------------------------------------------------------------------- catalogue & quotations


class CatalogueItemIn(In):
    code: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9._-]+$")
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    category: Literal[domain.CATALOGUE_CATEGORIES] = "service"  # type: ignore[valid-type]
    unit: str = Field(default="each", min_length=1, max_length=20)
    unit_price_paise: int = Field(ge=0, le=10_000_000_000)
    tax_rate_bp: int = Field(default=1800, ge=0, le=10000)
    is_active: bool = True
    default_on_quotes: bool = False

    _blank = field_validator("description", mode="before")(_blank_to_none)


class QuotationCreateIn(In):
    battery_id: str
    report_id: str | None = None
    use_ai: bool = False


class QuotationLineIn(In):
    catalogue_item_id: str | None = None
    description: str = Field(min_length=1, max_length=2000)
    quantity: float = Field(gt=0, le=100000)
    unit: str = Field(default="each", min_length=1, max_length=20)
    unit_price_paise: int = Field(ge=0, le=10_000_000_000)
    tax_rate_bp: int = Field(ge=0, le=10000)
    origin: Literal["human", "ai", "template"] = "human"
    rationale: str | None = Field(default=None, max_length=2000)


class QuotationUpdateIn(In):
    customer_id: str | None = None
    valid_until: date | None = None
    issue_date: date | None = None
    notes: str | None = Field(default=None, max_length=5000)
    terms: str | None = Field(default=None, max_length=5000)
    lines: list[QuotationLineIn] | None = Field(default=None, max_length=200)

    _blank = field_validator("customer_id", "notes", "terms", "valid_until", "issue_date", mode="before")(_blank_to_none)


class QuotationStatusIn(In):
    status: Literal["sent", "accepted", "declined", "void"]
    reason: str | None = Field(default=None, max_length=2000)


# --------------------------------------------------------------------------- assistant


class ChatMessage(In):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)


class ChatIn(In):
    messages: list[ChatMessage] = Field(min_length=1, max_length=40)
    battery_id: str | None = None


class ExtractIntakeIn(In):
    text: str = Field(min_length=3, max_length=8000)
