from __future__ import annotations

import copy

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select

from .. import audit
from ..deps import Ctx, get_scoped, require
from ..models import Battery, DiagnosticReport, utcnow
from ..schemas import ReportApproveIn, ReportDraftIn, ReportUpdateIn
from ..serializers import battery_out, org_out, report_out
from ..services import evidence as ev
from ..services import grounding, llm, pdf, report_drafter
from ..services.records import next_report_number
from .batteries import completeness

router = APIRouter(prefix="/api", tags=["reports"])

EDITED = {"ai": "ai_edited", "template": "template_edited"}


def _candidates(ctx: Ctx, b: Battery) -> list[dict]:
    return ev.candidates(ctx, b, completeness(ctx, b))


@router.get("/batteries/{battery_id}/evidence")
def evidence_candidates(battery_id: str, ctx: Ctx = Depends(require("records.view"))):
    b = get_scoped(ctx, Battery, battery_id, label="Battery")
    items = _candidates(ctx, b)
    return {
        "items": [{k: v for k, v in i.items() if k != "data"} for i in items],
        "ai": {"configured": llm.is_configured(), "model": llm.model_name() if llm.is_configured() else None},
    }


def _draft(ctx: Ctx, b: Battery, include: list[str], use_ai: bool) -> tuple[list[dict], list[dict], str, str | None]:
    items = _candidates(ctx, b)
    known = {i["ref"] for i in items}
    unknown = [r for r in include if r not in known]
    if unknown:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown evidence reference(s): {', '.join(unknown[:5])}")
    if "battery" not in include:
        include = ["battery", *include]
    pack = ev.build_pack(items, include)
    notice = None
    if use_ai and llm.is_configured():
        try:
            sections, generator = report_drafter.draft_with_ai(ev.for_model(pack))
        except llm.AIError as e:
            sections, generator = report_drafter.draft_with_template(pack)
            notice = f"AI drafting failed ({e}). A template draft was created instead."
    else:
        sections, generator = report_drafter.draft_with_template(pack)
        if use_ai:
            notice = "AI drafting is not configured on this server, so a template draft was created."
    return pack, sections, generator, notice


@router.post("/batteries/{battery_id}/report-drafts", status_code=201)
def create_report_draft(battery_id: str, body: ReportDraftIn, ctx: Ctx = Depends(require("reports.draft"))):
    b = get_scoped(ctx, Battery, battery_id, label="Battery")
    pack, sections, generator, notice = _draft(ctx, b, body.include, body.use_ai)
    r = DiagnosticReport(
        organization_id=ctx.org_id,
        battery_id=b.id,
        report_number=next_report_number(ctx.db, ctx.org_id),
        version=1,
        status="draft",
        title=body.title or f"Diagnostic report for {b.bos_id}",
        evidence=pack,
        sections=sections,
        checks=grounding.check_sections(sections, pack),
        generator=generator,
        generated_by_id=ctx.user.id,
        updated_by_id=ctx.user.id,
    )
    ctx.db.add(r)
    ctx.db.flush()
    audit.log(
        ctx, "report.drafted", "report", r.id,
        f"Report {r.report_number} drafted ({'AI-assisted' if generator != 'template' else 'template'}) from {len(pack)} record(s)",
        battery_id=b.id, details={"generator": generator, "evidence": [i["ref"] for i in pack]},
    )
    ctx.db.commit()
    ctx.db.refresh(r)
    out = report_out(r)
    out["notice"] = notice
    return out


@router.get("/batteries/{battery_id}/reports")
def list_reports(battery_id: str, ctx: Ctx = Depends(require("records.view"))):
    b = get_scoped(ctx, Battery, battery_id, label="Battery")
    reports = ctx.db.scalars(
        select(DiagnosticReport)
        .where(DiagnosticReport.organization_id == ctx.org_id, DiagnosticReport.battery_id == b.id)
        .order_by(DiagnosticReport.report_number.desc(), DiagnosticReport.version.desc())
    ).all()
    return [report_out(r, detail=False) for r in reports]


