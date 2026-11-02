from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select

from .. import domain
from ..deps import Ctx, require
from ..models import AuditEvent, Battery, DiagnosticReport, Quotation
from ..serializers import audit_out, battery_out, quotation_out

router = APIRouter(prefix="/api", tags=["dashboard"])


@router.get("/dashboard")
def dashboard(ctx: Ctx = Depends(require("records.view"))):
    """Counts computed directly from stored records — nothing estimated."""
    db, org = ctx.db, ctx.org_id
    rows = db.execute(
        select(Battery.status, func.count()).where(Battery.organization_id == org).group_by(Battery.status)
    ).all()
    by_status = {s: 0 for s in domain.BATTERY_STATUSES}
    by_status.update({s: n for s, n in rows})
    total = sum(by_status.values())

    def batteries(*conds, order=Battery.created_at.desc(), limit=6):
        return [
            battery_out(b)
            for b in db.scalars(select(Battery).where(Battery.organization_id == org, *conds).order_by(order).limit(limit))
        ]

    open_q = db.scalars(
        select(Quotation)
        .where(Quotation.organization_id == org, Quotation.status.in_(["draft", "approved", "sent"]))
        .order_by(Quotation.updated_at.desc())
        .limit(8)
    ).all()
    open_counts = dict(
        db.execute(
            select(Quotation.status, func.count())
            .where(Quotation.organization_id == org, Quotation.status.in_(["draft", "approved", "sent"]))
            .group_by(Quotation.status)
        ).all()
    )
    open_value = db.scalar(
        select(func.coalesce(func.sum(Quotation.total_paise), 0)).where(
            Quotation.organization_id == org, Quotation.status.in_(["approved", "sent"])
        )
    )
    reports_to_approve = db.scalar(
        select(func.count()).select_from(DiagnosticReport).where(
            DiagnosticReport.organization_id == org, DiagnosticReport.status == "draft"
        )
    )
    return {
        "total_batteries": total,
        "active_batteries": total - by_status.get("archived", 0) - by_status.get("dispatched", 0) - by_status.get("rejected", 0),
        "by_status": by_status,
        "recently_received": batteries(order=Battery.received_date.desc().nulls_last()),
        "awaiting_data": batteries(Battery.status == "awaiting_data", order=Battery.status_changed_at.asc()),
        "review_required": batteries(Battery.status == "review_required", order=Battery.status_changed_at.asc()),
        "recently_updated": batteries(order=Battery.updated_at.desc()),
        "open_quotations": {
            "counts": {s: open_counts.get(s, 0) for s in ("draft", "approved", "sent")},
            "approved_or_sent_total_paise": int(open_value or 0),
            "items": [quotation_out(q, detail=False) for q in open_q],
        },
        "reports_awaiting_approval": int(reports_to_approve or 0),
    }


@router.get("/audit")
def audit_log(
    action: str | None = Query(default=None, max_length=60),
    entity_type: str | None = Query(default=None, max_length=40),
    actor_id: str | None = None,
    battery_id: str | None = None,
    before: datetime | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    ctx: Ctx = Depends(require("audit.view")),
):
    stmt = select(AuditEvent).where(AuditEvent.organization_id == ctx.org_id)
    if action:
        stmt = stmt.where(AuditEvent.action.like(f"{action}%"))
    if entity_type:
        stmt = stmt.where(AuditEvent.entity_type == entity_type)
    if actor_id:
        stmt = stmt.where(AuditEvent.actor_user_id == actor_id)
    if battery_id:
        stmt = stmt.where(AuditEvent.battery_id == battery_id)
    if before:
        stmt = stmt.where(AuditEvent.created_at < before)
    events = ctx.db.scalars(stmt.order_by(AuditEvent.created_at.desc()).limit(limit + 1)).all()
    has_more = len(events) > limit
    events = events[:limit]
    return {
        "items": [audit_out(e) for e in events],
        "next_before": events[-1].created_at if has_more and events else None,
    }
