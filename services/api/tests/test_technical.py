from conftest import invite_member, make_battery, signup


def _session(c, b, **kw):
    r = c.post(f"/api/batteries/{b['id']}/test-sessions", json={"test_type": "capacity_test", "equipment": "Bench cycler", **kw})
    assert r.status_code == 201, r.text
    return r.json()


def test_measured_values_need_a_test_session():
    c, _ = signup()
    b = make_battery(c)
    r = c.post(f"/api/batteries/{b['id']}/measurements", json={"name": "capacity_ah", "value_num": 27.3, "kind": "measured"})
    assert r.status_code == 422
    ts = _session(c, b, discharge_current_a=15, cutoff_voltage_v=42, ambient_temp_c=25)
    r = c.post(
        f"/api/batteries/{b['id']}/measurements",
        json={"name": "capacity_ah", "value_num": 27.3, "kind": "measured", "test_session_id": ts["id"], "conditions": "0.5C to 42 V at 25 °C"},
    )
    assert r.status_code == 201
    m = r.json()
    assert m["unit"] == "Ah" and m["label"] == "Discharge capacity" and m["captured_at"] == ts["test_date"]
    assert ts["operator_name"] == "Owner Person"


def test_external_and_model_values_need_a_source():
    c, _ = signup()
    b = make_battery(c)
    r = c.post(f"/api/batteries/{b['id']}/measurements", json={"name": "soh_pct", "value_num": 80, "kind": "model_estimate"})
    assert r.status_code == 422
    r = c.post(
        f"/api/batteries/{b['id']}/measurements",
        json={"name": "capacity_ah", "value_num": 26.9, "kind": "external", "source_description": "Lab report LR-12"},
    )
    assert r.status_code == 201
    # Calculated values come only from imports.
    r = c.post(f"/api/batteries/{b['id']}/measurements", json={"name": "capacity_ah", "value_num": 1, "kind": "calculated"})
    assert r.status_code == 422


def test_measurements_are_voided_not_edited():
    c, _ = signup()
    b = make_battery(c)
    ts = _session(c, b)
    m = c.post(
        f"/api/batteries/{b['id']}/measurements",
        json={"name": "internal_resistance_mohm", "value_num": 420, "kind": "measured", "test_session_id": ts["id"]},
    ).json()
    assert c.post(f"/api/measurements/{m['id']}/void", json={"reason": "no"}).status_code == 422  # reason too short
    r = c.post(f"/api/measurements/{m['id']}/void", json={"reason": "Typed mΩ value for the wrong pack"})
    assert r.status_code == 200 and r.json()["voided_at"]
    assert c.post(f"/api/measurements/{m['id']}/void", json={"reason": "again please"}).status_code == 400
    all_m = c.get(f"/api/batteries/{b['id']}/measurements").json()
    assert all_m[0]["void_reason"].startswith("Typed")
    assert c.get(f"/api/batteries/{b['id']}/measurements", params={"include_voided": False}).json() == []


def test_measurement_from_other_battery_session_rejected():
    c, _ = signup()
    b1, b2 = make_battery(c), make_battery(c)
    ts = _session(c, b1)
    r = c.post(
        f"/api/batteries/{b2['id']}/measurements",
        json={"name": "capacity_ah", "value_num": 20, "kind": "measured", "test_session_id": ts["id"]},
    )
    assert r.status_code == 400


def test_inspection_checklist_and_note_rules():
    owner, _ = signup()
    staff, _ = invite_member(owner, "staff")
    b = make_battery(owner)
    checklist = [
        {"item": "casing", "result": "ok"},
        {"item": "swelling", "result": "issue", "comment": "Cell group 7 bulging"},
        {"item": "odour", "result": "not_checked"},
    ]
    r = owner.post(f"/api/batteries/{b['id']}/notes", json={"note_type": "inspection", "body": "", "checklist": checklist})
    assert r.status_code == 201 and r.json()["checklist"][1]["comment"] == "Cell group 7 bulging"
    assert owner.post(f"/api/batteries/{b['id']}/notes", json={"note_type": "observation", "checklist": checklist}).status_code == 422
    assert owner.post(
        f"/api/batteries/{b['id']}/notes", json={"note_type": "inspection", "checklist": [{"item": "bogus", "result": "ok"}]}
    ).status_code == 422
    # Staff can add general notes, not inspection notes.
    assert staff.post(f"/api/batteries/{b['id']}/notes", json={"note_type": "general", "body": "Customer called"}).status_code == 201
    assert staff.post(f"/api/batteries/{b['id']}/notes", json={"note_type": "inspection", "checklist": checklist}).status_code == 403
    # Only the author edits their note.
    note = staff.get(f"/api/batteries/{b['id']}/notes").json()[0]
    assert owner.patch(f"/api/notes/{note['id']}", json={"body": "changed"}).status_code == 403
    assert staff.patch(f"/api/notes/{note['id']}", json={"body": "Customer called twice"}).status_code == 200
    edit = next(e for e in owner.get(f"/api/batteries/{b['id']}/history").json() if e["action"] == "note.edited")
    assert edit["details"]["before"]["body"] == "Customer called"
    assert owner.get(f"/api/batteries/{b['id']}").json()["completeness"][6]["done"] is True
