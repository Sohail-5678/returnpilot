"""tools node: run tool calls (MCP + local) with per-tool timeouts, argument errors that help the
model self-correct, loop detection and tool-chip events (SPEC §7.2, §9.3)."""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from langchain_core.messages import AIMessage, ToolMessage
from langgraph.runtime import Runtime
from pydantic import ValidationError

from returnpilot.agent.history import compact_json, parse_json, text_of, transcript
from returnpilot.agent.labels import tool_label
from returnpilot.agent.nodes.common import emit
from returnpilot.agent.state import AgentState, TurnContext
from returnpilot.guards.prompt_guard import scan_tool_payload

TOOL_TIMEOUT_S = 10.0


def _preview(text: str) -> str:
    data = parse_json(text)
    if data is None:
        return text[:160]
    for key in ("next_step", "error", "message"):
        if isinstance(data.get(key), str):
            return data[key][:160]
    if "decision" in data:
        return f"decision: {data['decision']}"
    if "eligible" in data:
        return "eligible" if data["eligible"] else "not eligible"
    if "orders" in data:
        return f"{len(data['orders'])} orders"
    if "items" in data:
        return f"order #{data.get('order_number')}: {len(data['items'])} items"
    return text[:160]


async def _run_one(ctx: TurnContext, call: dict[str, Any], repeated: bool) -> ToolMessage:
    name, args, call_id = call["name"], dict(call.get("args") or {}), call["id"]
    emit("tool", {"id": call_id, "name": name, "status": "started", "label": tool_label(name, args, done=False)})
    started = time.perf_counter()
    status = "success"
    if repeated:
        content = json.dumps(
            {"error": "You already called this tool with the same arguments in this turn. Use that result."}
        )
        status = "error"
    elif name not in ctx.tools.tools:
        content = json.dumps(
            {"error": f"Unknown tool '{name}'. Available tools: {', '.join(sorted(ctx.tools.tools))}."}
        )
        status = "error"
    else:
        tool = ctx.tools.tools[name]
        try:
            out = await asyncio.wait_for(
                tool.ainvoke({"args": args, "id": call_id, "name": name, "type": "tool_call"}), TOOL_TIMEOUT_S
            )
            if isinstance(out, ToolMessage):
                content = text_of(out)
                status = out.status or "success"
            else:
                content = out if isinstance(out, str) else json.dumps(out, default=str)
        except TimeoutError:
            content = json.dumps(
                {"error": f"{name} timed out after {int(TOOL_TIMEOUT_S)}s. Try again or offer a ticket."}
            )
            status = "error"
        except ValidationError as exc:
            fields = sorted({".".join(str(p) for p in e["loc"]) for e in exc.errors()})
            content = json.dumps({"error": f"Invalid arguments for {name}: check {', '.join(fields)}."})
            status = "error"
        except Exception as exc:  # noqa: BLE001 - surfaced to the model as a tool error
            content = json.dumps({"error": f"{name} failed: {str(exc)[:200]}"})
            status = "error"
    if content.startswith("Error executing tool"):
        content = json.dumps({"error": content.split(": ", 1)[-1]})
        status = "error"
    content = compact_json(content)
    ok = status != "error"
    blocked: list[dict[str, Any]] = []
    if ok:
        payload = parse_json(content)
        if payload is not None:
            # Indirect prompt injection arrives through tool results (order notes, policy copies).
            payload, blocked = await scan_tool_payload(name, payload)
            if blocked:
                content = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
                guard = ctx.tracer.add(
                    "guard", "prompt_guard_tool_result", input={"tool": name}, output={"blocked": blocked}
                )
                guard.status = "blocked"
    duration_ms = int((time.perf_counter() - started) * 1000)
    label = tool_label(name, args, done=True, result=content, ok=ok)
    emit(
        "tool",
        {"id": call_id, "name": name, "status": "ok" if ok else "error", "label": label, "duration_ms": duration_ms},
    )
    step = ctx.tracer.add(
        "tool", name, input=args, output=parse_json(content) or content[:500], status="ok" if ok else "error"
    )
    step.duration_ms = duration_ms
    return ToolMessage(
        content=content,
        tool_call_id=call_id,
        name=name,
        status="success" if ok else "error",
        id=f"tool-{call_id}",
        artifact={
            "label": label,
            "status": "ok" if ok else "error",
            "duration_ms": duration_ms,
            "preview": _preview(content),
        },
    )


async def tools(state: AgentState, runtime: Runtime[TurnContext]) -> dict[str, Any]:
    ctx = runtime.context
    ai = state["messages"][-1]
    assert isinstance(ai, AIMessage)
    ctx.tools.transcript = transcript(state["messages"])
    seen = list(state.get("tool_signatures", []))
    calls, repeats = [], []
    for call in ai.tool_calls:
        sig = call["name"] + json.dumps(call.get("args") or {}, sort_keys=True)
        repeats.append(sig in seen)
        seen.append(sig)
        calls.append(call)
    results = await asyncio.gather(*(_run_one(ctx, c, r) for c, r in zip(calls, repeats, strict=True)))

    retrieved = list(state.get("retrieved", []))
    for msg in results:
        if msg.name == "search_policy" and msg.status != "error":
            data = parse_json(text_of(msg)) or {}
            for sec in data.get("sections", []):
                retrieved.append(
                    {
                        "section_id": sec["section_id"],
                        "heading": sec.get("heading"),
                        "breadcrumb": sec.get("breadcrumb"),
                    }
                )
    out: dict[str, Any] = {"messages": results, "tool_signatures": seen, "retrieved": retrieved}
    if any('"_guard"' in text_of(m) for m in results):
        out["flags"] = {**state.get("flags", {}), "injection_suspected": True, "tool_result_flagged": True}
    if any(repeats):
        out["stop_reason"] = "repeated_tool_call"
    return out
