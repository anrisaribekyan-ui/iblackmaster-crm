from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import CurrentEmployee, DbSession, check_location, has_permission, require
from app.db import Rubles
from app.errors import BusinessError, Forbidden, NotFound
from app.models import CashRegister, Counteragent, Employee, Location, Nomenclature, Sale, SalePosition, Store, Transaction
from app.services import sales as sales_service

router = APIRouter(prefix="/sales", tags=["Продажи"])


class SalePositionIn(BaseModel):
    nomenclature_id: int | None = None
    name: str | None = None
    is_work: bool = False
    quantity: Decimal = Field(gt=Decimal("0"))
    price: Decimal = Field(ge=Decimal("0"))
    discount: Decimal = Field(default=Decimal("0"), ge=Decimal("0"))  # скидка на всю позицию, ₽
    guarantee_days: int | None = None
    serials: list[str] = Field(default_factory=list)
    # Быстрая продажа: товар, которого нет в справочнике или на складе. Себестоимость вводят руками,
    # склад не трогаем. Для позиции из справочника no_stock=True — продать, не списывая со склада.
    purchase_price: Decimal | None = Field(default=None, ge=Decimal("0"))
    no_stock: bool = False


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
    discount_sum: Rubles = Field(default=Decimal("0"), ge=Decimal("0"))
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
    if any(p.discount > 0 for p in data.positions) and not has_permission(me, "discountSaleAccess"):
        raise Forbidden("Нет права: discountSaleAccess")
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
        elif not (position.name or "").strip():
            raise BusinessError("Укажите название позиции")

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


class SaleTipIn(BaseModel):
    cash_register_id: int
    amount: Decimal = Field(gt=Decimal("0"))
    is_bank: bool = False
    employee_id: int | None = None


@router.post("/{sale_id}/tips", dependencies=[Depends(require("operationCashRegisterAccess"))])
def tip_sale(sale_id: int, data: SaleTipIn, db: DbSession, me: CurrentEmployee):
    from app.services import tips

    sale = db.get(Sale, sale_id)
    if sale is None or sale.is_deleted:
        raise NotFound("Чек")
    check_location(me, sale.location_id)
    register = validate_cash_register(db, me, data.cash_register_id)
    if register.location_id is not None and register.location_id != sale.location_id:
        raise BusinessError("Касса должна быть глобальной или находиться в локации продажи")
    tx = tips.add_tip(db, sale=sale, me=me, cash_register_id=register.id, amount=data.amount,
                      is_bank=data.is_bank, employee_id=data.employee_id)
    db.commit()
    return {"id": tx.id, "amount": tx.amount}


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

class ChangePaymentMethodIn(BaseModel):
    is_bank: bool
    cash_register_id: int | None = None


@router.post(
    "/{sale_id}/payments/{tx_id}/change-method",
    dependencies=[Depends(require("changeTransactionAccess")), Depends(require("operationCashRegisterAccess"))],
)
def change_sale_payment_method(sale_id: int, tx_id: int, data: ChangePaymentMethodIn, db: DbSession, me: CurrentEmployee):
    sale = db.get(Sale, sale_id)
    if sale is None or sale.is_deleted:
        raise NotFound("Чек")
    check_location(me, sale.location_id)
    transaction = db.get(Transaction, tx_id)
    if transaction is None or transaction.is_deleted or transaction.sale_id != sale.id:
        raise NotFound("Оплата чека")
    if data.cash_register_id:
        register = validate_cash_register(db, me, data.cash_register_id)
        if register.location_id is not None and register.location_id != sale.location_id:
            raise BusinessError("Касса должна быть глобальной или находиться в локации продажи")
    new_tx = sales_service.change_payment_method(db, sale, transaction, me.id, is_bank=data.is_bank, cash_register_id=data.cash_register_id)
    db.commit()
    return {"id": new_tx.id, "amount": new_tx.amount}


# --- Просмотр чеков --------------------------------------------------------------------


