from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "docker-platform-api"
    app_env: Literal["dev", "test", "prod"] = "dev"
    app_debug: bool = False

    database_url: str = Field(
        default="postgresql+asyncpg://postgres:postgres@localhost:5432/docker_platform"
    )
    redis_url: str = "redis://localhost:6379/0"

    jwt_secret_key: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_minutes: int = 60 * 24 * 7

    upload_dir: str = "storage/uploads"
    max_upload_size_mb: int = 30
    project_draft_ttl_seconds: int = 3600


@lru_cache
def get_settings() -> Settings:
    return Settings()
