"""One organization's users must never read or change another organization's records."""

from conftest import CLEAN_CSV, make_battery, sample, signup, upload_file


def _populate(c):
    cust = c.post("/api/customers", json={"name": "Private Customer"}).json()
    b = make_battery(c, customer_id=cust["id"], serial_number="SECRET-SN")
    up = upload_file(c, b["id"], "data.csv", sample(CLEAN_CSV)).json()
    ds = c.post(
        f"/api/uploads/{up['id']}/import",
        json={"options": {"current_sign": "discharge_negative"}, "acknowledge_warnings": True},
    ).json()
    ts = c.post(f"/api/batteries/{b['id']}/test-sessions", json={"test_type": "capacity_test"}).json()
    m = c.post(
        f"/api/batteries/{b['id']}/measurements",
        json={"name": "capacity_ah", "value_num": 27.1, "kind": "measured", "test_session_id": ts["id"]},
    ).json()
    n = c.post(f"/api/batteries/{b['id']}/notes", json={"note_type": "observation", "body": "secret note"}).json()
    c.post("/api/catalogue/starter")
    cat = c.get("/api/catalogue").json()[0]
    batch = c.post("/api/batches", json={"description": "private batch"}).json()
    ev = c.get(f"/api/batteries/{b['id']}/evidence").json()["items"]
    rep = c.post(f"/api/batteries/{b['id']}/report-drafts", json={"include": [i["ref"] for i in ev], "use_ai": False}).json()
    q = c.post("/api/quotations", json={"battery_id": b["id"]}).json()
    return {"customer": cust, "battery": b, "upload": up, "dataset": ds, "session": ts, "measurement": m,
            "note": n, "catalogue": cat, "batch": batch, "report": rep, "quotation": q}


def test_cross_tenant_reads_return_404():
    a, _ = signup("Org A")
    b, _ = signup("Org B")
    rec = _populate(a)
    bid = rec["battery"]["id"]
    for path in [
        f"/api/batteries/{bid}",
        f"/api/batteries/{bid}/uploads",
        f"/api/batteries/{bid}/datasets",
        f"/api/batteries/{bid}/history",
        f"/api/batteries/{bid}/measurements",
        f"/api/batteries/{bid}/notes",
        f"/api/batteries/{bid}/test-sessions",
        f"/api/batteries/{bid}/evidence",
        f"/api/batteries/{bid}/reports",
        f"/api/customers/{rec['customer']['id']}",
        f"/api/batches/{rec['batch']['id']}",
        f"/api/uploads/{rec['upload']['id']}/download",
        f"/api/datasets/{rec['dataset']['id']}",
        f"/api/datasets/{rec['dataset']['id']}/series",
        f"/api/datasets/{rec['dataset']['id']}/normalized.csv",
        f"/api/reports/{rec['report']['id']}",
        f"/api/reports/{rec['report']['id']}/pdf",
        f"/api/quotations/{rec['quotation']['id']}",
        f"/api/quotations/{rec['quotation']['id']}/pdf",
    ]:
        assert b.get(path).status_code == 404, path


def test_cross_tenant_writes_return_404():
    a, _ = signup("Org A")
    b, _ = signup("Org B")
    rec = _populate(a)
    bid = rec["battery"]["id"]
    attempts = [
        ("patch", f"/api/batteries/{bid}", {"notes": "hijack"}),
        ("post", f"/api/batteries/{bid}/status", {"status": "rejected", "reason": "x"}),
        ("post", f"/api/batteries/{bid}/notes", {"note_type": "general", "body": "x"}),
        ("post", f"/api/batteries/{bid}/service-events", {"event_type": "repair", "description": "x"}),
        ("post", f"/api/uploads/{rec['upload']['id']}/preview", {}),
        ("post", f"/api/uploads/{rec['upload']['id']}/import", {"acknowledge_warnings": True}),
        ("post", f"/api/measurements/{rec['measurement']['id']}/void", {"reason": "hijack"}),
        ("patch", f"/api/notes/{rec['note']['id']}", {"body": "x"}),
        ("patch", f"/api/customers/{rec['customer']['id']}", {"name": "x"}),
        ("patch", f"/api/catalogue/{rec['catalogue']['id']}", {"code": "X", "name": "x", "unit_price_paise": 1}),
        ("patch", f"/api/reports/{rec['report']['id']}", {"reviewer_conclusion": "x"}),
        ("post", f"/api/reports/{rec['report']['id']}/approve", {"acknowledge_checks": True}),
        ("patch", f"/api/quotations/{rec['quotation']['id']}", {"notes": "x"}),
        ("post", f"/api/quotations/{rec['quotation']['id']}/approve", None),
        ("post", "/api/quotations", {"battery_id": bid}),
        ("post", "/api/batteries", {"customer_id": rec["customer"]["id"]}),
    ]
    for method, path, body in attempts:
        r = getattr(b, method)(path, json=body) if body is not None else getattr(b, method)(path)
        assert r.status_code == 404, (method, path, r.status_code, r.text)
    # Nothing in org A changed.
    assert a.get(f"/api/batteries/{bid}").json()["status"] == "received"
    assert a.get(f"/api/customers/{rec['customer']['id']}").json()["name"] == "Private Customer"


def test_lists_and_search_do_not_leak():
    a, _ = signup("Org A")
    b, _ = signup("Org B")
    _populate(a)
    assert b.get("/api/batteries").json()["total"] == 0
    assert b.get("/api/batteries", params={"q": "SECRET"}).json()["total"] == 0
    assert b.get("/api/customers").json() == []
    assert b.get("/api/quotations").json() == []
    assert b.get("/api/catalogue").json() == []
    assert b.get("/api/audit").json()["items"][0]["action"] == "organization.created"
    d = b.get("/api/dashboard").json()
    assert d["total_batteries"] == 0 and d["open_quotations"]["items"] == []


def test_same_file_in_two_orgs_is_isolated():
    a, _ = signup("Org A")
    b, _ = signup("Org B")
    ba, bb = make_battery(a), make_battery(b)
    ua = upload_file(a, ba["id"], "x.csv", sample(CLEAN_CSV)).json()
    ub = upload_file(b, bb["id"], "x.csv", sample(CLEAN_CSV)).json()
    assert ua["sha256"] == ub["sha256"]
    preview = b.post(f"/api/uploads/{ub['id']}/preview", json={}).json()
    # The "file also attached elsewhere" check must not reveal org A's battery.
    assert not any(i["code"] == "FILE_ALSO_ON_OTHER_BATTERY" for i in preview["issues"])
