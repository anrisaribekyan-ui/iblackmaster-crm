"""SMS-уведомления клиентам через телефон-шлюз (SMS Gateway for Android). Пишет и меняет только Claude.

Поток:
1. Смена статуса заказа → enqueue_status(): если у статуса есть включённый шаблон и клиент не запретил SMS,
   в очередь ставится Notification(state=queued). Неотправленное сообщение по тому же заказу заменяется
   свежим — клиент не получит «Принят» и сразу «В работе», если статус переключили подряд.
2. Фоновый поток (start_worker) раз в 15 секунд вызывает process(): отправляет очередь через шлюз,
   соблюдая лимит в сутки и паузу 10 минут между автоматическими SMS одному клиенту, затем
   спрашивает у шлюза, доставлены ли отправленные.
3. Каждое отправленное SMS записывается в историю заказа (тип «sms»).
"""

import logging
import re
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import httpx
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import set_committed_value

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
)

log = logging.getLogger("notifications")

AUTO_PAUSE = timedelta(minutes=10)  # не чаще одного автоматического SMS клиенту
MAX_ATTEMPTS = 3
TRACK_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"  # без похожих символов: 0/o, 1/l/i

VARIABLES = {
    "{номер}": "номер заказа, например A15855",
    "{устройство}": "бренд и модель: Apple iPhone 13",
    "{сумма}": "сумма заказа",
    "{долг}": "сколько осталось оплатить",
    "{точка}": "название точки",
    "{адрес}": "адрес точки",
    "{телефон_точки}": "телефон точки",
    "{часы}": "часы работы точки",
    "{имя}": "имя клиента",
    "{ссылка}": "страница отслеживания заказа",
}

DEFAULT_TEMPLATES = {
    "Принят": "Заказ {номер} принят: {устройство}. Статус ремонта: {ссылка} iBlackMaster",
    "Готов (позвонить клиенту)": "Ваш {устройство} готов! Заказ {номер}, к оплате {долг} руб. {точка}, {адрес}, {часы}. iBlackMaster",
    "Готов и клиент уведомлен": "Ваш {устройство} готов! Заказ {номер}, к оплате {долг} руб. {точка}, {адрес}, {часы}. iBlackMaster",
    "Ждет запчасть": "Заказ {номер}: ждём запчасть для {устройство}, сообщим, когда придёт. {ссылка}",
}


# --- Код отслеживания ---------------------------------------------------------------


def ensure_tracking_code(db: Session, order: Order) -> str:
    """Случайный код из 10 символов (≈ 10^14 вариантов) — перебором не подобрать."""
    while not order.tracking_code:
        code = "".join(secrets.choice(TRACK_ALPHABET) for _ in range(10))
        if db.scalar(select(Order.id).where(Order.tracking_code == code)) is None:
            order.tracking_code = code
    return order.tracking_code


def tracking_url(code: str) -> str:
    return f"{settings.public_url.rstrip('/')}/track/{code}"


# --- Текст ---------------------------------------------------------------------------


def _rub(value) -> str:
    return f"{Decimal(value or 0):,.0f}".replace(",", " ")


def render(db: Session, text: str, order: Order, extra: dict[str, str] | None = None) -> str:
    client = db.get(Counteragent, order.counteragent_id)
    location = db.get(Location, order.location_id)
    debt = max(Decimal("0"), Decimal(order.total_price or 0) - Decimal(order.paid or 0))
    phones = (location.phones or "").split(",")[0].strip() if location else ""
    values = {
        "{номер}": order.number,
        "{устройство}": " ".join(p for p in [order.brand, order.model] if p) or (order.device_type or "устройство"),
        "{сумма}": _rub(order.total_price),
        "{долг}": _rub(debt),
        "{точка}": (location.name if location else "").replace("iBlackMaster", "").strip(" ()") or "iBlackMaster",
        "{адрес}": (location.address or "") if location else "",
        "{телефон_точки}": phones,
        "{часы}": (location.work_hours or "") if location else "",
        "{имя}": (client.name.split()[0] if client and client.name else ""),
    }
    if "{ссылка}" in text:
        values["{ссылка}"] = tracking_url(ensure_tracking_code(db, order))
    values.update(extra or {})
    for key, value in values.items():
        text = text.replace(key, value)
    return re.sub(r"\s{2,}", " ", text).replace(" ,", ",").strip()


