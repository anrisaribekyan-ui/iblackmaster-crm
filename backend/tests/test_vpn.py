from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select

from app.models import CashRegister, Location, SalaryEvent, VpnClient
from app.services import remnawave, settings as settings_service
from app.services.remnawave import PanelUser


class FakePanel:
    def __init__(self):
        self.users = {}

    def get_by_username(self, username):
        return self.users.get(username)

    def create_user(self, *, username, expire_at, device_limit, description):
        u = PanelUser(len(self.users) + 1, username, "ACTIVE", expire_at, f"https://sub/{username}")
        self.users[username] = u
        return u

    def update_expire(self, username, user_id, expire_at):
        u = self.users[username]
        u.expire_at = expire_at
        return u


def setup(db, monkeypatch):
    panel = FakePanel()
    monkeypatch.setattr(remnawave, "get_panel", lambda cfg: panel)
    settings_service.put(db, "vpn", {"panel_url": "http://x", "panel_username": "crm", "panel_password": "p"})
    db.commit()
    location = db.scalars(select(Location).order_by(Location.sort)).first()
    register = db.scalars(select(CashRegister).where(CashRegister.location_id == location.id, CashRegister.is_active.is_(True))).first()
    return panel, register


def test_issue_renew_commission_and_free(client, auth_headers, db, owner, monkeypatch):
    panel, register = setup(db, monkeypatch)
    # без кассы — нельзя
    r = client.post("/api/vpn/issue", json={"phone": "+7 (916) 123-45-67", "months": 1}, headers=auth_headers)
    assert r.status_code == 400

    r = client.post("/api/vpn/issue", json={"phone": "+7 (916) 123-45-67", "name": "Иван", "months": 3, "cash_register_id": register.id}, headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "issue" and Decimal(str(r.json()["price"])) == Decimal("1400")
    vc = db.scalars(select(VpnClient)).one()
    assert vc.owner_id == owner.id and vc.subscription_url.endswith("crm79161234567")
    ev = db.scalars(select(SalaryEvent).where(SalaryEvent.kind == "vpn")).one()
    assert ev.amount == Decimal("420") and ev.employee_id == owner.id  # 30% от 1400

    r = client.post("/api/vpn/issue", json={"phone": "89161234567", "months": 1, "cash_register_id": register.id}, headers=auth_headers)
    assert r.json()["kind"] == "renew"
    assert db.scalars(select(SalaryEvent).where(SalaryEvent.kind == "vpn")).all()[-1].amount == Decimal("150")
    # продление идёт от конца действующей подписки
    exp = panel.users["crm79161234567"].expire_at
    assert exp > datetime.now(timezone.utc) + timedelta(days=118)

    # бесплатно: без денег и без процента
    r = client.post("/api/vpn/issue", json={"phone": "79990001122", "months": 1, "free": True}, headers=auth_headers)
    assert r.status_code == 200
    assert len(db.scalars(select(SalaryEvent).where(SalaryEvent.kind == "vpn")).all()) == 2


def test_marzban_client_contract():
    import httpx
    from app.services.remnawave import Marzban

    calls = []

    def handler(request: httpx.Request):
        calls.append((request.method, request.url.path))
        if request.url.path == "/api/admin/token":
            return httpx.Response(200, json={"access_token": "T"})
        assert request.headers["authorization"] == "Bearer T"
        if request.url.path == "/api/inbounds":
            return httpx.Response(200, json={"vless": [{}], "trojan": [{}]})
        if request.url.path == "/api/user" and request.method == "POST":
            import json as _j
            body = _j.loads(request.content)
            assert set(body["proxies"]) == {"vless", "trojan"} and body["expire"] > 0
            return httpx.Response(200, json={"username": body["username"], "status": "active", "expire": body["expire"], "subscription_url": "/sub/abc"})
        return httpx.Response(404)

    m = Marzban("https://panel.test", "crm", "pw")
    m.http = httpx.Client(base_url="https://panel.test", transport=httpx.MockTransport(handler))
    user = m.create_user(username="crm7900", expire_at=datetime.now(timezone.utc) + timedelta(days=30), device_limit=2, description="x")
    assert user.subscription_url == "https://panel.test/sub/abc" and user.status == "ACTIVE"
