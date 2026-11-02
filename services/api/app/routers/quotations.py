from __future__ import annotations

from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import or_, select

from .. import audit, timeutil
from ..deps import Ctx, get_scoped, get_scoped_optional, require
from ..models import (
    Battery,
    CatalogueItem,
    Customer,
    DiagnosticReport,
    Quotation,
    QuotationLine,
    QuotationRevision,
    utcnow,
)
from ..schemas import CatalogueItemIn, QuotationCreateIn, QuotationStatusIn, QuotationUpdateIn
from ..serializers import battery_out, catalogue_item_out, customer_out, org_out, quotation_out
from ..services import llm, pdf
from ..services.quotation_drafter import STARTER_CATALOGUE, ai_lines, line_amounts, template_lines
from ..services.records import advance_status_if_allowed, next_quotation_number

router = APIRouter(prefix="/api", tags=["quotations"])


# --------------------------------------------------------------------------- catalogue


@router.get("/catalogue")
def list_catalogue(include_inactive: bool = True, ctx: Ctx = Depends(require("records.view"))):
    stmt = select(CatalogueItem).where(CatalogueItem.organization_id == ctx.org_id)
    if not include_inactive:
        stmt = stmt.where(CatalogueItem.is_active.is_(True))
    return [catalogue_item_out(c) for c in ctx.db.scalars(stmt.order_by(CatalogueItem.category, CatalogueItem.code))]


def _code_taken(ctx: Ctx, code: str, exclude_id: str | None = None) -> bool:
    stmt = select(CatalogueItem.id).where(CatalogueItem.organization_id == ctx.org_id, CatalogueItem.code == code)
    if exclude_id:
        stmt = stmt.where(CatalogueItem.id != exclude_id)
    return ctx.db.scalar(stmt) is not None


@router.post("/catalogue", status_code=201)
def create_catalogue_item(body: CatalogueItemIn, ctx: Ctx = Depends(require("catalogue.manage"))):
    if _code_taken(ctx, body.code):
        raise HTTPException(status.HTTP_409_CONFLICT, f"Code '{body.code}' is already used.")
    c = CatalogueItem(organization_id=ctx.org_id, **body.model_dump())
    ctx.db.add(c)
    ctx.db.flush()
    audit.log(ctx, "catalogue.created", "catalogue_item", c.id, f"Catalogue item {c.code} added at {pdf.inr(c.unit_price_paise)} per {c.unit}")
    ctx.db.commit()
    return catalogue_item_out(c)


@router.patch("/catalogue/{item_id}")
def update_catalogue_item(item_id: str, body: CatalogueItemIn, ctx: Ctx = Depends(require("catalogue.manage"))):
    c = get_scoped(ctx, CatalogueItem, item_id, label="Catalogue item")
    if _code_taken(ctx, body.code, exclude_id=c.id):
        raise HTTPException(status.HTTP_409_CONFLICT, f"Code '{body.code}' is already used.")
    data = body.model_dump()
    before = {k: getattr(c, k) for k in data}
    for k, v in data.items():
        setattr(c, k, v)
    delta = audit.diff(before, data)
    if delta:
        audit.log(ctx, "catalogue.updated", "catalogue_item", c.id, f"Catalogue item {c.code} updated", details=delta)
    ctx.db.commit()
    return catalogue_item_out(c)


@router.post("/catalogue/starter", status_code=201)
def load_starter_catalogue(ctx: Ctx = Depends(require("catalogue.manage"))):
    """Adds example items with EXAMPLE prices. The UI tells the user to review them."""
    added = []
    for item in STARTER_CATALOGUE:
        if _code_taken(ctx, item["code"]):
            continue
        c = CatalogueItem(organization_id=ctx.org_id, tax_rate_bp=1800, **item)
        ctx.db.add(c)
        added.append(c)
    if added:
        audit.log(
            ctx, "catalogue.starter_loaded", "catalogue_item", None,
            f"Loaded {len(added)} starter catalogue items with example prices",
        )
    ctx.db.commit()
    return {"added": len(added)}


