"""«Закупки» → заказ у поставщика (Moba, Master Mobile, Liberti).

Сами входы в магазины, проверка наличия в Митино и оформление живут в сервисе автозаказа
(zakupka_api.py на том же сервере). CRM лишь проверяет право сотрудника и пересылает запрос с токеном,
чтобы логины магазинов и токен сервиса не попадали в браузер.
"""

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.api.deps import CurrentEmployee, require
from app.config import settings
from app.errors import BusinessError

router = APIRouter(prefix="/supplier-orders", tags=["supplier-orders"], dependencies=[Depends(require("supplierOrderAccess"))])

# Тесты подменяют транспорт, чтобы не ходить в сеть
transport: httpx.BaseTransport | None = None


class QuoteItem(BaseModel):
    id: str = Field(max_length=40)
    text: str = Field(max_length=300)


class QuoteIn(BaseModel):
    supplier: str = Field(max_length=20)
    account: str = Field(default="anri", max_length=20)
    items: list[QuoteItem] = Field(min_length=1, max_length=40)


class OrderLine(BaseModel):
    product_id: str = Field(max_length=20)
    qty: int = Field(ge=1, le=50)
    price: int = Field(ge=0, le=1_000_000)


class OrderIn(BaseModel):
    supplier: str = Field(max_length=20)
    account: str = Field(default="anri", max_length=20)
    request_id: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    lines: list[OrderLine] = Field(min_length=1, max_length=40)
    comment: str = Field(default="", max_length=250)


def _call(method: str, path: str, *, json: dict | None = None, timeout: float = 30) -> dict:
    if not settings.zakupka_url:
        raise BusinessError("Сервис закупок не подключён (ZAKUPKA_URL в .env CRM)")
    try:
        with httpx.Client(base_url=settings.zakupka_url.rstrip("/"), timeout=timeout, transport=transport) as client:
            response = client.request(method, path, json=json, headers={"X-Zakupka-Token": settings.zakupka_token})
    except httpx.TimeoutException:
        raise BusinessError("Сервис закупок не ответил вовремя. Если оформляли заказ — проверьте его на сайте магазина")
    except httpx.HTTPError:
        raise BusinessError("Сервис закупок недоступен: проверьте, что он запущен на сервере (zakupka-api)")
    try:
        data = response.json()
    except ValueError:
        raise BusinessError(f"Сервис закупок ответил непонятно (код {response.status_code})")
    if response.status_code >= 400:
        raise BusinessError(data.get("error") or f"Сервис закупок: ошибка {response.status_code}")
    return data


@router.get("/config")
def get_config():
    if not settings.zakupka_url:
        return {"enabled": False, "live": False, "suppliers": []}
    return {"enabled": True, **_call("GET", "/config", timeout=10)}


@router.post("/quote")
def quote(data: QuoteIn):
    return _call("POST", "/quote", json=data.model_dump(), timeout=180)


@router.post("/order")
def place_order(data: OrderIn, me: CurrentEmployee):
    payload = data.model_dump()
    payload["comment"] = (data.comment or f"Закупка iBlackMaster · {me.short_name}")[:250]
    # Оформление в браузере у магазина может занять пару минут
    return _call("POST", "/order", json=payload, timeout=420)
