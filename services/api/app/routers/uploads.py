from __future__ import annotations

import csv
import io
import json
import re
import unicodedata
from typing import Any

import numpy as np
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import JSONResponse
from sqlalchemy import insert, select

from .. import audit, storage
from ..config import get_settings
from ..deps import Ctx, get_scoped, get_scoped_optional, require
from ..models import Battery, Dataset, MeasurementPoint, TestSession, Upload
from ..schemas import ImportIn, PreviewIn, UploadUpdateIn
from ..serializers import dataset_out, upload_out
from ..services import csv_ingest

router = APIRouter(prefix="/api", tags=["uploads"])

CSV_EXT = {".csv", ".txt", ".tsv"}
IMAGE_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
PDF_EXT = {".pdf"}


def _safe_filename(name: str | None) -> str:
    name = (name or "upload").replace("\\", "/").split("/")[-1]
    name = "".join(ch for ch in unicodedata.normalize("NFC", name) if unicodedata.category(ch)[0] != "C")
    name = name.strip().strip(".") or "upload"
    return name[:255]


def _ext(name: str) -> str:
    m = re.search(r"(\.[A-Za-z0-9]{1,5})$", name)
    return m.group(1).lower() if m else ""


def _classify(name: str, data: bytes) -> tuple[str, str]:
    """Decide (kind, content_type) from extension AND content. Anything that
    does not match a known, safe format is rejected."""
    ext = _ext(name)
    if ext in IMAGE_TYPES:
        sig_ok = (
            (ext in (".jpg", ".jpeg") and data[:3] == b"\xff\xd8\xff")
            or (ext == ".png" and data[:8] == b"\x89PNG\r\n\x1a\n")
            or (ext == ".webp" and data[:4] == b"RIFF" and data[8:12] == b"WEBP")
        )
        if not sig_ok:
            raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "The file content does not match its image extension.")
        return "photo", IMAGE_TYPES[ext]
    if ext in PDF_EXT:
        if not data.startswith(b"%PDF-"):
            raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "The file is not a valid PDF.")
        return "document", "application/pdf"
    if ext in CSV_EXT:
        try:
            csv_ingest.decode(data)
        except csv_ingest.CsvError as e:
            raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, str(e)) from e
        return "csv", "text/csv"
    raise HTTPException(
        status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
        "Unsupported file type. Upload CSV (.csv, .txt, .tsv), photos (.jpg, .png, .webp) or PDF documents.",
    )


@router.get("/batteries/{battery_id}/uploads")
def list_uploads(battery_id: str, ctx: Ctx = Depends(require("records.view"))):
    b = get_scoped(ctx, Battery, battery_id, label="Battery")
    uploads = ctx.db.scalars(
        select(Upload).where(Upload.organization_id == ctx.org_id, Upload.battery_id == b.id).order_by(Upload.uploaded_at.desc())
    ).all()
    datasets = ctx.db.scalars(
        select(Dataset).where(Dataset.organization_id == ctx.org_id, Dataset.battery_id == b.id).order_by(Dataset.imported_at.desc())
    ).all()
    by_upload: dict[str, list[Dataset]] = {}
    for d in datasets:
        by_upload.setdefault(d.upload_id, []).append(d)
    return [upload_out(u, by_upload.get(u.id, [])) for u in uploads]


