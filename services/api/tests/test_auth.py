from conftest import HEADERS, PASSWORD, invite_member, new_client, signup


def test_signup_creates_workspace_and_owner_session():
    c, me = signup("Sharma Battery Works")
    assert me["organization"]["name"] == "Sharma Battery Works"
    assert me["role"] == "owner"
    assert "reports.approve" in me["permissions"]
    assert me["ai"]["configured"] is False


def test_duplicate_email_rejected():
    c, me = signup()
    r = new_client().post(
        "/api/auth/signup",
        json={"organization_name": "Other", "full_name": "X", "email": me["email"], "password": PASSWORD},
    )
    assert r.status_code == 409


def test_short_password_rejected():
    r = new_client().post(
        "/api/auth/signup",
        json={"organization_name": "Org", "full_name": "X", "email": "short@example.com", "password": "short"},
    )
    assert r.status_code == 422


def test_login_logout_and_wrong_password():
    c, me = signup()
    other = new_client()
    assert other.post("/api/auth/login", json={"email": me["email"], "password": "wrong-password!"}).status_code == 401
    assert other.post("/api/auth/login", json={"email": me["email"].upper(), "password": PASSWORD}).status_code == 200
    assert other.get("/api/auth/me").status_code == 200
    assert other.post("/api/auth/logout").status_code == 200
    assert other.get("/api/auth/me").status_code == 401
    # The first session is unaffected.
    assert c.get("/api/auth/me").status_code == 200


def test_unauthenticated_requests_are_rejected():
    c = new_client()
    assert c.get("/api/batteries").status_code == 401
    assert c.get("/api/dashboard").status_code == 401


def test_writes_without_client_header_are_blocked():
    from fastapi.testclient import TestClient

    from app.main import app

    bare = TestClient(app)
    r = bare.post("/api/auth/login", json={"email": "a@example.com", "password": "x"})
    assert r.status_code == 403


def test_login_rate_limit():
    c, me = signup()
    other = new_client()
    codes = [other.post("/api/auth/login", json={"email": me["email"], "password": "nope-nope-nope"}).status_code for _ in range(11)]
    assert codes[-1] == 429


def test_invitation_flow_and_roles():
    owner, me = signup()
    staff, email = invite_member(owner, "staff", "Ravi Staff")
    sme = staff.get("/api/auth/me").json()
    assert sme["role"] == "staff"
    assert sme["organization"]["id"] == me["organization"]["id"]
    assert "reports.approve" not in sme["permissions"]
    members = owner.get("/api/organizations/current/members").json()
    assert {m["email"] for m in members} >= {email}


def test_invitation_token_single_use_and_revocation():
    owner, _ = signup()
    r = owner.post("/api/organizations/current/invitations", json={"email": "tech@example.com", "role": "technician"})
    token = r.json()["token"]
    info = new_client().get(f"/api/invitations/{token}").json()
    assert info["valid"] and info["role"] == "technician"
    c = new_client()
    assert c.post(f"/api/invitations/{token}/accept", json={"full_name": "T", "password": PASSWORD}).status_code == 200
    assert new_client().post(f"/api/invitations/{token}/accept", json={"full_name": "T", "password": PASSWORD}).status_code == 410

    r = owner.post("/api/organizations/current/invitations", json={"email": "late@example.com", "role": "staff"})
    inv_id, token2 = r.json()["id"], r.json()["token"]
    assert owner.delete(f"/api/organizations/current/invitations/{inv_id}").status_code == 200
    assert new_client().get(f"/api/invitations/{token2}").json()["valid"] is False


def test_existing_user_joins_second_workspace_and_switches():
    a, me_a = signup("Workspace A")
    b, me_b = signup("Workspace B")
    r = b.post("/api/organizations/current/invitations", json={"email": me_a["email"], "role": "staff"})
    token = r.json()["token"]
    assert new_client().get(f"/api/invitations/{token}").json()["existing_user"] is True
    joiner = new_client()
    assert joiner.post(f"/api/invitations/{token}/accept", json={"password": "wrong-password-x"}).status_code == 401
    assert joiner.post(f"/api/invitations/{token}/accept", json={"password": PASSWORD}).status_code == 200
    me = joiner.get("/api/auth/me").json()
    assert me["organization"]["name"] == "Workspace B" and me["role"] == "staff"
    assert len(me["memberships"]) == 2
    assert joiner.post("/api/auth/switch-organization", json={"organization_id": me_a["organization"]["id"]}).status_code == 200
    me = joiner.get("/api/auth/me").json()
    assert me["organization"]["name"] == "Workspace A" and me["role"] == "owner"


def test_cannot_switch_to_foreign_workspace():
    a, _ = signup()
    b, me_b = signup()
    assert a.post("/api/auth/switch-organization", json={"organization_id": me_b["organization"]["id"]}).status_code == 404


def test_last_owner_cannot_be_demoted_and_admin_rules():
    owner, me = signup()
    admin, _ = invite_member(owner, "admin")
    members = owner.get("/api/organizations/current/members").json()
    owner_member = next(m for m in members if m["role"] == "owner")
    # Admin cannot demote the owner; owner cannot change themselves.
    assert admin.patch(f"/api/organizations/current/members/{owner_member['id']}", json={"role": "staff"}).status_code == 403
    assert owner.patch(f"/api/organizations/current/members/{owner_member['id']}", json={"role": "staff"}).status_code == 400
    # Admin cannot invite another admin.
    assert admin.post("/api/organizations/current/invitations", json={"email": "x@example.com", "role": "admin"}).status_code == 403


def test_deactivated_member_loses_access():
    owner, _ = signup()
    staff, email = invite_member(owner, "staff")
    m = next(m for m in owner.get("/api/organizations/current/members").json() if m["email"] == email)
    assert owner.patch(f"/api/organizations/current/members/{m['id']}", json={"is_active": False}).status_code == 200
    assert staff.get("/api/batteries").status_code == 403


def test_change_password_revokes_other_sessions():
    c, me = signup()
    other = new_client()
    other.post("/api/auth/login", json={"email": me["email"], "password": PASSWORD})
    r = c.post("/api/auth/password", json={"current_password": PASSWORD, "new_password": "a-brand-new-passphrase"})
    assert r.status_code == 200
    assert other.get("/api/auth/me").status_code == 401
    assert c.get("/api/auth/me").status_code == 200
    assert HEADERS
