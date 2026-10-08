"""AgentForge integration (SPEC §18.1, §S.2): `trace.v1` export and feedback forwarding.

Every finished run is converted into a `trace.v1` document (redacted, with a list-price cost so
optimization is measurable even though we pay $0) and sent to AgentForge in batches from a
background task. Export never blocks or fails a user's request: 3 retries with backoff, then drop.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

import httpx
from sqlalchemy import func, select, update

from returnpilot.config import get_settings
from returnpilot.db.models import Approval, AuditLog, Refund, Return, Run, RunStep, Thread, Ticket
from returnpilot.db.session import db_session
from returnpilot.guards.pii import redact

log = logging.getLogger(__name__)

BATCH = 20
CURRENT_CASE: dict[str, str | None] = {"id": None}  # set by the eval adapter (one case at a time per process)
STEP_KIND = {
    "node": "node",
    "llm": "llm",
    "tool": "tool",
    "guard": "guard",
    "policy": "node",
    "interrupt": "human",
    "job": "node",
}


def _provider_model(model: str | None) -> tuple[str | None, str | None]:
    if not model:
        return None, None
    if ":" in model and not model.startswith(("openai/", "meta-llama/")):
        provider, name = model.split(":", 1)
        return provider, name
    return ("gemini" if "gemini" in model else "groq"), model


def list_price_usd(model: str | None, tokens_in: int, tokens_out: int) -> float:
    if not model:
        return 0.0
    table = get_settings().price_table
    m = model.lower()
    key = (
        "gemini-flash-lite"
        if "lite" in m and "gemini" in m
        else "gemini-flash"
        if "gemini" in m
        else "gpt-oss-120b"
        if "120b" in m
        else "gpt-oss-20b"
        if "20b" in m
        else "prompt-guard"
        if "guard" in m
        else None
    )
    if key is None:
        return 0.0
    pin, pout = table[key]
    return (tokens_in * pin + tokens_out * pout) / 1_000_000


async def end_state(thread_id: uuid.UUID | None, steps: list[RunStep]) -> dict[str, Any]:
    """ReturnPilot's checkable state (SPEC §18.1)."""
    state: dict[str, Any] = {
        "refund_status": None,
        "return_status": None,
        "approval_status": None,
        "ticket_created": False,
        "policy_decisions": [],
        "tools_called": [],
        "thread_status": None,
    }
    state["tools_called"] = [s.name for s in steps if s.kind == "tool" and not s.name.startswith("prompt_guard")]
    if thread_id is None:
        return state
    async with db_session() as s:
        thread = await s.get(Thread, thread_id)
        refund = (
            await s.scalars(select(Refund).where(Refund.thread_id == thread_id).order_by(Refund.created_at.desc()))
        ).first()
        ret = (
            await s.scalars(select(Return).where(Return.thread_id == thread_id).order_by(Return.created_at.desc()))
        ).first()
        approval = (
            await s.scalars(
                select(Approval).where(Approval.thread_id == thread_id).order_by(Approval.created_at.desc())
            )
        ).first()
        tickets = await s.scalar(select(func.count()).select_from(Ticket).where(Ticket.thread_id == thread_id))
        decisions = (
            await s.scalars(
                select(AuditLog)
                .where(
                    AuditLog.action.like("policy_decision:%"), AuditLog.details["thread_id"].astext == str(thread_id)
                )
                .order_by(AuditLog.id)
            )
        ).all()
    state.update(
        thread_status=thread.status if thread else None,
        refund_status=refund.status if refund else None,
        return_status=ret.status if ret else None,
        approval_status=approval.status if approval else None,
        ticket_created=bool(tickets),
        policy_decisions=[
            {"tool": d.action.split(":", 1)[1], "item": d.target, **(d.details or {})} for d in decisions
        ],
    )
    state["policy_decisions"] = [{k: v for k, v in d.items() if k != "thread_id"} for d in state["policy_decisions"]]
    return state


def _status(runs: list[Run], state: dict[str, Any], steps: list[RunStep]) -> str:
    if any(r.status == "budget_exceeded" for r in runs):
        return "budget_exceeded"
    if any(r.status == "error" for r in runs):
        return "error"
    if any(s.kind == "guard" and s.status == "blocked" and s.name == "input_guard" for s in steps):
        return "blocked"
    if state.get("approval_status") == "pending" or state.get("thread_status") == "escalated":
        return "needs_human"
    return "success"


