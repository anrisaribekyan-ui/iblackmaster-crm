"""Зарплата (Финансы → Зарплата), как в LiveSklad: начисления по месяцам, правила, бонусы/штрафы, выплаты.

Видимость — право-выбор scope_of(me, "salary"): none → 403, own → только своя, all/locations → все
(locations — сотрудники, у которых есть общие со мной локации).
Начисления считает app.services.salary; здесь только чтение, ручные бонусы/штрафы, выплаты и правила.
"""

from datetime import datetime, timezone
from decimal import Decimal
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.api.deps import CurrentEmployee, DbSession, location_ids, require, scope_of
from app.db import Rubles, utcnow
from app.errors import BusinessError, Forbidden, NotFound
from app.models import (
    AccrualKind,
    CashItemType,
    Employee,
    Location,
    Order,
    OrderType,
    Sale,
    SalaryEvent,
    SalaryRule,
    Transaction,
)
from app.services import money
from app.services import salary as salary_service

router = APIRouter(prefix="/salary", tags=["Зарплата"])

MSK = ZoneInfo("Europe/Moscow")
MANUAL_KINDS = {AccrualKind.BONUS, AccrualKind.PENALTY}
KIND_TITLES = {
    AccrualKind.WORK_ORDER: "За выполненную работу",
    AccrualKind.PRODUCT_ORDER: "За установленную запчасть",
    AccrualKind.NEW_ORDER: "За новый заказ",
    AccrualKind.MANAGER_ORDER: "За ведение заказа",
    AccrualKind.CLOSED_ORDER: "За выдачу заказа",
    AccrualKind.SALE_SHOP: "За продажу",
    AccrualKind.MONEY: "Оклад",
    AccrualKind.REVENUE: "Премия от оборота",
    AccrualKind.BONUS: "Бонус",
    AccrualKind.PENALTY: "Штраф",
}


# --- Помощники ---------------------------------------------------------------------


def month_bounds(year: int, month: int) -> tuple[datetime, datetime]:
    """Границы месяца по Москве в UTC."""
    start = datetime(year, month, 1, tzinfo=MSK)
    end = datetime(year + (month == 12), month % 12 + 1, 1, tzinfo=MSK)
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


def _scope(me: Employee) -> str:
    scope = scope_of(me, "salary")
    if scope == "none":
        raise Forbidden("Нет доступа к зарплате")
    return scope


def visible_employees(db: DbSession, me: Employee) -> list[Employee]:
    scope = _scope(me)
    employees = db.scalars(select(Employee).where(Employee.is_active.is_(True)).order_by(Employee.name)).all()
    if scope == "own":
        return [e for e in employees if e.id == me.id]
    if scope == "locations" and not me.is_owner:
        mine = location_ids(me)
        return [e for e in employees if e.id == me.id or not mine or {loc.id for loc in e.locations} & mine]
    return list(employees)


def check_employee(db: DbSession, me: Employee, employee_id: int) -> Employee:
    employee = next((e for e in visible_employees(db, me) if e.id == employee_id), None)
    if employee is None:
        raise NotFound("Сотрудник")
    return employee


def _sums(db: DbSession, employee_id: int, start: datetime, end: datetime, location_id: int | None) -> dict:
    query = select(SalaryEvent.kind, func.sum(SalaryEvent.amount)).where(
        SalaryEvent.employee_id == employee_id, SalaryEvent.date >= start, SalaryEvent.date < end
    )
    if location_id is not None:
        query = query.where(SalaryEvent.location_id == location_id)
    by_kind = {kind: amount or Decimal("0") for kind, amount in db.execute(query.group_by(SalaryEvent.kind))}
    salary_item = money.get_system_item(db, CashItemType.SALARY)
    paid_query = select(func.sum(Transaction.amount)).where(
        Transaction.employee_id == employee_id,
        Transaction.cash_item_id == salary_item.id,
        Transaction.is_deleted.is_(False),
        Transaction.date >= start,
        Transaction.date < end,
    )
    if location_id is not None:
        paid_query = paid_query.where(Transaction.location_id == location_id)
    paid = db.scalar(paid_query) or Decimal("0")
    money_part = by_kind.get(AccrualKind.MONEY, Decimal("0"))
    bonuses = by_kind.get(AccrualKind.BONUS, Decimal("0")) + by_kind.get(AccrualKind.REVENUE, Decimal("0"))
    penalties = by_kind.get(AccrualKind.PENALTY, Decimal("0"))
    accrued = sum(by_kind.values(), Decimal("0")) - money_part - bonuses - penalties
    total = money_part + accrued + bonuses + penalties
    return {
        "salary": money_part,
        "accrued": accrued,
        "bonuses": bonuses,
        "penalties": penalties,
        "total": total,
        "paid": paid,
        "to_pay": total - paid,
    }


