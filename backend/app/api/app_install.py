"""Установка iOS-приложений через станции. Пишет и меняет только Claude.

Две стороны:
- сотрудники CRM (обычный вход, права appInstallAccess / appInstallStationAccess):
  станции, библиотека приложений, задачи «скан / покупки / вход / установка»;
- помощник на станции (заголовок X-Station-Token): сообщает подключённые телефоны,
  забирает задачи, присылает прогресс и результат.

Пароль Apple ID и код 2FA проходят через задачу (поле secret) и стираются,
как только помощник их забрал. Сам токен станции в БД не хранится, только sha256.
"""

import hashlib
import json
import plistlib
import zipfile
import re
import secrets
from pathlib import Path
from datetime import datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, Header, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_, select

from app.api.deps import CurrentEmployee, DbSession, require
from app.config import settings
from app.db import utcnow
from app.errors import BusinessError, NotFound
from app.models import AppInstallJob, Employee, InstallStation, IosApp, JobKind, JobState, Location

router = APIRouter(prefix="/app-install", tags=["Установка приложений"])

ONLINE_SECONDS = 45  # помощник шлёт пульс раз в ~10 с
# Задача без вестей от станции дольше этого — станция её потеряла (перезапуск, сменили код, выключили)
STALE_MINUTES = {JobKind.INSTALL: 30}  # скачивание большого приложения идёт молча
STALE_DEFAULT_MINUTES = 10
CODE_WAIT_MINUTES = 15  # помощник помнит пароль Apple ID до ввода кода не дольше этого
CODE_RE = re.compile(r"^\d{6}$")


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _new_token() -> str:
    return "st_" + secrets.token_urlsafe(32)


def _is_online(station: InstallStation, now: datetime | None = None) -> bool:
    if station.last_seen_at is None:
        return False
    return (now or utcnow()) - station.last_seen_at <= timedelta(seconds=ONLINE_SECONDS)


# ---------------------------------------------------------------- схемы


class DeviceInfo(BaseModel):
    udid: str = Field(max_length=64)
    name: str | None = Field(default=None, max_length=100)
    product_type: str | None = Field(default=None, max_length=40)
    ios_version: str | None = Field(default=None, max_length=20)
    paired: bool = False
    problem: str | None = Field(default=None, max_length=300)


class StationOut(BaseModel):
    id: int
    name: str
    location_id: int | None
    location_name: str | None
    online: bool
    last_seen_at: datetime | None
    os: str | None
    agent_version: str | None
    devices: list[DeviceInfo]
    apple_id: str | None
    apple_auth: str


class StationIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    location_id: int | None = None


class StationCreated(BaseModel):
    station: StationOut
    token: str


class AppOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    adam_id: int
    bundle_id: str
    name: str
    version: str | None
    version_id: int | None
    source: str
    ipa_size: int | None = None
    ipa_version: str | None = None
    ipa_apple_id: str | None = None
    ipa_uploaded_at: datetime | None = None


class JobOut(BaseModel):
    id: int
    station_id: int
    station_name: str
    kind: str
    app: AppOut | None
    target_udid: str | None
    target_name: str | None
    order_id: int | None
    state: str
    progress: int
    message: str | None
    error_code: str | None
    email: str | None
    code_sent: bool  # код 2FA введён и ждёт, пока станция его заберёт
    created_at: datetime
    finished_at: datetime | None
    created_by_name: str | None


class JobIn(BaseModel):
    station_id: int
    kind: Literal["scan", "purchases", "login", "install"]
    app_id: int | None = None
    target_udid: str | None = Field(default=None, max_length=64)
    order_id: int | None = None
    email: str | None = Field(default=None, max_length=200)
    password: str | None = Field(default=None, max_length=200)


class CodeIn(BaseModel):
    code: str


# ---------------------------------------------------------------- преобразования


def _station_out(db, station: InstallStation, now: datetime | None = None) -> StationOut:
    location = db.get(Location, station.location_id) if station.location_id else None
    return StationOut(
        id=station.id,
        name=station.name,
        location_id=station.location_id,
        location_name=location.name if location else None,
        online=_is_online(station, now),
        last_seen_at=station.last_seen_at,
        os=station.os,
        agent_version=station.agent_version,
        devices=[DeviceInfo(**d) for d in (station.devices or [])] if _is_online(station, now) else [],
        apple_id=station.apple_id,
        apple_auth=station.apple_auth,
    )


