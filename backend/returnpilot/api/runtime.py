"""Graph runtime: checkpointer, chat turns (streamed as SSE events) and approval resumes."""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any

from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.types import Command
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from returnpilot.agent.graph import build_graph
from returnpilot.agent.history import text_of
from returnpilot.agent.profile import get_active_profile
from returnpilot.agent.state import TurnContext
from returnpilot.agent.tools_runtime import ToolRuntime
from returnpilot.agentforge import CURRENT_CASE
from returnpilot.config import get_settings
from returnpilot.db.models import Approval, Customer
from returnpilot.db.session import db_session
from returnpilot.tracing import Tracer

log = logging.getLogger(__name__)
Emit = Callable[[str, dict[str, Any]], Awaitable[None]]


class GraphRuntime:
    def __init__(self) -> None:
        self.pool: AsyncConnectionPool | None = None
        self.checkpointer: AsyncPostgresSaver | None = None
        self.graph: Any = None
        self._tasks: set[asyncio.Task[Any]] = set()

    async def start(self) -> None:
        s = get_settings()
        self.pool = AsyncConnectionPool(
            conninfo=s.psycopg_url,
            min_size=1,
            max_size=3,
            open=False,
            kwargs={"autocommit": True, "prepare_threshold": None, "row_factory": dict_row},
        )
        await self.pool.open(wait=True, timeout=60)
        self.checkpointer = AsyncPostgresSaver(self.pool)  # type: ignore[arg-type]
        await self.checkpointer.setup()
        self.graph = build_graph(self.checkpointer)

    async def stop(self) -> None:
        for t in list(self._tasks):
            t.cancel()
        if self.pool:
            await self.pool.close()

    def keep(self, task: asyncio.Task[Any]) -> None:
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    @staticmethod
    def config(thread_id: uuid.UUID) -> dict[str, Any]:
        return {"configurable": {"thread_id": str(thread_id)}, "recursion_limit": 60}

    async def context_for(
        self, customer: Customer, thread_id: uuid.UUID, *, kind: str, first_text: str | None, with_tools: bool
    ) -> TurnContext:
        run_id = uuid.uuid4()
        profile = await get_active_profile()
        tracer = Tracer(
            run_id=run_id,
            thread_id=thread_id,
            customer_id=customer.id,
            workspace_id=customer.workspace_id,
            kind=kind,
            first_user_text=first_text,
            profile_version=profile.label,
            mode="eval" if get_settings().eval_mode else "live",
            case_id=CURRENT_CASE["id"],
        )
        tools = (
            await ToolRuntime.create(customer.id, thread_id, profile.tool_descriptions)
            if with_tools
            else ToolRuntime(customer.id, thread_id)
        )
        return TurnContext(
            customer_id=customer.id,
            customer_name=customer.name,
            customer_email=customer.email,
            loyalty_tier=customer.loyalty_tier,
            country=customer.country,
            thread_id=thread_id,
            workspace_id=customer.workspace_id,
            run_id=run_id,
            tracer=tracer,
            tools=tools,
            resumed=kind != "turn",
            profile=profile,
        )

    async def state(self, thread_id: uuid.UUID) -> Any:
        return await self.graph.aget_state(self.config(thread_id))

    async def defer_pending(self, customer: Customer, thread_id: uuid.UUID) -> None:
        """A new customer message while an approval interrupt is open: release the interrupt
        (the approval stays pending in the DB and is applied later via Command(goto=...))."""
        snapshot = await self.state(thread_id)
        if not snapshot.interrupts:
            return
        ctx = await self.context_for(customer, thread_id, kind="defer", first_text=None, with_tools=False)
        await self.graph.ainvoke(
            Command(resume={"decision": "deferred"}), self.config(thread_id), context=ctx, durability="exit"
        )

    async def run_turn(self, customer: Customer, thread_id: uuid.UUID, text: str, emit: Emit) -> None:
        await self.defer_pending(customer, thread_id)
        ctx = await self.context_for(customer, thread_id, kind="turn", first_text=text, with_tools=True)
        await ctx.tracer.start()
        await emit("run", {"run_id": str(ctx.run_id)})
        status, error = "ok", None
        human = HumanMessage(content=text, response_metadata={"ts": datetime.now(UTC).isoformat()})
        try:
            async for mode, chunk in self.graph.astream(
                {"messages": [human]},
                self.config(thread_id),
                context=ctx,
                stream_mode=["messages", "custom", "updates"],
                durability="exit",
            ):
                if mode == "messages":
                    msg, meta = chunk
                    if meta.get("langgraph_node") != "agent":
                        continue
                    if isinstance(msg, AIMessageChunk) or (isinstance(msg, AIMessage) and not msg.tool_calls):
                        piece = text_of(msg)
                        if piece:
                            await emit("token", {"text": piece})
                elif mode == "custom" and isinstance(chunk, dict) and "event" in chunk:
                    await emit(chunk["event"], chunk["data"])
                elif mode == "updates" and isinstance(chunk, dict) and "__interrupt__" in chunk:
                    status = "interrupted"
        except Exception as exc:  # noqa: BLE001
            log.exception("turn failed")
            status, error = "error", f"{type(exc).__name__}: {exc}"[:500]
            await emit("error", {"code": "internal", "message": "Something went wrong on our side. Please try again."})
        snapshot = await self.state(thread_id)
        last_ai = next((m for m in reversed(snapshot.values.get("messages", [])) if isinstance(m, AIMessage)), None)
        await emit("done", {"run_id": str(ctx.run_id), "message_id": last_ai.id if last_ai else None})
        await ctx.tracer.finish(status, error)

    async def apply_decision(self, approval: Approval, decision: dict[str, Any]) -> None:
        """Resume the paused run with the reviewer's decision (or jump back to the gate if the
        interrupt was released because the customer kept chatting)."""
        async with db_session() as s:
            customer = await s.get(Customer, approval.customer_id)
        if customer is None:
            return
        ctx = await self.context_for(customer, approval.thread_id, kind="resume", first_text=None, with_tools=False)
        await ctx.tracer.start()
        cfg = self.config(approval.thread_id)
        snapshot = await self.state(approval.thread_id)
        waiting = any((i.value or {}).get("approval_id") == str(approval.id) for i in snapshot.interrupts)
        if waiting:
            command = Command(resume=decision)
        else:
            action = dict((approval.evidence or {}).get("action") or {})
            action.update({"approval_id": str(approval.id), "review": decision})
            command = Command(
                goto="approval_gate",
                update={"pending_action": action, "approval_id": str(approval.id), "stop_reason": None},
            )
        status, error = "ok", None
        try:
            await self.graph.ainvoke(command, cfg, context=ctx, durability="exit")
        except Exception as exc:  # noqa: BLE001
            log.exception("resume failed")
            status, error = "error", str(exc)[:500]
            raise
        finally:
            await ctx.tracer.finish(status, error)


runtime = GraphRuntime()
