"""Уведомления: шаблоны SMS на статусы, журнал отправки, ручное SMS из заказа, тест шлюза.
Плюс публичная страница отслеживания заказа по коду из QR (/api/track/{code}) — без входа.
"""

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.api.deps import CurrentEmployee, DbSession, require
from app.config import settings
from app.errors import BusinessError, NotFound
from app.models import (
    Location,
    Notification,
    NotificationState,
    NotificationTemplate,
    Order,
    OrderStatus,
    StatusGroup,
)
from app.services import notifications as service

router = APIRouter(tags=["Уведомления"])

STATE_TITLES = {
    NotificationState.QUEUED: "В очереди",
    NotificationState.SENDING: "Отправляется",
    NotificationState.SENT: "Отправлено",
    NotificationState.DELIVERED: "Доставлено",
    NotificationState.FAILED: "Ошибка",
    NotificationState.CANCELLED: "Отменено",
}


# --- Шаблоны -------------------------------------------------------------------------


class TemplateIn(BaseModel):
    text: str = Field(max_length=600)
    is_active: bool = True


@router.get("/notifications/templates", dependencies=[Depends(require("changeNotificationAccess"))])
def list_templates(db: DbSession):
    """Все статусы заказа с их шаблоном SMS. Если шаблона нет — подсказка-заготовка (выключена)."""
    templates = {t.status_id: t for t in db.scalars(select(NotificationTemplate))}
    statuses = db.scalars(select(OrderStatus).where(OrderStatus.is_active.is_(True)).order_by(OrderStatus.sort, OrderStatus.id)).all()
    return {
        "variables": [{"name": k, "hint": v} for k, v in service.VARIABLES.items()],
        "items": [
            {
                "status_id": s.id,
                "status_name": s.name,
                "status_color": s.color,
                "group": s.group,
                "text": templates[s.id].text if s.id in templates else service.DEFAULT_TEMPLATES.get(s.name.strip(), ""),
                "is_active": templates[s.id].is_active if s.id in templates else False,
                "saved": s.id in templates,
            }
            for s in statuses
        ],
    }


@router.put("/notifications/templates/{status_id}", dependencies=[Depends(require("changeNotificationAccess"))])
def save_template(status_id: int, data: TemplateIn, db: DbSession):
    if db.get(OrderStatus, status_id) is None:
        raise NotFound("Статус")
    if data.is_active and not data.text.strip():
        raise BusinessError("Введите текст SMS или выключите отправку")
    template = db.scalars(select(NotificationTemplate).where(NotificationTemplate.status_id == status_id)).first()
    if template is None:
        template = NotificationTemplate(status_id=status_id, text="")
        db.add(template)
    template.text = data.text.strip()
    template.is_active = data.is_active
    db.commit()
    return {"status_id": status_id, "text": template.text, "is_active": template.is_active}


# --- Журнал и состояние шлюза ---------------------------------------------------------


def notification_dict(item: Notification, numbers: dict[int, str]) -> dict:
    return {
        "id": item.id,
        "created_at": item.created_at,
        "sent_at": item.sent_at,
        "order_id": item.order_id,
        "order_number": numbers.get(item.order_id),
        "kind": item.kind,
        "phone": item.phone,
        "text": item.text,
        "state": item.state,
        "state_title": STATE_TITLES.get(item.state, item.state),
        "error": item.error,
    }


@router.get("/notifications", dependencies=[Depends(require("changeNotificationAccess"))])
def list_notifications(db: DbSession, page: int = Query(default=1, ge=1), state: str | None = None):
    query = select(Notification)
    if state:
        query = query.where(Notification.state == state)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    items = db.scalars(query.order_by(Notification.id.desc()).offset((page - 1) * 50).limit(50)).all()
    numbers = dict(db.execute(select(Order.id, Order.number).where(Order.id.in_({i.order_id for i in items if i.order_id} or {0}))).all())
    return {"total": total, "items": [notification_dict(i, numbers) for i in items]}


