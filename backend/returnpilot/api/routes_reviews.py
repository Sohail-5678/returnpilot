"""/v1/approvals (review queue and decisions) and the internal expiry hook (SPEC §4.2)."""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel, Field
from sqlalchemy import desc, select, update

from returnpilot.agent.nodes.policy import evaluate_action
from returnpilot.api.deps import Principal, staff_only
from returnpilot.api.errors import ApiError
from returnpilot.api.runtime import runtime
from returnpilot.api.views import approval_customer_names, approval_detail, approval_summary
from returnpilot.config import get_settings
from returnpilot.db.models import Approval, AuditLog
from returnpilot.db.session import db_session

log = logging.getLogger(__name__)
router = APIRouter()


class DecisionIn(BaseModel):
    decision: Literal["approve", "approve_with_edit", "reject"]
    amount: float | None = Field(default=None, gt=0, le=100000)
    note: str | None = Field(default=None, max_length=500)


def _scoped(stmt: Any, p: Principal) -> Any:
    ws = p.scope_workspace
    return stmt.where(Approval.workspace_id == ws) if ws else stmt


async def _get(approval_id: uuid.UUID, p: Principal) -> Approval:
    async with db_session() as s:
        a = await s.scalar(_scoped(select(Approval).where(Approval.id == approval_id), p))
    if a is None:
        raise ApiError(404, "not_found", "Approval not found.")
    return a


@router.get("/v1/approvals")
async def list_approvals(
    status: Literal["pending", "decided"] = Query(default="pending"), p: Principal = Depends(staff_only)
) -> dict[str, Any]:
    stmt = select(Approval)
    stmt = stmt.where(Approval.status == "pending") if status == "pending" else stmt.where(Approval.status != "pending")
    stmt = _scoped(stmt, p).order_by(desc(Approval.created_at)).limit(100)
    async with db_session() as s:
        rows = list((await s.scalars(stmt)).all())
    names = await approval_customer_names(rows)
    return {"approvals": [approval_summary(a, names.get(a.customer_id, "Customer")) for a in rows]}


@router.get("/v1/approvals/{approval_id}")
async def get_approval(approval_id: uuid.UUID, p: Principal = Depends(staff_only)) -> dict[str, Any]:
    a = await _get(approval_id, p)
    names = await approval_customer_names([a])
    return approval_detail(a, names.get(a.customer_id, "Customer"))


async def _recheck(a: Approval, amount: float | None) -> dict[str, Any] | None:
    """Re-run the policy engine on the (possibly edited) action at decision time."""
    action = (a.evidence or {}).get("action") or {}
    return await evaluate_action(
        a.customer_id, a.action, dict(action.get("args") or a.args), amount_override=amount, exclude_approval_id=a.id
    )


@router.post("/v1/approvals/{approval_id}/decision")
async def decide(approval_id: uuid.UUID, body: DecisionIn, p: Principal = Depends(staff_only)) -> dict[str, Any]:
    a = await _get(approval_id, p)
    if a.status != "pending":
        raise ApiError(409, "already_decided", f"This request was already {a.status}.")
    amount = body.amount
    if body.decision == "approve_with_edit" and (a.action != "issue_refund" or amount is None):
        raise ApiError(422, "validation_error", "Approve with edit needs a refund amount.")
    if body.decision != "reject":
        check = await _recheck(a, amount if body.decision == "approve_with_edit" else None)
        if check is None or check["decision"] == "deny":
            reason = (check or {}).get("reasons", ["The item can no longer be found."])[0]
            raise ApiError(422, "policy_denied", f"Policy doesn't allow this: {reason}")
    decision = {
        "decision": body.decision,
        "amount": round(amount, 2) if amount is not None else None,
        "note": (body.note or "").strip() or None,
        "reviewer": p.name,
    }
    async with db_session() as s:
        res = await s.execute(
            update(Approval)
            .where(Approval.id == a.id, Approval.status == "pending")
            .values(
                status="rejected" if body.decision == "reject" else "approved",
                decided_by=p.sub,
                decided_at=datetime.now(UTC),
                decision=decision,
            )
        )
        if not res.rowcount:  # type: ignore[attr-defined]
            raise ApiError(409, "already_decided", "Someone else decided this request first.")
        s.add(
            AuditLog(
                actor=p.sub,
                action=f"approval_{body.decision}",
                target=str(a.id),
                details={
                    "amount": decision["amount"],
                    "note": decision["note"],
                    "original_amount": float(a.amount or 0),
                },
            )
        )
    try:
        await runtime.apply_decision(a, decision)
    except Exception:  # noqa: BLE001 - the decision is recorded; the reviewer still gets a response
        log.exception("could not resume run for approval %s", a.id)
    return await get_approval(approval_id, p)


async def expire_one(approval_id: uuid.UUID) -> bool:
    async with db_session() as s:
        a = await s.scalar(select(Approval).where(Approval.id == approval_id))
        if a is None or a.status != "pending":
            return False
        a.status, a.decided_at, a.decision, a.decided_by = (
            "expired",
            datetime.now(UTC),
            {"decision": "expired"},
            "system",
        )
        s.add(AuditLog(actor="system", action="approval_expired", target=str(a.id), details={}))
    await runtime.apply_decision(a, {"decision": "expired"})
    return True


async def expire_due() -> int:
    async with db_session() as s:
        ids = list(
            (
                await s.scalars(
                    select(Approval.id).where(Approval.status == "pending", Approval.expires_at < datetime.now(UTC))
                )
            ).all()
        )
    n = 0
    for aid in ids:
        try:
            n += await expire_one(aid)
        except Exception:  # noqa: BLE001
            log.exception("expiry failed for %s", aid)
    return n


@router.post("/internal/approvals/{approval_id}/expire")
async def internal_expire(approval_id: uuid.UUID, x_cron_token: str = Header(default="")) -> dict[str, Any]:
    if x_cron_token != get_settings().cron_token:
        raise ApiError(401, "unauthorized", "Bad cron token.")
    return {"expired": await expire_one(approval_id)}
