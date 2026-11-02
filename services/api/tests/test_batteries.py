import re

from conftest import invite_member, make_battery, signup


def test_minimal_battery_with_unknown_fields():
    c, _ = signup()
    r = c.post("/api/batteries", json={})
    assert r.status_code == 201
    b = r.json()
    assert re.fullmatch(r"BOS-\d{2}-00001", b["bos_id"])
    assert b["chemistry"] == "unknown" and b["nominal_voltage_v"] is None
    assert b["status"] == "received"
    assert b["received_date"] is not None
    # Unknown values are reported explicitly, not omitted.
    assert b["provenance"]["chemistry"] == "unknown"
    assert b["provenance"]["serial_number"] == "unknown"


def test_ids_increment_and_custom_prefix():
    c, _ = signup()
    first = make_battery(c)
    second = make_battery(c)
    assert int(first["bos_id"][-5:]) + 1 == int(second["bos_id"][-5:])
    assert c.patch("/api/organizations/current", json={"battery_id_prefix": "SBW"}).status_code == 200
    assert make_battery(c)["bos_id"].startswith("SBW-")


def test_provenance_defaults_and_updates():
    c, _ = signup()
    b = c.post("/api/batteries", json={"chemistry": "NMC", "rated_capacity_ah": 40}).json()
    assert b["provenance"]["chemistry"] == "unverified"
    r = c.patch(f"/api/batteries/{b['id']}", json={"provenance": {"chemistry": "technician_verified"}})
    assert r.json()["provenance"]["chemistry"] == "technician_verified"
    assert r.json()["provenance"]["rated_capacity_ah"] == "unverified"
    bad = c.patch(f"/api/batteries/{b['id']}", json={"provenance": {"status": "nameplate"}})
    assert bad.status_code == 422


def test_update_only_changes_given_fields_and_is_audited():
    c, _ = signup()
    b = make_battery(c, manufacturer="Acme")
    r = c.patch(f"/api/batteries/{b['id']}", json={"model": "X1"})
    assert r.json()["manufacturer"] == "Acme" and r.json()["model"] == "X1"
    history = c.get(f"/api/batteries/{b['id']}/history").json()
    upd = next(e for e in history if e["action"] == "battery.updated")
    assert upd["details"] == {"model": {"from": None, "to": "X1"}}


def test_status_transitions_enforced():
    c, _ = signup()
    b = make_battery(c)
    assert c.post(f"/api/batteries/{b['id']}/status", json={"status": "dispatched"}).status_code == 409
    assert c.post(f"/api/batteries/{b['id']}/status", json={"status": "rejected"}).status_code == 400
    r = c.post(f"/api/batteries/{b['id']}/status", json={"status": "testing"})
    assert r.status_code == 200 and r.json()["status"] == "testing"
    assert "review_required" in r.json()["allowed_transitions"]
    r = c.post(f"/api/batteries/{b['id']}/status", json={"status": "rejected", "reason": "Swollen cells, customer declined"})
    assert r.status_code == 200
    ev = [e for e in c.get(f"/api/batteries/{b['id']}/history").json() if e["action"] == "battery.status_changed"]
    assert ev[0]["details"]["to"] == "rejected" and ev[0]["details"]["reason"].startswith("Swollen")


def test_search_filter_and_pagination():
    c, _ = signup()
    cust = c.post("/api/customers", json={"name": "Gupta E-Rickshaw Fleet"}).json()
    make_battery(c, serial_number="ABC-111", customer_id=cust["id"])
    make_battery(c, serial_number="XYZ-222", chemistry="NMC")
    archived = make_battery(c, serial_number="OLD-333")
    c.post(f"/api/batteries/{archived['id']}/status", json={"status": "archived", "reason": "duplicate entry"})
    assert c.get("/api/batteries").json()["total"] == 2
    assert c.get("/api/batteries", params={"include_archived": True}).json()["total"] == 3
    assert c.get("/api/batteries", params={"q": "gupta"}).json()["items"][0]["serial_number"] == "ABC-111"
    assert c.get("/api/batteries", params={"chemistry": "NMC"}).json()["total"] == 1
    assert c.get("/api/batteries", params={"status": "archived"}).json()["total"] == 1
    page = c.get("/api/batteries", params={"page_size": 1, "page": 2}).json()
    assert len(page["items"]) == 1 and page["total"] == 2


def test_bulk_create_in_batch():
    c, _ = signup()
    batch = c.post("/api/batches", json={"description": "40 packs from fleet"}).json()
    assert batch["reference"].startswith("BATCH-")
    r = c.post(
        "/api/batteries/bulk",
        json={"count": 3, "template": {"batch_id": batch["id"], "nominal_voltage_v": 48}, "serial_numbers": ["A1", "A2", ""]},
    )
    assert r.status_code == 201
    created = r.json()["created"]
    assert [b["serial_number"] for b in created] == ["A1", "A2", None]
    detail = c.get(f"/api/batches/{batch['id']}").json()
    assert detail["battery_count"] == 3 and detail["by_status"] == {"received": 3}
    mismatch = c.post("/api/batteries/bulk", json={"count": 2, "template": {}, "serial_numbers": ["only-one"]})
    assert mismatch.status_code == 422


def test_completeness_checklist():
    c, _ = signup()
    b = make_battery(c)
    items = {i["key"]: i["done"] for i in c.get(f"/api/batteries/{b['id']}").json()["completeness"]}
    assert items["chemistry"] and items["ratings"] and items["verified_specs"] and items["identity"]
    assert not items["data"] and not items["capacity"] and not items["inspection"]


def test_service_events_and_staff_permissions():
    owner, _ = signup()
    staff, _ = invite_member(owner, "staff")
    b = make_battery(staff)
    r = staff.post(f"/api/batteries/{b['id']}/service-events", json={"event_type": "dispatch", "description": "Handed to customer"})
    assert r.status_code == 201
    assert staff.get(f"/api/batteries/{b['id']}/service-events").json()[0]["event_type"] == "dispatch"
    # Staff cannot record test sessions or measurements.
    assert staff.post(f"/api/batteries/{b['id']}/test-sessions", json={"test_type": "capacity_test"}).status_code == 403
    # Staff cannot see the audit log or change workspace settings.
    assert staff.get("/api/audit").status_code == 403
    assert staff.patch("/api/organizations/current", json={"name": "Hacked"}).status_code == 403


def test_customer_links_validated():
    c, _ = signup()
    other, _ = signup()
    foreign = other.post("/api/customers", json={"name": "Not yours"}).json()
    assert c.post("/api/batteries", json={"customer_id": foreign["id"]}).status_code == 404
    assert c.post("/api/batteries", json={"battery_type": "spaceship"}).status_code == 422
    assert c.post("/api/batteries", json={"nominal_voltage_v": -5}).status_code == 422


def test_workspace_time_zone_setting():
    c, me = signup()
    assert me["organization"]["timezone"] == "Asia/Kolkata"
    assert c.patch("/api/organizations/current", json={"timezone": "Mars/Olympus"}).status_code == 422
    r = c.patch("/api/organizations/current", json={"timezone": "Europe/London"})
    assert r.status_code == 200 and r.json()["timezone"] == "Europe/London"
