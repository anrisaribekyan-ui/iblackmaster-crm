"""Перенос контрагентов из LiveSklad."""

from openpyxl import Workbook
from sqlalchemy import select

from app.importers.livesklad_counteragents import run
from app.models import Counteragent

HEADER = ["Имя", "Покупатель", "Поставщик", "Телефон", "Email", "Адрес", "Тип контрагента", "Рекламный источник", "ИНН",
          "ОГРН", "Директор", "Договор", "Серия/номер", "Дата выдачи", "Кем выдан", "Код подразделения", "Дата рождения",
          "Место рождения", "Наименование банка", "БИК", "SWIFT", "Кор/счет", "Рас/счет"]


def _file(tmp_path):
    wb = Workbook()
    ws = wb.active
    ws.append(HEADER)
    ws.append([",Белусова Инна", "Да", "Нет", "+7 (999) 999-89-89", "b@x.ru", None, "Частное лицо", "Авито"] + [None] * 15)
    ws.append(["Поставщик Мобы", "Нет", "Да", "8 495 000-00-00", None, "Москва", "Компания", None, "7701234567"] + [None] * 14)
    path = tmp_path / "К.xlsx"
    wb.save(path)
    return str(path)


def test_import_counteragents(db, tmp_path):
    existing = Counteragent(name="Инна Б.", phones="79999998989")
    db.add(existing)
    db.commit()
    path = _file(tmp_path)
    run(db, path, commit=False)
    assert len(db.scalars(select(Counteragent)).all()) == 1
    run(db, path, commit=True)
    db.refresh(existing)
    assert existing.email == "b@x.ru" and existing.name == "Инна Б."
    vendor = db.scalars(select(Counteragent).where(Counteragent.name == "Поставщик Мобы")).one()
    assert vendor.is_vendor and vendor.phones == "74950000000" and vendor.inn == "7701234567"
    run(db, path, commit=True)
    assert len(db.scalars(select(Counteragent)).all()) == 2
