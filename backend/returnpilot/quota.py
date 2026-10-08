"""Free-tier quota guard (SPEC §8.2, §S.1).

Every LLM/embedding/classifier call is counted per provider and model slot per UTC day in
`usage_counters`: requests under `<slot>` and tokens under `<slot>:tokens`. A call is only
allowed while both are below 90% of ReturnPilot's daily budget for that slot, so the app moves
to the next provider (and finally to read-only demo mode) before a provider returns 429s.
Groq limits are per organization and shared with DataPilot and AgentForge, which is why the
budgets are ReturnPilot's *share*, not the full provider limit.
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
_TOKENS_USED = text(
    """
    SELECT count FROM usage_counters
    WHERE day = (now() AT TIME ZONE 'utc')::date AND provider = :provider AND kind = :kind
    """
)
_ADD = text(
    """
    INSERT INTO usage_counters (day, provider, kind, count)
    VALUES ((now() AT TIME ZONE 'utc')::date, :provider, :kind, :n)
    ON CONFLICT (day, provider, kind) DO UPDATE SET count = usage_counters.count + :n
    """
)


def threshold(limit: int) -> int:
    return max(1, int(limit * 0.9))


async def reserve(provider: str, slot: str, request_limit: int, token_limit: int | None = None) -> bool:
    """Count one request. False (skip this model) once requests or tokens reach 90% of the budget."""
    try:
        async with db_session() as s:
            if token_limit:
                used = (await s.execute(_TOKENS_USED, {"provider": provider, "kind": f"{slot}:tokens"})).scalar()
                if used is not None and used >= threshold(token_limit):
                    return False
            row = (
                await s.execute(_RESERVE, {"provider": provider, "kind": slot, "threshold": threshold(request_limit)})
            ).first()
        return row is not None
    except Exception:  # fail open: a counting glitch must not take the agent down
        log.exception("quota reserve failed for %s/%s", provider, slot)
        return True


async def add_tokens(provider: str, slot: str, tokens: int) -> None:
    if tokens <= 0:
        return
    try:
        async with db_session() as s:
            await s.execute(_ADD, {"provider": provider, "kind": f"{slot}:tokens", "n": tokens})
    except Exception:  # noqa: BLE001
        log.exception("token accounting failed for %s/%s", provider, slot)


async def usage_today() -> dict[tuple[str, str], int]:
    async with db_session() as s:
        rows = (
            await s.execute(
                text("SELECT provider, kind, count FROM usage_counters WHERE day = (now() AT TIME ZONE 'utc')::date")
            )
        ).all()
    return {(r.provider, r.kind): r.count for r in rows}
