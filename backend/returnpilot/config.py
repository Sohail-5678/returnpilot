"""Runtime configuration, read from environment variables (see docs/SPEC.md §17.1)."""

from __future__ import annotations

import base64
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    env: str = Field(default="dev", alias="APP_ENV")
    git_sha: str = Field(default="dev", alias="RENDER_GIT_COMMIT")

    # Data stores
    database_url: str = Field(default="postgresql://postgres@127.0.0.1:5433/returnpilot", alias="DATABASE_URL")
    redis_url: str = Field(default="redis://127.0.0.1:6379/0", alias="REDIS_URL")
    db_pool_size: int = Field(default=3, alias="DB_POOL_SIZE")

    # Web → API auth (ES256; the web app holds the private key)
    jwt_public_key_b64: str = Field(default="", alias="JWT_PUBLIC_KEY")
    jwt_issuer: str = Field(default="returnpilot-web", alias="JWT_ISSUER")
    jwt_audience: str = Field(default="returnpilot-api", alias="JWT_AUDIENCE")
    allowed_origins: str = Field(default="http://localhost:3000", alias="ALLOWED_ORIGINS")

    # LLM providers (SPEC §8.2, §S.1). Every model id is an env var; providers rename models often.
    gemini_api_key: str = Field(default="", alias="GEMINI_API_KEY")  # AI Studio project "returnpilot"
    main_model: str = Field(default="gemini-3-flash-preview", alias="MAIN_MODEL")  # agent with tools
    gemini_model_lite: str = Field(default="gemini-3.1-flash-lite-preview", alias="GEMINI_MODEL_LITE")
    gemini_thinking_level: str = Field(default="low", alias="GEMINI_THINKING_LEVEL")  # Gemini 3: low keeps turns ~1 s
    gemini_embed_model: str = Field(default="gemini-embedding-001", alias="GEMINI_EMBED_MODEL")
    embed_dim: int = Field(default=768, alias="EMBED_DIM")
    groq_api_key: str = Field(default="", alias="GROQ_API_KEY")
    fast_model: str = Field(default="openai/gpt-oss-120b", alias="FAST_MODEL")  # fast path + fallback
    small_model: str = Field(default="openai/gpt-oss-20b", alias="SMALL_MODEL")  # router, memory, summaries
    guard_model: str = Field(default="meta-llama/llama-prompt-guard-2-86m", alias="GUARD_MODEL")
    groq_reasoning_effort: str = Field(default="low", alias="GROQ_REASONING_EFFORT")
    fake_llm: bool = Field(default=False, alias="FAKE_LLM")
    fake_llm_fail_primary: bool = Field(default=False, alias="FAKE_LLM_FAIL_PRIMARY")  # evals: provider outage
    llm_timeout_s: float = Field(default=20.0, alias="LLM_TIMEOUT_S")

    # Daily budgets per model (requests and tokens). The quota guard skips a model at 90% of either.
    # Groq limits are per organization and shared with DataPilot/AgentForge: these are ReturnPilot's
    # shares from SPEC §S.1 (gpt-oss-120b 60%, gpt-oss-20b 30%). Gemini runs in its own project.
    daily_budget_main_requests: int = Field(default=1000, alias="DAILY_BUDGET_MAIN_REQUESTS")
    daily_budget_main_tokens: int = Field(default=3_000_000, alias="DAILY_BUDGET_MAIN_TOKENS")
    daily_budget_lite_requests: int = Field(default=1000, alias="DAILY_BUDGET_LITE_REQUESTS")
    daily_budget_lite_tokens: int = Field(default=2_000_000, alias="DAILY_BUDGET_LITE_TOKENS")
    daily_budget_fast_requests: int = Field(default=600, alias="DAILY_BUDGET_FAST_REQUESTS")
    daily_budget_fast_tokens: int = Field(default=120_000, alias="DAILY_BUDGET_FAST_TOKENS")
    daily_budget_small_requests: int = Field(default=300, alias="DAILY_BUDGET_SMALL_REQUESTS")
    daily_budget_small_tokens: int = Field(default=60_000, alias="DAILY_BUDGET_SMALL_TOKENS")
    daily_budget_guard_requests: int = Field(default=7200, alias="DAILY_BUDGET_GUARD_REQUESTS")
    daily_budget_embed_requests: int = Field(default=1000, alias="DAILY_BUDGET_EMBED_REQUESTS")

    # Prompt Guard 2 (a locked guardrail: never part of the agent profile)
    guard_threshold: float = Field(default=0.5, alias="GUARD_THRESHOLD")

    # AgentForge integration (SPEC §18)
    agentforge_url: str = Field(default="", alias="AGENTFORGE_URL")
    agentforge_key: str = Field(default="", alias="AGENTFORGE_KEY")
    profile_source: str = Field(default="bundled", alias="PROFILE_SOURCE")  # bundled | agentforge
    eval_mode: bool = Field(default=False, alias="EVAL_MODE")  # enables seed overrides (red-team hooks)
    celery_eager: bool = Field(default=False, alias="CELERY_TASK_ALWAYS_EAGER")
    # Published paid list prices (USD per 1M tokens in/out) so cost is measurable even at $0. Verify yearly.
    price_table_json: str = Field(default="", alias="PRICE_TABLE_JSON")

    # Internal services
    mcp_url: str = Field(default="http://127.0.0.1:8765/mcp", alias="MCP_URL")
    mcp_internal_token: str = Field(default="dev-mcp-token", alias="MCP_INTERNAL_TOKEN")
    mcp_embedded: bool = Field(default=False, alias="MCP_EMBEDDED")
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
    def price_table(self) -> dict[str, tuple[float, float]]:
        table = {
            "gemini-flash": (0.30, 2.50),
            "gemini-flash-lite": (0.10, 0.40),
            "gpt-oss-120b": (0.15, 0.60),
            "gpt-oss-20b": (0.075, 0.30),
            "prompt-guard": (0.03, 0.03),
            "gemini-embedding": (0.15, 0.0),
        }
        if self.price_table_json:
            import json

            table.update({k: (float(v[0]), float(v[1])) for k, v in json.loads(self.price_table_json).items()})
        return table

    @property
    def llm_available(self) -> bool:
        return self.fake_llm or bool(self.groq_api_key or self.gemini_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
