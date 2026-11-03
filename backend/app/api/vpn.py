"""Раздел «VPN»: выдача и продление доступов iBM (Remnawave), закрепление клиентов за сотрудниками."""

from decimal import Decimal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import or_, select

from app.api.deps import CurrentEmployee, DbSession, check_location, has_permission, require
from app.errors import BusinessError, Forbidden, NotFound
from app.models import CashRegister, Employee, VpnClient, VpnIssue
from app.services import settings as settings_service
from app.services import vpn as vpn_service

router = APIRouter(prefix="/vpn", tags=["vpn"])
access = [Depends(require("vpnAccess"))]


def _client_out(db, c: VpnClient, owners: dict[int, str]) -> dict:
    return {
        "id": c.id, "name": c.name, "phone": c.phone, "subscription_url": c.subscription_url,
        "expires_at": c.expires_at, "owner_id": c.owner_id, "owner": owners.get(c.owner_id),
        "counteragent_id": c.counteragent_id,
    }


@router.get("/config", dependencies=access)
def get_config(db: DbSession, me: CurrentEmployee):
    cfg = settings_service.get(db, "vpn")
    return {
        "prices": cfg["prices"], "commission_percent": cfg["commission_percent"],
        "can_free": has_permission(me, "vpnFreeAccess"), "configured": bool(cfg["panel_url"] and cfg["panel_token"]),
    }


class VpnSettingsIn(BaseModel):
    panel_url: str | None = None
    panel_token: str | None = None
    commission_percent: Decimal | None = Field(default=None, ge=0, le=100)
    device_limit: int | None = Field(default=None, ge=1, le=20)
    prices: dict[str, int] | None = None


@router.get("/settings", dependencies=[Depends(require("settingAccess"))])
def get_settings(db: DbSession):
    cfg = settings_service.get(db, "vpn")
    return {**cfg, "panel_token": "", "token_set": bool(cfg["panel_token"])}


@router.put("/settings", dependencies=[Depends(require("settingAccess"))])
def put_settings(data: VpnSettingsIn, db: DbSession):
    values = {k: (float(v) if isinstance(v, Decimal) else v) for k, v in data.model_dump(exclude_none=True).items()}
    if not values.get("panel_token"):
        values.pop("panel_token", None)  # пустое поле не затирает сохранённый токен
    settings_service.put(db, "vpn", values)
    db.commit()
    return {"ok": True}


@router.get("/clients", dependencies=access)
def list_clients(db: DbSession, q: str | None = None, owner_id: int | None = None):
    query = select(VpnClient).order_by(VpnClient.expires_at.desc().nulls_last(), VpnClient.id.desc())
    if q and q.strip():
        term = q.strip()
        digits = "".join(ch for ch in term if ch.isdigit())
        conds = [VpnClient.name.icontains(term, autoescape=True)]
        if digits:
            conds.append(VpnClient.phone.contains(digits))
        query = query.where(or_(*conds))
    if owner_id:
        query = query.where(VpnClient.owner_id == owner_id)
    clients = db.scalars(query.limit(300)).all()
    owners = dict(db.execute(select(Employee.id, Employee.short_name)).all())
    return [_client_out(db, c, owners) for c in clients]


class IssueIn(BaseModel):
    phone: str
    name: str | None = None
    months: int
    cash_register_id: int | None = None
    is_bank: bool = False
    free: bool = False


@router.post("/issue", dependencies=access)
def issue(data: IssueIn, db: DbSession, me: CurrentEmployee):
    if data.cash_register_id:
        register = db.get(CashRegister, data.cash_register_id)
        if register is None or not register.is_active:
            raise NotFound("Касса")
        if register.location_id is not None:
            check_location(me, register.location_id)
    client, issue_row = vpn_service.issue_or_renew(
        db, me=me, phone=data.phone, name=data.name, months=data.months, cash_register_id=data.cash_register_id,
        is_bank=data.is_bank, free=data.free, can_free=has_permission(me, "vpnFreeAccess"),
    )
    db.commit()
    owners = dict(db.execute(select(Employee.id, Employee.short_name)).all())
    return {"client": _client_out(db, client, owners), "kind": issue_row.kind, "price": issue_row.price}


class OwnerIn(BaseModel):
    owner_id: int | None


@router.put("/clients/{client_id}/owner", dependencies=[Depends(require("vpnFreeAccess"))])
def set_owner(client_id: int, data: OwnerIn, db: DbSession):
    client = db.get(VpnClient, client_id)
    if client is None:
        raise NotFound("Клиент VPN")
    if data.owner_id is not None and db.get(Employee, data.owner_id) is None:
        raise NotFound("Сотрудник")
    client.owner_id = data.owner_id
    db.commit()
    return {"ok": True}


@router.get("/clients/{client_id}/history", dependencies=access)
def history(client_id: int, db: DbSession):
    rows = db.scalars(select(VpnIssue).where(VpnIssue.client_id == client_id).order_by(VpnIssue.date.desc())).all()
    names = dict(db.execute(select(Employee.id, Employee.short_name)).all())
    return [{"id": r.id, "date": r.date, "kind": r.kind, "months": r.months, "price": r.price, "employee": names.get(r.employee_id)} for r in rows]
