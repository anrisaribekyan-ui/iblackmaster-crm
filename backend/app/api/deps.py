"""Зависимости FastAPI: текущий сотрудник, проверка прав, доступ к локации.

Пример в роутере:

    @router.post("/orders", dependencies=[Depends(require("createOrderAccess"))])
    def create_order(data: OrderCreate, db: DbSession, me: CurrentEmployee): ...

    check_location(me, data.location_id)   # сотрудник работает в этой точке?
"""

from typing import Annotated

from fastapi import Depends, Header
from sqlalchemy.orm import Session

from app.db import get_db
from app.errors import BusinessError, Forbidden
from app.models import Employee
from app.permissions import PERMISSIONS
from app.security import decode_access_token

DbSession = Annotated[Session, Depends(get_db)]


class Unauthorized(BusinessError):
    def __init__(self):
        super().__init__("Требуется вход в систему", code="unauthorized")


def get_current_employee(db: DbSession, authorization: Annotated[str | None, Header()] = None) -> Employee:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise Unauthorized()
    employee_id = decode_access_token(authorization.split(" ", 1)[1])
    if employee_id is None:
        raise Unauthorized()
    employee = db.get(Employee, employee_id)
    if employee is None or not employee.is_active:
        raise Unauthorized()
    return employee


CurrentEmployee = Annotated[Employee, Depends(get_current_employee)]


def has_permission(employee: Employee, code: str) -> bool:
    if code not in PERMISSIONS:
        raise ValueError(f"Неизвестное право: {code}")  # опечатка в коде — падаем сразу
    if employee.is_owner:
        return True
    return code in (employee.role.permissions or [])


def scope_of(employee: Employee, key: str) -> str:
    """Значение права-выбора: none | all | own | locations. Владелец — всегда all."""
    if employee.is_owner:
        return "all"
    return (employee.role.scopes or {}).get(key, "none")


def require(*codes: str):
    """Зависимость: у сотрудника должны быть ВСЕ перечисленные права."""

    def checker(employee: CurrentEmployee) -> Employee:
        for code in codes:
            if not has_permission(employee, code):
                raise Forbidden(f"Нет права: {PERMISSIONS[code]['title']}")
        return employee

    return checker


def location_ids(employee: Employee) -> set[int]:
    """Локации, где работает сотрудник. Владелец видит все (пустое множество = без ограничения)."""
    if employee.is_owner:
        return set()
    return {loc.id for loc in employee.locations}


def check_location(employee: Employee, location_id: int) -> None:
    allowed = location_ids(employee)
    if allowed and location_id not in allowed:
        raise Forbidden("Нет доступа к этой локации")
