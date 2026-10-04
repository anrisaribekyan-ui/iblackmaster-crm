"""Остатки склада. ЕДИНСТВЕННОЕ место, где меняется StockBalance.

Себестоимость считается по скользящей средней: при приходе новая средняя =
(старый_остаток * старая_цена + приход * цена_прихода) / новый_остаток.
Списание идёт по текущей средней цене.
Работы (Nomenclature.is_work) на складе не учитываются.
Функции не делают commit.
"""

from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import BusinessError
from app.models import Nomenclature, StockBalance

CENT = Decimal("0.01")


def to_qty(value) -> Decimal:
    if isinstance(value, float):
        raise TypeError("Количество передавайте как Decimal или строку, не float")
    return Decimal(value).quantize(Decimal("0.001"))


def get_balance(db: Session, store_id: int, nomenclature_id: int, create: bool = False) -> StockBalance | None:
    bal = db.scalars(
        select(StockBalance).where(
            StockBalance.store_id == store_id, StockBalance.nomenclature_id == nomenclature_id
        )
    ).first()
    if bal is None and create:
        bal = StockBalance(
            store_id=store_id,
            nomenclature_id=nomenclature_id,
            quantity=Decimal("0"),
            avg_purchase_price=Decimal("0"),
        )
        db.add(bal)
        db.flush()
    return bal


def _check_product(db: Session, nomenclature_id: int) -> Nomenclature:
    nom = db.get(Nomenclature, nomenclature_id)
    if nom is None:
        raise BusinessError("Товар не найден")
    if nom.is_work:
        raise BusinessError("Работа не учитывается на складе")
    return nom


def receive(db: Session, store_id: int, nomenclature_id: int, quantity, unit_price) -> StockBalance:
    """Приход товара (поступление, возврат от клиента, излишки инвентаризации, перемещение «куда»)."""
    _check_product(db, nomenclature_id)
    qty = to_qty(quantity)
    price = Decimal(unit_price)
    if qty <= 0:
        raise BusinessError("Количество должно быть больше нуля")
    bal = get_balance(db, store_id, nomenclature_id, create=True)
    old_qty = bal.quantity if bal.quantity > 0 else Decimal("0")
    new_qty = bal.quantity + qty
    if new_qty > 0:
        total = old_qty * bal.avg_purchase_price + qty * price
        bal.avg_purchase_price = (total / (old_qty + qty)).quantize(CENT, rounding=ROUND_HALF_UP)
    bal.quantity = new_qty
    return bal


def write_off(db: Session, store_id: int, nomenclature_id: int, quantity) -> Decimal:
    """Расход товара (запчасть в заказ, продажа, списание, перемещение «откуда»).

    Возвращает себестоимость ЕДИНИЦЫ, по которой списали. Минус на складе запрещён.
    """
    nom = _check_product(db, nomenclature_id)
    qty = to_qty(quantity)
    if qty <= 0:
        raise BusinessError("Количество должно быть больше нуля")
    bal = get_balance(db, store_id, nomenclature_id)
    if bal is None or bal.quantity < qty:
        have = bal.quantity if bal else Decimal("0")
        raise BusinessError(f"Товара «{nom.name}» недостаточно на складе: есть {have.normalize()}, нужно {qty.normalize()}")
    bal.quantity = bal.quantity - qty
    return bal.avg_purchase_price


def return_to_stock(db: Session, store_id: int, nomenclature_id: int, quantity, unit_price) -> None:
    """Вернуть ранее списанное (удалили запчасть из заказа) по той же себестоимости."""
    receive(db, store_id, nomenclature_id, quantity, unit_price)


def move(db: Session, from_store_id: int, to_store_id: int, nomenclature_id: int, quantity) -> Decimal:
    if from_store_id == to_store_id:
        raise BusinessError("Выберите другой склад для перемещения")
    price = write_off(db, from_store_id, nomenclature_id, quantity)
    receive(db, to_store_id, nomenclature_id, quantity, price)
    return price