# --- Сводка и история --------------------------------------------------------------


@router.get("/summary")
def salary_summary(
    db: DbSession,
    me: CurrentEmployee,
    year: int = Query(ge=2000, le=2100),
    month: int = Query(ge=1, le=12),
    location_id: int | None = None,
):
    """Таблица «Сотрудник / Начислено / К выплате» за месяц (как главная страница зарплаты в LiveSklad)."""
    start, end = month_bounds(year, month)
    rows = []
    for employee in visible_employees(db, me):
        rows.append({"employee_id": employee.id, "name": employee.name, **_sums(db, employee.id, start, end, location_id)})
    return {"items": rows, "total": sum((r["total"] for r in rows), Decimal("0")), "to_pay": sum((r["to_pay"] for r in rows), Decimal("0"))}


@router.get("/employees/{employee_id}/months")
def salary_months(employee_id: int, db: DbSession, me: CurrentEmployee, location_id: int | None = None):
    """Помесячная история сотрудника: оклад, начисления, бонусы, штрафы, итого, выплачено, к выплате."""
    check_employee(db, me, employee_id)
    first = db.scalar(select(func.min(SalaryEvent.date)).where(SalaryEvent.employee_id == employee_id))
    now = utcnow().astimezone(MSK)
    if first is None:
        first = now
    first = first.astimezone(MSK) if first.tzinfo else first.replace(tzinfo=timezone.utc).astimezone(MSK)
    year, month = now.year, now.month
    rows = []
    while (year, month) >= (first.year, first.month):
        start, end = month_bounds(year, month)
        rows.append({"year": year, "month": month, **_sums(db, employee_id, start, end, location_id)})
        year, month = (year - 1, 12) if month == 1 else (year, month - 1)
    return rows


@router.get("/employees/{employee_id}/events")
def salary_events(
    employee_id: int,
    db: DbSession,
    me: CurrentEmployee,
    year: int = Query(ge=2000, le=2100),
    month: int = Query(ge=1, le=12),
):
    """Расшифровка начислений за месяц: за что, по какому заказу/чеку, база и процент."""
    check_employee(db, me, employee_id)
    start, end = month_bounds(year, month)
    items = db.scalars(
        select(SalaryEvent)
        .where(SalaryEvent.employee_id == employee_id, SalaryEvent.date >= start, SalaryEvent.date < end)
        .order_by(SalaryEvent.date.desc(), SalaryEvent.id.desc())
    ).all()
    result = []
    for event in items:
        order = db.get(Order, event.order_id) if event.order_id else None
        sale = db.get(Sale, event.sale_id) if event.sale_id else None
        result.append(
            {
                "id": event.id,
                "date": event.date,
                "kind": event.kind,
                "kind_title": KIND_TITLES.get(AccrualKind(event.kind), event.kind),
                "amount": event.amount,
                "order_id": event.order_id,
                "order_number": order.number if order else None,
                "sale_id": event.sale_id,
                "sale_number": sale.number if sale else None,
                "details": event.details,
                "is_manual": event.is_manual,
                "note": event.note,
            }
        )
    return result


# --- Бонусы и штрафы ---------------------------------------------------------------


class ManualEventIn(BaseModel):
    employee_id: int
    kind: Literal["bonus", "penalty"]
    amount: Rubles = Field(gt=Decimal("0"))
    date: datetime | None = None
    location_id: int | None = None
    note: str | None = Field(default=None, max_length=500)


