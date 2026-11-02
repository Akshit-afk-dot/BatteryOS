from app.services import llm
from app.services.pdf import inr
from app.services.quotation_drafter import line_amounts
from conftest import invite_member, make_battery, signup


def _setup(c):
    cust = c.post("/api/customers", json={"name": "Verma Motors", "address": "Jammu", "tax_id": "01ABCDE1234F1Z5"}).json()
    b = make_battery(c, customer_id=cust["id"])
    assert c.post("/api/catalogue/starter").json()["added"] > 5
    return cust, b


def _approved_report(c, b):
    items = c.get(f"/api/batteries/{b['id']}/evidence").json()["items"]
    r = c.post(f"/api/batteries/{b['id']}/report-drafts", json={"include": [i["ref"] for i in items], "use_ai": False}).json()
    c.patch(f"/api/reports/{r['id']}", json={"reviewer_conclusion": "Replace cell group 7 and rebalance."})
    assert c.post(f"/api/reports/{r['id']}/approve", json={"acknowledge_checks": True}).status_code == 200
    return r


def test_line_arithmetic_and_inr_format():
    assert line_amounts(1, 50000, 1800) == (50000, 9000, 59000)
    assert line_amounts(1.5, 33333, 1800) == (50000, 9000, 59000)
    assert line_amounts(3, 33333, 500) == (99999, 5000, 104999)
    assert inr(12345678901) == "12,34,56,789.01"
    assert inr(99900) == "999.00"


def test_draft_edit_approve_flow_updates_battery_status():
    c, _ = signup()
    cust, b = _setup(c)
    c.post(f"/api/batteries/{b['id']}/status", json={"status": "testing"})
    c.post(f"/api/batteries/{b['id']}/status", json={"status": "review_required"})
    q = c.post("/api/quotations", json={"battery_id": b["id"]}).json()
    assert q["status"] == "draft" and q["customer"]["name"] == "Verma Motors"
    assert [line["origin"] for line in q["lines"]] == ["template"]  # catalogue default item
    assert q["total_paise"] == 59000
    cat = {i["code"]: i for i in c.get("/api/catalogue").json()}
    lines = [
        {**{k: q["lines"][0][k] for k in ("catalogue_item_id", "description", "quantity", "unit", "unit_price_paise", "tax_rate_bp")}},
        {"catalogue_item_id": cat["REP-CELL"]["id"], "description": "Cell replacement labour", "quantity": 2, "unit": "cell",
         "unit_price_paise": cat["REP-CELL"]["unit_price_paise"], "tax_rate_bp": 1800},
        {"description": "Custom fixture", "quantity": 1, "unit": "each", "unit_price_paise": 12345, "tax_rate_bp": 0},
    ]
    upd = c.patch(f"/api/quotations/{q['id']}", json={"lines": lines, "notes": "Collect by Friday"}).json()
    assert [line["origin"] for line in upd["lines"]] == ["template", "human", "human"]
    assert upd["subtotal_paise"] == 50000 + 70000 + 12345
    assert upd["tax_paise"] == 9000 + 12600
    assert upd["total_paise"] == upd["subtotal_paise"] + upd["tax_paise"]

    ap = c.post(f"/api/quotations/{q['id']}/approve")
    assert ap.status_code == 200 and ap.json()["status"] == "approved"
    assert c.get(f"/api/batteries/{b['id']}").json()["status"] == "quoted"
    assert c.patch(f"/api/quotations/{q['id']}", json={"notes": "x"}).status_code == 409

    assert c.post(f"/api/quotations/{q['id']}/status", json={"status": "sent"}).json()["status"] == "sent"
    assert c.post(f"/api/quotations/{q['id']}/status", json={"status": "accepted"}).json()["status"] == "accepted"
    assert c.get(f"/api/batteries/{b['id']}").json()["status"] == "approved"
    assert c.post(f"/api/quotations/{q['id']}/revise").status_code == 409
    detail = c.get(f"/api/quotations/{q['id']}").json()
    assert [r["status"] for r in detail["revisions"]] == ["accepted", "sent", "approved"]
    pdf = c.get(f"/api/quotations/{q['id']}/pdf")
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")


def test_revision_reopens_draft():
    c, _ = signup()
    cust, b = _setup(c)
    q = c.post("/api/quotations", json={"battery_id": b["id"]}).json()
    c.post(f"/api/quotations/{q['id']}/approve")
    rev = c.post(f"/api/quotations/{q['id']}/revise").json()
    assert rev["revision"] == 2 and rev["status"] == "draft" and rev["approved_by"] is None
    assert c.patch(f"/api/quotations/{q['id']}", json={"notes": "Revised after call"}).status_code == 200