def sms_phone(client: Counteragent | None) -> str | None:
    """Первый мобильный номер клиента в формате +7XXXXXXXXXX."""
    if client is None or not client.phones:
        return None
    for phone in client.phones.split(","):
        digits = phone.strip()
        if len(digits) == 11 and digits.startswith("79"):
            return f"+{digits}"
    return None


# --- Очередь -------------------------------------------------------------------------


def enqueue_status(db: Session, order: Order, status: OrderStatus, employee_id: int | None = None) -> Notification | None:
    """Вызывается из orders.change_status после смены статуса."""
    # Ещё не ушедшее автоматическое SMS по этому заказу больше не актуально — даже если
    # у нового статуса шаблона нет (заказ ушёл из «Готов» обратно в работу — «готов» слать нельзя)
    for old in db.scalars(
        select(Notification).where(
            Notification.order_id == order.id, Notification.kind == "status", Notification.state == NotificationState.QUEUED
        )
    ):
        old.state = NotificationState.CANCELLED
        old.error = f"Статус сменился на «{status.name}» до отправки"
    db.flush()
    template = db.scalars(
        select(NotificationTemplate).where(NotificationTemplate.status_id == status.id, NotificationTemplate.is_active.is_(True))
    ).first()
    if template is None or not template.text.strip():
        return None
    client = db.get(Counteragent, order.counteragent_id)
    if client is None or not client.allow_sms:
        return None
    phone = sms_phone(client)
    if phone is None:
        return None
    item = Notification(
        order_id=order.id,
        counteragent_id=client.id,
        kind="status",
        phone=phone,
        text=render(db, template.text, order),
        created_by_id=employee_id,
    )
    db.add(item)
    db.flush()
    return item


def enqueue_text(db: Session, order: Order, text: str, kind: str, extra: dict[str, str] | None = None) -> Notification | None:
    """Автоматическое SMS не по статусу (напоминание о забытом аппарате и т. п.).
    Уважает «не присылать SMS» и молча пропускает клиентов без мобильного номера."""
    client = db.get(Counteragent, order.counteragent_id)
    if client is None or not client.allow_sms:
        return None
    phone = sms_phone(client)
    if phone is None:
        return None
    item = Notification(order_id=order.id, counteragent_id=client.id, kind=kind, phone=phone, text=render(db, text, order, extra))
    db.add(item)
    db.flush()
    return item


def enqueue_manual(db: Session, order: Order, text: str, employee_id: int) -> Notification:
    from app.errors import BusinessError

    client = db.get(Counteragent, order.counteragent_id)
    phone = sms_phone(client)
    if phone is None:
        raise BusinessError("У клиента нет мобильного номера для SMS")
    text = render(db, text, order)
    if not text:
        raise BusinessError("Пустое сообщение")
    item = Notification(order_id=order.id, counteragent_id=client.id, kind="manual", phone=phone, text=text, created_by_id=employee_id)
    db.add(item)
    db.flush()
    return item


# --- Шлюз ----------------------------------------------------------------------------


class GatewayError(Exception):
    pass


class SmsGateway:
    """Клиент облачного API SMS Gateway for Android (https://docs.sms-gate.app)."""

    def __init__(self, url: str, user: str, password: str):
        self.url = url.rstrip("/")
        self.auth = (user, password)

    def send(self, message_id: str, phone: str, text: str) -> str:
        try:
            response = httpx.post(
                f"{self.url}/messages",
                params={"skipPhoneValidation": "true"},
                auth=self.auth,
                json={"id": message_id, "textMessage": {"text": text}, "phoneNumbers": [phone], "ttl": 6 * 3600},
                timeout=20,
            )
        except httpx.HTTPError as error:
            raise GatewayError(f"Шлюз недоступен: {error}") from error
        if response.status_code >= 300:
            raise GatewayError(f"Шлюз ответил {response.status_code}: {response.text[:200]}")
        return response.json().get("id", message_id)

    def state(self, external_id: str) -> str | None:
        try:
            response = httpx.get(f"{self.url}/messages/{external_id}", auth=self.auth, timeout=20)
        except httpx.HTTPError:
            return None
        if response.status_code >= 300:
            return None
        return response.json().get("state")


def gateway_from_settings() -> SmsGateway | None:
    if not settings.smsgate_user or not settings.smsgate_password:
        return None
    return SmsGateway(settings.smsgate_url, settings.smsgate_user, settings.smsgate_password)