@router.get("/notifications/status", dependencies=[Depends(require("changeNotificationAccess"))])
def gateway_status(db: DbSession):
    queued = db.scalar(select(func.count(Notification.id)).where(Notification.state == NotificationState.QUEUED)) or 0
    return {
        "configured": service.gateway_from_settings() is not None,
        "sent_24h": service.sent_today(db),
        "daily_limit": settings.sms_daily_limit,
        "queued": queued,
        "public_url": settings.public_url or None,
    }


class TestSmsIn(BaseModel):
    phone: str = Field(min_length=10, max_length=20)
    text: str = Field(default="Проверка SMS из CRM iBlackMaster", min_length=1, max_length=600)


@router.post("/notifications/test", dependencies=[Depends(require("changeNotificationAccess"))])
def test_sms(data: TestSmsIn, db: DbSession, me: CurrentEmployee):
    from app.utils.phone import normalize_phone

    phone = normalize_phone(data.phone)
    if phone is None:
        raise BusinessError("Неверный номер телефона")
    item = Notification(kind="test", phone=f"+{phone}", text=data.text.strip(), created_by_id=me.id)
    db.add(item)
    db.commit()
    return {"id": item.id, "state": item.state}


# --- SMS из карточки заказа ------------------------------------------------------------


class ManualSmsIn(BaseModel):
    text: str = Field(min_length=1, max_length=600)


@router.get("/orders/{order_id}/notifications")
def order_notifications(order_id: int, db: DbSession, me: CurrentEmployee):
    from app.api.orders import get_order_for_employee

    order = get_order_for_employee(db, order_id, me, include_deleted=True)
    items = db.scalars(select(Notification).where(Notification.order_id == order.id).order_by(Notification.id.desc())).all()
    return [notification_dict(i, {order.id: order.number}) for i in items]


@router.post("/orders/{order_id}/notify")
def notify_client(order_id: int, data: ManualSmsIn, db: DbSession, me: CurrentEmployee):
    from app.api.orders import get_order_for_employee

    order = get_order_for_employee(db, order_id, me)
    item = service.enqueue_manual(db, order, data.text, me.id)
    db.commit()
    return notification_dict(item, {order.id: order.number})


@router.get("/orders/{order_id}/tracking")
def order_tracking(order_id: int, db: DbSession, me: CurrentEmployee):
    """Код и ссылка для QR на квитанции (код создаётся при первом запросе)."""
    from app.api.orders import get_order_for_employee

    order = get_order_for_employee(db, order_id, me)
    code = service.ensure_tracking_code(db, order)
    db.commit()
    return {"code": code, "url": service.tracking_url(code)}


# --- Публичная страница отслеживания (без входа) -----------------------------------------

CLIENT_STATUS = {
    StatusGroup.NEW: "Принят",
    StatusGroup.IN_WORK: "В работе",
    StatusGroup.WAIT: "Ожидание",
    StatusGroup.FINISH: "Готов — можно забирать",
    StatusGroup.CLOSED: "Выдан",
}


@router.get("/track/{code}")
def track(code: str, db: DbSession):
    """Только то, что можно показать клиенту: никаких себестоимостей, мастеров и внутренних комментариев."""
    order = db.scalars(select(Order).where(Order.tracking_code == code.strip().lower())).first() if len(code) >= 8 else None
    if order is None or order.is_deleted:
        raise NotFound("Заказ")
    status = db.get(OrderStatus, order.status_id)
    location = db.get(Location, order.location_id)
    group = StatusGroup(status.group)
    debt = max(0, order.total_price - order.paid)
    return {
        "number": order.number,
        "device": " ".join(p for p in [order.brand, order.model] if p) or order.device_type or "Устройство",
        "status": status.name,
        "stage": group.value,
        "stage_title": CLIENT_STATUS[group],
        "created_at": order.created_at,
        "total": order.total_price,
        "debt": debt,
        "approximate_price": order.approximate_price,
        "location": {
            "name": location.name if location else None,
            "address": location.address if location else None,
            "phones": location.phones if location else None,
            "work_hours": location.work_hours if location else None,
        },
    }