def test_approval_rules_and_permissions():
    owner, _ = signup()
    staff, _ = invite_member(owner, "staff")
    cust, b = _setup(owner)
    q = staff.post("/api/quotations", json={"battery_id": b["id"]}).json()
    assert staff.post(f"/api/quotations/{q['id']}/approve").status_code == 403
    no_customer = owner.post("/api/quotations", json={"battery_id": make_battery(owner)["id"]}).json()
    assert owner.post(f"/api/quotations/{no_customer['id']}/approve").status_code == 422
    empty = owner.post("/api/quotations", json={"battery_id": b["id"]}).json()
    owner.patch(f"/api/quotations/{empty['id']}", json={"lines": []})
    assert owner.post(f"/api/quotations/{empty['id']}/approve").status_code == 422
    assert owner.post(f"/api/quotations/{q['id']}/approve").status_code == 200
    assert staff.post(f"/api/quotations/{q['id']}/status", json={"status": "sent"}).status_code == 200
    assert staff.post(f"/api/quotations/{q['id']}/status", json={"status": "accepted"}).status_code == 403
    assert staff.post("/api/catalogue", json={"code": "X1", "name": "X", "unit_price_paise": 100}).status_code == 403


def test_ai_quote_requires_approved_report_and_uses_catalogue_prices(monkeypatch):
    c, _ = signup()
    cust, b = _setup(c)
    assert c.post("/api/quotations", json={"battery_id": b["id"], "use_ai": True}).status_code == 422
    items = c.get(f"/api/batteries/{b['id']}/evidence").json()["items"]
    draft = c.post(f"/api/batteries/{b['id']}/report-drafts", json={"include": [i["ref"] for i in items]}).json()
    assert c.post("/api/quotations", json={"battery_id": b["id"], "report_id": draft["id"], "use_ai": True}).status_code == 409

    report = _approved_report(c, b)
    cat = {i["code"]: i for i in c.get("/api/catalogue").json()}

    def fake(*, system, user, schema, effort="medium", max_tokens=16000):
        assert "Replace cell group 7" in user
        assert "unit_price" not in user  # the model never sees prices
        return {
            "lines": [
                {"catalogue_item_id": cat["REP-CELL"]["id"], "quantity": 1, "rationale": "Reviewer asked to replace cell group 7."},
                {"catalogue_item_id": cat["SVC-BAL"]["id"], "quantity": 99999, "rationale": "Rebalance after replacement."},
                {"catalogue_item_id": "not-a-real-id", "quantity": 1, "rationale": "Invented"},
            ],
            "notes_for_staff": "Confirm the replacement cell grade.",
        }

    monkeypatch.setattr(llm, "is_configured", lambda: True)
    monkeypatch.setattr(llm, "model_name", lambda: "claude-opus-5-5")
    monkeypatch.setattr(llm, "structured", fake)
    q = c.post("/api/quotations", json={"battery_id": b["id"], "report_id": report["id"], "use_ai": True}).json()
    assert q["drafted_by"] == "anthropic:claude-opus-5-5"
    codes = [line["catalogue_item_id"] for line in q["lines"]]
    assert codes == [cat["REP-CELL"]["id"], cat["SVC-BAL"]["id"], cat["DIAG-INTAKE"]["id"]]
    assert q["lines"][0]["unit_price_paise"] == cat["REP-CELL"]["unit_price_paise"]
    assert q["lines"][1]["quantity"] == 1  # implausible quantity reset
    assert q["draft_notes"] == "Confirm the replacement cell grade."
    assert q["status"] == "draft"


def test_catalogue_codes_unique():
    c, _ = signup()
    body = {"code": "TEST-1", "name": "Test", "unit_price_paise": 1000}
    assert c.post("/api/catalogue", json=body).status_code == 201
    assert c.post("/api/catalogue", json=body).status_code == 409
    assert c.post("/api/catalogue", json={**body, "code": "bad code!"}).status_code == 422


def test_edit_summary_lists_only_real_changes():
    c, _ = signup()
    cust, b = _setup(c)
    q = c.post("/api/quotations", json={"battery_id": b["id"]}).json()
    lines = [{k: line[k] for k in ("catalogue_item_id", "description", "quantity", "unit", "unit_price_paise", "tax_rate_bp", "origin", "rationale")} for line in q["lines"]]
    lines[0]["quantity"] = 2
    c.patch(f"/api/quotations/{q['id']}", json={"lines": lines, "notes": "", "terms": q["terms"]})
    ev = next(e for e in c.get(f"/api/batteries/{b['id']}/history").json() if e["action"] == "quotation.edited")
    assert ev["summary"].endswith("(lines, total)")
