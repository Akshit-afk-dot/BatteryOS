from __future__ import annotations

from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select

from .. import audit, domain, timeutil
from ..deps import Ctx, get_scoped, get_scoped_optional, require
from ..models import (
    AuditEvent,
    Battery,
    BatteryBatch,
    Customer,
    Dataset,
    DiagnosticReport,
    Measurement,
    Quotation,
    ServiceEvent,
    TechnicianNote,
    TestSession,
    Upload,
)
from ..schemas import BatteryBulkCreateIn, BatteryCreateIn, BatteryUpdateIn, ServiceEventIn, StatusChangeIn
from ..serializers import audit_out, battery_out, service_event_out
from ..services.records import change_status, next_battery_id

router = APIRouter(prefix="/api/batteries", tags=["batteries"])

SORTS = {
    "created_desc": Battery.created_at.desc(),
    "created_asc": Battery.created_at.asc(),
    "updated_desc": Battery.updated_at.desc(),
    "received_desc": Battery.received_date.desc(),
    "bos_id": Battery.bos_id.asc(),
}


@router.get("")
def list_batteries(
    q: str | None = Query(default=None, max_length=200),
    status_: list[str] | None = Query(default=None, alias="status"),
    chemistry: str | None = None,
    battery_type: str | None = None,
    customer_id: str | None = None,
    batch_id: str | None = None,
    include_archived: bool = False,
    sort: Literal["created_desc", "created_asc", "updated_desc", "received_desc", "bos_id"] = "created_desc",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
    ctx: Ctx = Depends(require("records.view")),
):
    stmt = select(Battery).outerjoin(Customer, Customer.id == Battery.customer_id).where(
        Battery.organization_id == ctx.org_id
    )
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                Battery.bos_id.ilike(like),
                Battery.serial_number.ilike(like),
                Battery.manufacturer.ilike(like),
                Battery.model.ilike(like),
                Battery.notes.ilike(like),
                Customer.name.ilike(like),
            )
        )
    if status_:
        stmt = stmt.where(Battery.status.in_(status_))
    elif not include_archived:
        stmt = stmt.where(Battery.status != "archived")
    if chemistry:
        stmt = stmt.where(Battery.chemistry == chemistry)
    if battery_type:
        stmt = stmt.where(Battery.battery_type == battery_type)
    if customer_id:
        stmt = stmt.where(Battery.customer_id == customer_id)
    if batch_id:
        stmt = stmt.where(Battery.batch_id == batch_id)
    total = ctx.db.scalar(select(func.count()).select_from(stmt.subquery()))
    items = ctx.db.scalars(
        stmt.order_by(SORTS[sort], Battery.bos_id.desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()
    return {"items": [battery_out(b) for b in items], "total": total, "page": page, "page_size": page_size}


def _validate_links(ctx: Ctx, data: dict) -> None:
    get_scoped_optional(ctx, Customer, data.get("customer_id"), label="Customer")
    get_scoped_optional(ctx, BatteryBatch, data.get("batch_id"), label="Batch")


def _create_one(ctx: Ctx, data: dict) -> Battery:
    data = dict(data)
    if data.get("received_date") is None:
        data["received_date"] = timeutil.today(ctx.org.timezone)
    b = Battery(
        organization_id=ctx.org_id,
        bos_id=next_battery_id(ctx.db, ctx.org_id),
        created_by_id=ctx.user.id,
        updated_by_id=ctx.user.id,
        **data,
    )
    ctx.db.add(b)
    ctx.db.flush()
    audit.log(
        ctx,
        "battery.created",
        "battery",
        b.id,
        f"Battery {b.bos_id} registered",
        battery_id=b.id,
        details={k: audit._jsonable(v) for k, v in data.items() if v not in (None, "", {}, "unknown")},
    )
    return b


@router.post("", status_code=201)
def create_battery(body: BatteryCreateIn, ctx: Ctx = Depends(require("batteries.write"))):
    data = body.model_dump()
    _validate_links(ctx, data)
    b = _create_one(ctx, data)
    ctx.db.commit()
    ctx.db.refresh(b)
    return battery_out(b, detail=True)


@router.post("/bulk", status_code=201)
def bulk_create(body: BatteryBulkCreateIn, ctx: Ctx = Depends(require("batteries.write"))):
    data = body.template.model_dump()
    _validate_links(ctx, data)
    serials = [s.strip() for s in (body.serial_numbers or [])]
    if serials and len(serials) != body.count:
        raise HTTPException(
            422,
            f"{len(serials)} serial numbers were given for {body.count} batteries. Give one per battery or none.",
        )
    created = []
    for i in range(body.count):
        row = dict(data)
        if serials:
            row["serial_number"] = serials[i] or None
        created.append(_create_one(ctx, row))
    ctx.db.commit()
    return {"created": [battery_out(b) for b in created]}


def completeness(ctx: Ctx, b: Battery) -> list[dict]:
    """Deterministic checklist of what is recorded for this battery."""
    db, org = ctx.db, ctx.org_id

    def exists(stmt) -> bool:
        return db.scalar(select(func.count()).select_from(stmt.subquery())) > 0

    prov = b.provenance or {}
    verified = {"nameplate", "datasheet", "technician_verified", "bms_reported"}
    measures = select(Measurement).where(
        Measurement.organization_id == org, Measurement.battery_id == b.id, Measurement.voided_at.is_(None)
    )
    items = [
        ("identity", "Serial number recorded", b.serial_number is not None, "Record the pack serial number, or note that none is visible."),
        ("chemistry", "Chemistry known", b.chemistry not in ("unknown", None), "Confirm chemistry from the nameplate, datasheet or BMS."),
        ("ratings", "Nominal voltage and rated capacity known", b.nominal_voltage_v is not None and b.rated_capacity_ah is not None, "Add nominal voltage and rated capacity."),
        ("verified_specs", "Ratings verified from nameplate, datasheet or BMS", prov.get("rated_capacity_ah") in verified and prov.get("nominal_voltage_v") in verified, "Mark where the ratings came from."),
        ("photos", "Intake photo attached", exists(select(Upload).where(Upload.organization_id == org, Upload.battery_id == b.id, Upload.kind == "photo")), "Upload at least one photo of the pack and label."),
        ("data", "Test or BMS data imported", exists(select(Dataset).where(Dataset.organization_id == org, Dataset.battery_id == b.id, Dataset.status == "active")), "Upload a CSV export and import it."),
        ("inspection", "Visual inspection recorded", exists(select(TechnicianNote).where(TechnicianNote.organization_id == org, TechnicianNote.battery_id == b.id, TechnicianNote.note_type == "inspection")), "Record an inspection checklist."),
        ("capacity", "Capacity result recorded (measured or external)", exists(measures.where(Measurement.name == "capacity_ah", Measurement.kind.in_(["measured", "external"]))), "Record the result of a controlled capacity test."),
        ("resistance", "Internal resistance recorded", exists(measures.where(Measurement.name == "internal_resistance_mohm")), "Record an internal resistance measurement."),
    ]
    return [{"key": k, "label": label, "done": bool(done), "hint": hint} for k, label, done, hint in items]


@router.get("/{battery_id}")
def get_battery(battery_id: str, ctx: Ctx = Depends(require("records.view"))):
    b = get_scoped(ctx, Battery, battery_id, label="Battery")
    db, org = ctx.db, ctx.org_id

    def count(model, *conds) -> int:
        return db.scalar(select(func.count()).select_from(model).where(model.organization_id == org, model.battery_id == b.id, *conds))

    out = battery_out(b, detail=True)
    out["counts"] = {
        "uploads": count(Upload),
        "datasets": count(Dataset, Dataset.status == "active"),
        "test_sessions": count(TestSession),
        "measurements": count(Measurement, Measurement.voided_at.is_(None)),
        "notes": count(TechnicianNote),
        "reports": count(DiagnosticReport, DiagnosticReport.status != "superseded"),
        "quotations": count(Quotation),
        "service_events": count(ServiceEvent),
    }
    out["completeness"] = completeness(ctx, b)
    return out


@router.patch("/{battery_id}")
def update_battery(battery_id: str, body: BatteryUpdateIn, ctx: Ctx = Depends(require("batteries.write"))):
    b = get_scoped(ctx, Battery, battery_id, label="Battery")
    data = body.model_dump(exclude_unset=True)
    _validate_links(ctx, data)
    if "provenance" in data:
        data["provenance"] = {**(b.provenance or {}), **(data["provenance"] or {})}
    for key in ("battery_type", "chemistry"):
        if key in data and data[key] is None:
            data[key] = "unknown"
    before = {k: getattr(b, k) for k in data}
    for k, v in data.items():
        setattr(b, k, v)
    b.updated_by_id = ctx.user.id
    delta = audit.diff(before, data)
    if delta:
        audit.log(
            ctx, "battery.updated", "battery", b.id, f"Battery {b.bos_id} details updated ({', '.join(delta)})",
            battery_id=b.id, details=delta,
        )
    ctx.db.commit()
    ctx.db.refresh(b)
    return battery_out(b, detail=True)


@router.post("/{battery_id}/status")
def set_status(battery_id: str, body: StatusChangeIn, ctx: Ctx = Depends(require("batteries.write"))):
    b = get_scoped(ctx, Battery, battery_id, label="Battery")
    change_status(ctx, b, body.status, reason=body.reason, trigger="proposed by assistant, confirmed by user" if body.via_assistant else None)
    ctx.db.commit()
    ctx.db.refresh(b)
    return battery_out(b, detail=True)


@router.get("/{battery_id}/history")
def history(battery_id: str, ctx: Ctx = Depends(require("records.view"))):
    b = get_scoped(ctx, Battery, battery_id, label="Battery")
    events = ctx.db.scalars(
        select(AuditEvent)
        .where(AuditEvent.organization_id == ctx.org_id, AuditEvent.battery_id == b.id)
        .order_by(AuditEvent.created_at.desc())
        .limit(500)
    ).all()
    return [audit_out(e) for e in events]


@router.get("/{battery_id}/service-events")
def list_service_events(battery_id: str, ctx: Ctx = Depends(require("records.view"))):
    b = get_scoped(ctx, Battery, battery_id, label="Battery")
    events = ctx.db.scalars(
        select(ServiceEvent)
        .where(ServiceEvent.organization_id == ctx.org_id, ServiceEvent.battery_id == b.id)
        .order_by(ServiceEvent.performed_on.desc().nulls_last(), ServiceEvent.created_at.desc())
    ).all()
    return [service_event_out(e) for e in events]


@router.post("/{battery_id}/service-events", status_code=201)
def add_service_event(battery_id: str, body: ServiceEventIn, ctx: Ctx = Depends(require("batteries.write"))):
    b = get_scoped(ctx, Battery, battery_id, label="Battery")
    e = ServiceEvent(organization_id=ctx.org_id, battery_id=b.id, created_by_id=ctx.user.id, **body.model_dump())
    if e.performed_on is None:
        e.performed_on = timeutil.today(ctx.org.timezone)
    ctx.db.add(e)
    ctx.db.flush()
    audit.log(
        ctx, "service_event.created", "service_event", e.id,
        f"{body.event_type.replace('_', ' ').capitalize()} recorded: {body.description[:120]}", battery_id=b.id,
    )
    ctx.db.commit()
    ctx.db.refresh(e)
    return service_event_out(e)


@router.get("/{battery_id}/transitions")
def transitions(battery_id: str, ctx: Ctx = Depends(require("records.view"))):
    b = get_scoped(ctx, Battery, battery_id, label="Battery")
    return {
        "current": b.status,
        "allowed": sorted(domain.STATUS_TRANSITIONS.get(b.status, ())),
        "requires_reason": sorted(domain.STATUSES_REQUIRING_REASON),
    }