@router.post("/events", dependencies=[Depends(require("bonusPenaltyRevenueSalaryAccess"))])
def create_manual_event(data: ManualEventIn, db: DbSession, me: CurrentEmployee):
    check_employee(db, me, data.employee_id)
    if data.location_id is not None and db.get(Location, data.location_id) is None:
        raise NotFound("Локация")
    kind = AccrualKind(data.kind)
    event = SalaryEvent(
        employee_id=data.employee_id,
        kind=kind,
        date=data.date or utcnow(),
        amount=data.amount if kind == AccrualKind.BONUS else -data.amount,
        location_id=data.location_id,
        is_manual=True,
        note=data.note,
        created_by_id=me.id,
    )
    db.add(event)
    db.commit()
    return {"id": event.id, "amount": event.amount}


@router.delete("/events/{event_id}", status_code=204, dependencies=[Depends(require("changeSalaryAccess"))])
def delete_manual_event(event_id: int, db: DbSession, me: CurrentEmployee):
    event = db.get(SalaryEvent, event_id)
    if event is None:
        raise NotFound("Начисление")
    check_employee(db, me, event.employee_id)
    if not event.is_manual:
        raise BusinessError("Автоматическое начисление удаляется вместе с заказом или чеком. Измените заказ или правило")
    db.delete(event)
    db.commit()


# --- Выплаты -----------------------------------------------------------------------


class PayoutIn(BaseModel):
    employee_id: int
    cash_register_id: int
    amount: Rubles = Field(gt=Decimal("0"))
    is_bank: bool = False
    note: str | None = Field(default=None, max_length=500)


@router.post("/payouts", dependencies=[Depends(require("cashSalaryAccess"))])
def create_payout(data: PayoutIn, db: DbSession, me: CurrentEmployee):
    employee = check_employee(db, me, data.employee_id)
    tx = money.create_transaction(
        db,
        cash_register_id=data.cash_register_id,
        cash_item=money.get_system_item(db, CashItemType.SALARY),
        amount=data.amount,
        is_bank=data.is_bank,
        employee_id=employee.id,
        created_by_id=me.id,
        note=data.note or f"Зарплата: {employee.name}",
    )
    db.commit()
    return {"id": tx.id, "amount": tx.amount}


@router.get("/employees/{employee_id}/payouts")
def salary_payouts(employee_id: int, db: DbSession, me: CurrentEmployee):
    check_employee(db, me, employee_id)
    salary_item = money.get_system_item(db, CashItemType.SALARY)
    items = db.scalars(
        select(Transaction)
        .where(
            Transaction.employee_id == employee_id,
            Transaction.cash_item_id == salary_item.id,
            Transaction.is_deleted.is_(False),
        )
        .order_by(Transaction.date.desc())
        .limit(200)
    ).all()
    return [
        {"id": t.id, "date": t.date, "amount": t.amount, "is_bank": t.is_bank, "cash_register_id": t.cash_register_id, "note": t.note}
        for t in items
    ]


# --- Правила -----------------------------------------------------------------------


class Step(BaseModel):
    from_: Decimal = Field(default=Decimal("0"), alias="from", ge=Decimal("0"))
    value: Decimal = Field(ge=Decimal("0"))

    model_config = {"populate_by_name": True}


class RuleIn(BaseModel):
    employee_id: int
    kind: Literal["workOrder", "productOrder", "newOrder", "managerOrder", "closedOrder", "saleShop"]
    location_id: int | None = None
    order_type_id: int | None = None
    base: Literal["margin", "summ"] = "margin"
    value_type: Literal["percent", "fixed"] = "percent"
    steps: list[Step] = Field(min_length=1)
    accrue_on: Literal["finish", "close"] = "finish"
    discount_by: Literal["worker", "company"] = "worker"
    subtract_negative_margin: bool = False
    keep_on_return: bool = False
    max_amount: Rubles | None = None
    options: dict = Field(default_factory=dict)


