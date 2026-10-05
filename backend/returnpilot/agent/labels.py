"""Plain-English labels for tool chips (SPEC §2.4: "Checked return eligibility for order #1042")."""

from __future__ import annotations

import json
from typing import Any


def _order_of(ref: Any) -> str:
    ref = str(ref or "")
    return ref.split("-")[0].lstrip("#") if ref else ""


def tool_label(name: str, args: dict[str, Any], *, done: bool, result: str | None = None, ok: bool = True) -> str:
    if not ok:
        return {
            "get_order": f"Couldn't find order #{str(args.get('order_id', '')).lstrip('#')}",
        }.get(name, f"{name.replace('_', ' ').capitalize()} didn't work")
    order = _order_of(args.get("order_item_id"))
    amount = args.get("amount")
    decision = None
    if result and name in ("issue_refund", "create_return"):
        try:
            decision = json.loads(result).get("decision")
        except (ValueError, AttributeError):
            decision = None
    suffix = {
        "allow": " — approved by policy",
        "needs_approval": " — needs a team member",
        "deny": " — not allowed",
    }.get(decision or "", "")
    labels = {
        "list_orders": ("Looking up your orders", "Looked up your orders"),
        "get_order": (
            f"Looking up order #{str(args.get('order_id', '')).lstrip('#')}",
            f"Looked up order #{str(args.get('order_id', '')).lstrip('#')}",
        ),
        "check_return_eligibility": (
            f"Checking return eligibility (#{order})",
            f"Checked return eligibility (#{order})",
        ),
        "create_return": (f"Preparing a return (#{order})", f"Prepared a return (#{order}){suffix}"),
        "issue_refund": (
            f"Proposing a refund of ${float(amount or 0):,.2f}",
            f"Proposed a refund of ${float(amount or 0):,.2f}{suffix}",
        ),
        "create_ticket": ("Opening a support ticket", "Opened a support ticket"),
        "search_policy": ("Reading the store policy", "Read the store policy"),
        "recall_memories": ("Checking your saved preferences", "Checked your saved preferences"),
        "escalate_to_human": ("Handing this to a team member", "Opened a ticket for a team member"),
    }
    pair = labels.get(name, (f"Running {name}", f"Ran {name}"))
    if name == "search_policy" and done and result:
        try:
            hits = json.loads(result).get("sections", [])
            if hits:
                return f"Read policy: {hits[0].get('breadcrumb') or hits[0].get('heading')}"
        except (ValueError, AttributeError):
            pass
    return pair[1] if done else pair[0]
