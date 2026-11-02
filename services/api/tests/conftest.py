import os
import shutil
import stat
import sys
import tempfile
import uuid
from pathlib import Path

import pytest

_TMP = Path(tempfile.mkdtemp(prefix="batteryos-test-"))
os.environ["DATABASE_URL"] = f"sqlite:///{(_TMP / 'test.db').as_posix()}"
os.environ["STORAGE_DIR"] = str(_TMP / "storage")
os.environ["AI_ENABLED"] = "false"
os.environ["ANTHROPIC_API_KEY"] = ""
os.environ["AUTO_MIGRATE"] = "true"

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.security import login_limiter, signup_limiter  # noqa: E402

SAMPLES = Path(__file__).resolve().parents[3] / "samples"
HEADERS = {"x-batteryos-client": "web"}
PASSWORD = "correct-horse-battery"


@pytest.fixture(scope="session", autouse=True)
def _app_lifespan():
    # Running the lifespan applies the Alembic migrations to the test database.
    with TestClient(app, headers=HEADERS):
        yield

    from app.db import engine

    engine.dispose()

    def _force(func, path, *_):
        try:
            os.chmod(path, stat.S_IWRITE)  # stored files are read-only by design
            func(path)
        except OSError:
            pass

    shutil.rmtree(_TMP, onerror=_force)


@pytest.fixture(autouse=True)
def _reset_limits():
    login_limiter.clear()
    signup_limiter.clear()


def new_client() -> TestClient:
    return TestClient(app, headers=HEADERS)


def signup(org_name: str = "Test Refurbishers", name: str = "Owner Person") -> tuple[TestClient, dict]:
    c = new_client()
    email = f"{uuid.uuid4().hex[:10]}@example.com"
    r = c.post("/api/auth/signup", json={"organization_name": org_name, "full_name": name, "email": email, "password": PASSWORD})
    assert r.status_code == 201, r.text
    me = c.get("/api/auth/me").json()
    me["email"] = email
    return c, me


def invite_member(owner: TestClient, role: str, name: str = "Member Person") -> tuple[TestClient, str]:
    email = f"{uuid.uuid4().hex[:10]}@example.com"
    r = owner.post("/api/organizations/current/invitations", json={"email": email, "role": role})
    assert r.status_code == 201, r.text
    token = r.json()["token"]
    c = new_client()
    r = c.post(f"/api/invitations/{token}/accept", json={"full_name": name, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return c, email


def make_battery(c: TestClient, **fields) -> dict:
    body = {
        "battery_type": "e_rickshaw",
        "chemistry": "LFP",
        "nominal_voltage_v": 51.2,
        "rated_capacity_ah": 30,
        "pack_configuration": "16S1P",
        "serial_number": "SN-TEST-1",
        "provenance": {"chemistry": "nameplate", "rated_capacity_ah": "nameplate", "nominal_voltage_v": "nameplate"},
    }
    body.update(fields)
    r = c.post("/api/batteries", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def upload_file(c: TestClient, battery_id: str, name: str, data: bytes, content_type: str = "text/csv"):
    return c.post(f"/api/batteries/{battery_id}/uploads", files={"file": (name, data, content_type)})


def sample(name: str) -> bytes:
    return (SAMPLES / name).read_bytes()


CLEAN_CSV = "SYNTHETIC_capacity_test_16S_LFP_clean.csv"
ISSUES_CSV = "SYNTHETIC_bms_export_with_issues.csv"
NO_TIME_CSV = "SYNTHETIC_cell_summary_no_time_column.csv"
