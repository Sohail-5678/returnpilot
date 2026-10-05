"""Policy ingestion (SPEC §5.3): markdown → one chunk per numbered section → embeddings → policy_chunks.

Idempotent: chunks are keyed by a hash of their content *and* the embedding model, so unchanged
sections are skipped, edited sections are re-embedded, and removed sections are deleted.
"""

from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import delete, select

from returnpilot.db.models import PolicyChunk
from returnpilot.db.session import db_session
from returnpilot.rag.embeddings import active_model, embed_texts

log = logging.getLogger(__name__)

POLICY_DIR = Path(__file__).resolve().parents[2] / "data" / "policies"
_SECTION = re.compile(r"^###\s+(\d+\.\d+)\s+(.+?)\s*$")


@dataclass(frozen=True)
class Section:
    doc: str
    doc_title: str
    section_id: str  # "§2.1"
    heading: str
    content: str
    ord: int

    @property
    def breadcrumb(self) -> str:
        return f"{self.doc_title} › {self.section_id[1:]} {self.heading}"

    def content_hash(self, model: str) -> str:
        raw = "\x1f".join([self.doc, self.section_id, self.heading, self.content, model])
        return hashlib.sha256(raw.encode()).hexdigest()


def parse_policy(path: Path) -> list[Section]:
    doc = path.stem
    title = doc.replace("-", " ").title()
    sections: list[Section] = []
    current: tuple[str, str] | None = None
    buf: list[str] = []

    def flush() -> None:
        if current:
            body = "\n".join(buf).strip()
            if body:
                sections.append(Section(doc, title, f"§{current[0]}", current[1], body, len(sections)))

    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("# "):
            title = line[2:].strip()
            continue
        m = _SECTION.match(line)
        if m:
            flush()
            current, buf = (m.group(1), m.group(2)), []
        elif line.startswith("## "):
            flush()
            current, buf = None, []
        elif current:
            buf.append(line)
    flush()
    return sections


def load_all(policy_dir: Path = POLICY_DIR) -> list[Section]:
    out: list[Section] = []
    for path in sorted(policy_dir.glob("*.md")):
        out.extend(parse_policy(path))
    return out


async def ingest(policy_dir: Path = POLICY_DIR) -> dict[str, int]:
    model = active_model()
    sections = load_all(policy_dir)
    wanted = {s.content_hash(model): s for s in sections}
    async with db_session() as session:
        existing = set((await session.scalars(select(PolicyChunk.content_hash))).all())
        stale = existing - wanted.keys()
        if stale:
            await session.execute(delete(PolicyChunk).where(PolicyChunk.content_hash.in_(stale)))
        missing = [h for h in wanted if h not in existing]
        if missing:
            todo = [wanted[h] for h in missing]
            vectors = await embed_texts([f"{s.breadcrumb}\n\n{s.content}" for s in todo], "RETRIEVAL_DOCUMENT")
            for s, h, vec in zip(todo, missing, vectors, strict=True):
                session.add(
                    PolicyChunk(
                        doc=s.doc,
                        doc_title=s.doc_title,
                        section_id=s.section_id,
                        heading=s.heading,
                        breadcrumb=s.breadcrumb,
                        content=s.content,
                        ord=s.ord,
                        content_hash=h,
                        embedding=vec,
                    )
                )
    stats = {"sections": len(sections), "inserted": len(missing), "deleted": len(stale)}
    log.info("policy ingest (%s): %s", model, stats)
    return stats
