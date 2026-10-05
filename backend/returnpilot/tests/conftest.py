"""Integration fixtures: real Postgres (+pgvector) and Redis, the real FastAPI app with its lifespan
(embedded MCP server on a free port) and the scripted fake LLM. Tokens are minted with a
throwaway ES256 key, exactly like the web app does."""

from __future__ import annotations

import base64
import os
import socket
import time
import uuid
from collections.abc import AsyncIterator
from typing import Any

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


_KEY = ec.generate_private_key(ec.SECP256R1())
PRIVATE_PEM = _KEY.private_bytes(
    serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
)
_PUBLIC = _KEY.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)

os.environ.update(
    {
        "DATABASE_URL": os.environ.get("TEST_DATABASE_URL", "postgresql://postgres@127.0.0.1:5433/returnpilot_test"),
        "REDIS_URL": os.environ.get("TEST_REDIS_URL", "redis://127.0.0.1:6379/15"),
        "JWT_PUBLIC_KEY": base64.b64encode(_PUBLIC).decode(),
        "FAKE_LLM": "true",
        "DEMO_MODE": "true",
        "MCP_EMBEDDED": "true",
        "MCP_URL": f"http://127.0.0.1:{_free_port()}/mcp",
        "MCP_INTERNAL_TOKEN": "test-mcp-token",
        "CRON_TOKEN": "test-cron-token",
        "GROQ_API_KEY": "",
        "GEMINI_API_KEY": "",
        "RATE_USER_PER_MIN": "1000",
        "RATE_IP_PER_MIN": "1000",
        "RATE_THREAD_PER_HOUR": "1000",
    }
)


def mint(persona: str, role: str, ws: str, *, sub: str | None = None, exp_in: int = 300, **extra: Any) -> str:
    import jwt

    now = int(time.time())
    claims = {
        "iss": "returnpilot-web",
        "aud": "returnpilot-api",
        "iat": now,
        "exp": now + exp_in,
        "sub": sub or f"demo:{persona}",
        "role": role,
        "persona": persona,
        "ws": ws,
        "name": persona.title(),
        "sid": uuid.uuid4().hex,
        **extra,
    }
    return jwt.encode(claims, PRIVATE_PEM, algorithm="ES256")


@pytest.fixture(scope="session")
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture(scope="session", autouse=True)
def database() -> None:
    from returnpilot.db.bootstrap import migrate
    from returnpilot.db.seed import seed_if_empty
    from returnpilot.db.session import sync_session

    migrate()
    with sync_session() as s:
        seed_if_empty(s)


@pytest.fixture(scope="session")
async def app() -> AsyncIterator[Any]:
    from returnpilot.api.main import app as fastapi_app
    from returnpilot.rag.ingest import ingest

    await ingest()
    async with fastapi_app.router.lifespan_context(fastapi_app):
        yield fastapi_app


@pytest.fixture
async def client(app: Any) -> AsyncIterator[Any]:
    import httpx

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", timeout=60) as c:
        yield c


class Persona:
    def __init__(self, client: Any, persona: str, role: str, ws: str) -> None:
        self.client, self.persona, self.role, self.ws = client, persona, role, ws

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {mint(self.persona, self.role, self.ws)}"}

    async def get(self, path: str) -> Any:
        return await self.client.get(path, headers=self.headers)

    async def post(self, path: str, json: Any = None) -> Any:
        return await self.client.post(path, headers=self.headers, json=json if json is not None else {})

    async def chat(self, thread_id: str, text: str) -> list[tuple[str, dict[str, Any]]]:
        import json as _json

        events: list[tuple[str, dict[str, Any]]] = []
        async with self.client.stream(
            "POST", f"/v1/threads/{thread_id}/messages", headers=self.headers, json={"text": text}
        ) as r:
            assert r.status_code == 200, await r.aread()
            event = None
            async for line in r.aiter_lines():
                if line.startswith("event: "):
                    event = line[7:]
                elif line.startswith("data: ") and event:
                    events.append((event, _json.loads(line[6:])))
        return events

    async def new_thread(self) -> str:
        r = await self.post("/v1/threads")
        assert r.status_code == 201, r.text
        return str(r.json()["thread_id"])


@pytest.fixture
def ws() -> str:
    return str(uuid.uuid4())


@pytest.fixture
def maya(client: Any, ws: str) -> Persona:
    return Persona(client, "maya", "customer", ws)


@pytest.fixture
def arjun(client: Any, ws: str) -> Persona:
    return Persona(client, "arjun", "customer", ws)


@pytest.fixture
def lena(client: Any, ws: str) -> Persona:
    return Persona(client, "lena", "customer", ws)


@pytest.fixture
def reviewer(client: Any, ws: str) -> Persona:
    return Persona(client, "reviewer", "reviewer", ws)


@pytest.fixture
def admin(client: Any, ws: str) -> Persona:
    return Persona(client, "admin", "admin", ws)
