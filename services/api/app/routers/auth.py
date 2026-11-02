from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import audit, domain
from ..config import get_settings
from ..db import get_db
from ..deps import Ctx, active_membership, get_ctx, get_session_user
from ..models import AuthSession, Invitation, Organization, OrganizationMember, User, utcnow
from ..schemas import (
    ChangePasswordIn,
    InviteAcceptIn,
    LoginIn,
    ProfileIn,
    SignupIn,
    SwitchOrgIn,
    WorkspaceCreateIn,
)
from ..security import (
    DUMMY_PASSWORD_HASH,
    hash_password,
    hash_token,
    login_limiter,
    new_token,
    signup_limiter,
    verify_password,
)
from ..serializers import org_out, user_brief
from ..services import llm

router = APIRouter(prefix="/api", tags=["auth"])


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _start_session(db: Session, response: Response, request: Request, user: User, org_id: str | None) -> None:
    settings = get_settings()
    token = new_token()
    db.add(
        AuthSession(
            user_id=user.id,
            token_hash=hash_token(token),
            current_organization_id=org_id,
            expires_at=utcnow() + timedelta(hours=settings.session_ttl_hours),
            user_agent=(request.headers.get("user-agent") or "")[:300],
            ip_address=_client_ip(request),
        )
    )
    user.last_login_at = utcnow()
    response.set_cookie(
        settings.session_cookie_name,
        token,
        max_age=settings.session_ttl_hours * 3600,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def _create_org(db: Session, user: User, name: str) -> Organization:
    org = Organization(
        name=name,
        quotation_terms=(
            "Prices are in INR and exclude any work not listed. Diagnostic findings are based on the tests "
            "listed in the accompanying report. This quotation is valid until the date shown."
        ),
    )
    db.add(org)
    db.flush()
    db.add(OrganizationMember(organization_id=org.id, user_id=user.id, role="owner"))
    audit.record(
        db,
        org_id=org.id,
        actor_id=user.id,
        action="organization.created",
        entity_type="organization",
        entity_id=org.id,
        summary=f"Workspace '{name}' created",
    )
    return org


def me_payload(ctx: Ctx) -> dict:
    memberships = ctx.db.scalars(
        select(OrganizationMember)
        .where(OrganizationMember.user_id == ctx.user.id, OrganizationMember.is_active.is_(True))
        .order_by(OrganizationMember.created_at)
    ).all()
    return {
        "user": user_brief(ctx.user),
        "organization": org_out(ctx.org),
        "role": ctx.role,
        "permissions": domain.permissions_for(ctx.role),
        "memberships": [
            {"organization_id": m.organization_id, "organization_name": m.organization.name, "role": m.role}
            for m in memberships
        ],
        "ai": {"configured": llm.is_configured(), "model": llm.model_name() if llm.is_configured() else None},
    }


@router.post("/auth/signup", status_code=201)
def signup(body: SignupIn, request: Request, response: Response, db: Session = Depends(get_db)):
    if not signup_limiter.hit(_client_ip(request)):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many sign-ups from this address. Try again later.")
    email = body.email.lower()
    if db.scalar(select(User).where(func.lower(User.email) == email)):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "An account with this email already exists. Sign in, then create another workspace from the workspace menu.",
        )
    user = User(email=email, full_name=body.full_name, password_hash=hash_password(body.password))
    db.add(user)
    db.flush()
    org = _create_org(db, user, body.organization_name)
    _start_session(db, response, request, user, org.id)
    db.commit()
    return {"ok": True, "organization_id": org.id}


