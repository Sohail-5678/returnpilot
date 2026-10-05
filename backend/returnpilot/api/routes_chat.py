"""/v1/me and /v1/threads (chat with SSE streaming, live thread events)."""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from redis import asyncio as aioredis
from sqlalchemy import delete, desc, select

from returnpilot.api import ratelimit
from returnpilot.api.deps import Principal, any_role, customer_only, customer_record
from returnpilot.api.errors import ApiError
from returnpilot.api.runtime import runtime
from returnpilot.api.serialize import to_ui_messages
from returnpilot.api.views import thread_actions
from returnpilot.config import get_settings
from returnpilot.db.models import Approval, Customer, Thread
from returnpilot.db.session import db_session
from returnpilot.events import channel

router = APIRouter(prefix="/v1")
SSE_HEADERS = {"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive"}
_busy: set[uuid.UUID] = set()


def sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str, separators=(',', ':'))}\n\n"


class MessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


@router.get("/me")
async def me(p: Principal = Depends(any_role)) -> dict[str, Any]:
    customer = None
    if p.customer_id:
        c = await customer_record(p)
        customer = {
            "id": str(c.id),
            "name": c.name,
            "email": c.email,
            "loyalty_tier": c.loyalty_tier,
            "shipping_pref": c.shipping_pref,
            "country": c.country,
        }
    return {
        "sub": p.sub,
        "role": p.role,
        "name": p.name,
        "persona": p.persona,
        "customer": customer,
        "workspace_id": str(p.workspace_id) if p.workspace_id else None,
        "demo_mode": get_settings().demo_mode,
    }


async def owned_thread(thread_id: uuid.UUID, p: Principal) -> Thread:
    async with db_session() as s:
        thread = await s.scalar(select(Thread).where(Thread.id == thread_id, Thread.customer_id == p.customer_id))
    if thread is None:
        raise ApiError(404, "not_found", "Conversation not found.")
    return thread


@router.post("/threads", status_code=201)
async def create_thread(p: Principal = Depends(customer_only)) -> dict[str, str]:
    async with db_session() as s:
        thread = Thread(customer_id=p.customer_id)
        s.add(thread)
        await s.flush()
        return {"thread_id": str(thread.id)}


@router.get("/threads")
async def list_threads(p: Principal = Depends(customer_only)) -> dict[str, Any]:
    async with db_session() as s:
        threads = (
            await s.scalars(
                select(Thread).where(Thread.customer_id == p.customer_id).order_by(desc(Thread.updated_at)).limit(50)
            )
        ).all()
    out = []
    for t in threads:
        out.append(
            {
                "id": str(t.id),
                "title": t.title or "New conversation",
                "status": t.status,
                "updated_at": t.updated_at.isoformat(),
                "last_message_preview": (t.title or "")[:80],
            }
        )
    return {"threads": out}


@router.get("/threads/{thread_id}")
async def get_thread(thread_id: uuid.UUID, p: Principal = Depends(customer_only)) -> dict[str, Any]:
    thread = await owned_thread(thread_id, p)
    snapshot = await runtime.state(thread_id)
    messages = snapshot.values.get("messages", []) if snapshot and snapshot.values else []
    async with db_session() as s:
        approvals = (
            await s.scalars(select(Approval).where(Approval.thread_id == thread_id).order_by(Approval.created_at))
        ).all()
    approval_map = {str(a.id): {"status": a.status, "note": (a.decision or {}).get("note")} for a in approvals}
    pending = next((a for a in reversed(approvals) if a.status == "pending"), None)
    return {
        "id": str(thread.id),
        "title": thread.title or "New conversation",
        "status": thread.status,
        "created_at": thread.created_at.isoformat(),
        "updated_at": thread.updated_at.isoformat(),
        "messages": to_ui_messages(messages, approval_map),
        "pending_approval": {
            "approval_id": str(pending.id),
            "status": "pending",
            "amount": float(pending.amount) if pending.amount is not None else None,
            "summary": pending.title,
            "reason": pending.reason,
        }
        if pending
        else None,
        "actions": await thread_actions(thread_id),
    }


@router.delete("/threads/{thread_id}", status_code=204)
async def delete_thread(thread_id: uuid.UUID, p: Principal = Depends(customer_only)) -> Response:
    await owned_thread(thread_id, p)
    async with db_session() as s:
        await s.execute(delete(Thread).where(Thread.id == thread_id))
    if runtime.checkpointer:
        await runtime.checkpointer.adelete_thread(str(thread_id))
    return Response(status_code=204)


async def _drain(queue: asyncio.Queue[tuple[str, dict[str, Any]] | None]) -> AsyncIterator[str]:
    yield ": connected\n\n"
    while True:
        try:
            item = await asyncio.wait_for(queue.get(), timeout=15)
        except TimeoutError:
            yield ": ping\n\n"
            continue
        if item is None:
            return
        yield sse(*item)


@router.post("/threads/{thread_id}/messages")
async def post_message(
    thread_id: uuid.UUID, body: MessageIn, request: Request, p: Principal = Depends(customer_only)
) -> StreamingResponse:
    await owned_thread(thread_id, p)
    ip = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip() or None
    await ratelimit.check_message(f"{p.sub}:{p.workspace_id}", ip, str(thread_id))
    if thread_id in _busy:
        raise ApiError(409, "busy", "I'm still answering your last message.")
    async with db_session() as s:
        customer = await s.get(Customer, p.customer_id)
    assert customer is not None
    queue: asyncio.Queue[tuple[str, dict[str, Any]] | None] = asyncio.Queue()

    async def emit(event: str, data: dict[str, Any]) -> None:
        await queue.put((event, data))

    async def run() -> None:
        _busy.add(thread_id)
        try:
            await runtime.run_turn(customer, thread_id, body.text, emit)
        finally:
            _busy.discard(thread_id)
            await queue.put(None)

    # The turn runs to completion even if the browser disconnects mid-stream.
    runtime.keep(asyncio.create_task(run()))
    return StreamingResponse(_drain(queue), media_type="text/event-stream", headers=SSE_HEADERS)


@router.get("/threads/{thread_id}/events")
async def thread_events(thread_id: uuid.UUID, p: Principal = Depends(customer_only)) -> StreamingResponse:
    await owned_thread(thread_id, p)

    async def gen() -> AsyncIterator[str]:
        client = aioredis.Redis.from_url(get_settings().redis_url)
        pubsub = client.pubsub()
        await pubsub.subscribe(channel(str(thread_id)))
        started = time.monotonic()
        yield ": connected\n\n"
        try:
            while time.monotonic() - started < 280:
                msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=15)
                if msg is None:
                    yield ": ping\n\n"
                    continue
                payload = json.loads(msg["data"])
                yield sse(payload["event"], payload["data"])
        finally:
            await pubsub.unsubscribe()
            await pubsub.aclose()
            await client.aclose()

    return StreamingResponse(gen(), media_type="text/event-stream", headers=SSE_HEADERS)
