"""ORM -> JSON-ready dicts for API responses."""

from __future__ import annotations

from typing import Any

from . import domain
from .models import (
    AuditEvent,
    Battery,
    BatteryBatch,
    CatalogueItem,
    Customer,
    Dataset,
    DiagnosticReport,
    Invitation,
    Measurement,
    Organization,
    OrganizationMember,
    Quotation,
    QuotationLine,
    ServiceEvent,
    TechnicianNote,
    TestSession,
    Upload,
    User,
)


def user_brief(u: User | None) -> dict[str, Any] | None:
    if u is None:
        return None
    return {"id": u.id, "full_name": u.full_name, "email": u.email}


def org_out(o: Organization) -> dict[str, Any]:
    return {
        "id": o.id,
        "name": o.name,
        "legal_name": o.legal_name,
        "address": o.address,
        "phone": o.phone,
        "email": o.email,
        "tax_id": o.tax_id,
        "currency": o.currency,
        "timezone": o.timezone,
        "battery_id_prefix": o.battery_id_prefix,
        "quotation_terms": o.quotation_terms,
        "quotation_validity_days": o.quotation_validity_days,
        "created_at": o.created_at,
    }


def member_out(m: OrganizationMember) -> dict[str, Any]:
    return {
        "id": m.id,
        "user_id": m.user_id,
        "full_name": m.user.full_name,
        "email": m.user.email,
        "role": m.role,
        "is_active": m.is_active,
        "created_at": m.created_at,
    }


def invitation_out(i: Invitation, invited_by: User | None = None) -> dict[str, Any]:
    return {
        "id": i.id,
        "email": i.email,
        "role": i.role,
        "created_at": i.created_at,
        "expires_at": i.expires_at,
        "accepted_at": i.accepted_at,
        "revoked_at": i.revoked_at,
        "invited_by": user_brief(invited_by),
    }


def customer_out(c: Customer, battery_count: int | None = None) -> dict[str, Any]:
    out = {
        "id": c.id,
        "name": c.name,
        "kind": c.kind,
        "contact_name": c.contact_name,
        "phone": c.phone,
        "email": c.email,
        "address": c.address,
        "tax_id": c.tax_id,
        "notes": c.notes,
        "created_at": c.created_at,
        "updated_at": c.updated_at,
    }
    if battery_count is not None:
        out["battery_count"] = battery_count
    return out


def customer_brief(c: Customer | None) -> dict[str, Any] | None:
    return {"id": c.id, "name": c.name} if c else None


def batch_out(b: BatteryBatch, battery_count: int | None = None) -> dict[str, Any]:
    out = {
        "id": b.id,
        "reference": b.reference,
        "customer": customer_brief(b.customer),
        "received_date": b.received_date,
        "description": b.description,
        "created_at": b.created_at,
    }
    if battery_count is not None:
        out["battery_count"] = battery_count
    return out


def battery_out(b: Battery, *, detail: bool = False) -> dict[str, Any]:
    out = {
        "id": b.id,
        "bos_id": b.bos_id,
        "status": b.status,
        "status_changed_at": b.status_changed_at,
        "customer": customer_brief(b.customer),
        "batch": {"id": b.batch.id, "reference": b.batch.reference} if b.batch else None,
        "received_date": b.received_date,
        "battery_type": b.battery_type,
        "chemistry": b.chemistry,
        "nominal_voltage_v": b.nominal_voltage_v,
        "rated_capacity_ah": b.rated_capacity_ah,
        "pack_configuration": b.pack_configuration,
        "manufacturer": b.manufacturer,
        "model": b.model,
        "serial_number": b.serial_number,
        "created_at": b.created_at,
        "updated_at": b.updated_at,
    }
    if detail:
        out.update(
            {
                "bms_info": b.bms_info,
                "intake_condition": b.intake_condition,
                "notes": b.notes,
                "warranty_expires_on": b.warranty_expires_on,
                "provenance": provenance_for(b),
                "allowed_transitions": sorted(domain.STATUS_TRANSITIONS.get(b.status, ())),
                "created_by_id": b.created_by_id,
            }
        )
    return out


