from decimal import Decimal

from sqlalchemy import func, select

from app.models import (
    Employee,
    Location,
    Nomenclature,
    NomenclatureGroup,
    NomenclaturePrice,
    PriceType,
    Role,
    Store,
)
from app.security import hash_password
from app.services import stock


def test_nomenclature_autocode_prices_and_location_stock(client, auth_headers, db):
    previous_code = db.scalar(select(func.max(Nomenclature.code))) or 0
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    store = db.scalars(select(Store).where(Store.location_id == location.id)).first()
    price_type = PriceType(name="Тестовая цена", sort=999)
    db.add(price_type)
    db.commit()

    response = client.post(
        "/api/nomenclature",
        json={
            "name": "Тестовый аккумулятор",
            "article": "BAT-01",
            "purchase_price": "60.00",
            "prices": [{"price_type_id": price_type.id, "price": "120.50"}],
        },
        headers=auth_headers,
    )
    assert response.status_code == 200
    item_id = response.json()["id"]
    assert response.json()["code"] == previous_code + 1
    assert Decimal(response.json()["prices"][0]["price"]) == Decimal("121")  # копейки округляются

    stock.receive(db, store.id, item_id, Decimal("3"), Decimal("60"))
    db.commit()
    response = client.get(
        "/api/nomenclature",
        params={"q": "bat-01", "location_id": location.id},
        headers=auth_headers,
    )
    assert response.status_code == 200
    listed = response.json()["items"][0]
    assert listed["stock_quantity"] == "3.000"
    assert listed["purchase_price"] == "60.00"
    assert listed["prices"][0]["price_type_id"] == price_type.id


def test_purchase_price_is_hidden_without_permission(client, db):
    location = db.scalars(select(Location)).first()
    role = Role(name="Только номенклатура", permissions=["nomenclatureAccess"], scopes={})
    employee = Employee(
        name="Без закупочной цены",
        short_name="Без цены",
        email="no-purchase-price@example.test",
        password_hash=hash_password("password123", rounds=4),
        role=role,
        locations=[location],
    )
    db.add(employee)
    item = Nomenclature(code=9999, name="Скрытая себестоимость", purchase_price=Decimal("75.00"))
    db.add(item)
    db.commit()
    login = client.post("/api/auth/login", json={"email": employee.email, "password": "password123"})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    response = client.get("/api/nomenclature", params={"q": "Скрытая себестоимость"}, headers=headers)

    assert response.status_code == 200
    assert response.json()["items"][0]["purchase_price"] is None


def test_group_tree_and_price_types(client, auth_headers, db):
    parent = NomenclatureGroup(name="Телефоны")
    db.add(parent)
    db.commit()
    response = client.post(
        "/api/nomenclature-groups",
        json={"name": "Аккумуляторы", "parent_id": parent.id},
        headers=auth_headers,
    )
    assert response.status_code == 200
    child_id = response.json()["id"]

    tree = client.get("/api/nomenclature-groups", headers=auth_headers).json()
    assert next(node for node in tree if node["id"] == parent.id)["children"][0]["id"] == child_id
    assert client.get("/api/price-types", headers=auth_headers).status_code == 200
