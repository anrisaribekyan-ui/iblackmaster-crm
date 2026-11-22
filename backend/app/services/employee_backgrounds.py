"""Персональные обои сотрудников: файл в uploads, метаданные в существующей app_setting.

Фон назначает только владелец CRM. Файлы хранятся в общем Docker-томе uploads
(попадают в существующие резервные копии). Миграция БД не требуется.
"""

import io
import re
import uuid
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy.orm import Session

from app.config import settings
from app.errors import BusinessError
from app.models import AppSetting

MAX_UPLOAD_BYTES = 8 * 1024 * 1024
MAX_PIXELS = 30_000_000
MAX_DIMENSIONS = (2400, 1600)
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}
_FILE_NAME = re.compile(r"^[a-f0-9]{32}\.jpg$")


def _key(employee_id: int) -> str:
    return f"employee_background_{employee_id}"


def _directory(employee_id: int) -> Path:
    return Path(settings.uploads_dir) / "employee-backgrounds" / str(employee_id)


def current_name(db: Session, employee_id: int) -> str | None:
    row = db.get(AppSetting, _key(employee_id))
    name = row.value.get("file") if row is not None and isinstance(row.value, dict) else None
    return name if isinstance(name, str) and _FILE_NAME.fullmatch(name) else None


def current_path(db: Session, employee_id: int) -> Path | None:
    name = current_name(db, employee_id)
    if not name:
        return None
    path = _directory(employee_id) / name
    return path if path.is_file() else None


def current_version(db: Session, employee_id: int) -> str | None:
    name = current_name(db, employee_id)
    return name.removesuffix(".jpg") if name and (_directory(employee_id) / name).is_file() else None


def _convert(raw: bytes) -> bytes:
    try:
        with Image.open(io.BytesIO(raw)) as opened:
            if opened.format not in {"JPEG", "PNG", "WEBP"}:
                raise BusinessError("Загрузите фотографию JPG, PNG или WebP")
            if opened.width * opened.height > MAX_PIXELS:
                raise BusinessError("Изображение слишком большое по разрешению")
            image = ImageOps.exif_transpose(opened)
            image.thumbnail(MAX_DIMENSIONS, Image.Resampling.LANCZOS)
            if "A" in image.getbands() or image.mode == "P":
                rgba = image.convert("RGBA")
                background = Image.new("RGB", rgba.size, (255, 255, 255))
                background.paste(rgba, mask=rgba.getchannel("A"))
                image = background
            else:
                image = image.convert("RGB")
            out = io.BytesIO()
            image.save(out, format="JPEG", quality=83, optimize=True)
            return out.getvalue()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise BusinessError("Не удалось прочитать изображение. Выберите JPG, PNG или WebP") from exc


def save(db: Session, employee_id: int, raw: bytes, content_type: str) -> str:
    if content_type.lower() not in ALLOWED_CONTENT_TYPES:
        raise BusinessError("Разрешены только JPG, PNG и WebP")
    if not raw or len(raw) > MAX_UPLOAD_BYTES:
        raise BusinessError("Изображение должно быть не больше 8 МБ")
    converted = _convert(raw)
    directory = _directory(employee_id)
    directory.mkdir(parents=True, exist_ok=True)
    previous = current_name(db, employee_id)
    name = f"{uuid.uuid4().hex}.jpg"
    target = directory / name
    target.write_bytes(converted)
    try:
        row = db.get(AppSetting, _key(employee_id))
        if row is None:
            db.add(AppSetting(key=_key(employee_id), value={"file": name}))
        else:
            row.value = {"file": name}
        db.commit()
    except Exception:
        db.rollback()
        target.unlink(missing_ok=True)
        raise
    if previous:
        (directory / previous).unlink(missing_ok=True)
    return name.removesuffix(".jpg")


def remove(db: Session, employee_id: int) -> None:
    previous = current_name(db, employee_id)
    row = db.get(AppSetting, _key(employee_id))
    if row is not None:
        db.delete(row)
        db.commit()
    if previous:
        (_directory(employee_id) / previous).unlink(missing_ok=True)
