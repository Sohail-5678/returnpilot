"""Scenario evals (SPEC §13) — a thin wrapper around the eval adapter (SPEC §18.3).

    # deterministic tier (scripted model; runs on every push in CI)
    EVAL_DATABASE_URL=postgresql://…/empty_db uv run --project backend python evals/run_evals.py
    # live tier (real Gemini/Groq; AgentForge normally runs this through the adapter)
    EVAL_DATABASE_URL=… GEMINI_API_KEY=… GROQ_API_KEY=… uv run --project backend python evals/run_evals.py --suite live

Builds `case.v1` cases from evals/scenarios/*.yaml, runs them with
`python -m returnpilot.eval_adapter run --check`, prints a Markdown report and, with --record,
stores results in `eval_results` (shown on the admin page). Exits non-zero below --min-success
or on any policy violation.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT.parent / "backend"
sys.path.insert(0, str(ROOT))
from build_cases import build  # noqa: E402


def summarize(cases: list[dict[str, Any]], results: list[dict[str, Any]], suite: str, label: str) -> dict[str, Any]:
    n = len(results) or 1
    traj = [all(v for k, v in r.get("checks", {}).items() if k.startswith("tools_")) for r in results]
    routing = [r["checks"]["approval_created"] for r in results if "approval_created" in r.get("checks", {})]
    turns = sorted(
        s["duration_ms"] or 0
        for r in results
        if r.get("trace")
        for s in r["trace"]["spans"]
        if s["kind"] == "llm" and s["name"] == "agent"
    )
    violations = sum(
        len([1 for v in (r.get("checks") or {}) if v == "must_not" and not r["checks"][v]]) for r in results
    )
    return {
        "suite": suite,
        "label": label,
        "git_sha": os.environ.get("GITHUB_SHA", "local")[:12],
        "scenarios": len(results),
        "passed": sum(bool(r.get("passed")) for r in results),
        "task_success": round(sum(bool(r.get("passed")) for r in results) / n, 3),
        "trajectory_match": round(sum(traj) / n, 3),
        "approval_routing": round(sum(routing) / len(routing), 3) if routing else None,
        "policy_violations": violations,
        "llm_step_p50_ms": turns[len(turns) // 2] if turns else 0,
        "list_price_cost_usd": round(
            sum((r.get("trace") or {}).get("metrics", {}).get("list_price_cost_usd", 0) for r in results), 4
        ),
    }


def to_markdown(s: dict[str, Any], cases: list[dict[str, Any]], results: list[dict[str, Any]]) -> str:
    routing = "n/a" if s["approval_routing"] is None else f"{s['approval_routing']:.0%}"
    titles = {c["case_id"]: c.get("title", c["case_id"]) for c in cases}
    lines = [
        f"### ReturnPilot evals — `{s['suite']}` ({s['git_sha']})",
        "",
        "| Metric | Result | Target |",
        "|---|---|---|",
        f"| Task success | {s['passed']}/{s['scenarios']} ({s['task_success']:.0%}) | ≥ 85% |",
        f"| Policy violations | {s['policy_violations']} | 0 |",
        f"| Approval routing | {routing} | 100% |",
        f"| Trajectory match | {s['trajectory_match']:.0%} | ≥ 90% |",
        f"| List-price cost of the run | ${s['list_price_cost_usd']:.4f} | — |",
        "",
        "| Scenario | Result | Tools |",
        "|---|---|---|",
    ]
    for r in results:
        failed = [k for k, v in (r.get("checks") or {}).items() if not v]
        tools = " → ".join((r.get("end_state") or {}).get("tools_called", [])) or "—"
        lines.append(
            f"| {titles.get(r['case_id'], r['case_id'])} | {'✅' if r.get('passed') else '❌ ' + ', '.join(failed)} | {tools} |"
        )
    return "\n".join(lines) + "\n"


def record(summary: dict[str, Any], results: list[dict[str, Any]]) -> None:
    """Store results in the app database (DATABASE_URL) for the admin page."""
    sys.path.insert(0, str(BACKEND))
    from returnpilot.db.models import EvalResult
    from returnpilot.db.session import sync_session

    with sync_session() as s:
        for r in results:
            checks = r.get("checks") or {}
            s.add(
                EvalResult(
                    suite=summary["suite"],
                    run_label=summary["label"],
                    scenario_id=r["case_id"],
                    passed=bool(r.get("passed")),
                    git_sha=summary["git_sha"],
                    details={
                        "checks": checks,
                        "metrics": {
                            "task_success": 1.0 if r.get("passed") else 0.0,
                            "trajectory_match": 1.0
                            if all(v for k, v in checks.items() if k.startswith("tools_"))
                            else 0.0,
                            **(
                                {"approval_routing": 1.0 if checks["approval_created"] else 0.0}
                                if "approval_created" in checks
                                else {}
                            ),
                            "policy_violations": 0 if checks.get("must_not", True) else 1,
                        },
                    },
                )
            )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--suite", choices=["deterministic", "live"], default="deterministic")
    ap.add_argument("--min-success", type=float, default=0.85)
    ap.add_argument("--record", action="store_true", help="write results to eval_results in DATABASE_URL")
    ap.add_argument("--concurrency", type=int, default=1)
    args = ap.parse_args()
    if not os.environ.get("EVAL_DATABASE_URL"):
        sys.exit("set EVAL_DATABASE_URL to an empty throwaway database (pgvector)")
    tmp = Path(tempfile.mkdtemp(prefix="rp-evals-"))
    cases_path, out_path = tmp / "cases.jsonl", tmp / "results.jsonl"
    cases_path.write_text(build())
    cmd = [
        sys.executable,
        "-m",
        "returnpilot.eval_adapter",
        "run",
        "--cases",
        str(cases_path),
        "--out",
        str(out_path),
        "--profile",
        str(BACKEND / "profiles" / "default.json"),
        "--check",
        "--concurrency",
        str(args.concurrency),
    ]
    if args.suite == "deterministic":
        cmd.append("--fake-llm")
    subprocess.run(cmd, cwd=BACKEND, check=False)
    cases = [json.loads(line) for line in cases_path.read_text().splitlines() if line.strip()]
    results = [json.loads(line) for line in out_path.read_text().splitlines() if line.strip()]
    label = f"{args.suite}-{datetime.now(UTC).strftime('%Y%m%d-%H%M%S')}"
    summary = summarize(cases, results, args.suite, label)
    md = to_markdown(summary, cases, results)
    reports = ROOT / "reports"
    reports.mkdir(exist_ok=True)
    (reports / f"{label}.json").write_text(json.dumps({"summary": summary, "results": results}, default=str))
    (reports / "latest.md").write_text(md)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as fh:
            fh.write(md)
    print("\n" + md)
    if args.record:
        record(summary, results)
    ok = summary["task_success"] >= args.min_success and summary["policy_violations"] == 0
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
