"""Перенос истории зарплат из LiveSklad. Пишет и меняет только Claude.

В LiveSklad у сотрудника есть таблица «по месяцам»: оклад | начисления | бонусы | штрафы | итого | выплачено | к выплате.
Подробных событий по каждому заказу за прошлое там нет, поэтому переносим помесячные итоги как ручные события
(оклад, начисления за работу, бонусы, штрафы). Выплаты приходят с кассовой историей (livesklad_cash) и привязываются
к сотруднику по «Получателю».

Файл на сотрудника — текст, строка на месяц, поля через «|»:
    октябрь 2026|0|77 039.50|0|-4 520.00|72 519.50|71 050.00|1 469.50

Запуск (файлы — в контейнер, как для остальных переносов):
    python -m app.importers.livesklad_salary --employee Черкасов --employee Яковлев /app/sal/cherkasov.txt /app/sal/yakovlev.txt
    ... и то же с --commit для записи. Месяцы после месяца --until (по умолчанию 30.10.2026) не берутся; месяц переноса вносится датой переноса: дальше считает CRM.
Повторно: если у сотрудника уже есть события LiveSklad за месяц — месяц пропускается.
"""

import argparse
import re
import sys
from datetime import datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.importers.livesklad_cash import find_employee
from app.importers.livesklad_orders import MSK
from app.models import Employee
from app.models.salary import AccrualKind, SalaryEvent

MONTHS = {m: i for i, m in enumerate(
    "январь февраль март апрель май июнь июль август сентябрь октябрь ноябрь декабрь".split(), 1)}
NOTE = "LiveSklad: итог за месяц"


def num(text: str) -> Decimal:
    return Decimal(text.replace(" ", "").replace(" ", "").replace(",", ".").replace("–", "-") or "0").quantize(
        Decimal("1"), rounding=ROUND_HALF_UP)


def parse_file(path: str) -> list[dict]:
    result = []
    for line in open(path, encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        parts = [p.strip() for p in line.split("|")]
        match = re.match(r"^([а-яё]+) (\d{4})$", parts[0].lower())
        if not match or match[1] not in MONTHS or len(parts) < 8:
            raise ValueError(f"не понял строку: {line}")
        result.append({"year": int(match[2]), "month": MONTHS[match[1]], "salary": num(parts[1]), "accrued": num(parts[2]),
                       "bonus": num(parts[3]), "penalty": num(parts[4]), "total": num(parts[5]),
                       "paid": num(parts[6]), "rest": num(parts[7])})
    return result


def month_end(year: int, month: int) -> datetime:
    nxt = datetime(year + (month == 12), month % 12 + 1, 1, 12, tzinfo=MSK)
    return nxt - timedelta(days=1)


def run(db: Session, jobs: list[tuple[str, str]], commit: bool, until: datetime) -> int:
    people = list(db.scalars(select(Employee)))
    problems = 0
    for query, path in jobs:
        employee_id = find_employee(people, query)
        if employee_id is None:
            print(f"! сотрудник «{query}» не найден (или не один) — пропускаю {path}")
            problems += 1
            continue
        known = {(e.date.year, e.date.month) for e in db.scalars(
            select(SalaryEvent).where(SalaryEvent.employee_id == employee_id, SalaryEvent.note.like(f"{NOTE}%")))}
        added = skipped = 0
        total = Decimal(0)
        for row in parse_file(path):
            date = month_end(row["year"], row["month"])
            if date > until:
                if (date.year, date.month) != (until.year, until.month):
                    skipped += 1
                    continue
                date = until  # последний месяц LiveSklad: начисления до дня переноса, датой переноса
            if (date.year, date.month) in known:
                skipped += 1
                continue
            for kind, amount in ((AccrualKind.MONEY, row["salary"]), (AccrualKind.WORK_ORDER, row["accrued"]),
                                 (AccrualKind.BONUS, row["bonus"]), (AccrualKind.PENALTY, -abs(row["penalty"]))):
                if amount == 0:
                    continue
                db.add(SalaryEvent(employee_id=employee_id, kind=kind.value, date=date, amount=amount,
                                   is_manual=True, note=f"{NOTE} {row['month']:02}.{row['year']}",
                                   details={"source": "livesklad", "total": str(row["total"])}))
                total += amount
                added += 1
        print(f"{query}: событий {added}, пропущено месяцев {skipped}, сумма начислений {total:,}")
    if commit:
        db.commit()
        print("Записано.")
    else:
        db.rollback()
        print("Пробный прогон — ничего не сохранено. Для записи добавьте --commit.")
    return 1 if problems else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Перенос зарплат из LiveSklad")
    parser.add_argument("--employee", action="append", required=True, help="Фамилия/имя сотрудника в CRM; после каждого — файл")
    parser.add_argument("files", nargs="+", help="Файлы в том же порядке, что и --employee")
    parser.add_argument("--commit", action="store_true")
    parser.add_argument("--until", default="30.10.2026")
    args = parser.parse_args(argv)
    if len(args.employee) != len(args.files):
        sys.exit("Каждому --employee нужен свой файл, в том же порядке.")
    day, month, year = (int(x) for x in args.until.split("."))
    until = datetime(year, month, day, 23, 59, tzinfo=MSK)
    db = SessionLocal()
    try:
        return run(db, list(zip(args.employee, args.files)), args.commit, until)
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
