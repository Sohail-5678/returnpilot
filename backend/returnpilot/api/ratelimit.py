"""Redis fixed-window rate limits (SPEC §10.4): per user, per IP, per thread."""

from __future__ import annotations

import logging
import time

from redis import asyncio as aioredis

from returnpilot.api.errors import ApiError
from returnpilot.config import get_settings

log = logging.getLogger(__name__)
_client: aioredis.Redis | None = None


def client() -> aioredis.Redis:
    global _client
    if _client is None:
        _client = aioredis.Redis.from_url(get_settings().redis_url, socket_timeout=1, socket_connect_timeout=1)
    return _client


async def hit(key: str, limit: int, window_s: int) -> bool:
    """Count a hit; True if still within the limit. Fails open if Redis is unavailable."""
    bucket = int(time.time() // window_s)
    k = f"rl:{key}:{bucket}"
    try:
        pipe = client().pipeline()
        pipe.incr(k)
        pipe.expire(k, window_s + 5)
        count, _ = await pipe.execute()
        return int(count) <= limit
    except Exception as exc:  # noqa: BLE001
        log.info("rate limit check skipped: %s", exc)
        return True


async def enforce(key: str, limit: int, window_s: int, message: str) -> None:
    if not await hit(key, limit, window_s):
        raise ApiError(429, "rate_limited", message)


async def check_message(user_key: str, ip: str | None, thread_id: str) -> None:
    s = get_settings()
    if s.eval_mode:  # isolated eval runs have no shared users to protect (and may have no Redis)
        return
    await enforce(f"u:{user_key}", s.rate_user_per_min, 60, "You're sending messages quickly. Please wait a moment.")
    if ip:
        await enforce(f"ip:{ip}", s.rate_ip_per_min, 60, "Too many requests from your network. Please wait a minute.")
    await enforce(
        f"t:{thread_id}",
        s.rate_thread_per_hour,
        3600,
        "This conversation hit its hourly limit. Start a new chat or try later.",
    )