def provenance_for(b: Battery) -> dict[str, str]:
    """Every provenance-tracked field gets an explicit source; values that are
    not recorded at all are reported as 'unknown' rather than omitted."""
    stored = b.provenance or {}
    out = {}
    for f in domain.PROVENANCE_FIELDS:
        value = getattr(b, f)
        if value is None or value == "unknown":
            out[f] = "unknown"
        else:
            out[f] = stored.get(f, "unverified")
    return out


def upload_out(u: Upload, datasets: list[Dataset] | None = None) -> dict[str, Any]:
    out = {
        "id": u.id,
        "battery_id": u.battery_id,
        "kind": u.kind,
        "original_filename": u.original_filename,
        "content_type": u.content_type,
        "size_bytes": u.size_bytes,
        "sha256": u.sha256,
        "description": u.description,
        "test_metadata": u.test_metadata or {},
        "test_session_id": u.test_session_id,
        "uploaded_by": user_brief(u.uploaded_by),
        "uploaded_at": u.uploaded_at,
    }
    if datasets is not None:
        out["datasets"] = [
            {"id": d.id, "status": d.status, "imported_at": d.imported_at, "imported_rows": d.imported_rows}
            for d in datasets
        ]
    return out


def dataset_out(d: Dataset) -> dict[str, Any]:
    return {
        "id": d.id,
        "battery_id": d.battery_id,
        "upload": {
            "id": d.upload.id,
            "original_filename": d.upload.original_filename,
            "sha256": d.upload.sha256,
            "uploaded_at": d.upload.uploaded_at,
        },
        "test_session_id": d.test_session_id,
        "status": d.status,
        "parser_config": d.parser_config,
        "column_mapping": d.column_mapping,
        "validation": d.validation,
        "acknowledged_warnings": d.acknowledged_warnings,
        "row_count": d.row_count,
        "imported_rows": d.imported_rows,
        "fields": d.fields,
        "summary": d.summary,
        "imported_by": user_brief(d.imported_by),
        "imported_at": d.imported_at,
    }


def test_session_out(t: TestSession) -> dict[str, Any]:
    return {
        "id": t.id,
        "battery_id": t.battery_id,
        "test_type": t.test_type,
        "test_date": t.test_date,
        "method": t.method,
        "equipment": t.equipment,
        "operator_name": t.operator_name,
        "ambient_temp_c": t.ambient_temp_c,
        "charge_current_a": t.charge_current_a,
        "discharge_current_a": t.discharge_current_a,
        "charge_voltage_v": t.charge_voltage_v,
        "cutoff_voltage_v": t.cutoff_voltage_v,
        "notes": t.notes,
        "created_by": user_brief(t.created_by),
        "created_at": t.created_at,
    }


def measurement_out(m: Measurement) -> dict[str, Any]:
    return {
        "id": m.id,
        "battery_id": m.battery_id,
        "test_session_id": m.test_session_id,
        "dataset_id": m.dataset_id,
        "source_upload_id": m.source_upload_id,
        "name": m.name,
        "label": m.label,
        "value_num": m.value_num,
        "value_text": m.value_text,
        "unit": m.unit,
        "kind": m.kind,
        "source_description": m.source_description,
        "conditions": m.conditions,
        "captured_at": m.captured_at,
        "recorded_by": user_brief(m.recorded_by),
        "created_at": m.created_at,
        "voided_at": m.voided_at,
        "void_reason": m.void_reason,
    }


def note_out(n: TechnicianNote) -> dict[str, Any]:
    return {
        "id": n.id,
        "battery_id": n.battery_id,
        "test_session_id": n.test_session_id,
        "note_type": n.note_type,
        "body": n.body,
        "checklist": n.checklist,
        "author": user_brief(n.author),
        "created_at": n.created_at,
        "updated_at": n.updated_at,
    }