def rule_dict(db: DbSession, rule: SalaryRule) -> dict:
    location = db.get(Location, rule.location_id) if rule.location_id else None
    order_type = db.get(OrderType, rule.order_type_id) if rule.order_type_id else None
    return {
        "id": rule.id,
        "employee_id": rule.employee_id,
        "kind": rule.kind,
        "kind_title": KIND_TITLES.get(AccrualKind(rule.kind), rule.kind),
        "location_id": rule.location_id,
        "location_name": location.name if location else None,
        "order_type_id": rule.order_type_id,
        "order_type_name": order_type.name if order_type else None,
        "base": rule.base,
        "value_type": rule.value_type,
        "steps": rule.steps,
        "accrue_on": rule.accrue_on,
        "discount_by": rule.discount_by,
        "subtract_negative_margin": rule.subtract_negative_margin,
        "keep_on_return": rule.keep_on_return,
        "max_amount": rule.max_amount,
        "options": rule.options,
    }


def _apply_rule_data(db: DbSession, rule: SalaryRule, data: RuleIn) -> None:
    if db.get(Employee, data.employee_id) is None:
        raise NotFound("Сотрудник")
    if data.location_id is not None and db.get(Location, data.location_id) is None:
        raise NotFound("Локация")
    if data.order_type_id is not None:
        if data.kind == "saleShop":
            raise BusinessError("У продаж нет типа заказа")
        if db.get(OrderType, data.order_type_id) is None:
            raise NotFound("Тип заказа")
    duplicate = db.scalar(
        select(SalaryRule.id).where(
            SalaryRule.employee_id == data.employee_id,
            SalaryRule.kind == data.kind,
            SalaryRule.location_id.is_(None) if data.location_id is None else SalaryRule.location_id == data.location_id,
            SalaryRule.order_type_id.is_(None) if data.order_type_id is None else SalaryRule.order_type_id == data.order_type_id,
            SalaryRule.id != (rule.id or 0),
        )
    )
    if duplicate:
        raise BusinessError("Такое начисление уже настроено — измените его")
    values = data.model_dump(by_alias=True)
    values["steps"] = [{"from": float(s["from"]), "value": float(s["value"])} for s in values["steps"]]
    for field, value in values.items():
        setattr(rule, field, value)


@router.get("/rules")
def list_rules(employee_id: int, db: DbSession, me: CurrentEmployee):
    check_employee(db, me, employee_id)
    rules = db.scalars(select(SalaryRule).where(SalaryRule.employee_id == employee_id).order_by(SalaryRule.kind, SalaryRule.id)).all()
    return [rule_dict(db, r) for r in rules]


@router.post("/rules", dependencies=[Depends(require("salarySettingAccess"))])
def create_rule(data: RuleIn, db: DbSession, me: CurrentEmployee):
    rule = SalaryRule()
    _apply_rule_data(db, rule, data)
    db.add(rule)
    db.commit()
    return rule_dict(db, rule)


@router.put("/rules/{rule_id}", dependencies=[Depends(require("salarySettingAccess"))])
def update_rule(rule_id: int, data: RuleIn, db: DbSession, me: CurrentEmployee):
    rule = db.get(SalaryRule, rule_id)
    if rule is None:
        raise NotFound("Правило")
    _apply_rule_data(db, rule, data)
    db.commit()
    return rule_dict(db, rule)


@router.delete("/rules/{rule_id}", status_code=204, dependencies=[Depends(require("salarySettingAccess"))])
def delete_rule(rule_id: int, db: DbSession, me: CurrentEmployee):
    rule = db.get(SalaryRule, rule_id)
    if rule is None:
        raise NotFound("Правило")
    db.delete(rule)
    db.commit()


class RecalcIn(BaseModel):
    year: int = Field(ge=2000, le=2100)
    month: int = Field(ge=1, le=12)


@router.post("/recalc", dependencies=[Depends(require("salarySettingAccess"))])
def recalc(data: RecalcIn, db: DbSession, me: CurrentEmployee):
    """«Пересчитать зарплату» за месяц после изменения правил."""
    start, end = month_bounds(data.year, data.month)
    count = salary_service.recalc_period(db, start, end)
    db.commit()
    return {"documents": count}


@router.get("/kinds")
def kinds(me: CurrentEmployee):
    return [{"code": k.value, "title": t} for k, t in KIND_TITLES.items()]