def _job_out(db, job: AppInstallJob) -> JobOut:
    author = db.get(Employee, job.created_by_id) if job.created_by_id else None
    return JobOut(
        id=job.id,
        station_id=job.station_id,
        station_name=job.station.name,
        kind=job.kind,
        app=AppOut.model_validate(job.app) if job.app else None,
        target_udid=job.target_udid,
        target_name=job.target_name,
        order_id=job.order_id,
        state=job.state,
        progress=job.progress,
        message=job.message,
        error_code=job.error_code,
        email=(job.payload or {}).get("email"),
        code_sent=job.state == JobState.NEED_CODE and job.secret is not None,
        created_at=job.created_at,
        finished_at=job.finished_at,
        created_by_name=author.name if author else None,
    )


def _expire_stale(db) -> None:
    """Зависшие задачи закрываем сами, чтобы не висели «Выполняется» вечно."""
    now = utcnow()
    open_jobs = db.scalars(
        select(AppInstallJob).where(AppInstallJob.state.in_((JobState.RUNNING, JobState.NEED_CODE)))
    ).all()
    changed = False
    for job in open_jobs:
        idle = now - job.updated_at
        if job.state == JobState.NEED_CODE and job.secret is None and idle > timedelta(minutes=CODE_WAIT_MINUTES):
            job.state, job.error_code = JobState.FAILED, "CODE_TIMEOUT"
            job.message = "Код от Apple не ввели вовремя. Начните вход заново."
        elif job.state == JobState.RUNNING and idle > timedelta(minutes=STALE_MINUTES.get(job.kind, STALE_DEFAULT_MINUTES)):
            job.state, job.error_code = JobState.FAILED, "STALE"
            job.message = "Станция перестала отвечать по этой задаче. Проверьте, что она на связи, и повторите."
        else:
            continue
        job.secret, job.finished_at = None, now
        changed = True
    if changed:
        db.commit()


def _get_station(db, station_id: int) -> InstallStation:
    station = db.get(InstallStation, station_id)
    if station is None or not station.is_active:
        raise NotFound("Станция")
    return station


# ---------------------------------------------------------------- станции (сотрудники)

use_access = [Depends(require("appInstallAccess"))]
station_access = [Depends(require("appInstallAccess", "appInstallStationAccess"))]


@router.get("/stations", response_model=list[StationOut], dependencies=use_access)
def list_stations(db: DbSession):
    now = utcnow()
    rows = db.scalars(select(InstallStation).where(InstallStation.is_active.is_(True)).order_by(InstallStation.name))
    return [_station_out(db, s, now) for s in rows]


@router.post("/stations", response_model=StationCreated, dependencies=station_access)
def create_station(data: StationIn, db: DbSession):
    if data.location_id is not None and db.get(Location, data.location_id) is None:
        raise NotFound("Точка")
    token = _new_token()
    station = InstallStation(name=data.name.strip(), location_id=data.location_id, token_hash=_hash(token))
    db.add(station)
    db.commit()
    return StationCreated(station=_station_out(db, station), token=token)


@router.post("/stations/{station_id}/token", response_model=StationCreated, dependencies=station_access)
def regenerate_token(station_id: int, db: DbSession):
    station = _get_station(db, station_id)
    token = _new_token()
    station.token_hash = _hash(token)
    db.commit()
    return StationCreated(station=_station_out(db, station), token=token)


@router.delete("/stations/{station_id}", status_code=204, dependencies=station_access)
def delete_station(station_id: int, db: DbSession):
    station = _get_station(db, station_id)
    station.is_active = False
    station.token_hash = _hash(_new_token())  # старый токен перестаёт работать
    for job in db.scalars(
        select(AppInstallJob).where(AppInstallJob.station_id == station.id, AppInstallJob.state.in_(JobState.OPEN))
    ):
        job.state, job.secret, job.finished_at = JobState.CANCELLED, None, utcnow()
    db.commit()


# ---------------------------------------------------------------- библиотека


