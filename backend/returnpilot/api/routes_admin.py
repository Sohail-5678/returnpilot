"""/v1/admin/metrics and /internal/cron/{job} (fallback scheduler, SPEC §12.1)."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy import text

from returnpilot import quota
from returnpilot.api.deps import Principal, admin_only
from returnpilot.api.errors import ApiError
from returnpilot.config import get_settings
from returnpilot.db.session import db_session

router = APIRouter()

_KPIS = text("""
SELECT count(*) AS runs,
       avg(CASE WHEN status IN ('ok','interrupted') THEN 1.0 ELSE 0.0 END) AS success_rate,
       avg(total_ms) AS avg_ms,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY total_ms) AS p50_ms,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY total_ms) AS p95_ms,
       coalesce(sum(tool_calls), 0) AS tool_calls,
       coalesce(sum(tokens_in + tokens_out), 0) AS tokens
FROM runs WHERE kind = 'turn' AND created_at > now() - make_interval(days => :d)
""")
_PER_DAY = text("""
WITH days AS (
  SELECT generate_series(date_trunc('day', now()) - make_interval(days => :d - 1), date_trunc('day', now()), interval '1 day') AS day
), turns AS (
  SELECT date_trunc('day', created_at) AS day, total_ms, status FROM runs
  WHERE kind = 'turn' AND created_at > now() - make_interval(days => :d)
)
SELECT to_char(d.day, 'YYYY-MM-DD') AS day, count(t.total_ms) AS runs,
       coalesce(sum(CASE WHEN t.status = 'error' THEN 1 ELSE 0 END), 0) AS errors,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY t.total_ms) AS p50_ms,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY t.total_ms) AS p95_ms
FROM days d LEFT JOIN turns t ON t.day = d.day
GROUP BY d.day ORDER BY d.day
""")
_ROUTES = text("""
SELECT coalesce(route, 'unknown') AS route, count(*) AS count FROM runs
WHERE kind = 'turn' AND created_at > now() - make_interval(days => :d) GROUP BY 1 ORDER BY 2 DESC
""")
_APPROVALS = text("""
SELECT status, count(*) AS count FROM approvals WHERE created_at > now() - make_interval(days => :d) GROUP BY 1
""")
# Live invariant: money over the auto-approve limit never moves without a human approval.
_VIOLATIONS = text("""
SELECT count(*) FROM refunds r
JOIN order_items oi ON oi.id = r.order_item_id JOIN orders o ON o.id = oi.order_id
WHERE r.thread_id IS NOT NULL AND r.status IN ('queued','issued')
  AND ((r.amount > :limit AND r.approval_id IS NULL) OR o.customer_id <> r.customer_id
       OR r.amount > oi.unit_price * oi.qty - oi.discount + o.shipping_cost)
""")
_EVALS = text("""
WITH latest AS (
  SELECT suite, run_label, git_sha, max(created_at) AS created_at FROM eval_results
  GROUP BY suite, run_label, git_sha ORDER BY max(created_at) DESC LIMIT 1
)
SELECT l.suite, l.run_label, l.git_sha, l.created_at, count(*) AS total, sum(CASE WHEN e.passed THEN 1 ELSE 0 END) AS passed,
       json_agg(e.details -> 'metrics') AS metrics
