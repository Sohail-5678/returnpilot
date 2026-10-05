"""Checkpointed LangGraph messages → the chat shape in docs/API_CONTRACT.md."""

from __future__ import annotations

from typing import Any

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage

from returnpilot.agent.history import text_of
from returnpilot.agent.labels import tool_label

APPROVAL_KINDS = {"approval_pending", "approval_approved", "approval_rejected", "approval_expired"}


def to_ui_messages(messages: list[BaseMessage], approvals: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    pending_tools: list[dict[str, Any]] = []
    by_call: dict[str, dict[str, Any]] = {}
    for m in messages:
        if isinstance(m, HumanMessage):
            out.append(
                {
                    "id": m.id,
                    "role": "user",
                    "text": text_of(m),
                    "created_at": m.response_metadata.get("ts"),
                    "tools": [],
                    "citations": [],
                    "approval": None,
                    "flags": {},
                }
            )
        elif isinstance(m, AIMessage):
            for tc in m.tool_calls:
                chip = {
                    "id": tc["id"],
                    "name": tc["name"],
                    "args": tc.get("args") or {},
                    "status": "running",
                    "label": tool_label(tc["name"], tc.get("args") or {}, done=False),
                    "duration_ms": None,
                    "result_preview": None,
                }
                pending_tools.append(chip)
                by_call[tc["id"]] = chip
            text = text_of(m).strip()
            if not text:
                continue
            meta = m.response_metadata or {}
            approval = None
            kind = meta.get("rp_kind")
            if kind in APPROVAL_KINDS and meta.get("approval_id"):
                live = approvals.get(str(meta["approval_id"]), {})
                approval = {
                    "approval_id": str(meta["approval_id"]),
                    "status": live.get("status", kind.split("_", 1)[1])
                    if kind == "approval_pending"
                    else kind.split("_", 1)[1],
                    "amount": meta.get("amount"),
                    "note": meta.get("note") or (live.get("note") if kind != "approval_pending" else None),
                }
            out.append(
                {
                    "id": m.id,
                    "role": "assistant",
                    "text": text,
                    "created_at": meta.get("ts"),
                    "tools": pending_tools,
                    "citations": meta.get("citations", []),
                    "approval": approval,
                    "flags": {"guard_replaced": bool(meta.get("guard_replaced")), "kind": kind},
                }
            )
            pending_tools = []
        elif isinstance(m, ToolMessage):
            chip = by_call.get(m.tool_call_id)
            if chip is None:
                continue
            art = m.artifact if isinstance(m.artifact, dict) else {}
            chip.update(
                {
                    "status": art.get("status", "error" if m.status == "error" else "ok"),
                    "label": art.get("label") or tool_label(chip["name"], chip["args"], done=True, result=text_of(m)),
                    "duration_ms": art.get("duration_ms"),
                    "result_preview": art.get("preview"),
                }
            )
    if pending_tools:  # tools from a turn that hasn't produced text yet (e.g. still running)
        out.append(
            {
                "id": f"pending-{pending_tools[0]['id']}",
                "role": "assistant",
                "text": "",
                "created_at": None,
                "tools": pending_tools,
                "citations": [],
                "approval": None,
                "flags": {"kind": "in_progress"},
            }
        )
    return out
