"""Runtime configuration, read from environment variables (see docs/SPEC.md §17.1)."""

from __future__ import annotations

import base64
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    env: str = Field(default="dev", alias="APP_ENV")
    git_sha: str = Field(default="dev", alias="GIT_SHA")

    # Data stores
    database_url: str = Field(default="postgresql://postgres@127.0.0.1:5433/returnpilot", alias="DATABASE_URL")
    redis_url: str = Field(default="redis://127.0.0.1:6379/0", alias="REDIS_URL")
    db_pool_size: int = Field(default=3, alias="DB_POOL_SIZE")

    # Web → API auth (ES256; the web app holds the private key)
    jwt_public_key_b64: str = Field(default="", alias="JWT_PUBLIC_KEY")
    jwt_issuer: str = Field(default="returnpilot-web", alias="JWT_ISSUER")
    jwt_audience: str = Field(default="returnpilot-api", alias="JWT_AUDIENCE")
    allowed_origins: str = Field(default="http://localhost:3000", alias="ALLOWED_ORIGINS")

    # LLM providers
    groq_api_key: str = Field(default="", alias="GROQ_API_KEY")
    groq_model_main: str = Field(default="llama-3.3-70b-versatile", alias="GROQ_MODEL_MAIN")
    groq_model_small: str = Field(default="llama-3.1-8b-instant", alias="GROQ_MODEL_SMALL")
    gemini_api_key: str = Field(default="", alias="GEMINI_API_KEY")
    gemini_model_fallback: str = Field(default="gemini-flash-latest", alias="GEMINI_MODEL_FALLBACK")
    gemini_model_fallback_small: str = Field(default="gemini-flash-lite-latest", alias="GEMINI_MODEL_FALLBACK_SMALL")
    gemini_embed_model: str = Field(default="gemini-embedding-001", alias="GEMINI_EMBED_MODEL")
    embed_dim: int = Field(default=768, alias="EMBED_DIM")
    fake_llm: bool = Field(default=False, alias="FAKE_LLM")
    llm_timeout_s: float = Field(default=20.0, alias="LLM_TIMEOUT_S")

    # Free-tier daily request caps (quota guard skips a provider at 90%)
    daily_limit_groq_main: int = Field(default=1000, alias="DAILY_LIMIT_GROQ_MAIN")
    daily_limit_groq_small: int = Field(default=14400, alias="DAILY_LIMIT_GROQ_SMALL")
    daily_limit_gemini: int = Field(default=250, alias="DAILY_LIMIT_GEMINI")
    daily_limit_gemini_embed: int = Field(default=1000, alias="DAILY_LIMIT_GEMINI_EMBED")

    # Internal services
    mcp_url: str = Field(default="http://127.0.0.1:8765/mcp", alias="MCP_URL")
    mcp_internal_token: str = Field(default="dev-mcp-token", alias="MCP_INTERNAL_TOKEN")
    cron_token: str = Field(default="dev-cron-token", alias="CRON_TOKEN")

    # Business rules & demo
    refund_auto_approve_limit: float = Field(default=50.0, alias="REFUND_AUTO_APPROVE_LIMIT")
    approval_ttl_hours: int = Field(default=24, alias="APPROVAL_TTL_HOURS")
    demo_mode: bool = Field(default=True, alias="DEMO_MODE")
    retention_days: int = Field(default=30, alias="RETENTION_DAYS")

    # Limits (SPEC §10)
    max_message_chars: int = 2000
    rate_user_per_min: int = Field(default=20, alias="RATE_USER_PER_MIN")
    rate_ip_per_min: int = Field(default=60, alias="RATE_IP_PER_MIN")
    rate_thread_per_hour: int = Field(default=30, alias="RATE_THREAD_PER_HOUR")
    max_agent_steps: int = 8
    max_turn_tokens: int = 12_000

    @property
    def jwt_public_key(self) -> str:
        if not self.jwt_public_key_b64:
            return ""
        raw = self.jwt_public_key_b64.strip()
        if raw.startswith("-----BEGIN"):
            return raw
        return base64.b64decode(raw).decode()

    @property
    def sqlalchemy_url(self) -> str:
        url = self.database_url
        for prefix in ("postgresql+psycopg://", "postgresql://", "postgres://"):
            if url.startswith(prefix):
                return "postgresql+psycopg://" + url[len(prefix) :]
        return url

    @property
    def psycopg_url(self) -> str:
        url = self.database_url
        if url.startswith("postgresql+psycopg://"):
            return "postgresql://" + url[len("postgresql+psycopg://") :]
        return url

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def llm_available(self) -> bool:
        return self.fake_llm or bool(self.groq_api_key or self.gemini_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
