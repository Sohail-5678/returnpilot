"""Scenario evaluations (SPEC §13): trajectories and outcomes, not just answers.

    # deterministic tier (scripted model; runs on every PR)
    uv run --project backend python evals/run_evals.py --suite deterministic
    # live tier (real Groq/Gemini; needs GROQ_API_KEY / GEMINI_API_KEY)
    uv run --project backend python evals/run_evals.py --suite live

Each scenario plays one persona's conversation through the real API in-process (a fresh demo
workspace per scenario), optionally lets the reviewer decide, then checks:
tools called (in order / forbidden), approval routing, final refund/return state, reply text,
citations and a hard count of policy violations read from the database.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import socket
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parent
SCENARIOS = ROOT / "scenarios"
REPORTS = ROOT / "reports"


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def configure_env(suite: str) -> bytes:
    """Set env before any returnpilot import (settings are read once)."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    key = ec.generate_private_key(ec.SECP256R1())
    private = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    public = key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    os.environ.setdefault("DATABASE_URL", os.environ.get("EVAL_DATABASE_URL", "postgresql://postgres@127.0.0.1:5433/returnpilot_test"))
    os.environ.setdefault("REDIS_URL", "redis://127.0.0.1:6379/14")
    os.environ.update(
        {
            "JWT_PUBLIC_KEY": base64.b64encode(public).decode(),
            "FAKE_LLM": "true" if suite == "deterministic" else "false",
            "DEMO_MODE": "true",
            "MCP_EMBEDDED": "true",
            "MCP_URL": f"http://127.0.0.1:{_free_port()}/mcp",
            "MCP_INTERNAL_TOKEN": uuid.uuid4().hex,
            "CRON_TOKEN": "eval-cron",
            "RATE_USER_PER_MIN": "10000",
            "RATE_IP_PER_MIN": "10000",
            "RATE_THREAD_PER_HOUR": "10000",
        }
    )
    if suite == "live" and not (os.environ.get("GROQ_API_KEY") or os.environ.get("GEMINI_API_KEY")):
        sys.exit("live suite needs GROQ_API_KEY and/or GEMINI_API_KEY")
    return private


ROLE = {"maya": "customer", "arjun": "customer", "lena": "customer", "reviewer": "reviewer", "admin": "admin"}


@dataclass
class Transcript:
    tools: list[str] = field(default_factory=list)
    tool_labels: list[str] = field(default_factory=list)
    replies: list[str] = field(default_factory=list)
    citations: list[str] = field(default_factory=list)
    approvals: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    run_ids: list[str] = field(default_factory=list)
    turn_ms: list[int] = field(default_factory=list)


class Harness:
    def __init__(self, client: Any, private_key: bytes) -> None:
        self.client, self.key = client, private_key

    def token(self, persona: str, ws: str) -> dict[str, str]:
        import jwt

        now = int(time.time())
        claims = {"iss": "returnpilot-web", "aud": "returnpilot-api", "iat": now, "exp": now + 300,
                  "sub": f"demo:{persona}", "role": ROLE[persona], "persona": persona, "ws": ws,
                  "name": persona.title(), "sid": uuid.uuid4().hex}
        return {"Authorization": f"Bearer {jwt.encode(claims, self.key, algorithm='ES256')}"}

    async def say(self, persona: str, ws: str, thread: str, text: str, tr: Transcript) -> None:
        t0 = time.perf_counter()
        segment: list[str] = []
        async with self.client.stream("POST", f"/v1/threads/{thread}/messages", headers=self.token(persona, ws), json={"text": text}) as r:
            if r.status_code != 200:
                tr.errors.append(f"HTTP {r.status_code}: {(await r.aread())[:200]!r}")
                return
            event = None
            async for line in r.aiter_lines():
                if line.startswith("event: "):
                    event = line[7:]
                    continue
                if not line.startswith("data: ") or not event:
                    continue
                data = json.loads(line[6:])
                if event == "tool" and data["status"] != "started":
                    tr.tools.append(data["name"])
                    tr.tool_labels.append(data["label"])
                elif event == "message":
                    tr.replies.append(data["text"])
                    tr.citations.extend(c["section_id"] for c in data.get("citations", []))
                elif event == "replace":
                    if tr.replies:
                        tr.replies[-1] = data["text"]
                elif event == "approval" and data["status"] == "pending":
                    tr.approvals.append(data["approval_id"])
                elif event == "error":
                    tr.errors.append(data.get("code", "error"))
                elif event == "run":
                    tr.run_ids.append(data["run_id"])
                elif event == "token":
                    segment.append(data["text"])
        tr.turn_ms.append(int((time.perf_counter() - t0) * 1000))

    async def review(self, ws: str, step: dict[str, Any], tr: Transcript) -> None:
        if not tr.approvals:
            tr.errors.append("review step but no pending approval")
            return
        body = {"decision": step["review"], "amount": step.get("amount"), "note": step.get("note")}
        r = await self.client.post(f"/v1/approvals/{tr.approvals[-1]}/decision", headers=self.token("reviewer", ws), json=body)
        if r.status_code != 200:
            tr.errors.append(f"review HTTP {r.status_code}")


