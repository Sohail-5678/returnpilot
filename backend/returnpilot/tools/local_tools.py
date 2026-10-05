"""In-process tools (SPEC §9.2): search_policy, recall_memories, escalate_to_human."""

from __future__ import annotations

import json
import uuid
from collections.abc import Callable
from typing import Any

from langchain_core.tools import BaseTool, StructuredTool
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import update

from returnpilot.db.models import Thread, Ticket
from returnpilot.db.session import db_session
from returnpilot.memory import store
from returnpilot.rag.retrieve import search_policy


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SearchPolicyArgs(_Strict):
    query: str = Field(min_length=2, max_length=300, description="The customer's policy question in plain words.")


class RecallArgs(_Strict):
    query: str = Field(min_length=2, max_length=200, description="What you want to remember about the customer.")


class EscalateArgs(_Strict):
    reason: str = Field(min_length=3, max_length=300, description="Why a person is needed, in one sentence.")


def build_local_tools(customer_id: uuid.UUID, thread_id: uuid.UUID, transcript: Callable[[], str]) -> list[BaseTool]:
    async def _search(query: str) -> str:
        hits = await search_policy(query)
        return json.dumps(
            {
                "sections": [
                    {
                        "section_id": h.section_id,
                        "breadcrumb": f"{h.doc_title} › {h.section_id[1:]} {h.heading}",
                        "heading": h.heading,
                        "text": h.text,
                    }
                    for h in hits
                ],
                "how_to_cite": "Cite like [Policy §2.1] using only these section ids.",
            }
        )

    async def _recall(query: str) -> str:
        return json.dumps({"memories": await store.recall(customer_id, query)})

    async def _escalate(reason: str) -> str:
        return json.dumps(await open_escalation(customer_id, thread_id, reason, transcript()))

    return [
        StructuredTool.from_function(
            coroutine=_search,
            name="search_policy",
            args_schema=SearchPolicyArgs,
            description=(
                "Search the store's return/refund policy and get numbered sections to cite.\n"
                "Use when: the customer asks how returns, refunds, exchanges, shipping, final sale, electronics, "
                "international or gift returns work.\nDon't use when: the question is only about their order's status.\n"
                "Example: search_policy(query='how long do I have to return shoes')"
            ),
        ),
        StructuredTool.from_function(
            coroutine=_recall,
            name="recall_memories",
            args_schema=RecallArgs,
            description=(
                "Look up saved preferences/facts about this customer from earlier conversations.\n"
                "Use when: the customer refers to 'my usual', 'like last time', or a preference you don't see above.\n"
                "Example: recall_memories(query='preferred return method')"
            ),
        ),
        StructuredTool.from_function(
            coroutine=_escalate,
            name="escalate_to_human",
            args_schema=EscalateArgs,
            description=(
                "Hand the conversation to a human support agent: opens a ticket with a summary of this conversation.\n"
                "Use when: the customer asks for a person, is upset after a denial, or needs something no tool can do.\n"
                "Example: escalate_to_human(reason='Customer wants to dispute a denied exception')"
            ),
        ),
    ]


async def open_escalation(customer_id: uuid.UUID, thread_id: uuid.UUID, reason: str, transcript: str) -> dict[str, Any]:
    async with db_session() as s:
        ticket = Ticket(
            customer_id=customer_id,
            thread_id=thread_id,
            subject=f"Escalation: {reason[:120]}",
            summary=transcript[-1800:] or reason,
            priority="high",
        )
        s.add(ticket)
        await s.flush()
        await s.execute(update(Thread).where(Thread.id == thread_id).values(status="escalated"))
        ticket_id = str(ticket.id)
    return {
        "ticket_id": ticket_id,
        "status": "open",
        "message": "A team member will reply by email within one business day.",
    }
