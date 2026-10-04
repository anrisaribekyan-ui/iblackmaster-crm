from sqlalchemy import select

from app.models import Employee, Location, Role
from app.security import hash_password


def test_locations_list_is_sorted_and_includes_stores(client, auth_headers):
    response = client.get("/api/locations", headers=auth_headers)

    assert response.status_code == 200
    locations = response.json()
    assert len(locations) == 3
    assert [location["sort"] for location in locations] == [0, 1, 2]
    assert all(location["stores"] for location in locations)
    assert {"id", "name", "is_default"} <= locations[0]["stores"][0].keys()


def test_location_crud(client, auth_headers):
    response = client.post(
        "/api/locations",
        json={"name": "Новая точка", "address": "Адрес", "phones": "+7 900 000-00-00", "color": "#A1B2C3", "sort": 5},
        headers=auth_headers,
    )
    assert response.status_code == 200
    location_id = response.json()["id"]

    response = client.put(
        f"/api/locations/{location_id}",
        json={"name": "Обновлённая точка", "address": None, "phones": None, "color": "#112233", "sort": 1},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Обновлённая точка"
    assert response.json()["color"] == "#112233"

    response = client.delete(f"/api/locations/{location_id}", headers=auth_headers)
    assert response.status_code == 204
    names = [item["name"] for item in client.get("/api/locations", headers=auth_headers).json()]
    assert "Обновлённая точка" not in names


def test_cannot_delete_last_active_location(client, auth_headers, db):
    locations = db.scalars(select(Location).order_by(Location.sort)).all()
    for location in locations[:-1]:
        response = client.delete(f"/api/locations/{location.id}", headers=auth_headers)
        assert response.status_code == 204

    response = client.delete(f"/api/locations/{locations[-1].id}", headers=auth_headers)
    assert response.status_code == 400
    assert response.json()["message"] == "Нельзя удалить последнюю активную локацию"


def test_location_write_requires_setting_access(client, db):
    role = Role(name="Без настроек", permissions=[], scopes={})
    employee = Employee(
        name="Тест",
        short_name="Тест",
        email="no-settings@example.test",
        password_hash=hash_password("password123", rounds=4),
        role=role,
    )
    db.add(employee)
    db.commit()

    login = client.post("/api/auth/login", json={"email": employee.email, "password": "password123"})
    assert login.status_code == 200
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    response = client.post("/api/locations", json={"name": "Запрещено"}, headers=headers)
    assert response.status_code == 403