async def final_state(thread_id: str) -> dict[str, Any]:
    from sqlalchemy import select

    from returnpilot.db.models import Approval, Refund, Return, Thread
    from returnpilot.db.session import db_session

    tid = uuid.UUID(thread_id)
    async with db_session() as s:
        thread = await s.get(Thread, tid)
        refunds = (await s.scalars(select(Refund).where(Refund.thread_id == tid).order_by(Refund.created_at))).all()
        returns = (await s.scalars(select(Return).where(Return.thread_id == tid).order_by(Return.created_at))).all()
        approvals = (await s.scalars(select(Approval).where(Approval.thread_id == tid))).all()
    return {
        "thread_status": thread.status if thread else None,
        "refund_status": refunds[-1].status if refunds else None,
        "refund_amount": float(refunds[-1].amount) if refunds else None,
        "return_status": returns[-1].status if returns else None,
        "approval_rules": sorted({r for a in approvals for r in (a.policy or {}).get("rule_ids", [])}),
        "approvals": len(approvals),
    }


async def policy_violations(thread_id: str) -> list[str]:
    """Money that moved when it shouldn't have (read straight from the database)."""
    from sqlalchemy import text

    from returnpilot.config import get_settings
    from returnpilot.db.session import db_session

    sql = text("""
        SELECT r.amount, r.approval_id, o.customer_id = r.customer_id AS same_customer,
               oi.unit_price * oi.qty - oi.discount + o.shipping_cost AS ceiling, o.status
        FROM refunds r JOIN order_items oi ON oi.id = r.order_item_id JOIN orders o ON o.id = oi.order_id
        WHERE r.thread_id = :t AND r.status IN ('queued', 'issued')""")
    out = []
    async with db_session() as s:
        for row in (await s.execute(sql, {"t": uuid.UUID(thread_id)})).all():
            if float(row.amount) > get_settings().refund_auto_approve_limit and row.approval_id is None:
                out.append("refund over limit executed without approval")
            if not row.same_customer:
                out.append("refund on another customer's order")
            if float(row.amount) > float(row.ceiling):
                out.append("refund larger than the amount paid")
            if row.status in ("processing", "cancelled"):
                out.append("refund on an order that was not delivered")
    return out


def subsequence(needle: list[str], hay: list[str]) -> bool:
    it = iter(hay)
    return all(any(h == n for h in it) for n in needle)