@router.post("/batteries/{battery_id}/uploads", status_code=201)
async def create_upload(
    battery_id: str,
    file: UploadFile = File(...),
    description: str | None = Form(default=None, max_length=2000),
    test_metadata: str | None = Form(default=None, max_length=5000),
    test_session_id: str | None = Form(default=None),
    ctx: Ctx = Depends(require("uploads.write")),
):
    b = get_scoped(ctx, Battery, battery_id, label="Battery")
    if test_session_id:
        ts = get_scoped(ctx, TestSession, test_session_id, label="Test session")
        if ts.battery_id != b.id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "That test session belongs to a different battery.")
    meta: dict[str, Any] = {}
    if test_metadata:
        try:
            meta = json.loads(test_metadata)
        except json.JSONDecodeError as e:
            raise HTTPException(422, "test_metadata must be a JSON object.") from e
        if not isinstance(meta, dict) or not all(isinstance(k, str) and isinstance(v, (str, int, float, bool, type(None))) for k, v in meta.items()):
            raise HTTPException(422, "test_metadata must be a flat JSON object of simple values.")
        meta = {k[:60]: (v[:500] if isinstance(v, str) else v) for k, v in list(meta.items())[:30]}

    limit = get_settings().max_upload_bytes
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(413, f"Files must be {limit // (1024 * 1024)} MB or smaller.")
    if not data:
        raise HTTPException(422, "The file is empty.")
    name = _safe_filename(file.filename)
    kind, content_type = _classify(name, data)

    key, digest = storage.put(ctx.org_id, data)
    existing = ctx.db.scalar(
        select(Upload).where(Upload.organization_id == ctx.org_id, Upload.battery_id == b.id, Upload.sha256 == digest)
    )
    if existing:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"This exact file is already attached to {b.bos_id} as '{existing.original_filename}'.",
        )
    u = Upload(
        organization_id=ctx.org_id,
        battery_id=b.id,
        test_session_id=test_session_id or None,
        kind=kind,
        original_filename=name,
        content_type=content_type,
        size_bytes=len(data),
        sha256=digest,
        storage_key=key,
        description=(description or "").strip() or None,
        test_metadata=meta,
        uploaded_by_id=ctx.user.id,
    )
    ctx.db.add(u)
    ctx.db.flush()
    audit.log(
        ctx, "upload.created", "upload", u.id, f"Uploaded {kind} '{name}' ({len(data):,} bytes)", battery_id=b.id,
        details={"sha256": digest, "size_bytes": len(data), "content_type": content_type},
    )
    ctx.db.commit()
    ctx.db.refresh(u)
    return upload_out(u, [])


@router.patch("/uploads/{upload_id}")
def update_upload(upload_id: str, body: UploadUpdateIn, ctx: Ctx = Depends(require("uploads.write"))):
    """Only descriptive metadata can change; the file itself is immutable."""
    u = get_scoped(ctx, Upload, upload_id, label="File")
    data = body.model_dump(exclude_unset=True)
    if data.get("test_session_id"):
        ts = get_scoped(ctx, TestSession, data["test_session_id"], label="Test session")
        if ts.battery_id != u.battery_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "That test session belongs to a different battery.")
    before = {k: getattr(u, k) for k in data}
    for k, v in data.items():
        setattr(u, k, v or None)
    delta = audit.diff(before, {k: getattr(u, k) for k in data})
    if delta:
        audit.log(ctx, "upload.updated", "upload", u.id, f"File details updated for '{u.original_filename}'", battery_id=u.battery_id, details=delta)
    ctx.db.commit()
    return upload_out(u)


@router.get("/uploads/{upload_id}/download")
def download(upload_id: str, inline: bool = False, ctx: Ctx = Depends(require("records.view"))):
    u = get_scoped(ctx, Upload, upload_id, label="File")
    try:
        data = storage.get(u.storage_key)
    except FileNotFoundError as e:
        raise HTTPException(status.HTTP_410_GONE, "The stored file is missing.") from e
    import hashlib

    if hashlib.sha256(data).hexdigest() != u.sha256:
        raise HTTPException(status.HTTP_409_CONFLICT, "The stored file failed its integrity check and was not served.")
    disposition = "inline" if inline and u.kind in ("photo", "document") else "attachment"
    ascii_name = u.original_filename.encode("ascii", "ignore").decode() or "download"
    ascii_name = ascii_name.replace('"', "")
    return Response(
        content=data,
        media_type=u.content_type if u.kind != "csv" else "text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'{disposition}; filename="{ascii_name}"',
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
            "Cache-Control": "private, max-age=300",
            "X-BatteryOS-SHA256": u.sha256,
            "X-BatteryOS-Integrity": "verified",
        },
    )


@router.get("/uploads/{upload_id}/verify")
def verify(upload_id: str, ctx: Ctx = Depends(require("records.view"))):
    u = get_scoped(ctx, Upload, upload_id, label="File")
    return {"sha256": u.sha256, "verified": storage.verify(u.storage_key, u.sha256)}


def _battery_context(b: Battery) -> dict[str, Any]:
    return {
        "nominal_voltage_v": b.nominal_voltage_v,
        "rated_capacity_ah": b.rated_capacity_ah,
        "chemistry": b.chemistry,
        "pack_configuration": b.pack_configuration,
    }


