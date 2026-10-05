"""Database side effects for approved/allowed actions: refund/return rows + idempotent jobs."""

from __future__ import annotations

import hashlib
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from returnpilot.config import get_settings
from returnpilot.db.models import Approval, Job, Refund, Return, Thread
from returnpilot.db.session import db_session
from returnpilot.policy.facts import ACTIVE_RETURN
from returnpilot.rag.retrieve import get_section

RULE_SECTIONS = {
    "R-WINDOW": "§2.1",
    "R-WINDOW-GOLD": "§2.2",
    "R-AMOUNT-LIMIT": "§3.3",
    "R-FREQUENCY": "§3.3",
    "R-REFUND-ONCE": "§3.4",
    "R-EXCEPTION": "§6.4",
    "R-FINAL-SALE": "§6.1",
    "R-ELECTRONICS": "§7.1",
    "R-ELECTRONICS-CONFLICT": "§7.3",
    "R-DAMAGED": "§5.1",
    "R-INTERNATIONAL": "§8.1",
}
TRIGGER_TEXT = {
    "R-AMOUNT-LIMIT": "Amount is over the ${limit:.0f} auto-approve limit",
    "R-FREQUENCY": "Customer has {refunds} refunds in the last 90 days",
    "R-EXCEPTION": "Customer asked for an exception to the policy",
    "R-ELECTRONICS-CONFLICT": "Customer says unopened, but records show the device was activated",
    "R-LOW-CONFIDENCE": "The agent flagged low confidence",
}


def idempotency_key(action: str, target: str, approval_or_call: str) -> str:
    return hashlib.sha256(f"{action}|{target}|{approval_or_call}".encode()).hexdigest()


def approval_title(action: dict[str, Any], amount: float | None = None) -> str:
    amt = amount if amount is not None else action.get("amount")
    if action["tool"] == "issue_refund" and amt is not None:
        return f"Refund ${float(amt):,.2f} · {action['item_name']}"
    return f"Return · {action['item_name']}"


def approval_reason(action: dict[str, Any]) -> str:
    parts = [
        TRIGGER_TEXT[r].format(
            limit=get_settings().refund_auto_approve_limit, refunds=action.get("prior_refunds_90d", 0)
        )
        for r in action["rule_ids"]
        if r in TRIGGER_TEXT
    ]
    return "; ".join(dict.fromkeys(parts)) or "Needs a team member's review"


async def create_approval(ctx: Any, action: dict[str, Any], agent_summary: str) -> tuple[Approval, bool]:
    """Create the approval row (idempotent per tool call) and the pending refund/return row."""
    key = f"{ctx.thread_id}:{action['tool_call_id']}"
    sections = []
    for rule in action["rule_ids"]:
        sid = RULE_SECTIONS.get(rule)
        if sid and all(s["section_id"] != sid for s in sections):
            sec = await get_section(sid)
            if sec:
                sections.append({"section_id": sid, "heading": sec["heading"], "text": sec["text"]})
    async with db_session() as s:
        existing = await s.scalar(select(Approval).where(Approval.proposal_key == key))
        if existing:
            return existing, False
        approval = Approval(
            thread_id=ctx.thread_id,
            customer_id=ctx.customer_id,
            workspace_id=ctx.workspace_id,
            run_id=ctx.run_id,
            proposal_key=key,
            action=action["tool"],
            title=approval_title(action),
            args={**action["args"], "order_item_id": action["item_ref"]},
            amount=action.get("amount"),
            max_amount=action.get("max_refund"),
            evidence={
                "order": {
                    "order_number": action["order_number"],
                    "delivered_at": action["delivered_at"],
                    "status": action["order_status"],
                },
                "item": {"name": action["item_name"], "ref": action["item_ref"], "condition": action["condition"]},
                "eligibility": action["eligibility"],
                "policy_sections": sections,
                "prior_refunds_90d": action.get("prior_refunds_90d", 0),
                # Full proposal, so a deferred approval can be re-applied after the run moved on.
                "action": {k: v for k, v in action.items() if k not in ("decision_payload",)},
            },
            policy={"decision": action["decision"], "reasons": action["reasons"], "rule_ids": action["rule_ids"]},
            reason=approval_reason(action),
            agent_summary=agent_summary,
            status="pending",
            expires_at=datetime.now(UTC) + timedelta(hours=get_settings().approval_ttl_hours),
        )
        s.add(approval)
        await s.flush()
        item_uuid = uuid.UUID(action["order_item_uuid"])
        if action["tool"] == "issue_refund":
            s.add(
                Refund(
                    order_item_id=item_uuid,
                    customer_id=ctx.customer_id,
                    thread_id=ctx.thread_id,
                    approval_id=approval.id,
                    amount=action["amount"],
                    status="pending_approval",
                    reason=action["args"].get("reason"),
                )
            )
        else:
            s.add(
                Return(
                    order_item_id=item_uuid,
                    customer_id=ctx.customer_id,
                    thread_id=ctx.thread_id,
                    approval_id=approval.id,
                    status="pending_approval",
                    reason=action["args"].get("reason"),
                    item_condition=action["condition"],
                )
            )
        await s.execute(
            update(Thread)
            .where(Thread.id == ctx.thread_id)
            .values(status="waiting_approval", updated_at=datetime.now(UTC))
        )
    return approval, True


