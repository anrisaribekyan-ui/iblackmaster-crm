"""SMS-уведомления: шаблоны на статусы, очередь, замена неотправленного, пауза, лимит, журнал, отслеживание по QR."""

from datetime import timedelta

import pytest
from sqlalchemy import select

from app.config import settings
from app.db import utcnow
from app.models import (
    Counteragent,
    Location,
    Notification,
    NotificationState,
    NotificationTemplate,
    Order,
    OrderHistory,
    OrderStatus,
    OrderType,
    StatusGroup,
)
from app.services import notifications as service
from app.services import orders as order_service


class FakeGateway:
    def __init__(self, fail=False):
        self.sent = []
        self.fail = fail

    def send(self, message_id, phone, text):
        if self.fail:
            raise service.GatewayError("нет связи")
        self.sent.append((phone, text))
        return f"ext-{len(self.sent)}"

    def state(self, external_id):
        return "Delivered"


def status(db, group):
    s = db.scalars(select(OrderStatus).where(OrderStatus.group == group)).first()
    s.pay_required = False
    return s


@pytest.fixture()
def order(db, owner):
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    location.address = "ул. Панфилова, 1"
    location.work_hours = "10:00–21:00"
    client = Counteragent(name="Иван Петров", phones="79161866119")
    db.add(client)
    db.flush()
    o = Order(number="N-1", location_id=location.id, order_type_id=db.scalars(select(OrderType)).first().id,
              counteragent_id=client.id, status_id=status(db, StatusGroup.NEW).id, created_by_id=owner.id,
              brand="Apple", model="iPhone 13", total_price=4500, paid=0)
    db.add(o)
    db.flush()
    db.refresh(o)
    return o


def template(db, group, text):
    db.add(NotificationTemplate(status_id=status(db, group).id, text=text))
    db.flush()


def test_status_change_queues_and_sends_sms(db, owner, order):
    template(db, StatusGroup.FINISH, "Ваш {устройство} готов! Заказ {номер}, к оплате {долг} руб. {адрес}, {часы}. {ссылка}")
    order_service.change_status(db, order, status(db, StatusGroup.FINISH), owner)
    queued = db.scalars(select(Notification)).one()
    assert queued.phone == "+79161866119" and queued.state == NotificationState.QUEUED
    assert queued.text.startswith("Ваш Apple iPhone 13 готов! Заказ N-1, к оплате 4 500 руб. ул. Панфилова, 1, 10:00–21:00.")
    assert order.tracking_code and order.tracking_code in queued.text

    gateway = FakeGateway()
    stats = service.process(db, gateway)
    assert stats["sent"] == 1 and gateway.sent[0][0] == "+79161866119"
    assert db.scalars(select(OrderHistory).where(OrderHistory.type == "sms")).one().text == queued.text
    service.process(db, gateway)  # второй проход — только подтверждение доставки
    assert queued.state == NotificationState.DELIVERED and len(gateway.sent) == 1


def test_fresh_status_replaces_unsent_and_no_template_no_sms(db, owner, order):
    template(db, StatusGroup.IN_WORK, "В работе {номер}")
    template(db, StatusGroup.FINISH, "Готов {номер}")
    order_service.change_status(db, order, status(db, StatusGroup.IN_WORK), owner)
    order_service.change_status(db, order, status(db, StatusGroup.FINISH), owner)
    states = {n.text: n.state for n in db.scalars(select(Notification))}
    assert states == {"В работе N-1": NotificationState.CANCELLED, "Готов N-1": NotificationState.QUEUED}
    order_service.change_status(db, order, status(db, StatusGroup.WAIT), owner)  # шаблона нет
    assert db.scalars(select(Notification).where(Notification.state == NotificationState.QUEUED)).all() == []


def test_client_opt_out_and_pause_and_limit_and_retries(db, owner, order, monkeypatch):
    template(db, StatusGroup.FINISH, "Готов {номер}")
    client = db.get(Counteragent, order.counteragent_id)
    client.allow_sms = False
    order_service.change_status(db, order, status(db, StatusGroup.FINISH), owner)
    assert db.scalars(select(Notification)).all() == []
    client.allow_sms = True

    # Пауза 10 минут между автоматическими SMS одному номеру
    db.add(Notification(phone="+79161866119", text="раньше", kind="status", state=NotificationState.SENT, sent_at=utcnow() - timedelta(minutes=2)))
    db.add(Notification(phone="+79161866119", text="сейчас", kind="status"))
    db.flush()
    stats = service.process(db, FakeGateway())
    assert stats["waiting"] == 1 and stats["sent"] == 0

    # Лимит в сутки
    monkeypatch.setattr(settings, "sms_daily_limit", 1)
    db.add(Notification(phone="+79990000000", text="ручное", kind="manual"))
    db.flush()
    assert service.process(db, FakeGateway())["sent"] == 0  # одно SMS за сутки уже есть

    # Три неудачных попытки → ошибка
    monkeypatch.setattr(settings, "sms_daily_limit", 100)
    broken = Notification(phone="+79990000001", text="x", kind="manual")
    db.add(broken)
    db.flush()
    for _ in range(3):
        service.process(db, FakeGateway(fail=True))
    assert broken.state == NotificationState.FAILED and broken.attempts == 3


def test_templates_manual_sms_and_public_tracking(client, auth_headers, db, owner, order):
    db.commit()
    items = client.get("/api/notifications/templates", headers=auth_headers).json()["items"]
    ready = next(i for i in items if i["status_name"].startswith("Готов"))
    assert ready["text"] and ready["is_active"] is False  # заготовка выключена
    r = client.put(f"/api/notifications/templates/{ready['status_id']}", json={"text": "Готов {номер}", "is_active": True}, headers=auth_headers)
    assert r.status_code == 200

    sms = client.post(f"/api/orders/{order.id}/notify", json={"text": "Здравствуйте, {имя}! Заказ {номер}"}, headers=auth_headers)
    assert sms.status_code == 200 and sms.json()["text"] == "Здравствуйте, Иван! Заказ N-1"
    assert client.get(f"/api/orders/{order.id}/notifications", headers=auth_headers).json()[0]["state_title"] == "В очереди"

    code = client.get(f"/api/orders/{order.id}/tracking", headers=auth_headers).json()["code"]
    page = client.get(f"/api/track/{code}")  # без авторизации
    assert page.status_code == 200
    body = page.json()
    assert body["number"] == "N-1" and body["device"] == "Apple iPhone 13" and body["location"]["work_hours"] == "10:00–21:00"
    assert "purchase" not in str(body) and "master" not in str(body)
    assert client.get("/api/track/N-1").status_code == 404  # по номеру заказа — нельзя
    assert client.get(f"/api/track/{code[:-1]}x").status_code == 404
