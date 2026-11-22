"""Персональные фоны назначает только владелец CRM; изображения не публичные."""

import io

from PIL import Image
from sqlalchemy import select

from app.config import settings
from app.models import Employee, Location, Role
from app.security import create_access_token, hash_password


def make_employee(db, *, name, email, permissions, location):
    role = Role(name=f"Роль {email}", permissions=permissions, scopes={})
    employee = Employee(
        name=name, short_name=name, email=email,
        password_hash=hash_password("password123", rounds=4),
        role=role, locations=[location],
    )
    db.add(employee)
    db.commit()
    return employee


def png_bytes() -> bytes:
    image = Image.new("RGB", (320, 200), (42, 90, 125))
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


def test_background_for_one_employee_only_and_owner_control(client, auth_headers, db, owner, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "uploads_dir", str(tmp_path))
    location = db.scalars(select(Location)).first()
    employee = make_employee(
        db, name="Получатель", email="bg-worker@example.test",
        permissions=["settingAccess"], location=location,
    )
    other = make_employee(
        db, name="Другой", email="bg-other@example.test",
        permissions=["settingAccess"], location=location,
    )
    target = f"/api/employees/{employee.id}/background"
    worker_headers = {"Authorization": f"Bearer {create_access_token(employee.id)}"}
    other_headers = {"Authorization": f"Bearer {create_access_token(other.id)}"}
    photo = {"file": ("wallpaper.png", png_bytes(), "image/png")}

    assert client.post(target, files=photo, headers=worker_headers).status_code == 403
    assert client.post(target, files=photo, headers=other_headers).status_code == 403
    assert client.get(target, headers=other_headers).status_code == 403
    assert client.get(target, headers=worker_headers).status_code == 404

    invalid = client.post(
        target,
        files={"file": ("bad.png", b"not a valid picture", "image/png")},
        headers=auth_headers,
    )
    assert invalid.status_code == 400

    uploaded = client.post(target, files=photo, headers=auth_headers)
    assert uploaded.status_code == 200, uploaded.text
    version = uploaded.json()["background_version"]
    assert len(version) == 32

    employees = client.get("/api/employees", headers=auth_headers).json()
    by_id = {row["id"]: row for row in employees}
    assert by_id[employee.id]["background_version"] == version
    assert by_id[other.id]["background_version"] is None
    assert by_id[owner.id]["background_version"] is None

    self_profile = client.get("/api/auth/me", headers=worker_headers)
    assert self_profile.status_code == 200
    assert self_profile.json()["background_version"] == version
    assert client.get("/api/auth/me", headers=other_headers).json()["background_version"] is None

    background = client.get(target, headers=worker_headers)
    assert background.status_code == 200
    assert background.headers["content-type"].startswith("image/jpeg")
    with Image.open(io.BytesIO(background.content)) as image:
        assert image.size == (320, 200)
        assert image.format == "JPEG"

    assert client.delete(target, headers=worker_headers).status_code == 403
    assert client.delete(target, headers=auth_headers).status_code == 204
    assert client.get(target, headers=worker_headers).status_code == 404
    assert client.get("/api/auth/me", headers=worker_headers).json()["background_version"] is None
    assert not list((tmp_path / "employee-backgrounds" / str(employee.id)).glob("*.jpg"))
