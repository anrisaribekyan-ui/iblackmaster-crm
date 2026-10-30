"""Перенос зарплат из LiveSklad."""

from decimal import Decimal

from sqlalchemy import select

from app.importers.livesklad_salary import run
from app.models import Employee
from app.models.salary import SalaryEvent
from app.importers.livesklad_orders import MSK
from datetime import datetime

TABLE = """октябрь 2026|0|77 039.50|0|-4 520.00|72 519.50|71 050.00|1 469.50
сентябрь 2026|50 000|66 131.50|140.00|0|66 271.50|95 600.00|-29 328.50
август 2026|0|0|0|0|0.00|0.00|0.00
"""


def test_import_salary(db, tmp_path):
    employee = db.scalars(select(Employee)).first()
    path = tmp_path / "t.txt"
    path.write_text(TABLE, encoding="utf-8")
    until = datetime(2026, 9, 30, 23, 59, tzinfo=MSK)
    assert run(db, [(employee.name, str(path))], commit=True, until=until) == 0
    events = db.scalars(select(SalaryEvent).where(SalaryEvent.employee_id == employee.id)).all()
    assert {e.kind: e.amount for e in events} == {"money": Decimal("50000"), "workOrder": Decimal("66132"), "bonus": Decimal("140")}
    # повтор — без задвоения
    run(db, [(employee.name, str(path))], commit=True, until=until)
    assert len(db.scalars(select(SalaryEvent).where(SalaryEvent.employee_id == employee.id)).all()) == 3
