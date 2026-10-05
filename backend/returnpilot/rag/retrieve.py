"""Hybrid policy retrieval (SPEC §5.3): pgvector cosine top 8 + Postgres full-text top 8,
merged with Reciprocal Rank Fusion, top 4 returned. No external reranker (keeps it $0)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import text

from returnpilot.db.session import db_session
from returnpilot.rag.embeddings import embed_query

RRF_K = 60

_VECTOR = text(
    """
    SELECT id::text, section_id, doc, doc_title, heading, content
    FROM policy_chunks WHERE embedding IS NOT NULL
    ORDER BY embedding <=> CAST(:vec AS vector) LIMIT :k
    """
)
# OR the query lexemes together: natural questions rarely contain every term of a section.
_FTS = text(
    """
    WITH q AS (
      SELECT NULLIF(replace(plainto_tsquery('english', :q)::text, '&', '|'), '')::tsquery AS query
    )
    SELECT id::text, section_id, doc, doc_title, heading, content
    FROM policy_chunks, q
    WHERE q.query IS NOT NULL AND tsv @@ q.query
    ORDER BY ts_rank_cd(tsv, q.query) DESC LIMIT :k
    """
)


@dataclass
class Hit:
    id: str
    section_id: str
    doc: str
    doc_title: str
    heading: str
    text: str
    score: float

    def to_dict(self) -> dict[str, Any]:
        return {"section_id": self.section_id, "doc": self.doc, "heading": self.heading, "text": self.text}


def rrf_merge(rankings: list[list[dict[str, Any]]], top_k: int = 4) -> list[Hit]:
    scores: dict[str, float] = {}
    rows: dict[str, dict[str, Any]] = {}
    for ranking in rankings:
        for rank, row in enumerate(ranking, start=1):
            scores[row["id"]] = scores.get(row["id"], 0.0) + 1.0 / (RRF_K + rank)
            rows[row["id"]] = row
    ordered = sorted(scores, key=lambda i: scores[i], reverse=True)[:top_k]
    return [
        Hit(
            i,
            rows[i]["section_id"],
            rows[i]["doc"],
            rows[i]["doc_title"],
            rows[i]["heading"],
            rows[i]["content"],
            scores[i],
        )
        for i in ordered
    ]


async def search_policy(query: str, top_k: int = 4) -> list[Hit]:
    vec = await embed_query(query)
    vec_literal = "[" + ",".join(f"{v:.6f}" for v in vec) + "]"
    async with db_session() as s:
        vector_rows = [dict(r._mapping) for r in (await s.execute(_VECTOR, {"vec": vec_literal, "k": 8})).all()]
        fts_rows = [dict(r._mapping) for r in (await s.execute(_FTS, {"q": query, "k": 8})).all()]
    return rrf_merge([vector_rows, fts_rows], top_k)


async def get_section(section_id: str) -> dict[str, Any] | None:
    sid = section_id if section_id.startswith("§") else f"§{section_id}"
    async with db_session() as s:
        row = (
            await s.execute(
                text(
                    "SELECT section_id, doc, doc_title, heading, content FROM policy_chunks WHERE section_id = :sid LIMIT 1"
                ),
                {"sid": sid},
            )
        ).first()
    if not row:
        return None
    return {
        "section_id": row.section_id,
        "doc": row.doc,
        "doc_title": row.doc_title,
        "heading": row.heading,
        "text": row.content,
    }


async def list_sections() -> list[dict[str, Any]]:
    async with db_session() as s:
        rows = (
            await s.execute(text("SELECT doc, doc_title, section_id, heading FROM policy_chunks ORDER BY doc, ord"))
        ).all()
    docs: dict[str, dict[str, Any]] = {}
    for r in rows:
        d = docs.setdefault(r.doc, {"doc": r.doc, "title": r.doc_title, "sections": []})
        d["sections"].append({"section_id": r.section_id, "heading": r.heading})
    return sorted(docs.values(), key=lambda d: d["sections"][0]["section_id"] if d["sections"] else "")
