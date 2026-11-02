from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from .models import AuditEvent


def record(
    db: Session,
    *,
    org_id: str,
    actor_id: str | None,
    action: str,
    entity_type: str,
    entity_id: str | None,
    summary: str,
    battery_id: str | None = None,
    details: dict[str, Any] | None = None,
) -> AuditEvent:
    """Append an audit event to the current transaction. Callers commit."""
    event = AuditEvent(
        organization_id=org_id,
        actor_user_id=actor_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        battery_id=battery_id,
        summary=summary[:500],
        details=details or {},
    )
    db.add(event)
    return event


def log(ctx, action: str, entity_type: str, entity_id: str | None, summary: str, **kw) -> AuditEvent:
    """Shorthand for recording an action performed by the signed-in user."""
    return record(
        ctx.db,
        org_id=ctx.org_id,
        actor_id=ctx.user.id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        summary=summary,
        **kw,
    )


def diff(before: dict[str, Any], after: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Field-level changes, JSON-safe, for audit details."""
    out: dict[str, dict[str, Any]] = {}
    for key in sorted(set(before) | set(after)):
        if before.get(key) != after.get(key):
            out[key] = {"from": _jsonable(before.get(key)), "to": _jsonable(after.get(key))}
    return out


def _jsonable(v: Any) -> Any:
    if v is None or isinstance(v, (str, int, float, bool, list, dict)):
        return v
    return str(v)