async def _insert_job(s: Any, kind: str, key: str, payload: dict[str, Any], ctx: Any) -> str | None:
    stmt = pg_insert(Job).values(
        kind=kind,
        idempotency_key=key,
        payload=payload,
        status="queued",
        thread_id=ctx.thread_id,
        customer_id=ctx.customer_id,
    )
    stmt = stmt.on_conflict_do_nothing(index_elements=["idempotency_key"]).returning(Job.id)
    job_id = (await s.execute(stmt)).scalar()
    return str(job_id) if job_id else None


async def execute(
    ctx: Any, action: dict[str, Any], *, approval_id: str | None = None, amount: float | None = None
) -> tuple[dict[str, Any], list[str]]:
    """Create the side-effect rows and jobs. Safe to call twice: the idempotency key dedupes."""
    item_uuid = uuid.UUID(action["order_item_uuid"])
    ref = approval_id or action["tool_call_id"]
    final_amount = round(float(amount if amount is not None else (action.get("amount") or 0)), 2)
    base = {
        "thread_id": str(ctx.thread_id),
        "customer_id": str(ctx.customer_id),
        "item_name": action["item_name"],
        "order_number": action["order_number"],
    }
    job_ids: list[str] = []
    async with db_session() as s:
        if action["tool"] == "issue_refund":
            key = idempotency_key("issue_refund", str(item_uuid), ref)
            refund = None
            if approval_id:
                refund = await s.scalar(select(Refund).where(Refund.approval_id == uuid.UUID(approval_id)))
            if refund is None:
                refund = await s.scalar(select(Refund).where(Refund.idempotency_key == key))
            if refund is None:
                refund = Refund(
                    order_item_id=item_uuid,
                    customer_id=ctx.customer_id,
                    thread_id=ctx.thread_id,
                    amount=final_amount,
                    status="queued",
                    reason=action["args"].get("reason"),
                    idempotency_key=key,
                )
                s.add(refund)
            else:
                refund.status, refund.amount, refund.idempotency_key = "queued", final_amount, key
                refund.updated_at = datetime.now(UTC)
            await s.flush()
            jid = await _insert_job(
                s, "process_refund", key, {**base, "refund_id": str(refund.id), "amount": final_amount}, ctx
            )
            if jid:
                job_ids.append(jid)
            outcome: dict[str, Any] = {
                "status": "queued",
                "refund_id": str(refund.id),
                "amount": final_amount,
                "message": f"Refund of ${final_amount:,.2f} confirmed and queued for processing (simulated).",
            }
            if action.get("return_required"):
                has_return = await s.scalar(
                    select(Return.id).where(Return.order_item_id == item_uuid, Return.status.in_(ACTIVE_RETURN))
                )
                if not has_return:
                    ret = Return(
                        order_item_id=item_uuid,
                        customer_id=ctx.customer_id,
                        thread_id=ctx.thread_id,
                        status="requested",
                        reason="refund",
                        item_condition=action["condition"],
                        idempotency_key=idempotency_key("create_return", str(item_uuid), ref),
                    )
                    s.add(ret)
                    await s.flush()
                    rjid = await _insert_job(
                        s,
                        "create_return_label",
                        idempotency_key("label", str(item_uuid), ref),
                        {**base, "return_id": str(ret.id)},
                        ctx,
                    )
                    if rjid:
                        job_ids.append(rjid)
                    outcome["return_label"] = "A return label will be emailed (simulated)."
            else:
                outcome["return_label"] = "No need to send the item back."
        else:
            key = idempotency_key("create_return", str(item_uuid), ref)
            ret = None
            if approval_id:
                ret = await s.scalar(select(Return).where(Return.approval_id == uuid.UUID(approval_id)))
            if ret is None:
                ret = await s.scalar(select(Return).where(Return.idempotency_key == key))
            if ret is None:
                ret = Return(
                    order_item_id=item_uuid,
                    customer_id=ctx.customer_id,
                    thread_id=ctx.thread_id,
                    status="requested",
                    reason=action["args"].get("reason"),
                    item_condition=action["condition"],
                    idempotency_key=key,
                )
                s.add(ret)
            else:
                ret.status, ret.idempotency_key, ret.updated_at = "requested", key, datetime.now(UTC)
            await s.flush()
            jid = await _insert_job(s, "create_return_label", key, {**base, "return_id": str(ret.id)}, ctx)
            if jid:
                job_ids.append(jid)
            outcome = {
                "status": "requested",
                "return_id": str(ret.id),
                "message": "Return confirmed; a return label will be emailed shortly (simulated).",
            }
    return outcome, job_ids


async def close_pending(approval_id: str, status: str) -> None:
    """Mark the pending refund/return of a rejected/expired approval and reopen the thread."""
    aid = uuid.UUID(approval_id)
    async with db_session() as s:
        await s.execute(
            update(Refund)
            .where(Refund.approval_id == aid, Refund.status == "pending_approval")
            .values(status=status, updated_at=datetime.now(UTC))
        )
        await s.execute(
            update(Return)
            .where(Return.approval_id == aid, Return.status == "pending_approval")
            .values(status=status, updated_at=datetime.now(UTC))
        )


async def reopen_thread(thread_id: uuid.UUID) -> None:
    async with db_session() as s:
        await s.execute(
            update(Thread)
            .where(Thread.id == thread_id, Thread.status == "waiting_approval")
            .values(status="active", updated_at=datetime.now(UTC))
        )