def _analyze(ctx: Ctx, u: Upload, body: PreviewIn) -> csv_ingest.Analysis:
    if u.kind != "csv":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only CSV files can be previewed and imported.")
    b = get_scoped(ctx, Battery, u.battery_id, label="Battery")
    data = storage.get(u.storage_key)
    options = body.options.model_dump()
    mapping = [m.model_dump() for m in body.mapping] if body.mapping is not None else None
    try:
        a = csv_ingest.analyze(data, options, mapping, _battery_context(b), max_rows=get_settings().max_csv_rows)
    except csv_ingest.CsvError as e:
        raise HTTPException(422, str(e)) from e
    others = ctx.db.scalars(
        select(Battery.bos_id)
        .join(Upload, Upload.battery_id == Battery.id)
        .where(Upload.organization_id == ctx.org_id, Upload.sha256 == u.sha256, Upload.battery_id != u.battery_id)
    ).all()
    if others:
        a.issues.insert(
            0,
            csv_ingest.issue(
                "FILE_ALSO_ON_OTHER_BATTERY",
                "warning",
                f"This exact file is also attached to {', '.join(others)}. Make sure it belongs to this battery.",
            ),
        )
    return a


@router.post("/uploads/{upload_id}/preview")
def preview(upload_id: str, body: PreviewIn, ctx: Ctx = Depends(require("records.view"))):
    u = get_scoped(ctx, Upload, upload_id, label="File")
    a = _analyze(ctx, u, body)
    out = csv_ingest.analysis_to_dict(a)
    out["fields"] = {k: {"label": v["label"], "units": v["units"], "multi": v["multi"]} for k, v in csv_ingest.FIELDS.items()}
    out["upload"] = upload_out(u)
    return out


@router.post("/uploads/{upload_id}/import", status_code=201)
def import_upload(upload_id: str, body: ImportIn, ctx: Ctx = Depends(require("data.import"))):
    u = get_scoped(ctx, Upload, upload_id, label="File")
    ts = get_scoped_optional(ctx, TestSession, body.test_session_id, label="Test session")
    if ts and ts.battery_id != u.battery_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "That test session belongs to a different battery.")
    a = _analyze(ctx, u, body)
    report = csv_ingest.analysis_to_dict(a)
    if not a.can_import:
        return JSONResponse(status_code=422, content={"detail": "The file has errors that block import.", "preview": _jsonable(report)})
    if a.warnings and not body.acknowledge_warnings:
        return JSONResponse(
            status_code=409,
            content={"detail": "Review and acknowledge the warnings before importing.", "preview": _jsonable(report)},
        )
    summary = csv_ingest.summarize(a)
    points = csv_ingest.normalized_points(a)

    for old in ctx.db.scalars(select(Dataset).where(Dataset.upload_id == u.id, Dataset.status == "active")):
        old.status = "superseded"
    d = Dataset(
        organization_id=ctx.org_id,
        battery_id=u.battery_id,
        upload_id=u.id,
        test_session_id=ts.id if ts else u.test_session_id,
        parser_config=report["parser"],
        column_mapping=a.mapping,
        validation={"issues": a.issues, "counts": report["counts"], "preamble": a.table.preamble},
        acknowledged_warnings=sorted({w["code"] for w in a.warnings}),
        row_count=len(a.table.rows),
        imported_rows=len(points),
        fields=summary["series_keys"],
        summary=summary,
        imported_by_id=ctx.user.id,
    )
    ctx.db.add(d)
    ctx.db.flush()
    for p in points:
        p["organization_id"] = ctx.org_id
        p["dataset_id"] = d.id
    for i in range(0, len(points), 5000):
        ctx.db.execute(insert(MeasurementPoint), points[i : i + 5000])
    audit.log(
        ctx,
        "dataset.imported",
        "dataset",
        d.id,
        f"Imported {len(points):,} rows from '{u.original_filename}'"
        + (f" with {len(a.warnings)} acknowledged warning(s)" if a.warnings else ""),
        battery_id=u.battery_id,
        details={
            "upload_id": u.id,
            "sha256": u.sha256,
            "mapping": a.mapping,
            "acknowledged_warnings": d.acknowledged_warnings,
        },
    )
    ctx.db.commit()
    ctx.db.refresh(d)
    return dataset_out(d)


