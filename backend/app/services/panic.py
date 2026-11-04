"""Проверка panic-лога iPhone: текст из файла или фото → ключевые строки → подсказки по правилам → разбор ИИ.

Фото читается на сервере (tesseract), в ИИ уходит только текст лога. Это подсказка мастеру, не приговор:
по логу виден датчик или узел, который не ответил, а не сама неисправная деталь.
"""

import io
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

import httpx
from PIL import Image, ImageOps

from app.config import settings

MAX_TEXT = 12000

# Типовые признаки в логе → что обычно проверяют первым. Порядок важен: сначала самые конкретные.
RULES: list[tuple[str, str, str]] = [
    (r"T[Gg][0O][BV]", "Датчик аккумулятора (TG0B/TG0V) не отвечает", "Проверить АКБ и её шлейф, затем разъём на плате."),
    (r"Prs[0O]", "Не отвечает датчик давления (Prs0)", "Проверить шлейф нижнего шлейфа/датчика давления и пайку."),
    (r"\bmic[1-4]\b|Mic[1-4]", "Не отвечает микрофон", "Проверить нижний шлейф и верхний микрофон."),
    (r"ANS2|ANS\b|NAND|nvme|NVMe", "Ошибка памяти (NAND/ANS)", "Чаще всего память или её питание на плате; проверить, не было ли прошивки/падения."),
    (r"baseband|Baseband|AppleBaseband", "Ошибка модема (baseband)", "Проверить модемную часть и питание, SIM-лоток, антенные линии."),
    (r"userspace watchdog|no successful checkins|backboardd|watchdogd", "Зависание системы (watchdog)", "Нет ответа от системной службы: может быть программный сбой, батарея или перегрев. Сначала прошивка, затем питание."),
    (r"thermalmonitord|[Mm]issing sensor", "Не отвечают температурные датчики", "Смотрите, какие именно датчики перечислены: они указывают на шлейф или узел."),
    (r"AOP|SMC|PMU|[Pp]ower.?management", "Ошибка питания (PMU/SMC)", "Проверить питание на плате, батарею, зарядный порт."),
    (r"i2c|I2C|AppleMultitouch|Multitouch", "Ошибка шины (I2C) / тачскрин", "Проверить дисплей и тач, шлейфы, пайку линий."),
    (r"[Cc]amera|AppleH\d+CamIn|ISP", "Ошибка камеры", "Отключить камеры по очереди и проверить, пропадёт ли паника."),
]

KEY_LINES = re.compile(
    r"(panic|Panic|PANIC|[Mm]issing sensor|thermalmonitord|watchdog|checkins|bug_type|os_version|product|"
    r"incident_id|ANS2|baseband|SMC|AOP|[Kk]ernel|Mach|iPhone\d+,\d+|iPad\d+,\d+|Restore|Panicked task)"
)


def ocr_image(data: bytes) -> str:
    """Читает текст со скриншота/фото. Нужен установленный tesseract (rus+eng)."""
    exe = shutil.which("tesseract")
    if not exe:
        raise RuntimeError("На сервере не установлен распознаватель текста (tesseract)")
    image = Image.open(io.BytesIO(data))
    image = ImageOps.exif_transpose(image).convert("L")
    image = ImageOps.autocontrast(image)
    if max(image.size) < 1800:  # мелкий текст читается лучше, если увеличить
        scale = 1800 / max(image.size)
        image = image.resize((int(image.width * scale), int(image.height * scale)))
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "in.png"
        image.save(path)
        langs = "rus+eng"
        result = subprocess.run([exe, str(path), "stdout", "-l", langs, "--psm", "6"], capture_output=True, timeout=60)
        if result.returncode != 0:  # нет русского пакета — читаем хотя бы латиницу (лог и так по-английски)
            result = subprocess.run([exe, str(path), "stdout", "-l", "eng", "--psm", "6"], capture_output=True, timeout=60)
        return result.stdout.decode("utf-8", "replace")


