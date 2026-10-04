from decimal import Decimal

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_, select

from app.api.deps import CurrentEmployee, DbSession, check_location, has_permission, location_ids, require
from app.errors import BusinessError, NotFound
from app.models import CashRegister, Location

router = APIRouter(prefix="/cash-registers", tags=["Настройки"])


class CashRegisterIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    location_id: int | None = None
    accepts_cash: bool = True
    accepts_bank: bool = False
    bank_percent: Decimal = Field(default=Decimal("0"), ge=Decimal("0"), le=Decimal("100"))
    allow_negative: bool = True
    allow_internal_move: bool = True
    is_default: bool = False


class CashRegisterOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    location_id: int | None
    name: str
    accepts_cash: bool
    accepts_bank: bool
    bank_percent: Decimal
    allow_negative: bool
    allow_internal_move: bool
    is_default: bool
    cash_balance: Decimal | None
    bank_balance: Decimal | None


def cash_register_out(register: CashRegister, can_view_money: bool) -> CashRegisterOut:
    return CashRegisterOut(
        id=register.id,
        location_id=register.location_id,
        name=register.name,
        accepts_cash=register.accepts_cash,
        accepts_bank=register.accepts_bank,
        bank_percent=register.bank_percent,
        allow_negative=register.allow_negative,
        allow_internal_move=register.allow_internal_move,
        is_default=register.is_default,
        cash_balance=register.cash_balance if can_view_money else None,
        bank_balance=register.bank_balance if can_view_money else None,
    )


def check_register_location(db: DbSession, employee: CurrentEmployee, location_id: int | None) -> None:
    if location_id is None:
        return
    location = db.get(Location, location_id)
    if location is None or not location.is_active:
        raise NotFound("Локация")
    check_location(employee, location_id)


def clear_default(db: DbSession, location_id: int | None, exclude_id: int | None = None) -> None:
    query = select(CashRegister).where(CashRegister.location_id == location_id)
    for register in db.scalars(query).all():
        if register.id != exclude_id:
            register.is_default = False


@router.get("", response_model=list[CashRegisterOut])
def list_cash_registers(db: DbSession, me: CurrentEmployee):
    query = select(CashRegister).where(CashRegister.is_active.is_(True)).order_by(CashRegister.id)
    allowed = location_ids(me)
    if allowed:
        query = query.where(or_(CashRegister.location_id.is_(None), CashRegister.location_id.in_(allowed)))
    can_view_money = has_permission(me, "moneyCashRegisterAccess")
    return [cash_register_out(register, can_view_money) for register in db.scalars(query).all()]


@router.post("", response_model=CashRegisterOut, dependencies=[Depends(require("changeCashRegisterAccess"))])
def create_cash_register(data: CashRegisterIn, db: DbSession, me: CurrentEmployee):
    check_register_location(db, me, data.location_id)
    if data.is_default:
        clear_default(db, data.location_id)
    register = CashRegister(**data.model_dump())
    db.add(register)
    db.commit()
    return cash_register_out(register, has_permission(me, "moneyCashRegisterAccess"))


@router.put("/{register_id}", response_model=CashRegisterOut, dependencies=[Depends(require("changeCashRegisterAccess"))])
def update_cash_register(register_id: int, data: CashRegisterIn, db: DbSession, me: CurrentEmployee):
    register = db.get(CashRegister, register_id)
    if register is None or not register.is_active:
        raise NotFound("Касса")
    check_register_location(db, me, register.location_id)
    check_register_location(db, me, data.location_id)
    if data.is_default:
        clear_default(db, data.location_id, exclude_id=register_id)
    for field, value in data.model_dump().items():
        setattr(register, field, value)
    db.commit()
    return cash_register_out(register, has_permission(me, "moneyCashRegisterAccess"))


@router.delete("/{register_id}", status_code=204, dependencies=[Depends(require("changeCashRegisterAccess"))])
def archive_cash_register(register_id: int, db: DbSession, me: CurrentEmployee):
    register = db.get(CashRegister, register_id)
    if register is None or not register.is_active:
        raise NotFound("Касса")
    check_register_location(db, me, register.location_id)
    if register.cash_balance != Decimal("0") or register.bank_balance != Decimal("0"):
        raise BusinessError("Нельзя архивировать кассу с ненулевым остатком")
    register.is_active = False
    db.commit()
    return Response(status_code=204)