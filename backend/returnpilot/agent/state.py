"""Graph state (SPEC §7.1) and per-run runtime context.

`AgentState` is checkpointed in Postgres after every step. `TurnContext` holds things that must
not be checkpointed (DB-backed tools, the tracer) and is passed fresh on every run and resume.
`customer_id` lives in both: it comes from the verified JWT, never from the model.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Annotated, Any, Literal, TypedDict

from langchain_core.messages import AnyMessage
from langgraph.graph.message import add_messages

from returnpilot.agent.tools_runtime import ToolRuntime
from returnpilot.tracing import Tracer

Route = Literal["faq", "order_lookup", "return", "refund", "human", "smalltalk"]


class AgentState(TypedDict, total=False):
    messages: Annotated[list[AnyMessage], add_messages]
    customer_id: str
    thread_id: str
    run_id: str
    route: Route | None
    retrieved: list[dict[str, Any]]
    memories: list[dict[str, Any]]
    pending_action: dict[str, Any] | None
    actions_to_execute: list[dict[str, Any]]
    approval_id: str | None
    step_count: int
    flags: dict[str, Any]
    turn_tokens: int
    tool_signatures: list[str]
    stop_reason: str | None
    summary: str | None
    summary_upto: int
    turn_start: int
    executed_this_turn: bool


@dataclass
class TurnContext:
    customer_id: uuid.UUID
    customer_name: str
    customer_email: str
    loyalty_tier: str
    country: str
    thread_id: uuid.UUID
    workspace_id: uuid.UUID | None
    run_id: uuid.UUID
    tracer: Tracer
    tools: ToolRuntime
    resumed: bool = False
    extra: dict[str, Any] = field(default_factory=dict)