def text_from_file(name: str, data: bytes) -> str:
    """Текст из .ips/.txt/.log/.json; .ips — это JSON, берём из него самое важное."""
    text = data.decode("utf-8", "replace")
    lowered = name.lower()
    if lowered.endswith((".ips", ".json")) or text.lstrip().startswith("{"):
        parts = []
        for chunk in text.split("\n", 1):
            try:
                obj = json.loads(chunk)
            except ValueError:
                continue
            if isinstance(obj, dict):
                for key in ("bug_type", "os_version", "product", "incident_id", "panicString", "macOSPanicString"):
                    if obj.get(key):
                        parts.append(f"{key}: {obj[key]}")
        if parts:
            return "\n".join(parts) + "\n" + text
    return text


def analyze_rules(text: str) -> dict:
    findings = []
    seen = set()
    for pattern, title, advice in RULES:
        if re.search(pattern, text) and title not in seen:
            seen.add(title)
            findings.append({"title": title, "advice": advice})
    sensors = sorted(set(re.findall(r"\b(T[a-zA-Z]\d[a-zA-Z0-9]{1,3}|Pr?s\d|mic\d)\b", " ".join(re.findall(r"[Mm]issing sensor\(?s?\)?:?[^\n]*", text)))))
    lines = [ln.strip() for ln in text.splitlines() if KEY_LINES.search(ln)]
    device = re.search(r"(iPhone\d+,\d+|iPad\d+,\d+)", text)
    ios = re.search(r"(?:iPhone OS|iOS|os_version)[^\d]{0,12}([\d.]+(?: ?\(\w+\))?)", text)
    return {
        "device": device.group(1) if device else None,
        "ios": ios.group(1) if ios else None,
        "sensors": sensors,
        "key_lines": [ln[:300] for ln in lines[:12]],
        "findings": findings,
    }


PROMPT = (
    "Ты помощник мастера по ремонту iPhone. Тебе дают panic-лог (иногда распознанный с фото, с ошибками). "
    "Отвечай по-русски, коротко и просто, без воды, в таком виде:\n"
    "1) Что случилось (1-2 предложения).\n"
    "2) Вероятные причины по убыванию вероятности (до 4 пунктов, у каждого — что проверить).\n"
    "3) С чего начать (2-3 шага).\n"
    "Если в логе мало данных или текст распознан плохо — прямо скажи об этом и что нужно прислать ещё. "
    "Не называй причину наверняка: по логу видно, какой узел не ответил, а не какая деталь сломана. Ничего не выдумывай."
)


def llm_explain(text: str, hints: list[dict], transport: httpx.BaseTransport | None = None) -> str | None:
    if not settings.llm_api_key:
        return None
    hint_text = "\n".join(f"- {h['title']}: {h['advice']}" for h in hints) or "нет"
    try:
        with httpx.Client(timeout=60, transport=transport) as http:
            response = http.post(
                f"{settings.llm_base_url.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {settings.llm_api_key}"},
                json={
                    "model": settings.llm_model,
                    "temperature": 0.2,
                    "messages": [
                        {"role": "system", "content": PROMPT},
                        {"role": "user", "content": f"Предварительные признаки по правилам:\n{hint_text}\n\nЛог:\n{text[:MAX_TEXT]}"},
                    ],
                },
            )
            response.raise_for_status()
            return response.json()["choices"][0]["message"]["content"].strip()
    except (httpx.HTTPError, KeyError, IndexError, ValueError):
        return None


def check(text: str, transport: httpx.BaseTransport | None = None) -> dict:
    text = text.strip()[: MAX_TEXT * 2]
    result = analyze_rules(text)
    result["ai"] = llm_explain(text, result["findings"], transport)
    result["ai_enabled"] = bool(settings.llm_api_key)
    result["text"] = text[:MAX_TEXT]
    return result