# --------------------------------------------------------------------------- quotations


def _recalc(q: Quotation) -> None:
    sub = tax = 0
    for line in q.lines:
        line.line_subtotal_paise, line.line_tax_paise, line.line_total_paise = line_amounts(
            line.quantity, line.unit_price_paise, line.tax_rate_bp
        )
        sub += line.line_subtotal_paise
        tax += line.line_tax_paise
    q.subtotal_paise, q.tax_paise, q.total_paise = sub, tax, sub + tax


def _snapshot(q: Quotation) -> dict:
    data = quotation_out(q)
    data.pop("battery", None)
    return {k: (v.isoformat() if hasattr(v, "isoformat") else v) for k, v in data.items()}


def _approved_report(ctx: Ctx, report_id: str | None, battery: Battery) -> DiagnosticReport | None:
    r = get_scoped_optional(ctx, DiagnosticReport, report_id, label="Report")
    if r is None:
        return None
    if r.battery_id != battery.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That report belongs to a different battery.")
    if r.status != "approved":
        raise HTTPException(status.HTTP_409_CONFLICT, "Quotations can only be based on an approved report.")
    return r


@router.get("/quotations")
def list_quotations(
    status_: list[str] | None = Query(default=None, alias="status"),
    battery_id: str | None = None,
    customer_id: str | None = None,
    q: str | None = Query(default=None, max_length=200),
    sort: Literal["created_desc", "updated_desc", "total_desc"] = "created_desc",
    ctx: Ctx = Depends(require("records.view")),
):
    stmt = (
        select(Quotation)
        .join(Battery, Battery.id == Quotation.battery_id)
        .outerjoin(Customer, Customer.id == Quotation.customer_id)
        .where(Quotation.organization_id == ctx.org_id)
    )
    if status_:
        stmt = stmt.where(Quotation.status.in_(status_))
    if battery_id:
        stmt = stmt.where(Quotation.battery_id == battery_id)
    if customer_id:
        stmt = stmt.where(Quotation.customer_id == customer_id)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Quotation.number.ilike(like), Battery.bos_id.ilike(like), Customer.name.ilike(like)))
    order = {
        "created_desc": Quotation.created_at.desc(),
        "updated_desc": Quotation.updated_at.desc(),
        "total_desc": Quotation.total_paise.desc(),
    }[sort]
    return [quotation_out(x, detail=False) for x in ctx.db.scalars(stmt.order_by(order).limit(500)).unique()]


