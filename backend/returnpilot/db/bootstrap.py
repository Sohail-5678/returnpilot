"""Container start-up (SPEC §14.4): seed if empty, ingest policies if changed, create LangGraph
tables, backfill memory embeddings, reconcile queued jobs. Safe to run on every boot."""

from __future__ import annotations

import asyncio
import logging

from psycopg import AsyncConnection
from psycopg.rows import dict_row

from returnpilot.config import get_settings
from returnpilot.db.seed import seed_if_empty
from returnpilot.db.session import sync_session

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("returnpilot.bootstrap")


async def _async_steps() -> None:
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

    from returnpilot.memory.store import backfill_embeddings
    from returnpilot.rag.ingest import ingest

    async with await AsyncConnection.connect(
        get_settings().psycopg_url, autocommit=True, prepare_threshold=None, row_factory=dict_row
    ) as conn:
        await AsyncPostgresSaver(conn).setup()  # type: ignore[arg-type]
    log.info("checkpointer tables ready")
    log.info("policy ingest: %s", await ingest())
    log.info("memory embeddings backfilled: %s", await backfill_embeddings())


def main() -> None:
    with sync_session() as s:
        log.info("seeded: %s", seed_if_empty(s))
    asyncio.run(_async_steps())
    try:
        from returnpilot.jobs.tasks import reconcile_jobs

        log.info("re-enqueued jobs: %s", reconcile_jobs(older_than_s=0))
    except Exception as exc:  # noqa: BLE001 - Redis may not be up yet; the worker retries later
        log.warning("job reconcile skipped: %s", exc)


if __name__ == "__main__":
    main()