@router.get("/apps", response_model=list[AppOut], dependencies=use_access)
def list_apps(db: DbSession, q: str | None = None):
    query = select(IosApp).where(IosApp.is_active.is_(True)).order_by(IosApp.name)
    if q and q.strip():
        like = f"%{q.strip()}%"
        query = query.where(or_(IosApp.name.ilike(like), IosApp.bundle_id.ilike(like)))
    return db.scalars(query.limit(500)).all()


@router.delete("/apps/{app_id}", status_code=204, dependencies=use_access)
def hide_app(app_id: int, db: DbSession):
    item = db.get(IosApp, app_id)
    if item is None:
        raise NotFound("Приложение")
    item.is_active = False
    db.commit()


# ---------------------------------------------------------------- задачи (сотрудники)


@router.get("/jobs", response_model=list[JobOut], dependencies=use_access)
def list_jobs(db: DbSession, station_id: int | None = None, limit: int = 30):
    _expire_stale(db)
    query = select(AppInstallJob).order_by(AppInstallJob.id.desc()).limit(min(max(limit, 1), 100))
    if station_id is not None:
        query = query.where(AppInstallJob.station_id == station_id)
    return [_job_out(db, j) for j in db.scalars(query)]


@router.post("/jobs", response_model=JobOut, dependencies=use_access)
def create_job(data: JobIn, db: DbSession, me: CurrentEmployee):
    station = _get_station(db, data.station_id)
    _expire_stale(db)
    if not _is_online(station):
        raise BusinessError("Станция не на связи: проверьте, что компьютер включён и помощник запущен")

    if data.kind == JobKind.LOGIN:
        # Вход в Apple ID — только с правом на станции
        require("appInstallStationAccess")(me)

    devices = {d["udid"]: d for d in (station.devices or [])}
    job = AppInstallJob(station_id=station.id, kind=data.kind, created_by_id=me.id, payload={})

    if data.kind in (JobKind.SCAN, JobKind.INSTALL):
        device = devices.get(data.target_udid or "")
        if device is None:
            raise BusinessError("Этот телефон сейчас не подключён к станции")
        if not device.get("paired"):
            raise BusinessError("Телефон не доверяет компьютеру: разблокируйте его и нажмите «Доверять»")
        job.target_udid = data.target_udid
        job.target_name = device.get("name") or device.get("product_type")

    if data.kind == JobKind.INSTALL:
        app_item = db.get(IosApp, data.app_id) if data.app_id else None
        if app_item is None or not app_item.is_active:
            raise NotFound("Приложение")
        job.app_id = app_item.id
        job.order_id = data.order_id

    if data.kind == JobKind.LOGIN:
        email = (data.email or "").strip()
        if not email or not data.password:
            raise BusinessError("Укажите Apple ID и пароль")
        job.payload = {"email": email}
        job.secret = data.password

    same = [
        AppInstallJob.station_id == station.id,
        AppInstallJob.kind == data.kind,
        AppInstallJob.state.in_(JobState.OPEN),
    ]
    if job.target_udid:
        same.append(AppInstallJob.target_udid == job.target_udid)
    if job.app_id:
        same.append(AppInstallJob.app_id == job.app_id)
    if db.scalar(select(AppInstallJob.id).where(*same).limit(1)):
        raise BusinessError("Такая задача уже выполняется")

    db.add(job)
    db.commit()
    return _job_out(db, job)


def _open_job(db, job_id: int) -> AppInstallJob:
    job = db.get(AppInstallJob, job_id)
    if job is None:
        raise NotFound("Задача")
    return job


@router.post("/jobs/{job_id}/code", response_model=JobOut, dependencies=station_access)
def send_code(job_id: int, data: CodeIn, db: DbSession):
    job = _open_job(db, job_id)
    if job.state != JobState.NEED_CODE:
        raise BusinessError("Эта задача сейчас не ждёт код")
    code = re.sub(r"\D", "", data.code)
    if not CODE_RE.match(code):
        raise BusinessError("Код из Apple — 6 цифр")
    job.secret = code
    job.message = "Код отправлен на станцию, проверяю…"
    db.commit()
    return _job_out(db, job)


@router.post("/jobs/{job_id}/cancel", response_model=JobOut, dependencies=use_access)
def cancel_job(job_id: int, db: DbSession):
    job = _open_job(db, job_id)
    if job.state not in JobState.OPEN:
        raise BusinessError("Задача уже завершена")
    if job.state == JobState.RUNNING and job.kind == JobKind.INSTALL and job.progress >= 40:
        raise BusinessError("Установку уже не остановить, дождитесь окончания")
    job.state, job.secret, job.finished_at = JobState.CANCELLED, None, utcnow()
    job.message = "Отменено"
    db.commit()
    return _job_out(db, job)


