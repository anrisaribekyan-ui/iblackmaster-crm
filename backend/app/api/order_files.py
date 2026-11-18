"""Фото и файлы заказа (ТЗ этап 3, C9): снимок аппарата при приёме — защита в споре «вы разбили».

Фото с телефона уменьшаем до 1920 px (JPEG) и делаем превью 400 px: на диске и в сети это в 10–20 раз меньше
оригинала. Файлы отдаются только с токеном — фото чужих заказов по ссылке не открыть.
"""

import io
import uuid
from datetime import timedelta
from pathlib import Path

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select

from app.api.deps import CurrentEmployee, DbSession, has_permission
from app.config import settings
from app.db import utcnow
from app.errors import BusinessError, Forbidden, NotFound
from app.models import Employee, OrderFile
from app.services.orders import add_history

router = APIRouter(tags=["Файлы заказа"])

MAX_SIZE = 20 * 1024 * 1024
MAX_FILES = 30
IMAGES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}
INLINE = IMAGES | {"application/pdf"}  # только их браузер показывает прямо на странице, остальное — скачивается
BLOCKED_EXT = {".html", ".htm", ".svg", ".xhtml", ".js", ".mjs", ".exe", ".bat", ".cmd", ".scr", ".com", ".msi", ".ps1", ".vbs", ".jar"}
# Срок хранения: «никогда» — None. Фото при приёме хранятся всегда (доказательство), остальное по умолчанию час
KEEP = {"1h": timedelta(hours=1), "12h": timedelta(hours=12), "10d": timedelta(days=10), "30d": timedelta(days=30), "never": None}
FULL_SIDE = 1920
THUMB_SIDE = 400


def _root() -> Path:
    root = Path(settings.uploads_dir) / "orders"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _thumb_path(path: Path) -> Path:
    return path.with_name(path.stem + ".thumb.jpg")


def _save_image(raw: bytes, target: Path) -> tuple[bytes, str] | None:
    """Уменьшает фото и пишет превью. None — Pillow не смог открыть (например, HEIC) → храним оригинал."""
    try:
        from PIL import Image, ImageOps

        image = ImageOps.exif_transpose(Image.open(io.BytesIO(raw)))
        image = image.convert("RGB")
    except Exception:
        return None
    full = image.copy()
    full.thumbnail((FULL_SIDE, FULL_SIDE))
    out = io.BytesIO()
    full.save(out, "JPEG", quality=85, optimize=True)
    thumb = image.copy()
    thumb.thumbnail((THUMB_SIDE, THUMB_SIDE))
    thumb.save(_thumb_path(target), "JPEG", quality=80)
    return out.getvalue(), "image/jpeg"


def file_dict(item: OrderFile, names: dict[int, str]) -> dict:
    return {
        "id": item.id,
        "created_at": item.created_at,
        "employee_id": item.employee_id,
        "employee_name": names.get(item.employee_id),
        "filename": item.filename,
        "mimetype": item.mimetype,
        "size": item.size,
        "is_image": item.mimetype.startswith("image/"),
        "expires_at": item.expires_at,
    }


def purge_expired(db) -> int:
    """Удаляет файлы с истёкшим сроком хранения (с диска и из базы)."""
    now = utcnow()
    items = db.scalars(select(OrderFile).where(OrderFile.expires_at.is_not(None), OrderFile.expires_at <= now.replace(tzinfo=None))).all()
    for item in items:
        path = Path(settings.uploads_dir) / item.path
        db.delete(item)
        path.unlink(missing_ok=True)
        _thumb_path(path).unlink(missing_ok=True)
    if items:
        db.commit()
    return len(items)


def _names(db, items) -> dict[int, str]:
    ids = {i.employee_id for i in items if i.employee_id}
    return dict(db.execute(select(Employee.id, Employee.short_name).where(Employee.id.in_(ids or {0}))).all())


@router.get("/orders/{order_id}/files")
def list_files(order_id: int, db: DbSession, me: CurrentEmployee):
    from app.api.orders import get_order_for_employee

    order = get_order_for_employee(db, order_id, me, include_deleted=True)
    purge_expired(db)
    items = db.scalars(select(OrderFile).where(OrderFile.order_id == order.id).order_by(OrderFile.id)).all()
    names = _names(db, items)
    return [file_dict(i, names) for i in items]


