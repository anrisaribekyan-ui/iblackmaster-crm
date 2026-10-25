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


def test_agent_files_upload_and_public_download(client, auth_headers, db, tmp_path, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "uploads_dir", str(tmp_path))
    files = client.get("/api/app-install/agent-files").json()  # без входа
    assert [(f["platform"], f["available"]) for f in files] == [("windows", False), ("macos", False)]
    assert client.get("/api/app-install/agent-files/windows").status_code == 404

    exe = b"MZ" + b"\0" * 5000
    r = client.post("/api/app-install/agent-files/windows", headers=auth_headers, data={"version": "1.0.0"},
                    files={"file": ("iBlackMasterStation-Setup.exe", exe, "application/octet-stream")})
    assert r.status_code == 200, r.text
    win = r.json()[0]
    assert win["available"] and win["size"] == len(exe) and win["version"] == "1.0.0"

    d = client.get("/api/app-install/agent-files/windows")
    assert d.status_code == 200 and d.content == exe
    assert "iBlackMasterStation-Setup.exe" in d.headers["content-disposition"]

    # Не тот файл
    bad = client.post("/api/app-install/agent-files/windows", headers=auth_headers,
                      files={"file": ("photo.jpg", b"\xff\xd8", "image/jpeg")})
    assert bad.status_code == 400
    fake = client.post("/api/app-install/agent-files/macos", headers=auth_headers,
                       files={"file": ("iBlackMasterStation-Mac.zip", b"not a zip", "application/zip")})
    assert fake.status_code == 400
    assert not list(tmp_path.glob("station-agent/*.part"))

    # Без права на станции загружать нельзя
    make_employee(db, name="Мастер2", email="m2@x.test", permissions=["appInstallAccess"])
    r = client.post("/api/app-install/agent-files/windows", headers=login(client, "m2@x.test"),
                    files={"file": ("iBlackMasterStation-Setup.exe", exe, "application/octet-stream")})
    assert r.status_code == 403


def test_stale_jobs_expire_and_running_login_can_be_cancelled(client, auth_headers, db):
    station_id, agent = make_station(client, auth_headers)
    beat(client, agent)
    r = client.post("/api/app-install/jobs",
                    json={"station_id": station_id, "kind": "login", "email": "a@icloud.com", "password": "p"},
                    headers=auth_headers)
    login_id = r.json()["id"]
    next_job(client, agent)  # станция взяла вход и пропала
    client.post("/api/app-install/jobs", json={"station_id": station_id, "kind": "purchases"}, headers=auth_headers)
    purchases = next_job(client, agent)
    report(client, agent, purchases["id"], message="Загружаю…")

    job = db.get(AppInstallJob, login_id)
    job.updated_at = utcnow() - timedelta(minutes=11)
    db.commit()
    jobs = {j["id"]: j for j in client.get("/api/app-install/jobs", headers=auth_headers).json()}
    assert jobs[login_id]["state"] == "failed" and jobs[login_id]["error_code"] == "STALE"
    assert jobs[purchases["id"]]["state"] == "running"  # свежая задача не тронута

    # Зависший вход можно отменить вручную, не дожидаясь 10 минут
    assert client.post(f"/api/app-install/jobs/{purchases['id']}/cancel", headers=auth_headers).json()["state"] == "cancelled"


def test_code_wait_expires(client, auth_headers, db):
    station_id, agent = make_station(client, auth_headers)
    beat(client, agent)
    job_id = client.post("/api/app-install/jobs",
                         json={"station_id": station_id, "kind": "login", "email": "a@icloud.com", "password": "p"},
                         headers=auth_headers).json()["id"]
    next_job(client, agent)
    report(client, agent, job_id, state="need_code")
    job = db.get(AppInstallJob, job_id)
    job.updated_at = utcnow() - timedelta(minutes=16)
    db.commit()
    jobs = client.get("/api/app-install/jobs", headers=auth_headers).json()
    assert jobs[0]["state"] == "failed" and jobs[0]["error_code"] == "CODE_TIMEOUT"


def test_long_urls_in_messages_are_shortened(client, auth_headers, db):
    station_id, agent = make_station(client, auth_headers)
    beat(client, agent)
    client.post("/api/app-install/jobs", json={"station_id": station_id, "kind": "purchases"}, headers=auth_headers)
    job = next_job(client, agent)
    url = "https://iosapps.itunes.apple.com/itunes-assets/Purple116/v4/a.ipa?accessKey=" + "x" * 500
    report(client, agent, job["id"], state="failed", message=f'failed: Get "{url}": TLS handshake timeout')
    msg = client.get("/api/app-install/jobs", headers=auth_headers).json()[0]["message"]
    assert msg == 'failed: Get "[iosapps.itunes.apple.com]": TLS handshake timeout'


def test_agent_files_accept_github_artifact_zip(client, auth_headers, tmp_path, monkeypatch):
    import io
    import zipfile

    from app.config import settings

    monkeypatch.setattr(settings, "uploads_dir", str(tmp_path))

    def zipped(name: str, data: bytes) -> bytes:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr(name, data)
        return buf.getvalue()

    exe = b"MZ" + b"\1" * 3000
    r = client.post("/api/app-install/agent-files/windows", headers=auth_headers,
                    files={"file": ("iBlackMasterStation-Windows.zip", zipped("iBlackMasterStation-Setup.exe", exe), "application/zip")})
    assert r.status_code == 200, r.text
    assert client.get("/api/app-install/agent-files/windows").content == exe

    bad = client.post("/api/app-install/agent-files/windows", headers=auth_headers,
                      files={"file": ("other.zip", zipped("readme.txt", b"hi"), "application/zip")})
    assert bad.status_code == 400 and "нет iBlackMasterStation-Setup.exe" in bad.json()["message"]

    inner_mac = zipped("iBlackMasterStation", b"\xcf\xfa\xed\xfe" + b"\0" * 100)
    r = client.post("/api/app-install/agent-files/macos", headers=auth_headers,
                    files={"file": ("iBlackMasterStation-Mac.zip", zipped("iBlackMasterStation-Mac.zip", inner_mac), "application/zip")})
    assert r.status_code == 200
    assert client.get("/api/app-install/agent-files/macos").content == inner_mac
    # Сам Mac-установщик (не обёрнутый) принимается как есть
    r = client.post("/api/app-install/agent-files/macos", headers=auth_headers,
                    files={"file": ("iBlackMasterStation-Mac.zip", inner_mac, "application/zip")})
    assert r.status_code == 200 and client.get("/api/app-install/agent-files/macos").content == inner_mac


