from decimal import Decimal

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_, select

from app.api.deps import CurrentEmployee, DbSession, check_location, has_permission, require
from app.db import Rubles
from app.errors import BusinessError, Forbidden, NotFound
from app.models import (
    Measure,
    Nomenclature,
    NomenclatureGroup,
    NomenclaturePrice,
    PriceType,
    StockBalance,
    Store,
)

router = APIRouter(tags=["Номенклатура"])


class PriceIn(BaseModel):
    price_type_id: int
    price: Rubles


class PriceOut(BaseModel):
    price_type_id: int
    name: str
    price: Decimal
    location_id: int | None


class NomenclatureIn(BaseModel):
    article: str | None = Field(default=None, max_length=100)
    name: str = Field(min_length=1, max_length=300)
    is_work: bool = False
    group_id: int | None = None
    measure_id: int | None = None
    purchase_price: Rubles = Decimal("0")
    guarantee_days: int = 0
    min_count: Decimal = Decimal("0")
    has_serials: bool = False
    note: str | None = None
    salary_percent: Decimal | None = None
    salary_fixed: Rubles | None = None
    prices: list[PriceIn] = Field(default_factory=list)


class NomenclatureOut(BaseModel):
    id: int
    code: int
    article: str | None
    name: str
    is_work: bool
    group_id: int | None
    measure_id: int | None
    purchase_price: Decimal | None
    guarantee_days: int
    min_count: Decimal
    has_serials: bool
    note: str | None
    salary_percent: Decimal | None
    salary_fixed: Decimal | None
    prices: list[PriceOut]
    stock_quantity: Decimal | None


class NomenclaturePage(BaseModel):
    items: list[NomenclatureOut]
    total: int
    page: int


class NomenclatureGroupIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    parent_id: int | None = None
    salary_percent: Decimal | None = None
    salary_fixed: Rubles | None = None


class NomenclatureGroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    parent_id: int | None
    salary_percent: Decimal | None
    salary_fixed: Decimal | None
    children: list["NomenclatureGroupOut"] = Field(default_factory=list)


class PriceTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    is_minimal: bool
    sort: int


def check_nomenclature_permission(employee: CurrentEmployee, is_work: bool) -> None:
    code = "workAccess" if is_work else "nomenclatureAccess"
    if not has_permission(employee, code):
        raise Forbidden(f"Нет права: {code}")


def validate_nomenclature_references(db: DbSession, group_id: int | None, measure_id: int | None) -> None:
    if group_id is not None and db.get(NomenclatureGroup, group_id) is None:
        raise NotFound("Группа номенклатуры")
    if measure_id is not None and db.get(Measure, measure_id) is None:
        raise NotFound("Единица измерения")


def save_prices(db: DbSession, item_id: int, prices: list[PriceIn]) -> None:
    submitted = {price.price_type_id: price.price for price in prices}
    if submitted:
        valid_ids = set(db.scalars(select(PriceType.id).where(PriceType.id.in_(submitted))).all())
        if valid_ids != submitted.keys():
            raise NotFound("Тип цены")
    existing = db.scalars(
        select(NomenclaturePrice).where(
            NomenclaturePrice.nomenclature_id == item_id,
            NomenclaturePrice.location_id.is_(None),
        )
    ).all()
    existing_by_type = {price.price_type_id: price for price in existing}
    for type_id, amount in submitted.items():
        if type_id in existing_by_type:
            existing_by_type[type_id].price = amount
        else:
            db.add(NomenclaturePrice(nomenclature_id=item_id, price_type_id=type_id, price=amount))
    for type_id, price in existing_by_type.items():
        if type_id not in submitted:
            db.delete(price)


def load_price_data(db: DbSession, item_ids: list[int], location_id: int | None):
    if not item_ids:
        return {}
    query = (
        select(NomenclaturePrice, PriceType)
        .join(PriceType, PriceType.id == NomenclaturePrice.price_type_id)
        .where(NomenclaturePrice.nomenclature_id.in_(item_ids))
        .order_by(PriceType.sort, PriceType.id)
    )
    if location_id is None:
        query = query.where(NomenclaturePrice.location_id.is_(None))
    else:
        query = query.where(or_(NomenclaturePrice.location_id.is_(None), NomenclaturePrice.location_id == location_id))
    result = {}
    for price, price_type in db.execute(query).all():
        result.setdefault(price.nomenclature_id, []).append(
            PriceOut(
                price_type_id=price.price_type_id,
                name=price_type.name,
                price=price.price,
                location_id=price.location_id,
            )
        )
    return result


