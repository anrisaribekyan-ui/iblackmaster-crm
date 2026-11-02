def normalize_phone(raw: str) -> str | None:
    digits = "".join(character for character in raw if character.isdecimal())

    if len(digits) == 11 and digits.startswith("8"):
        return "7" + digits[1:]
    if len(digits) == 10:
        return "7" + digits
    if len(digits) < 10:
        return None
    return digits


def format_phone(digits: str) -> str:
    if len(digits) != 11:
        return digits

    return f"+{digits[0]} ({digits[1:4]}) {digits[4:7]}-{digits[7:9]}-{digits[9:11]}"

def split_phones(raw: str) -> list[str]:
    """Несколько номеров в одной ячейке («+7 916…, 8 925…»): каждый нормализуется отдельно, без повторов.

    Склеенные цифры без разделителя (длина кратна 11) режутся по 11 цифр.
    """
    import re

    result: list[str] = []
    for part in re.split(r"[,;/\n]+", raw or ""):
        digits = "".join(c for c in part if c.isdecimal())
        chunks = [digits[i:i + 11] for i in range(0, len(digits), 11)] if len(digits) > 11 and len(digits) % 11 == 0 else [part]
        for chunk in chunks:
            phone = normalize_phone(chunk)
            if phone and phone not in result:
                result.append(phone)
    return result
