from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.api.deps import CurrentEmployee, DbSession, check_location, location_ids, require
from app.errors import BusinessError, NotFound
from app.models import Employee, Location, Role
from app.permissions import PERMISSIONS, SCOPES
from app.security import hash_password

router = APIRouter(tags=["Сотрудники и роли"])


class RoleIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    home_page: Literal["orders", "sales"] = "orders"
    permissions: list[str] = Field(default_factory=list)
    scopes: dict[str, str] = Field(default_factory=dict)


class RoleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    home_page: str
    permissions: list[str]
    scopes: dict[str, str]
    is_system: bool


class EmployeeFields(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    surname: str | None = Field(default=None, max_length=100)
    patronymic: str | None = Field(default=None, max_length=100)
    short_name: str = Field(min_length=1, max_length=100)
    email: str = Field(min_length=1, max_length=200)
    phones: str | None = Field(default=None, max_length=300)
    inn: str | None = Field(default=None, max_length=20)
    position: str | None = Field(default=None, max_length=100)
    birthday: date | None = None
    role_id: int
    location_ids: list[int] = Field(default_factory=list)


class EmployeeCreate(EmployeeFields):
    password: str = Field(min_length=8)


class EmployeeUpdate(EmployeeFields):
    pass


class EmployeeOut(BaseModel):
    id: int
    name: str
    surname: str | None
    patronymic: str | None
    short_name: str
    email: str
    phones: str | None
    inn: str | None
    position: str | None
    birthday: date | None
    role_id: int
    is_owner: bool
    is_active: bool
    location_ids: list[int]


class EmployeeShortOut(BaseModel):
    id: int
    short_name: str


class PasswordIn(BaseModel):
    password: str = Field(min_length=8)


def validate_role_data(data: RoleIn) -> None:
    unknown_permissions = set(data.permissions) - PERMISSIONS.keys()
    if unknown_permissions:
        raise BusinessError(f"Неизвестное право: {sorted(unknown_permissions)[0]}")
    for scope, value in data.scopes.items():
        if scope not in SCOPES or value not in SCOPES[scope]["options"]:
            raise BusinessError(f"Недопустимое значение права-выбора: {scope}")


def role_out(role: Role) -> RoleOut:
    return RoleOut.model_validate(role)


def employee_out(employee: Employee) -> EmployeeOut:
    return EmployeeOut(
        id=employee.id,
        name=employee.name,
        surname=employee.surname,
        patronymic=employee.patronymic,
        short_name=employee.short_name,
        email=employee.email,
        phones=employee.phones,
        inn=employee.inn,
        position=employee.position,
        birthday=employee.birthday,
        role_id=employee.role_id,
        is_owner=employee.is_owner,
        is_active=employee.is_active,
        location_ids=sorted(location.id for location in employee.locations),
    )


def get_role(db: DbSession, role_id: int) -> Role:
    role = db.get(Role, role_id)
    if role is None:
        raise NotFound("Роль")
    return role


def get_employee_locations(db: DbSession, employee: CurrentEmployee, ids: list[int]) -> list[Location]:
    unique_ids = set(ids)
    if not unique_ids:
        return []
    locations = db.scalars(
        select(Location).where(Location.id.in_(unique_ids), Location.is_active.is_(True))
    ).all()
    if len(locations) != len(unique_ids):
        raise NotFound("Локация")
    for location in locations:
        check_location(employee, location.id)
    return locations


@router.get("/permissions", dependencies=[Depends(require("settingAccess"))])
def list_permissions(_: CurrentEmployee):
    sections: dict[str, list[dict]] = {}
    for code, permission in PERMISSIONS.items():
        sections.setdefault(permission["section"], []).append({"code": code, **permission})
    return {
        "sections": [{"section": section, "permissions": items} for section, items in sections.items()],
        "scopes": SCOPES,
    }


@router.get("/roles", response_model=list[RoleOut], dependencies=[Depends(require("settingAccess"))])
def list_roles(db: DbSession):
    return db.scalars(select(Role).order_by(Role.name)).all()


@router.post("/roles", response_model=RoleOut, dependencies=[Depends(require("settingAccess"))])
def create_role(data: RoleIn, db: DbSession):
    validate_role_data(data)
    role = Role(
        name=data.name.strip(),
        home_page=data.home_page,
        permissions=data.permissions,
        scopes=data.scopes,
    )
    db.add(role)
    db.commit()
    return role


@router.put("/roles/{role_id}", response_model=RoleOut, dependencies=[Depends(require("settingAccess"))])
def update_role(role_id: int, data: RoleIn, db: DbSession):
    validate_role_data(data)
    role = get_role(db, role_id)
    role.name = data.name.strip()
    role.home_page = data.home_page
    role.permissions = data.permissions
    role.scopes = data.scopes
    db.commit()
    return role


@router.delete("/roles/{role_id}", status_code=204, dependencies=[Depends(require("settingAccess"))])
def delete_role(role_id: int, db: DbSession):
    role = get_role(db, role_id)
    if role.is_system:
        raise BusinessError("Нельзя удалить системную роль")
    if db.scalar(select(Employee.id).where(Employee.role_id == role_id).limit(1)) is not None:
        raise BusinessError("Нельзя удалить роль, к которой привязаны сотрудники")
    db.delete(role)
    db.commit()
    return Response(status_code=204)


@router.get("/employees", response_model=list[EmployeeOut], dependencies=[Depends(require("settingAccess"))])
def list_employees(db: DbSession):
    employees = db.scalars(select(Employee).order_by(Employee.surname, Employee.name, Employee.id)).all()
    return [employee_out(employee) for employee in employees]


@router.post("/employees", response_model=EmployeeOut, dependencies=[Depends(require("settingAccess"))])
def create_employee(data: EmployeeCreate, db: DbSession, me: CurrentEmployee):
    role = get_role(db, data.role_id)
    locations = get_employee_locations(db, me, data.location_ids)
    values = data.model_dump(exclude={"password", "location_ids"})
    values["email"] = values["email"].strip().lower()
    employee = Employee(
        **values,
        password_hash=hash_password(data.password),
        role=role,
        locations=locations,
    )
    db.add(employee)
    db.commit()
    return employee_out(employee)


@router.put("/employees/{employee_id}", response_model=EmployeeOut, dependencies=[Depends(require("settingAccess"))])
def update_employee(employee_id: int, data: EmployeeUpdate, db: DbSession, me: CurrentEmployee):
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise NotFound("Сотрудник")
    if employee.is_owner and data.role_id != employee.role_id:
        raise BusinessError("Нельзя изменить роль владельца")
    role = get_role(db, data.role_id)
    locations = get_employee_locations(db, me, data.location_ids)
    values = data.model_dump(exclude={"location_ids"})
    values["email"] = values["email"].strip().lower()
    for field, value in values.items():
        setattr(employee, field, value)
    employee.role = role
    employee.locations = locations
    db.commit()
    return employee_out(employee)


@router.post(
    "/employees/{employee_id}/password",
    status_code=204,
    dependencies=[Depends(require("settingAccess"))],
)
def change_employee_password(employee_id: int, data: PasswordIn, db: DbSession):
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise NotFound("Сотрудник")
    employee.password_hash = hash_password(data.password)
    db.commit()
    return Response(status_code=204)


@router.delete("/employees/{employee_id}", status_code=204, dependencies=[Depends(require("settingAccess"))])
def deactivate_employee(employee_id: int, db: DbSession):
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise NotFound("Сотрудник")
    if employee.is_owner:
        raise BusinessError("Нельзя отключить владельца")
    employee.is_active = False
    db.commit()
    return Response(status_code=204)


@router.get("/employees/short", response_model=list[EmployeeShortOut])
def list_employees_short(
    db: DbSession,
    me: CurrentEmployee,
    location_id: int | None = None,
    master: bool = False,
    manager: bool = False,
):
    query = select(Employee).where(Employee.is_active.is_(True)).order_by(Employee.short_name, Employee.id)
    allowed = location_ids(me)
    if location_id is not None:
        check_location(me, location_id)
        query = query.where(Employee.locations.any(Location.id == location_id))
    elif allowed:
        query = query.where(Employee.locations.any(Location.id.in_(allowed)))

    employees = db.scalars(query).all()
    if master:
        employees = [employee for employee in employees if "isMasterAccess" in (employee.role.permissions or [])]
    if manager:
        employees = [employee for employee in employees if "isManagerAccess" in (employee.role.permissions or [])]
    return [EmployeeShortOut(id=employee.id, short_name=employee.short_name) for employee in employees]