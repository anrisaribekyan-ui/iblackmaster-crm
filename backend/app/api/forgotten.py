"""Забытые аппараты (ТЗ этап 3, E1): список «готов, но не забрали», плитка на главной, настройки напоминаний."""

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from app.api.deps import CurrentEmployee, DbSession, check_location, location_ids, require, scope_of
from app.errors import Forbidden
from app.services import forgotten, settings

router = APIRouter(tags=["Забытые аппараты"])


def _scope_args(me) -> dict:
    scope = scope_of(me, "orders")
    if scope == "none":
        raise Forbidden("Нет доступа к заказам")
    return {"allowed_locations": location_ids(me) or None, "own_employee_id": me.id if scope == "own" else None}


@router.get("/forgotten")
def forgotten_list(db: DbSession, me: CurrentEmployee, location_id: int | None = None, days: int | None = Query(default=None, ge=0)):
    if location_id is not None:
        check_location(me, location_id)
    conf = settings.get(db, "forgotten")
    threshold = conf["list_days"] if days is None else days
    items = [r for r in forgotten.ready_orders(db, location_id=location_id, **_scope_args(me)) if r["days"] >= threshold]
    return {
        "days": threshold,
        "count": len(items),
        "debt": sum(r["debt"] for r in items),
        "reminders_active": conf["reminders_active"],
        "items": items,
    }


@router.get("/forgotten/summary")
def forgotten_summary(db: DbSession, me: CurrentEmployee, location_id: int | None = None):
    if location_id is not None:
        check_location(me, location_id)
    return forgotten.summary(db, location_id=location_id, **_scope_args(me))


class ForgottenSettingsIn(BaseModel):
    list_days: int = Field(ge=1, le=365)
    reminders_active: bool
    reminder_days: list[int] = Field(max_length=6)
    reminder_text: str = Field(max_length=600)


@router.get("/settings/forgotten", dependencies=[Depends(require("changeNotificationAccess"))])
def get_forgotten_settings(db: DbSession):
    return settings.get(db, "forgotten")


@router.put("/settings/forgotten", dependencies=[Depends(require("changeNotificationAccess"))])
def put_forgotten_settings(data: ForgottenSettingsIn, db: DbSession):
    value = data.model_dump()
    value["reminder_days"] = sorted({d for d in value["reminder_days"] if 1 <= d <= 365})
    value["reminder_text"] = value["reminder_text"].strip()
    saved = settings.put(db, "forgotten", value)
    db.commit()
    return saved
