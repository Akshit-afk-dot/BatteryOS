"""Create a DEMO workspace so you can click through BatteryOS without real data.

Everything created here is clearly labelled as sample data:
  * the workspace is called "Demo Refurbishers (sample data)",
  * customers are marked "(sample)",
  * measurements and test sessions say "SYNTHETIC demo value",
  * the imported CSV is the synthetic file from samples/.
None of it describes a real battery. Delete the demo workspace's database
file (or use a separate DATABASE_URL) before using BatteryOS for real work.

The script drives the real API in-process, so every record gets the same
validation and audit trail as if a person had entered it.

Usage (from the repository root):  npm run seed:demo
Sign in with the demo account below.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "services" / "api"))
os.chdir(ROOT / "services" / "api")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

# Demo-only sign-in for the sample workspace. Change or delete this account
# before putting real customer data into the same database.
DEMO_EMAIL = "demo.owner@example.com"
DEMO_PASSWORD = "demo-batteryos-2026"
SAMPLES = ROOT / "samples"


def ok(r, *codes):
    if r.status_code not in (codes or (200, 201)):
        raise SystemExit(f"Seed step failed: {r.request.method} {r.request.url} -> {r.status_code} {r.text[:500]}")
    return r.json()


def main() -> None:
    if not (SAMPLES / "SYNTHETIC_capacity_test_16S_LFP_clean.csv").exists():
        raise SystemExit("Sample files missing. Run: python scripts/generate_samples.py")
    with TestClient(app, headers={"x-batteryos-client": "web"}) as c:
        r = c.post(
            "/api/auth/signup",
            json={"organization_name": "Demo Refurbishers (sample data)", "full_name": "Demo Owner", "email": DEMO_EMAIL, "password": DEMO_PASSWORD},
        )
        if r.status_code == 409:
            print(f"Demo account already exists. Sign in as {DEMO_EMAIL} (password in scripts/seed_demo.py).")
            return
        ok(r)
        ok(c.patch("/api/organizations/current", json={
            "address": "Sample address — replace in Settings",
            "phone": "+91 00000 00000",
            "quotation_terms": "SAMPLE TERMS — replace with your own in Settings. Prices in INR.",
        }))
        ok(c.post("/api/catalogue/starter"), 201)

        fleet = ok(c.post("/api/customers", json={"name": "Demo Fleet Operator (sample)", "contact_name": "Sample Contact", "phone": "+91 00000 00001"}), 201)
        shop = ok(c.post("/api/customers", json={"name": "Demo Workshop Customer (sample)"}), 201)
        batch = ok(c.post("/api/batches", json={"customer_id": fleet["id"], "description": "SAMPLE consignment of 48 V e-rickshaw packs"}), 201)

        common = {"battery_type": "e_rickshaw", "chemistry": "LFP", "nominal_voltage_v": 51.2, "rated_capacity_ah": 30, "pack_configuration": "16S1P",
                  "manufacturer": "SampleCell", "model": "DEMO-51V30", "provenance": {"chemistry": "nameplate", "nominal_voltage_v": "nameplate", "rated_capacity_ah": "nameplate"}}

        # 1. A battery taken all the way through: data, tests, inspection, report, quotation.
        b1 = ok(c.post("/api/batteries", json={**common, "customer_id": fleet["id"], "batch_id": batch["id"], "serial_number": "DEMO-SN-0001",
                                                "intake_condition": "SAMPLE: casing scuffed, terminals clean."}), 201)
        ts = ok(c.post(f"/api/batteries/{b1['id']}/test-sessions", json={
            "test_type": "capacity_test", "equipment": "SYNTHETIC demo — no real equipment", "ambient_temp_c": 25,
            "discharge_current_a": 15, "cutoff_voltage_v": 40, "method": "SYNTHETIC demo profile: rest, CC discharge at 15 A to 40 V."}), 201)
        up = ok(c.post(f"/api/batteries/{b1['id']}/uploads",
                       files={"file": ("SYNTHETIC_capacity_test_16S_LFP_clean.csv", (SAMPLES / "SYNTHETIC_capacity_test_16S_LFP_clean.csv").read_bytes(), "text/csv")},
                       data={"description": "SYNTHETIC sample file", "test_session_id": ts["id"]}), 201)
        ok(c.post(f"/api/uploads/{up['id']}/import", json={"options": {"current_sign": "discharge_negative"}, "test_session_id": ts["id"]}), 201)
        up2 = ok(c.post(f"/api/batteries/{b1['id']}/uploads",
                        files={"file": ("SYNTHETIC_bms_export_with_issues.csv", (SAMPLES / "SYNTHETIC_bms_export_with_issues.csv").read_bytes(), "text/csv")},
                        data={"description": "SYNTHETIC BMS log with deliberate data problems"}), 201)
        ok(c.post(f"/api/uploads/{up2['id']}/import", json={"acknowledge_warnings": True}), 201)
        ok(c.post(f"/api/batteries/{b1['id']}/measurements", json={
            "name": "capacity_ah", "value_num": 27.4, "kind": "measured", "test_session_id": ts["id"],
            "conditions": "SYNTHETIC demo value — 15 A CC to 40 V at 25 °C", "source_description": "SYNTHETIC demo value"}), 201)
        ok(c.post(f"/api/batteries/{b1['id']}/notes", json={
            "note_type": "inspection", "body": "SAMPLE inspection note for the demo workspace.",
            "checklist": [{"item": "casing", "result": "ok"}, {"item": "swelling", "result": "issue", "comment": "SAMPLE: slight bulge on cell group 7"},
                          {"item": "connectors", "result": "ok"}, {"item": "bms", "result": "ok"}, {"item": "odour", "result": "not_checked"}]}), 201)
        for status in ("testing", "review_required"):
            ok(c.post(f"/api/batteries/{b1['id']}/status", json={"status": status}))
        ev = ok(c.get(f"/api/batteries/{b1['id']}/evidence"))
        rep = ok(c.post(f"/api/batteries/{b1['id']}/report-drafts", json={"include": [i["ref"] for i in ev["items"] if i["default"]], "use_ai": False}), 201)
        ok(c.patch(f"/api/reports/{rep['id']}", json={"reviewer_conclusion": "SAMPLE conclusion for the demo: replace cell group 7 and rebalance, then retest."}))
        ok(c.post(f"/api/reports/{rep['id']}/approve", json={"acknowledge_checks": True}))
        q = ok(c.post("/api/quotations", json={"battery_id": b1["id"], "report_id": rep["id"]}), 201)
        cat = {i["code"]: i for i in ok(c.get("/api/catalogue"))}
        lines = [{k: line[k] for k in ("catalogue_item_id", "description", "quantity", "unit", "unit_price_paise", "tax_rate_bp", "origin", "rationale")} for line in q["lines"]]
        for code, qty in (("REP-CELL", 1), ("PART-CELL", 1), ("SVC-BAL", 1)):
            i = cat[code]
            lines.append({"catalogue_item_id": i["id"], "description": i["name"], "quantity": qty, "unit": i["unit"], "unit_price_paise": i["unit_price_paise"], "tax_rate_bp": i["tax_rate_bp"]})
        ok(c.patch(f"/api/quotations/{q['id']}", json={"lines": lines, "notes": "SAMPLE quotation in the demo workspace."}))
        ok(c.post(f"/api/quotations/{q['id']}/approve"))

        # 2-5. Batteries at earlier stages.
        b2 = ok(c.post("/api/batteries", json={**common, "customer_id": fleet["id"], "batch_id": batch["id"], "serial_number": "DEMO-SN-0002"}), 201)
        ok(c.post(f"/api/batteries/{b2['id']}/status", json={"status": "awaiting_data", "reason": "SAMPLE: waiting for BMS export from customer"}))
        b3 = ok(c.post("/api/batteries", json={**common, "customer_id": fleet["id"], "batch_id": batch["id"], "serial_number": "DEMO-SN-0003"}), 201)
        ok(c.post(f"/api/batteries/{b3['id']}/status", json={"status": "testing"}))
        ok(c.post("/api/batteries", json={"battery_type": "two_wheeler", "customer_id": shop["id"], "notes": "SAMPLE: chemistry and ratings not yet known."}), 201)
        b5 = ok(c.post("/api/batteries", json={"battery_type": "energy_storage", "chemistry": "NMC", "nominal_voltage_v": 48, "rated_capacity_ah": 100,
                                               "customer_id": shop["id"], "provenance": {"chemistry": "customer_reported"}}), 201)
        ok(c.post(f"/api/batteries/{b5['id']}/notes", json={"note_type": "general", "body": "SAMPLE: customer reports reduced backup time."}), 201)

    print("Demo workspace created: 'Demo Refurbishers (sample data)'.")
    print(f"Sign in at http://localhost:3000/login as {DEMO_EMAIL} (the password is set in scripts/seed_demo.py).")


if __name__ == "__main__":
    main()