@router.post("/quotations", status_code=201)
def create_quotation(body: QuotationCreateIn, ctx: Ctx = Depends(require("quotations.draft"))):
    b = get_scoped(ctx, Battery, body.battery_id, label="Battery")
    report = _approved_report(ctx, body.report_id, b)
    if body.use_ai and report is None:
        raise HTTPException(422, "Select an approved diagnostic report for the AI to draft from.")
    catalogue = ctx.db.scalars(select(CatalogueItem).where(CatalogueItem.organization_id == ctx.org_id)).all()
    by_id = {c.id: c for c in catalogue}
    drafted_by, draft_notes = "human", None
    suggestions = template_lines(catalogue)
    if body.use_ai:
        if llm.is_configured():
            try:
                ai, draft_notes = ai_lines(report, battery_out(b, detail=True), catalogue)
                drafted_by = f"anthropic:{llm.model_name()}"
                # Keep catalogue defaults unless the AI already chose them.
                chosen = {line["catalogue_item_id"] for line in ai}
                suggestions = ai + [s for s in suggestions if s["catalogue_item_id"] not in chosen]
            except llm.AIError as e:
                drafted_by, draft_notes = "template", f"AI drafting failed ({e}). Only default catalogue items were added."
        else:
            drafted_by, draft_notes = "template", "AI drafting is not configured on this server. Only default catalogue items were added."
    elif suggestions:
        drafted_by = "template"

    today = timeutil.today(ctx.org.timezone)
    qt = Quotation(
        organization_id=ctx.org_id,
        number=next_quotation_number(ctx.db, ctx.org_id),
        battery_id=b.id,
        customer_id=b.customer_id,
        report_id=report.id if report else None,
        status="draft",
        revision=1,
        issue_date=today,
        valid_until=today + timedelta(days=ctx.org.quotation_validity_days or 15),
        terms=ctx.org.quotation_terms,
        drafted_by=drafted_by,
        draft_notes=draft_notes,
        created_by_id=ctx.user.id,
        updated_by_id=ctx.user.id,
    )
    for pos, s in enumerate(suggestions):
        c = by_id[s["catalogue_item_id"]]
        qt.lines.append(
            QuotationLine(
                organization_id=ctx.org_id,
                position=pos,
                catalogue_item_id=c.id,
                description=c.name,
                quantity=s["quantity"],
                unit=c.unit,
                unit_price_paise=c.unit_price_paise,
                tax_rate_bp=c.tax_rate_bp,
                origin=s["origin"],
                rationale=s["rationale"],
                line_subtotal_paise=0,
                line_tax_paise=0,
                line_total_paise=0,
            )
        )
    _recalc(qt)
    ctx.db.add(qt)
    ctx.db.flush()
    audit.log(
        ctx, "quotation.drafted", "quotation", qt.id,
        f"Quotation {qt.number} drafted ({drafted_by.split(':')[0]}) with {len(qt.lines)} line(s)",
        battery_id=b.id, details={"report_id": qt.report_id, "drafted_by": drafted_by},
    )
    ctx.db.commit()
    ctx.db.refresh(qt)
    return quotation_out(qt)


@router.get("/quotations/{quotation_id}")
def get_quotation(quotation_id: str, ctx: Ctx = Depends(require("records.view"))):
    qt = get_scoped(ctx, Quotation, quotation_id, label="Quotation")
    out = quotation_out(qt)
    revisions = ctx.db.scalars(
        select(QuotationRevision).where(QuotationRevision.quotation_id == qt.id).order_by(QuotationRevision.created_at.desc())
    ).all()
    out["revisions"] = [
        {"id": r.id, "revision": r.revision, "status": r.status, "reason": r.reason, "created_at": r.created_at, "total_paise": r.snapshot.get("total_paise")}
        for r in revisions
    ]
    out["battery"] = battery_out(qt.battery)
    if qt.report_id:
        r = ctx.db.get(DiagnosticReport, qt.report_id)
        out["report"] = {"id": r.id, "report_number": r.report_number, "version": r.version, "status": r.status} if r else None
    return out