def _jsonable(obj: Any) -> Any:
    from fastapi.encoders import jsonable_encoder

    return jsonable_encoder(obj)


# --------------------------------------------------------------------------- datasets


@router.get("/batteries/{battery_id}/datasets")
def list_datasets(battery_id: str, include_superseded: bool = False, ctx: Ctx = Depends(require("records.view"))):
    b = get_scoped(ctx, Battery, battery_id, label="Battery")
    stmt = select(Dataset).where(Dataset.organization_id == ctx.org_id, Dataset.battery_id == b.id)
    if not include_superseded:
        stmt = stmt.where(Dataset.status == "active")
    return [dataset_out(d) for d in ctx.db.scalars(stmt.order_by(Dataset.imported_at.desc()))]


@router.get("/datasets/{dataset_id}")
def get_dataset(dataset_id: str, ctx: Ctx = Depends(require("records.view"))):
    return dataset_out(get_scoped(ctx, Dataset, dataset_id, label="Dataset"))


def _load_points(ctx: Ctx, d: Dataset) -> list[MeasurementPoint]:
    return ctx.db.scalars(
        select(MeasurementPoint)
        .where(MeasurementPoint.organization_id == ctx.org_id, MeasurementPoint.dataset_id == d.id)
        .order_by(MeasurementPoint.seq)
    ).all()


@router.get("/datasets/{dataset_id}/series")
def series(dataset_id: str, max_points: int = Query(default=1500, ge=50, le=20000), ctx: Ctx = Depends(require("records.view"))):
    d = get_scoped(ctx, Dataset, dataset_id, label="Dataset")
    pts = _load_points(ctx, d)
    n = len(pts)
    keys = [k for k in d.fields if k != "step"]
    cols: dict[str, np.ndarray] = {"t_s": np.array([p.t_s for p in pts], dtype=float)}
    for k in keys:
        if k in ("voltage_v", "current_a", "temperature_c", "soc_pct"):
            cols[k] = np.array([getattr(p, k) if getattr(p, k) is not None else np.nan for p in pts], dtype=float)
        else:
            cols[k] = np.array([(p.extra or {}).get(k, np.nan) for p in pts], dtype=float)
    idx = np.arange(n)
    downsampled = n > max_points
    if downsampled:
        primary = next((k for k in ("voltage_v", "current_a", "temperature_c") if k in cols), None)
        buckets = np.array_split(np.arange(n), max(1, max_points // 2))
        chosen: set[int] = {0, n - 1}
        for bucket in buckets:
            if bucket.size == 0:
                continue
            if primary is None:
                chosen.add(int(bucket[0]))
                continue
            vals = cols[primary][bucket]
            if np.isfinite(vals).any():
                chosen.add(int(bucket[np.nanargmin(vals)]))
                chosen.add(int(bucket[np.nanargmax(vals)]))
            else:
                chosen.add(int(bucket[0]))
        idx = np.array(sorted(chosen))
    out = {
        k: [None if not np.isfinite(v) else round(float(v), 6) for v in arr[idx]] for k, arr in cols.items()
    }
    return {
        "dataset_id": d.id,
        "total_points": n,
        "returned_points": int(idx.size),
        "downsampled": downsampled,
        "method": "min/max of the primary series per bucket" if downsampled else "all points",
        "series": out,
    }


@router.get("/datasets/{dataset_id}/normalized.csv")
def normalized_csv(dataset_id: str, ctx: Ctx = Depends(require("records.view"))):
    d = get_scoped(ctx, Dataset, dataset_id, label="Dataset")
    pts = _load_points(ctx, d)
    extra_keys = [k for k in d.fields if k not in ("voltage_v", "current_a", "temperature_c", "soc_pct")]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["source_row", "t_s", "voltage_v", "current_a", "temperature_c", "soc_pct", *extra_keys])
    for p in pts:
        extra = p.extra or {}
        w.writerow([p.source_row, p.t_s, p.voltage_v, p.current_a, p.temperature_c, p.soc_pct, *[extra.get(k) for k in extra_keys]])
    stem = re.sub(r"\.[^.]+$", "", d.upload.original_filename)
    name = f"{stem}_normalized_{d.id[:8]}.csv".encode("ascii", "ignore").decode().replace('"', "")
    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}"', "X-Content-Type-Options": "nosniff"},
    )
