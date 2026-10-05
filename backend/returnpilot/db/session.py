"""Database engines. Async for the API/agent/MCP server, sync for Celery jobs and scripts.

Neon's pooled endpoint runs PgBouncer in transaction mode, so server-side prepared
statements are disabled (`prepare_threshold=None`).
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager, contextmanager
from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session, sessionmaker

from returnpilot.config import get_settings

_CONNECT_ARGS = {"prepare_threshold": None}


@lru_cache
def async_engine() -> AsyncEngine:
    s = get_settings()
    return create_async_engine(
        s.sqlalchemy_url,
        pool_size=s.db_pool_size,
        max_overflow=2,
        pool_pre_ping=True,
        pool_recycle=240,
        connect_args=_CONNECT_ARGS,
    )


@lru_cache
def sync_engine() -> Engine:
    s = get_settings()
    return create_engine(
        s.sqlalchemy_url,
        pool_size=2,
        max_overflow=1,
        pool_pre_ping=True,
        pool_recycle=240,
        connect_args=_CONNECT_ARGS,
    )


@lru_cache
def _async_factory() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(async_engine(), expire_on_commit=False)


@lru_cache
def _sync_factory() -> sessionmaker[Session]:
    return sessionmaker(sync_engine(), expire_on_commit=False)


@asynccontextmanager
async def db_session() -> AsyncIterator[AsyncSession]:
    """Unit of work: commits on success, rolls back on error."""
    session = _async_factory()()
    try:
        yield session
        await session.commit()
    except BaseException:
        await session.rollback()
        raise
    finally:
        await session.close()


@contextmanager
def sync_session() -> Iterator[Session]:
    session = _sync_factory()()
    try:
        yield session
        session.commit()
    except BaseException:
        session.rollback()
        raise
    finally:
        session.close()
