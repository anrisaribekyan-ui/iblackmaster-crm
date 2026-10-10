"""Чек-лист при приёме и выдаче, подпись клиента."""

import base64
import io

import pytest
from PIL import Image
from sqlalchemy import select

from app.config import settings
from app.models import Counteragent, Location, Order, OrderFile, OrderHistory, OrderStatus, OrderType


@pytest.fixture(autouse=True)
def uploads(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "uploads_dir", str(tmp_path))


@pytest.fixture()
def order(db, owner):
    c = Counteragent(name="Иван")
    db.add(c)
    db.flush()
    o = Order(number="C-1", location_id=db.scalars(select(Location)).first().id, order_type_id=db.scalars(select(OrderType)).first().id,
              counteragent_id=c.id, status_id=db.scalars(select(OrderStatus)).first().id, created_by_id=owner.id)
    db.add(o)
    db.commit()
    return o


def png_data_url():
    out = io.BytesIO()
    Image.new("RGBA", (300, 120), (0, 0, 0, 0)).save(out, "PNG")
    return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode()


def test_settings_items(client, auth_headers):
    assert "Face ID / Touch ID" in client.get("/api/settings/checklist", headers=auth_headers).json()["items"]
    r = client.put("/api/settings/checklist", headers=auth_headers, json={"items": [" Экран ", "Экран", "", "Камера"]})
    assert r.json()["items"] == ["Экран", "Камера"]


def test_checkout_and_signature(client, auth_headers, db, order):
    r = client.put(f"/api/orders/{order.id}/checklist", headers=auth_headers,
                   json={"stage": "out", "values": {"Экран": "ok", "Камера": "fail"}})
    assert r.status_code == 200 and r.json()["check_out"] == {"Экран": "ok", "Камера": "fail"}
    assert client.put(f"/api/orders/{order.id}/checklist", headers=auth_headers,
                      json={"stage": "out", "values": {"Экран": "broken"}}).status_code == 422
    text = db.scalars(select(OrderHistory).where(OrderHistory.type == "checklist")).one().text
    assert text == "Проверка (выдача): замечания — Камера"

    for _ in range(2):  # повторная подпись заменяет прежнюю
        assert client.post(f"/api/orders/{order.id}/signature", headers=auth_headers, json={"stage": "in", "image": png_data_url()}).status_code == 200
    files = db.scalars(select(OrderFile).where(OrderFile.order_id == order.id)).all()
    assert [f.filename for f in files] == ["Подпись клиента — приём.png"]
    bad = client.post(f"/api/orders/{order.id}/signature", headers=auth_headers, json={"stage": "in", "image": "data:image/png;base64,QUJD"})
    assert bad.status_code == 400
