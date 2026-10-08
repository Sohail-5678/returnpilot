"""Per-turn tool set: MCP `commerce` tools bound to the signed-in customer + local tools.

MCP tool definitions are listed once per process and cached; each turn converts them with
a connection whose headers carry the customer/thread ids from the verified JWT.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any

from langchain_core.tools import BaseTool
from langchain_mcp_adapters.sessions import create_session
from langchain_mcp_adapters.tools import convert_mcp_tool_to_langchain_tool

from returnpilot.config import get_settings
from returnpilot.tools.local_tools import build_local_tools

log = logging.getLogger(__name__)

WRITE_TOOLS = frozenset({"create_return", "issue_refund"})
_defs_lock = asyncio.Lock()
_mcp_defs: list[Any] | None = None


def _connection(customer_id: uuid.UUID | None = None, thread_id: uuid.UUID | None = None) -> dict[str, Any]:
    s = get_settings()
    headers = {"X-Internal-Token": s.mcp_internal_token}
    if customer_id:
        headers["X-Customer-Id"] = str(customer_id)
    if thread_id:
        headers["X-Thread-Id"] = str(thread_id)
    return {"transport": "streamable_http", "url": s.mcp_url, "headers": headers, "timeout": 10, "sse_read_timeout": 15}


async def mcp_tool_definitions() -> list[Any]:
    global _mcp_defs
    if _mcp_defs is not None:
        return _mcp_defs
    async with _defs_lock:
        if _mcp_defs is None:
            async with create_session(_connection()) as session:  # type: ignore[arg-type]
                await session.initialize()
                _mcp_defs = list((await session.list_tools()).tools)
    return _mcp_defs


@dataclass
class ToolRuntime:
    customer_id: uuid.UUID
    thread_id: uuid.UUID
    tools: dict[str, BaseTool] = field(default_factory=dict)
    transcript: str = ""
    mcp_ok: bool = True

    @classmethod
    async def create(
        cls, customer_id: uuid.UUID, thread_id: uuid.UUID, descriptions: dict[str, str] | None = None
    ) -> ToolRuntime:
        rt = cls(customer_id=customer_id, thread_id=thread_id)
        tools: list[BaseTool] = []
        try:
            conn = _connection(customer_id, thread_id)
            for d in await mcp_tool_definitions():
                tools.append(convert_mcp_tool_to_langchain_tool(None, d, connection=conn))  # type: ignore[arg-type]
        except Exception as exc:  # noqa: BLE001 - degrade to local tools if the MCP server is down
            log.error("MCP tools unavailable: %s", exc)
            rt.mcp_ok = False
        tools.extend(build_local_tools(customer_id, thread_id, lambda: rt.transcript))
        for t in tools:  # tool descriptions are part of the optimizable agent profile
            if descriptions and descriptions.get(t.name):
                t.description = descriptions[t.name]
        rt.tools = {t.name: t for t in tools}
        return rt

    def list(self) -> list[BaseTool]:
        return list(self.tools.values())
