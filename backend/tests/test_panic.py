import httpx

from app.services import panic
from tests.conftest import *  # noqa: F401,F403

LOG = """Panic string: panic(cpu 4 caller 0xfffffff): "thermalmonitord: Missing sensor(s): TG0B, TP1a"
product: iPhone10,6
os_version: iPhone OS 16.7 (20H330)
"""


def test_rules_find_battery_sensor():
    result = panic.analyze_rules(LOG)
    titles = [f["title"] for f in result["findings"]]
    assert any("аккумулятора" in t for t in titles)
    assert result["device"] == "iPhone10,6"
    assert "TG0B" in result["sensors"]


def test_ai_used_when_key(monkeypatch):
    monkeypatch.setattr(panic.settings, "llm_api_key", "k")
    transport = httpx.MockTransport(lambda r: httpx.Response(200, json={"choices": [{"message": {"content": "Проверьте АКБ"}}]}))
    result = panic.check(LOG, transport)
    assert result["ai"] == "Проверьте АКБ" and result["ai_enabled"]


def test_ai_failure_falls_back_to_rules(monkeypatch):
    monkeypatch.setattr(panic.settings, "llm_api_key", "k")
    transport = httpx.MockTransport(lambda r: httpx.Response(500))
    result = panic.check(LOG, transport)
    assert result["ai"] is None and result["findings"]


def test_text_from_ips_json():
    data = b'{"bug_type":"210","os_version":"iPhone OS 17.1"}\n{"panicString":"Missing sensor(s): TG0B"}'
    assert "bug_type: 210" in panic.text_from_file("x.ips", data)


def test_attach_to_order(client, auth_headers, db):
    from sqlalchemy import select
    from app.models import Location, OrderHistory, OrderType
    from tests.test_orders import order_payload

    location = db.scalars(select(Location).order_by(Location.sort)).first()
    order_type = db.scalars(select(OrderType).order_by(OrderType.sort)).first()
    created = client.post("/api/orders", json=order_payload(location.id, order_type.id, {"name": "Клиент"}), headers=auth_headers).json()
    r = client.post("/api/panic/attach", json={"order_number": created["number"][1:], "summary": "АКБ"}, headers=auth_headers)
    assert r.status_code == 200 and r.json()["number"] == created["number"]
    texts = [h.text for h in db.scalars(select(OrderHistory).where(OrderHistory.order_id == created["id"]))]
    assert any(t and "Проверка паник-лога" in t for t in texts)
    assert client.post("/api/panic/attach", json={"order_number": "99999999", "summary": "x"}, headers=auth_headers).status_code == 404
