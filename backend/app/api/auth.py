import secrets
from datetime import timedelta
from urllib.parse import quote
from zoneinfo import ZoneInfo

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.api.deps import CurrentEmployee, DbSession
from app.errors import BusinessError
from app.db import utcnow
from app.models import EmailCode, Employee
from app.security import create_access_token, hash_password, verify_password
from app.services import mail

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


# --- Забыли пароль: код на почту ----------------------------------------------------------

CODE_TTL = timedelta(minutes=15)
RESEND_AFTER = timedelta(seconds=60)
MAX_PER_HOUR = 5
MAX_ATTEMPTS = 5
MSK = ZoneInfo("Europe/Moscow")


class ForgotIn(BaseModel):
    email: str


class ResetIn(BaseModel):
    email: str
    code: str = Field(min_length=6, max_length=6)
    password: str = Field(min_length=8, max_length=128)


def first_name(employee: Employee) -> str:
    return (employee.name or employee.short_name).split()[0]


def notify_password_changed(employee: Employee, by: str) -> None:
    when = utcnow().astimezone(MSK).strftime("%d.%m.%Y в %H:%M")
    mail.send(employee.email, "Пароль в CRM iBlackMaster изменён", "password_changed",
              name=first_name(employee), when=when, by=by, email=employee.email)


def _find(db: DbSession, email: str) -> Employee | None:
    return db.scalars(select(Employee).where(func.lower(Employee.email) == email.strip().lower())).first()


@router.post("/forgot")
def forgot_password(data: ForgotIn, db: DbSession):
    """Отправить код. Ответ одинаковый, есть такая почта или нет — чтобы по CRM нельзя было проверять адреса."""
    if not mail.configured():
        raise BusinessError("Почта для писем ещё не подключена — попросите владельца сменить вам пароль в настройках")
    employee = _find(db, data.email)
    if employee is None or not employee.is_active:
        return {"sent": True}
    now = utcnow()
    recent = db.scalars(
        select(EmailCode).where(EmailCode.employee_id == employee.id, EmailCode.created_at >= now - timedelta(hours=1))
        .order_by(EmailCode.created_at.desc())
    ).all()
    if recent and now - recent[0].created_at < RESEND_AFTER:
        wait = int((RESEND_AFTER - (now - recent[0].created_at)).total_seconds()) + 1
        raise BusinessError(f"Код уже отправлен. Новый можно запросить через {wait} с")
    if len(recent) >= MAX_PER_HOUR:
        raise BusinessError("Слишком много запросов. Попробуйте через час или попросите владельца сменить пароль")
    for old in recent:  # действует только последний код
        if old.used_at is None:
            old.used_at = now
    code = f"{secrets.randbelow(10**6):06d}"
    db.add(EmailCode(employee_id=employee.id, purpose="reset", code_hash=hash_password(code, rounds=8),
                     created_at=now, expires_at=now + CODE_TTL))
    db.commit()
    mail.send(employee.email, f"{code} — код для нового пароля iBlackMaster", "reset",
              name=first_name(employee), code=code, email=employee.email, email_q=quote(employee.email),
              **{f"d{i + 1}": digit for i, digit in enumerate(code)})
    return {"sent": True}


@router.post("/reset", response_model=LoginOut)
def reset_password(data: ResetIn, db: DbSession):
    wrong = BusinessError("Код неверный или устарел. Запросите новый", code="bad_code")
    employee = _find(db, data.email)
    if employee is None or not employee.is_active:
        raise wrong
    now = utcnow()
    item = db.scalars(
        select(EmailCode).where(EmailCode.employee_id == employee.id, EmailCode.used_at.is_(None), EmailCode.expires_at > now)
        .order_by(EmailCode.created_at.desc())
    ).first()
    if item is None:
        raise wrong
    if not verify_password(data.code.strip(), item.code_hash):
        item.attempts += 1
        if item.attempts >= MAX_ATTEMPTS:
            item.used_at = now  # перебирать коды бесполезно: после 5 ошибок код сгорает
        db.commit()
        raise wrong
    item.used_at = now
    employee.password_hash = hash_password(data.password)
    employee.password_changed_at = now
    db.commit()
    notify_password_changed(employee, "вы сами, по коду из письма")
    return LoginOut(access_token=create_access_token(employee.id))
