from app.services import grounding, llm, report_drafter
from conftest import CLEAN_CSV, invite_member, make_battery, sample, signup, upload_file


def _battery_with_evidence(c):
    b = make_battery(c)
    up = upload_file(c, b["id"], "clean.csv", sample(CLEAN_CSV)).json()
    ts = c.post(
        f"/api/batteries/{b['id']}/test-sessions",
        json={"test_type": "capacity_test", "discharge_current_a": 15, "cutoff_voltage_v": 40, "ambient_temp_c": 25},
    ).json()
    c.post(f"/api/uploads/{up['id']}/import", json={"options": {"current_sign": "discharge_negative"}, "test_session_id": ts["id"]})
    c.post(
        f"/api/batteries/{b['id']}/measurements",
        json={"name": "capacity_ah", "value_num": 27.4, "kind": "measured", "test_session_id": ts["id"], "conditions": "15 A CC to 40 V, 25 °C"},
    )
    c.post(
        f"/api/batteries/{b['id']}/notes",
        json={"note_type": "inspection", "checklist": [{"item": "casing", "result": "ok"}, {"item": "swelling", "result": "issue", "comment": "Slight bulge"}]},
    )
    return b


def _draft(c, b, use_ai=False):
    items = c.get(f"/api/batteries/{b['id']}/evidence").json()["items"]
    r = c.post(f"/api/batteries/{b['id']}/report-drafts", json={"include": [i["ref"] for i in items if i["default"]], "use_ai": use_ai})
    assert r.status_code == 201, r.text
    return r.json()


def test_evidence_candidates_cover_all_record_types():
    c, _ = signup()
    b = _battery_with_evidence(c)
    types = {i["type"] for i in c.get(f"/api/batteries/{b['id']}/evidence").json()["items"]}
    assert types == {"battery_record", "test_session", "measurement", "dataset", "note", "completeness"}


def test_template_draft_is_grounded_and_labelled():
    c, _ = signup()
    b = _battery_with_evidence(c)
    r = _draft(c, b, use_ai=True)  # AI not configured in tests -> template with a notice
    assert r["generator"] == "template" and "not configured" in r["notice"]
    keys = {e["key"] for e in r["evidence"]}
    assert {"B1", "T1", "M1", "D1", "N1", "C1"} <= keys
    assert all(s["origin"] == "template" for s in r["sections"])
    for s in r["sections"]:
        for p in s["paragraphs"]:
            assert set(p["citations"]) <= keys
    # The template never introduces numbers that are not in the evidence.
    assert not [x for x in r["checks"] if x["code"] in ("UNSUPPORTED_NUMBER", "PROHIBITED_CLAIM", "UNKNOWN_CITATION")]
    findings = " ".join(p["text"] for s in r["sections"] if s["key"] == "findings" for p in s["paragraphs"])
    assert "27.4 Ah (measured" in findings and "Slight bulge" in findings
    # The measurement's test session is cross-referenced.
    m = next(e for e in r["evidence"] if e["key"] == "M1")
    assert m["data"]["test_session"] == "T1"


def test_selected_evidence_only():
    c, _ = signup()
    b = _battery_with_evidence(c)
    items = c.get(f"/api/batteries/{b['id']}/evidence").json()["items"]
    only = [i["ref"] for i in items if i["type"] in ("measurement",)]
    r = c.post(f"/api/batteries/{b['id']}/report-drafts", json={"include": only, "use_ai": False}).json()
    assert {e["type"] for e in r["evidence"]} == {"battery_record", "measurement"}
    bad = c.post(f"/api/batteries/{b['id']}/report-drafts", json={"include": ["measurement:doesnotexist"]})
    assert bad.status_code == 400


def test_grounding_flags_invented_numbers_and_claims():
    evidence = [{"key": "M1", "label": "Capacity: 27.4 Ah", "data": {"value": 27.4, "unit": "Ah"}}]
    sections = [
        {"key": "summary", "paragraphs": [
            {"text": "Capacity was 27.4 Ah [M1], which is 91% of rated.", "citations": ["M1"]},
            {"text": "The pack is safe to reuse and certified.", "citations": ["M1"]},
            {"text": "Remaining life is estimated at three years.", "citations": ["M9"]},
            {"text": "Measured 27 Ah overall.", "citations": []},
        ]},
    ]
    checks = grounding.check_sections(sections, evidence)
    by = {}
    for x in checks:
        by.setdefault(x["code"], []).append(x)
    assert "91" in by["UNSUPPORTED_NUMBER"][0]["message"]
    assert len(by["PROHIBITED_CLAIM"]) >= 3
    assert by["UNKNOWN_CITATION"][0]["excerpt"] == "M9"
    assert any(x["severity"] == "warning" for x in by["UNCITED_STATEMENT"])
    # Rounding of an evidence value is accepted.
    ok = grounding.check_sections([{"key": "findings", "paragraphs": [{"text": "About 27 Ah, 27.40 Ah exactly.", "citations": ["M1"]}]}], evidence)
    assert not [x for x in ok if x["code"] == "UNSUPPORTED_NUMBER"]