@router.patch("/quotations/{quotation_id}")
def update_quotation(quotation_id: str, body: QuotationUpdateIn, ctx: Ctx = Depends(require("quotations.draft"))):
    qt = get_scoped(ctx, Quotation, quotation_id, label="Quotation")
    if qt.status != "draft":
        raise HTTPException(status.HTTP_409_CONFLICT, "Only draft quotations can be edited. Start a new revision first.")
    data = body.model_dump(exclude_unset=True)
    if "customer_id" in data:
        get_scoped_optional(ctx, Customer, data["customer_id"], label="Customer")
    before = _snapshot(qt)
    for k in ("customer_id", "valid_until", "issue_date", "notes", "terms"):
        if k in data:
            setattr(qt, k, data[k])
    if body.lines is not None:
        cat_ids = {line.catalogue_item_id for line in body.lines if line.catalogue_item_id}
        if cat_ids:
            found = set(
                ctx.db.scalars(select(CatalogueItem.id).where(CatalogueItem.organization_id == ctx.org_id, CatalogueItem.id.in_(cat_ids)))
            )
            if cat_ids - found:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "A line refers to an unknown catalogue item.")
        old = {(line.catalogue_item_id, line.description): line for line in qt.lines}
        qt.lines.clear()
        ctx.db.flush()
        for pos, line in enumerate(body.lines):
            prev = old.get((line.catalogue_item_id, line.description))
            # A line keeps its AI/template origin only while its content is unchanged.
            unchanged = prev is not None and (prev.quantity, prev.unit_price_paise, prev.tax_rate_bp, prev.unit) == (
                line.quantity, line.unit_price_paise, line.tax_rate_bp, line.unit
            )
            qt.lines.append(
                QuotationLine(
                    organization_id=ctx.org_id,
                    position=pos,
                    catalogue_item_id=line.catalogue_item_id,
                    description=line.description,
                    quantity=line.quantity,
                    unit=line.unit,
                    unit_price_paise=line.unit_price_paise,
                    tax_rate_bp=line.tax_rate_bp,
                    origin=prev.origin if unchanged else "human",
                    rationale=line.rationale if line.rationale is not None else (prev.rationale if prev else None),
                    line_subtotal_paise=0,
                    line_tax_paise=0,
                    line_total_paise=0,
                )
            )
    _recalc(qt)
    qt.updated_by_id = ctx.user.id
    after = _snapshot(qt)
    internal = {"updated_at", "lines", "subtotal_paise", "tax_paise", "total_paise"}
    changed = sorted(k.replace("_", " ") for k in after if after[k] != before.get(k) and k not in internal)
    if after.get("lines") != before.get("lines"):
        changed.append("lines")
    if after.get("total_paise") != before.get("total_paise"):
        changed.append("total")
    if changed:
        audit.log(
            ctx, "quotation.edited", "quotation", qt.id, f"Quotation {qt.number} edited ({', '.join(changed)})",
            battery_id=qt.battery_id, details={"total_before": before["total_paise"], "total_after": qt.total_paise},
        )
    ctx.db.commit()
    ctx.db.refresh(qt)
    return quotation_out(qt)


@router.post("/quotations/{quotation_id}/approve")
def approve_quotation(quotation_id: str, ctx: Ctx = Depends(require("quotations.approve"))):
    qt = get_scoped(ctx, Quotation, quotation_id, label="Quotation")
    if qt.status != "draft":
        raise HTTPException(status.HTTP_409_CONFLICT, f"Only draft quotations can be approved (this one is {qt.status}).")
    if not qt.lines:
        raise HTTPException(422, "Add at least one line before approving.")
    if qt.customer_id is None:
        raise HTTPException(422, "Choose the customer this quotation is for.")
    _recalc(qt)
    qt.status = "approved"
    qt.approved_by_id = ctx.user.id
    qt.approved_at = utcnow()
    qt.issue_date = qt.issue_date or timeutil.today(ctx.org.timezone)
    ctx.db.flush()
    ctx.db.add(
        QuotationRevision(
            organization_id=ctx.org_id, quotation_id=qt.id, revision=qt.revision, status="approved",
            snapshot=_snapshot(qt), reason="Approved", created_by_id=ctx.user.id,
        )
    )
    audit.log(
        ctx, "quotation.approved", "quotation", qt.id,
        f"Quotation {qt.number} rev {qt.revision} approved ({pdf.inr(qt.total_paise)} INR)", battery_id=qt.battery_id,
    )
    advance_status_if_allowed(ctx, qt.battery, "quoted", trigger=f"quotation {qt.number} approved")
    ctx.db.commit()
    ctx.db.refresh(qt)
    return quotation_out(qt)


STATUS_FLOW = {
    "sent": {"approved"},
    "accepted": {"approved", "sent"},
    "declined": {"approved", "sent"},
    "void": {"draft", "approved", "sent", "declined"},
}