@router.post("/auth/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    email = body.email.lower()
    key = f"{_client_ip(request)}|{email}"
    if not login_limiter.hit(key):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many sign-in attempts. Wait 15 minutes and try again.")
    user = db.scalar(select(User).where(func.lower(User.email) == email))
    valid = verify_password(body.password, user.password_hash if user else DUMMY_PASSWORD_HASH)
    if not user or not valid or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Email or password is incorrect.")
    login_limiter.reset(key)
    member = db.scalar(
        select(OrganizationMember)
        .where(OrganizationMember.user_id == user.id, OrganizationMember.is_active.is_(True))
        .order_by(OrganizationMember.created_at)
    )
    last = db.scalar(
        select(AuthSession.current_organization_id)
        .where(AuthSession.user_id == user.id, AuthSession.current_organization_id.is_not(None))
        .order_by(AuthSession.created_at.desc())
    )
    org_id = last if last and active_membership(db, user.id, last) else (member.organization_id if member else None)
    _start_session(db, response, request, user, org_id)
    if org_id:
        audit.record(
            db, org_id=org_id, actor_id=user.id, action="user.signed_in", entity_type="user", entity_id=user.id,
            summary=f"{user.full_name} signed in",
        )
    db.commit()
    return {"ok": True}


@router.post("/auth/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    settings = get_settings()
    token = request.cookies.get(settings.session_cookie_name)
    if token:
        sess = db.scalar(select(AuthSession).where(AuthSession.token_hash == hash_token(token)))
        if sess and sess.revoked_at is None:
            sess.revoked_at = utcnow()
            db.commit()
    response.delete_cookie(settings.session_cookie_name, path="/")
    return {"ok": True}


@router.get("/auth/me")
def me(ctx: Ctx = Depends(get_ctx)):
    return me_payload(ctx)


@router.post("/auth/switch-organization")
def switch_org(body: SwitchOrgIn, session_user=Depends(get_session_user), db: Session = Depends(get_db)):
    sess, user = session_user
    if active_membership(db, user.id, body.organization_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workspace not found.")
    sess.current_organization_id = body.organization_id
    db.commit()
    return {"ok": True}


@router.post("/auth/password")
def change_password(body: ChangePasswordIn, ctx: Ctx = Depends(get_ctx)):
    if not verify_password(body.current_password, ctx.user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect.")
    ctx.user.password_hash = hash_password(body.new_password)
    # Sign out every other session.
    for s in ctx.db.scalars(
        select(AuthSession).where(AuthSession.user_id == ctx.user.id, AuthSession.id != ctx.session.id)
    ):
        s.revoked_at = s.revoked_at or utcnow()
    audit.log(ctx, "user.password_changed", "user", ctx.user.id, f"{ctx.user.full_name} changed their password")
    ctx.db.commit()
    return {"ok": True}


@router.patch("/auth/profile")
def update_profile(body: ProfileIn, ctx: Ctx = Depends(get_ctx)):
    ctx.user.full_name = body.full_name
    ctx.db.commit()
    return me_payload(ctx)


@router.post("/organizations", status_code=201)
def create_additional_workspace(
    body: WorkspaceCreateIn, session_user=Depends(get_session_user), db: Session = Depends(get_db)
):
    sess, user = session_user
    org = _create_org(db, user, body.name)
    sess.current_organization_id = org.id
    db.commit()
    return {"ok": True, "organization_id": org.id}


# --------------------------------------------------------------------------- invitations (public)


def _load_invitation(db: Session, token: str) -> Invitation:
    inv = db.scalar(select(Invitation).where(Invitation.token_hash == hash_token(token)))
    if inv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This invitation link is not valid.")
    return inv


def _invitation_problem(inv: Invitation) -> str | None:
    if inv.revoked_at:
        return "This invitation was revoked."
    if inv.accepted_at:
        return "This invitation has already been used."
    if inv.expires_at <= utcnow():
        return "This invitation has expired. Ask for a new one."
    return None


@router.get("/invitations/{token}")
def view_invitation(token: str, db: Session = Depends(get_db)):
    inv = _load_invitation(db, token)
    org = db.get(Organization, inv.organization_id)
    problem = _invitation_problem(inv)
    existing = db.scalar(select(User).where(func.lower(User.email) == inv.email.lower())) is not None
    return {
        "organization_name": org.name if org else None,
        "email": inv.email,
        "role": inv.role,
        "valid": problem is None,
        "problem": problem,
        "existing_user": existing,
        "expires_at": inv.expires_at,
    }


@router.post("/invitations/{token}/accept")
def accept_invitation(
    token: str, body: InviteAcceptIn, request: Request, response: Response, db: Session = Depends(get_db)
):
    inv = _load_invitation(db, token)
    problem = _invitation_problem(inv)
    if problem:
        raise HTTPException(status.HTTP_410_GONE, problem)
    if not login_limiter.hit(f"invite|{_client_ip(request)}"):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many attempts. Try again later.")
    user = db.scalar(select(User).where(func.lower(User.email) == inv.email.lower()))
    if user:
        if not verify_password(body.password, user.password_hash):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Password is incorrect for the existing account.")
    else:
        if not body.full_name:
            raise HTTPException(422, "Enter your full name.")
        if len(body.password) < 10:
            raise HTTPException(422, "Password must be at least 10 characters.")
        user = User(email=inv.email.lower(), full_name=body.full_name, password_hash=hash_password(body.password))
        db.add(user)
        db.flush()
    member = db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == inv.organization_id, OrganizationMember.user_id == user.id
        )
    )
    if member:
        member.is_active = True
        if member.role != "owner":
            member.role = inv.role
    else:
        db.add(OrganizationMember(organization_id=inv.organization_id, user_id=user.id, role=inv.role))
    inv.accepted_at = utcnow()
    audit.record(
        db,
        org_id=inv.organization_id,
        actor_id=user.id,
        action="member.joined",
        entity_type="user",
        entity_id=user.id,
        summary=f"{user.full_name} joined as {inv.role}",
        details={"invitation_id": inv.id},
    )
    _start_session(db, response, request, user, inv.organization_id)
    db.commit()
    return {"ok": True}
