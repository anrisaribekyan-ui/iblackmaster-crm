"""Установка iOS-приложений: станции, помощник, задачи."""

from datetime import timedelta

from sqlalchemy import select

from app.db import utcnow
from app.models import AppInstallJob, InstallStation, IosApp
from tests.test_tasks import login, make_employee

DONOR = {"udid": "00008101-DONOR", "name": "Донор", "product_type": "iPhone13,2", "ios_version": "17.5", "paired": True}
TARGET = {"udid": "00008101-TARGET", "name": "Новый", "product_type": "iPhone15,2", "ios_version": "18.1", "paired": True}
LOCKED = {"udid": "00008101-LOCKED", "name": "Чужой", "paired": False, "problem": "Не доверяет"}


def make_station(client, headers, name="Сервис-Windows"):
    r = client.post("/api/app-install/stations", json={"name": name}, headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["token"].startswith("st_")
    return body["station"]["id"], {"X-Station-Token": body["token"]}


def beat(client, agent, devices=(DONOR, TARGET), **extra):
    r = client.post("/api/app-install/agent/heartbeat",
                    json={"os": "windows", "agent_version": "1.0.0", "devices": list(devices), **extra}, headers=agent)
    assert r.status_code == 200, r.text


def next_job(client, agent):
    r = client.post("/api/app-install/agent/next", headers=agent)
    assert r.status_code == 200, r.text
    return r.json()


def report(client, agent, job_id, **data):
    r = client.post(f"/api/app-install/agent/jobs/{job_id}", json=data, headers=agent)
    assert r.status_code == 200, r.text
    return r.json()


def test_station_token_and_heartbeat(client, auth_headers, db):
    station_id, agent = make_station(client, auth_headers)
    station = db.get(InstallStation, station_id)
    assert agent["X-Station-Token"] not in station.token_hash  # храним только хэш

    listed = client.get("/api/app-install/stations", headers=auth_headers).json()
    assert listed[0]["online"] is False and listed[0]["devices"] == []

    beat(client, agent)
    listed = client.get("/api/app-install/stations", headers=auth_headers).json()
    assert listed[0]["online"] is True
    assert [d["udid"] for d in listed[0]["devices"]] == [DONOR["udid"], TARGET["udid"]]

    bad = client.post("/api/app-install/agent/heartbeat", json={}, headers={"X-Station-Token": "st_wrong"})
    assert bad.status_code == 401
    assert client.post("/api/app-install/agent/heartbeat", json={}).status_code == 401

    # Новый токен — старый перестаёт работать
    r = client.post(f"/api/app-install/stations/{station_id}/token", headers=auth_headers)
    assert client.post("/api/app-install/agent/heartbeat", json={}, headers=agent).status_code == 401
    assert client.post("/api/app-install/agent/heartbeat", json={},
                       headers={"X-Station-Token": r.json()["token"]}).status_code == 200


def test_offline_station_rejects_jobs(client, auth_headers, db):
    station_id, agent = make_station(client, auth_headers)
    beat(client, agent)
    db.get(InstallStation, station_id).last_seen_at = utcnow() - timedelta(minutes=5)
    db.commit()
    r = client.post("/api/app-install/jobs", json={"station_id": station_id, "kind": "scan", "target_udid": DONOR["udid"]},
                    headers=auth_headers)
    assert r.status_code == 400 and "не на связи" in r.json()["message"]


def test_scan_then_install_flow(client, auth_headers, db):
    station_id, agent = make_station(client, auth_headers)
    beat(client, agent, devices=(DONOR, TARGET, LOCKED))

    # Телефон, которого нет, и телефон без доверия
    r = client.post("/api/app-install/jobs", json={"station_id": station_id, "kind": "scan", "target_udid": "nope"},
                    headers=auth_headers)
    assert r.status_code == 400
    r = client.post("/api/app-install/jobs", json={"station_id": station_id, "kind": "scan", "target_udid": LOCKED["udid"]},
                    headers=auth_headers)
    assert r.status_code == 400 and "Доверять" in r.json()["message"]

    r = client.post("/api/app-install/jobs", json={"station_id": station_id, "kind": "scan", "target_udid": DONOR["udid"]},
                    headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["target_name"] == "Донор"
    dup = client.post("/api/app-install/jobs", json={"station_id": station_id, "kind": "scan", "target_udid": DONOR["udid"]},
                      headers=auth_headers)
    assert dup.status_code == 400

    job = next_job(client, agent)
    assert job["kind"] == "scan" and job["target_udid"] == DONOR["udid"]
    assert next_job(client, agent) is None  # одна задача выдаётся один раз

    report(client, agent, job["id"], state="done", message="Найдено 2", apps=[
        {"adam_id": 111, "bundle_id": "com.bank.old", "name": "Старый банк", "version": "5.2", "version_id": 8001},
        {"adam_id": 222, "bundle_id": "com.game", "name": "Игра", "version": "1.0", "version_id": 9001},
    ])
    apps = client.get("/api/app-install/apps", headers=auth_headers).json()
    assert [a["name"] for a in apps] == ["Игра", "Старый банк"]
    assert client.get("/api/app-install/apps?q=банк", headers=auth_headers).json()[0]["adam_id"] == 111
    bank = next(a for a in apps if a["adam_id"] == 111)

    r = client.post("/api/app-install/jobs",
                    json={"station_id": station_id, "kind": "install", "app_id": bank["id"], "target_udid": TARGET["udid"]},
                    headers=auth_headers)
    assert r.status_code == 200, r.text
    job = next_job(client, agent)
    assert job == {**job, "kind": "install", "adam_id": 111, "version_id": 8001, "target_udid": TARGET["udid"]}
    report(client, agent, job["id"], progress=40, message="Установка")
    jobs = client.get("/api/app-install/jobs", headers=auth_headers).json()
    assert jobs[0]["progress"] == 40 and jobs[0]["state"] == "running"
    report(client, agent, job["id"], state="done")
    jobs = client.get(f"/api/app-install/jobs?station_id={station_id}", headers=auth_headers).json()
    assert jobs[0]["state"] == "done" and jobs[0]["progress"] == 100 and jobs[0]["app"]["name"] == "Старый банк"


def test_purchases_do_not_overwrite_donor_version(client, auth_headers, db):
    station_id, agent = make_station(client, auth_headers)
    beat(client, agent)
    db.add(IosApp(adam_id=111, bundle_id="com.bank.old", name="Старый банк", version="5.2", version_id=8001))
    db.commit()
    client.post("/api/app-install/jobs", json={"station_id": station_id, "kind": "purchases"}, headers=auth_headers)
    job = next_job(client, agent)
    report(client, agent, job["id"], state="done", apps=[
        {"adam_id": 111, "bundle_id": "com.bank.old", "name": "Старый банк", "version": "6.0"},
        {"adam_id": 333, "bundle_id": "com.new", "name": "Новое", "version": "2.0"},
    ])
    bank = db.scalar(select(IosApp).where(IosApp.adam_id == 111))
    assert (bank.version, bank.version_id) == ("5.2", 8001)
    assert db.scalar(select(IosApp).where(IosApp.adam_id == 333)).source == "purchases"


def test_login_with_code_wipes_secrets(client, auth_headers, db):
    station_id, agent = make_station(client, auth_headers)
    beat(client, agent, apple_auth="needed")
    r = client.post("/api/app-install/jobs",
                    json={"station_id": station_id, "kind": "login", "email": "me@icloud.com", "password": "S3cret!"},
                    headers=auth_headers)
    assert r.status_code == 200, r.text
    job_id = r.json()["id"]
    assert "S3cret" not in r.text

    job = next_job(client, agent)
    assert job["secret"] == "S3cret!" and job["email"] == "me@icloud.com"
    assert db.get(AppInstallJob, job_id).secret is None  # пароль стёрт сразу

    report(client, agent, job_id, state="need_code", message="Apple прислал код")
    assert next_job(client, agent) is None  # кода ещё нет — нечего выдавать
    assert client.post(f"/api/app-install/jobs/{job_id}/code", json={"code": "12"}, headers=auth_headers).status_code == 400
    r = client.post(f"/api/app-install/jobs/{job_id}/code", json={"code": "123 456"}, headers=auth_headers)
    assert r.status_code == 200, r.text

    job = next_job(client, agent)
    assert job["id"] == job_id and job["secret"] == "123456"
    assert db.get(AppInstallJob, job_id).secret is None

    report(client, agent, job_id, state="done", apple_id="me@icloud.com")
    station = client.get("/api/app-install/stations", headers=auth_headers).json()[0]
    assert station["apple_auth"] == "ok" and station["apple_id"] == "me@icloud.com"


def test_auth_required_marks_station_and_retry(client, auth_headers, db):
    station_id, agent = make_station(client, auth_headers)
    beat(client, agent)
    db.add(IosApp(adam_id=111, bundle_id="com.bank.old", name="Старый банк"))
    db.commit()
    app_id = db.scalar(select(IosApp.id))
    client.post("/api/app-install/jobs",
                json={"station_id": station_id, "kind": "install", "app_id": app_id, "target_udid": TARGET["udid"]},
                headers=auth_headers)
    job = next_job(client, agent)
    report(client, agent, job["id"], state="failed", error_code="AUTH_REQUIRED", message="Нужен вход")
    assert client.get("/api/app-install/stations", headers=auth_headers).json()[0]["apple_auth"] == "needed"

    r = client.post(f"/api/app-install/jobs/{job['id']}/retry", headers=auth_headers)
    assert r.status_code == 200 and r.json()["state"] == "queued" and r.json()["id"] != job["id"]


def test_cancel_and_foreign_station(client, auth_headers, db):
    station_id, agent = make_station(client, auth_headers)
    _, other_agent = make_station(client, auth_headers, name="Мак")
    beat(client, agent)
    beat(client, other_agent)
    r = client.post("/api/app-install/jobs", json={"station_id": station_id, "kind": "purchases"}, headers=auth_headers)
    job_id = r.json()["id"]
    assert next_job(client, other_agent) is None  # чужие задачи не видны
    assert client.post(f"/api/app-install/agent/jobs/{job_id}", json={"state": "done"}, headers=other_agent).status_code == 404

    assert client.post(f"/api/app-install/jobs/{job_id}/cancel", headers=auth_headers).json()["state"] == "cancelled"
    assert next_job(client, agent) is None
    assert report(client, agent, job_id, state="done")["cancelled"] is True


def test_delete_station_cancels_jobs(client, auth_headers, db):
    station_id, agent = make_station(client, auth_headers)
    beat(client, agent)
    job_id = client.post("/api/app-install/jobs", json={"station_id": station_id, "kind": "purchases"},
                         headers=auth_headers).json()["id"]
    assert client.delete(f"/api/app-install/stations/{station_id}", headers=auth_headers).status_code == 204
    assert db.get(AppInstallJob, job_id).state == "cancelled"
    assert client.post("/api/app-install/agent/heartbeat", json={}, headers=agent).status_code == 401
    assert client.get("/api/app-install/stations", headers=auth_headers).json() == []


def test_permissions(client, auth_headers, db):
    station_id, agent = make_station(client, auth_headers)
    beat(client, agent)
    make_employee(db, name="Мастер", email="m@x.test", permissions=["appInstallAccess"])
    make_employee(db, name="Никто", email="n@x.test", permissions=[])
    master, nobody = login(client, "m@x.test"), login(client, "n@x.test")

    assert client.get("/api/app-install/stations", headers=nobody).status_code == 403
    assert client.get("/api/app-install/stations", headers=master).status_code == 200
    # Мастер может сканировать и ставить, но не добавлять станции и не входить в Apple ID
    assert client.post("/api/app-install/stations", json={"name": "x"}, headers=master).status_code == 403
    r = client.post("/api/app-install/jobs",
                    json={"station_id": station_id, "kind": "login", "email": "a@b.c", "password": "p"}, headers=master)
    assert r.status_code == 403
    r = client.post("/api/app-install/jobs", json={"station_id": station_id, "kind": "scan", "target_udid": DONOR["udid"]},
                    headers=master)
    assert r.status_code == 200
    assert r.json()["created_by_name"] == "Мастер"