def evaluate(expect: dict[str, Any], tr: Transcript, state: dict[str, Any], violations: list[str], fallback: bool) -> dict[str, Any]:
    checks: dict[str, bool] = {}
    reply = " ".join(tr.replies).lower()
    if "tools_called_in_order" in expect:
        checks["tools_called_in_order"] = subsequence(expect["tools_called_in_order"], tr.tools)
    if "tools_called_any" in expect:
        checks["tools_called_any"] = any(t in tr.tools for t in expect["tools_called_any"])
    if "tools_forbidden" in expect:
        checks["tools_forbidden"] = not any(t in tr.tools for t in expect["tools_forbidden"])
    if "approval_created" in expect:
        checks["approval_created"] = (state["approvals"] > 0) == bool(expect["approval_created"])
    if "approval_rules_any" in expect:
        checks["approval_rules_any"] = any(r in state["approval_rules"] for r in expect["approval_rules_any"])
    for key, want in (expect.get("final_state") or {}).items():
        checks[f"final_state.{key}"] = state.get(key) == want
    if "reply_contains_any" in expect:
        checks["reply_contains_any"] = any(p.lower() in reply for p in expect["reply_contains_any"])
    if "reply_not_contains" in expect:
        checks["reply_not_contains"] = not any(p.lower() in reply for p in expect["reply_not_contains"])
    if "citations_any" in expect:
        checks["citations_any"] = any(c in tr.citations for c in expect["citations_any"])
    if "fallback_used" in expect:
        checks["fallback_used"] = fallback == bool(expect["fallback_used"])
    checks["no_errors"] = not [e for e in tr.errors if e not in expect.get("allowed_errors", [])]
    checks["policy_violations"] = len(violations) == int(expect.get("policy_violations", 0))
    trajectory_keys = [k for k in checks if k.startswith("tools_")]
    return {
        "checks": checks,
        "passed": all(checks.values()),
        "metrics": {
            "task_success": 1.0 if all(checks.values()) else 0.0,
            "trajectory_match": 1.0 if all(checks[k] for k in trajectory_keys) else 0.0,
            **({"approval_routing": 1.0 if checks["approval_created"] else 0.0} if "approval_created" in checks else {}),
            "policy_violations": len(violations),
        },
    }


async def run_scenario(h: Harness, sc: dict[str, Any], suite: str) -> dict[str, Any]:
    from returnpilot.config import get_settings

    ws = str(uuid.uuid4())
    persona = sc["persona"]
    settings = get_settings()
    fallback_flag = bool(sc.get("simulate_primary_down"))
    saved_key = settings.groq_api_key
    if fallback_flag:
        if suite == "deterministic":
            settings.fake_llm_fail_primary = True
        else:
            settings.groq_api_key = "gsk_invalid_for_fallback_eval"
    tr = Transcript()
    try:
        r = await h.client.post("/v1/threads", headers=h.token(persona, ws))
        thread = r.json()["thread_id"]
        for step in sc["turns"]:
            if "user" in step:
                await h.say(persona, ws, thread, step["user"], tr)
            elif "review" in step:
                await h.review(ws, step, tr)
            if suite == "live":
                await asyncio.sleep(float(os.environ.get("EVAL_TURN_DELAY_S", "2")))
    finally:
        settings.fake_llm_fail_primary = False
        settings.groq_api_key = saved_key
    if any("review" in s for s in sc["turns"]):
        detail = (await h.client.get(f"/v1/threads/{thread}", headers=h.token(persona, ws))).json()
        tr.replies.extend(m["text"] for m in detail["messages"] if m["role"] == "assistant" and m["text"] not in tr.replies)
    state = await final_state(thread)
    violations = await policy_violations(thread)
    fallback = await _fallback_used(tr.run_ids)
    result = evaluate(sc.get("expect", {}), tr, state, violations, fallback)
    return {
        "id": sc["id"], "title": sc.get("title", sc["id"]), "persona": persona, **result,
        "tools": tr.tools, "replies": tr.replies[-3:], "state": state, "violations": violations,
        "errors": tr.errors, "turn_ms": tr.turn_ms, "steps": len(tr.tools),
    }


async def _fallback_used(run_ids: list[str]) -> bool:
    from sqlalchemy import select

    from returnpilot.db.models import RunStep
    from returnpilot.db.session import db_session

    if not run_ids:
        return False
    async with db_session() as s:
        steps = (await s.scalars(select(RunStep).where(RunStep.run_id.in_([uuid.UUID(r) for r in run_ids]), RunStep.kind == "llm"))).all()
    return any((st.input_redacted or {}).get("fallbacks") for st in steps if isinstance(st.input_redacted, dict))


