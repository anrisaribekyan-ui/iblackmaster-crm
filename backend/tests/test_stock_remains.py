from decimal import Decimal

from sqlalchemy import select

from app.models import Employee, Location, Nomenclature, Role, Store
from app.security import hash_password
from app.services import stock


def test_stock_remains_search_filters_and_price_visibility(client, db):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    store = db.scalars(select(Store).where(Store.location_id == location.id)).first()
    item = Nomenclature(code=770101, name="Остаток акб", article="BAT-REM-01", is_work=False)
    role = Role(name="Только остатки", permissions=["remainAccess"], scopes={})
    employee = Employee(
        name="Кладовщик",
        short_name="Кладовщик",
        email="remains-reader@example.test",
        password_hash=hash_password("password123", rounds=4),
        role=role,
        locations=[location],
    )
    db.add_all([item, employee])
    db.flush()
    stock.receive(db, store.id, item.id, Decimal("3"), Decimal("40.00"))
    db.commit()
    login = client.post("/api/auth/login", json={"email": employee.email, "password": "password123"})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    response = client.get(
        "/api/stock/remains",
        params={"location_id": location.id, "store_id": store.id, "q": "bat-rem", "only_positive": "true"},
        headers=headers,
    )

    assert response.status_code == 200
    assert len(response.json()) == 1
    assert response.json()[0]["quantity"] == "3.000"
    assert response.json()[0]["avg_purchase_price"] is None
    assert response.json()[0]["total"] is None