FROM latest l JOIN eval_results e ON e.run_label = l.run_label
GROUP BY l.suite, l.run_label, l.git_sha, l.created_at
""")


def _f(v: Any) -> float:
    return round(float(v), 3) if v is not None else 0.0


@router.get("/v1/admin/metrics")
async def metrics(days: int = Query(default=7, ge=1, le=30), _: Principal = Depends(admin_only)) -> dict[str, Any]:
    s_ = get_settings()
    async with db_session() as s:
        k = (await s.execute(_KPIS, {"d": days})).mappings().one()
        per_day = (await s.execute(_PER_DAY, {"d": days})).mappings().all()
        routes = (await s.execute(_ROUTES, {"d": days})).mappings().all()
        approvals = {r["status"]: r["count"] for r in (await s.execute(_APPROVALS, {"d": days})).mappings().all()}
        violations = (await s.execute(_VIOLATIONS, {"limit": s_.refund_auto_approve_limit})).scalar() or 0
        ev = (await s.execute(_EVALS)).mappings().first()
    usage = await quota.usage_today()
    evals = None
    if ev:
        metric_rows = [m for m in (ev["metrics"] or []) if isinstance(m, dict)]
        agg: dict[str, float] = {}
        for key in ("task_success", "trajectory_match", "approval_routing"):
            vals = [float(m[key]) for m in metric_rows if key in m]
            if vals:
                agg[key] = round(sum(vals) / len(vals), 3)
        agg["policy_violations"] = sum(int(m.get("policy_violations", 0)) for m in metric_rows)
        evals = {
            "suite": ev["suite"],
            "run_label": ev["run_label"],
            "git_sha": ev["git_sha"],
            "created_at": ev["created_at"].isoformat(),
            "total": ev["total"],
            "passed": ev["passed"],
            "metrics": agg,
        }
    return {
        "window_days": days,
        "kpis": {
            "runs": k["runs"],
            "success_rate": _f(k["success_rate"]),
            "approvals_pending": approvals.get("pending", 0),
            "approvals_decided": sum(v for st, v in approvals.items() if st != "pending"),
            "avg_latency_ms": int(k["avg_ms"] or 0),
            "p50_latency_ms": int(k["p50_ms"] or 0),
            "p95_latency_ms": int(k["p95_ms"] or 0),
            "tool_calls": int(k["tool_calls"]),
            "tokens": int(k["tokens"]),
            "policy_violations": int(violations),
        },
        "runs_per_day": [{"day": r["day"], "runs": r["runs"], "errors": r["errors"]} for r in per_day],
        "latency_per_day": [
            {"day": r["day"], "p50_ms": int(r["p50_ms"] or 0), "p95_ms": int(r["p95_ms"] or 0)}
            for r in per_day
            if r["runs"]
        ],
        "routes": [{"route": r["route"], "count": r["count"]} for r in routes],
        "approvals": {st: approvals.get(st, 0) for st in ("approved", "rejected", "expired", "pending")},
        "quota": [
            {
                "provider": provider,
                "kind": slot,
                "model": model,
                "used": usage.get((provider, slot), 0),
                "limit": req_limit,
                "tokens_used": usage.get((provider, f"{slot}:tokens"), 0) if tok_limit else None,
                "token_limit": tok_limit,
            }
            for provider, slot, model, req_limit, tok_limit in (
                ("gemini", "main", s_.main_model, s_.daily_budget_main_requests, s_.daily_budget_main_tokens),
                ("groq", "fast", s_.fast_model, s_.daily_budget_fast_requests, s_.daily_budget_fast_tokens),
                ("groq", "small", s_.small_model, s_.daily_budget_small_requests, s_.daily_budget_small_tokens),
                ("groq", "guard", s_.guard_model, s_.daily_budget_guard_requests, None),
                ("gemini", "lite", s_.gemini_model_lite, s_.daily_budget_lite_requests, s_.daily_budget_lite_tokens),
                ("gemini", "embed", s_.gemini_embed_model, s_.daily_budget_embed_requests, None),
            )
        ],
        "evals": evals,
    }


@router.post("/internal/cron/{job}")
async def cron(job: str, x_cron_token: str = Header(default="")) -> dict[str, Any]:
    if x_cron_token != get_settings().cron_token:
        raise ApiError(401, "unauthorized", "Bad cron token.")
    if job == "expire_approvals":
        from returnpilot.api.routes_reviews import expire_due

        return {"expired": await expire_due()}
    if job == "retention_cleanup":
        from returnpilot.jobs.tasks import retention_cleanup

        return {"deleted": await asyncio.to_thread(retention_cleanup)}
    if job == "reconcile_jobs":
        from returnpilot.jobs.tasks import reconcile_jobs

        return {"requeued": await asyncio.to_thread(reconcile_jobs)}
    raise ApiError(404, "not_found", f"Unknown job '{job}'.")


@router.get("/v1/admin/profile")
async def profile(_: Principal = Depends(admin_only)) -> dict[str, Any]:
    """Active agent profile, where it came from, and how it differs from the bundled default (SPEC §18.2)."""
    from returnpilot.agent import profile as prof

    active = await prof.get_active_profile()
    default = prof.default_profile()
    return {
        "active": active.model_dump(),
        "label": active.label,
        "source": prof.active_source(),
        "default_label": default.label,
        "diff": prof.diff(default, active),
        "locked": sorted(prof.LOCKED_KEYS),
        "agentforge": {"url": get_settings().agentforge_url or None, "profile_source": get_settings().profile_source},
    }
