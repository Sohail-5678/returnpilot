"""agent node: the main model with tools bound (SPEC §7.2, §8.1)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from langchain_core.messages import SystemMessage
from langgraph.runtime import Runtime

from returnpilot.agent import llm
from returnpilot.agent.history import last_human_text, trim_for_llm
from returnpilot.agent.nodes.common import ai_message, emit
from returnpilot.agent.prompts import HANDOFF_COPY, QUOTA_COPY, render_main
from returnpilot.agent.state import AgentState, TurnContext
from returnpilot.config import get_settings


def system_prompt(state: AgentState, ctx: TurnContext) -> str:
    return render_main(
        customer_name=ctx.customer_name,
        loyalty_tier=ctx.loyalty_tier,
        country=ctx.country,
        memories=[m["content"] for m in state.get("memories", [])],
        summary=state.get("summary"),
        injection=bool(state.get("flags", {}).get("injection_suspected")),
        today=datetime.now(UTC).date(),
    )


async def agent(state: AgentState, runtime: Runtime[TurnContext]) -> dict[str, Any]:
    ctx = runtime.context
    s = get_settings()
    steps = state.get("step_count", 0)

    stop = state.get("stop_reason")
    if not stop and steps >= s.max_agent_steps:
        stop = "step_limit"
    if not stop and state.get("turn_tokens", 0) > s.max_turn_tokens:
        stop = "token_limit"
    if stop:
        msg = ai_message(HANDOFF_COPY, rp_kind="handoff", reason=stop)
        ctx.tracer.add("node", "agent_stop", output={"reason": stop})
        emit("message", {"id": msg.id, "text": HANDOFF_COPY, "citations": []})
        return {"messages": [msg], "stop_reason": stop}

    if steps == 0:
        emit("status", {"stage": "thinking", "label": "Thinking…"})
    messages = [SystemMessage(content=system_prompt(state, ctx)), *trim_for_llm(state["messages"])]
    try:
        res = await llm.invoke("main", messages, tools=ctx.tools.list(), temperature=0.2, max_tokens=700)
    except llm.LLMUnavailable as exc:
        msg = ai_message(QUOTA_COPY, rp_kind="quota")
        ctx.tracer.add("llm", "agent", status="error", error=str(exc)[:500])
        emit("error", {"code": "quota_exhausted", "message": QUOTA_COPY})
        emit("message", {"id": msg.id, "text": QUOTA_COPY, "citations": []})
        return {"messages": [msg], "stop_reason": "quota"}

    ai = res.message
    ai.response_metadata = {**(ai.response_metadata or {}), "ts": datetime.now(UTC).isoformat()}
    ctx.tracer.record_llm(
        "agent",
        f"{res.provider}:{res.model}",
        res.duration_ms,
        res.tokens_in,
        res.tokens_out,
        input={"user": last_human_text(state["messages"])[:300], "step": steps + 1, "fallbacks": res.attempts},
        output={"text": ai.text[:500], "tool_calls": [{"name": t["name"], "args": t["args"]} for t in ai.tool_calls]},
    )
    if ai.tool_calls:
        emit("status", {"stage": "tools", "label": "Checking…"})
    return {
        "messages": [ai],
        "step_count": steps + 1,
        "turn_tokens": state.get("turn_tokens", 0) + res.tokens_in + res.tokens_out,
    }
