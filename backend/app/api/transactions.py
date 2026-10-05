from datetime import date, datetime, time, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_, select

from app.api.deps import CurrentEmployee, DbSession, check_location, has_permission, location_ids, require
from app.errors import BusinessError, Forbidden, NotFound
from app.models import CashItem, CashRegister, Transaction
from app.services import money

router = APIRouter(tags=["Финансы"])


class TransactionCreate(BaseModel):
    cash_register_id: int
    cash_item_id: int
    amount: Decimal = Field(gt=Decimal("0"))
    is_bank: bool = False
    date: datetime | None = None
    counteragent_id: int | None = None
    note: str | None = None


class MoneyMove(BaseModel):
    from_register_id: int
    to_register_id: int
    amount: Decimal = Field(gt=Decimal("0"))
    is_bank: bool = False
    note: str | None = None


class CashItemIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    is_income: bool
    affects_balance: bool = False


class CashItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    is_income: bool
    type: str | None
    affects_balance: bool
    is_active: bool


class TransactionPage(BaseModel):
    items: list[dict]
    total: int
    page: int


def validate_register(db: DbSession, me: CurrentEmployee, register_id: int) -> CashRegister:
    register = db.get(CashRegister, register_id)
    if register is None or not register.is_active:
        raise NotFound("Касса")
    if register.location_id is not None:
        check_location(me, register.location_id)
    return register


def transaction_dict(db: DbSession, transaction: Transaction) -> dict:
    register = db.get(CashRegister, transaction.cash_register_id)
    item = db.get(CashItem, transaction.cash_item_id)
    return {
        "id": transaction.id,
        "date": transaction.date,
        "cash_register_id": transaction.cash_register_id,
        "cash_register_name": register.name if register else None,
        "cash_item_id": transaction.cash_item_id,
        "cash_item_name": item.name if item else None,
        "is_income": transaction.is_income,
        "is_bank": transaction.is_bank,
        "amount": transaction.amount,
        "balance_after": transaction.balance_after,
        "location_id": transaction.location_id,
        "counteragent_id": transaction.counteragent_id,
        "employee_id": transaction.employee_id,
        "created_by_id": transaction.created_by_id,
        "order_id": transaction.order_id,
        "sale_id": transaction.sale_id,
        "stock_document_id": transaction.stock_document_id,
        "pair_id": transaction.pair_id,
        "note": transaction.note,
        "is_deleted": transaction.is_deleted,
    }


@router.get("/transactions", response_model=TransactionPage, dependencies=[Depends(require("transactionAccess"))])
def list_transactions(
    db: DbSession,
    me: CurrentEmployee,
    cash_register_id: int | None = None,
    location_id: int | None = None,
    cash_item_id: int | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    deleted: bool = False,
    page: int = Query(default=1, ge=1),
):
    if deleted and not has_permission(me, "viewDeleteTransactionAccess"):
        raise Forbidden("Нет права видеть удалённые транзакции")
    allowed = location_ids(me)
    if location_id is not None:
        check_location(me, location_id)
    query = select(Transaction).order_by(Transaction.date.desc(), Transaction.id.desc())
    query = query.where(Transaction.is_deleted.is_(deleted))
    if allowed:
        query = query.where(or_(Transaction.location_id.is_(None), Transaction.location_id.in_(allowed)))
    if location_id is not None:
        query = query.where(or_(Transaction.location_id.is_(None), Transaction.location_id == location_id))
    if cash_register_id is not None:
        validate_register(db, me, cash_register_id)
        query = query.where(Transaction.cash_register_id == cash_register_id)
    if cash_item_id is not None:
        query = query.where(Transaction.cash_item_id == cash_item_id)
    if date_from is not None:
        query = query.where(Transaction.date >= datetime.combine(date_from, time.min, tzinfo=timezone.utc))
    if date_to is not None:
        query = query.where(Transaction.date < datetime.combine(date_to, time.max, tzinfo=timezone.utc))
    items = db.scalars(query).all()
    total = len(items)
    items = items[(page - 1) * 50 : page * 50]
    return TransactionPage(items=[transaction_dict(db, item) for item in items], total=total, page=page)