def service_event_out(e: ServiceEvent) -> dict[str, Any]:
    return {
        "id": e.id,
        "battery_id": e.battery_id,
        "event_type": e.event_type,
        "description": e.description,
        "performed_by_name": e.performed_by_name,
        "performed_on": e.performed_on,
        "created_by": user_brief(e.created_by),
        "created_at": e.created_at,
    }


def report_out(r: DiagnosticReport, *, detail: bool = True) -> dict[str, Any]:
    out = {
        "id": r.id,
        "battery_id": r.battery_id,
        "report_number": r.report_number,
        "version": r.version,
        "previous_version_id": r.previous_version_id,
        "status": r.status,
        "title": r.title,
        "generator": r.generator,
        "generated_by": user_brief(r.generated_by),
        "generated_at": r.generated_at,
        "updated_at": r.updated_at,
        "approved_by": user_brief(r.approved_by),
        "approved_at": r.approved_at,
        "open_checks": len([c for c in (r.checks or []) if c.get("severity") != "info"]),
    }
    if detail:
        out.update(
            {
                "evidence": r.evidence,
                "sections": r.sections,
                "checks": r.checks,
                "reviewer_conclusion": r.reviewer_conclusion,
            }
        )
    return out


def catalogue_item_out(c: CatalogueItem) -> dict[str, Any]:
    return {
        "id": c.id,
        "code": c.code,
        "name": c.name,
        "description": c.description,
        "category": c.category,
        "unit": c.unit,
        "unit_price_paise": c.unit_price_paise,
        "tax_rate_bp": c.tax_rate_bp,
        "is_active": c.is_active,
        "default_on_quotes": c.default_on_quotes,
        "updated_at": c.updated_at,
    }


def quotation_line_out(line: QuotationLine) -> dict[str, Any]:
    return {
        "id": line.id,
        "position": line.position,
        "catalogue_item_id": line.catalogue_item_id,
        "description": line.description,
        "quantity": line.quantity,
        "unit": line.unit,
        "unit_price_paise": line.unit_price_paise,
        "tax_rate_bp": line.tax_rate_bp,
        "line_subtotal_paise": line.line_subtotal_paise,
        "line_tax_paise": line.line_tax_paise,
        "line_total_paise": line.line_total_paise,
        "origin": line.origin,
        "rationale": line.rationale,
    }


def quotation_out(q: Quotation, *, detail: bool = True) -> dict[str, Any]:
    out = {
        "id": q.id,
        "number": q.number,
        "status": q.status,
        "revision": q.revision,
        "battery": {"id": q.battery.id, "bos_id": q.battery.bos_id, "status": q.battery.status},
        "customer": customer_brief(q.customer),
        "report_id": q.report_id,
        "issue_date": q.issue_date,
        "valid_until": q.valid_until,
        "subtotal_paise": q.subtotal_paise,
        "tax_paise": q.tax_paise,
        "total_paise": q.total_paise,
        "drafted_by": q.drafted_by,
        "created_at": q.created_at,
        "updated_at": q.updated_at,
        "approved_by": user_brief(q.approved_by),
        "approved_at": q.approved_at,
        "sent_at": q.sent_at,
        "decided_at": q.decided_at,
    }
    if detail:
        out.update(
            {
                "notes": q.notes,
                "terms": q.terms,
                "draft_notes": q.draft_notes,
                "lines": [quotation_line_out(line) for line in q.lines],
            }
        )
    return out


def audit_out(e: AuditEvent) -> dict[str, Any]:
    return {
        "id": e.id,
        "action": e.action,
        "entity_type": e.entity_type,
        "entity_id": e.entity_id,
        "battery_id": e.battery_id,
        "summary": e.summary,
        "details": e.details,
        "actor": user_brief(e.actor),
        "created_at": e.created_at,
    }
