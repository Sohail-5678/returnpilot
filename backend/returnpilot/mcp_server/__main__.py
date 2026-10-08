"""Run the `commerce` MCP server: `python -m returnpilot.mcp_server --host 127.0.0.1 --port 8765`."""

from __future__ import annotations

import argparse
import hmac
from typing import Any

import uvicorn

from returnpilot.config import get_settings
from returnpilot.mcp_server.tools import mcp


class InternalTokenMiddleware:
    """Reject any HTTP request without the shared `X-Internal-Token` (except /healthz)."""

    def __init__(self, app: Any, token: str) -> None:
        self.app = app
        self.token = token.encode()

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope["type"] == "http" and scope.get("path") != "/healthz":
            supplied = dict(scope.get("headers") or []).get(b"x-internal-token", b"")
            if not hmac.compare_digest(supplied, self.token):
                await send(
                    {"type": "http.response.start", "status": 401, "headers": [(b"content-type", b"application/json")]}
                )
                await send({"type": "http.response.body", "body": b'{"error":"unauthorized"}'})
                return
        await self.app(scope, receive, send)


def build_app() -> Any:
    # A session manager can only run once, so every (re)start gets a fresh one.
    mcp._session_manager = None  # noqa: SLF001
    return InternalTokenMiddleware(mcp.streamable_http_app(), get_settings().mcp_internal_token)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    uvicorn.run(build_app(), host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
