"""Страница «Перенос из LiveSklad»: загрузка выгрузки «Заказы» и запуск загрузчика на сервере (пробный прогон или запись)."""

import json
import tempfile
import threading
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, Request

from app.api.deps import CurrentEmployee, require
from app.errors import BusinessError, NotFound

router = APIRouter(prefix="/admin/livesklad-import", tags=["Перенос из LiveSklad"])

JOBS_DIR = Path(tempfile.gettempdir()) / "ls-import-jobs"  # общая папка для обоих воркеров uvicorn
MAX_BYTES = 200 * 1024 * 1024


def _state_path(job_id: str) -> Path:
    return JOBS_DIR / f"{job_id}.json"


def _write_state(job_id: str, state: dict) -> None:
    JOBS_DIR.mkdir(exist_ok=True)
    tmp = _state_path(job_id).with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False))
    tmp.replace(_state_path(job_id))


def _run(job_id: str, file_path: Path, commit: bool, protect: set[str]) -> None:
    from app.importers.livesklad_orders import run_import

    state = {"status": "running", "rows": 0, "commit": commit}
    _write_state(job_id, state)
    try:
        result = run_import(str(file_path), commit, protect, progress=lambda n: _write_state(job_id, {**state, "rows": n}))
        _write_state(job_id, {"status": "done", "commit": commit, **result})
    except BaseException as error:  # noqa: BLE001 — любая ошибка должна дойти до страницы
        _write_state(job_id, {"status": "error", "commit": commit, "message": str(error)[:500]})
    finally:
        file_path.unlink(missing_ok=True)


@router.post("/orders", dependencies=[Depends(require("settingAccess"))])
async def start_orders_import(request: Request, me: CurrentEmployee, commit: bool = False, protect: str = "Панфиловский"):
    """Тело запроса — сам файл «Заказы.xlsx». commit=false — пробный прогон, ничего не сохраняет."""
    JOBS_DIR.mkdir(exist_ok=True)
    if any(
        json.loads(p.read_text()).get("status") == "running" for p in JOBS_DIR.glob("*.json") if p.stat().st_size
    ):
        raise BusinessError("Другой перенос ещё идёт — дождитесь его окончания")
    job_id = uuid.uuid4().hex[:12]
    file_path = JOBS_DIR / f"{job_id}.xlsx"
    size = 0
    with file_path.open("wb") as out:
        async for chunk in request.stream():
            size += len(chunk)
            if size > MAX_BYTES:
                file_path.unlink(missing_ok=True)
                raise BusinessError("Файл слишком большой")
            out.write(chunk)
    if size == 0:
        raise BusinessError("Файл пустой")
    protect_set = {name.strip() for name in protect.split(",") if name.strip()}
    _write_state(job_id, {"status": "queued", "rows": 0, "commit": commit})
    threading.Thread(target=_run, args=(job_id, file_path, commit, protect_set), daemon=True).start()
    return {"job": job_id}


@router.get("/{job_id}", dependencies=[Depends(require("settingAccess"))])
def import_status(job_id: str, me: CurrentEmployee):
    path = _state_path(job_id)
    if not job_id.isalnum() or not path.exists():
        raise NotFound("Перенос")
    return json.loads(path.read_text())
