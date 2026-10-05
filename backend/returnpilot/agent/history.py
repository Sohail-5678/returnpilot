"""Helpers over the message history."""

from __future__ import annotations

import json
from typing import Any

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, ToolMessage

KEEP_FOR_LLM = 12


def text_of(message: BaseMessage) -> str:
    content = message.content
    if isinstance(content, str):
        return content
    parts = []
    for block in content:
        if isinstance(block, dict) and block.get("type") == "text":
            parts.append(str(block.get("text", "")))
        elif isinstance(block, str):
            parts.append(block)
    return "".join(parts)


def last_human_text(messages: list[BaseMessage]) -> str:
    for m in reversed(messages):
        if isinstance(m, HumanMessage):
            return text_of(m)
    return ""


def trim_for_llm(messages: list[BaseMessage], keep: int = KEEP_FOR_LLM) -> list[BaseMessage]:
    """Last `keep` messages, never starting on an orphaned tool result or a tool-call message
    whose results were cut off."""
    window = list(messages) if len(messages) <= keep else list(messages[-keep:])
    while window and not isinstance(window[0], HumanMessage):
        window.pop(0)
    return window or [m for m in messages if isinstance(m, HumanMessage)][-1:]


def tool_texts(messages: list[BaseMessage]) -> list[str]:
    return [text_of(m) for m in messages if isinstance(m, ToolMessage)]


def user_texts(messages: list[BaseMessage]) -> list[str]:
    return [text_of(m) for m in messages if isinstance(m, HumanMessage)]


def tool_call_args(messages: list[BaseMessage], tool_call_id: str) -> dict[str, Any] | None:
    for m in reversed(messages):
        if isinstance(m, AIMessage):
            for tc in m.tool_calls:
                if tc.get("id") == tool_call_id:
                    return dict(tc.get("args") or {})
    return None


def parse_json(text: str) -> dict[str, Any] | None:
    try:
        data = json.loads(text)
    except (ValueError, TypeError):
        return None
    return data if isinstance(data, dict) else None


def compact_json(text: str) -> str:
    """Re-serialize JSON tool output without indentation (saves prompt tokens)."""
    data: Any
    try:
        data = json.loads(text)
    except (ValueError, TypeError):
        return text
    return json.dumps(data, separators=(",", ":"), ensure_ascii=False)


def transcript(messages: list[BaseMessage], limit: int = 2000) -> str:
    lines = []
    for m in messages:
        if isinstance(m, HumanMessage):
            lines.append(f"Customer: {text_of(m)}")
        elif isinstance(m, AIMessage) and text_of(m):
            lines.append(f"ReturnPilot: {text_of(m)}")
    return "\n".join(lines)[-limit:]
