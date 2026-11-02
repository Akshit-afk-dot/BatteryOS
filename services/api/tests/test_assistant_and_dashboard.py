from types import SimpleNamespace

from app.routers import assistant
from app.services import llm
from conftest import invite_member, make_battery, signup


def test_chat_requires_ai_key():
    c, _ = signup()
    r = c.post("/api/assistant/chat", json={"messages": [{"role": "user", "content": "hi"}]})
    assert r.status_code == 503


def _block(**kw):
    return SimpleNamespace(**kw)


def test_chat_tool_loop_returns_proposals_without_applying(monkeypatch):
    c, _ = signup()
    b = make_battery(c)
    calls = []

    def fake_turn(*, system, messages, tools, effort="low"):
        calls.append(messages)
        if len(calls) == 1:
            return SimpleNamespace(stop_reason="tool_use", content=[
                _block(type="text", text="Looking that up."),
                _block(type="tool_use", id="t1", name="get_battery", input={"battery_id": b["bos_id"]}),
            ])
        if len(calls) == 2:
            return SimpleNamespace(stop_reason="tool_use", content=[
                _block(type="tool_use", id="t2", name="propose_status_change", input={"battery_id": b["bos_id"], "new_status": "testing", "reason": ""}),
                _block(type="tool_use", id="t3", name="propose_status_change", input={"battery_id": b["bos_id"], "new_status": "dispatched", "reason": ""}),
            ])
        return SimpleNamespace(stop_reason="end_turn", content=[_block(type="text", text="I proposed moving it to testing.")])

    monkeypatch.setattr(llm, "is_configured", lambda: True)
    monkeypatch.setattr(llm, "tool_turn", fake_turn)
    r = c.post("/api/assistant/chat", json={"messages": [{"role": "user", "content": f"Move {b['bos_id']} to testing"}]}).json()
    assert r["reply"] == "I proposed moving it to testing."
    assert r["proposals"] == [{"type": "status_change", "battery_id": b["id"], "bos_id": b["bos_id"], "from": "received", "to": "testing", "reason": None}]
    # The invalid transition was rejected by the server-side tool and returned to the model as data.
    tool_results = calls[2][-1]["content"]
    assert "cannot move" in tool_results[1]["content"]
    # Nothing was applied.
    assert c.get(f"/api/batteries/{b['id']}").json()["status"] == "received"
    # Applying goes through the normal endpoint and is audited as assistant-proposed.
    c.post(f"/api/batteries/{b['id']}/status", json={"status": "testing", "via_assistant": True})
    ev = next(e for e in c.get(f"/api/batteries/{b['id']}/history").json() if e["action"] == "battery.status_changed")
    assert "assistant" in ev["details"]["trigger"]


def test_assistant_tools_are_tenant_scoped():
    a, _ = signup()
    b_client, _ = signup()
    foreign = make_battery(b_client)
    from app.db import SessionLocal
    from app.deps import Ctx
    from app.models import AuthSession, OrganizationMember, User

    db = SessionLocal()
    me = a.get("/api/auth/me").json()
    user = db.get(User, me["user"]["id"])
    member = db.query(OrganizationMember).filter_by(user_id=user.id).one()
    ctx = Ctx(db=db, user=user, session=db.query(AuthSession).filter_by(user_id=user.id).first(), org=member.organization, member=member)
    runner = assistant.ToolRunner(ctx)
    assert "error" in runner.run("get_battery", {"battery_id": foreign["bos_id"]})
    assert runner.run("search_batteries", {"query": "", "status": "any", "limit": 10})["total_matches"] == 0
    assert "error" in runner.run("propose_note", {"battery_id": foreign["bos_id"], "text": "x"})
    db.close()


def test_intake_pattern_extraction():
    c, _ = signup()
    text = "Received from Sharma E-Rickshaw: 51.2V 105Ah LiFePO4 pack, 16S1P, S/N: SR-2291-A. BMS beeping."
    r = c.post("/api/assistant/extract-intake", json={"text": text}).json()
    assert r["source"] == "pattern"
    got = {f["field"]: f["value"] for f in r["fields"]}
    assert got == {
        "nominal_voltage_v": 51.2,
        "rated_capacity_ah": 105.0,
        "chemistry": "LFP",
        "pack_configuration": "16S1P",
        "serial_number": "SR-2291-A",
        "battery_type": "e_rickshaw",
    }
    assert all(f["quote"] in text for f in r["fields"])


def test_ai_intake_keeps_only_quoted_values(monkeypatch):
    c, _ = signup()
    monkeypatch.setattr(llm, "is_configured", lambda: True)
    monkeypatch.setattr(
        llm,
        "structured",
        lambda **_: {"fields": [
            {"field": "chemistry", "value": "NMC", "quote": "NMC pack"},
            {"field": "rated_capacity_ah", "value": "40", "quote": "40 Ah"},
            {"field": "serial_number", "value": "INVENTED", "quote": "serial INVENTED"},
        ]},
    )
    r = c.post("/api/assistant/extract-intake", json={"text": "Customer says it is an NMC pack, 40 Ah."}).json()
    assert {f["field"]: f["value"] for f in r["fields"]} == {"chemistry": "NMC", "rated_capacity_ah": 40.0}


def test_dashboard_counts_come_from_records():
    owner, _ = signup()
    staff, _ = invite_member(owner, "staff")
    b1 = make_battery(staff)
    make_battery(staff)
    staff.post(f"/api/batteries/{b1['id']}/status", json={"status": "awaiting_data"})
    d = staff.get("/api/dashboard").json()
    assert d["total_batteries"] == 2
    assert d["by_status"]["awaiting_data"] == 1 and d["by_status"]["received"] == 1
    assert [x["id"] for x in d["awaiting_data"]] == [b1["id"]]
    assert d["open_quotations"]["counts"] == {"draft": 0, "approved": 0, "sent": 0}


def test_audit_log_filters_and_pagination():
    c, _ = signup()
    for _ in range(3):
        make_battery(c)
    page = c.get("/api/audit", params={"limit": 2, "action": "battery."}).json()
    assert len(page["items"]) == 2 and page["next_before"]
    rest = c.get("/api/audit", params={"limit": 2, "action": "battery.", "before": page["next_before"]}).json()
    assert len(rest["items"]) == 1 and rest["next_before"] is None
    assert page["items"][0]["actor"]["full_name"] == "Owner Person"