def load_stock_data(db: DbSession, item_ids: list[int], location_id: int | None):
    if not item_ids or location_id is None:
        return {}
    rows = db.execute(
        select(StockBalance.nomenclature_id, func.sum(StockBalance.quantity))
        .join(Store, Store.id == StockBalance.store_id)
        .where(
            StockBalance.nomenclature_id.in_(item_ids),
            Store.location_id == location_id,
            Store.is_active.is_(True),
        )
        .group_by(StockBalance.nomenclature_id)
    ).all()
    return {item_id: quantity for item_id, quantity in rows}


def serialize_items(db: DbSession, items: list[Nomenclature], location_id: int | None, can_view_purchase: bool):
    item_ids = [item.id for item in items]
    prices = load_price_data(db, item_ids, location_id)
    stock = load_stock_data(db, item_ids, location_id)
    return [
        NomenclatureOut(
            id=item.id,
            code=item.code,
            article=item.article,
            name=item.name,
            is_work=item.is_work,
            group_id=item.group_id,
            measure_id=item.measure_id,
            purchase_price=item.purchase_price if can_view_purchase else None,
            guarantee_days=item.guarantee_days,
            min_count=item.min_count,
            has_serials=item.has_serials,
            note=item.note,
            salary_percent=item.salary_percent,
            salary_fixed=item.salary_fixed,
            prices=prices.get(item.id, []),
            stock_quantity=None if item.is_work or location_id is None else stock.get(item.id, Decimal("0")),
        )
        for item in items
    ]


def get_group(db: DbSession, group_id: int) -> NomenclatureGroup:
    group = db.get(NomenclatureGroup, group_id)
    if group is None:
        raise NotFound("Группа номенклатуры")
    return group


def validate_parent(db: DbSession, parent_id: int | None, group_id: int | None = None) -> None:
    if parent_id is None:
        return
    if parent_id == group_id:
        raise BusinessError("Группа не может быть родителем самой себе")
    get_group(db, parent_id)


@router.get("/nomenclature", response_model=NomenclaturePage)
def list_nomenclature(
    db: DbSession,
    me: CurrentEmployee,
    q: str | None = None,
    is_work: bool | None = None,
    group_id: int | None = None,
    location_id: int | None = None,
    page: int = Query(default=1, ge=1),
):
    if location_id is not None:
        check_location(me, location_id)
    query = select(Nomenclature).where(Nomenclature.is_deleted.is_(False)).order_by(Nomenclature.code)
    if is_work is not None:
        query = query.where(Nomenclature.is_work.is_(is_work))
    if group_id is not None:
        query = query.where(Nomenclature.group_id == group_id)
    items = db.scalars(query).all()
    if q:
        term = q.strip().casefold()
        items = [
            item
            for item in items
            if term in item.name.casefold()
            or term in (item.article or "").casefold()
            or term in str(item.code)
        ]
    total = len(items)
    page_items = items[(page - 1) * 50 : page * 50]
    return NomenclaturePage(
        items=serialize_items(db, page_items, location_id, has_permission(me, "purchasePriceAccess")),
        total=total,
        page=page,
    )


def create_prices(db: DbSession, item_id: int, prices: list[PriceIn]) -> None:
    if prices:
        valid_ids = set(db.scalars(select(PriceType.id).where(PriceType.id.in_([price.price_type_id for price in prices]))).all())
        if valid_ids != {price.price_type_id for price in prices}:
            raise NotFound("Тип цены")
        for price in prices:
            db.add(NomenclaturePrice(nomenclature_id=item_id, price_type_id=price.price_type_id, price=price.price))


@router.post("/nomenclature", response_model=NomenclatureOut)
def create_nomenclature(data: NomenclatureIn, db: DbSession, me: CurrentEmployee):
    check_nomenclature_permission(me, data.is_work)
    validate_nomenclature_references(db, data.group_id, data.measure_id)
    values = data.model_dump(exclude={"prices"})
    values["name"] = values["name"].strip()
    next_code = (db.scalar(select(func.max(Nomenclature.code))) or 0) + 1
    item = Nomenclature(code=next_code, **values)
    db.add(item)
    db.flush()
    create_prices(db, item.id, data.prices)
    db.commit()
    return serialize_items(db, [item], None, has_permission(me, "purchasePriceAccess"))[0]


