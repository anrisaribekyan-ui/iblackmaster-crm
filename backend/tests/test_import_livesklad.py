"""Перенос заказов из выгрузки LiveSklad: разбор позиций, склейка клиентов, повторный запуск без дублей."""

from decimal import Decimal

from openpyxl import Workbook
from sqlalchemy import func, select

from app.importers.livesklad_orders import Importer, parse_positions, read_rows, spread_cost
from app.models import Counteragent, Order, StatusGroup

HEADER = ["Номер заказа", "Тип заказа", "Марка", "Модель", "Дата создания", "Дата готовности", "Дата выдачи",
          "Менеджер закрывший заказ", "Неисправность", "Менеджер", "Мастер", "Выполненные работы",
          "Установленные запчасти", "Локация", "Статус", "Оплачено по заказу", "Имя", "Телефон",
          "Менеджер создавший заказ", "Сумма заказа", "Себестоимость заказа", "Себестоимость работ", "Себестоимость запчастей"]


def make_file(path, rows):
    wb = Workbook()
    ws = wb.active
    ws.append(HEADER)
    for row in rows:
        ws.append([row.get(h) for h in HEADER])
    wb.save(path)


def test_parse_and_spread():
    lines = parse_positions("1 x Замена дисплея на iphone XR (4700 руб.);\n2 x 3D Remax iPhone XR (1000 руб.)")
    assert lines == [(Decimal("1"), "Замена дисплея на iphone XR", Decimal("4700")), (Decimal("2"), "3D Remax iPhone XR", Decimal("1000"))]
    costs = spread_cost(lines, Decimal("2010"))
    assert sum(c * q for c, (q, _, _) in zip(costs, lines)) == Decimal("2010")


def test_import_rows_and_rerun(db, tmp_path):
    path = tmp_path / "orders.xlsx"
    base = {"Тип заказа": "Негарантийный", "Локация": "iBlackMaster (ТК Панфиловский)", "Менеджер создавший заказ": "Алексей Яковлев"}
    make_file(path, [
        {**base, "Номер заказа": "A20001", "Марка": "Apple", "Модель": "iPhone 13", "Дата создания": "01.09.2026 10:00",
         "Дата готовности": "01.09.2026 12:00", "Дата выдачи": "02.09.2026 15:30", "Статус": "Закрыт (Выдан)",
         "Мастер": "Николайй Липатунин", "Менеджер закрывший заказ": "Anri Sar.",
         "Выполненные работы": "1 x Замена аккумулятора iphone 13 (6900 руб.)", "Установленные запчасти": "1 x АКБ iPhone 13 (2500 руб.)",
         "Оплачено по заказу": "9400", "Имя": "Иван", "Телефон": "+7 (916) 186-61-19", "Сумма заказа": "9400",
         "Себестоимость заказа": "1800", "Себестоимость работ": "0", "Себестоимость запчастей": "1800"},
        {**base, "Номер заказа": "A20002", "Марка": "Xiaomi", "Модель": "Redmi 12", "Дата создания": "03.09.2026 11:00",
         "Статус": "Ждет запчасть", "Имя": "Иван Петров", "Телефон": "89161866119", "Оплачено по заказу": "0",
         "Сумма заказа": "0", "Себестоимость заказа": "0", "Себестоимость работ": "0", "Себестоимость запчастей": "0"},
        {**base, "Номер заказа": "A20003", "Марка": "Honor", "Модель": "X8", "Дата создания": "04.09.2026 11:00",
         "Статус": "Совсем новый статус", "Имя": "Без телефона", "Оплачено по заказу": "0", "Сумма заказа": "0",
         "Себестоимость заказа": "0", "Себестоимость работ": "0", "Себестоимость запчастей": "0"},
    ])
    for _ in range(2):  # второй запуск — обновление, без дублей
        importer = Importer(db)
        for row in read_rows(str(path)):
            importer.import_row(row)
        importer.finish()
        db.commit()

    assert db.scalar(select(func.count(Order.id)).where(Order.number.like("A2000%"))) == 3
    first = db.scalars(select(Order).where(Order.number == "A20001")).one()
    assert first.status.group == StatusGroup.CLOSED and first.closed_at is not None
    assert first.total_price == Decimal("9400") and first.paid == Decimal("9400")
    assert sorted((p.is_work, p.purchase_price) for p in first.positions) == [(False, Decimal("1800")), (True, Decimal("0"))]
    from app.models import Employee
    assert db.get(Employee, first.closed_by_id).is_owner  # «Anri Sar.» — это владелец
    assert db.get(Employee, first.master_id).name == "Николай Липатунин"  # опечатка «Николайй» склеена
    second = db.scalars(select(Order).where(Order.number == "A20002")).one()
    assert second.counteragent_id == first.counteragent_id  # один клиент по телефону
    assert db.scalar(select(func.count(Counteragent.id)).where(Counteragent.name == "Без телефона")) == 1
    third = db.scalars(select(Order).where(Order.number == "A20003")).one()
    assert third.status.name == "Совсем новый статус"
    from app.models import Company
    assert db.scalars(select(Company)).first().next_order_number == 20004
