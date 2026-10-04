class BusinessError(Exception):
    """Ошибка бизнес-правила. API превращает её в HTTP 400 с понятным текстом для пользователя.

    Текст пишем по-русски, так, чтобы его можно было показать сотруднику как есть:
    raise BusinessError("Товара недостаточно на складе")
    """

    def __init__(self, message: str, code: str = "business_error"):
        super().__init__(message)
        self.message = message
        self.code = code


class NotFound(BusinessError):
    def __init__(self, what: str = "Объект"):
        super().__init__(f"{what} не найден", code="not_found")


class Forbidden(BusinessError):
    def __init__(self, message: str = "Недостаточно прав"):
        super().__init__(message, code="forbidden")