@router.post("/orders/{order_id}/files")
async def upload_files(order_id: int, db: DbSession, me: CurrentEmployee, files: list[UploadFile] = File(...), keep: str | None = Form(default=None)):
    from app.api.orders import get_order_for_employee

    order = get_order_for_employee(db, order_id, me)
    if keep is not None and keep not in KEEP:
        raise BusinessError("Неизвестный срок хранения")
    purge_expired(db)
    existing = len(db.scalars(select(OrderFile.id).where(OrderFile.order_id == order.id)).all())
    if existing + len(files) > MAX_FILES:
        raise BusinessError(f"У заказа не больше {MAX_FILES} файлов")
    folder = _root() / str(order.id)
    folder.mkdir(exist_ok=True)
    saved: list[OrderFile] = []
    written: list[Path] = []
    try:
        for upload in files:
            mimetype = (upload.content_type or "").lower() or "application/octet-stream"
            if Path(upload.filename or "").suffix.lower() in BLOCKED_EXT:
                raise BusinessError(f"«{upload.filename}»: такой тип файла загружать нельзя")
            if mimetype not in INLINE:
                mimetype = "application/octet-stream"
            raw = await upload.read(MAX_SIZE + 1)
            if len(raw) > MAX_SIZE:
                raise BusinessError(f"«{upload.filename}» больше 20 МБ")
            if not raw:
                raise BusinessError(f"«{upload.filename}» пустой")
            target = folder / uuid.uuid4().hex
            data = raw
            if mimetype in IMAGES:
                converted = _save_image(raw, target)
                if converted is not None:
                    data, mimetype = converted
                    written.append(_thumb_path(target))
            target.write_bytes(data)
            written.append(target)
            # Фото без выбора — навсегда; прочие файлы без выбора — час
            period = KEEP[keep] if keep is not None else (None if mimetype.startswith("image/") else KEEP["1h"])
            item = OrderFile(
                expires_at=(utcnow() + period).replace(tzinfo=None) if period else None,
                order_id=order.id,
                employee_id=me.id,
                filename=(upload.filename or "файл")[:300],
                mimetype=mimetype,
                size=len(data),
                path=str(target.relative_to(Path(settings.uploads_dir))),
            )
            db.add(item)
            saved.append(item)
        db.flush()
        photos = sum(1 for i in saved if i.mimetype.startswith("image/"))
        text = f"Фото: {photos}" if photos == len(saved) else f"Файлов: {len(saved)}"
        add_history(db, order, "file", me, text=text)
        db.commit()
    except Exception:
        db.rollback()
        for path in written:
            path.unlink(missing_ok=True)
        raise
    return [file_dict(i, {me.id: me.short_name}) for i in saved]


def _get_file(db, order_id: int, file_id: int, me) -> OrderFile:
    from app.api.orders import get_order_for_employee

    get_order_for_employee(db, order_id, me, include_deleted=True)
    item = db.get(OrderFile, file_id)
    if item is None or item.order_id != order_id:
        raise NotFound("Файл")
    return item


@router.get("/orders/{order_id}/files/{file_id}")
def download_file(order_id: int, file_id: int, db: DbSession, me: CurrentEmployee, thumb: bool = False):
    item = _get_file(db, order_id, file_id, me)
    path = Path(settings.uploads_dir) / item.path
    if thumb and _thumb_path(path).exists():
        return FileResponse(_thumb_path(path), media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})
    if not path.exists():
        raise NotFound("Файл")
    return FileResponse(path, media_type=item.mimetype, filename=item.filename,
                        content_disposition_type="inline" if item.mimetype in INLINE else "attachment",
                        headers={"Cache-Control": "private, max-age=86400"})


@router.delete("/orders/{order_id}/files/{file_id}", status_code=204)
def delete_file(order_id: int, file_id: int, db: DbSession, me: CurrentEmployee):
    item = _get_file(db, order_id, file_id, me)
    created = item.created_at if item.created_at.tzinfo else item.created_at.replace(tzinfo=utcnow().tzinfo)
    own_fresh = item.employee_id == me.id and utcnow() - created < timedelta(hours=24)
    if not (me.is_owner or own_fresh or has_permission(me, "deleteStorageFileAccess")):
        # Фото при приёме — доказательство; удалить своё можно только в первые сутки
        raise Forbidden("Удалить фото может только загрузивший в течение суток или владелец")
    path = Path(settings.uploads_dir) / item.path
    db.delete(item)
    db.commit()
    path.unlink(missing_ok=True)
    _thumb_path(path).unlink(missing_ok=True)
