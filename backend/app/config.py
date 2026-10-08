from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Настройки приложения. Читаются из переменных окружения или файла backend/.env."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Для локальной разработки без Docker подходит SQLite.
    # Для боевого сервера: postgresql+psycopg://user:pass@host:5432/crm
    database_url: str = "sqlite:///./crm.db"

    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 12

    # Часовой пояс компании (Москва). Все даты в БД хранятся в UTC.
    company_utc_offset_minutes: int = 180

    # Публичный адрес CRM (для ссылки отслеживания в SMS и QR), например https://crm.iblackmaster.ru
    public_url: str = "http://localhost:5173"

    # SMS через приложение SMS Gateway for Android (sms-gate.app) на рабочем телефоне с симкой.
    # Пусто — SMS не отправляются (сообщения копятся в очереди со статусом «в очереди»).
    smsgate_url: str = "https://api.sms-gate.app/3rdparty/v1"
    smsgate_user: str = ""
    smsgate_password: str = ""
    sms_daily_limit: int = 150  # больше с обычной симки слать опасно — оператор заблокирует как спам
    sms_worker: bool = True  # фоновая отправка (в тестах выключено)


settings = Settings()
