from decimal import Decimal

from sqlalchemy import select

from app.models import Location, Nomenclature, Store
from app.services import stock


def test_store_crud_and_default_switch(client, auth_headers, db):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    original = db.scalars(select(Store).where(Store.location_id == location.id)).first()

    response = client.post(
        "/api/stores",
        json={"location_id": location.id, "name": "Запасной склад", "is_default": True},
        headers=auth_headers,
    )
    assert response.status_code == 200
    first_id = response.json()["id"]
    assert response.json()["is_default"] is True

    response = client.post(
        "/api/stores",
        json={"location_id": location.id, "name": "Ещё один склад", "is_default": True},
        headers=auth_headers,
    )
    assert response.status_code == 200
    second_id = response.json()["id"]
    stores = client.get(f"/api/stores?location_id={location.id}", headers=auth_headers).json()
    assert next(item for item in stores if item["id"] == first_id)["is_default"] is False
    assert next(item for item in stores if item["id"] == original.id)["is_default"] is False

    response = client.put(
        f"/api/stores/{first_id}",
        json={"location_id": location.id, "name": "Основной склад", "is_default": True},
        headers=auth_headers,
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Основной склад"
    stores = client.get(f"/api/stores?location_id={location.id}", headers=auth_headers).json()
    assert next(item for item in stores if item["id"] == second_id)["is_default"] is False

    response = client.delete(f"/api/stores/{second_id}", headers=auth_headers)
    assert response.status_code == 204
    assert second_id not in {item["id"] for item in client.get("/api/stores", headers=auth_headers).json()}


def test_cannot_delete_store_with_stock(client, auth_headers, db):
    store = db.scalars(select(Store).order_by(Store.id)).first()
    product = Nomenclature(code=999999, name="Тестовый товар", is_work=False)
    db.add(product)
    db.flush()
    stock.receive(db, store.id, product.id, Decimal("1"), Decimal("50"))
    db.commit()

    response = client.delete(f"/api/stores/{store.id}", headers=auth_headers)

    assert response.status_code == 400
    assert response.json()["message"] == "На складе есть товар"


def test_update_unknown_store_returns_404(client, auth_headers, db):
    location = db.scalars(select(Location)).first()
    response = client.put(
        "/api/stores/999999",
        json={"location_id": location.id, "name": "Не найден", "is_default": False},
        headers=auth_headers,
    )
    assert response.status_code == 404