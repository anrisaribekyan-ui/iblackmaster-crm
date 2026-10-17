"""Письма сотрудникам: коды сброса пароля и уведомления о входе в аккаунт.

Отправка через обычный SMTP (Яндекс 360, Mail.ru для бизнеса, свой почтовый сервер).
Письмо уходит в фоновом потоке — экран не ждёт почтовый сервер. Без настроек SMTP ничего не отправляется,
а интерфейс честно говорит «почта не подключена».
"""

import html
import logging
import smtplib
import ssl
import threading
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from pathlib import Path

from app.config import settings

log = logging.getLogger("mail")
TEMPLATES = Path(__file__).resolve().parent.parent / "templates" / "email"


def configured() -> bool:
    return bool(settings.smtp_host and settings.smtp_user and settings.smtp_password)


def sender() -> str:
    return settings.mail_from or settings.smtp_user


def render(template_name: str, **values: str) -> tuple[str, str]:
    """Шаблон письма → (html, текст). Значения экранируются; {{raw:key}} — без экранирования (готовый HTML)."""
    layout = (TEMPLATES / "layout.html").read_text(encoding="utf-8")
    body = (TEMPLATES / f"{template_name}.html").read_text(encoding="utf-8")
    text = (TEMPLATES / f"{template_name}.txt").read_text(encoding="utf-8")
    page = layout.replace("{{raw:body}}", body)
    values = {"public_url": settings.public_url.rstrip("/"), **values}
    for key, value in values.items():
        page = page.replace("{{" + key + "}}", html.escape(str(value)))
        text = text.replace("{{" + key + "}}", str(value))
    return page, text


def _deliver(message: EmailMessage) -> None:
    context = ssl.create_default_context()
    if settings.smtp_port == 465:
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, context=context, timeout=20) as smtp:
            smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(message)
    else:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
            smtp.starttls(context=context)
            smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(message)


def build(to: str, subject: str, template: str, **values: str) -> EmailMessage:
    page, text = render(template, subject=subject, **values)
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = formataddr((settings.mail_from_name, sender()))
    message["To"] = to
    message["Message-ID"] = make_msgid(domain=sender().split("@")[-1] or "iblackmaster")
    message.set_content(text)
    message.add_alternative(page, subtype="html")
    return message


def send(to: str, subject: str, template: str, *, wait: bool = False, **values: str) -> bool:
    """Отправить письмо. По умолчанию — в фоне; wait=True — дождаться ответа сервера (тестовое письмо)."""
    if not configured():
        log.info("SMTP не настроен, письмо «%s» для %s не отправлено", subject, to)
        return False
    message = build(to, subject, template, **values)
    if wait:
        _deliver(message)
        return True

    def run() -> None:
        try:
            _deliver(message)
        except Exception:  # noqa: BLE001 — письмо не должно ронять приложение
            log.exception("Не удалось отправить письмо «%s» для %s", subject, to)

    threading.Thread(target=run, daemon=True).start()
    return True
