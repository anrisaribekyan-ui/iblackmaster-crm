"""Перенос остатков склада из LiveSklad."""

from decimal import Decimal

from openpyxl import Workbook
from sqlalchemy import select

from app.importers.livesklad_stock import run
from app.models import Nomenclature, StockBalance, Store

HEADER = ["Наименование", "Остаток", "Закупочная", "Код", "Полная группа", "Гарантия в днях", "Гарантия в месяцах",
          "Неснижаемый остаток", "Розничная", "Минимальная", "Ремонтная", "Себестоимость остатков"]


def _file(tmp_path):
    wb = Workbook()
    ws = wb.active
    ws.append(HEADER)
    ws.append(["Стекло Samsung", 4, 200, 6808, "/Магазин/Стекла, пленка Android", 14, None, 2, 1000, None, 1000, 800])
    ws.append(["Дисплей iPhone 11", 2, 3000, 7001, "/Запчасти iPhone/Новая группа", None, 3, None, None, None, 6500, 6100])
    path = tmp_path / "Остатки.xlsx"
    wb.save(path)
    return str(path)


def test_import_stock(db, tmp_path):
    path = _file(tmp_path)
    store = db.scalars(select(Store).order_by(Store.id)).first()
    assert run(db, path, str(store.id), commit=True) == 0

    glass = db.scalars(select(Nomenclature).where(Nomenclature.code == 6808)).one()
    assert glass.guarantee_days == 14 and glass.min_count == 2 and glass.group.name == "Стекла, пленка Android"
    display = db.scalars(select(Nomenclature).where(Nomenclature.code == 7001)).one()
    assert display.guarantee_days == 90 and display.group.name == "Новая группа"
    balance = db.scalars(select(StockBalance).where(StockBalance.store_id == store.id, StockBalance.nomenclature_id == display.id)).one()
    assert balance.quantity == 2 and balance.avg_purchase_price == Decimal("3050")

    # Повторно на тот же склад — отказ, без задвоения
    assert run(db, path, str(store.id), commit=True) == 3
    db.refresh(balance)
    assert balance.quantity == 2