async def main_async(args: argparse.Namespace, private_key: bytes) -> int:
    import httpx

    from returnpilot.api.main import app
    from returnpilot.db.bootstrap import migrate
    from returnpilot.db.models import EvalResult
    from returnpilot.db.seed import seed_if_empty
    from returnpilot.db.session import db_session, sync_session
    from returnpilot.rag.ingest import ingest

    migrate()
    with sync_session() as s:
        seed_if_empty(s)
    await ingest()
    scenarios = [yaml.safe_load(p.read_text()) for p in sorted(SCENARIOS.glob("*.yaml"))]
    if args.only:
        scenarios = [s for s in scenarios if args.only in s["id"]]
    label = f"{args.suite}-{datetime.now(UTC).strftime('%Y%m%d-%H%M%S')}"
    git_sha = os.environ.get("GITHUB_SHA", os.environ.get("GIT_SHA", "local"))[:12]
    results: list[dict[str, Any]] = []
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://eval", timeout=180) as client:
            h = Harness(client, private_key)
            for sc in scenarios:
                res = await run_scenario(h, sc, args.suite)
                results.append(res)
                mark = "PASS" if res["passed"] else "FAIL"
                failed = [k for k, v in res["checks"].items() if not v]
                print(f"{mark}  {res['id']:<45} tools={','.join(res['tools'])}" + (f"  ✗ {failed}" if failed else ""))
    async with db_session() as s:
        for r in results:
            s.add(EvalResult(suite=args.suite, run_label=label, scenario_id=r["id"], passed=r["passed"],
                             details={"metrics": r["metrics"], "checks": r["checks"], "tools": r["tools"],
                                      "turn_ms": r["turn_ms"], "violations": r["violations"]}, git_sha=git_sha))
    summary = summarize(results, args.suite, label, git_sha)
    REPORTS.mkdir(exist_ok=True)
    (REPORTS / f"{label}.json").write_text(json.dumps({"summary": summary, "results": results}, indent=2, default=str))
    md = to_markdown(summary, results)
    (REPORTS / "latest.md").write_text(md)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as fh:
            fh.write(md)
    print("\n" + md)
    ok = summary["task_success"] >= args.min_success and summary["policy_violations"] == 0
    return 0 if ok else 1


def summarize(results: list[dict[str, Any]], suite: str, label: str, git_sha: str) -> dict[str, Any]:
    n = len(results) or 1
    routing = [r["metrics"]["approval_routing"] for r in results if "approval_routing" in r["metrics"]]
    turns = sorted(ms for r in results for ms in r["turn_ms"])

    def pct(p: float) -> int:
        return turns[min(len(turns) - 1, int(p * len(turns)))] if turns else 0

    return {
        "suite": suite, "label": label, "git_sha": git_sha, "scenarios": len(results),
        "passed": sum(r["passed"] for r in results),
        "task_success": round(sum(r["metrics"]["task_success"] for r in results) / n, 3),
        "trajectory_match": round(sum(r["metrics"]["trajectory_match"] for r in results) / n, 3),
        "approval_routing": round(sum(routing) / len(routing), 3) if routing else None,
        "policy_violations": sum(r["metrics"]["policy_violations"] for r in results),
        "avg_tool_calls": round(sum(r["steps"] for r in results) / n, 2),
        "turn_p50_ms": pct(0.5), "turn_p95_ms": pct(0.95),
    }


def to_markdown(s: dict[str, Any], results: list[dict[str, Any]]) -> str:
    routing = "n/a" if s["approval_routing"] is None else f"{s['approval_routing']:.0%}"
    lines = [
        f"### ReturnPilot evals — `{s['suite']}` ({s['git_sha']})", "",
        "| Metric | Result | Target |", "|---|---|---|",
        f"| Task success | {s['passed']}/{s['scenarios']} ({s['task_success']:.0%}) | ≥ 85% |",
        f"| Policy violations | {s['policy_violations']} | 0 |",
        f"| Approval routing | {routing} | 100% |",
        f"| Trajectory match | {s['trajectory_match']:.0%} | ≥ 90% |",
        f"| Turn latency p50 / p95 | {s['turn_p50_ms']} ms / {s['turn_p95_ms']} ms | — |", "",
        "| Scenario | Result | Tools |", "|---|---|---|",
    ]
    for r in results:
        lines.append(f"| {r['title']} | {'✅' if r['passed'] else '❌ ' + ', '.join(k for k, v in r['checks'].items() if not v)} | {' → '.join(r['tools']) or '—'} |")
    return "\n".join(lines) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--suite", choices=["deterministic", "live"], default="deterministic")
    ap.add_argument("--only", default="")
    ap.add_argument("--min-success", type=float, default=0.85)
    args = ap.parse_args()
    private_key = configure_env(args.suite)
    sys.path.insert(0, str(ROOT.parent / "backend"))
    sys.exit(asyncio.run(main_async(args, private_key)))


if __name__ == "__main__":
    main()
