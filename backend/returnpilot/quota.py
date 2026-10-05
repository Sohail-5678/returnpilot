"""Free-tier quota guard (SPEC §8.2).

Every LLM/embedding request is counted per provider per UTC day in `usage_counters`.
A request is only allowed while usage is below 90% of the configured daily limit, so the
app degrades to the next provider (and finally to read-only demo mode) before the
provider starts returning 429s.
"""

from __future__ import annotations

import logging

from sqlalchemy import text

from returnpilot.db.session import db_session

log = logging.getLogger(__name__)

_RESERVE = text(
    """
    INSERT INTO usage_counters (day, provider, kind, count)
    VALUES ((now() AT TIME ZONE 'utc')::date, :provider, :kind, 1)
    ON CONFLICT (day, provider, kind) DO UPDATE SET count = usage_counters.count + 1
    WHERE usage_counters.count < :threshold
    RETURNING count
    """
)


def threshold(limit: int) -> int:
    return max(1, int(limit * 0.9))


async def reserve(provider: str, kind: str, limit: int) -> bool:
    """Count one request. Returns False (skip this provider) once usage reaches 90% of `limit`."""
    try:
        async with db_session() as s:
            row = (
                await s.execute(_RESERVE, {"provider": provider, "kind": kind, "threshold": threshold(limit)})
            ).first()
        return row is not None
    except Exception:  # fail open: a counting glitch must not take the agent down
        log.exception("quota reserve failed for %s/%s", provider, kind)
        return True


async def usage_today() -> dict[tuple[str, str], int]:
    async with db_session() as s:
        rows = (
            await s.execute(
                text("SELECT provider, kind, count FROM usage_counters WHERE day = (now() AT TIME ZONE 'utc')::date")
            )
        ).all()
    return {(r.provider, r.kind): r.count for r in rows}