@router.get("/reports/{report_id}")
def get_report(report_id: str, ctx: Ctx = Depends(require("records.view"))):
    r = get_scoped(ctx, DiagnosticReport, report_id, label="Report")
    versions = ctx.db.scalars(
        select(DiagnosticReport)
        .where(DiagnosticReport.organization_id == ctx.org_id, DiagnosticReport.report_number == r.report_number)
        .order_by(DiagnosticReport.version.desc())
    ).all()
    out = report_out(r)
    out["versions"] = [{"id": v.id, "version": v.version, "status": v.status, "updated_at": v.updated_at} for v in versions]
    out["battery"] = battery_out(get_scoped(ctx, Battery, r.battery_id, label="Battery"))
    return out


def _require_draft(r: DiagnosticReport) -> None:
    if r.status != "draft":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Approved reports cannot be changed. Create a new revision to make corrections.",
        )


def _merge_sections(stored: list[dict], incoming: list[dict]) -> list[dict]:
    """Origins are decided here, not by the client: a section whose text or
    citations changed is marked as edited; new sections are human-written."""
    by_key = {s["key"]: s for s in stored}
    out = []
    for s in incoming:
        prev = by_key.get(s["key"])
        origin = prev["origin"] if prev else "human"
        if prev and [(p["text"], p["citations"]) for p in prev["paragraphs"]] != [
            (p["text"], p["citations"]) for p in s["paragraphs"]
        ]:
            origin = EDITED.get(prev["origin"], prev["origin"])
        out.append({"key": s["key"], "title": s["title"], "origin": origin, "paragraphs": s["paragraphs"]})
    return out


@router.patch("/reports/{report_id}")
def update_report(report_id: str, body: ReportUpdateIn, ctx: Ctx = Depends(require("reports.draft"))):
    r = get_scoped(ctx, DiagnosticReport, report_id, label="Report")
    _require_draft(r)
    changed = []
    if body.title is not None and body.title != r.title:
        r.title = body.title
        changed.append("title")
    if body.sections is not None:
        incoming = [s.model_dump() for s in body.sections]
        merged = _merge_sections(r.sections, incoming)
        if merged != r.sections:
            r.sections = merged
            changed.append("narrative")
    if body.reviewer_conclusion is not None and body.reviewer_conclusion != (r.reviewer_conclusion or ""):
        r.reviewer_conclusion = body.reviewer_conclusion
        changed.append("reviewer conclusion")
    r.checks = grounding.check_sections(r.sections, r.evidence, reviewer_conclusion=r.reviewer_conclusion)
    r.updated_by_id = ctx.user.id
    if changed:
        audit.log(ctx, "report.edited", "report", r.id, f"Report {r.report_number} v{r.version} edited: {', '.join(changed)}", battery_id=r.battery_id)
    ctx.db.commit()
    ctx.db.refresh(r)
    return report_out(r)


@router.post("/reports/{report_id}/regenerate")
def regenerate(report_id: str, body: ReportDraftIn, ctx: Ctx = Depends(require("reports.draft"))):
    r = get_scoped(ctx, DiagnosticReport, report_id, label="Report")
    _require_draft(r)
    b = get_scoped(ctx, Battery, r.battery_id, label="Battery")
    pack, sections, generator, notice = _draft(ctx, b, body.include, body.use_ai)
    r.evidence, r.sections, r.generator = pack, sections, generator
    r.checks = grounding.check_sections(sections, pack, reviewer_conclusion=r.reviewer_conclusion)
    r.generated_at = utcnow()
    r.generated_by_id = ctx.user.id
    audit.log(
        ctx, "report.regenerated", "report", r.id, f"Report {r.report_number} v{r.version} redrafted from {len(pack)} record(s)",
        battery_id=b.id, details={"generator": generator, "evidence": [i["ref"] for i in pack]},
    )
    ctx.db.commit()
    ctx.db.refresh(r)
    out = report_out(r)
    out["notice"] = notice
    return out


