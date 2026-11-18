"""Фото при приёме (C9): загрузка с уменьшением, превью, доступ, удаление."""

import io

import pytest
from PIL import Image
from sqlalchemy import select

from app.config import settings
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


def test_any_file_with_retention_and_purge(client, auth_headers, db, order, uploads):
    from datetime import timedelta

    from app.api.order_files import purge_expired
    from app.db import utcnow

    # Прочий файл без выбора срока — час; фото без выбора — навсегда; «never» — навсегда
    r = client.post(f"/api/orders/{order.id}/files", headers=auth_headers,
                    files=[("files", ("прошивка.zip", b"PK\x03\x04data", "application/zip")), ("files", ("a.jpg", photo(100, 100), "image/jpeg"))])
    assert r.status_code == 200, r.text
    zipf, img = r.json()
    assert zipf["expires_at"] is not None and img["expires_at"] is None
    r2 = client.post(f"/api/orders/{order.id}/files", headers=auth_headers, data={"keep": "never"}, files=[("files", ("n.txt", b"hello", "text/plain"))])
    assert r2.json()[0]["expires_at"] is None
    r3 = client.post(f"/api/orders/{order.id}/files", headers=auth_headers, data={"keep": "30d"}, files=[("files", ("m.txt", b"hello", "text/plain"))])
    assert r3.json()[0]["expires_at"] is not None
    assert client.post(f"/api/orders/{order.id}/files", headers=auth_headers, data={"keep": "5y"}, files=[("files", ("x.txt", b"1", "text/plain"))]).status_code == 400
    # Скачивается как вложение, а не открывается на странице
    d = client.get(f"/api/orders/{order.id}/files/{zipf['id']}", headers=auth_headers)
    assert d.headers["content-disposition"].startswith("attachment")
    # Просрочка: удаляется и из базы, и с диска
    item = db.get(OrderFile, zipf["id"])
    item.expires_at = utcnow().replace(tzinfo=None) - timedelta(minutes=1)
    db.commit()
    assert purge_expired(db) == 1
    assert db.get(OrderFile, zipf["id"]) is None
