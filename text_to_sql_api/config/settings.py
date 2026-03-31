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
    SUPABASE_URL: str = ""
    DATABASE_URL: str = "postgresql+psycopg2://analyst_user:analyst_user123@storage.bhugoal.cloud:54321/degreefyd_online_lms"
    GEMINI_MODEL: str = "gemini-3.1-flash-lite-preview"

    KNOWLEDGE_BASE_DIR: str = str(ROOT_DIR / "knowledge_base")
    DATA_DIR: str = str(BASE_DIR / "data")

    ALLOWED_MODELS: list[str] = [
        "gemini-3.1-pro-preview",
        "gemini-3.1-flash-lite-preview",
        "gemini-3-flash-preview",
    ]

    SESSION_MAX_TURNS: int = 5  # Load last 5 turns for conversational context
    SESSION_PROMPT_TURNS: int = 5


settings = Settings()