async def build_trace(
    run_ids: list[uuid.UUID],
    *,
    mode: str = "live",
    case_id: str | None = None,
    trace_id: uuid.UUID | None = None,
    input_turns: list[str] | None = None,
) -> dict[str, Any] | None:
    """One `trace.v1` for one run (live) or for every run of an eval case, in order."""
    async with db_session() as s:
        runs = list((await s.scalars(select(Run).where(Run.id.in_(run_ids)).order_by(Run.created_at))).all())
        if not runs:
            return None
        steps = list(
            (
                await s.scalars(
                    select(RunStep).where(RunStep.run_id.in_(run_ids)).order_by(RunStep.run_id, RunStep.seq)
                )
            ).all()
        )
    order = {r.id: i for i, r in enumerate(runs)}
    steps.sort(key=lambda st: (order[st.run_id], st.seq))
    state = await end_state(runs[0].thread_id, steps)
    spans, cost = [], 0.0
    for i, st in enumerate(steps, start=1):
        provider, model = _provider_model(st.model)
        cost += list_price_usd(model, st.tokens_in or 0, st.tokens_out or 0)
        spans.append(
            {
                "span_id": f"s{i}",
                "parent_id": None,
                "kind": STEP_KIND.get(st.kind, "node"),
                "name": st.name,
                "started_at": st.started_at.isoformat(),
                "duration_ms": st.duration_ms,
                "provider": provider,
                "model": model,
                "tokens_in": st.tokens_in,
                "tokens_out": st.tokens_out,
                "status": st.status if st.status in ("ok", "error", "blocked") else "ok",
                "error": st.error,
                "input_redacted": redact(st.input_redacted) or {},
                "output_redacted": redact(st.output_redacted) or {},
                "attributes": {"run_id": str(st.run_id), "step_kind": st.kind},
            }
        )
    first, last = runs[0], runs[-1]
    ended = max((st.started_at for st in steps), default=last.created_at)
    final = next((r for r in reversed(runs) if r.kind == "turn"), last)
    texts = input_turns or [r.first_user_text for r in runs if r.kind == "turn" and r.first_user_text]
    s_ = get_settings()
    return {
        "contract_version": "trace.v1",
        "trace_id": str(trace_id or first.id),
        "agent": "returnpilot",
        "agent_version": s_.git_sha,
        "profile_version": first.profile_version,
        "mode": mode,
        "case_id": case_id,
        "started_at": first.created_at.isoformat(),
        "ended_at": ended.isoformat(),
        "status": _status(runs, state, steps),
        "input": {"turns": [redact(t) for t in texts]},
        "final_output": {"reply": redact(_final_reply(steps)), "proposed_actions": state["policy_decisions"]},
        "end_state": state,
        "spans": spans,
        "metrics": {
            "llm_calls": sum(r.llm_calls for r in runs),
            "tool_calls": sum(r.tool_calls for r in runs),
            "tokens_in": sum(r.tokens_in for r in runs),
            "tokens_out": sum(r.tokens_out for r in runs),
            "latency_ms": sum(r.total_ms or 0 for r in runs if r.kind == "turn"),
            "list_price_cost_usd": round(cost, 6),
        },
        "feedback": {"thumbs": final.feedback_thumbs, "comment": final.feedback_comment},
    }


def _final_reply(steps: list[RunStep]) -> str | None:
    for st in reversed(steps):
        if st.kind == "llm" and st.name == "agent" and isinstance(st.output_redacted, dict):
            text = st.output_redacted.get("text")
            if text:
                return str(text)
    return None


# ---------------------------------------------------------------------------------------- live export


class Exporter:
    def __init__(self) -> None:
        self.queue: asyncio.Queue[uuid.UUID] = asyncio.Queue(maxsize=1000)
        self.task: asyncio.Task[None] | None = None

    @property
    def enabled(self) -> bool:
        s = get_settings()
        return bool(s.agentforge_url and s.agentforge_key) and not s.eval_mode

    def submit(self, run_id: uuid.UUID) -> None:
        if not self.enabled:
            return
        if self.task is None or self.task.done():
            self.task = asyncio.create_task(self._loop())
        try:
            self.queue.put_nowait(run_id)
        except asyncio.QueueFull:
            log.warning("trace export queue full; dropping run %s", run_id)

    async def _loop(self) -> None:
        while True:
            batch = [await self.queue.get()]
            await asyncio.sleep(2)  # let a few runs accumulate
            while not self.queue.empty() and len(batch) < BATCH:
                batch.append(self.queue.get_nowait())
            await self._send(batch)

    async def _send(self, run_ids: list[uuid.UUID]) -> None:
        traces = [t for t in [await build_trace([rid]) for rid in run_ids] if t]
        if not traces:
            return
        s = get_settings()
        for attempt in range(3):
            try:
                async with httpx.AsyncClient(timeout=10) as client:
                    r = await client.post(
                        f"{s.agentforge_url.rstrip('/')}/v1/traces",
                        json={"traces": traces},
                        headers={"X-AgentForge-Key": s.agentforge_key},
                    )
                    r.raise_for_status()
                async with db_session() as db:
                    await db.execute(update(Run).where(Run.id.in_(run_ids)).values(exported_at=datetime.now(UTC)))
                return
            except Exception as exc:  # noqa: BLE001
                log.info("trace export attempt %s failed: %s", attempt + 1, exc)
                await asyncio.sleep(2 ** (attempt + 1))
        log.warning("dropping %s traces after 3 failed exports", len(traces))


exporter = Exporter()


async def forward_feedback(run_id: uuid.UUID, thumbs: int, comment: str | None) -> None:
    s = get_settings()
    if not (s.agentforge_url and s.agentforge_key):
        return
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            await client.patch(
                f"{s.agentforge_url.rstrip('/')}/v1/traces/{run_id}/feedback",
                json={"thumbs": thumbs, "comment": comment},
                headers={"X-AgentForge-Key": s.agentforge_key},
            )
    except Exception as exc:  # noqa: BLE001
        log.info("feedback forward failed: %s", exc)