@router.get("/top")
def top_positions(db: DbSession, me: CurrentEmployee, location_id: int, store_id: int | None = None, limit: int = 12):
    """Что чаще всего пробивают в этой точке за последние 90 дней — для плиток быстрой продажи.
    Позиции из справочника — по номенклатуре, свободные — по названию. Цена и себестоимость — из последней продажи."""
    from datetime import timedelta

    from app.db import utcnow
    from app.models import StockBalance

    check_location(me, location_id)
    since = utcnow() - timedelta(days=90)
    rows = db.execute(
        select(SalePosition.nomenclature_id, SalePosition.name, SalePosition.is_work, SalePosition.price,
               SalePosition.purchase_price, SalePosition.quantity, Sale.date)
        .join(Sale, Sale.id == SalePosition.sale_id)
        .where(Sale.is_deleted.is_(False), Sale.location_id == location_id, Sale.date >= since)
        .order_by(Sale.date)
    ).all()
    groups: dict[str, dict] = {}
    for r in rows:
        key = f"n{r.nomenclature_id}" if r.nomenclature_id else "t" + " ".join(r.name.lower().split())
        g = groups.setdefault(key, {"key": key, "nomenclature_id": r.nomenclature_id, "count": 0, "quantity": Decimal("0")})
        g["count"] += 1
        g["quantity"] += r.quantity
        g.update(name=r.name, is_work=r.is_work, price=r.price, purchase_price=r.purchase_price, last=r.date)
    top = sorted(groups.values(), key=lambda g: (-g["count"], -g["quantity"]))[: max(1, min(limit, 30))]
    ids = [g["nomenclature_id"] for g in top if g["nomenclature_id"]]
    noms = {n.id: n for n in db.scalars(select(Nomenclature).where(Nomenclature.id.in_(ids or [0])))}
    stocks: dict[int, Decimal] = {}
    if store_id and ids:
        stocks = dict(db.execute(
            select(StockBalance.nomenclature_id, StockBalance.quantity)
            .where(StockBalance.store_id == store_id, StockBalance.nomenclature_id.in_(ids))
        ).all())
    result = []
    for g in top:
        nom = noms.get(g["nomenclature_id"]) if g["nomenclature_id"] else None
        if g["nomenclature_id"] and (nom is None or nom.is_deleted):
            continue
        result.append({
            "key": g["key"],
            "nomenclature_id": g["nomenclature_id"],
            "name": nom.name if nom else g["name"],
            "is_work": g["is_work"],
            "price": g["price"],
            "purchase_price": g["purchase_price"],
            "count": g["count"],
            "stock": stocks.get(g["nomenclature_id"], Decimal("0")) if nom and not nom.is_work else None,
        })
    return result


@router.get("")
def list_sales(db: DbSession, me: CurrentEmployee, location_id: int | None = None, page: int = 1, month: str | None = None):
    """month=2026-09 — только чеки этого месяца (по московскому времени)."""
    from sqlalchemy import func

    from app.api.deps import location_ids
    from app.models import Employee

    allowed = location_ids(me)
    q = select(Sale).where(Sale.is_deleted.is_(False))
    if location_id is not None:
        check_location(me, location_id)
        q = q.where(Sale.location_id == location_id)
    elif allowed:
        q = q.where(Sale.location_id.in_(allowed))
    if month:
        import re
        from datetime import timedelta, timezone

        from app.config import settings as app_settings

        if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
            raise BusinessError("Месяц указывается как 2026-09")
        year, mon = int(month[:4]), int(month[5:])
        shift = timedelta(minutes=app_settings.company_utc_offset_minutes)
        start = datetime(year, mon, 1) - shift
        end = datetime(year + (mon == 12), mon % 12 + 1, 1) - shift
        q = q.where(Sale.date >= start.replace(tzinfo=timezone.utc), Sale.date < end.replace(tzinfo=timezone.utc))
    total = db.scalar(select(func.count()).select_from(q.subquery())) or 0
    rows = db.scalars(q.order_by(Sale.date.desc(), Sale.id.desc()).offset((max(page, 1) - 1) * 50).limit(50)).all()
    can_see_buyer = has_permission(me, "counteragentShopAccess")
    agents = {c.id: c.name for c in db.scalars(select(Counteragent).where(Counteragent.id.in_({r.counteragent_id for r in rows if r.counteragent_id} or {0})))}
    sellers = {e.id: e.short_name for e in db.scalars(select(Employee).where(Employee.id.in_({r.seller_id for r in rows} or {0})))}
    return {
        "total": total,
        "items": [
            {
                "id": r.id,
                "number": r.number,
                "date": r.date,
                "location_id": r.location_id,
                "total_price": r.total_price,
                "paid": r.paid,
                "counteragent": agents.get(r.counteragent_id) if can_see_buyer and r.counteragent_id else None,
                "seller": sellers.get(r.seller_id),
            }
            for r in rows
        ],
    }


