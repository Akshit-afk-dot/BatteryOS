"""Test sessions, summary measurements and technician notes."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from .. import audit, domain, timeutil
from ..deps import Ctx, get_scoped, get_scoped_optional, require
from ..models import Battery, Dataset, Measurement, TechnicianNote, TestSession, Upload, utcnow
from ..schemas import MeasurementIn, NoteIn, NoteUpdateIn, TestSessionIn, VoidIn
from ..serializers import measurement_out, note_out, test_session_out

router = APIRouter(prefix="/api", tags=["technical"])


def _same_battery(obj, battery: Battery, label: str) -> None:
    if obj is not None and obj.battery_id != battery.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"That {label} belongs to a different battery.")


# --------------------------------------------------------------------------- test sessions


@router.get("/batteries/{battery_id}/test-sessions")
def list_test_sessions(battery_id: str, ctx: Ctx = Depends(require("records.view"))):
    b = get_scoped(ctx, Battery, battery_id, label="Battery")
    sessions = ctx.db.scalars(
        select(TestSession)
        .where(TestSession.organization_id == ctx.org_id, TestSession.battery_id == b.id)
        .order_by(TestSession.test_date.desc().nulls_last(), TestSession.created_at.desc())
    ).all()
    return [test_session_out(t) for t in sessions]


@router.post("/batteries/{battery_id}/test-sessions", status_code=201)
def create_test_session(battery_id: str, body: TestSessionIn, ctx: Ctx = Depends(require("tests.write"))):
    b = get_scoped(ctx, Battery, battery_id, label="Battery")
    t = TestSession(organization_id=ctx.org_id, battery_id=b.id, created_by_id=ctx.user.id, **body.model_dump())
    if t.test_date is None:
        t.test_date = timeutil.today(ctx.org.timezone)
    if not t.operator_name:
        t.operator_name = ctx.user.full_name
    ctx.db.add(t)
    ctx.db.flush()
    audit.log(
        ctx, "test_session.created", "test_session", t.id,
        f"Test session recorded: {body.test_type.replace('_', ' ')}", battery_id=b.id,
        details=body.model_dump(mode="json", exclude_none=True),
    )
    ctx.db.commit()
    ctx.db.refresh(t)
    return test_session_out(t)


@router.patch("/test-sessions/{session_id}")
def update_test_session(session_id: str, body: TestSessionIn, ctx: Ctx = Depends(require("tests.write"))):
    t = get_scoped(ctx, TestSession, session_id, label="Test session")
    data = body.model_dump()
    before = {k: getattr(t, k) for k in data}
    for k, v in data.items():
        setattr(t, k, v)
    delta = audit.diff(before, data)
    if delta:
        audit.log(ctx, "test_session.updated", "test_session", t.id, "Test session details updated", battery_id=t.battery_id, details=delta)
    ctx.db.commit()
    return test_session_out(t)


# --------------------------------------------------------------------------- measurements


@router.get("/batteries/{battery_id}/measurements")
def list_measurements(battery_id: str, include_voided: bool = True, ctx: Ctx = Depends(require("records.view"))):
    b = get_scoped(ctx, Battery, battery_id, label="Battery")
    stmt = select(Measurement).where(Measurement.organization_id == ctx.org_id, Measurement.battery_id == b.id)
    if not include_voided:
        stmt = stmt.where(Measurement.voided_at.is_(None))
    return [measurement_out(m) for m in ctx.db.scalars(stmt.order_by(Measurement.created_at.desc()))]


@router.post("/batteries/{battery_id}/measurements", status_code=201)
def create_measurement(battery_id: str, body: MeasurementIn, ctx: Ctx = Depends(require("tests.write"))):
    b = get_scoped(ctx, Battery, battery_id, label="Battery")
    ts = get_scoped_optional(ctx, TestSession, body.test_session_id, label="Test session")
    _same_battery(ts, b, "test session")
    up = get_scoped_optional(ctx, Upload, body.source_upload_id, label="File")
    _same_battery(up, b, "file")
    if body.value_num is None and not body.value_text:
        raise HTTPException(422, "Enter a numeric value or a text result.")
    if body.kind in ("external", "model_estimate") and not body.source_description:
        raise HTTPException(
            422,
            "External results and model estimates must state their source "
            "(lab or report reference, or model name, version and validated conditions).",
        )
    if body.kind == "measured" and ts is None:
        raise HTTPException(
            422,
            "Measured values must be linked to the test session that produced them, so test conditions are recorded.",
        )
    preset = domain.MEASUREMENT_NAMES[body.name]
    if body.name == "other" and not body.label:
        raise HTTPException(422, "Give a label for this measurement.")
    m = Measurement(
        organization_id=ctx.org_id,
        battery_id=b.id,
        test_session_id=ts.id if ts else None,
        source_upload_id=up.id if up else None,
        name=body.name,
        label=body.label or preset["label"],
        value_num=body.value_num,
        value_text=body.value_text,
        unit=body.unit if body.unit is not None else preset["unit"],
        kind=body.kind,
        source_description=body.source_description,
        conditions=body.conditions,
        captured_at=body.captured_at or (ts.test_date if ts else timeutil.today(ctx.org.timezone)),
        recorded_by_id=ctx.user.id,
    )
    ctx.db.add(m)
    ctx.db.flush()
    value = f"{m.value_num:g} {m.unit or ''}".strip() if m.value_num is not None else m.value_text
    audit.log(
        ctx, "measurement.recorded", "measurement", m.id, f"{m.label}: {value} ({m.kind.replace('_', ' ')})",
        battery_id=b.id, details={"kind": m.kind, "value_num": m.value_num, "value_text": m.value_text, "unit": m.unit},
    )
    ctx.db.commit()
    ctx.db.refresh(m)
    return measurement_out(m)


@router.post("/measurements/{measurement_id}/void")
def void_measurement(measurement_id: str, body: VoidIn, ctx: Ctx = Depends(require("measurements.void"))):
    """Measurements are never edited or deleted. A wrong value is voided with a
    reason and stays visible in history; the correct value is recorded anew."""
    m = get_scoped(ctx, Measurement, measurement_id, label="Measurement")
    if m.kind == "calculated":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Calculated values come from an import; re-import the file instead.")
    if m.voided_at:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This measurement is already voided.")
    m.voided_at = utcnow()
    m.voided_by_id = ctx.user.id
    m.void_reason = body.reason
    audit.log(ctx, "measurement.voided", "measurement", m.id, f"Voided {m.label}: {body.reason}", battery_id=m.battery_id)
    ctx.db.commit()
    return measurement_out(m)


# --------------------------------------------------------------------------- notes


@router.get("/batteries/{battery_id}/notes")
def list_notes(battery_id: str, ctx: Ctx = Depends(require("records.view"))):
    b = get_scoped(ctx, Battery, battery_id, label="Battery")
    notes = ctx.db.scalars(
        select(TechnicianNote)
        .where(TechnicianNote.organization_id == ctx.org_id, TechnicianNote.battery_id == b.id)
        .order_by(TechnicianNote.created_at.desc())
    ).all()
    return [note_out(n) for n in notes]


def _check_checklist(note_type: str, checklist) -> list[dict] | None:
    if checklist is None:
        return None
    keys = {k for k, _ in domain.INSPECTION_ITEMS}
    items = [c.model_dump() for c in checklist]
    for c in items:
        if c["item"] not in keys and not c["item"].startswith("custom:"):
            raise HTTPException(422, f"Unknown inspection item '{c['item']}'.")
    if note_type != "inspection":
        raise HTTPException(422, "Only inspection notes can have a checklist.")
    return items


@router.post("/batteries/{battery_id}/notes", status_code=201)
def create_note(battery_id: str, body: NoteIn, ctx: Ctx = Depends(require("notes.write"))):
    b = get_scoped(ctx, Battery, battery_id, label="Battery")
    ts = get_scoped_optional(ctx, TestSession, body.test_session_id, label="Test session")
    _same_battery(ts, b, "test session")
    if body.note_type in ("inspection", "review") and not ctx.can("tests.write"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Inspection and review notes are recorded by technicians.")
    checklist = _check_checklist(body.note_type, body.checklist)
    if not body.body.strip() and not checklist:
        raise HTTPException(422, "The note is empty.")
    n = TechnicianNote(
        organization_id=ctx.org_id,
        battery_id=b.id,
        test_session_id=ts.id if ts else None,
        note_type=body.note_type,
        body=body.body,
        checklist=checklist,
        author_id=ctx.user.id,
    )
    ctx.db.add(n)
    ctx.db.flush()
    issues = [c for c in (checklist or []) if c["result"] == "issue"]
    summary = f"{body.note_type.capitalize()} note added"
    if checklist is not None:
        summary += f" ({len(issues)} issue(s) flagged)"
    audit.log(ctx, "note.created", "note", n.id, summary, battery_id=b.id)
    ctx.db.commit()
    ctx.db.refresh(n)
    return note_out(n)


@router.patch("/notes/{note_id}")
def update_note(note_id: str, body: NoteUpdateIn, ctx: Ctx = Depends(require("notes.write"))):
    n = get_scoped(ctx, TechnicianNote, note_id, label="Note")
    if n.author_id != ctx.user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the author can edit a note. Add a new note instead.")
    data = body.model_dump(exclude_unset=True)
    before = {"body": n.body, "checklist": n.checklist}
    if "checklist" in data:
        n.checklist = _check_checklist(n.note_type, body.checklist)
    if "body" in data and data["body"] is not None:
        n.body = data["body"]
    audit.log(
        ctx, "note.edited", "note", n.id, f"{n.note_type.capitalize()} note edited", battery_id=n.battery_id,
        details={"before": before},
    )
    ctx.db.commit()
    ctx.db.refresh(n)
    return note_out(n)


@router.get("/batteries/{battery_id}/calculated")
def calculated_values(battery_id: str, ctx: Ctx = Depends(require("records.view"))):
    """Calculated summary metrics from active datasets, with their methods."""
    b = get_scoped(ctx, Battery, battery_id, label="Battery")
    datasets = ctx.db.scalars(
        select(Dataset).where(Dataset.organization_id == ctx.org_id, Dataset.battery_id == b.id, Dataset.status == "active")
    ).all()
    return [
        {"dataset_id": d.id, "file": d.upload.original_filename, "metrics": (d.summary or {}).get("metrics", [])}
        for d in datasets
    ]
