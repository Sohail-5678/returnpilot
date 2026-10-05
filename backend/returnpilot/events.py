"""Thread live-update events over Redis pub/sub (approval decided, job finished, new message).

The API streams them to the browser via `GET /v1/threads/{id}/events`. Publishing is
best-effort: the browser also refetches the thread, which is the source of truth.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from returnpilot.config import get_settings

log = logging.getLogger(__name__)


def channel(thread_id: str) -> str:
    return f"rp:thread:{thread_id}"


def publish_sync(thread_id: str | None, event: str, data: dict[str, Any]) -> None:
    if not thread_id:
        return
    try:
        import redis

        client = redis.Redis.from_url(get_settings().redis_url, socket_timeout=2)
        client.publish(channel(str(thread_id)), json.dumps({"event": event, "data": data}, default=str))
    except Exception as exc:  # noqa: BLE001
        log.info("publish skipped: %s", exc)


async def publish(thread_id: str | None, event: str, data: dict[str, Any]) -> None:
    if not thread_id:
        return
    try:
        from redis import asyncio as aioredis

        client = aioredis.Redis.from_url(get_settings().redis_url, socket_timeout=2)
        try:
            await client.publish(channel(str(thread_id)), json.dumps({"event": event, "data": data}, default=str))
        finally:
            await client.aclose()
    except Exception as exc:  # noqa: BLE001
        log.info("publish skipped: %s", exc)