@router.post("/jobs/{job_id}/retry", response_model=JobOut, dependencies=use_access)
def retry_job(job_id: int, db: DbSession, me: CurrentEmployee):
    job = _open_job(db, job_id)
    if job.kind == JobKind.LOGIN:
        raise BusinessError("Вход повторите заново: пароль не сохраняется")
    if job.state not in (JobState.FAILED, JobState.CANCELLED):
        raise BusinessError("Повторить можно только неудачную или отменённую задачу")
    return create_job(
        JobIn(station_id=job.station_id, kind=job.kind, app_id=job.app_id, target_udid=job.target_udid, order_id=job.order_id),
        db,
        me,
    )


# ---------------------------------------------------------------- помощник станции


def get_station_by_token(
    db: DbSession, x_station_token: Annotated[str | None, Header()] = None
) -> InstallStation:
    if not x_station_token:
        raise BusinessError("Нет токена станции", code="unauthorized")
    station = db.scalar(select(InstallStation).where(InstallStation.token_hash == _hash(x_station_token)))
    if station is None or not station.is_active:
        raise BusinessError("Токен станции не подходит", code="unauthorized")
    return station


AgentStation = Annotated[InstallStation, Depends(get_station_by_token)]


class HeartbeatIn(BaseModel):
    os: str | None = Field(default=None, max_length=20)
    agent_version: str | None = Field(default=None, max_length=20)
    devices: list[DeviceInfo] = Field(default_factory=list, max_length=50)
    apple_id: str | None = Field(default=None, max_length=200)
    apple_auth: Literal["ok", "needed", "unknown"] = "unknown"


class AgentJob(BaseModel):
    id: int
    kind: str
    target_udid: str | None
    adam_id: int | None
    version_id: int | None
    bundle_id: str | None
    app_name: str | None
    email: str | None
    secret: str | None  # пароль (login) или код 2FA (продолжение login)
    app_id: int | None = None
    ipa_in_crm: bool = False  # файл есть в архиве CRM — качать у Apple не нужно
    ipa_size: int | None = None


class AppReport(BaseModel):
    adam_id: int = Field(gt=0)
    bundle_id: str = Field(max_length=200)
    name: str = Field(max_length=200)
    version: str | None = Field(default=None, max_length=50)
    version_id: int | None = None


class ReportIn(BaseModel):
    state: Literal["running", "need_code", "done", "failed"] | None = None
    progress: int | None = Field(default=None, ge=0, le=100)
    message: str | None = Field(default=None, max_length=2000)
    error_code: str | None = Field(default=None, max_length=30)
    apps: list[AppReport] | None = Field(default=None, max_length=2000)
    apple_id: str | None = Field(default=None, max_length=200)


@router.post("/agent/heartbeat")
def agent_heartbeat(data: HeartbeatIn, db: DbSession, station: AgentStation):
    station.last_seen_at = utcnow()
    station.os = data.os
    station.agent_version = data.agent_version
    station.devices = [d.model_dump() for d in data.devices]
    station.apple_id = data.apple_id or station.apple_id
    if data.apple_auth != "unknown":
        station.apple_auth = data.apple_auth
    db.commit()
    return {"ok": True, "station": station.name}


@router.post("/agent/next", response_model=AgentJob | None)
def agent_next(db: DbSession, station: AgentStation):
    """Следующая задача станции. Секрет отдаётся один раз и сразу стирается."""
    station.last_seen_at = utcnow()
    job = db.scalars(
        select(AppInstallJob)
        .where(
            AppInstallJob.station_id == station.id,
            or_(
                AppInstallJob.state == JobState.QUEUED,
                (AppInstallJob.state == JobState.NEED_CODE) & AppInstallJob.secret.is_not(None),
            ),
        )
        .order_by(AppInstallJob.id)
        .limit(1)
    ).first()
    if job is None:
        db.commit()
        return None
    secret, job.secret = job.secret, None
    if job.state == JobState.QUEUED:
        job.started_at = utcnow()
    job.state = JobState.RUNNING
    db.commit()
    app_item = job.app
    return AgentJob(
        id=job.id,
        kind=job.kind,
        target_udid=job.target_udid,
        adam_id=app_item.adam_id if app_item else None,
        version_id=app_item.version_id if app_item else None,
        bundle_id=app_item.bundle_id if app_item else None,
        app_name=app_item.name if app_item else None,
        email=(job.payload or {}).get("email"),
        secret=secret,
        app_id=app_item.id if app_item else None,
        ipa_in_crm=bool(app_item and _ipa_exists(app_item)),
        ipa_size=app_item.ipa_size if app_item else None,
    )


