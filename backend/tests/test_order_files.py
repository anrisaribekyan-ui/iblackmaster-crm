"""Фото при приёме (C9): загрузка с уменьшением, превью, доступ, удаление."""

import io
from datetime import timedelta

import pytest
from PIL import Image
from sqlalchemy import select

from app.config import settings
from app.db import utcnow
from app.models import Counteragent, Location, Order, OrderFile, OrderHistory, OrderStatus, OrderType


@pytest.fixture(autouse=True)
def uploads(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "uploads_dir", str(tmp_path))
    return tmp_path


@pytest.fixture()
def order(db, owner):
    client = Counteragent(name="Иван", phones="79161866119")
    db.add(client)
    db.flush()
    o = Order(number="F-1", location_id=db.scalars(select(Location)).first().id, order_type_id=db.scalars(select(OrderType)).first().id,
              counteragent_id=client.id, status_id=db.scalars(select(OrderStatus)).first().id, created_by_id=owner.id)
    db.add(o)
    db.commit()
    return o


def photo(w=4000, h=3000):
    out = io.BytesIO()
    Image.new("RGB", (w, h), (200, 30, 30)).save(out, "JPEG", quality=95)
    return out.getvalue()


def test_upload_resizes_and_serves_thumbnail(client, auth_headers, db, order, uploads):
    r = client.post(f"/api/orders/{order.id}/files", headers=auth_headers,
                    files=[("files", ("скол.jpg", photo(), "image/jpeg")), ("files", ("акт.pdf", b"%PDF-1.4 test", "application/pdf"))])
    assert r.status_code == 200, r.text
    items = r.json()
    assert [i["is_image"] for i in items] == [True, False]

    full = client.get(f"/api/orders/{order.id}/files/{items[0]['id']}", headers=auth_headers)
    assert max(Image.open(io.BytesIO(full.content)).size) == 1920
    thumb = client.get(f"/api/orders/{order.id}/files/{items[0]['id']}?thumb=1", headers=auth_headers)
    assert max(Image.open(io.BytesIO(thumb.content)).size) == 400
    assert client.get(f"/api/orders/{order.id}/files/{items[0]['id']}").status_code == 401  # без входа — нельзя

    assert db.scalars(select(OrderHistory).where(OrderHistory.type == "file")).one().text == "Файлов: 2"
    assert len(client.get(f"/api/orders/{order.id}/files", headers=auth_headers).json()) == 2


def test_rejects_wrong_type_and_rolls_back(client, auth_headers, db, order, uploads):
    r = client.post(f"/api/orders/{order.id}/files", headers=auth_headers,
                    files=[("files", ("ok.jpg", photo(100, 100), "image/jpeg")), ("files", ("virus.exe", b"MZ", "application/octet-stream"))])
    assert r.status_code == 400
    assert db.scalars(select(OrderFile)).all() == []
    assert not any(p.is_file() for p in uploads.rglob("*"))  # уже записанное фото удалено


def test_delete_rules(client, auth_headers, db, order, owner):
    item = client.post(f"/api/orders/{order.id}/files", headers=auth_headers,
                       files=[("files", ("a.jpg", photo(100, 100), "image/jpeg"))]).json()[0]
    assert client.delete(f"/api/orders/{order.id}/files/{item['id']}", headers=auth_headers).status_code == 204
    assert client.get(f"/api/orders/{order.id}/files", headers=auth_headers).json() == []
