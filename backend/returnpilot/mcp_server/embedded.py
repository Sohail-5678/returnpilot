"""Host the MCP `commerce` server inside the API process (MCP_EMBEDDED=true).

It is still a real MCP server on its own port bound to 127.0.0.1 and the agent still reaches
it over Streamable HTTP; sharing the Python process just saves ~100 MB, which keeps the whole
stack under Render's 512 MB free tier. `python -m returnpilot.mcp_server` runs it standalone.
"""

from __future__ import annotations

import asyncio
import logging
from urllib.parse import urlparse

import uvicorn

from returnpilot.config import get_settings
from returnpilot.mcp_server.__main__ import build_app

log = logging.getLogger(__name__)


class EmbeddedMCP:
    def __init__(self, host: str = "127.0.0.1", port: int | None = None) -> None:
        if port is None:
            port = urlparse(get_settings().mcp_url).port or 8765
        # log_config/log_level None: don't reconfigure uvicorn's shared loggers (the API server owns them).
        self.config = uvicorn.Config(build_app(), host=host, port=port, log_config=None, log_level=None, lifespan="on")
        self.server = uvicorn.Server(self.config)
        self.task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        # startup/main_loop/shutdown directly (not serve()) so the outer server keeps its signal handlers.
        self.config.load()
        self.server.lifespan = self.config.lifespan_class(self.config)
        await self.server.startup()
        self.task = asyncio.create_task(self.server.main_loop())
        log.info("embedded MCP server listening on %s:%s", self.config.host, self.config.port)

    async def stop(self) -> None:
        self.server.should_exit = True
        if self.task:
            await self.task
        await self.server.shutdown()