def sent_today(db: Session) -> int:
    since = utcnow() - timedelta(hours=24)
    return db.scalar(
        select(func.count(Notification.id)).where(
            Notification.sent_at >= since, Notification.state.in_([NotificationState.SENT, NotificationState.DELIVERED])
        )
    ) or 0


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def process(db: Session, gateway: SmsGateway) -> dict:
    """Один проход: отправить очередь и обновить статусы доставки. Возвращает счётчики."""
    stats = {"sent": 0, "failed": 0, "waiting": 0, "delivered": 0}
    budget = max(0, settings.sms_daily_limit - sent_today(db))
    now = utcnow()
    queue = db.scalars(select(Notification).where(Notification.state == NotificationState.QUEUED).order_by(Notification.id)).all()
    for item in queue:
        if budget <= 0:
            stats["waiting"] += 1
            continue
        if item.kind == "status" or item.kind.startswith("remind"):
            recent = db.scalar(
                select(func.max(Notification.sent_at)).where(
                    Notification.phone == item.phone,
                    (Notification.kind == "status") | Notification.kind.like("remind%"),
                    Notification.sent_at.is_not(None),
                )
            )
            if recent is not None and now - _as_utc(recent) < AUTO_PAUSE:
                stats["waiting"] += 1
                continue
        # Захват: на сервере несколько процессов, SMS должен отправить ровно один из них
        claimed = db.execute(
            update(Notification)
            .where(Notification.id == item.id, Notification.state == NotificationState.QUEUED)
            .values(state=NotificationState.SENDING)
            .execution_options(synchronize_session=False)
        ).rowcount
        if not claimed:
            continue
        # UPDATE прошёл мимо сессии — сообщаем ей, что в базе уже «sending», иначе возврат в очередь не запишется
        set_committed_value(item, "state", NotificationState.SENDING)
        item.attempts += 1
        try:
            item.external_id = gateway.send(f"crm-{item.id}", item.phone, item.text)
        except GatewayError as error:
            item.error = str(error)
            if item.attempts >= MAX_ATTEMPTS:
                item.state = NotificationState.FAILED
                stats["failed"] += 1
            else:
                item.state = NotificationState.QUEUED  # повторим на следующем проходе
            continue
        item.state = NotificationState.SENT
        item.sent_at = now
        item.error = None
        budget -= 1
        stats["sent"] += 1
        if item.order_id:
            db.add(
                OrderHistory(
                    order_id=item.order_id,
                    type="sms",
                    employee_id=item.created_by_id,
                    text=item.text,
                    data={"phone": item.phone, "notification_id": item.id},
                )
            )
    # Подтверждение доставки — по отправленным за последние сутки
    for item in db.scalars(
        select(Notification).where(Notification.state == NotificationState.SENT, Notification.sent_at >= now - timedelta(days=1))
    ):
        if not item.external_id:
            continue
        state = (gateway.state(item.external_id) or "").lower()
        if state == "delivered":
            item.state = NotificationState.DELIVERED
            stats["delivered"] += 1
        elif state == "failed":
            item.state = NotificationState.FAILED
            item.error = "Оператор не доставил SMS"
    db.flush()
    return stats


# --- Фоновый поток -------------------------------------------------------------------

_worker_started = False


def start_worker(session_factory, interval: int = 15) -> None:
    """Запускается один раз при старте приложения, если шлюз настроен."""
    global _worker_started
    gateway = gateway_from_settings()
    if gateway is None or _worker_started or not settings.sms_worker:
        return
    _worker_started = True

    def loop():
        last_reminders = 0.0
        while True:
            db = session_factory()
            try:
                # Напоминания о забытых аппаратах — раз в час (днём; ночью queue_reminders ничего не ставит)
                if time.monotonic() - last_reminders > 3600:
                    last_reminders = time.monotonic()  # даже при ошибке не повторяем каждые 15 секунд
                    from app.services import forgotten

                    if forgotten.queue_reminders(db):
                        db.commit()
                stats = process(db, gateway)
                db.commit()
                if stats["sent"] or stats["failed"]:
                    log.info("SMS: %s", stats)
            except Exception:  # поток не должен умирать из-за одной ошибки
                db.rollback()
                log.exception("Ошибка отправки SMS")
            finally:
                db.close()
            time.sleep(interval)

    threading.Thread(target=loop, name="sms-worker", daemon=True).start()
