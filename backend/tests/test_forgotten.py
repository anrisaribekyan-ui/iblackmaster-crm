"""Забытые аппараты: список готовых не забранных, сводка, SMS-напоминания по порогам."""

from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.db import utcnow
from app.models import Counteragent, Location, Notification, Order, OrderHistory, OrderStatus, OrderType, StatusGroup
from app.services import forgotten, settings

NOON_MSK = datetime(2026, 10, 12, 9, 0, tzinfo=timezone.utc)  # 12:00 по Москве


def ready(db, owner, number, days, phones="79161866119", total=5000, paid=0, allow_sms=True):
    client = Counteragent(name=f"Клиент {number}", phones=phones, allow_sms=allow_sms)
    db.add(client)
    db.flush()
    status = db.scalars(select(OrderStatus).where(OrderStatus.group == StatusGroup.FINISH)).first()
    o = Order(number=number, location_id=db.scalars(select(Location)).first().id, order_type_id=db.scalars(select(OrderType)).first().id,
              counteragent_id=client.id, status_id=status.id, created_by_id=owner.id, brand="Apple", model="iPhone 12",
              total_price=total, paid=paid, finished_at=utcnow() - timedelta(days=days))
    db.add(o)
    db.flush()
    return o


def test_list_threshold_and_history_wins(client, auth_headers, db, owner):
    old = ready(db, owner, "F1", days=20)
    ready(db, owner, "F2", days=3)
    paid = ready(db, owner, "F3", days=40, paid=5000)
    # Заказ вернули в работу и снова сделали готовым 2 дня назад — считаем от последнего перехода
    back = ready(db, owner, "F4", days=50)
    db.add(OrderHistory(order_id=back.id, type="status", status_id=back.status_id, created_at=utcnow() - timedelta(days=2)))
    # «Готов (позвонить)» → «Готов и уведомлен»: аппарат лежит с 30-го дня, смена готового статуса счётчик не сбрасывает
    ready_ids = db.scalars(select(OrderStatus.id).where(OrderStatus.group == StatusGroup.FINISH)).all()
    work_id = db.scalars(select(OrderStatus.id).where(OrderStatus.group == StatusGroup.IN_WORK)).first()
    notified = ready(db, owner, "F5", days=1)
    for status_id, ago in [(work_id, 40), (ready_ids[0], 30), (ready_ids[-1], 1)]:
        db.add(OrderHistory(order_id=notified.id, type="status", status_id=status_id, created_at=utcnow() - timedelta(days=ago)))
    db.commit()

    body = client.get("/api/forgotten", headers=auth_headers).json()
    assert [i["number"] for i in body["items"]] == ["F3", "F5", "F1"]  # порог по умолчанию — 14 дней, давние сверху
    assert body["count"] == 3 and float(body["debt"]) == 10000  # оплаченный F3 долга не добавляет
    assert client.get("/api/forgotten?days=0", headers=auth_headers).json()["count"] == 5
    summary = client.get("/api/forgotten/summary", headers=auth_headers).json()
    assert summary["days"] == 14 and summary["count"] == 3 and float(summary["debt"]) == 10000
    assert old.id and paid.id


def test_reminders_one_per_threshold_daytime_only(db, owner):
    ready(db, owner, "R1", days=40)
    ready(db, owner, "R2", days=8)
    ready(db, owner, "R3", days=1)
    ready(db, owner, "R4", days=10, allow_sms=False)
    ready(db, owner, "R5", days=10, phones="74951234567")  # городской — SMS не отправить
    assert forgotten.queue_reminders(db, now=NOON_MSK) == 0  # выключено по умолчанию

    settings.put(db, "forgotten", {"reminders_active": True})
    assert forgotten.queue_reminders(db, now=NOON_MSK.replace(hour=20)) == 0  # 23:00 по Москве — не пишем
    assert forgotten.queue_reminders(db, now=NOON_MSK) == 2
    kinds = {n.order_id: n.kind for n in db.scalars(select(Notification))}
    by_number = {db.get(Order, k).number: v for k, v in kinds.items()}
    assert by_number == {"R1": "remind30", "R2": "remind7"}  # давний заказ получает одно SMS, а не три сразу
    text = db.scalars(select(Notification).where(Notification.kind == "remind30")).one().text
    assert "40 дн." in text and "iPhone 12" in text
    assert forgotten.queue_reminders(db, now=NOON_MSK) == 0  # повторно не шлём


def test_settings_api(client, auth_headers):
    r = client.put("/api/settings/forgotten", headers=auth_headers,
                   json={"list_days": 10, "reminders_active": True, "reminder_days": [30, 3, 3, 0], "reminder_text": " Ждём вас "})
    assert r.status_code == 200
    assert r.json()["reminder_days"] == [3, 30] and r.json()["reminder_text"] == "Ждём вас"
    assert client.get("/api/settings/forgotten", headers=auth_headers).json()["list_days"] == 10
