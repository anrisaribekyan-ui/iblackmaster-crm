"""Выдача и продление VPN из CRM. Сотрудник выдаёт только с приёмом денег; без оплаты — только с правом vpnFreeAccess.

Закрепление: первый, кто выдал клиенту доступ, становится его владельцем и получает commission_percent
от цены каждой выдачи и каждого продления (даже если продлевает другой сотрудник).
"""

import calendar
from datetime import datetime, timezone
from decimal import ROUND_DOWN, Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import utcnow
from app.errors import BusinessError
from app.models import CashItemType, Counteragent, Employee, SalaryEvent, Transaction, VpnClient, VpnIssue
from app.models.salary import AccrualKind
from app.services import money, settings as settings_service
from app.services import remnawave
from app.utils.phone import normalize_phone


def add_months(dt: datetime, months: int) -> datetime:
    month = dt.month - 1 + months
    year, month = dt.year + month // 12, month % 12 + 1
    day = min(dt.day, calendar.monthrange(year, month)[1])
    return dt.replace(year=year, month=month, day=day)


def _aware(dt: datetime | None) -> datetime | None:
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def price_for(cfg: dict, months: int) -> Decimal:
    prices = cfg.get("prices") or {}
    if str(months) not in prices:
        raise BusinessError("Такого тарифа нет")
    return money.to_money(prices[str(months)])


def _counteragent(db: Session, phone: str, name: str | None) -> Counteragent:
    found = db.scalars(select(Counteragent).where(Counteragent.phones.contains(phone), Counteragent.is_deleted.is_(False))).first()
    if found:
        return found
    agent = Counteragent(name=(name or phone).strip(), phones=phone)
    db.add(agent)
    db.flush()
    return agent


def issue_or_renew(
    db: Session, *, me: Employee, phone: str, name: str | None, months: int,
    cash_register_id: int | None, is_bank: bool, free: bool, can_free: bool,
) -> tuple[VpnClient, VpnIssue]:
    normalized = normalize_phone(phone or "")
    if not normalized or len(normalized) != 11:
        raise BusinessError("Введите номер телефона полностью")
    cfg = settings_service.get(db, "vpn")
    price = price_for(cfg, months)
    if free:
        if not can_free:
            raise BusinessError("Выдача без оплаты доступна только с правом vpnFreeAccess")
        price = Decimal("0")
    elif not cash_register_id:
        raise BusinessError("Выберите кассу: VPN выдаётся только с приёмом оплаты")

    client = db.scalars(select(VpnClient).where(VpnClient.phone == normalized)).first()
    panel = remnawave.get_panel(cfg)
    now = utcnow()
    # Продление идёт от даты окончания, если подписка ещё действует
    base = max(_aware(client.expires_at) or now, now) if client else now
    expire_at = add_months(base, months)

    # Сначала панель: если она недоступна, ни денег, ни записей не создаём
    if client is None:
        username = f"crm{normalized}"
        existing = panel.get_by_username(username)
        if existing:
            user = panel.update_expire(existing.id, add_months(max(_aware(existing.expire_at), now), months))
        else:
            user = panel.create_user(username=username, expire_at=expire_at, device_limit=int(cfg.get("device_limit") or 2),
                                     description=f"CRM: {name or normalized}")
        agent = _counteragent(db, normalized, name)
        client = VpnClient(
            counteragent_id=agent.id, name=(name or agent.name), phone=normalized, panel_username=username,
            panel_user_id=user.id, subscription_url=user.subscription_url, expires_at=user.expire_at,
            owner_id=me.id,
        )
        db.add(client)
        kind = "issue"
    else:
        user = panel.update_expire(client.panel_user_id, expire_at)
        client.expires_at = user.expire_at
        client.subscription_url = user.subscription_url or client.subscription_url
        kind = "renew"
    db.flush()

    tx = None
    if price > 0:
        tx = money.create_transaction(
            db, cash_register_id=cash_register_id, cash_item=money.get_system_item(db, CashItemType.VPN),
            amount=price, is_bank=is_bank, counteragent_id=client.counteragent_id, employee_id=me.id,
            created_by_id=me.id, note=f"VPN {months} мес. {client.name or ''}".strip(),
        )
    issue = VpnIssue(client_id=client.id, kind=kind, months=months, price=price, employee_id=me.id,
                     transaction_id=tx.id if tx else None)
    db.add(issue)
    db.flush()

    percent = Decimal(str(cfg.get("commission_percent") or 0))
    if tx is not None and client.owner_id and percent > 0:
        amount = (price * percent / 100).quantize(Decimal("1"), rounding=ROUND_DOWN)
        if amount > 0:
            db.add(SalaryEvent(
                employee_id=client.owner_id, kind=AccrualKind.VPN.value, date=tx.date, amount=amount,
                location_id=tx.location_id, details={"vpn_issue": issue.id, "price": str(price), "percent": str(percent)},
                is_manual=True, note=f"VPN {'выдача' if kind == 'issue' else 'продление'}: {client.name or client.phone}, {months} мес.",
                created_by_id=me.id,
            ))
    return client, issue
