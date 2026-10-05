from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.api.deps import CurrentEmployee, DbSession, check_location, has_permission, require
from app.errors import BusinessError, Forbidden, NotFound
from app.models import (
    CashRegister,
    Counteragent,
    Location,
    Nomenclature,
    StockDocType,
    StockDocument,
    StockDocumentPosition,
    Store,
)
from app.services import stock_documents

router = APIRouter(prefix="/stock-documents", tags=["Склад"])

CREATE_PERMISSIONS = {
    StockDocType.PURCHASE: ("purchaseAccess", "createPurchaseDocumentAccess"),
    StockDocType.MOVE: ("moveAccess", "createMoveDocumentAccess"),
    StockDocType.CANCELLATION: ("cancellationAccess", "createCancellationDocumentAccess"),
}
CREATE_INVENTORY_PERMISSIONS = ("inventoryAccess", "createInventoryDocumentAccess")
CHANGE_INVENTORY_PERMISSIONS = ("inventoryAccess", "changeInventoryDocumentAccess")
DELETE_PERMISSIONS = {
    StockDocType.PURCHASE: ("purchaseAccess", "deletePurchaseDocumentAccess"),
    StockDocType.MOVE: ("moveAccess", "deleteMoveDocumentAccess"),
    StockDocType.CANCELLATION: ("cancellationAccess", "deleteCancellationDocumentAccess"),
    StockDocType.INVENTORY: ("inventoryAccess", "deleteInventoryDocumentAccess"),
}


class StockDocumentPositionIn(BaseModel):
    nomenclature_id: int
    quantity: Decimal = Field(gt=Decimal("0"))
    price: Decimal = Field(default=Decimal("0"), ge=Decimal("0"))
    serials: list[str] = Field(default_factory=list)


class StockDocumentCreate(BaseModel):
    type: Literal["purchase", "move", "cancellation"]
    location_id: int
    store_id: int
    to_store_id: int | None = None
    counteragent_id: int | None = None
    note: str | None = None
    cash_register_id: int | None = None
    amount: Decimal | None = Field(default=None, gt=Decimal("0"))
    is_bank: bool = False
    positions: list[StockDocumentPositionIn] = Field(min_length=1)


class StockDocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: StockDocType
    number: str
    location_id: int
    store_id: int
    to_store_id: int | None
    counteragent_id: int | None
    total: Decimal
    paid: Decimal
    is_posted: bool
    is_deleted: bool


class InventoryCreate(BaseModel):
    location_id: int
    store_id: int
    note: str | None = None


class InventoryPositionIn(BaseModel):
    nomenclature_id: int
    quantity: Decimal = Field(ge=Decimal("0"))


class InventoryPositionsIn(BaseModel):
    positions: list[InventoryPositionIn]


class InventoryPositionOut(BaseModel):
    id: int
    nomenclature_id: int
    quantity: Decimal
    quantity_accounted: Decimal | None
    price: Decimal


class InventoryDocumentOut(StockDocumentOut):
    note: str | None
    positions: list[InventoryPositionOut]


def get_store(db: DbSession, store_id: int, location_id: int) -> Store:
    store = db.get(Store, store_id)
    if store is None or not store.is_active:
        raise NotFound("Склад")
    if store.location_id != location_id:
        raise BusinessError("Склад не принадлежит указанной локации")
    return store


def require_document_permissions(employee: CurrentEmployee, codes: tuple[str, ...]) -> None:
    for code in codes:
        if not has_permission(employee, code):
            raise Forbidden(f"Нет права: {code}")


def get_inventory_document(db: DbSession, document_id: int) -> StockDocument:
    document = db.get(StockDocument, document_id)
    if document is None or document.is_deleted:
        raise NotFound("Инвентаризация")
    if document.type != StockDocType.INVENTORY:
        raise BusinessError("Документ не является инвентаризацией")
    return document


def inventory_out(db: DbSession, document: StockDocument) -> InventoryDocumentOut:
    positions = db.scalars(
        select(StockDocumentPosition)
        .where(StockDocumentPosition.document_id == document.id)
        .order_by(StockDocumentPosition.id)
    ).all()
    return InventoryDocumentOut(
        **StockDocumentOut.model_validate(document).model_dump(),
        note=document.note,
        positions=[
            InventoryPositionOut(
                id=position.id,
                nomenclature_id=position.nomenclature_id,
                quantity=position.quantity,
                quantity_accounted=position.quantity_accounted,
                price=position.price,
            )
            for position in positions
        ],
    )


