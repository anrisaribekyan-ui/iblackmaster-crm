"""Гарантия на позиции перенесённых заказов LiveSklad. Пишет и меняет только Claude.

В выгрузке «Заказы» гарантии по позициям нет (в LiveSklad она хранится только в карточке заказа), поэтому
восстанавливаем по правилу:
- запчасть, название которой совпало с товаром справочника, — гарантия товара (если у него она задана);
- всё остальное (работы и неопознанные запчасти) — 90 дней, как принято у нас.
Трогаем только позиции с гарантией 0 в заказах, созданных до дня переноса: то, что уже поправили руками, остаётся.

    python -m app.importers.livesklad_guarantee             # пробный прогон
    python -m app.importers.livesklad_guarantee --commit    # записать
"""

import argparse
import sys
from collections import Counter
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.importers.livesklad_orders import MSK
from app.models import Nomenclature, Order, OrderPosition

DEFAULT_DAYS = 90
CUTOVER = datetime(2026, 10, 31, tzinfo=MSK)


def run(db: Session, commit: bool, cutover: datetime = CUTOVER) -> int:
    by_name = {n.name.strip().casefold(): n.guarantee_days for n in db.scalars(select(Nomenclature)) if n.guarantee_days}
    positions = db.scalars(
        select(OrderPosition).join(Order, Order.id == OrderPosition.order_id).where(
            OrderPosition.guarantee_days == 0, Order.created_at < cutover
        )
    ).all()
    stats = Counter()
    for position in positions:
        days = None if position.is_work else by_name.get(position.name.strip().casefold())
        position.guarantee_days = days or DEFAULT_DAYS
        stats["по справочнику" if days else f"{DEFAULT_DAYS} дн. по умолчанию"] += 1
    print(f"Позиций с гарантией 0 в старых заказах: {len(positions)}")
    for key, value in stats.items():
        print(f"  {key}: {value}")
    if commit:
        db.commit()
        print("Записано.")
    else:
        db.rollback()
        print("Пробный прогон — ничего не сохранено. Для записи добавьте --commit.")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Гарантия на позиции перенесённых заказов")
    parser.add_argument("--commit", action="store_true")
    args = parser.parse_args(argv)
    db = SessionLocal()
    try:
        return run(db, args.commit)
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