@router.post("/quotations/{quotation_id}/status")
def set_quotation_status(quotation_id: str, body: QuotationStatusIn, ctx: Ctx = Depends(require("quotations.draft"))):
    qt = get_scoped(ctx, Quotation, quotation_id, label="Quotation")
    if body.status != "sent":
        ctx.require("quotations.approve")
    if qt.status not in STATUS_FLOW[body.status]:
        raise HTTPException(status.HTTP_409_CONFLICT, f"A {qt.status} quotation cannot be marked {body.status}.")
    previous = qt.status
    qt.status = body.status
    now = utcnow()
    if body.status == "sent":
        qt.sent_at = now
    elif body.status in ("accepted", "declined"):
        qt.decided_at = now
    ctx.db.add(
        QuotationRevision(
            organization_id=ctx.org_id, quotation_id=qt.id, revision=qt.revision, status=body.status,
            snapshot=_snapshot(qt), reason=body.reason or f"Marked {body.status}", created_by_id=ctx.user.id,
        )
    )
    audit.log(
        ctx, f"quotation.{body.status}", "quotation", qt.id, f"Quotation {qt.number} marked {body.status} (was {previous})",
        battery_id=qt.battery_id, details={"reason": body.reason},
    )
    if body.status == "accepted":
        advance_status_if_allowed(ctx, qt.battery, "approved", trigger=f"customer accepted {qt.number}")
    ctx.db.commit()
    ctx.db.refresh(qt)
    return quotation_out(qt)


@router.post("/quotations/{quotation_id}/revise")
def revise_quotation(quotation_id: str, ctx: Ctx = Depends(require("quotations.draft"))):
    qt = get_scoped(ctx, Quotation, quotation_id, label="Quotation")
    if qt.status not in ("approved", "sent", "declined"):
        raise HTTPException(status.HTTP_409_CONFLICT, f"A {qt.status} quotation cannot be revised.")
    ctx.db.add(
        QuotationRevision(
            organization_id=ctx.org_id, quotation_id=qt.id, revision=qt.revision, status=qt.status,
            snapshot=_snapshot(qt), reason="Superseded by a new revision", created_by_id=ctx.user.id,
        )
    )
    qt.revision += 1
    qt.status = "draft"
    qt.approved_by_id = None
    qt.approved_at = None
    qt.sent_at = None
    qt.decided_at = None
    qt.updated_by_id = ctx.user.id
    audit.log(ctx, "quotation.revision_started", "quotation", qt.id, f"Quotation {qt.number} revision {qt.revision} started", battery_id=qt.battery_id)
    ctx.db.commit()
    ctx.db.refresh(qt)
    return quotation_out(qt)


@router.get("/quotations/{quotation_id}/revisions/{revision_id}")
def get_revision(quotation_id: str, revision_id: str, ctx: Ctx = Depends(require("records.view"))):
    qt = get_scoped(ctx, Quotation, quotation_id, label="Quotation")
    rev = get_scoped(ctx, QuotationRevision, revision_id, label="Revision")
    if rev.quotation_id != qt.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Revision not found.")
    return {"id": rev.id, "revision": rev.revision, "status": rev.status, "reason": rev.reason, "created_at": rev.created_at, "snapshot": rev.snapshot}


@router.get("/quotations/{quotation_id}/pdf")
def quotation_pdf(quotation_id: str, ctx: Ctx = Depends(require("records.view"))):
    qt = get_scoped(ctx, Quotation, quotation_id, label="Quotation")
    customer = customer_out(qt.customer) if qt.customer else None
    report_number = None
    if qt.report_id:
        r = ctx.db.get(DiagnosticReport, qt.report_id)
        report_number = f"{r.report_number} v{r.version}" if r else None
    data = pdf.render_quotation(quotation_out(qt), org_out(ctx.org), battery_out(qt.battery, detail=True), customer, report_number)
    suffix = "" if qt.status in ("approved", "sent", "accepted") else "_DRAFT"
    return Response(
        content=data,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{qt.number}_rev{qt.revision}{suffix}.pdf"',
            "X-Content-Type-Options": "nosniff",
        },
    )
