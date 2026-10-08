"""respond → output_guard → write_memory → finalize, plus the deterministic escalate path."""

from __future__ import annotations

import asyncio
import logging
import re
import uuid
from datetime import UTC, datetime
from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langgraph.runtime import Runtime
from sqlalchemy import func, select, text, update

from returnpilot.agent import llm
from returnpilot.agent.history import last_human_text, text_of, tool_texts, transcript, trim_for_llm, user_texts
from returnpilot.agent.labels import tool_label
from returnpilot.agent.nodes.agent import system_prompt
from returnpilot.agent.nodes.common import ai_message, emit
from returnpilot.agent.prompts import GUARD_FALLBACK, REGENERATE_NOTE
from returnpilot.agent.state import AgentState, TurnContext
from returnpilot.db.models import Refund, Return, Thread
from returnpilot.db.session import db_session
from returnpilot.guards.output import check_output
from returnpilot.memory import store
from returnpilot.memory.summarizer import maybe_summarize
from returnpilot.tools.local_tools import open_escalation

log = logging.getLogger(__name__)
_CITE = re.compile(r"\[Policy\s*§(\d+\.\d+)\]")
_sections: dict[str, dict[str, str]] = {}
_background: set[asyncio.Task[Any]] = set()


async def section_map() -> dict[str, dict[str, str]]:
    if not _sections:
        async with db_session() as s:
            rows = (await s.execute(text("SELECT section_id, doc, heading FROM policy_chunks"))).all()
        _sections.update({r.section_id: {"section_id": r.section_id, "doc": r.doc, "heading": r.heading} for r in rows})
    return _sections


