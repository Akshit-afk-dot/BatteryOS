from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

API_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    """Runtime configuration. Every value can be overridden with an environment
    variable of the same name (case-insensitive) or a `.env` file in services/api."""

    model_config = SettingsConfigDict(env_file=API_ROOT / ".env", extra="ignore")

    environment: str = "development"
    database_url: str = f"sqlite:///{(API_ROOT / 'data' / 'batteryos.db').as_posix()}"
    storage_dir: Path = API_ROOT / "data" / "storage"

    # Comma-separated list of browser origins allowed to call the API directly.
    # The web app normally proxies /api through Next.js, so this is only needed
    # when the frontend is served from a different origin.
    cors_origins: str = "http://localhost:3000"

    session_cookie_name: str = "bos_session"
    session_ttl_hours: int = 24 * 14
    # Set to true in production (HTTPS). Cookies marked Secure are not sent over http://.
    cookie_secure: bool = False

    max_upload_bytes: int = 25 * 1024 * 1024
    max_csv_rows: int = 500_000

    # AI assistant. When no key is configured the app still works: report and
    # quotation drafts fall back to deterministic templates, clearly labelled.
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-opus-5-5"
    ai_enabled: bool = True

    invitation_ttl_days: int = 7

    # Apply database migrations when the API starts. Turn off if you run
    # `alembic upgrade head` as a separate deploy step.
    auto_migrate: bool = True

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def ai_configured(self) -> bool:
        return self.ai_enabled and bool(self.anthropic_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