@router.post("", response_model=StockDocumentOut)
def create_stock_document(data: StockDocumentCreate, db: DbSession, me: CurrentEmployee):
    doc_type = StockDocType(data.type)
    require_document_permissions(me, CREATE_PERMISSIONS[doc_type])
    check_location(me, data.location_id)
    location = db.get(Location, data.location_id)
    if location is None or not location.is_active:
        raise NotFound("Локация")
    get_store(db, data.store_id, data.location_id)

    if doc_type == StockDocType.MOVE:
        if data.to_store_id is None:
            raise BusinessError("Выберите склад назначения")
        target = db.get(Store, data.to_store_id)
        if target is None or not target.is_active:
            raise NotFound("Склад назначения")
        check_location(me, target.location_id)
    elif data.to_store_id is not None:
        raise BusinessError("Склад назначения указывается только для перемещения")

    if data.counteragent_id is not None:
        counteragent = db.get(Counteragent, data.counteragent_id)
        if counteragent is None or counteragent.is_deleted:
            raise NotFound("Поставщик")
    if doc_type != StockDocType.PURCHASE and (data.cash_register_id is not None or data.amount is not None):
        raise BusinessError("Оплата указывается только для поступления")
    if (data.cash_register_id is None) != (data.amount is None):
        raise BusinessError("Для оплаты укажите кассу и сумму")
    if data.cash_register_id is not None:
        register = db.get(CashRegister, data.cash_register_id)
        if register is None or not register.is_active:
            raise NotFound("Касса")
        if register.location_id is not None:
            check_location(me, register.location_id)

    positions = []
    for position in data.positions:
        item = db.get(Nomenclature, position.nomenclature_id)
        if item is None or item.is_deleted:
            raise NotFound("Номенклатура")
        if item.is_work:
            raise BusinessError("Работу нельзя включить в складской документ")
        positions.append(position.model_dump())

    document = stock_documents.create_document(
        db,
        doc_type=doc_type,
        location_id=data.location_id,
        store_id=data.store_id,
        to_store_id=data.to_store_id,
        counteragent_id=data.counteragent_id,
        responsible_id=me.id,
        note=data.note,
        positions=positions,
        cash_register_id=data.cash_register_id,
        amount=data.amount,
        is_bank=data.is_bank,
    )
    db.commit()
    return document


@router.post("/inventory", response_model=InventoryDocumentOut)
def create_inventory_document(data: InventoryCreate, db: DbSession, me: CurrentEmployee):
    require_document_permissions(me, CREATE_INVENTORY_PERMISSIONS)
    check_location(me, data.location_id)
    location = db.get(Location, data.location_id)
    if location is None or not location.is_active:
        raise NotFound("Локация")
    get_store(db, data.store_id, data.location_id)
    document = stock_documents.create_inventory(
        db,
        location_id=data.location_id,
        store_id=data.store_id,
        responsible_id=me.id,
        note=data.note,
    )
    db.commit()
    return inventory_out(db, document)


@router.put("/{document_id}/positions", response_model=InventoryDocumentOut)
def update_inventory_document_positions(
    document_id: int,
    data: InventoryPositionsIn,
    db: DbSession,
    me: CurrentEmployee,
):
    document = get_inventory_document(db, document_id)
    require_document_permissions(me, CHANGE_INVENTORY_PERMISSIONS)
    check_location(me, document.location_id)
    stock_documents.update_inventory_positions(
        db,
        document,
        [position.model_dump() for position in data.positions],
    )
    db.commit()
    return inventory_out(db, document)


@router.post("/{document_id}/finish", response_model=InventoryDocumentOut)
def finish_inventory_document(document_id: int, db: DbSession, me: CurrentEmployee):
    document = get_inventory_document(db, document_id)
    require_document_permissions(me, CHANGE_INVENTORY_PERMISSIONS)
    check_location(me, document.location_id)
    stock_documents.finish_inventory(db, document)
    db.commit()
    return inventory_out(db, document)


@router.delete("/{document_id}", status_code=204)
def delete_stock_document(document_id: int, db: DbSession, me: CurrentEmployee):
    document = db.get(StockDocument, document_id)
    if document is None or document.is_deleted:
        raise NotFound("Складской документ")
    require_document_permissions(me, DELETE_PERMISSIONS[StockDocType(document.type)])
    check_location(me, document.location_id)
    stock_documents.delete_document(db, document)
    db.commit()
    return Response(status_code=204)