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


settings = Settings()
