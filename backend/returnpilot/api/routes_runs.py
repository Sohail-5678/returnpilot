"""/v1/runs: traces (admin: everything in scope; customer: own runs, redacted)."""

from __future__ import annotations

import asyncio
import uuid
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import desc, select, update

from returnpilot.agentforge import forward_feedback
from returnpilot.api.deps import Principal, customer_only, require
from returnpilot.api.errors import ApiError
from returnpilot.db.models import Run, RunStep
from returnpilot.db.session import db_session

router = APIRouter(prefix="/v1")
admin_or_customer = require("admin", "customer")


def _scope(stmt: Any, p: Principal) -> Any:
    if p.role == "customer":
        return stmt.where(Run.customer_id == p.customer_id)
    ws = p.scope_workspace
    return stmt.where(Run.workspace_id == ws) if ws else stmt


def _run(r: Run) -> dict[str, Any]:
    return {
        "id": str(r.id),
        "thread_id": str(r.thread_id) if r.thread_id else None,
        "kind": r.kind,
        "status": r.status,
        "route": r.route,
        "model_primary": r.model_primary,
        "total_ms": r.total_ms,
        "llm_calls": r.llm_calls,
        "tool_calls": r.tool_calls,
        "tokens_in": r.tokens_in,
        "tokens_out": r.tokens_out,
        "created_at": r.created_at.isoformat(),
        "first_user_text": r.first_user_text,
        "error": r.error,
        "profile_version": r.profile_version,
        "feedback": r.feedback_thumbs,
    }


@router.get("/runs")
async def list_runs(
    limit: int = Query(default=50, ge=1, le=200), p: Principal = Depends(admin_or_customer)
) -> dict[str, Any]:
    async with db_session() as s:
        rows = (await s.scalars(_scope(select(Run), p).order_by(desc(Run.created_at)).limit(limit))).all()
    return {"runs": [_run(r) for r in rows]}


@router.get("/runs/{run_id}")
async def get_run(run_id: uuid.UUID, p: Principal = Depends(admin_or_customer)) -> dict[str, Any]:
    async with db_session() as s:
        run = await s.scalar(_scope(select(Run).where(Run.id == run_id), p))
        if run is None:
            raise ApiError(404, "not_found", "Run not found.")
        steps = (await s.scalars(select(RunStep).where(RunStep.run_id == run_id).order_by(RunStep.seq))).all()
    customer = p.role == "customer"
    return {
        "run": _run(run),
        "steps": [
            {
                "seq": st.seq,
                "kind": st.kind,
                "name": st.name,
                "model": st.model,
                "started_at": st.started_at.isoformat(),
                "duration_ms": st.duration_ms,
                "tokens_in": st.tokens_in,
                "tokens_out": st.tokens_out,
                "status": st.status,
                # customers see the shape of their run, not raw model inputs
                "input": None if customer and st.kind == "llm" else st.input_redacted,
                "output": st.output_redacted,
                "error": st.error,
            }
            for st in steps
        ],
    }


class FeedbackIn(BaseModel):
    thumbs: Literal[-1, 1]
    comment: str | None = Field(default=None, max_length=500)


@router.post("/runs/{run_id}/feedback")
async def feedback(run_id: uuid.UUID, body: FeedbackIn, p: Principal = Depends(customer_only)) -> dict[str, Any]:
    """Thumbs up/down on an assistant reply (SPEC §18.1); forwarded to AgentForge when configured."""
    async with db_session() as s:
        res = await s.execute(
            update(Run)
            .where(Run.id == run_id, Run.customer_id == p.customer_id)
            .values(feedback_thumbs=body.thumbs, feedback_comment=body.comment)
        )
        if not res.rowcount:  # type: ignore[attr-defined]
            raise ApiError(404, "not_found", "Run not found.")
    asyncio.create_task(forward_feedback(run_id, body.thumbs, body.comment))
    return {"run_id": str(run_id), "thumbs": body.thumbs}
