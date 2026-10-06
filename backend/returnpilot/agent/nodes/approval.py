"""Human-in-the-loop nodes (SPEC §4.2, §7.2): announce_pending → approval_gate (interrupt) →
execute_action | announce_outcome. Approval copy is fixed text, never model output."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from langchain_core.messages import ToolMessage
from langgraph.runtime import Runtime
from langgraph.types import interrupt

from returnpilot.agent import actions
from returnpilot.agent.history import last_human_text, parse_json, text_of
from returnpilot.agent.nodes.common import ai_message, emit
from returnpilot.agent.prompts import approved_copy, expired_copy, pending_copy, rejected_copy
from returnpilot.agent.state import AgentState, TurnContext
from returnpilot.events import publish
from returnpilot.guards.pii import redact_text
from returnpilot.jobs.tasks import enqueue_jobs

APPROVED = ("approve", "approve_with_edit")


def _agent_summary(state: AgentState, action: dict[str, Any]) -> str:
    what = (
        f"a refund of ${action['amount']:,.2f}"
        if action["tool"] == "issue_refund" and action.get("amount") is not None
        else "a return"
    )
    said = redact_text(last_human_text(state["messages"]))[:220]
    return (
        f"Customer asked for {what} on the {action['item_name']} from order #{action['order_number']} "
        f"(condition: {action['condition'].replace('_', ' ')}). Their last message: {said}"
    )


def _action_event(
    action: dict[str, Any], status: str, detail: str, ident: str, amount: float | None = None
) -> dict[str, Any]:
    amt = amount if amount is not None else action.get("amount")
    return {
        "id": ident,
        "kind": "refund" if action["tool"] == "issue_refund" else "return",
        "status": status,
        "label": actions.approval_title(action, amt),
        "amount": amt,
        "order_number": action["order_number"],
        "detail": detail,
    }


async def announce_pending(state: AgentState, runtime: Runtime[TurnContext]) -> dict[str, Any]:
    ctx = runtime.context
    action = dict(state["pending_action"] or {})
    with ctx.tracer.step(
        "node", "create_approval", input={"action": action.get("tool"), "amount": action.get("amount")}
    ) as step:
        approval, _created = await actions.create_approval(ctx, action, _agent_summary(state, action))
        step.output = {"approval_id": str(approval.id), "reason": approval.reason}
    action["approval_id"] = str(approval.id)
    text = pending_copy(action["tool"], action.get("amount"), action["rule_ids"])
    msg = ai_message(text, rp_kind="approval_pending", approval_id=str(approval.id), amount=action.get("amount"))
    emit(
        "approval",
        {
            "approval_id": str(approval.id),
            "status": "pending",
            "amount": action.get("amount"),
            "summary": approval.title,
            "reason": approval.reason,
        },
    )
    emit("action", _action_event(action, "pending_approval", "Waiting for a team member", str(approval.id)))
    emit("message", {"id": msg.id, "text": text, "citations": []})
    return {"messages": [msg], "pending_action": action, "approval_id": str(approval.id), "actions_to_execute": []}


async def approval_gate(state: AgentState, runtime: Runtime[TurnContext]) -> dict[str, Any]:
    ctx = runtime.context
    action = dict(state["pending_action"] or {})
    decision = action.get("review")
    if not decision:
        # Pauses the run; the checkpoint is saved in Postgres and the API returns to the browser.
        decision = interrupt(
            {
                "approval_id": action.get("approval_id"),
                "action": action.get("tool"),
                "amount": action.get("amount"),
                "summary": actions.approval_title(action),
            }
        )
    if decision.get("decision") == "deferred":
        ctx.tracer.add("interrupt", "approval_deferred", output={"approval_id": action.get("approval_id")})
        return {"stop_reason": "deferred"}
    ctx.tracer.add(
        "interrupt", "approval_resumed", output={"decision": decision.get("decision"), "amount": decision.get("amount")}
    )
    return {"pending_action": {**action, "review": decision}}


def _replace_tool(state: AgentState, tool_call_id: str, outcome: dict[str, Any]) -> ToolMessage | None:
    for m in state["messages"]:
        if isinstance(m, ToolMessage) and m.tool_call_id == tool_call_id:
            payload = {**(parse_json(text_of(m)) or {}), "outcome": outcome}
            return ToolMessage(
                content=json.dumps(payload, separators=(",", ":"), default=str),
                tool_call_id=tool_call_id,
                name=m.name,
                status=m.status,
                id=m.id,
                artifact=m.artifact,
            )
    return None


async def execute_action(state: AgentState, runtime: Runtime[TurnContext]) -> dict[str, Any]:
    ctx = runtime.context
    replaced: list[ToolMessage] = []
    job_ids: list[str] = []
    pending = state.get("pending_action")
    work: list[tuple[dict[str, Any], str | None, float | None]] = [
        (a, None, None) for a in state.get("actions_to_execute", [])
    ]
    approval_path = bool(pending and (pending.get("review") or {}).get("decision") in APPROVED)
    if approval_path and pending:
        d = pending["review"]
        amount = d.get("amount") if d.get("decision") == "approve_with_edit" else None
        work.append((pending, pending["approval_id"], amount))
    for action, approval_id, amount in work:
        with ctx.tracer.step(
            "job",
            f"execute:{action['tool']}",
            input={"approval_id": approval_id, "amount": amount or action.get("amount")},
        ) as step:
            outcome, ids = await actions.execute(ctx, action, approval_id=approval_id, amount=amount)
            step.output = {"outcome": outcome, "jobs": ids}
        job_ids.extend(ids)
        msg = _replace_tool(state, action["tool_call_id"], outcome)
        if msg:
            replaced.append(msg)
        ident = outcome.get("refund_id") or outcome.get("return_id") or action["tool_call_id"]
        event = _action_event(action, "queued", "Processing (simulated)…", ident, outcome.get("amount"))
        emit("action", event)
        await publish(str(ctx.thread_id), "action", event)
    if job_ids:
        await asyncio.to_thread(enqueue_jobs, job_ids)
    return {"messages": replaced, "actions_to_execute": [], "executed_this_turn": True}


async def announce_outcome(state: AgentState, runtime: Runtime[TurnContext]) -> dict[str, Any]:
    ctx = runtime.context
    action = dict(state.get("pending_action") or {})
    decision = action.get("review") or {}
    kind = decision.get("decision")
    approval_id = action.get("approval_id")
    if kind in APPROVED:
        amount = (
            decision.get("amount")
            if kind == "approve_with_edit" and decision.get("amount") is not None
            else action.get("amount")
        )
        text = approved_copy(
            action["tool"], amount, action["item_name"], action.get("amount") if kind == "approve_with_edit" else None
        )
        status = "approved"
    elif kind == "reject":
        text, status = rejected_copy(action["tool"], decision.get("note")), "rejected"
        await actions.close_pending(approval_id, "rejected")
        await publish(str(ctx.thread_id), "action", _action_event(action, "rejected", "Not approved", approval_id))
    else:
        text, status = expired_copy(action["tool"]), "expired"
        await actions.close_pending(approval_id, "expired")
        await publish(str(ctx.thread_id), "action", _action_event(action, "expired", "Approval expired", approval_id))
    await actions.reopen_thread(ctx.thread_id)
    msg = ai_message(
        text,
        rp_kind=f"approval_{status}",
        approval_id=approval_id,
        amount=decision.get("amount") or action.get("amount"),
        note=decision.get("note"),
    )
    approval_event = {
        "approval_id": approval_id,
        "status": status,
        "amount": decision.get("amount") or action.get("amount"),
        "note": decision.get("note"),
    }
    emit("approval", approval_event)
    emit("message", {"id": msg.id, "text": text, "citations": []})
    await publish(str(ctx.thread_id), "approval", approval_event)
    await publish(str(ctx.thread_id), "message", {"id": msg.id, "role": "assistant", "text": text})
    return {"messages": [msg], "pending_action": None, "approval_id": None}