def _upsert_apps(db, apps: list[AppReport], source: str) -> int:
    known = {a.adam_id: a for a in db.scalars(select(IosApp).where(IosApp.adam_id.in_([x.adam_id for x in apps])))}
    for item in apps:
        row = known.get(item.adam_id)
        if row is None:
            row = IosApp(adam_id=item.adam_id, source=source)
            db.add(row)
            known[item.adam_id] = row
        row.bundle_id, row.name, row.is_active = item.bundle_id, item.name, True
        # Версию с донора помним точной: именно её и надо поставить. Покупки дают только «последнюю».
        if source == "scan" or row.version_id is None:
            row.version, row.version_id = item.version, item.version_id
    return len(apps)


@router.post("/agent/jobs/{job_id}")
def agent_report(job_id: int, data: ReportIn, db: DbSession, station: AgentStation):
    job = db.get(AppInstallJob, job_id)
    if job is None or job.station_id != station.id:
        raise NotFound("Задача")
    station.last_seen_at = utcnow()
    job.updated_at = utcnow()  # любая весть от станции = задача жива
    if job.state == JobState.CANCELLED:
        db.commit()
        return {"ok": True, "cancelled": True}

    if data.progress is not None:
        job.progress = data.progress
    if data.message is not None:
        job.message = data.message
    if data.error_code is not None:
        job.error_code = data.error_code
    if data.apps:
        _upsert_apps(db, data.apps, "scan" if job.kind == JobKind.SCAN else "purchases")
    if data.state is not None:
        job.state = data.state
        if data.state in (JobState.DONE, JobState.FAILED):
            job.finished_at = utcnow()
            job.secret = None
            if data.state == JobState.DONE:
                job.progress = 100
    # Состояние входа в Apple ID на станции
    if job.kind == JobKind.LOGIN and data.state == JobState.DONE:
        station.apple_auth = "ok"
        station.apple_id = data.apple_id or (job.payload or {}).get("email")
    if data.error_code == "AUTH_REQUIRED":
        station.apple_auth = "needed"
    db.commit()
    return {"ok": True, "cancelled": False}


# ---------------------------------------------------------------- установщики помощника
# Хранятся в uploads/station-agent: один файл на систему + meta.json (версия, размер, дата).
# Скачивание без входа: в установщике нет секретов, подключение даёт только код из CRM.

AGENT_FILES = {
    "windows": {"name": "iBlackMasterStation-Setup.exe", "title": "Windows", "ext": (".exe",)},
    "macos": {"name": "iBlackMasterStation-Mac.zip", "title": "Mac", "ext": (".zip",)},
}
AGENT_MAX_SIZE = 400 * 1024 * 1024
VERSION_RE = re.compile(r"^[0-9][0-9A-Za-z.\-]{0,19}$")