def test_ai_draft_uses_only_pack_and_drops_bad_citations(monkeypatch):
    c, _ = signup()
    b = _battery_with_evidence(c)
    seen = {}

    def fake_structured(*, system, user, schema, effort="medium", max_tokens=16000):
        seen["user"] = user
        seen["schema"] = schema
        return {
            "summary": [{"text": "Capacity of 27.4 Ah was measured [M1].", "citations": ["M1", "Z9"]}],
            "findings": [{"text": "The inspection noted a slight bulge.", "citations": ["N1"]}],
            "data_quality": [{"text": "Rated capacity is 999 Ah.", "citations": ["B1"]}],
            "follow_up": [{"text": "Consider an internal resistance test.", "citations": ["C1"]}],
        }

    monkeypatch.setattr(llm, "is_configured", lambda: True)
    monkeypatch.setattr(llm, "model_name", lambda: "claude-opus-5-5")
    monkeypatch.setattr(llm, "structured", fake_structured)
    r = _draft(c, b, use_ai=True)
    assert r["generator"] == "anthropic:claude-opus-5-5"
    assert all(s["origin"] == "ai" for s in r["sections"])
    assert r["sections"][0]["paragraphs"][0]["citations"] == ["M1"]  # unknown key dropped
    assert "Private" not in seen["user"]
    enum = seen["schema"]["properties"]["summary"]["items"]["properties"]["citations"]["items"]["enum"]
    assert set(enum) == {e["key"] for e in r["evidence"]}
    assert any(x["code"] == "UNSUPPORTED_NUMBER" and "999" in x["message"] for x in r["checks"])


def test_ai_failure_falls_back_to_template(monkeypatch):
    c, _ = signup()
    b = _battery_with_evidence(c)

    def boom(**_):
        raise llm.AIError("provider down")

    monkeypatch.setattr(llm, "is_configured", lambda: True)
    monkeypatch.setattr(llm, "structured", boom)
    r = _draft(c, b, use_ai=True)
    assert r["generator"] == "template" and "provider down" in r["notice"]


def test_edit_approve_lock_and_revise():
    c, _ = signup()
    b = _battery_with_evidence(c)
    r = _draft(c, b)
    rid = r["id"]
    sections = r["sections"]
    sections[0]["paragraphs"][0]["text"] = "Edited summary of the pack record."
    sections.append({"key": "extra", "title": "Workshop note", "origin": "ai", "paragraphs": [{"text": "Customer asked for return by Friday.", "citations": []}]})
    upd = c.patch(f"/api/reports/{rid}", json={"sections": sections}).json()
    origins = {s["key"]: s["origin"] for s in upd["sections"]}
    assert origins["summary"] == "template_edited" and origins["findings"] == "template" and origins["extra"] == "human"

    assert c.post(f"/api/reports/{rid}/approve", json={}).status_code == 422  # no conclusion
    c.patch(f"/api/reports/{rid}", json={"reviewer_conclusion": "Recorded results reviewed. Proceed to quotation for cell group 7."})
    ap = c.post(f"/api/reports/{rid}/approve", json={})
    if ap.status_code == 409:  # flagged statements must be explicitly acknowledged
        ap = c.post(f"/api/reports/{rid}/approve", json={"acknowledge_checks": True})
    assert ap.status_code == 200 and ap.json()["status"] == "approved"
    assert ap.json()["approved_by"]["full_name"] == "Owner Person"

    assert c.patch(f"/api/reports/{rid}", json={"title": "changed"}).status_code == 409
    assert c.post(f"/api/reports/{rid}/regenerate", json={"include": ["battery"]}).status_code == 409

    v2 = c.post(f"/api/reports/{rid}/revise")
    assert v2.status_code == 201 and v2.json()["version"] == 2 and v2.json()["status"] == "draft"
    assert c.post(f"/api/reports/{rid}/revise").status_code == 409  # one open draft at a time
    v2id = v2.json()["id"]
    c.post(f"/api/reports/{v2id}/approve", json={"acknowledge_checks": True})
    assert c.get(f"/api/reports/{rid}").json()["status"] == "superseded"
    assert len(c.get(f"/api/reports/{v2id}").json()["versions"]) == 2


def test_flagged_statements_need_acknowledgement():
    c, _ = signup()
    b = _battery_with_evidence(c)
    r = _draft(c, b)
    sections = r["sections"]
    sections[0]["paragraphs"].append({"text": "This pack is safe for resale.", "citations": ["B1"]})
    c.patch(f"/api/reports/{r['id']}", json={"sections": sections, "reviewer_conclusion": "Reviewed."})
    assert c.post(f"/api/reports/{r['id']}/approve", json={}).status_code == 409
    ok = c.post(f"/api/reports/{r['id']}/approve", json={"acknowledge_checks": True})
    assert ok.status_code == 200
    audit = next(e for e in c.get(f"/api/batteries/{b['id']}/history").json() if e["action"] == "report.approved")
    assert "PROHIBITED_CLAIM" in audit["details"]["acknowledged_checks"]


def test_staff_cannot_draft_or_approve():
    owner, _ = signup()
    staff, _ = invite_member(owner, "staff")
    tech, _ = invite_member(owner, "technician")
    b = _battery_with_evidence(owner)
    assert staff.post(f"/api/batteries/{b['id']}/report-drafts", json={"include": ["battery"]}).status_code == 403
    r = _draft(tech, b)
    tech.patch(f"/api/reports/{r['id']}", json={"reviewer_conclusion": "Reviewed by technician."})
    assert staff.post(f"/api/reports/{r['id']}/approve", json={"acknowledge_checks": True}).status_code == 403
    assert tech.post(f"/api/reports/{r['id']}/approve", json={"acknowledge_checks": True}).status_code == 200


def test_report_pdf_renders():
    c, _ = signup()
    b = _battery_with_evidence(c)
    r = _draft(c, b)
    pdf = c.get(f"/api/reports/{r['id']}/pdf")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
    assert "DRAFT" in pdf.headers["content-disposition"]


def test_output_schema_has_all_sections():
    schema = report_drafter.output_schema(["B1"])
    assert set(schema["required"]) == set(report_drafter.SECTION_TITLES)
    assert schema["additionalProperties"] is False
