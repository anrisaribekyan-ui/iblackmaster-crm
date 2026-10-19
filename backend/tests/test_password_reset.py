"""Сброс пароля по коду из письма и отзыв старых входов."""

import re

import pytest

from app.config import settings
from app.services import mail


@pytest.fixture
def outbox(monkeypatch):
    sent = []
    monkeypatch.setattr(settings, "smtp_host", "smtp.test")
    monkeypatch.setattr(settings, "smtp_user", "crm@test.ru")
    monkeypatch.setattr(settings, "smtp_password", "x")
    monkeypatch.setattr(mail, "_deliver", lambda message: sent.append(message))

    class SyncThread:  # письма в тестах уходят сразу, без фонового потока
        def __init__(self, target, daemon=None):
            self.target = target

        def start(self):
            self.target()

    monkeypatch.setattr(mail.threading, "Thread", SyncThread)
    return sent


def _code(message) -> str:
    return re.match(r"(\d{6})", message["Subject"]).group(1)


def test_forgot_and_reset_password(client, owner, outbox):
    r = client.post("/api/auth/forgot", json={"email": owner.email.upper()})
    assert r.status_code == 200, r.text
    assert len(outbox) == 1 and outbox[0]["To"] == owner.email
    code = _code(outbox[0])
    html = outbox[0].get_body(("html",)).get_content()
    assert code[0] in html and "Код для нового пароля" in html

    # Повторно сразу — нельзя (раз в минуту)
    assert client.post("/api/auth/forgot", json={"email": owner.email}).status_code == 400

    bad = "000000" if code != "000000" else "111111"
    assert client.post("/api/auth/reset", json={"email": owner.email, "code": bad, "password": "brandnew123"}).status_code == 400

    r = client.post("/api/auth/reset", json={"email": owner.email, "code": code, "password": "brandnew123"})
    assert r.status_code == 200, r.text
    assert client.get("/api/auth/me", headers={"Authorization": f"Bearer {r.json()['access_token']}"}).status_code == 200
    assert "Пароль в CRM" in outbox[-1]["Subject"]
    # Код одноразовый
    assert client.post("/api/auth/reset", json={"email": owner.email, "code": code, "password": "other12345"}).status_code == 400
    assert client.post("/api/auth/login", json={"email": owner.email, "password": "brandnew123"}).status_code == 200


def test_unknown_email_looks_the_same(client, outbox):
    r = client.post("/api/auth/forgot", json={"email": "nobody@nowhere.ru"})
    assert r.status_code == 200 and r.json() == {"sent": True}
    assert outbox == []


def test_code_burns_after_five_mistakes(client, owner, outbox):
    client.post("/api/auth/forgot", json={"email": owner.email})
    code = _code(outbox[0])
    bad = "000000" if code != "000000" else "111111"
    for _ in range(5):
        client.post("/api/auth/reset", json={"email": owner.email, "code": bad, "password": "brandnew123"})
    assert client.post("/api/auth/reset", json={"email": owner.email, "code": code, "password": "brandnew123"}).status_code == 400


def test_old_sessions_die_after_password_change(client, owner, auth_headers, db):

    from app.db import utcnow
    from datetime import timedelta

    assert client.get("/api/auth/me", headers=auth_headers).status_code == 200
    owner.password_changed_at = utcnow() + timedelta(seconds=2)
    db.commit()
    assert client.get("/api/auth/me", headers=auth_headers).status_code == 401


def test_forgot_without_mail_says_so(client, owner):
    r = client.post("/api/auth/forgot", json={"email": owner.email})
    assert r.status_code == 400 and "не подключена" in r.json()["message"]
