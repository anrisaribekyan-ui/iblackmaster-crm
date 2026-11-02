"""Почта для писем сотрудникам: подключена ли и проверочное письмо."""

import smtplib

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.api.deps import CurrentEmployee, require
from app.config import settings
from app.errors import BusinessError
from app.services import mail

router = APIRouter(prefix="/settings/mail", tags=["Почта"], dependencies=[Depends(require("settingAccess"))])


@router.get("")
def mail_status():
    return {"configured": mail.configured(), "sender": mail.sender() if mail.configured() else None, "host": settings.smtp_host or None}


class TestIn(BaseModel):
    to: str | None = Field(default=None, max_length=200)  # на какой адрес; пусто — на почту владельца запроса


@router.post("/test")
def mail_test(me: CurrentEmployee, data: TestIn | None = None):
    if not mail.configured():
        raise BusinessError("Почта не подключена: впишите SMTP_HOST, SMTP_USER и SMTP_PASSWORD в .env на сервере")
    try:
        to = ((data.to if data else None) or me.email).strip()
        if "@" not in to or " " in to:
            raise BusinessError("Адрес указан неверно")
        mail.send(to, "Проверка почты CRM iBlackMaster", "test", wait=True, name=(me.name or me.short_name).split()[0])
    except smtplib.SMTPAuthenticationError:
        raise BusinessError("Почтовый сервер не принял логин или пароль. Для Яндекса и Mail.ru нужен пароль приложения, а не обычный")
    except (smtplib.SMTPException, OSError) as exc:
        raise BusinessError(f"Не удалось отправить: {exc}")
    return {"sent_to": to}
