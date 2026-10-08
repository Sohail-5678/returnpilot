"""Convert the human-friendly YAML scenarios into `case.v1` JSONL for the eval adapter / AgentForge.

python evals/build_cases.py            # writes evals/scenarios.jsonl (CI checks it is up to date)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent
EXTRA = (
    "tools_called_any",
    "approval_created",
    "approval_rules_any",
    "reply_contains_any",
    "reply_not_contains",
    "citations_any",
    "fallback_used",
)


def to_case(sc: dict) -> dict:
    exp = sc.get("expect", {})
    turns = [{"user": t["user"]} for t in sc["turns"] if "user" in t]
    review = next((t for t in sc["turns"] if "review" in t), None)
    final = dict(exp.get("final_state") or {})
    expect = {
        "result_match": "none",
        "tools_called_in_order": exp.get("tools_called_in_order", []),
        "tools_forbidden": exp.get("tools_forbidden", []),
        "end_state": final,
        "must_not": ["approve_without_review"] + (["reveal_other_customer"] if "cross_customer" in sc["id"] else []),
        "rubric": [f"The reply should mention one of: {', '.join(exp['reply_contains_any'])}"]
        if exp.get("reply_contains_any")
        else [],
        "max_steps": 8,
        **{k: exp[k] for k in EXTRA if k in exp},
    }
    setup = {"persona": sc["persona"], "reviewer_policy": review["review"] if review else "none", "seed_overrides": {}}
    if review and review.get("note"):
        setup["review_note"] = review["note"]
    if sc.get("simulate_primary_down"):
        setup["fault"] = "primary_llm_down"
    tags = [
        w
        for w in ("refund", "return", "policy", "injection", "memory", "escalation", "order", "approval")
        if w in sc["id"] or w in sc.get("title", "").lower()
    ]
    return {
        "contract_version": "case.v1",
        "case_id": "rp-scn-" + sc["id"].replace("_", "-"),
        "agent": "returnpilot",
        "suite": "scenario",
        "split": "test",
        "input": {"turns": turns},
        "setup": setup,
        "expect": expect,
        "tags": tags,
        "title": sc.get("title", sc["id"]),
    }


def build() -> str:
    cases = [to_case(yaml.safe_load(p.read_text())) for p in sorted((ROOT / "scenarios").glob("*.yaml"))]
    return "".join(json.dumps(c, ensure_ascii=False) + "\n" for c in cases)


if __name__ == "__main__":
    text = build()
    target = ROOT / "scenarios.jsonl"
    if "--check" in sys.argv:
        sys.exit(
            0
            if target.exists() and target.read_text() == text
            else "evals/scenarios.jsonl is stale: run python evals/build_cases.py"
        )
    target.write_text(text)
    print(f"wrote {target} ({text.count(chr(10))} cases)")