def _agent_dir() -> Path:
    root = Path(settings.uploads_dir) / "station-agent"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _agent_meta() -> dict:
    try:
        return json.loads((_agent_dir() / "meta.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


class AgentFileOut(BaseModel):
    platform: str
    title: str
    available: bool
    filename: str
    size: int | None = None
    version: str | None = None
    uploaded_at: datetime | None = None


def _agent_files() -> list[AgentFileOut]:
    meta = _agent_meta()
    out = []
    for platform, info in AGENT_FILES.items():
        path = _agent_dir() / info["name"]
        m = meta.get(platform) or {}
        out.append(AgentFileOut(
            platform=platform,
            title=info["title"],
            available=path.is_file(),
            filename=info["name"],
            size=path.stat().st_size if path.is_file() else None,
            version=m.get("version"),
            uploaded_at=m.get("uploaded_at"),
        ))
    return out


@router.get("/agent-files", response_model=list[AgentFileOut])
def list_agent_files():
    return _agent_files()


@router.get("/agent-files/{platform}")
def download_agent_file(platform: str):
    info = AGENT_FILES.get(platform)
    path = _agent_dir() / info["name"] if info else None
    if path is None or not path.is_file():
        raise NotFound("Установщик")
    return FileResponse(path, media_type="application/octet-stream", filename=info["name"],
                        headers={"Cache-Control": "no-cache"})


@router.post("/agent-files/{platform}", response_model=list[AgentFileOut], dependencies=station_access)
async def upload_agent_file(platform: str, file: UploadFile = File(...), version: str = Form("")):
    info = AGENT_FILES.get(platform)
    if info is None:
        raise NotFound("Система")
    name = (file.filename or "").lower()
    if not name.endswith(info["ext"]):
        raise BusinessError(f"Для {info['title']} нужен файл {info['name']}")
    version = version.strip()
    if version and not VERSION_RE.match(version):
        raise BusinessError("Версия — например 1.0.0")

    target = _agent_dir() / info["name"]
    tmp = target.with_suffix(target.suffix + ".part")
    size = 0
    head = b""
    try:
        with tmp.open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                if not head:
                    head = chunk[:4]
                size += len(chunk)
                if size > AGENT_MAX_SIZE:
                    raise BusinessError("Файл больше 400 МБ — это точно установщик?")
                out.write(chunk)
        expected = b"MZ" if platform == "windows" else b"PK"
        if not head.startswith(expected):
            raise BusinessError(f"Это не {info['name']}: файл повреждён или другого типа")
        tmp.replace(target)
    finally:
        tmp.unlink(missing_ok=True)

    meta = _agent_meta()
    meta[platform] = {"version": version or None, "uploaded_at": utcnow().isoformat()}
    (_agent_dir() / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
    return _agent_files()


# ---------------------------------------------------------------- архив IPA в CRM
# Файл, однажды скачанный станцией (или загруженный вручную), хранится на сервере CRM.
# Дальше любая станция ставит его без донора и без Apple.

IPA_MAX_SIZE = 8 * 1024 * 1024 * 1024  # 8 ГБ — больше приложений в App Store почти нет


def _ipa_dir() -> Path:
    root = Path(settings.uploads_dir) / "ipa"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _ipa_path(app_item: IosApp) -> Path:
    return _ipa_dir() / f"{app_item.id}.ipa"


def _ipa_exists(app_item: IosApp) -> bool:
    return app_item.ipa_size is not None and _ipa_path(app_item).is_file()


def read_ipa_metadata(path: Path) -> dict:
    """Что внутри IPA: из iTunesMetadata.plist (App Store) и Payload/*.app/Info.plist."""
    try:
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
            meta: dict = {}
            if "iTunesMetadata.plist" in names:
                meta = plistlib.loads(z.read("iTunesMetadata.plist"))
            info_name = next((n for n in names if n.startswith("Payload/") and n.count("/") == 2
                              and n.endswith(".app/Info.plist")), None)
            info = plistlib.loads(z.read(info_name)) if info_name else {}
    except (zipfile.BadZipFile, plistlib.InvalidFileException, ValueError, KeyError) as exc:
        raise BusinessError("Это не файл приложения iPhone (.ipa) или он повреждён") from exc
    if not info:
        raise BusinessError("В файле нет приложения (папки Payload) — это точно .ipa?")
    account = meta.get("appleId") or (meta.get("com.apple.iTunesStore.downloadInfo") or {}).get("accountInfo", {}).get("AppleID")
    adam_id = meta.get("itemId")
    return {
        "adam_id": int(adam_id) if adam_id else None,
        "version_id": int(meta["softwareVersionExternalIdentifier"]) if meta.get("softwareVersionExternalIdentifier") else None,
        "bundle_id": info.get("CFBundleIdentifier") or meta.get("softwareVersionBundleId") or "",
        "name": meta.get("itemName") or info.get("CFBundleDisplayName") or info.get("CFBundleName") or "",
        "version": info.get("CFBundleShortVersionString") or meta.get("bundleShortVersionString"),
        "apple_id": account,
    }


async def _save_stream(chunks, target: Path) -> tuple[int, str]:
    tmp = target.with_suffix(".part")
    digest, size = hashlib.sha256(), 0
    try:
        with tmp.open("wb") as out:
            async for chunk in chunks:
                size += len(chunk)
                if size > IPA_MAX_SIZE:
                    raise BusinessError("Файл больше 8 ГБ")
                digest.update(chunk)
                out.write(chunk)
        if size < 1024:
            raise BusinessError("Файл пустой или оборван")
        tmp.replace(target)
    finally:
        tmp.unlink(missing_ok=True)
    return size, digest.hexdigest()


def _apply_ipa(app_item: IosApp, size: int, sha: str, meta: dict) -> None:
    app_item.ipa_size, app_item.ipa_sha256 = size, sha
    app_item.ipa_version = meta.get("version") or app_item.version
    app_item.ipa_apple_id = meta.get("apple_id")
    app_item.ipa_uploaded_at = utcnow()


@router.post("/agent/apps/{app_id}/ipa")
async def agent_upload_ipa(app_id: int, request: Request, db: DbSession, station: AgentStation):
    """Станция присылает скачанный у Apple файл (тело запроса = сам .ipa)."""
    app_item = db.get(IosApp, app_id)
    if app_item is None:
        raise NotFound("Приложение")
    target = _ipa_path(app_item)
    tmp = _ipa_dir() / f"{app_item.id}.incoming.ipa"
    size, sha = await _save_stream(request.stream(), tmp)
    try:
        meta = read_ipa_metadata(tmp)
        if meta["adam_id"] and meta["adam_id"] != app_item.adam_id:
            raise BusinessError("Файл от другого приложения")
        tmp.replace(target)
    finally:
        tmp.unlink(missing_ok=True)
    _apply_ipa(app_item, size, sha, meta)
    station.last_seen_at = utcnow()
    db.commit()
    return {"ok": True, "size": size}


@router.get("/agent/apps/{app_id}/ipa")
def agent_download_ipa(app_id: int, db: DbSession, station: AgentStation):
    app_item = db.get(IosApp, app_id)
    if app_item is None or not _ipa_exists(app_item):
        raise NotFound("Файл приложения в архиве")
    return FileResponse(_ipa_path(app_item), media_type="application/octet-stream",
                        headers={"X-Ipa-Sha256": app_item.ipa_sha256 or ""})


@router.post("/apps/upload", response_model=AppOut, dependencies=station_access)
async def upload_ipa(db: DbSession, file: UploadFile = File(...)):
    """Положить .ipa в архив вручную (например, сохранённый когда-то через iMazing)."""
    if not (file.filename or "").lower().endswith(".ipa"):
        raise BusinessError("Нужен файл .ipa")

    async def chunks():
        while chunk := await file.read(1024 * 1024):
            yield chunk

    tmp = _ipa_dir() / f"upload-{secrets.token_hex(8)}.ipa"
    size, sha = await _save_stream(chunks(), tmp)
    try:
        meta = read_ipa_metadata(tmp)
        if not meta["adam_id"]:
            raise BusinessError("В файле нет данных App Store (iTunesMetadata): такой IPA не поставить под Apple ID")
        app_item = db.scalar(select(IosApp).where(IosApp.adam_id == meta["adam_id"]))
        if app_item is None:
            app_item = IosApp(adam_id=meta["adam_id"], bundle_id=meta["bundle_id"], name=meta["name"] or meta["bundle_id"],
                              version=meta["version"], version_id=meta["version_id"], source="upload")
            db.add(app_item)
            db.flush()
        app_item.is_active = True
        if meta["version_id"]:
            app_item.version, app_item.version_id = meta["version"], meta["version_id"]
        tmp.replace(_ipa_path(app_item))
    finally:
        tmp.unlink(missing_ok=True)
    _apply_ipa(app_item, size, sha, meta)
    db.commit()
    return app_item


@router.get("/apps/{app_id}/ipa", dependencies=station_access)
def download_ipa(app_id: int, db: DbSession):
    app_item = db.get(IosApp, app_id)
    if app_item is None or not _ipa_exists(app_item):
        raise NotFound("Файл приложения в архиве")
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", app_item.bundle_id) or str(app_item.adam_id)
    return FileResponse(_ipa_path(app_item), media_type="application/octet-stream",
                        filename=f"{safe}_{app_item.ipa_version or ''}.ipa".replace("_.ipa", ".ipa"))
