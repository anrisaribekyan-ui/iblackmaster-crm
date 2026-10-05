from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import BusinessError
from app.models import CashItemType, StockDocType, StockDocument, StockDocumentPosition, Transaction
from app.services import money, stock

DOCUMENT_PREFIX = {
    StockDocType.PURCHASE: "П-",
    StockDocType.MOVE: "ПМ-",
    StockDocType.CANCELLATION: "С-",
}


def next_document_number(db: Session, doc_type: StockDocType) -> str:
    prefix = DOCUMENT_PREFIX[doc_type]
    numbers = db.scalars(
        select(StockDocument.number).where(
            StockDocument.type == doc_type,
        )
    ).all()
    suffixes = []
    for number in numbers:
        if number.startswith(prefix):
            try:
                suffixes.append(int(number[len(prefix) :]))
            except ValueError:
                continue
    return f"{prefix}{max(suffixes, default=0) + 1}"


def create_document(
    db: Session,
    *,
    doc_type: StockDocType,
    location_id: int,
    store_id: int,
    to_store_id: int | None,
    counteragent_id: int | None,
    responsible_id: int,
    note: str | None,
    positions: list[dict],
    cash_register_id: int | None = None,
    amount: Decimal | None = None,
    is_bank: bool = False,
) -> StockDocument:
    document = StockDocument(
        type=doc_type,
        number=next_document_number(db, doc_type),
        location_id=location_id,
        store_id=store_id,
        to_store_id=to_store_id,
        counteragent_id=counteragent_id,
        responsible_id=responsible_id,
        note=note,
        total=Decimal("0"),
        paid=Decimal("0"),
        is_posted=True,
    )
    db.add(document)
    db.flush()

    total = Decimal("0")
    for item in positions:
        quantity = stock.to_qty(item["quantity"])
        unit_price = money.to_money(item["price"])
        if doc_type == StockDocType.PURCHASE:
            stock.receive(db, store_id, item["nomenclature_id"], quantity, unit_price)
        elif doc_type == StockDocType.MOVE:
            unit_price = stock.move(db, store_id, to_store_id, item["nomenclature_id"], quantity)
        else:
            unit_price = stock.write_off(db, store_id, item["nomenclature_id"], quantity)
        db.add(
            StockDocumentPosition(
                document_id=document.id,
                nomenclature_id=item["nomenclature_id"],
                quantity=quantity,
                price=unit_price,
                serials=item.get("serials", []),
            )
        )
        total += (quantity * unit_price).quantize(Decimal("0.01"))

    document.total = total
    if doc_type == StockDocType.PURCHASE:
        # Поставка = наш долг поставщику на всю сумму (его баланс растёт),
        # оплата (статья PURCHASE, расход) этот долг уменьшает.
        if counteragent_id is not None:
            money.charge_counteragent(db, counteragent_id, -total)
        if cash_register_id is not None and amount is not None:
            transaction = money.create_transaction(
                db,
                cash_register_id=cash_register_id,
                cash_item=money.get_system_item(db, CashItemType.PURCHASE),
                amount=amount,
                is_bank=is_bank,
                counteragent_id=counteragent_id,
                created_by_id=responsible_id,
                stock_document_id=document.id,
            )
            document.paid = transaction.amount
    return document


def delete_document(db: Session, document: StockDocument) -> None:
    if document.is_deleted:
        raise BusinessError("Документ уже удалён")
    if not document.is_posted:
        document.is_deleted = True
        return

    positions = db.scalars(
        select(StockDocumentPosition).where(StockDocumentPosition.document_id == document.id)
    ).all()
    for position in reversed(positions):
        if document.type == StockDocType.PURCHASE:
            stock.write_off(db, document.store_id, position.nomenclature_id, position.quantity)
        elif document.type == StockDocType.MOVE:
            stock.move(
                db,
                document.to_store_id,
                document.store_id,
                position.nomenclature_id,
                position.quantity,
            )
        else:
            stock.receive(
                db,
                document.store_id,
                position.nomenclature_id,
                position.quantity,
                position.price,
            )

    transactions = db.scalars(
        select(Transaction).where(
            Transaction.stock_document_id == document.id,
            Transaction.is_deleted.is_(False),
        )
    ).all()
    for transaction in transactions:
        money.delete_transaction(db, transaction)
    if document.type == StockDocType.PURCHASE and document.counteragent_id:
        money.charge_counteragent(db, document.counteragent_id, document.total)
    document.is_deleted = True