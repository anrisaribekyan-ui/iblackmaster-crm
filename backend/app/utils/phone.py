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