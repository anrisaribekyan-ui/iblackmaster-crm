"""«Закупки» → заказ у поставщика: CRM проверяет право и пересылает в сервис автозаказа с токеном."""

import httpx
import pytest

from app.api import supplier_orders
from app.config import settings
from tests.test_tasks import login, make_employee

SEEN: list[httpx.Request] = []


def handler(request: httpx.Request) -> httpx.Response:
    SEEN.append(request)
    if request.headers.get("X-Zakupka-Token") != "secret-token":
        return httpx.Response(401, json={"error": "нет доступа"})
    if request.url.path == "/config":
        return httpx.Response(200, json={"live": False, "suppliers": [{"id": "moba", "doska": "moba", "name": "Moba",
                                                                        "accounts": [{"id": "anri", "name": "Анри"}]}]})
    if request.url.path == "/quote":
        return httpx.Response(200, json={"items": [{"id": "a", "candidates": []}], "live": False})
    if request.url.path == "/order":
        body = httpx.Request("POST", "/", content=request.content).read()
        import json
        data = json.loads(body)
        if data["lines"][0]["product_id"] == "999":
            return httpx.Response(400, json={"error": "сумма больше лимита"})
        return httpx.Response(200, json={"status": "dry_run_ok", "comment": data["comment"]})
    return httpx.Response(404, json={"error": "not found"})


@pytest.fixture()
def service(monkeypatch):
    SEEN.clear()
    monkeypatch.setattr(settings, "zakupka_url", "http://zakupka")
    monkeypatch.setattr(settings, "zakupka_token", "secret-token")
    monkeypatch.setattr(supplier_orders, "transport", httpx.MockTransport(handler))


def test_config_quote_order_proxy(client, auth_headers, service):
    cfg = client.get("/api/supplier-orders/config", headers=auth_headers).json()
    assert cfg["enabled"] is True and cfg["suppliers"][0]["id"] == "moba"
    r = client.post("/api/supplier-orders/quote", json={"supplier": "moba", "items": [{"id": "a", "text": "дисплей"}]},
                    headers=auth_headers)
    assert r.status_code == 200 and r.json()["items"][0]["id"] == "a"
    order = {"supplier": "moba", "request_id": "req-00000001", "lines": [{"product_id": "1", "qty": 1, "price": 100}]}
    r = client.post("/api/supplier-orders/order", json=order, headers=auth_headers)
    assert r.status_code == 200 and r.json()["status"] == "dry_run_ok"
    assert r.json()["comment"].startswith("Закупка iBlackMaster")
    # ошибка сервиса — понятный текст, не 500
    order["lines"][0]["product_id"] = "999"
    r = client.post("/api/supplier-orders/order", json=order, headers=auth_headers)
    assert r.status_code == 400 and "лимита" in r.json()["message"]
    assert all(req.headers["X-Zakupka-Token"] == "secret-token" for req in SEEN)


def test_disabled_and_permission(client, auth_headers, db, monkeypatch):
    monkeypatch.setattr(settings, "zakupka_url", "")
    assert client.get("/api/supplier-orders/config", headers=auth_headers).json() == {"enabled": False, "live": False, "suppliers": []}
    r = client.post("/api/supplier-orders/quote", json={"supplier": "moba", "items": [{"id": "a", "text": "x"}]}, headers=auth_headers)
    assert r.status_code == 400
    make_employee(db, name="Мастер", email="so@x.test", permissions=[])
    assert client.get("/api/supplier-orders/config", headers=login(client, "so@x.test")).status_code == 403
