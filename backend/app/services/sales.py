from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import MONEY_STEP
from app.errors import BusinessError
from app.models import (
    CashItemType,
    Company,
    Nomenclature,
    Sale,
    SalePosition,
    StockDocType,
    StockDocument,
    StockDocumentPosition,
)
from app.services import money, salary, stock

CENT = MONEY_STEP  # без копеек


def create_sale(
    db: Session,
    *,
    location_id: int,
    store_id: int,
    seller_id: int,
    counteragent_id: int | None,
    discount_percent: Decimal,
    discount_sum: Decimal,
    note: str | None,
    positions: list[dict],
    payments: list[dict],
) -> Sale:
    company = db.scalars(select(Company).with_for_update()).first()
    if company is None:
        raise BusinessError("Компания не настроена. Запустите сид.")
    sale = Sale(
        number=f"Ч-{company.next_sale_number}",
        location_id=location_id,
        store_id=store_id,
        seller_id=seller_id,
        counteragent_id=counteragent_id,
        discount_percent=discount_percent,
        discount_sum=discount_sum,
        note=note,
    )
    company.next_sale_number += 1
    db.add(sale)
    db.flush()

    gross = Decimal("0")
    for item in positions:
        quantity = stock.to_qty(item["quantity"])
        nomenclature = db.get(Nomenclature, item.get("nomenclature_id")) if item.get("nomenclature_id") else None
        if item.get("nomenclature_id") and (nomenclature is None or nomenclature.is_deleted):
            raise BusinessError("Позиция справочника не найдена")
        is_work = nomenclature.is_work if nomenclature else bool(item.get("is_work"))
        if not is_work and nomenclature is None:
            raise BusinessError("Для товара укажите номенклатуру")
        unit_price = money.to_money(item["price"])
        purchase_price = Decimal("0")
        if nomenclature is not None and nomenclature.is_work:
            purchase_price = nomenclature.purchase_price
        elif not is_work:
            purchase_price = stock.write_off(db, store_id, nomenclature.id, quantity)
        position = SalePosition(
            sale_id=sale.id,
            nomenclature_id=nomenclature.id if nomenclature else None,
            is_work=is_work,
            name=item.get("name") or nomenclature.name,
            quantity=quantity,
            price=unit_price,
            sold_price=unit_price,
            purchase_price=purchase_price,
            guarantee_days=item.get("guarantee_days", nomenclature.guarantee_days if nomenclature else 0),
            serials=item.get("serials", []),
        )
        sale.positions.append(position)
        gross += (unit_price * quantity).quantize(CENT)
        sale.total_purchase += (purchase_price * quantity).quantize(CENT)

    discount = (gross * discount_percent / 100).quantize(CENT, rounding=ROUND_HALF_UP) + discount_sum
    total = max(gross - discount, Decimal("0")).quantize(CENT)
    if gross > 0 and total != gross:
        ratio = total / gross
        for position in sale.positions:
            position.sold_price = (position.price * ratio).quantize(CENT, rounding=ROUND_HALF_UP)
    sale.total_price = sum((position.sold_price * position.quantity for position in sale.positions), Decimal("0")).quantize(CENT)
    sale.total_purchase = sale.total_purchase.quantize(CENT)

    payment_total = sum((money.to_money(item["amount"]) for item in payments), Decimal("0"))
    if payment_total > sale.total_price:
        raise BusinessError("Сумма оплат превышает сумму чека")
    if payment_total < sale.total_price and counteragent_id is None:
        raise BusinessError("Для продажи в долг укажите покупателя")
    for item in payments:
        transaction = money.create_transaction(
            db,
            cash_register_id=item["cash_register_id"],
            cash_item=money.get_system_item(db, CashItemType.SALE),
            amount=item["amount"],
            is_bank=item.get("is_bank", False),
            counteragent_id=counteragent_id,
            created_by_id=seller_id,
            sale_id=sale.id,
            note=item.get("note"),
        )
        sale.paid += transaction.amount
    # Начисляем клиенту ВСЮ сумму чека: оплаты (статья SALE) уже подняли его баланс,
    # так что итог = оплачено − сумма чека (0 при полной оплате, минус — долг).
    if counteragent_id is not None:
        money.charge_counteragent(db, counteragent_id, sale.total_price)
    db.flush()
    salary.recalc_sale(db, sale)
    return sale


def refund_sale(
    db: Session,
    *,
    sale: Sale,
    employee_id: int,
    cash_register_id: int,
    is_bank: bool,
    note: str | None,
    items: list[dict],
) -> tuple[StockDocument, Decimal]:
    if sale.is_deleted:
        raise BusinessError("Чек удалён")
    document = StockDocument(
        type=StockDocType.SALE_RETURN,
        number=f"{sale.number}-R{sale.id}",
        location_id=sale.location_id,
        store_id=sale.store_id,
        sale_id=sale.id,
        responsible_id=employee_id,
        note=note,
        total=Decimal("0"),
        paid=Decimal("0"),
        is_posted=True,
    )
    db.add(document)
    db.flush()

    refund_total = Decimal("0")
    for item in items:
        position = db.get(SalePosition, item["sale_position_id"])
        if position is None or position.sale_id != sale.id:
            raise BusinessError("Позиция не найдена в чеке")
        quantity = stock.to_qty(item["quantity"])
        remaining = position.quantity - position.returned_quantity
        if quantity <= 0 or quantity > remaining:
            raise BusinessError("Нельзя вернуть больше проданного количества")
        if not position.is_work and position.nomenclature_id is not None:
            stock.receive(db, sale.store_id, position.nomenclature_id, quantity, position.purchase_price)
        position.returned_quantity += quantity
        refund_total += (position.sold_price * quantity).quantize(CENT)
        if position.nomenclature_id is not None:
            db.add(
                StockDocumentPosition(
                    document_id=document.id,
                    nomenclature_id=position.nomenclature_id,
                    quantity=quantity,
                    price=position.purchase_price,
                )
            )

    refund_total = refund_total.quantize(CENT)
    if refund_total > sale.paid:
        raise BusinessError("Нельзя вернуть больше оплаченной суммы")
    transaction = money.create_transaction(
        db,
        cash_register_id=cash_register_id,
        cash_item=money.get_system_item(db, CashItemType.SALE_RETURN),
        amount=refund_total,
        is_bank=is_bank,
        counteragent_id=sale.counteragent_id,
        created_by_id=employee_id,
        sale_id=sale.id,
        stock_document_id=document.id,
        note=note,
    )
    sale.paid -= transaction.amount
    # Возврат денег (статья SALE_RETURN) опустил баланс клиента — снимаем и начисление за возвращённое
    if sale.counteragent_id is not None:
        money.charge_counteragent(db, sale.counteragent_id, -refund_total)
    document.total = refund_total
    document.paid = transaction.amount
    salary.recalc_sale(db, sale)
    return document, refund_total