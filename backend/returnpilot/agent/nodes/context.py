"""load_context, input_guard and route nodes (SPEC §7.2)."""

from __future__ import annotations

import json
import re
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.runtime import Runtime
from sqlalchemy import select

from returnpilot.agent import llm
from returnpilot.agent.history import last_human_text, text_of
from returnpilot.agent.nodes.common import ai_message, emit
from returnpilot.agent.state import AgentState, TurnContext
from returnpilot.config import get_settings
from returnpilot.db.models import Thread
from returnpilot.db.session import db_session
from returnpilot.guards.input import check_input
from returnpilot.guards.prompt_guard import classify
from returnpilot.memory import store

ROUTES = ("faq", "order_lookup", "return", "refund", "human", "smalltalk")
_HUMAN = re.compile(
    r"\b(talk|speak|chat)\s+(to|with)\s+(a\s+|an\s+|the\s+|some\s*one\s*)?(real\s+|live\s+)?(human|person|agent|manager|representative|someone|somebody|team member)\b"
    r"|\b(real|live|actual)\s+(person|human|agent)\b|\bescalate\b|\bhuman please\b|\bget me a (human|person|manager)\b",
    re.IGNORECASE,
)


async def load_context(state: AgentState, runtime: Runtime[TurnContext]) -> dict[str, Any]:
    ctx = runtime.context
    messages = state.get("messages", [])
    with ctx.tracer.step("node", "load_context") as step:
        memories = await store.load_for_turn(ctx.customer_id, last_human_text(messages))
        async with db_session() as s:
            thread = await s.scalar(select(Thread).where(Thread.id == ctx.thread_id))
        step.output = {"memories": len(memories), "history_messages": len(messages)}
    return {
        "customer_id": str(ctx.customer_id),
        "thread_id": str(ctx.thread_id),
        "run_id": str(ctx.run_id),
        "memories": memories,
        "retrieved": [],
        "actions_to_execute": [],
        "step_count": 0,
        "flags": {},
        "turn_tokens": 0,
        "tool_signatures": [],
        "stop_reason": None,
        "route": None,
        "turn_start": max(0, len(messages) - 1),
        "executed_this_turn": False,
        "summary": thread.summary if thread else None,
        "summary_upto": thread.summary_upto if thread else 0,
    }


async def input_guard(state: AgentState, runtime: Runtime[TurnContext]) -> dict[str, Any]:
    ctx = runtime.context
    last = state["messages"][-1]
    if not isinstance(last, HumanMessage):
        return {}
    raw = text_of(last)
    with ctx.tracer.step("guard", "input_guard", input={"chars": len(raw)}) as step:
        verdict = check_input(raw)
        step.output = {"blocked": verdict.blocked, "flags": verdict.flags}
        if verdict.blocked:
            step.status = "blocked"
    if not verdict.blocked:
        # Prompt Guard 2 (+ heuristics): flagged input continues under a stricter system reminder.
        with ctx.tracer.step("guard", "prompt_guard", input={"chars": len(verdict.text)}) as step:
            pg = await classify(verdict.text)
            step.model = get_settings().guard_model if pg.source == "prompt_guard" else None
            step.output = {"flagged": pg.flagged, "score": pg.score, "source": pg.source}
        if pg.flagged:
            verdict.flags.update({"injection_suspected": True, "guard_score": pg.score, "guard_source": pg.source})
    out: dict[str, Any] = {"flags": {**verdict.flags, "blocked": verdict.blocked}}
    updates: list[Any] = []
    if verdict.text != raw:
        updates.append(HumanMessage(content=verdict.text, id=last.id))
    if verdict.blocked and verdict.reply:
        reply = ai_message(verdict.reply, rp_kind="guard")
        updates.append(reply)
        emit("message", {"id": reply.id, "text": verdict.reply, "citations": []})
    if updates:
        out["messages"] = updates
    return out


def keyword_route(text: str) -> str:
    t = text.lower()
    if _HUMAN.search(t):
        return "human"
    if "refund" in t or "money back" in t or "reimburse" in t:
        return "refund"
    if re.search(r"\b(return|send (it|them|this) back|exchange|swap)\b", t):
        return "return"
    if re.search(
        r"\b(order|track|tracking|delivery|delivered|shipped|shipping status|arrive|where is)\b|#\s?\d{3,}", t
    ):
        return "order_lookup"
    if re.search(r"\b(policy|how long|how many days|window|final sale|gift|international|warranty|electronics)\b", t):
        return "faq"
    return "smalltalk"


async def route(state: AgentState, runtime: Runtime[TurnContext]) -> dict[str, Any]:
    ctx = runtime.context
    text = last_human_text(state["messages"])
    fallback = keyword_route(text)
    chosen, how = fallback, "keywords"
    emit("status", {"stage": "routing", "label": "Reading your message…"})
    try:
        res = await llm.invoke(
            "small",
            [SystemMessage(content=ctx.profile.prompts.router), HumanMessage(content=text[:1000])],
            temperature=0,
            max_tokens=20,
        )
        raw = res.message.text
        start, end = raw.find("{"), raw.rfind("}")
        parsed = json.loads(raw[start : end + 1]) if start >= 0 else {}
        candidate = parsed.get("route")
        if candidate in ROUTES:
            # Only hand off to a person when the customer explicitly asked for one.
            chosen, how = (candidate if candidate != "human" or fallback == "human" else "smalltalk"), res.model
        ctx.tracer.record_llm(
            "route",
            res.model,
            res.duration_ms,
            res.tokens_in,
            res.tokens_out,
            input={"text": text[:300]},
            output={"route": chosen, "raw": raw[:100]},
        )
    except Exception as exc:  # noqa: BLE001 - keyword rules are the documented fallback
        ctx.tracer.add(
            "node", "route_fallback", status="ok", input={"error": str(exc)[:200]}, output={"route": fallback}
        )
    if fallback == "human":
        chosen = "human"
    ctx.tracer.route = chosen
    with ctx.tracer.step("node", "route", input={"how": how}) as step:
        step.output = {"route": chosen}
    return {"route": chosen}
