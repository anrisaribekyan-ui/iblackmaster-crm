"""Проверка panic-лога: фото, файл или вставленный текст."""

from fastapi import APIRouter, Depends, File, Form, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import CurrentEmployee, DbSession, require
from app.api.orders import assert_order_access
from app.errors import BusinessError, NotFound
from app.models import Order
from app.services import orders as order_service
from app.services import panic

router = APIRouter(prefix="/panic", tags=["Проверка паник-лога"])
access = [Depends(require("panicAccess"))]

IMAGE_TYPES = (".png", ".jpg", ".jpeg", ".heic", ".webp", ".bmp")
MAX_BYTES = 15 * 1024 * 1024


@router.post("/check", dependencies=access)
async def check_panic(file: UploadFile | None = File(default=None), text: str = Form(default="")):
    body = text.strip()
    if file is not None and file.filename:
        data = await file.read()
        if len(data) > MAX_BYTES:
            raise BusinessError("Файл больше 15 МБ")
        name = file.filename.lower()
        is_image = (file.content_type or "").startswith("image/") or name.endswith(IMAGE_TYPES)
        try:
            extracted = panic.ocr_image(data) if is_image else panic.text_from_file(name, data)
        except RuntimeError as e:
            raise BusinessError(str(e))
        except Exception:
            raise BusinessError("Не получилось прочитать файл. Пришлите фото получше или сам файл лога")
        body = f"{extracted}\n{body}".strip()
    if len(body) < 20:
        raise BusinessError("В файле почти нет текста. Приложите фото лога, файл или вставьте текст")
    return panic.check(body)


class AttachIn(BaseModel):
    order_number: str = Field(min_length=1, max_length=20)
    summary: str = Field(min_length=1, max_length=6000)


@router.post("/attach", dependencies=access)
def attach_to_order(data: AttachIn, db: DbSession, me: CurrentEmployee):
    """Записывает итог проверки комментарием в историю заказа (А15911 и 15911 — один и тот же заказ)."""
    number = data.order_number.strip().replace(" ", "")
    number = "A" + number[1:] if number[:1] in ("А", "а", "a", "A") else "A" + number
    order = db.scalars(select(Order).where(Order.number == number, Order.is_deleted.is_(False))).first()
    if order is None:
        raise NotFound("Заказ")
    assert_order_access(order, me)
    order_service.add_history(db, order, "comment", me, text="Проверка паник-лога\n" + data.summary.strip())
    db.commit()
    return {"order_id": order.id, "number": order.number}
