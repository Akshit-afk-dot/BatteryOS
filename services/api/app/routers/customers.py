from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select

from .. import audit
from ..deps import Ctx, get_scoped, get_scoped_optional, require
from ..models import Battery, BatteryBatch, Customer, Quotation
from ..schemas import BatchIn, CustomerIn
from ..serializers import batch_out, battery_out, customer_out, quotation_out
from ..services.records import next_batch_reference

router = APIRouter(prefix="/api", tags=["customers"])


def _battery_counts(ctx: Ctx, column, ids: list[str]) -> dict[str, int]:
    if not ids:
        return {}
    rows = ctx.db.execute(
        select(column, func.count()).where(Battery.organization_id == ctx.org_id, column.in_(ids)).group_by(column)
    ).all()
    return {k: n for k, n in rows}


@router.get("/customers")
def list_customers(q: str | None = Query(default=None, max_length=200), ctx: Ctx = Depends(require("records.view"))):
    stmt = select(Customer).where(Customer.organization_id == ctx.org_id)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(Customer.name.ilike(like), Customer.contact_name.ilike(like), Customer.phone.ilike(like), Customer.email.ilike(like))
        )
    customers = ctx.db.scalars(stmt.order_by(Customer.name)).all()
    counts = _battery_counts(ctx, Battery.customer_id, [c.id for c in customers])
    return [customer_out(c, counts.get(c.id, 0)) for c in customers]


@router.post("/customers", status_code=201)
def create_customer(body: CustomerIn, ctx: Ctx = Depends(require("customers.write"))):
    c = Customer(organization_id=ctx.org_id, created_by_id=ctx.user.id, **body.model_dump())
    ctx.db.add(c)
    ctx.db.flush()
    audit.log(ctx, "customer.created", "customer", c.id, f"Customer '{c.name}' created")
    ctx.db.commit()
    return customer_out(c, 0)


@router.get("/customers/{customer_id}")
def get_customer(customer_id: str, ctx: Ctx = Depends(require("records.view"))):
    c = get_scoped(ctx, Customer, customer_id, label="Customer")
    batteries = ctx.db.scalars(
        select(Battery)
        .where(Battery.organization_id == ctx.org_id, Battery.customer_id == c.id)
        .order_by(Battery.created_at.desc())
    ).all()
    quotations = ctx.db.scalars(
        select(Quotation)
        .where(Quotation.organization_id == ctx.org_id, Quotation.customer_id == c.id)
        .order_by(Quotation.created_at.desc())
    ).all()
    out = customer_out(c, len(batteries))
    out["batteries"] = [battery_out(b) for b in batteries]
    out["quotations"] = [quotation_out(q, detail=False) for q in quotations]
    return out


@router.patch("/customers/{customer_id}")
def update_customer(customer_id: str, body: CustomerIn, ctx: Ctx = Depends(require("customers.write"))):
    c = get_scoped(ctx, Customer, customer_id, label="Customer")
    data = body.model_dump()
    before = {k: getattr(c, k) for k in data}
    for k, v in data.items():
        setattr(c, k, v)
    delta = audit.diff(before, data)
    if delta:
        audit.log(ctx, "customer.updated", "customer", c.id, f"Customer '{c.name}' updated", details=delta)
    ctx.db.commit()
    return customer_out(c)


# --------------------------------------------------------------------------- batches


@router.get("/batches")
def list_batches(ctx: Ctx = Depends(require("records.view"))):
    batches = ctx.db.scalars(
        select(BatteryBatch).where(BatteryBatch.organization_id == ctx.org_id).order_by(BatteryBatch.created_at.desc())
    ).all()
    counts = _battery_counts(ctx, Battery.batch_id, [b.id for b in batches])
    return [batch_out(b, counts.get(b.id, 0)) for b in batches]


@router.post("/batches", status_code=201)
def create_batch(body: BatchIn, ctx: Ctx = Depends(require("batteries.write"))):
    get_scoped_optional(ctx, Customer, body.customer_id, label="Customer")
    reference = body.reference or next_batch_reference(ctx.db, ctx.org_id)
    if ctx.db.scalar(
        select(BatteryBatch.id).where(BatteryBatch.organization_id == ctx.org_id, BatteryBatch.reference == reference)
    ):
        raise HTTPException(status.HTTP_409_CONFLICT, f"A batch with reference '{reference}' already exists.")
    b = BatteryBatch(
        organization_id=ctx.org_id,
        reference=reference,
        customer_id=body.customer_id,
        received_date=body.received_date,
        description=body.description,
        created_by_id=ctx.user.id,
    )
    ctx.db.add(b)
    ctx.db.flush()
    audit.log(ctx, "batch.created", "batch", b.id, f"Batch {reference} created")
    ctx.db.commit()
    ctx.db.refresh(b)
    return batch_out(b, 0)


@router.get("/batches/{batch_id}")
def get_batch(batch_id: str, ctx: Ctx = Depends(require("records.view"))):
    b = get_scoped(ctx, BatteryBatch, batch_id, label="Batch")
    batteries = ctx.db.scalars(
        select(Battery).where(Battery.organization_id == ctx.org_id, Battery.batch_id == b.id).order_by(Battery.bos_id)
    ).all()
    out = batch_out(b, len(batteries))
    out["batteries"] = [battery_out(x) for x in batteries]
    by_status: dict[str, int] = {}
    for x in batteries:
        by_status[x.status] = by_status.get(x.status, 0) + 1
    out["by_status"] = by_status
    return out


@router.patch("/batches/{batch_id}")
def update_batch(batch_id: str, body: BatchIn, ctx: Ctx = Depends(require("batteries.write"))):
    b = get_scoped(ctx, BatteryBatch, batch_id, label="Batch")
    get_scoped_optional(ctx, Customer, body.customer_id, label="Customer")
    data = body.model_dump(exclude_unset=True)
    if "reference" in data and not data["reference"]:
        data.pop("reference")
    if data.get("reference") and data["reference"] != b.reference and ctx.db.scalar(
        select(BatteryBatch.id).where(
            BatteryBatch.organization_id == ctx.org_id, BatteryBatch.reference == data["reference"]
        )
    ):
        raise HTTPException(status.HTTP_409_CONFLICT, f"A batch with reference '{data['reference']}' already exists.")
    before = {k: getattr(b, k) for k in data}
    for k, v in data.items():
        setattr(b, k, v)
    delta = audit.diff(before, data)
    if delta:
        audit.log(ctx, "batch.updated", "batch", b.id, f"Batch {b.reference} updated", details=delta)
    ctx.db.commit()
    ctx.db.refresh(b)
    return batch_out(b)
