"""Long-term customer memory (SPEC §4.4, §8.3) over pgvector, behind a thin interface."""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import UTC, datetime
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from sqlalchemy import delete, func, select, text, update

from returnpilot.agent import llm
from returnpilot.agent.prompts import MEMORY_SYSTEM
from returnpilot.config import get_settings
from returnpilot.db.models import Memory
from returnpilot.db.session import db_session
from returnpilot.rag.embeddings import embed_query, embed_texts

log = logging.getLogger(__name__)

LOAD_ALL_BELOW = 8
DEDUPE_SIMILARITY = 0.9
_SENSITIVE = re.compile(
    r"card|credit|debit|bank|account number|iban|ssn|social security|passport|password|pin\b|"
    r"health|medical|diagnos|pregnan|disab|medication|religio|politic|"
    r"\baddress\b|street|apartment|zip|postcode|phone|e-?mail|\bwife\b|\bhusband\b|\bson\b|\bdaughter\b|"
    r"\bmaybe\b|\bprobably\b|\bmight\b",
    re.IGNORECASE,
)


def is_storable(content: str) -> bool:
    content = content.strip()
    return 4 <= len(content) <= 160 and not _SENSITIVE.search(content)


def _vec(v: list[float]) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in v) + "]"


async def load_for_turn(customer_id: uuid.UUID, query: str, k: int = 5) -> list[dict[str, Any]]:
    """Top-k memories for this turn. Small sets are loaded whole (no embedding call needed)."""
    async with db_session() as s:
        count = await s.scalar(select(func.count()).select_from(Memory).where(Memory.customer_id == customer_id))
        if not count:
            return []
        if count <= LOAD_ALL_BELOW:
            rows = (
                await s.scalars(
                    select(Memory).where(Memory.customer_id == customer_id).order_by(Memory.updated_at.desc())
                )
            ).all()
            return [{"id": str(m.id), "content": m.content, "kind": m.kind} for m in rows]
    return await recall(customer_id, query, k)


async def recall(customer_id: uuid.UUID, query: str, k: int = 5) -> list[dict[str, Any]]:
    vec = await embed_query(query)
    async with db_session() as s:
        rows = (
            await s.execute(
                text(
                    """SELECT id::text, content, kind, 1 - (embedding <=> CAST(:v AS vector)) AS similarity
                       FROM memories WHERE customer_id = :c AND embedding IS NOT NULL
                       ORDER BY embedding <=> CAST(:v AS vector) LIMIT :k"""
                ),
                {"v": _vec(vec), "c": customer_id, "k": k},
            )
        ).all()
        if not rows:  # memories without embeddings (e.g. seeded offline): fall back to recency
            mems = (
                await s.scalars(
                    select(Memory).where(Memory.customer_id == customer_id).order_by(Memory.updated_at.desc()).limit(k)
                )
            ).all()
            return [{"id": str(m.id), "content": m.content, "kind": m.kind} for m in mems]
    return [
        {"id": r.id, "content": r.content, "kind": r.kind, "similarity": round(float(r.similarity), 3)} for r in rows
    ]


async def list_memories(customer_id: uuid.UUID) -> list[Memory]:
    async with db_session() as s:
        return list(
            (
                await s.scalars(
                    select(Memory).where(Memory.customer_id == customer_id).order_by(Memory.updated_at.desc())
                )
            ).all()
        )


async def delete_memory(customer_id: uuid.UUID, memory_id: uuid.UUID) -> bool:
    async with db_session() as s:
        res = await s.execute(delete(Memory).where(Memory.id == memory_id, Memory.customer_id == customer_id))
        return bool(res.rowcount)  # type: ignore[attr-defined]


_FAKE_PATTERNS = [
    (
        re.compile(r"\bI (?:usually |always |generally |really )?prefer (?:to )?(.+?)(?:[.!?]|$)", re.IGNORECASE),
        "Prefers {0}",
    ),
    (re.compile(r"\bI (?:usually |always )?wear (?:a )?(?:US )?size (\w+)", re.IGNORECASE), "Usually wears size {0}"),
    (re.compile(r"\bmy size is (\w+)", re.IGNORECASE), "Usually wears size {0}"),
    (re.compile(r"\bplease (?:always )?(email|text) me\b", re.IGNORECASE), "Prefers updates by {0}"),
]


def _fake_extract(user_text: str) -> list[dict[str, str]]:
    out = []
    for pattern, template in _FAKE_PATTERNS:
        m = pattern.search(user_text)
        if m:
            out.append({"content": template.format(m.group(1).strip().rstrip(",")), "kind": "preference"})
    return out


async def extract_candidates(user_texts: list[str]) -> list[dict[str, str]]:
    joined = "\n".join(f"Customer: {t}" for t in user_texts if t.strip())[-3000:]
    if not joined:
        return []
    if get_settings().fake_llm:
        return [c for t in user_texts for c in _fake_extract(t)]
    try:
        result = await llm.invoke(
            "small", [SystemMessage(content=MEMORY_SYSTEM), HumanMessage(content=joined)], temperature=0
        )
        raw = result.message.text
        start, end = raw.find("{"), raw.rfind("}")
        data = json.loads(raw[start : end + 1]) if start >= 0 else {}
        return [m for m in data.get("memories", []) if isinstance(m, dict) and isinstance(m.get("content"), str)]
    except Exception as exc:  # noqa: BLE001
        log.info("memory extraction skipped: %s", exc)
        return []


async def write_memories(customer_id: uuid.UUID, thread_id: uuid.UUID | None, user_texts: list[str]) -> list[str]:
    """Extract → filter → dedupe (cosine > 0.9 updates) → store. Returns the stored contents."""
    candidates = [c for c in await extract_candidates(user_texts) if is_storable(c["content"])]
    if not candidates:
        return []
    vectors = await embed_texts([c["content"] for c in candidates], "SEMANTIC_SIMILARITY")
    stored: list[str] = []
    async with db_session() as s:
        for cand, vec in zip(candidates, vectors, strict=True):
            kind = cand.get("kind") if cand.get("kind") in ("preference", "fact") else "preference"
            near = (
                await s.execute(
                    text(
                        """SELECT id, 1 - (embedding <=> CAST(:v AS vector)) AS sim FROM memories
                           WHERE customer_id = :c AND embedding IS NOT NULL
                           ORDER BY embedding <=> CAST(:v AS vector) LIMIT 1"""
                    ),
                    {"v": _vec(vec), "c": customer_id},
                )
            ).first()
            if near and float(near.sim) > DEDUPE_SIMILARITY:
                await s.execute(
                    update(Memory)
                    .where(Memory.id == near.id)
                    .values(
                        content=cand["content"], embedding=vec, updated_at=datetime.now(UTC), source_thread_id=thread_id
                    )
                )
            else:
                s.add(
                    Memory(
                        customer_id=customer_id,
                        content=cand["content"],
                        kind=kind,
                        embedding=vec,
                        source_thread_id=thread_id,
                    )
                )
            stored.append(cand["content"])
    return stored


async def backfill_embeddings() -> int:
    """Embed memories that were created without vectors (e.g. seeded before a Gemini key existed)."""
    async with db_session() as s:
        rows = (await s.scalars(select(Memory).where(Memory.embedding.is_(None)).limit(500))).all()
        if not rows:
            return 0
        vectors = await embed_texts([m.content for m in rows], "SEMANTIC_SIMILARITY")
        for m, v in zip(rows, vectors, strict=True):
            m.embedding = v
        return len(rows)
