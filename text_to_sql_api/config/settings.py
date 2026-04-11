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
    REGULAR_AMITY_LMS_URL: str = ""
    REGULAR_CGC_LMS_URL: str = ""

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

    # Maps database_id → (settings attribute name for URL, knowledge-base category)
    # Add new entries here when a new client DB is provisioned.
    @property
    def DATABASE_MAP(self) -> dict[str, dict]:
        return {
            "degreefyd_online_lms": {
                "url": self.ONLINE_LMS_URL,
                "kb_category": "online",
            },
            "degreefyd_regular_lms": {
                "url": self.REGULAR_LMS_URL,
                "kb_category": "regular",
            },
            "degreefyd_regular_amity_lms": {
                "url": self.REGULAR_AMITY_LMS_URL,
                "kb_category": "regular",
            },
            "degreefyd_regular_cgc_lms": {
                "url": self.REGULAR_CGC_LMS_URL,
                "kb_category": "regular",
            },
        }

    def get_db_url(self, database_id: str) -> str:
        """Return the connection URL for a given database_id."""
        entry = self.DATABASE_MAP.get(database_id)
        if not entry:
            raise ValueError(f"Unknown database_id '{database_id}'. Valid IDs: {list(self.DATABASE_MAP)}")
        url = entry["url"]
        if not url:
            raise ValueError(f"No URL configured for database_id '{database_id}'. Set the matching env var.")
        return url

    def get_kb_category(self, database_id: str) -> str:
        """Return 'online' or 'regular' for a given database_id."""
        entry = self.DATABASE_MAP.get(database_id)
        if not entry:
            raise ValueError(f"Unknown database_id '{database_id}'. Valid IDs: {list(self.DATABASE_MAP)}")
        return entry["kb_category"]

    @property
    def VALID_DATABASE_IDS(self) -> list[str]:
        return list(self.DATABASE_MAP.keys())


settings = Settings()
