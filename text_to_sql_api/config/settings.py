import pathlib
from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = pathlib.Path(__file__).resolve().parent.parent
ROOT_DIR = BASE_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ROOT_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    GEMINI_API_KEY: str

    # Auth + logs + sessions DB (plain PostgreSQL)
    AUTH_DB_URL: str

    # LMS query DBs
    ONLINE_LMS_URL: str
    REGULAR_LMS_URL: str

    # JWT
    JWT_SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRY_HOURS: int = 8

    # Refresh token
    REFRESH_TOKEN_EXPIRY_DAYS: int = 7

    GEMINI_MODEL: str = "gemini-3.1-flash-lite-preview"

    KNOWLEDGE_BASE_DIR: str = str(ROOT_DIR / "knowledge_base")
    DATA_DIR: str = str(BASE_DIR / "data")

    ALLOWED_MODELS: list[str] = [
        "gemini-3.1-pro-preview",
        "gemini-3.1-flash-lite-preview",
        "gemini-3-flash-preview",
    ]

    SESSION_MAX_TURNS: int = 5
    SESSION_PROMPT_TURNS: int = 5


settings = Settings()
