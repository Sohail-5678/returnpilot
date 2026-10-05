"""Running conversation summary (SPEC §8.3): turns older than the last 12 messages are folded
into `threads.summary` so prompts stay small while long conversations keep their context."""

from __future__ import annotations

import logging
import uuid

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from sqlalchemy import update

from returnpilot.agent import llm
from returnpilot.agent.prompts import SUMMARY_SYSTEM
from returnpilot.config import get_settings
from returnpilot.db.models import Thread
from returnpilot.db.session import db_session

log = logging.getLogger(__name__)

KEEP_RECENT = 12
SUMMARIZE_EVERY = 8  # re-summarize once this many new messages have aged out


def _transcript(messages: list[BaseMessage]) -> str:
    lines = []
    for m in messages:
        if isinstance(m, HumanMessage):
            lines.append(f"Customer: {m.text}")
        elif isinstance(m, AIMessage) and m.text:
            lines.append(f"Assistant: {m.text}")
        elif isinstance(m, ToolMessage):
            lines.append(f"[{m.name} result: {str(m.content)[:300]}]")
    return "\n".join(lines)[-6000:]


async def maybe_summarize(
    thread_id: uuid.UUID, messages: list[BaseMessage], summary: str | None, summary_upto: int
) -> None:
    cutoff = len(messages) - KEEP_RECENT
    if cutoff - summary_upto < SUMMARIZE_EVERY:
        return
    older = messages[summary_upto:cutoff]
    prior = f"Earlier summary: {summary}\n\n" if summary else ""
    if get_settings().fake_llm:
        new_summary = (prior + _transcript(older))[-800:]
    else:
        try:
            res = await llm.invoke(
                "small",
                [SystemMessage(content=SUMMARY_SYSTEM), HumanMessage(content=prior + _transcript(older))],
                temperature=0,
            )
            new_summary = res.message.text.strip()[:1200]
        except Exception as exc:  # noqa: BLE001
            log.info("summary skipped: %s", exc)
            return
    async with db_session() as s:
        await s.execute(update(Thread).where(Thread.id == thread_id).values(summary=new_summary, summary_upto=cutoff))
