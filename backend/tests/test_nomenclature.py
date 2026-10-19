from decimal import Decimal

from sqlalchemy import func, select

from app.models import (
    Employee,
    Location,
    Nomenclature,
    NomenclatureGroup,
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


def test_nomenclature_card_history_and_days_left(client, auth_headers, db):
    from decimal import Decimal

    from sqlalchemy import select

    from app.models import CashRegister, Location, Nomenclature, Store
    from app.services import stock

    location = db.scalars(select(Location).order_by(Location.sort)).first()
    store = db.scalars(select(Store).where(Store.location_id == location.id)).first()
    register = db.scalars(select(CashRegister).where(CashRegister.location_id == location.id)).first()
    item = Nomenclature(code=770001, name="Карточный товар", is_work=False)
    db.add(item)
    db.flush()
    stock.receive(db, store.id, item.id, Decimal("10"), Decimal("50"))
    db.commit()
    r = client.post("/api/sales", headers=auth_headers, json={
        "location_id": location.id, "store_id": store.id,
        "positions": [{"nomenclature_id": item.id, "quantity": "3", "price": "200"}],
        "payments": [{"cash_register_id": register.id, "amount": "600"}],
    })
    assert r.status_code == 200, r.text

    card = client.get(f"/api/nomenclature/{item.id}/card", headers=auth_headers).json()
    assert Decimal(str(card["on_hand"])) == 7 and Decimal(str(card["used_30"])) == 3
    assert card["days_left"] == 70
    assert card["history"][0]["kind"] == "sale" and Decimal(str(card["history"][0]["quantity"])) == -3
    assert card["balances"][0]["store_id"] == store.id

def test_nomenclature_search_update_and_soft_delete(client, auth_headers, db):
    created = client.post(
        "/api/nomenclature",
        json={"name": "Ночная позиция", "article": "NIGHT-1", "is_work": True},
        headers=auth_headers,
    )
    assert created.status_code == 200, created.text
    item_id = created.json()["id"]

    found = client.get("/api/nomenclature/search", params={"q": "night-1"}, headers=auth_headers)
    assert found.status_code == 200
    assert [item["id"] for item in found.json()] == [item_id]

    # По-русски поиск не зависит от регистра (в SQLite для этого своя lower).
    by_name = client.get("/api/nomenclature/search", params={"q": "НОЧНАЯ"}, headers=auth_headers)
    assert [item["id"] for item in by_name.json()] == [item_id]

    updated = client.put(
        f"/api/nomenclature/{item_id}",
        json={"name": "Ночная позиция 2", "article": "NIGHT-2", "is_work": True},
        headers=auth_headers,
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "Ночная позиция 2"

    assert client.delete(f"/api/nomenclature/{item_id}", headers=auth_headers).status_code == 204
    assert client.get("/api/nomenclature/search", params={"q": "night-2"}, headers=auth_headers).json() == []
    assert db.get(Nomenclature, item_id).is_deleted is True


def test_nomenclature_group_update_and_delete(client, auth_headers, db):
    parent = client.post("/api/nomenclature-groups", json={"name": "Ночная группа"}, headers=auth_headers)
    assert parent.status_code == 200, parent.text
    parent_id = parent.json()["id"]
    child = client.post(
        "/api/nomenclature-groups",
        json={"name": "Ночная подгруппа", "parent_id": parent_id},
        headers=auth_headers,
    )
    assert child.status_code == 200, child.text
    child_id = child.json()["id"]

    updated = client.put(
        f"/api/nomenclature-groups/{child_id}",
        json={"name": "Ночная подгруппа 2", "parent_id": parent_id},
        headers=auth_headers,
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "Ночная подгруппа 2"

    assert client.delete(f"/api/nomenclature-groups/{child_id}", headers=auth_headers).status_code == 204
    assert client.delete(f"/api/nomenclature-groups/{parent_id}", headers=auth_headers).status_code == 204
