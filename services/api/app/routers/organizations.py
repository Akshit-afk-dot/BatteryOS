from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select

from .. import audit, domain
from ..config import get_settings
from ..deps import Ctx, get_ctx, get_scoped, require
from ..models import Invitation, OrganizationMember, User, utcnow
from ..schemas import InviteIn, MemberUpdateIn, OrgUpdateIn
from ..security import hash_token, new_token
from ..serializers import invitation_out, member_out, org_out
from ..services.csv_ingest import FIELDS

router = APIRouter(prefix="/api", tags=["organization"])


@router.get("/meta")
def meta(ctx: Ctx = Depends(get_ctx)):
    """Vocabularies the UI needs to render forms and labels consistently."""
    return {
        "battery_statuses": list(domain.BATTERY_STATUSES),
        "status_transitions": {k: sorted(v) for k, v in domain.STATUS_TRANSITIONS.items()},
        "statuses_requiring_reason": sorted(domain.STATUSES_REQUIRING_REASON),
        "battery_types": list(domain.BATTERY_TYPES),
        "chemistries": list(domain.CHEMISTRIES),
        "provenance_sources": list(domain.PROVENANCE_SOURCES),
        "provenance_fields": list(domain.PROVENANCE_FIELDS),
        "measurement_kinds": list(domain.MEASUREMENT_KINDS),
        "measurement_names": domain.MEASUREMENT_NAMES,
        "test_types": list(domain.TEST_TYPES),
        "note_types": list(domain.NOTE_TYPES),
        "inspection_items": [{"key": k, "label": label} for k, label in domain.INSPECTION_ITEMS],
        "service_event_types": list(domain.SERVICE_EVENT_TYPES),
        "catalogue_categories": list(domain.CATALOGUE_CATEGORIES),
        "csv_fields": {k: {"label": v["label"], "units": v["units"], "multi": v["multi"]} for k, v in FIELDS.items()},
        "roles": list(domain.ROLES),
        "permissions": {p: sorted(r) for p, r in domain.PERMISSIONS.items()},
    }


@router.get("/organizations/current")
def current_org(ctx: Ctx = Depends(get_ctx)):
    return org_out(ctx.org)


@router.patch("/organizations/current")
def update_org(body: OrgUpdateIn, ctx: Ctx = Depends(require("org.update"))):
    changes = body.model_dump(exclude_unset=True)
    before = {k: getattr(ctx.org, k) for k in changes}
    for k, v in changes.items():
        setattr(ctx.org, k, v)
    delta = audit.diff(before, changes)
    if delta:
        audit.log(ctx, "organization.updated", "organization", ctx.org.id, "Workspace settings updated", details=delta)
    ctx.db.commit()
    return org_out(ctx.org)


@router.get("/organizations/current/members")
def list_members(ctx: Ctx = Depends(get_ctx)):
    members = ctx.db.scalars(
        select(OrganizationMember)
        .where(OrganizationMember.organization_id == ctx.org_id)
        .order_by(OrganizationMember.created_at)
    ).all()
    return [member_out(m) for m in members]


@router.patch("/organizations/current/members/{member_id}")
def update_member(member_id: str, body: MemberUpdateIn, ctx: Ctx = Depends(require("members.manage"))):
    m = get_scoped(ctx, OrganizationMember, member_id, label="Member")
    changes = body.model_dump(exclude_unset=True)
    if m.user_id == ctx.user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot change your own role or access.")
    if m.role == "owner" and ctx.role != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only an owner can change another owner.")
    if changes.get("role") == "owner" and ctx.role != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only an owner can grant the owner role.")
    if m.role == "owner" and (changes.get("role", "owner") != "owner" or changes.get("is_active") is False):
        owners = ctx.db.scalar(
            select(func.count()).select_from(OrganizationMember).where(
                OrganizationMember.organization_id == ctx.org_id,
                OrganizationMember.role == "owner",
                OrganizationMember.is_active.is_(True),
            )
        )
        if owners <= 1:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "A workspace must keep at least one active owner.")
    before = {"role": m.role, "is_active": m.is_active}
    for k, v in changes.items():
        setattr(m, k, v)
    delta = audit.diff(before, {"role": m.role, "is_active": m.is_active})
    if delta:
        audit.log(ctx, "member.updated", "user", m.user_id, f"Access updated for {m.user.full_name}", details=delta)
    ctx.db.commit()
    return member_out(m)


@router.get("/organizations/current/invitations")
def list_invitations(ctx: Ctx = Depends(require("members.manage"))):
    invites = ctx.db.scalars(
        select(Invitation).where(Invitation.organization_id == ctx.org_id).order_by(Invitation.created_at.desc())
    ).all()
    users = {u.id: u for u in ctx.db.scalars(select(User).where(User.id.in_({i.invited_by_id for i in invites})))}
    return [invitation_out(i, users.get(i.invited_by_id)) for i in invites]


@router.post("/organizations/current/invitations", status_code=201)
def create_invitation(body: InviteIn, ctx: Ctx = Depends(require("members.manage"))):
    email = body.email.lower()
    if body.role == "admin" and ctx.role != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only an owner can invite admins.")
    existing_member = ctx.db.scalar(
        select(OrganizationMember)
        .join(User, User.id == OrganizationMember.user_id)
        .where(
            OrganizationMember.organization_id == ctx.org_id,
            func.lower(User.email) == email,
            OrganizationMember.is_active.is_(True),
        )
    )
    if existing_member:
        raise HTTPException(status.HTTP_409_CONFLICT, "That person is already a member of this workspace.")
    # Revoke any earlier pending invite for the same address.
    for old in ctx.db.scalars(
        select(Invitation).where(
            Invitation.organization_id == ctx.org_id,
            func.lower(Invitation.email) == email,
            Invitation.accepted_at.is_(None),
            Invitation.revoked_at.is_(None),
        )
    ):
        old.revoked_at = utcnow()
    token = new_token()
    inv = Invitation(
        organization_id=ctx.org_id,
        email=email,
        role=body.role,
        token_hash=hash_token(token),
        invited_by_id=ctx.user.id,
        expires_at=utcnow() + timedelta(days=get_settings().invitation_ttl_days),
    )
    ctx.db.add(inv)
    ctx.db.flush()
    audit.log(ctx, "member.invited", "invitation", inv.id, f"Invited {email} as {body.role}")
    ctx.db.commit()
    out = invitation_out(inv, ctx.user)
    # The token is returned exactly once; only its hash is stored.
    out["token"] = token
    return out


@router.delete("/organizations/current/invitations/{invitation_id}")
def revoke_invitation(invitation_id: str, ctx: Ctx = Depends(require("members.manage"))):
    inv = get_scoped(ctx, Invitation, invitation_id, label="Invitation")
    if inv.accepted_at:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This invitation was already accepted.")
    if not inv.revoked_at:
        inv.revoked_at = utcnow()
        audit.log(ctx, "member.invitation_revoked", "invitation", inv.id, f"Invitation for {inv.email} revoked")
        ctx.db.commit()
    return {"ok": True}