@router.post("/reports/{report_id}/approve")
def approve_report(report_id: str, body: ReportApproveIn, ctx: Ctx = Depends(require("reports.approve"))):
    r = get_scoped(ctx, DiagnosticReport, report_id, label="Report")
    _require_draft(r)
    if not (r.reviewer_conclusion or "").strip():
        raise HTTPException(422, "Write the reviewer conclusion before approving.")
    if not any(p["text"].strip() for s in r.sections for p in s["paragraphs"]):
        raise HTTPException(422, "The report has no narrative text.")
    r.checks = grounding.check_sections(r.sections, r.evidence, reviewer_conclusion=r.reviewer_conclusion)
    open_checks = [c for c in r.checks if c["severity"] == "warning"]
    if open_checks and not body.acknowledge_checks:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{len(open_checks)} flagged statement(s) need review. Fix them, or confirm you have checked them.",
        )
    r.status = "approved"
    r.approved_by_id = ctx.user.id
    r.approved_at = utcnow()
    for older in ctx.db.scalars(
        select(DiagnosticReport).where(
            DiagnosticReport.organization_id == ctx.org_id,
            DiagnosticReport.report_number == r.report_number,
            DiagnosticReport.id != r.id,
            DiagnosticReport.status == "approved",
        )
    ):
        older.status = "superseded"
    audit.log(
        ctx, "report.approved", "report", r.id, f"Report {r.report_number} v{r.version} approved by {ctx.user.full_name}",
        battery_id=r.battery_id,
        details={"acknowledged_checks": [c["code"] for c in open_checks], "generator": r.generator},
    )
    ctx.db.commit()
    ctx.db.refresh(r)
    return report_out(r)


@router.post("/reports/{report_id}/revise", status_code=201)
def revise_report(report_id: str, ctx: Ctx = Depends(require("reports.draft"))):
    r = get_scoped(ctx, DiagnosticReport, report_id, label="Report")
    if r.status == "draft":
        raise HTTPException(status.HTTP_409_CONFLICT, "This version is still a draft; edit it directly.")
    latest = ctx.db.scalar(
        select(DiagnosticReport)
        .where(DiagnosticReport.organization_id == ctx.org_id, DiagnosticReport.report_number == r.report_number)
        .order_by(DiagnosticReport.version.desc())
    )
    if latest.status == "draft":
        raise HTTPException(status.HTTP_409_CONFLICT, f"Version {latest.version} is already an open draft.")
    new = DiagnosticReport(
        organization_id=ctx.org_id,
        battery_id=r.battery_id,
        report_number=r.report_number,
        version=latest.version + 1,
        previous_version_id=r.id,
        status="draft",
        title=r.title,
        evidence=copy.deepcopy(r.evidence),
        sections=copy.deepcopy(r.sections),
        checks=copy.deepcopy(r.checks),
        reviewer_conclusion=r.reviewer_conclusion,
        generator=r.generator,
        generated_by_id=r.generated_by_id,
        updated_by_id=ctx.user.id,
    )
    ctx.db.add(new)
    ctx.db.flush()
    audit.log(ctx, "report.revision_started", "report", new.id, f"Revision v{new.version} of {r.report_number} started", battery_id=r.battery_id)
    ctx.db.commit()
    ctx.db.refresh(new)
    return report_out(new)


@router.get("/reports/{report_id}/pdf")
def report_pdf(report_id: str, ctx: Ctx = Depends(require("records.view"))):
    r = get_scoped(ctx, DiagnosticReport, report_id, label="Report")
    b = get_scoped(ctx, Battery, r.battery_id, label="Battery")
    data = pdf.render_report(report_out(r), org_out(ctx.org), battery_out(b, detail=True))
    suffix = "" if r.status == "approved" else "_DRAFT"
    return Response(
        content=data,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{r.report_number}_v{r.version}{suffix}.pdf"',
            "X-Content-Type-Options": "nosniff",
        },
    )
