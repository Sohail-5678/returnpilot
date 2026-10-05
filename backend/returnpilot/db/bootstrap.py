"""Container start-up (SPEC §14.4): migrations, seed if empty, ingest policies if changed, create
LangGraph tables, backfill memory embeddings. Safe to run on every boot.

Render's free instance has 0.1 CPU and sleeps after 15 idle minutes, so this runs on every
wake-up. When this exact commit was already bootstrapped, it exits after a single query.
"""

from __future__ import annotations

import asyncio
import logging
import os

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("returnpilot.bootstrap")

_META = "CREATE TABLE IF NOT EXISTS app_meta (key text PRIMARY KEY, value text NOT NULL, updated_at timestamptz DEFAULT now())"


def _commit() -> str:
    return os.environ.get("RENDER_GIT_COMMIT", "") or "dev"


def already_bootstrapped() -> bool:
    if _commit() == "dev":
        return False
    import psycopg

    from returnpilot.config import get_settings

    try:
        with psycopg.connect(get_settings().psycopg_url, prepare_threshold=None, connect_timeout=30) as conn:
            row = conn.execute("SELECT value FROM app_meta WHERE key = 'bootstrap_commit'").fetchone()
    except psycopg.errors.UndefinedTable:
        return False
    return bool(row and row[0] == _commit())


def mark_bootstrapped() -> None:
    import psycopg

    from returnpilot.config import get_settings

    with psycopg.connect(get_settings().psycopg_url, prepare_threshold=None, autocommit=True) as conn:
        conn.execute(_META)
        conn.execute(
            "INSERT INTO app_meta (key, value) VALUES ('bootstrap_commit', %s) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
            (_commit(),),
        )


def migrate() -> None:
    from pathlib import Path

    from alembic import command
    from alembic.config import Config

    cfg = Config(str(Path(__file__).resolve().parents[2] / "alembic.ini"))
    cfg.set_main_option("script_location", str(Path(__file__).resolve().parent / "migrations"))
    command.upgrade(cfg, "head")
    log.info("migrations at head")


async def _async_steps() -> None:
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
    from psycopg import AsyncConnection
    from psycopg.rows import dict_row

    from returnpilot.config import get_settings
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
    if already_bootstrapped():
        log.info("commit %s already bootstrapped; skipping", _commit()[:8])
        return
    from returnpilot.db.seed import seed_if_empty
    from returnpilot.db.session import sync_session

    migrate()
    with sync_session() as s:
        log.info("seeded: %s", seed_if_empty(s))
    asyncio.run(_async_steps())
    mark_bootstrapped()
    # Queued jobs are re-enqueued by the Celery worker once it is connected (jobs/tasks.py: worker_ready).


if __name__ == "__main__":
    main()
