"""CLI станции установки: python -m station <команда>."""

from __future__ import annotations

import getpass
import json
import logging
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Optional

import typer
from rich.console import Console
from rich.progress import BarColumn, Progress, TextColumn
from rich.table import Table

from . import config, device
from .ipatool import Ipatool, IpatoolError

app = typer.Typer(add_completion=False, no_args_is_help=True, pretty_exceptions_enable=False,
                  help="Станция установки iOS-приложений iBlackMaster")
console = Console()
state = {"debug": False}


def _setup_logging(settings: config.Settings, debug: bool) -> None:
    handler = RotatingFileHandler(settings.log_dir / "agent.log", maxBytes=2_000_000,
                                  backupCount=5, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(logging.DEBUG if debug else logging.INFO)


def _fail(exc: Exception) -> None:
    logging.getLogger("station").exception("command failed")
    if state["debug"]:
        raise exc
    code = getattr(exc, "code", "ERROR")
    console.print(f"[bold red]{code}[/]: {exc}")
    raise typer.Exit(getattr(exc, "exit_code", 1))


@app.callback()
def main(debug: bool = typer.Option(False, "--debug", help="Показывать трейсбеки")) -> None:
    state["debug"] = debug
    _setup_logging(config.load(), debug)


@app.command()
def devices() -> None:
    """Подключённые по USB айфоны."""
    try:
        found = device.list_devices()
    except device.DeviceError as exc:
        _fail(exc)
    if not found:
        console.print("Айфонов не видно. Проверьте кабель и что телефон разблокирован.")
        return
    table = Table("UDID", "Имя", "Модель", "iOS", "Состояние")
    for d in found:
        table.add_row(d["udid"], d["name"] or "—", d["product_type"] or "—",
                      d["ios_version"] or "—", d["problem"] or "[green]готов[/]")
    console.print(table)


@app.command()
def scan(udid: str, json_out: Optional[Path] = typer.Option(None, "--json", help="Сохранить в JSON")) -> None:
    """Приложения на телефоне-доноре с их App Store ID."""
    try:
        apps = device.scan_apps(udid)
    except device.DeviceError as exc:
        _fail(exc)
    table = Table("Название", "Bundle ID", "Версия", "adamId", "versionId")
    for a in apps:
        if a["from_app_store"]:
            table.add_row(a["name"], a["bundle_id"], a["version"] or "—",
                          str(a["adam_id"]), str(a["version_id"] or "—"))
        else:
            table.add_row(a["name"], a["bundle_id"], a["version"] or "—", "[dim]не из App Store[/]", "")
    console.print(table)
    console.print(f"Всего: {len(apps)}, из App Store: {sum(a['from_app_store'] for a in apps)}")
    if json_out:
        json_out.write_text(json.dumps(apps, ensure_ascii=False, indent=2), encoding="utf-8")
        console.print(f"Сохранено в {json_out}")


@app.command("auth-login")
def auth_login(email: Optional[str] = typer.Option(None, "--email"),
               auth_code: Optional[str] = typer.Option(None, "--auth-code", help="6 цифр 2FA")) -> None:
    """Вход в Apple ID через ipatool (пароль спрашивается скрыто)."""
    settings = config.load()
    email = email or settings.apple_id_email or typer.prompt("Apple ID")
    password = getpass.getpass("Пароль Apple ID: ")
    try:
        info = Ipatool(settings).login(email, password, auth_code)
    except IpatoolError as exc:
        if exc.code == "AUTH_REQUIRED" and not auth_code:
            console.print("Apple прислал код на доверенное устройство. Повторите с [bold]--auth-code 123456[/]")
        _fail(exc)
    console.print(f"[green]Вход выполнен:[/] {info.get('name', '')} {info.get('email', '')}")


@app.command()
def purchases(page: int = typer.Option(1, "--page")) -> None:
    """Приложения из истории покупок Apple ID (включая снятые из App Store, если Apple их ещё отдаёт)."""
    try:
        data = Ipatool(config.load()).purchases(page=page)
    except IpatoolError as exc:
        _fail(exc)
    table = Table("adamId", "Название", "Bundle ID", "Версия")
    for a in data.get("apps", []):
        table.add_row(str(a.get("id")), a.get("name", ""), a.get("bundleID", ""), a.get("version", ""))
    console.print(table)
    console.print(f"Страница {data.get('page', page)}, всего приложений: {data.get('totalCount', '?')}")


@app.command()
def download(adam_id: int, version_id: Optional[int] = typer.Option(None, "--version-id"),
             force: bool = typer.Option(False, "--force", help="Скачать заново, игнорируя кэш")) -> None:
    """Скачать IPA под Apple ID (с кэшем)."""
    try:
        with console.status("Скачиваю у Apple…"):
            path, cached = Ipatool(config.load()).download(adam_id, version_id, force)
    except IpatoolError as exc:
        if exc.code == "AUTH_REQUIRED":
            console.print("Нужен вход: [bold]python -m station auth-login --auth-code КОД[/]")
        _fail(exc)
    size = path.stat().st_size / 1_048_576
    console.print(f"{'Из кэша' if cached else 'Скачано'}: {path} ({size:.1f} МБ)")


@app.command()
def install(udid: str, ipa: Path) -> None:
    """Установить IPA на подключённый телефон."""
    try:
        with Progress(TextColumn("Установка"), BarColumn(), TextColumn("{task.percentage:>3.0f}%"),
                      console=console) as bar:
            task = bar.add_task("install", total=100)
            device.install_ipa(udid, ipa, progress=lambda p: bar.update(task, completed=p))
            bar.update(task, completed=100)
    except device.DeviceError as exc:
        _fail(exc)
    console.print("[green]Готово.[/] Чтобы приложение запустилось, на телефоне в App Store "
                  "должен быть вход в тот же Apple ID, под которым оно скачано.")


@app.command()
def transfer(adam_id: int, target_udid: str,
             version_id: Optional[int] = typer.Option(None, "--version-id")) -> None:
    """Скачать и сразу поставить: transfer <adamId> <UDID нового телефона>."""
    download(adam_id, version_id, False)
    install(target_udid, Ipatool(config.load()).cached_path(adam_id, version_id))


def entry() -> None:
    # Сборка без окна (Windows): stdout нет — пишем вывод в файл, иначе rich упадёт
    if sys.stdout is None or sys.stderr is None:
        (config.data_dir() / "logs").mkdir(exist_ok=True)
        stream = open(config.data_dir() / "logs" / "console.log", "a", encoding="utf-8")  # noqa: SIM115
        sys.stdout = sys.stdout or stream
        sys.stderr = sys.stderr or stream
    if sys.platform == "win32":
        try:
            sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001
            pass
    app()


# ---------------------------------------------------------------- режим помощника


@app.command()
def connect(code: str = typer.Argument(..., help="Код подключения из CRM (раздел «Приложения»)")) -> None:
    """Подключить станцию к CRM по коду подключения."""
    from .agent import Crm, CrmError

    try:
        url, token = config.parse_connection_code(code)
    except ValueError as exc:
        console.print(f"[red]{exc}[/]")
        raise typer.Exit(1)
    try:
        answer = Crm(url, token).post("/heartbeat", {"os": config.os_name(), "agent_version": config.VERSION})
    except CrmError as exc:
        console.print(f"[red]Не удалось связаться с CRM:[/] {exc}")
        raise typer.Exit(2)
    config.write_config({"crm_url": url, "station_token": token})
    console.print(f"[green]Готово.[/] Станция «{answer.get('station', '')}» подключена к {url}")


def _single_instance():
    """Второй помощник на том же компьютере не нужен: занимаем локальный порт как замок."""
    import socket

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind(("127.0.0.1", 47811))
    except OSError:
        sock.close()
        return None
    return sock


@app.command("run")
def run_agent() -> None:
    """Работать помощником: держать связь с CRM и выполнять задачи (запускается автоматически)."""
    from .agent import Agent

    settings = config.load()
    guard = _single_instance()
    if guard is None:
        console.print("Помощник уже запущен")
        raise typer.Exit(0)
    if sys.stdout and sys.stdout.isatty():
        logging.getLogger().addHandler(logging.StreamHandler())
    try:
        Agent(settings).run()
    except KeyboardInterrupt:
        pass


@app.command()
def status() -> None:
    """Куда подключена станция и вошли ли в Apple ID."""
    settings = config.load()
    console.print(f"CRM: {settings.crm_url or '[red]не подключена[/]'}")
    console.print(f"ipatool: {settings.ipatool_path or '[red]не найден[/]'}")
    console.print(f"Данные: {config.data_dir()}")
    try:
        info = Ipatool(settings).info()
        console.print(f"Apple ID: [green]{info.get('email', 'вход выполнен')}[/]")
    except IpatoolError as exc:
        console.print(f"Apple ID: [yellow]нужен вход[/] ({exc})")


@app.command()
def autostart(enable: bool = typer.Option(True, "--enable/--disable")) -> None:
    """macOS: запускать помощника при входе в систему (на Windows это делает установщик)."""
    if sys.platform != "darwin":
        console.print("На Windows автозапуск настраивает установщик.")
        raise typer.Exit(1)
    import plistlib
    import subprocess

    label = "ru.iblackmaster.station"
    plist = Path.home() / "Library" / "LaunchAgents" / f"{label}.plist"
    if not enable:
        subprocess.run(["launchctl", "unload", str(plist)], check=False)
        plist.unlink(missing_ok=True)
        console.print("Автозапуск выключен")
        return
    program = [sys.executable, "run"] if getattr(sys, "frozen", False) else [sys.executable, "-m", "station", "run"]
    plist.parent.mkdir(parents=True, exist_ok=True)
    plist.write_bytes(plistlib.dumps({
        "Label": label,
        "ProgramArguments": program,
        "WorkingDirectory": str(config.app_dir()),
        "RunAtLoad": True,
        "KeepAlive": True,
        "StandardOutPath": str(config.data_dir() / "logs" / "launchd.log"),
        "StandardErrorPath": str(config.data_dir() / "logs" / "launchd.log"),
    }))
    subprocess.run(["launchctl", "unload", str(plist)], check=False, capture_output=True)
    subprocess.run(["launchctl", "load", str(plist)], check=False)
    console.print(f"[green]Помощник будет запускаться сам.[/] Файл: {plist}")
