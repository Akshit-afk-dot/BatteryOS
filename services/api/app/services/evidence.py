"""Builds the evidence pack a report is drafted from.

The pack is a frozen snapshot: each selected record gets a citation key
(B1, T1, M1, D1, N1, F1, C1) and its content is copied into the report, so an
approved report stays reproducible even if records change later.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from .. import domain, timeutil
from ..models import Battery, Dataset, Measurement, TechnicianNote, TestSession, Upload
from ..serializers import provenance_for

KIND_LABELS = {
    "measured": "Measured",
    "user_entered": "User-entered",
    "calculated": "Calculated from imported data",
    "external": "External test result",
    "model_estimate": "Model estimate",
}

PREFIX = {
    "battery_record": "B",
    "test_session": "T",
    "measurement": "M",
    "dataset": "D",
    "note": "N",
    "file": "F",
    "completeness": "C",
}
TYPE_ORDER = list(PREFIX)

INSPECTION_LABELS = dict(domain.INSPECTION_ITEMS)


def _iso(v) -> str | None:
    return v.isoformat() if v is not None else None


def candidates(ctx, battery: Battery, completeness_items: list[dict]) -> list[dict[str, Any]]:
    db, org, tz = ctx.db, ctx.org_id, ctx.org.timezone
    items: list[dict[str, Any]] = []

    prov = provenance_for(battery)
    items.append(
        {
            "ref": "battery",
            "type": "battery_record",
            "origin": "user_entered",
            "label": f"Battery record {battery.bos_id}",
            "summary": ", ".join(
                x
                for x in [
                    battery.chemistry if battery.chemistry != "unknown" else "chemistry unknown",
                    f"{battery.nominal_voltage_v:g} V" if battery.nominal_voltage_v else None,
                    f"{battery.rated_capacity_ah:g} Ah" if battery.rated_capacity_ah else None,
                    battery.pack_configuration,
                ]
                if x
            ),
            "default": True,
            "data": {
                "battery_id": battery.bos_id,
                "customer": battery.customer.name if battery.customer else None,
                "received_date": _iso(battery.received_date),
                "battery_type": battery.battery_type,
                "chemistry": battery.chemistry,
                "nominal_voltage_v": battery.nominal_voltage_v,
                "rated_capacity_ah": battery.rated_capacity_ah,
                "pack_configuration": battery.pack_configuration,
                "manufacturer": battery.manufacturer,
                "model": battery.model,
                "serial_number": battery.serial_number,
                "bms_info": battery.bms_info,
                "intake_condition": battery.intake_condition,
                "value_sources": prov,
            },
        }
    )

    sessions = db.scalars(
        select(TestSession)
        .where(TestSession.organization_id == org, TestSession.battery_id == battery.id)
        .order_by(TestSession.test_date, TestSession.created_at)
    ).all()
    for t in sessions:
        items.append(
            {
                "ref": f"test_session:{t.id}",
                "type": "test_session",
                "origin": "user_entered",
                "label": f"Test session: {t.test_type.replace('_', ' ')}",
                "summary": " · ".join(x for x in [_iso(t.test_date), t.equipment, t.operator_name] if x),
                "default": True,
                "data": {
                    "test_type": t.test_type,
                    "test_date": _iso(t.test_date),
                    "method": t.method,
                    "equipment": t.equipment,
                    "operator": t.operator_name,
                    "ambient_temp_c": t.ambient_temp_c,
                    "charge_current_a": t.charge_current_a,
                    "discharge_current_a": t.discharge_current_a,
                    "charge_voltage_v": t.charge_voltage_v,
                    "cutoff_voltage_v": t.cutoff_voltage_v,
                    "notes": t.notes,
                    "_id": t.id,
                },
            }
        )

    measurements = db.scalars(
        select(Measurement)
        .where(Measurement.organization_id == org, Measurement.battery_id == battery.id, Measurement.voided_at.is_(None))
        .order_by(Measurement.created_at)
    ).all()
    for m in measurements:
        value = f"{m.value_num:g} {m.unit or ''}".strip() if m.value_num is not None else (m.value_text or "")
        items.append(
            {
                "ref": f"measurement:{m.id}",
                "type": "measurement",
                "origin": m.kind,
                "label": f"{m.label}: {value}",
                "summary": KIND_LABELS.get(m.kind, m.kind) + (f" · {m.conditions}" if m.conditions else ""),
                "default": True,
                "data": {
                    "quantity": m.label,
                    "value": m.value_num,
                    "value_text": m.value_text,
                    "unit": m.unit,
                    "kind": m.kind,
                    "kind_label": KIND_LABELS.get(m.kind, m.kind),
                    "conditions": m.conditions,
                    "source": m.source_description,
                    "captured_on": _iso(m.captured_at),
                    "recorded_by": m.recorded_by.full_name if m.recorded_by else None,
                    "_test_session_id": m.test_session_id,
                },
            }
        )

    datasets = db.scalars(
        select(Dataset)
        .where(Dataset.organization_id == org, Dataset.battery_id == battery.id, Dataset.status == "active")
        .order_by(Dataset.imported_at)
    ).all()
    for d in datasets:
        issues = (d.validation or {}).get("issues", [])
        items.append(
            {
                "ref": f"dataset:{d.id}",
                "type": "dataset",
                "origin": "calculated",
                "label": f"Imported data: {d.upload.original_filename}",
                "summary": f"{d.imported_rows:,} rows · {len([i for i in issues if i['severity'] == 'warning'])} warning(s)",
                "default": True,
                "data": {
                    "file": d.upload.original_filename,
                    "file_sha256": d.upload.sha256,
                    "imported_rows": d.imported_rows,
                    "columns_mapped": [
                        {"column": m["column"], "field": m["field"], "unit": m["unit"]} for m in d.column_mapping
                    ],
                    "first_timestamp": (d.summary or {}).get("first_timestamp"),
                    "calculated_metrics": [
                        {"metric": x["label"], "value": x["value"], "unit": x["unit"], "method": x["method"]}
                        for x in (d.summary or {}).get("metrics", [])
                    ],
                    "validation_findings": [
                        {"severity": i["severity"], "code": i["code"], "message": i["message"]}
                        for i in issues
                        if i["severity"] in ("warning", "error")
                    ],
                    "upload_test_metadata": d.upload.test_metadata or {},
                    "_test_session_id": d.test_session_id,
                },
            }
        )

    notes = db.scalars(
        select(TechnicianNote)
        .where(TechnicianNote.organization_id == org, TechnicianNote.battery_id == battery.id)
        .order_by(TechnicianNote.created_at)
    ).all()
    for n in notes:
        checklist = [
            {
                "item": INSPECTION_LABELS.get(c["item"], c["item"].removeprefix("custom:")),
                "result": c["result"],
                "comment": c.get("comment"),
            }
            for c in (n.checklist or [])
        ]
        flagged = len([c for c in checklist if c["result"] == "issue"])
        items.append(
            {
                "ref": f"note:{n.id}",
                "type": "note",
                "origin": "technician",
                "label": f"{n.note_type.capitalize()} note by {n.author.full_name if n.author else 'unknown'}",
                "summary": " · ".join(
                    x for x in [f"{flagged} issue(s) flagged" if n.checklist else None, n.body[:120] if n.body else None] if x
                ),
                "default": True,
                "data": {
                    "note_type": n.note_type,
                    "author": n.author.full_name if n.author else None,
                    "written_on": _iso(timeutil.local_date(n.created_at, tz)),
                    "text": n.body,
                    "inspection_checklist": checklist or None,
                },
            }
        )

    files = db.scalars(
        select(Upload)
        .where(Upload.organization_id == org, Upload.battery_id == battery.id, Upload.kind != "csv")
        .order_by(Upload.uploaded_at)
    ).all()
    for f in files:
        items.append(
            {
                "ref": f"file:{f.id}",
                "type": "file",
                "origin": "user_entered",
                "label": f"{'Photo' if f.kind == 'photo' else 'Document'}: {f.original_filename}",
                "summary": f.description or "",
                "default": False,
                "data": {
                    "kind": f.kind,
                    "filename": f.original_filename,
                    "description": f.description,
                    "sha256": f.sha256,
                    "uploaded_on": _iso(timeutil.local_date(f.uploaded_at, tz)),
                    "note": "File content is not interpreted by the system; only this description is available.",
                },
            }
        )

    missing = [c for c in completeness_items if not c["done"]]
    items.append(
        {
            "ref": "completeness",
            "type": "completeness",
            "origin": "system",
            "label": "Record completeness check",
            "summary": f"{len(completeness_items) - len(missing)} of {len(completeness_items)} items recorded",
            "default": True,
            "data": {
                "recorded": [c["label"] for c in completeness_items if c["done"]],
                "missing": [c["label"] for c in missing],
            },
        }
    )
    return items


def build_pack(all_items: list[dict[str, Any]], include: list[str]) -> list[dict[str, Any]]:
    """Assign citation keys to the selected items and resolve cross references
    (measurement -> its test session key)."""
    wanted = set(include)
    selected = [i for i in all_items if i["ref"] in wanted]
    selected.sort(key=lambda i: TYPE_ORDER.index(i["type"]))
    counters: dict[str, int] = {}
    session_keys: dict[str, str] = {}
    for item in selected:
        p = PREFIX[item["type"]]
        counters[p] = counters.get(p, 0) + 1
        item["key"] = f"{p}{counters[p]}"
        if item["type"] == "test_session":
            session_keys[item["data"]["_id"]] = item["key"]
    for item in selected:
        data = item["data"]
        sid = data.pop("_test_session_id", None)
        if item["type"] in ("measurement", "dataset"):
            data["test_session"] = session_keys.get(sid) if sid else None
        data.pop("_id", None)
    return selected


def for_model(pack: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """What the language model sees: keys, record types, origins and data only."""
    return [
        {"key": i["key"], "record_type": i["type"], "origin": i["origin"], "label": i["label"], "data": i["data"]}
        for i in pack
    ]
