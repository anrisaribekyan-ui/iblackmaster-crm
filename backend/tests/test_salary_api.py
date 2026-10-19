"""API зарплаты: правила, сводка за месяц, бонусы/штрафы, выплаты, права."""

from decimal import Decimal

from sqlalchemy import select

from app.db import utcnow
from app.models import CashRegister, Employee, Role, SalaryRule
from app.security import hash_password


def month_now():
    from zoneinfo import ZoneInfo
    now = utcnow().astimezone(ZoneInfo("Europe/Moscow"))
    return now.year, now.month


def test_rules_crud_and_duplicate(client, auth_headers, db, owner):
    body = {"employee_id": owner.id, "kind": "workOrder", "steps": [{"from": 0, "value": 50}]}
    r = client.post("/api/salary/rules", json=body, headers=auth_headers)
    assert r.status_code == 200, r.text
    rule_id = r.json()["id"]
    assert r.json()["steps"] == [{"from": "0", "value": "50"}]
    dup = client.post("/api/salary/rules", json=body, headers=auth_headers)
    assert dup.status_code == 400
    upd = client.put(f"/api/salary/rules/{rule_id}", json={**body, "accrue_on": "close"}, headers=auth_headers)
    assert upd.status_code == 200 and upd.json()["accrue_on"] == "close"
    assert len(client.get(f"/api/salary/rules?employee_id={owner.id}", headers=auth_headers).json()) == 1
    assert client.delete(f"/api/salary/rules/{rule_id}", headers=auth_headers).status_code == 204


def test_rule_steps_stored_without_float_and_old_float_steps_read(client, auth_headers, db, owner):
    body = {
        "employee_id": owner.id,
        "kind": "workOrder",
        "steps": [{"from": "0", "value": "50.5"}, {"from": "1000.25", "value": "12.5"}],
    }
    response = client.post("/api/salary/rules", json=body, headers=auth_headers)

    assert response.status_code == 200, response.text
    assert response.json()["steps"] == [{"from": "0", "value": "50.5"}, {"from": "1000.25", "value": "12.5"}]
    stored = db.get(SalaryRule, response.json()["id"])
    assert stored.steps == [{"from": "0", "value": "50.5"}, {"from": "1000.25", "value": "12.5"}]
    assert all(isinstance(step["from"], str) and isinstance(step["value"], str) for step in stored.steps)

    # Старые правила, сохранённые ещё с float, должны читаться и считаться.
    old = SalaryRule(
        employee_id=owner.id,
        kind="newOrder",
        base="summ",
        value_type="percent",
        steps=[{"from": 0.0, "value": 50.0}, {"from": 1000.25, "value": 12.5}],
    )
    db.add(old)
    db.commit()

    listed = client.get(f"/api/salary/rules?employee_id={owner.id}", headers=auth_headers)
    assert listed.status_code == 200, listed.text
    old_row = next(rule for rule in listed.json() if rule["id"] == old.id)
    assert old_row["steps"] == [{"from": "0.0", "value": "50.0"}, {"from": "1000.25", "value": "12.5"}]

    from app.services import salary

    amount, _ = salary.apply_rule(old, Decimal("2000"))
    assert amount == Decimal("250")


def test_bonus_penalty_payout_summary(client, auth_headers, db, owner):
    year, month = month_now()
    assert client.post("/api/salary/events", json={"employee_id": owner.id, "kind": "bonus", "amount": "5000"}, headers=auth_headers).status_code == 200
    assert client.post("/api/salary/events", json={"employee_id": owner.id, "kind": "penalty", "amount": "1000"}, headers=auth_headers).status_code == 200
    register = db.scalars(select(CashRegister).where(CashRegister.accepts_cash.is_(True))).first()
    from app.services import money
    from app.models import CashItemType
    money.create_transaction(db, cash_register_id=register.id, cash_item=money.get_system_item(db, CashItemType.ORDER), amount="10000")
    db.commit()
    pay = client.post("/api/salary/payouts", json={"employee_id": owner.id, "cash_register_id": register.id, "amount": "3000"}, headers=auth_headers)
    assert pay.status_code == 200, pay.text

    summary = client.get(f"/api/salary/summary?year={year}&month={month}", headers=auth_headers).json()
    row = next(r for r in summary["items"] if r["employee_id"] == owner.id)
    assert Decimal(str(row["bonuses"])) == Decimal("5000")
    assert Decimal(str(row["penalties"])) == Decimal("-1000")
    assert Decimal(str(row["paid"])) == Decimal("3000")
    assert Decimal(str(row["to_pay"])) == Decimal("1000")

    months = client.get(f"/api/salary/employees/{owner.id}/months", headers=auth_headers).json()
    assert months[0]["year"] == year and months[0]["month"] == month
    events = client.get(f"/api/salary/employees/{owner.id}/events?year={year}&month={month}", headers=auth_headers).json()
    assert {e["kind_title"] for e in events} == {"Бонус", "Штраф"}
    assert client.delete(f"/api/salary/events/{events[0]['id']}", headers=auth_headers).status_code == 204


def test_own_scope_sees_only_self_and_none_is_forbidden(client, db):
    own_role = Role(name="Своя зарплата", permissions=[], scopes={"salary": "own"})
    none_role = Role(name="Без зарплаты", permissions=[], scopes={"salary": "none"})
    me = Employee(name="Мастер Свой", short_name="Свой", email="own-salary@example.test",
                  password_hash=hash_password("password123", rounds=4), role=own_role)
    other = Employee(name="Чужой", short_name="Чужой", email="none-salary@example.test",
                     password_hash=hash_password("password123", rounds=4), role=none_role)
    db.add_all([me, other])
    db.commit()
    year, month = month_now()

    token = client.post("/api/auth/login", json={"email": me.email, "password": "password123"}).json()["access_token"]
    rows = client.get(f"/api/salary/summary?year={year}&month={month}", headers={"Authorization": f"Bearer {token}"}).json()["items"]
    assert [r["employee_id"] for r in rows] == [me.id]
    # Свою можно смотреть, а ставить себе бонус — нет права
    bonus = client.post("/api/salary/events", json={"employee_id": me.id, "kind": "bonus", "amount": "100"},
                        headers={"Authorization": f"Bearer {token}"})
    assert bonus.status_code == 403

    token2 = client.post("/api/auth/login", json={"email": other.email, "password": "password123"}).json()["access_token"]
    assert client.get(f"/api/salary/summary?year={year}&month={month}", headers={"Authorization": f"Bearer {token2}"}).status_code == 403

def test_salary_kinds_payouts_and_recalc(client, auth_headers, owner):
    kinds = client.get("/api/salary/kinds", headers=auth_headers)
    assert kinds.status_code == 200
    assert "workOrder" in [kind["code"] for kind in kinds.json()]

    payouts = client.get(f"/api/salary/employees/{owner.id}/payouts", headers=auth_headers)
    assert payouts.status_code == 200
    assert isinstance(payouts.json(), list)

    year, month = month_now()
    recalc = client.post("/api/salary/recalc", json={"year": year, "month": month}, headers=auth_headers)
    assert recalc.status_code == 200, recalc.text
    assert isinstance(recalc.json()["documents"], int)