def test_clear_history_keeps_open_jobs(client, auth_headers, db):
    station_id, agent = make_station(client, auth_headers)
    beat(client, agent)
    done = client.post("/api/app-install/jobs", json={"station_id": station_id, "kind": "purchases"}, headers=auth_headers).json()
    report(client, agent, next_job(client, agent)["id"], state="done")
    running = client.post("/api/app-install/jobs", json={"station_id": station_id, "kind": "scan", "target_udid": DONOR["udid"]},
                          headers=auth_headers).json()
    r = client.delete("/api/app-install/jobs", headers=auth_headers)
    assert r.status_code == 200 and r.json()["removed"] == 1
    ids = [j["id"] for j in client.get("/api/app-install/jobs", headers=auth_headers).json()]
    assert ids == [running["id"]] and done["id"] not in ids


def _fake_ipa(adam_id: int | None = 111, bundle: str = "com.bank.old", version: str = "5.2", account: str = "me@icloud.com") -> bytes:
    import io
    import plistlib
    import zipfile

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("Payload/Bank.app/Info.plist", plistlib.dumps(
            {"CFBundleIdentifier": bundle, "CFBundleShortVersionString": version, "CFBundleDisplayName": "Старый банк"}))
        z.writestr("Payload/Bank.app/Bank", b"\0" * 4096)
        if adam_id:
            z.writestr("iTunesMetadata.plist", plistlib.dumps(
                {"itemId": adam_id, "itemName": "Старый банк", "softwareVersionExternalIdentifier": 8001, "apple-id": account}))
    return buf.getvalue()


def test_ipa_archive_agent_roundtrip(client, auth_headers, db, tmp_path, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "uploads_dir", str(tmp_path))
    station_id, agent = make_station(client, auth_headers)
    beat(client, agent)
    db.add(IosApp(adam_id=111, bundle_id="com.bank.old", name="Старый банк", version="5.2", version_id=8001))
    db.commit()
    app_id = db.scalar(select(IosApp.id))

    client.post("/api/app-install/jobs", json={"station_id": station_id, "kind": "install", "app_id": app_id,
                                               "target_udid": TARGET["udid"]}, headers=auth_headers)
    job = next_job(client, agent)
    assert job["ipa_in_crm"] is False and job["app_id"] == app_id

    ipa = _fake_ipa()
    r = client.post(f"/api/app-install/agent/apps/{app_id}/ipa", content=ipa, headers=agent)
    assert r.status_code == 200, r.text
    lib = client.get("/api/app-install/apps", headers=auth_headers).json()[0]
    assert lib["ipa_size"] == len(ipa) and lib["ipa_apple_id"] == "me@icloud.com" and lib["ipa_version"] == "5.2"
    report(client, agent, job["id"], state="done")

    client.post("/api/app-install/jobs", json={"station_id": station_id, "kind": "install", "app_id": app_id,
                                               "target_udid": TARGET["udid"]}, headers=auth_headers)
    job = next_job(client, agent)
    assert job["ipa_in_crm"] is True and job["ipa_size"] == len(ipa)
    got = client.get(f"/api/app-install/agent/apps/{app_id}/ipa", headers=agent)
    assert got.status_code == 200 and got.content == ipa
    assert client.get(f"/api/app-install/agent/apps/{app_id}/ipa").status_code == 401  # без токена станции нельзя

    # Чужое приложение под видом этого — отказ, старый файл цел
    r = client.post(f"/api/app-install/agent/apps/{app_id}/ipa", content=_fake_ipa(adam_id=999), headers=agent)
    assert r.status_code == 400
    assert client.get(f"/api/app-install/agent/apps/{app_id}/ipa", headers=agent).content == ipa


def test_ipa_manual_upload(client, auth_headers, db, tmp_path, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "uploads_dir", str(tmp_path))
    r = client.post("/api/app-install/apps/upload", headers=auth_headers,
                    files={"file": ("bank.ipa", _fake_ipa(adam_id=222, bundle="ru.new.bank"), "application/octet-stream")})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["adam_id"] == 222 and body["source"] == "upload" and body["ipa_size"] > 0
    d = client.get(f"/api/app-install/apps/{body['id']}/ipa", headers=auth_headers)
    assert d.status_code == 200 and d.headers["content-disposition"].endswith('ru.new.bank_5.2.ipa"')

    r = client.post("/api/app-install/apps/upload", headers=auth_headers,
                    files={"file": ("bare.ipa", _fake_ipa(adam_id=None), "application/octet-stream")})
    assert r.status_code == 400 and "iTunesMetadata" in r.json()["message"]
    r = client.post("/api/app-install/apps/upload", headers=auth_headers,
                    files={"file": ("x.ipa", b"not a zip" * 200, "application/octet-stream")})
    assert r.status_code == 400
    assert not [p for p in (tmp_path / "ipa").iterdir() if p.name.startswith("upload-")]
