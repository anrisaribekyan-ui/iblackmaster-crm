"""Чек-лист проверки устройства при приёме и выдаче + подпись клиента на экране (ТЗ этап 3, E5).

Отметки: ok — работает, fail — не работает (замечание), na — не проверить (аппарат не включается и т. п.).
Подпись — PNG с экрана телефона/планшета, хранится как файл заказа «Подпись клиента — приём/выдача.png».
"""

import base64
import binascii
import uuid
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import CurrentEmployee, DbSession, require
from app.config import settings as app_config
from app.errors import BusinessError
from app.models import OrderFile
from app.services import settings
from app.services.orders import add_history

router = APIRouter(tags=["Чек-лист"])

Mark = Literal["ok", "fail", "na"]
STAGE_TITLES = {"in": "приём", "out": "выдача"}
MAX_SIGNATURE = 400 * 1024


@router.get("/settings/checklist")
def get_checklist(db: DbSession, me: CurrentEmployee):
    return settings.get(db, "checklist")


class ChecklistSettingsIn(BaseModel):
    items: list[str] = Field(max_length=40)


@router.put("/settings/checklist", dependencies=[Depends(require("settingAccess"))])
def put_checklist(data: ChecklistSettingsIn, db: DbSession):
    items = []
    for item in data.items:
        item = item.strip()[:100]
        if item and item not in items:
            items.append(item)
    saved = settings.put(db, "checklist", {"items": items})
    db.commit()
    return saved


class OrderChecklistIn(BaseModel):
    stage: Literal["in", "out"]
    values: dict[str, Mark] = Field(max_length=40)


@router.put("/orders/{order_id}/checklist")
def save_order_checklist(order_id: int, data: OrderChecklistIn, db: DbSession, me: CurrentEmployee):
    from app.api.orders import get_order_for_employee

    order = get_order_for_employee(db, order_id, me)
    values = {k.strip()[:100]: v for k, v in data.values.items() if k.strip()}
    if data.stage == "in":
        order.check_in = values
    else:
        order.check_out = values
    fails = [k for k, v in values.items() if v == "fail"]
    text = f"Проверка ({STAGE_TITLES[data.stage]}): " + (f"замечания — {', '.join(fails)}" if fails else "всё работает")
    add_history(db, order, "checklist", me, text=text)
    db.commit()
    return {"check_in": order.check_in, "check_out": order.check_out}


class SignatureIn(BaseModel):
    stage: Literal["in", "out"]
    image: str = Field(max_length=MAX_SIGNATURE * 2)  # data:image/png;base64,…


def signature_name(stage: str) -> str:
    return f"Подпись клиента — {STAGE_TITLES[stage]}.png"


@router.post("/orders/{order_id}/signature")
def save_signature(order_id: int, data: SignatureIn, db: DbSession, me: CurrentEmployee):
    from app.api.orders import get_order_for_employee

    order = get_order_for_employee(db, order_id, me)
    header, _, payload = data.image.partition(",")
    if header != "data:image/png;base64" or not payload:
        raise BusinessError("Подпись должна быть картинкой PNG")
    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as error:
        raise BusinessError("Подпись повреждена") from error
    if not raw.startswith(b"\x89PNG") or len(raw) > MAX_SIGNATURE:
        raise BusinessError("Подпись должна быть картинкой PNG до 400 КБ")

    name = signature_name(data.stage)
    root = Path(app_config.uploads_dir)
    for old in db.scalars(select(OrderFile).where(OrderFile.order_id == order.id, OrderFile.filename == name)):
        (root / old.path).unlink(missing_ok=True)
        db.delete(old)
    folder = root / "orders" / str(order.id)
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / f"{uuid.uuid4().hex}.png"
    target.write_bytes(raw)
    item = OrderFile(order_id=order.id, employee_id=me.id, filename=name, mimetype="image/png", size=len(raw),
                     path=str(target.relative_to(root)))
    db.add(item)
    add_history(db, order, "signature", me, text=f"Подписал при: {STAGE_TITLES[data.stage]}")
    db.commit()
    return {"id": item.id, "filename": name}
