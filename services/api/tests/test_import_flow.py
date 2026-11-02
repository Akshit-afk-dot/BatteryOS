import hashlib

from conftest import CLEAN_CSV, ISSUES_CSV, NO_TIME_CSV, make_battery, sample, signup, upload_file


def test_upload_preview_import_and_original_kept():
    c, _ = signup()
    b = make_battery(c)
    raw = sample(ISSUES_CSV)
    r = upload_file(c, b["id"], "bms export.csv", raw)
    assert r.status_code == 201, r.text
    up = r.json()
    assert up["kind"] == "csv" and up["sha256"] == hashlib.sha256(raw).hexdigest()
    assert up["uploaded_by"]["full_name"] == "Owner Person"

    preview = c.post(f"/api/uploads/{up['id']}/preview", json={}).json()
    assert preview["can_import"] and preview["requires_acknowledgement"]
    assert len(preview["raw_rows"]) == 20 and preview["normalized_preview"]
    assert preview["parser"]["delimiter"] == ";"

    # Import refuses until warnings are acknowledged.
    r = c.post(f"/api/uploads/{up['id']}/import", json={})
    assert r.status_code == 409 and r.json()["preview"]["counts"]["warnings"] > 0

    r = c.post(f"/api/uploads/{up['id']}/import", json={"acknowledge_warnings": True})
    assert r.status_code == 201, r.text
    ds = r.json()
    assert ds["imported_rows"] == 720 and ds["status"] == "active"
    assert "HIGH_TEMPERATURE_READINGS" in ds["acknowledged_warnings"]
    assert any(m["key"] == "cell_spread_max_mv" for m in ds["summary"]["metrics"])

    # The original file is byte-for-byte unchanged.
    dl = c.get(f"/api/uploads/{up['id']}/download")
    assert dl.status_code == 200 and dl.content == raw
    assert dl.headers["x-batteryos-integrity"] == "verified"
    assert "attachment" in dl.headers["content-disposition"]
    assert c.get(f"/api/uploads/{up['id']}/verify").json()["verified"] is True

    history = [e["action"] for e in c.get(f"/api/batteries/{b['id']}/history").json()]
    assert "dataset.imported" in history and "upload.created" in history


def test_errors_block_import():
    c, _ = signup()
    b = make_battery(c)
    up = upload_file(c, b["id"], "summary.csv", sample(NO_TIME_CSV)).json()
    r = c.post(f"/api/uploads/{up['id']}/import", json={"acknowledge_warnings": True})
    assert r.status_code == 422
    assert any(i["code"] == "MISSING_TIME_COLUMN" for i in r.json()["preview"]["issues"])


def test_series_downsampling_and_normalized_export():
    c, _ = signup()
    b = make_battery(c)
    up = upload_file(c, b["id"], "clean.csv", sample(CLEAN_CSV)).json()
    ds = c.post(f"/api/uploads/{up['id']}/import", json={"options": {"current_sign": "discharge_negative"}}).json()
    full = c.get(f"/api/datasets/{ds['id']}/series", params={"max_points": 5000}).json()
    assert full["downsampled"] is False and full["returned_points"] == ds["imported_rows"]
    small = c.get(f"/api/datasets/{ds['id']}/series", params={"max_points": 100}).json()
    assert small["downsampled"] and small["returned_points"] <= 102
    # Extremes survive downsampling.
    assert max(v for v in small["series"]["voltage_v"] if v is not None) == max(v for v in full["series"]["voltage_v"] if v is not None)
    csv_text = c.get(f"/api/datasets/{ds['id']}/normalized.csv").text
    header = csv_text.splitlines()[0]
    assert header.startswith("source_row,t_s,voltage_v,current_a,temperature_c,soc_pct")
    assert len(csv_text.splitlines()) == ds["imported_rows"] + 1


def test_reimport_with_new_mapping_supersedes_previous():
    c, _ = signup()
    b = make_battery(c)
    up = upload_file(c, b["id"], "clean.csv", sample(CLEAN_CSV)).json()
    first = c.post(f"/api/uploads/{up['id']}/import", json={"options": {"current_sign": "discharge_negative"}}).json()
    mapping = [m for m in first["column_mapping"] if m["field"] != "temperature"]
    second = c.post(
        f"/api/uploads/{up['id']}/import",
        json={"options": {"current_sign": "discharge_negative"}, "mapping": mapping},
    ).json()
    assert "temperature_c" not in second["fields"]
    active = c.get(f"/api/batteries/{b['id']}/datasets").json()
    assert [d["id"] for d in active] == [second["id"]]
    every = c.get(f"/api/batteries/{b['id']}/datasets", params={"include_superseded": True}).json()
    assert {d["status"] for d in every} == {"active", "superseded"}


def test_upload_validation():
    c, _ = signup()
    b = make_battery(c)
    assert upload_file(c, b["id"], "photo.png", b"not really a png").status_code == 415
    assert upload_file(c, b["id"], "macro.exe", b"MZ....").status_code == 415
    assert upload_file(c, b["id"], "doc.pdf", b"<html>").status_code == 415
    assert upload_file(c, b["id"], "empty.csv", b"").status_code == 422
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
    r = upload_file(c, b["id"], "../../etc/label photo.png", png, "image/png")
    assert r.status_code == 201 and r.json()["original_filename"] == "label photo.png"
    assert r.json()["kind"] == "photo"
    assert upload_file(c, b["id"], "again.png", png, "image/png").status_code == 409
    pdf = upload_file(c, b["id"], "lab report.pdf", b"%PDF-1.4\n%fake\n", "application/pdf")
    assert pdf.status_code == 201 and pdf.json()["kind"] == "document"
    inline = c.get(f"/api/uploads/{pdf.json()['id']}/download", params={"inline": True})
    assert inline.headers["content-disposition"].startswith("inline")
    assert "sandbox" in inline.headers["content-security-policy"]


def test_upload_size_limit(monkeypatch):
    from app.config import get_settings

    c, _ = signup()
    b = make_battery(c)
    monkeypatch.setattr(get_settings(), "max_upload_bytes", 100)
    assert upload_file(c, b["id"], "big.csv", b"a,b\n" + b"1,2\n" * 100).status_code == 413


def test_same_file_on_two_batteries_is_flagged():
    c, _ = signup()
    b1, b2 = make_battery(c), make_battery(c)
    upload_file(c, b1["id"], "x.csv", sample(CLEAN_CSV))
    up2 = upload_file(c, b2["id"], "x.csv", sample(CLEAN_CSV)).json()
    preview = c.post(f"/api/uploads/{up2['id']}/preview", json={}).json()
    flag = next(i for i in preview["issues"] if i["code"] == "FILE_ALSO_ON_OTHER_BATTERY")
    assert b1["bos_id"] in flag["message"]


def test_upload_metadata_is_stored():
    c, _ = signup()
    b = make_battery(c)
    r = c.post(
        f"/api/batteries/{b['id']}/uploads",
        files={"file": ("clean.csv", sample(CLEAN_CSV), "text/csv")},
        data={"description": "Bench test", "test_metadata": '{"equipment": "Bench cycler", "ambient_c": 25}'},
    )
    assert r.status_code == 201
    assert r.json()["test_metadata"] == {"equipment": "Bench cycler", "ambient_c": 25}
    bad = c.post(
        f"/api/batteries/{b['id']}/uploads",
        files={"file": ("x2.csv", b"t,v\n1,2\n", "text/csv")},
        data={"test_metadata": '{"nested": {"a": 1}}'},
    )
    assert bad.status_code == 422