@router.put("/nomenclature/{item_id}", response_model=NomenclatureOut)
def update_nomenclature(item_id: int, data: NomenclatureIn, db: DbSession, me: CurrentEmployee):
    item = db.get(Nomenclature, item_id)
    if item is None or item.is_deleted:
        raise NotFound("Номенклатура")
    check_nomenclature_permission(me, data.is_work)
    validate_nomenclature_references(db, data.group_id, data.measure_id)
    values = data.model_dump(exclude={"prices"})
    values["name"] = values["name"].strip()
    for field, value in values.items():
        setattr(item, field, value)
    save_prices(db, item.id, data.prices)
    db.commit()
    return serialize_items(db, [item], None, has_permission(me, "purchasePriceAccess"))[0]


@router.delete("/nomenclature/{item_id}", status_code=204)
def delete_nomenclature(item_id: int, db: DbSession, me: CurrentEmployee):
    item = db.get(Nomenclature, item_id)
    if item is None or item.is_deleted:
        raise NotFound("Номенклатура")
    check_nomenclature_permission(me, item.is_work)
    item.is_deleted = True
    db.commit()
    return Response(status_code=204)


@router.get("/nomenclature/search", response_model=list[NomenclatureOut])
def search_nomenclature(db: DbSession, me: CurrentEmployee, q: str = "", location_id: int | None = None):
    if location_id is not None:
        check_location(me, location_id)
    query = select(Nomenclature).where(Nomenclature.is_deleted.is_(False)).order_by(Nomenclature.code)
    items = db.scalars(query).all()
    term = q.strip().casefold()
    if term:
        items = [
            item
            for item in items
            if term in item.name.casefold()
            or term in (item.article or "").casefold()
            or term in str(item.code)
        ]
    items = items[:20]
    return serialize_items(db, items, location_id, has_permission(me, "purchasePriceAccess"))


@router.get("/price-types", response_model=list[PriceTypeOut])
def list_price_types(db: DbSession, _: CurrentEmployee):
    return db.scalars(select(PriceType).order_by(PriceType.sort, PriceType.id)).all()


@router.get("/nomenclature-groups", response_model=list[NomenclatureGroupOut])
def list_nomenclature_groups(db: DbSession, _: CurrentEmployee):
    groups = db.scalars(select(NomenclatureGroup).order_by(NomenclatureGroup.name, NomenclatureGroup.id)).all()
    nodes = {
        group.id: {
            "id": group.id,
            "name": group.name,
            "parent_id": group.parent_id,
            "salary_percent": group.salary_percent,
            "salary_fixed": group.salary_fixed,
            "children": [],
        }
        for group in groups
    }
    roots = []
    for group in groups:
        node = nodes[group.id]
        if group.parent_id in nodes:
            nodes[group.parent_id]["children"].append(node)
        else:
            roots.append(node)
    return roots


@router.post(
    "/nomenclature-groups",
    response_model=NomenclatureGroupOut,
    dependencies=[Depends(require("nomenclatureAccess"))],
)
def create_nomenclature_group(data: NomenclatureGroupIn, db: DbSession):
    validate_parent(db, data.parent_id)
    group = NomenclatureGroup(**data.model_dump())
    group.name = group.name.strip()
    db.add(group)
    db.commit()
    return {**data.model_dump(), "id": group.id, "children": []}


@router.put(
    "/nomenclature-groups/{group_id}",
    response_model=NomenclatureGroupOut,
    dependencies=[Depends(require("nomenclatureAccess"))],
)
def update_nomenclature_group(group_id: int, data: NomenclatureGroupIn, db: DbSession):
    group = get_group(db, group_id)
    validate_parent(db, data.parent_id, group_id)
    for field, value in data.model_dump().items():
        setattr(group, field, value)
    group.name = group.name.strip()
    db.commit()
    return {**data.model_dump(), "id": group.id, "children": []}


@router.delete(
    "/nomenclature-groups/{group_id}",
    status_code=204,
    dependencies=[Depends(require("nomenclatureAccess"))],
)
def delete_nomenclature_group(group_id: int, db: DbSession):
    group = get_group(db, group_id)
    has_children = db.scalar(select(NomenclatureGroup.id).where(NomenclatureGroup.parent_id == group_id).limit(1))
    has_items = db.scalar(select(Nomenclature.id).where(Nomenclature.group_id == group_id).limit(1))
    if has_children is not None or has_items is not None:
        raise BusinessError("Нельзя удалить группу с вложенными группами или номенклатурой")
    db.delete(group)
    db.commit()
    return Response(status_code=204)