"""Проверка panic-лога: фото, файл или вставленный текст."""

from fastapi import APIRouter, Depends, File, Form, UploadFile

from app.api.deps import require
from app.errors import BusinessError
from app.services import panic

router = APIRouter(prefix="/panic", tags=["Проверка паник-лога"])
access = [Depends(require("panicAccess"))]

IMAGE_TYPES = (".png", ".jpg", ".jpeg", ".heic", ".webp", ".bmp")
MAX_BYTES = 15 * 1024 * 1024


@router.post("/check", dependencies=access)
async def check_panic(file: UploadFile | None = File(default=None), text: str = Form(default="")):
    body = text.strip()
    if file is not None and file.filename:
        data = await file.read()
        if len(data) > MAX_BYTES:
            raise BusinessError("Файл больше 15 МБ")
        name = file.filename.lower()
        is_image = (file.content_type or "").startswith("image/") or name.endswith(IMAGE_TYPES)
        try:
            extracted = panic.ocr_image(data) if is_image else panic.text_from_file(name, data)
        except RuntimeError as e:
            raise BusinessError(str(e))
        except Exception:
            raise BusinessError("Не получилось прочитать файл. Пришлите фото получше или сам файл лога")
        body = f"{extracted}\n{body}".strip()
    if len(body) < 20:
        raise BusinessError("В файле почти нет текста. Приложите фото лога, файл или вставьте текст")
    return panic.check(body)
