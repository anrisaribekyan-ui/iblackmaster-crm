from decimal import Decimal

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import CurrentEmployee, DbSession, check_location, has_permission, location_ids
from app.errors import BusinessError, NotFound
from app.models import Nomenclature, StockBalance, Store

router = APIRouter(prefix="/stock/remains", tags=["Склад"])


class StockRemainOut(BaseModel):
    store_id: int
    store_name: str
    location_id: int
    nomenclature_id: int
    code: int
    article: str | None
    name: str
    quantity: Decimal
    avg_purchase_price: Decimal | None
    total: Decimal | None


@router.get("", response_model=list[StockRemainOut])
def list_stock_remains(
    db: DbSession,
    me: CurrentEmployee,
    location_id: int | None = None,
    store_id: int | None = None,
    q: str | None = None,
    only_positive: bool = False,
):
    if location_id is not None:
        check_location(me, location_id)
    query = (
        select(StockBalance, Store, Nomenclature)
        .join(Store, Store.id == StockBalance.store_id)
        .join(Nomenclature, Nomenclature.id == StockBalance.nomenclature_id)
        .where(Store.is_active.is_(True), Nomenclature.is_deleted.is_(False))
        .order_by(Nomenclature.name, Store.id)
    )
    allowed = location_ids(me)
    if allowed:
        query = query.where(Store.location_id.in_(allowed))
    if location_id is not None:
        query = query.where(Store.location_id == location_id)
    if store_id is not None:
        store = db.get(Store, store_id)
        if store is None or not store.is_active:
            raise NotFound("Склад")
        check_location(me, store.location_id)
        if location_id is not None and store.location_id != location_id:
            raise BusinessError("Склад не принадлежит указанной локации")
        query = query.where(Store.id == store_id)
    if only_positive:
        query = query.where(StockBalance.quantity > 0)

    rows = db.execute(query).all()
    if q:
        term = q.strip().casefold()
        rows = [
            row
            for row in rows
            if term in row[2].name.casefold()
            or term in (row[2].article or "").casefold()
            or term in str(row[2].code)
        ]

    can_view_purchase = has_permission(me, "purchasePriceAccess")
    return [
        StockRemainOut(
            store_id=store.id,
            store_name=store.name,
            location_id=store.location_id,
            nomenclature_id=item.id,
            code=item.code,
            article=item.article,
            name=item.name,
            quantity=balance.quantity,
            avg_purchase_price=balance.avg_purchase_price if can_view_purchase else None,
            total=(balance.quantity * balance.avg_purchase_price) if can_view_purchase else None,
        )
        for balance, store, item in rows
    ]