@router.get("/{sale_id}")
def get_sale(sale_id: int, db: DbSession, me: CurrentEmployee):
    sale = db.get(Sale, sale_id)
    if sale is None or sale.is_deleted:
        raise NotFound("Чек")
    check_location(me, sale.location_id)
    agent = db.get(Counteragent, sale.counteragent_id) if sale.counteragent_id else None
    seller = db.get(Employee, sale.seller_id) if sale.seller_id else None
    # Как оплачено: каждая проводка по чеку (приход) со способом: наличные / безнал и названием кассы или терминала
    pay_rows = db.execute(
        select(Transaction, CashRegister)
        .join(CashRegister, CashRegister.id == Transaction.cash_register_id)
        .where(Transaction.sale_id == sale.id, Transaction.is_income.is_(True), Transaction.is_deleted.is_(False), Transaction.pair_id.is_(None))
        .order_by(Transaction.id)
    ).all()
    return {
        "id": sale.id,
        "number": sale.number,
        "date": sale.date,
        "location_id": sale.location_id,
        "store_id": sale.store_id,
        "total_price": sale.total_price,
        "paid": sale.paid,
        "payments": [
            {"id": t.id, "amount": t.amount, "method": "bank" if t.is_bank else "cash", "register": r.name, "register_id": r.id}
            for t, r in pay_rows
        ],
        "discount_percent": sale.discount_percent,
        "discount_sum": sale.discount_sum,
        "note": sale.note,
        "seller": seller.short_name if seller else None,
        "counteragent": agent.name if agent and has_permission(me, "counteragentShopAccess") else None,
        "positions": [
            {
                "id": p.id,
                "name": p.name,
                "is_work": p.is_work,
                "quantity": p.quantity,
                "price": p.price,
                "discount": ((p.price - p.sold_price) * p.quantity).quantize(Decimal("1")),
                "sold_price": p.sold_price,
                "returned_quantity": p.returned_quantity,
            }
            for p in sale.positions
        ],
    }


# --- Перенос архива продаж из LiveSklad (без касс и склада: деньги уже в кассах) ---------


class ArchiveSaleIn(BaseModel):
    number: str = Field(min_length=1, max_length=20)
    date: datetime
    location_id: int
    seller_id: int
    total: int = Field(ge=0)
    cost: int = Field(ge=0)
    paid: int = Field(ge=0)


@router.post("/import-archive", dependencies=[Depends(require("settingAccess"))])
def import_archive(items: list[ArchiveSaleIn], db: DbSession, me: CurrentEmployee):
    """Идемпотентно добавляет проданные чеки одной позицией «Продажа из LiveSklad»."""
    existing = set(db.scalars(select(Sale.number).where(Sale.number.in_([i.number for i in items]))))
    stores = {s.location_id: s.id for s in db.scalars(select(Store).order_by(Store.is_default.desc(), Store.id)).all()[::-1]}
    created = 0
    for i in items:
        if i.number in existing or i.location_id not in stores:
            continue
        sale = Sale(number=i.number, date=i.date, location_id=i.location_id, store_id=stores[i.location_id], seller_id=i.seller_id,
                    total_price=Decimal(i.total), total_purchase=Decimal(i.cost), paid=Decimal(i.paid), note="Перенесено из LiveSklad")
        sale.positions.append(SalePosition(name="Продажа из LiveSklad", quantity=Decimal(1), price=Decimal(i.total),
                                           sold_price=Decimal(i.total), purchase_price=Decimal(i.cost)))
        db.add(sale)
        created += 1
    db.commit()
    return {"created": created, "skipped": len(items) - created}


@router.post("/hide-duplicates", dependencies=[Depends(require("settingAccess"))])
def hide_duplicates(numbers: list[str], db: DbSession, me: CurrentEmployee):
    """Скрывает чеки (дубли архива LiveSklad и пробные) из отчётов. Деньги в кассах остаются как есть."""
    sales = db.scalars(select(Sale).where(Sale.number.in_(numbers), Sale.is_deleted.is_(False))).all()
    for sale in sales:
        sale.is_deleted = True
        sale.note = ((sale.note or "") + " Скрыт: дубль продажи из LiveSklad").strip()
    db.commit()
    return {"hidden": len(sales)}
