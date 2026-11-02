"""Request context, authentication, authorization and tenant scoping."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from typing import TypeVar

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import Base, get_db
from .domain import role_can
from .models import AuthSession, Organization, OrganizationMember, User, utcnow
from .security import hash_token

T = TypeVar("T", bound=Base)


@dataclass
class Ctx:
    """Everything a handler needs to act on behalf of the signed-in user."""

    db: Session
    user: User
    session: AuthSession
    org: Organization
    member: OrganizationMember

    @property
    def role(self) -> str:
        return self.member.role

    @property
    def org_id(self) -> str:
        return self.org.id

    def can(self, permission: str) -> bool:
        return role_can(self.member.role, permission)

    def require(self, permission: str) -> None:
        if not self.can(permission):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"Your role ({self.member.role}) does not allow this action ({permission}).",
            )


def _load_session(request: Request, db: Session) -> AuthSession | None:
    token = request.cookies.get(get_settings().session_cookie_name)
    if not token:
        return None
    sess = db.scalar(select(AuthSession).where(AuthSession.token_hash == hash_token(token)))
    if sess is None or sess.revoked_at is not None or sess.expires_at <= utcnow():
        return None
    return sess


def get_session_user(request: Request, db: Session = Depends(get_db)) -> tuple[AuthSession, User]:
    sess = _load_session(request, db)
    if sess is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in.")
    user = db.get(User, sess.user_id)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account disabled.")
    now = utcnow()
    if sess.last_seen_at is None or now - sess.last_seen_at > timedelta(minutes=5):
        sess.last_seen_at = now
        db.commit()
    return sess, user


def active_membership(db: Session, user_id: str, org_id: str | None) -> OrganizationMember | None:
    if not org_id:
        return None
    return db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.user_id == user_id,
            OrganizationMember.organization_id == org_id,
            OrganizationMember.is_active.is_(True),
        )
    )


def first_membership(db: Session, user_id: str) -> OrganizationMember | None:
    return db.scalar(
        select(OrganizationMember)
        .where(OrganizationMember.user_id == user_id, OrganizationMember.is_active.is_(True))
        .order_by(OrganizationMember.created_at)
    )


def get_ctx(
    session_user: tuple[AuthSession, User] = Depends(get_session_user), db: Session = Depends(get_db)
) -> Ctx:
    sess, user = session_user
    member = active_membership(db, user.id, sess.current_organization_id)
    if member is None:
        # Fall back to any remaining active membership (e.g. after removal from a workspace).
        member = first_membership(db, user.id)
        if member is None:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You are not a member of any workspace.")
        sess.current_organization_id = member.organization_id
        db.commit()
    return Ctx(db=db, user=user, session=sess, org=member.organization, member=member)


def require(permission: str):
    """Dependency factory: `ctx: Ctx = Depends(require("reports.approve"))`."""

    def _dep(ctx: Ctx = Depends(get_ctx)) -> Ctx:
        ctx.require(permission)
        return ctx

    return _dep


def get_scoped(ctx: Ctx, model: type[T], obj_id: str, *, label: str | None = None) -> T:
    """Load a business record by id, restricted to the caller's organization.

    Returns 404 (not 403) for records in other workspaces so that their
    existence is not revealed."""
    obj = ctx.db.scalar(
        select(model).where(model.id == obj_id, model.organization_id == ctx.org_id)  # type: ignore[attr-defined]
    )
    if obj is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{label or model.__name__} not found.")
    return obj


def get_scoped_optional(ctx: Ctx, model: type[T], obj_id: str | None, *, label: str | None = None) -> T | None:
    if not obj_id:
        return None
    return get_scoped(ctx, model, obj_id, label=label)