@router.post("/transactions", dependencies=[Depends(require("operationCashRegisterAccess"))])
def create_transaction(data: TransactionCreate, db: DbSession, me: CurrentEmployee):
    register = validate_register(db, me, data.cash_register_id)
    item = db.get(CashItem, data.cash_item_id)
    if item is None or not item.is_active:
        raise NotFound("Статья движения денег")
    if item.type is not None:
        raise BusinessError("Для ручной операции выберите пользовательскую статью")
    transaction_date = data.date
    if transaction_date is not None:
        if transaction_date.tzinfo is None:
            transaction_date = transaction_date.replace(tzinfo=timezone.utc)
        if transaction_date < datetime.now(timezone.utc) and not has_permission(me, "cashDateAccess"):
            raise Forbidden("Нет права задавать дату транзакции в прошлом")
    transaction = money.create_transaction(
        db,
        cash_register_id=register.id,
        cash_item=item,
        amount=data.amount,
        is_bank=data.is_bank,
        date=transaction_date,
        counteragent_id=data.counteragent_id,
        created_by_id=me.id,
        note=data.note,
    )
    db.commit()
    return transaction_dict(db, transaction)


@router.post("/transactions/move", dependencies=[Depends(require("operationCashRegisterAccess"))])
def move_money(data: MoneyMove, db: DbSession, me: CurrentEmployee):
    validate_register(db, me, data.from_register_id)
    validate_register(db, me, data.to_register_id)
    outgoing, incoming = money.move_money(
        db,
        from_register_id=data.from_register_id,
        to_register_id=data.to_register_id,
        amount=data.amount,
        is_bank=data.is_bank,
        created_by_id=me.id,
        note=data.note,
    )
    db.commit()
    return {"outgoing": transaction_dict(db, outgoing), "incoming": transaction_dict(db, incoming)}


def assert_manual_transaction(transaction: Transaction) -> None:
    if transaction.order_id is not None or transaction.sale_id is not None or transaction.stock_document_id is not None:
        raise BusinessError("Связанную транзакцию можно удалить только из карточки документа")


@router.delete(
    "/transactions/{transaction_id}",
    status_code=204,
    dependencies=[Depends(require("changeTransactionAccess"))],
)
def delete_transaction(transaction_id: int, db: DbSession, me: CurrentEmployee):
    transaction = db.get(Transaction, transaction_id)
    if transaction is None or transaction.is_deleted:
        raise NotFound("Транзакция")
    validate_register(db, me, transaction.cash_register_id)
    assert_manual_transaction(transaction)
    money.delete_transaction(db, transaction)
    db.commit()
    return Response(status_code=204)


@router.post(
    "/transactions/{transaction_id}/restore",
    dependencies=[Depends(require("changeTransactionAccess"))],
)
def restore_transaction(transaction_id: int, db: DbSession, me: CurrentEmployee):
    transaction = db.get(Transaction, transaction_id)
    if transaction is None:
        raise NotFound("Транзакция")
    validate_register(db, me, transaction.cash_register_id)
    money.restore_transaction(db, transaction)
    db.commit()
    return transaction_dict(db, transaction)


@router.get("/cash-items", response_model=list[CashItemOut])
def list_cash_items(db: DbSession, _: CurrentEmployee):
    return db.scalars(select(CashItem).where(CashItem.is_active.is_(True)).order_by(CashItem.name, CashItem.id)).all()


@router.post("/cash-items", response_model=CashItemOut, dependencies=[Depends(require("cashItemAccess"))])
def create_cash_item(data: CashItemIn, db: DbSession):
    item = CashItem(name=data.name.strip(), is_income=data.is_income, affects_balance=data.affects_balance)
    db.add(item)
    db.commit()
    return item


@router.put("/cash-items/{item_id}", response_model=CashItemOut, dependencies=[Depends(require("cashItemAccess"))])
def update_cash_item(item_id: int, data: CashItemIn, db: DbSession):
    item = db.get(CashItem, item_id)
    if item is None or not item.is_active:
        raise NotFound("Статья движения денег")
    if item.type is not None:
        raise BusinessError("Системную статью нельзя изменить")
    item.name = data.name.strip()
    item.is_income = data.is_income
    item.affects_balance = data.affects_balance
    db.commit()
    return item


@router.delete("/cash-items/{item_id}", status_code=204, dependencies=[Depends(require("cashItemAccess"))])
def delete_cash_item(item_id: int, db: DbSession):
    item = db.get(CashItem, item_id)
    if item is None or not item.is_active:
        raise NotFound("Статья движения денег")
    if item.type is not None:
        raise BusinessError("Системную статью нельзя удалить")
    item.is_active = False
    db.commit()
    return Response(status_code=204)