"""Клиент панели Remnawave 3.4 (контракт сверен с ibm-backend/app/panel.py): создать, продлить, получить пользователя."""

from dataclasses import dataclass
from datetime import datetime, timezone

import httpx

from app.errors import BusinessError


@dataclass
class PanelUser:
    id: int
    username: str
    status: str
    expire_at: datetime
    subscription_url: str


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _parse(data: dict) -> PanelUser:
    return PanelUser(
        id=int(data["id"]), username=data["username"], status=data["status"],
        expire_at=datetime.fromisoformat(data["expireAt"].replace("Z", "+00:00")),
        subscription_url=data["subscriptionUrl"],
    )


class Remnawave:
    def __init__(self, url: str, token: str, timeout: float = 20.0):
        if not url or not token:
            raise BusinessError("VPN: не заполнены адрес панели и токен (Настройки → VPN)")
        self.http = httpx.Client(
            base_url=url.rstrip("/"), timeout=timeout,
            headers={"Authorization": f"Bearer {token}", "X-Forwarded-Proto": "https", "X-Forwarded-For": "127.0.0.1"},
        )

    def _req(self, method: str, path: str, **kw):
        try:
            r = self.http.request(method, path, **kw)
        except httpx.HTTPError as e:
            raise BusinessError(f"Панель VPN недоступна: {e}") from e
        if r.status_code == 404:
            return None
        if r.status_code >= 400:
            raise BusinessError(f"Панель VPN ответила {r.status_code}: {r.text[:200]}")
        return r.json().get("response") if r.content else {}

    def squads(self) -> list[str]:
        data = self._req("GET", "/api/internal-squads") or {}
        return [s["uuid"] for s in data.get("internalSquads", [])]

    def create_user(self, *, username: str, expire_at: datetime, device_limit: int, description: str) -> PanelUser:
        data = self._req("POST", "/api/users", json={
            "username": username, "expireAt": _iso(expire_at), "hwidDeviceLimit": device_limit,
            "trafficLimitBytes": 0, "trafficLimitStrategy": "NO_RESET", "description": description,
            "activeInternalSquads": self.squads(),
        })
        if not data:
            raise BusinessError("Панель VPN не вернула пользователя")
        return _parse(data)

    def update_expire(self, user_id: int, expire_at: datetime) -> PanelUser:
        data = self._req("PATCH", "/api/users", json={"id": user_id, "expireAt": _iso(expire_at)})
        if not data:
            raise BusinessError("Пользователь не найден в панели VPN")
        user = _parse(data)
        if expire_at > datetime.now(timezone.utc) and user.status != "ACTIVE":
            self._req("POST", f"/api/users/{user_id}/actions/enable")
            user.status = "ACTIVE"
        return user

    def get_by_username(self, username: str) -> PanelUser | None:
        data = self._req("GET", f"/api/users/by-username/{username}")
        return _parse(data) if data else None


def get_panel(cfg: dict) -> Remnawave:
    """Точка подмены в тестах."""
    return Remnawave(cfg.get("panel_url", ""), cfg.get("panel_token", ""))
