"""FastAPI app: `uvicorn returnpilot.api.main:app`."""

from __future__ import annotations

import contextlib
import logging
import os
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from returnpilot.api import errors, routes_admin, routes_chat, routes_orders, routes_reviews, routes_runs
from returnpilot.api.ratelimit import client as redis_client
from returnpilot.api.runtime import runtime
from returnpilot.config import get_settings
from returnpilot.db.session import db_session

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("returnpilot.api")
for noisy in ("httpx", "mcp", "mcp.server", "mcp.client"):
    logging.getLogger(noisy).setLevel(logging.WARNING)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    mcp = None
    if get_settings().mcp_embedded:
        from returnpilot.mcp_server.embedded import EmbeddedMCP

        mcp = EmbeddedMCP()
        await mcp.start()
    await runtime.start()
    try:
        from returnpilot.agent.tools_runtime import mcp_tool_definitions

        await mcp_tool_definitions()
    except Exception as exc:  # noqa: BLE001 - MCP may still be starting; tools load lazily
        log.warning("MCP tool warm-up skipped: %s", exc)
    yield
    await runtime.stop()
    if mcp:
        await mcp.stop()


app = FastAPI(title="ReturnPilot API", version="1.0.0", lifespan=lifespan, docs_url="/docs", redoc_url=None)
errors.install(app)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-Request-Id"],
)


@app.middleware("http")
async def request_id(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
    rid = request.headers.get("x-request-id") or uuid.uuid4().hex
    response = await call_next(request)
    response.headers["X-Request-Id"] = rid
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


for module in (routes_chat, routes_orders, routes_reviews, routes_runs, routes_admin):
    app.include_router(module.router)


def _rss_by_process() -> dict[str, int]:
    """RSS in MB per process in this container (Linux /proc); falls back to this process only."""
    out: dict[str, int] = {}
    proc = Path("/proc")
    if not proc.exists():
        import resource

        out["web"] = int(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 * 1024))
        return out
    uid = os.getuid()
    for status in proc.glob("[0-9]*/status"):
        try:
            fields = dict(line.split(":", 1) for line in status.read_text().splitlines() if ":" in line)
            if int(fields.get("Uid", "-1").split()[0]) != uid or "VmRSS" not in fields:
                continue
            cmd = (status.parent / "cmdline").read_bytes().replace(b"\0", b" ").decode(errors="ignore")
            label = (
                "redis"
                if "redis-server" in cmd
                else "mcp"
                if "mcp_server" in cmd
                else "beat"
                if " beat" in cmd
                else "worker"
                if "celery" in cmd
                else "web"
                if "uvicorn" in cmd
                else "honcho"
                if "honcho" in cmd
                else None
            )
            if not label:
                continue
            out[label] = out.get(label, 0) + int(fields["VmRSS"].split()[0]) // 1024
        except (OSError, ValueError, IndexError):
            continue
    return out


@app.get("/healthz")
async def healthz() -> dict[str, Any]:
    s = get_settings()
    db_ok = redis_ok = mcp_ok = False
    try:
        async with db_session() as session:
            await session.execute(text("SELECT 1"))
        db_ok = True
    except Exception:  # noqa: BLE001
        pass
    with contextlib.suppress(Exception):
        redis_ok = bool(await redis_client().ping())
    try:
        async with httpx.AsyncClient(timeout=2) as http:
            mcp_ok = (await http.get(s.mcp_url.rsplit("/mcp", 1)[0] + "/healthz")).status_code == 200
    except Exception:  # noqa: BLE001
        pass
    rss = _rss_by_process()
    return {
        "status": "ok" if db_ok and redis_ok and mcp_ok else "degraded",
        "db": db_ok,
        "redis": redis_ok,
        "mcp": mcp_ok,
        "llm": "fake" if s.fake_llm else ("groq" if s.groq_api_key else ("gemini" if s.gemini_api_key else "none")),
        "rss_mb": {"total": sum(rss.values()), **rss},
        "version": s.git_sha,
    }
