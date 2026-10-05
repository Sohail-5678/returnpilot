"""Auth matrix (role × route), token validation and object-level isolation (SPEC §10.1, §13.4)."""

from __future__ import annotations

import uuid

import pytest

from returnpilot.tests.conftest import mint

ROUTES = [
    ("GET", "/v1/threads", {"customer"}),
    ("GET", "/v1/orders", {"customer"}),
    ("GET", "/v1/memories", {"customer"}),
    ("GET", "/v1/approvals", {"reviewer", "admin"}),
    ("GET", "/v1/admin/metrics", {"admin"}),
    ("GET", "/v1/runs", {"customer", "admin"}),
    ("GET", "/v1/policies", {"customer", "reviewer", "admin"}),
    ("GET", "/v1/me", {"customer", "reviewer", "admin"}),
]
PERSONA_FOR = {"customer": "maya", "reviewer": "reviewer", "admin": "admin"}


@pytest.mark.parametrize(("method", "path", "allowed"), ROUTES)
@pytest.mark.parametrize("role", ["customer", "reviewer", "admin"])
async def test_role_matrix(client, ws, method, path, allowed, role) -> None:  # type: ignore[no-untyped-def]
    token = mint(PERSONA_FOR[role], role, ws)
    r = await client.request(method, path, headers={"Authorization": f"Bearer {token}"})
    assert (r.status_code == 200) == (role in allowed), (role, path, r.status_code, r.text)
    if role not in allowed:
        assert r.status_code == 403
        assert r.json()["error"]["code"] == "forbidden"


async def test_missing_and_bad_tokens(client, ws) -> None:  # type: ignore[no-untyped-def]
    assert (await client.get("/v1/me")).status_code == 401
    assert (await client.get("/v1/me", headers={"Authorization": "Bearer nope"})).status_code == 401
    expired = mint("maya", "customer", ws, exp_in=-60)
    r = await client.get("/v1/me", headers={"Authorization": f"Bearer {expired}"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "unauthorized"


async def test_persona_role_mismatch_is_forbidden(client, ws) -> None:  # type: ignore[no-untyped-def]
    token = mint("maya", "admin", ws)  # a demo customer persona can't claim the admin role
    assert (await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})).status_code == 403


async def test_customers_only_see_their_own_data(maya, arjun) -> None:  # type: ignore[no-untyped-def]
    assert (await maya.get("/v1/orders/1042")).status_code == 200
    assert (await maya.get("/v1/orders/1038")).status_code == 404  # Arjun's order number
    arjun_thread = await arjun.new_thread()
    assert (await maya.get(f"/v1/threads/{arjun_thread}")).status_code == 404
    r = await maya.post(f"/v1/threads/{arjun_thread}/messages", {"text": "hi"})
    assert r.status_code == 404


async def test_workspaces_are_isolated(client) -> None:  # type: ignore[no-untyped-def]
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    me_a = (await client.get("/v1/me", headers={"Authorization": f"Bearer {mint('maya', 'customer', a)}"})).json()
    me_b = (await client.get("/v1/me", headers={"Authorization": f"Bearer {mint('maya', 'customer', b)}"})).json()
    assert me_a["customer"]["id"] != me_b["customer"]["id"]
    assert me_a["customer"]["name"] == me_b["customer"]["name"] == "Maya Patel"


async def test_message_validation(maya) -> None:  # type: ignore[no-untyped-def]
    thread = await maya.new_thread()
    r = await maya.post(f"/v1/threads/{thread}/messages", {"text": "x" * 2001})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"


async def test_health_reports_components(client) -> None:  # type: ignore[no-untyped-def]
    body = (await client.get("/healthz")).json()
    assert body["db"] and body["redis"] and body["mcp"]
    assert body["llm"] == "fake"
