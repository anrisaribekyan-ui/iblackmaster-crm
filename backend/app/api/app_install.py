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
import re
import secrets
from datetime import datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_, select

from app.api.deps import CurrentEmployee, DbSession, require
from app.db import utcnow
from app.errors import BusinessError, NotFound
from app.models import AppInstallJob, Employee, InstallStation, IosApp, JobKind, JobState, Location

router = APIRouter(prefix="/app-install", tags=["Установка приложений"])

ONLINE_SECONDS = 45  # помощник шлёт пульс раз в ~10 с
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
    query = select(AppInstallJob).order_by(AppInstallJob.id.desc()).limit(min(max(limit, 1), 100))
    if station_id is not None:
        query = query.where(AppInstallJob.station_id == station_id)
    return [_job_out(db, j) for j in db.scalars(query)]


@router.post("/jobs", response_model=JobOut, dependencies=use_access)
def create_job(data: JobIn, db: DbSession, me: CurrentEmployee):
    station = _get_station(db, data.station_id)
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
    if job.state == JobState.RUNNING and job.kind == JobKind.INSTALL:
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
