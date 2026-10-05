"""Shared node helpers: streaming custom events to the SSE layer."""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from langchain_core.messages import AIMessage
from langgraph.config import get_stream_writer

log = logging.getLogger(__name__)


def emit(event: str, data: dict[str, Any]) -> None:
    """Send a custom event to the API's SSE stream (no-op when nothing is streaming)."""
    try:
        writer = get_stream_writer()
    except Exception:  # noqa: BLE001 - outside a streaming run
        return
    try:
        writer({"event": event, "data": data})
    except Exception:  # noqa: BLE001
        log.debug("emit failed for %s", event)


def ai_message(text: str, **meta: Any) -> AIMessage:
    """A fixed-copy assistant message with a stable id (so the UI can match stream events)."""
    return AIMessage(
        content=text, id=f"msg-{uuid.uuid4()}", response_metadata={"ts": datetime.now(UTC).isoformat(), **meta}
    )