def citations_in(reply: str, sections: dict[str, dict[str, str]]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for sid in dict.fromkeys(f"§{m}" for m in _CITE.findall(reply)):
        if sid in sections:
            out.append(sections[sid])
    return out


def _final_ai(state: AgentState) -> AIMessage | None:
    last = state["messages"][-1]
    return last if isinstance(last, AIMessage) and not last.tool_calls else None


async def respond(state: AgentState, runtime: Runtime[TurnContext]) -> dict[str, Any]:
    emit("status", {"stage": "writing", "label": "Writing…"})
    runtime.context.tracer.add("node", "respond")
    return {}


async def _thread_has_executed(thread_id: uuid.UUID) -> bool:
    async with db_session() as s:
        refunds = await s.scalar(
            select(func.count())
            .select_from(Refund)
            .where(Refund.thread_id == thread_id, Refund.status.in_(("queued", "issued")))
        )
        returns = await s.scalar(
            select(func.count())
            .select_from(Return)
            .where(Return.thread_id == thread_id, Return.status.in_(("requested", "label_created", "received")))
        )
    return bool(refunds or returns)


async def output_guard(state: AgentState, runtime: Runtime[TurnContext]) -> dict[str, Any]:
    ctx = runtime.context
    ai = _final_ai(state)
    if ai is None:
        return {}
    sections = await section_map()
    if ai.response_metadata.get("rp_kind"):  # fixed copy (guard, quota, handoff, approvals) is pre-approved
        return {}
    reply = text_of(ai)
    executed = state.get("executed_this_turn", False) or await _thread_has_executed(ctx.thread_id)
    kwargs = {
        "tool_texts": tool_texts(state["messages"]),
        "user_texts": user_texts(state["messages"]),
        "section_ids": set(sections),
        "customer_email": ctx.customer_email,
        "action_executed": executed,
        "today": datetime.now(UTC).date(),
    }
    with ctx.tracer.step("guard", "output_guard", input={"chars": len(reply)}) as step:
        verdict = check_output(reply, **kwargs)
        step.output = {"ok": verdict.ok, "issues": verdict.issues, "stripped": verdict.stripped_citations}
    final_text, replaced = verdict.text, verdict.text != reply.strip()
    if not verdict.ok:
        final_text, replaced = GUARD_FALLBACK, True
        try:
            history = [m for m in trim_for_llm(state["messages"]) if m.id != ai.id]
            note = REGENERATE_NOTE.format(issues="; ".join(verdict.issues))
            res = await llm.invoke(
                "main", [SystemMessage(content=system_prompt(state, ctx) + "\n\n" + note), *history], temperature=0
            )
            ctx.tracer.record_llm(
                "regenerate",
                f"{res.provider}:{res.model}",
                res.duration_ms,
                res.tokens_in,
                res.tokens_out,
                input={"issues": verdict.issues},
                output={"text": res.message.text[:400]},
            )
            second = check_output(res.message.text, **kwargs)
            if second.ok and second.text:
                final_text = second.text
        except Exception as exc:  # noqa: BLE001 - fall back to the safe reply
            log.info("regeneration failed: %s", exc)
    cites = citations_in(final_text, sections)
    meta = {
        **ai.response_metadata,
        "citations": cites,
        "guard": {"ok": verdict.ok, "issues": verdict.issues},
        "run_id": str(ctx.run_id),
    }
    if replaced:
        meta["guard_replaced"] = True
        emit("replace", {"id": ai.id, "text": final_text})
    emit("message", {"id": ai.id, "text": final_text, "citations": cites, "run_id": str(ctx.run_id)})
    return {"messages": [AIMessage(content=final_text, id=ai.id, response_metadata=meta)]}


async def _remember(customer_id: uuid.UUID, thread_id: uuid.UUID, texts: list[str], state: AgentState) -> None:
    try:
        await store.write_memories(customer_id, thread_id, texts)
        await maybe_summarize(thread_id, state["messages"], state.get("summary"), state.get("summary_upto", 0))
    except Exception:  # noqa: BLE001
        log.exception("background memory write failed")


async def write_memory(state: AgentState, runtime: Runtime[TurnContext]) -> dict[str, Any]:
    """Runs in the background so it never delays the reply (SPEC §7.2)."""
    ctx = runtime.context
    texts = [last_human_text(state["messages"])]
    task = asyncio.create_task(_remember(ctx.customer_id, ctx.thread_id, texts, state))
    _background.add(task)
    task.add_done_callback(_background.discard)
    ctx.tracer.add("node", "write_memory", output={"scheduled": True})
    return {}


async def finalize(state: AgentState, runtime: Runtime[TurnContext]) -> dict[str, Any]:
    ctx = runtime.context
    first_user = next((text_of(m) for m in state.get("messages", []) if isinstance(m, HumanMessage)), "")
    title = re.sub(r"\s+", " ", first_user).strip()[:60] or "New conversation"
    async with db_session() as s:
        await s.execute(update(Thread).where(Thread.id == ctx.thread_id).values(updated_at=datetime.now(UTC)))
        await s.execute(update(Thread).where(Thread.id == ctx.thread_id, Thread.title.is_(None)).values(title=title))
    return {}


async def escalate(state: AgentState, runtime: Runtime[TurnContext]) -> dict[str, Any]:
    """Customer asked for a person: open a ticket with the conversation summary (no LLM needed)."""
    ctx = runtime.context
    call_id = f"call_{uuid.uuid4().hex[:12]}"
    reason = last_human_text(state["messages"])[:200] or "Customer asked for a person"
    args = {"reason": reason}
    emit(
        "tool",
        {
            "id": call_id,
            "name": "escalate_to_human",
            "status": "started",
            "label": tool_label("escalate_to_human", args, done=False),
        },
    )
    with ctx.tracer.step("tool", "escalate_to_human", input=args) as step:
        result = await open_escalation(ctx.customer_id, ctx.thread_id, reason, transcript(state["messages"]))
        step.output = result
    label = tool_label("escalate_to_human", args, done=True)
    emit(
        "tool",
        {"id": call_id, "name": "escalate_to_human", "status": "ok", "label": label, "duration_ms": step.duration_ms},
    )
    call_msg = AIMessage(
        content="",
        id=f"msg-{uuid.uuid4()}",
        tool_calls=[{"name": "escalate_to_human", "args": args, "id": call_id, "type": "tool_call"}],
    )
    import json

    tool_msg = ToolMessage(
        content=json.dumps(result),
        tool_call_id=call_id,
        name="escalate_to_human",
        id=f"tool-{call_id}",
        artifact={"label": label, "status": "ok", "duration_ms": step.duration_ms or 0, "preview": "ticket opened"},
    )
    reply_text = (
        "I've opened a ticket for our support team with a summary of our conversation, so you won't need to "
        "repeat anything. A team member will reply by email within one business day. "
        "Is there anything I can help with in the meantime?"
    )
    reply = ai_message(reply_text, rp_kind="escalated", ticket_id=result["ticket_id"])
    emit("message", {"id": reply.id, "text": reply_text, "citations": []})
    return {"messages": [call_msg, tool_msg, reply]}
