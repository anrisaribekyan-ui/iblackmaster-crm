"""Заполняет пустую БД настройками, снятыми с LiveSklad (seed_data.json).

Запуск (из папки backend):
    python -m app.seed                  # пароль владельца спросит в консоли
    python -m app.seed --demo           # без вопросов: всем пароль "demo1234" (только для разработки!)

Повторный запуск ничего не делает, если компания уже есть.
"""

import argparse
import getpass
import json
import secrets
from decimal import Decimal
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.db import Base, SessionLocal, engine
from app.models import (
    CashItem,
    CashRegister,
    Company,
    CompleteSet,
    CounteragentType,
    Employee,
    FormField,
    HowKnow,
    Location,
    Measure,
    NomenclatureGroup,
    OrderStatus,
    OrderType,
    PriceType,
    Problem,
    Role,
    Store,
)
from app.permissions import ALL_PERMISSION_CODES, FULL_SCOPES
from app.security import hash_password

DATA = json.loads((Path(__file__).parent / "seed_data.json").read_text(encoding="utf-8"))


def _register(data: dict, location: Location | None) -> CashRegister:
    return CashRegister(
        location=location,
        name=data["name"],
        accepts_cash=data["accepts_cash"],
        accepts_bank=data["accepts_bank"],
        bank_percent=Decimal(data["bank_percent"]),
        allow_negative=data["allow_negative"],
        allow_internal_move=data["allow_internal_move"],
        is_default=data["is_default"],
    )


def _groups(db: Session, items: list[dict], parent: NomenclatureGroup | None = None) -> None:
    for g in items:
        node = NomenclatureGroup(name=g["name"], parent_id=parent.id if parent else None)
        db.add(node)
        db.flush()
        _groups(db, g["children"], node)


def seed(db: Session, demo: bool = False, owner_password: str | None = None) -> dict[str, str]:
    """Возвращает {email: пароль} созданных сотрудников."""
    if db.scalars(select(Company)).first():
        print("БД уже заполнена — пропускаю.")
        return {}

    c = DATA["company"]
    db.add(Company(**c))

    locations = []
    for loc in DATA["locations"]:
        location = Location(name=loc["name"], address=loc["address"], phones=loc["phones"], color=loc["color"], sort=loc["sort"])
        db.add(location)
        for i, st in enumerate(loc["stores"]):
            db.add(Store(location=location, name=st["name"], is_default=i == 0))
        for r in loc["cash_registers"]:
            db.add(_register(r, location))
        locations.append(location)
    for r in DATA["global_cash_registers"]:
        db.add(_register(r, None))

    for s in DATA["statuses"]:
        db.add(OrderStatus(**s))

    for name in DATA["counteragent_types"]:
        db.add(CounteragentType(name=name))
    for name in DATA["how_knows"]:
        db.add(HowKnow(name=name))
    for ci in DATA["cash_items"]:
        db.add(CashItem(**ci))
    for i, p in enumerate(DATA["price_types"]):
        db.add(PriceType(name=p["name"], is_minimal=p["is_minimal"], sort=i))
    for m in DATA["measures"]:
        db.add(Measure(**m))
    for name in DATA["problems"]:
        db.add(Problem(name=name))
    for name in DATA["complete_sets"]:
        db.add(CompleteSet(name=name))
    db.flush()
    _groups(db, DATA["nomenclature_groups"])

    items = DATA["field_items"]
    for i, type_name in enumerate(DATA["order_types"]):
        ot = OrderType(name=type_name, sort=i)
        db.add(ot)
        db.flush()
        for f in DATA["form_fields"][type_name]:
            db.add(FormField(order_type_id=ot.id, items=items.get(f["key"]), **f))

    roles = {}
    for r in DATA["roles"]:
        role = Role(
            name=r["name"],
            home_page=r["home_page"],
            permissions=ALL_PERMISSION_CODES if r["permissions"] == "ALL" else r["permissions"],
            scopes=FULL_SCOPES if r["scopes"] == "FULL" else r["scopes"],
            is_system=r["name"] == "БОСС",
        )
        db.add(role)
        roles[r["name"]] = role
    db.flush()

    passwords: dict[str, str] = {}
    for e in DATA["employees"]:
        if demo:
            pwd = "demo1234"
        elif e["is_owner"] and owner_password:
            pwd = owner_password
        else:
            pwd = secrets.token_urlsafe(8)
        emp = Employee(
            name=e["name"], surname=e["surname"], short_name=e["short_name"], email=e["email"],
            role=roles[e["role"]], is_owner=e["is_owner"], password_hash=hash_password(pwd, rounds=4 if demo else 12),
        )
        emp.locations = list(locations)
        db.add(emp)
        passwords[e["email"]] = pwd

    db.commit()
    return passwords


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--demo", action="store_true", help="всем пароль demo1234")
    args = parser.parse_args()
    Base.metadata.create_all(engine)
    owner_password = None
    if not args.demo:
        owner_password = getpass.getpass("Пароль владельца (Sar. Anri): ")
    with SessionLocal() as db:
        passwords = seed(db, demo=args.demo, owner_password=owner_password)
    if passwords:
        print("Сотрудники созданы. Логины и пароли (сохраните, повторно не покажутся):")
        for email, pwd in passwords.items():
            print(f"  {email}  /  {pwd}")


if __name__ == "__main__":
    main()
