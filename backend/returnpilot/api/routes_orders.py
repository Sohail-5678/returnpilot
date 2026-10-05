"""/v1/orders, /v1/memories, /v1/policies."""

from __future__ import annotations

import uuid
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query, Response

from returnpilot.api.deps import Principal, any_role, customer_only
from returnpilot.api.errors import ApiError
from returnpilot.api.views import order_detail, order_list
from returnpilot.db.session import db_session
from returnpilot.memory import store
from returnpilot.policy.facts import get_customer_order
from returnpilot.rag.retrieve import get_section, list_sections

router = APIRouter(prefix="/v1")


@router.get("/orders")
async def orders(
    status: Literal["processing", "shipped", "delivered", "cancelled"] | None = Query(default=None),
    p: Principal = Depends(customer_only),
) -> dict[str, Any]:
    assert p.customer_id
    return {"orders": await order_list(p.customer_id, status)}


@router.get("/orders/{order_id}")
async def order(order_id: str, p: Principal = Depends(customer_only)) -> dict[str, Any]:
    assert p.customer_id
    async with db_session() as s:
        o = await get_customer_order(s, p.customer_id, order_id)
    if o is None:
        raise ApiError(404, "not_found", "Order not found.")
    return await order_detail(o)


@router.get("/memories")
async def memories(p: Principal = Depends(customer_only)) -> dict[str, Any]:
    assert p.customer_id
    rows = await store.list_memories(p.customer_id)
    return {
        "memories": [
            {
                "id": str(m.id),
                "content": m.content,
                "kind": m.kind,
                "created_at": m.created_at.isoformat(),
                "updated_at": m.updated_at.isoformat(),
                "source_thread_id": str(m.source_thread_id) if m.source_thread_id else None,
            }
            for m in rows
        ]
    }


@router.delete("/memories/{memory_id}", status_code=204)
async def forget(memory_id: uuid.UUID, p: Principal = Depends(customer_only)) -> Response:
    assert p.customer_id
    if not await store.delete_memory(p.customer_id, memory_id):
        raise ApiError(404, "not_found", "Memory not found.")
    return Response(status_code=204)


@router.get("/policies")
async def policies(_: Principal = Depends(any_role)) -> dict[str, Any]:
    return {"docs": await list_sections()}


@router.get("/policies/{section_id}")
async def policy_section(section_id: str, _: Principal = Depends(any_role)) -> dict[str, Any]:
    sec = await get_section(section_id)
    if sec is None:
        raise ApiError(404, "not_found", "Policy section not found.")
    return sec
