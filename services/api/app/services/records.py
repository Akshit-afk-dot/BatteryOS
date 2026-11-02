"""Record numbering and the battery status workflow."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit, domain
from ..models import Battery, Organization, utcnow


def _locked_org(db: Session, org_id: str) -> Organization:
    # FOR UPDATE serializes numbering on Postgres; SQLite serializes writes anyway.
    return db.scalars(select(Organization).where(Organization.id == org_id).with_for_update()).one()


def _yy() -> str:
    return datetime.now(timezone.utc).strftime("%y")


def next_battery_id(db: Session, org_id: str) -> str:
    org = _locked_org(db, org_id)
    org.battery_seq += 1
    return f"{org.battery_id_prefix}-{_yy()}-{org.battery_seq:05d}"


def next_quotation_number(db: Session, org_id: str) -> str:
    org = _locked_org(db, org_id)
    org.quotation_seq += 1
    return f"QT-{_yy()}-{org.quotation_seq:04d}"


def next_report_number(db: Session, org_id: str) -> str:
    org = _locked_org(db, org_id)
    org.report_seq += 1
    return f"RPT-{_yy()}-{org.report_seq:04d}"


def next_batch_reference(db: Session, org_id: str) -> str:
    org = _locked_org(db, org_id)
    org.batch_seq += 1
    return f"BATCH-{_yy()}-{org.batch_seq:03d}"


def change_status(
    ctx,
    battery: Battery,
    target: str,
    *,
    reason: str | None = None,
    trigger: str | None = None,
) -> None:
    """Validate and apply a manual status change, with an audit entry."""
    current = battery.status
    if target == current:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"The battery is already '{current}'.")
    if not domain.can_transition(current, target):
        allowed = ", ".join(sorted(domain.STATUS_TRANSITIONS.get(current, ()))) or "none"
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Cannot move from '{current}' to '{target}'. Allowed next statuses: {allowed}.",
        )
    if target in domain.STATUSES_REQUIRING_REASON and not (reason and reason.strip()):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"A reason is required when setting status to '{target}'.")
    _apply(ctx, battery, target, reason=reason, trigger=trigger)


def advance_status_if_allowed(ctx, battery: Battery, target: str, *, trigger: str) -> bool:
    """Workflow side-effect (e.g. quotation approved -> 'quoted'). Applied only
    when it is a permitted transition; otherwise the status is left alone."""
    if battery.status == target or not domain.can_transition(battery.status, target):
        return False
    _apply(ctx, battery, target, reason=None, trigger=trigger)
    return True


def _apply(ctx, battery: Battery, target: str, *, reason: str | None, trigger: str | None) -> None:
    previous = battery.status
    battery.status = target
    battery.status_changed_at = utcnow()
    battery.updated_by_id = ctx.user.id
    summary = f"Status changed from {previous} to {target}"
    if trigger:
        summary += f" ({trigger})"
    audit.log(
        ctx,
        "battery.status_changed",
        "battery",
        battery.id,
        summary,
        battery_id=battery.id,
        details={"from": previous, "to": target, "reason": reason, "trigger": trigger},
    )
