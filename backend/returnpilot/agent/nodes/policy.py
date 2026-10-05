"""policy_check node: the deterministic engine re-evaluates every proposed write against fresh
database facts. This decision is authoritative and audited (SPEC §6, §7.2)."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from langchain_core.messages import AIMessage, ToolMessage
from langgraph.runtime import Runtime
from sqlalchemy import func, select

from returnpilot.agent.history import parse_json, text_of, tool_call_args
from returnpilot.agent.state import AgentState, TurnContext
from returnpilot.agent.tools_runtime import WRITE_TOOLS
from returnpilot.config import get_settings
from returnpilot.db.models import Approval, AuditLog
from returnpilot.db.session import db_session
from returnpilot.policy import engine
from returnpilot.policy.facts import customer_facts, item_facts, item_history, resolve_item
from returnpilot.policy.rules import ITEM_CONDITIONS


def _latest_tool_messages(state: AgentState) -> list[ToolMessage]:
    out: list[ToolMessage] = []
    for m in reversed(state["messages"]):
        if isinstance(m, ToolMessage):
            out.append(m)
        elif isinstance(m, AIMessage):
            break
    return list(reversed(out))


async def evaluate_action(
    customer_id: uuid.UUID,
    tool: str,
    args: dict[str, Any],
    *,
    low_confidence: bool = False,
    amount_override: float | None = None,
    exclude_approval_id: uuid.UUID | None = None,
) -> dict[str, Any] | None:
    """Re-run the policy engine for a proposed write. Returns None if the item can't be resolved."""
    now = datetime.now(UTC)
    condition = args.get("item_condition") if args.get("item_condition") in ITEM_CONDITIONS else "opened"
    async with db_session() as s:
        resolved = await resolve_item(s, customer_id, str(args.get("order_item_id", "")))
        if not resolved:
            return None
        facts = item_facts(resolved)
        cust = await customer_facts(s, customer_id, now)
        history = await item_history(s, resolved.item.id, exclude_approval_id)
        prior_refunds = cust.refunds_last_90d
    exception = bool(args.get("request_exception")) or args.get("reason") == "exception_request"
    elig = engine.check_eligibility(facts, cust, condition, now)  # type: ignore[arg-type]
    if tool == "issue_refund":
        amount = float(amount_override if amount_override is not None else args.get("amount", 0) or 0)
        decision = engine.evaluate_refund(
            facts,
            cust,
            history,
            condition,
            Decimal(str(amount)),
            now,  # type: ignore[arg-type]
            auto_approve_limit=Decimal(str(get_settings().refund_auto_approve_limit)),
            request_exception=exception,
            low_confidence=low_confidence,
        )
    else:
        amount = None
        decision = engine.evaluate_return(
            facts,
            cust,
            history,
            condition,
            now,  # type: ignore[arg-type]
            request_exception=exception,
            low_confidence=low_confidence,
        )
    return {
        "tool": tool,
        "args": args,
        "item_ref": resolved.ref,
        "order_item_uuid": str(resolved.item.id),
        "item_name": facts.name,
        "order_number": facts.order_number,
        "order_status": facts.order_status,
        "delivered_at": facts.delivered_at.isoformat() if facts.delivered_at else None,
        "condition": condition,
        "amount": round(amount, 2) if amount is not None else None,
        "max_refund": float(elig.max_refund),
        "return_required": elig.return_required,
        "decision": decision.decision,
        "reasons": decision.reasons,
        "rule_ids": decision.rule_ids,
        "eligibility": elig.to_dict(),
        "prior_refunds_90d": prior_refunds,
    }


async def _pending_in_thread(ctx: TurnContext) -> bool:
    async with db_session() as s:
        n = await s.scalar(
            select(func.count())
            .select_from(Approval)
            .where(Approval.thread_id == ctx.thread_id, Approval.status == "pending")
        )
    return bool(n)


async def policy_check(state: AgentState, runtime: Runtime[TurnContext]) -> dict[str, Any]:
    ctx = runtime.context
    low_conf = bool(state.get("flags", {}).get("low_confidence"))
    actions: list[dict[str, Any]] = []
    replaced: list[ToolMessage] = []
    audit: list[AuditLog] = []
    for tm in _latest_tool_messages(state):
        if tm.name not in WRITE_TOOLS or tm.status == "error":
            continue
        args = tool_call_args(state["messages"], tm.tool_call_id) or {}
        with ctx.tracer.step("policy", f"policy_check:{tm.name}", input=args) as step:
            action = await evaluate_action(ctx.customer_id, tm.name or "", args, low_confidence=low_conf)
            step.output = (
                {k: action[k] for k in ("decision", "rule_ids", "amount")} if action else {"error": "item not found"}
            )
        if action is None:
            continue
        action["tool_call_id"] = tm.tool_call_id
        action["tool_message_id"] = tm.id
        proposal = parse_json(text_of(tm)) or {}
        if proposal.get("decision") != action["decision"]:
            # The engine's fresh decision wins over whatever the tool reported earlier.
            proposal.update({k: action[k] for k in ("decision", "reasons", "rule_ids")})
            replaced.append(_replace_tool_message(tm, proposal))
        audit.append(
            AuditLog(
                actor="policy_engine",
                action=f"policy_decision:{tm.name}",
                target=action["item_ref"],
                details={
                    "thread_id": str(ctx.thread_id),
                    "decision": action["decision"],
                    "rule_ids": action["rule_ids"],
                    "amount": action["amount"],
                },
            )
        )
        actions.append(action)
    if audit:
        async with db_session() as s:
            s.add_all(audit)

    to_execute = [a for a in actions if a["decision"] == "allow"]
    needs = [a for a in actions if a["decision"] == "needs_approval"]
    pending: dict[str, Any] | None = None
    if needs:
        blocked = await _pending_in_thread(ctx)
        for i, a in enumerate(needs):
            if i == 0 and not blocked:
                pending = a
                continue
            note = {
                "decision": "deferred",
                "next_step": "Another request in this conversation is already waiting for a "
                "team member. Tell the customer we'll handle this one after that decision.",
            }
            tm = next(m for m in _latest_tool_messages(state) if m.tool_call_id == a["tool_call_id"])
            replaced.append(_replace_tool_message(tm, {**(parse_json(text_of(tm)) or {}), **note}))
    return {
        "messages": replaced,
        "actions_to_execute": to_execute,
        "pending_action": pending,
    }


def _replace_tool_message(tm: ToolMessage, payload: dict[str, Any]) -> ToolMessage:
    return ToolMessage(
        content=json.dumps(payload, separators=(",", ":"), default=str),
        tool_call_id=tm.tool_call_id,
        name=tm.name,
        status=tm.status,
        id=tm.id,
        artifact=tm.artifact,
    )
