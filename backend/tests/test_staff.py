from sqlalchemy import select

from app.models import Employee, Location, Role
from app.security import hash_password


def make_employee(db, *, name, email, permissions, location):
    role = Role(name=f"Роль {email}", permissions=permissions, scopes={})
    employee = Employee(
        name=name,
        short_name=name,
        email=email,
        password_hash=hash_password("password123", rounds=4),
        role=role,
        locations=[location],
    )
    db.add(employee)
    db.commit()
    return employee


def test_permissions_catalog_groups_sections(client, auth_headers):
    response = client.get("/api/permissions", headers=auth_headers)

    assert response.status_code == 200
    data = response.json()
    assert data["sections"]
    assert data["scopes"]["orders"]["options"]["own"] == "Только свои"
    assert any(
        permission["code"] == "settingAccess"
        for section in data["sections"]
        for permission in section["permissions"]
    )


def test_role_crud_rejects_unknown_permission(client, auth_headers):
    invalid = client.post(
        "/api/roles",
        json={"name": "Некорректная роль", "permissions": ["missingPermission"], "scopes": {}},
        headers=auth_headers,
    )
    assert invalid.status_code == 400

    response = client.post(
        "/api/roles",
        json={"name": "Тестовая роль", "permissions": ["isMasterAccess"], "scopes": {"orders": "own"}},
        headers=auth_headers,
    )
    assert response.status_code == 200
    role_id = response.json()["id"]

    response = client.put(
        f"/api/roles/{role_id}",
        json={"name": "Обновлённая роль", "permissions": [], "scopes": {"orders": "all"}},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Обновлённая роль"
    assert client.delete(f"/api/roles/{role_id}", headers=auth_headers).status_code == 204


def test_employee_crud_password_and_owner_protection(client, auth_headers, owner, db):
    role_response = client.post(
        "/api/roles",
        json={"name": "Сотрудник", "permissions": [], "scopes": {}},
        headers=auth_headers,
    )
    role_id = role_response.json()["id"]
    location = db.scalars(select(Location)).first()
    payload = {
        "name": "Тестовый",
        "short_name": "Тест",
        "email": "new-employee@example.test",
        "role_id": role_id,
        "location_ids": [location.id],
        "password": "password123",
    }
    response = client.post("/api/employees", json=payload, headers=auth_headers)
    assert response.status_code == 200
    employee_id = response.json()["id"]
    assert "password_hash" not in response.json()

    update = {key: value for key, value in payload.items() if key != "password"}
    update["name"] = "Обновлённый"
    response = client.put(f"/api/employees/{employee_id}", json=update, headers=auth_headers)
    assert response.status_code == 200
    assert response.json()["name"] == "Обновлённый"
    assert "password_hash" not in response.json()

    response = client.post(
        f"/api/employees/{employee_id}/password",
        json={"password": "newpassword123"},
        headers=auth_headers,
    )
    assert response.status_code == 204
    login = client.post("/api/auth/login", json={"email": payload["email"], "password": "newpassword123"})
    assert login.status_code == 200

    assert client.delete(f"/api/employees/{employee_id}", headers=auth_headers).status_code == 204
    assert client.delete(f"/api/employees/{owner.id}", headers=auth_headers).status_code == 400


def test_employee_short_filters_by_role_permission(client, auth_headers, db):
    location = db.scalars(select(Location)).first()
    master = make_employee(
        db,
        name="Мастер",
        email="master@example.test",
        permissions=["isMasterAccess"],
        location=location,
    )
    manager = make_employee(
        db,
        name="Менеджер",
        email="manager@example.test",
        permissions=["isManagerAccess"],
        location=location,
    )

    masters = client.get(f"/api/employees/short?location_id={location.id}&master=1", headers=auth_headers)
    managers = client.get(f"/api/employees/short?location_id={location.id}&manager=1", headers=auth_headers)

    assert masters.status_code == 200
    employees = db.scalars(select(Employee).where(Employee.is_active.is_(True))).all()
    expected_masters = {
        employee.id
        for employee in employees
        if any(item.id == location.id for item in employee.locations)
        and "isMasterAccess" in (employee.role.permissions or [])
    }
    expected_managers = {
        employee.id
        for employee in employees
        if any(item.id == location.id for item in employee.locations)
        and "isManagerAccess" in (employee.role.permissions or [])
    }
    assert {employee["id"] for employee in masters.json()} == expected_masters
    assert {employee["id"] for employee in managers.json()} == expected_managers
    assert master.id in expected_masters
    assert manager.id in expected_managers