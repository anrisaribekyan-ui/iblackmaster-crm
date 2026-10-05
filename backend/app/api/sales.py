from decimal import Decimal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import CurrentEmployee, DbSession, check_location, has_permission, require
from app.errors import BusinessError, Forbidden, NotFound
from app.models import CashRegister, Counteragent, Location, Nomenclature, Sale, SalePosition, Store
from app.services import sales as sales_service

router = APIRouter(prefix="/sales", tags=["Продажи"])


class SalePositionIn(BaseModel):
    nomenclature_id: int | None = None
    name: str | None = None
    is_work: bool = False
    quantity: Decimal = Field(gt=Decimal("0"))
    price: Decimal = Field(ge=Decimal("0"))
    guarantee_days: int = 0
    serials: list[str] = Field(default_factory=list)


class SalePaymentIn(BaseModel):
    cash_register_id: int
    amount: Decimal = Field(gt=Decimal("0"))
    is_bank: bool = False
    note: str | None = None


class SaleCreate(BaseModel):
    location_id: int
    store_id: int
    positions: list[SalePositionIn] = Field(min_length=1)
    payments: list[SalePaymentIn] = Field(default_factory=list)
    discount_percent: Decimal = Field(default=Decimal("0"), ge=Decimal("0"), le=Decimal("100"))
    discount_sum: Decimal = Field(default=Decimal("0"), ge=Decimal("0"))
    counteragent_id: int | None = None
    note: str | None = None


class SaleReturnPositionIn(BaseModel):
    sale_position_id: int
    quantity: Decimal = Field(gt=Decimal("0"))


class SaleReturnIn(BaseModel):
    cash_register_id: int
    is_bank: bool = False
    note: str | None = None
    items: list[SaleReturnPositionIn] = Field(min_length=1)


def validate_cash_register(db: DbSession, me: CurrentEmployee, cash_register_id: int) -> CashRegister:
    register = db.get(CashRegister, cash_register_id)
    if register is None or not register.is_active:
        raise NotFound("Касса")
    if register.location_id is not None:
        check_location(me, register.location_id)
    return register


@router.post("")
def create_sale(data: SaleCreate, db: DbSession, me: CurrentEmployee):
    check_location(me, data.location_id)
    location = db.get(Location, data.location_id)
    if location is None or not location.is_active:
        raise NotFound("Локация")
    store = db.get(Store, data.store_id)
    if store is None or not store.is_active or store.location_id != location.id:
        raise NotFound("Склад")
    if data.counteragent_id is not None:
        counteragent = db.get(Counteragent, data.counteragent_id)
        if counteragent is None or counteragent.is_deleted:
            raise NotFound("Покупатель")
    if data.payments and not has_permission(me, "operationCashRegisterAccess"):
        raise Forbidden("Нет права: operationCashRegisterAccess")
    for payment in data.payments:
        register = validate_cash_register(db, me, payment.cash_register_id)
        if register.location_id is not None and register.location_id != location.id:
            raise BusinessError("Касса должна быть глобальной или находиться в локации продажи")
    for position in data.positions:
        if position.nomenclature_id is not None:
            nomenclature = db.get(Nomenclature, position.nomenclature_id)
            if nomenclature is None or nomenclature.is_deleted:
                raise NotFound("Номенклатура")
            if not nomenclature.is_work and position.is_work:
                raise BusinessError("Тип позиции не совпадает с номенклатурой")
        elif not position.is_work or not (position.name or "").strip():
            raise BusinessError("Для товара укажите номенклатуру, для работы — название")

    sale = sales_service.create_sale(
        db,
        location_id=location.id,
        store_id=store.id,
        seller_id=me.id,
        counteragent_id=data.counteragent_id,
        discount_percent=data.discount_percent,
        discount_sum=data.discount_sum,
        note=data.note,
        positions=[position.model_dump() for position in data.positions],
        payments=[payment.model_dump() for payment in data.payments],
    )
    db.commit()
    return {
        "id": sale.id,
        "number": sale.number,
        "total_price": sale.total_price,
        "total_purchase": sale.total_purchase,
        "paid": sale.paid,
        "debt": sale.total_price - sale.paid,
    }


@router.post("/{sale_id}/returns", dependencies=[Depends(require("saleReturnAccess", "operationCashRegisterAccess"))])
def return_sale(sale_id: int, data: SaleReturnIn, db: DbSession, me: CurrentEmployee):
    sale = db.get(Sale, sale_id)
    if sale is None or sale.is_deleted:
        raise NotFound("Чек")
    check_location(me, sale.location_id)
    register = validate_cash_register(db, me, data.cash_register_id)
    if register.location_id is not None and register.location_id != sale.location_id:
        raise BusinessError("Касса должна быть глобальной или находиться в локации продажи")
    document, amount = sales_service.refund_sale(
        db,
        sale=sale,
        employee_id=me.id,
        cash_register_id=register.id,
        is_bank=data.is_bank,
        note=data.note,
        items=[item.model_dump() for item in data.items],
    )
    db.commit()
    return {"document_id": document.id, "amount": amount, "paid": sale.paid}