"""/v1/runs: traces (admin: everything in scope; customer: own runs, redacted)."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc, select

from returnpilot.api.deps import Principal, require
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
