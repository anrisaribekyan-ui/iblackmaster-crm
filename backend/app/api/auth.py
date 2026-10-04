from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import func, select

from app.api.deps import CurrentEmployee, DbSession
from app.errors import BusinessError
from app.models import Employee
from app.security import create_access_token, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginIn(BaseModel):
    email: str
    password: str


class LoginOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class MeOut(BaseModel):
    id: int
    short_name: str
    email: str
    role_id: int
    role_name: str
    home_page: str
    is_owner: bool
    permissions: list[str]
    scopes: dict[str, str]
    location_ids: list[int]


@router.post("/login", response_model=LoginOut)
def login(data: LoginIn, db: DbSession):
    emp = db.scalars(select(Employee).where(func.lower(Employee.email) == data.email.strip().lower())).first()
    if emp is None or not emp.is_active or not verify_password(data.password, emp.password_hash):
        raise BusinessError("Неверный email или пароль", code="bad_credentials")
    return LoginOut(access_token=create_access_token(emp.id))


@router.get("/me", response_model=MeOut)
def me(employee: CurrentEmployee):
    from app.permissions import ALL_PERMISSION_CODES, FULL_SCOPES

    return MeOut(
        id=employee.id,
        short_name=employee.short_name,
        email=employee.email,
        role_id=employee.role_id,
        role_name=employee.role.name,
        home_page=employee.role.home_page,
        is_owner=employee.is_owner,
        permissions=ALL_PERMISSION_CODES if employee.is_owner else (employee.role.permissions or []),
        scopes=FULL_SCOPES if employee.is_owner else (employee.role.scopes or {}),
        location_ids=[loc.id for loc in employee.locations],
    )
