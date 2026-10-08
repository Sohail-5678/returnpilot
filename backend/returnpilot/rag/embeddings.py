"""Text embeddings: Gemini (`gemini-embedding-001`, 768 dims) with a deterministic local fallback.

The fallback is a hashed bag-of-words vector. It keeps offline development, tests and
"Gemini quota used up" mode working (with lexical-only similarity) instead of failing.
"""

from __future__ import annotations

import hashlib
import logging
import math
import re
from typing import Literal

from returnpilot import quota
from returnpilot.config import get_settings

log = logging.getLogger(__name__)

TaskType = Literal["RETRIEVAL_DOCUMENT", "RETRIEVAL_QUERY", "SEMANTIC_SIMILARITY"]
_STOP = {
    "the",
    "a",
    "an",
    "and",
    "or",
    "of",
    "to",
    "in",
    "on",
    "for",
    "is",
    "are",
    "be",
    "can",
    "i",
    "my",
    "me",
    "it",
    "this",
    "that",
    "with",
    "you",
    "your",
    "we",
    "our",
    "do",
    "does",
    "if",
    "at",
    "by",
    "from",
    "as",
}


def active_model() -> str:
    s = get_settings()
    return s.gemini_embed_model if (s.gemini_api_key and not s.fake_llm) else "local-hash-v1"


def _normalize(vec: list[float]) -> list[float]:
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


def local_embedding(text: str, dim: int | None = None) -> list[float]:
    dim = dim or get_settings().embed_dim
    vec = [0.0] * dim
    tokens = [t for t in re.findall(r"[a-z0-9]+", text.lower()) if t not in _STOP]
    # crude stemming so "returns"/"returned" share a bucket with "return"
    tokens = [t[:-1] if t.endswith("s") and len(t) > 3 else t for t in tokens]
    grams = tokens + [f"{a}_{b}" for a, b in zip(tokens, tokens[1:], strict=False)]
    for g in grams:
        h = hashlib.blake2b(g.encode(), digest_size=8).digest()
        idx = int.from_bytes(h[:4], "big") % dim
        sign = 1.0 if h[4] % 2 == 0 else -1.0
        vec[idx] += sign * (1.0 if "_" not in g else 0.5)
    return _normalize(vec)


async def embed_texts(texts: list[str], task_type: TaskType = "RETRIEVAL_DOCUMENT") -> list[list[float]]:
    """Embed texts with Gemini; fall back to local vectors on missing key, quota or errors."""
    s = get_settings()
    if not texts:
        return []
    if active_model() == "local-hash-v1":
        return [local_embedding(t) for t in texts]
    out: list[list[float]] = []
    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=s.gemini_api_key)
        for start in range(0, len(texts), 50):
            batch = texts[start : start + 50]
            if not await quota.reserve("gemini", "embed", s.daily_budget_embed_requests):
                raise RuntimeError("gemini embedding quota guard")
            resp = await client.aio.models.embed_content(
                model=s.gemini_embed_model,
                contents=batch,  # type: ignore[arg-type]
                config=types.EmbedContentConfig(task_type=task_type, output_dimensionality=s.embed_dim),
            )
            out.extend(_normalize(list(e.values or [])) for e in (resp.embeddings or []))
        if len(out) != len(texts):
            raise RuntimeError("embedding count mismatch")
        return out
    except Exception as exc:  # noqa: BLE001
        log.warning("Gemini embeddings unavailable (%s); using local vectors", exc)
        return [local_embedding(t) for t in texts]


async def embed_query(text: str) -> list[float]:
    return (await embed_texts([text], "RETRIEVAL_QUERY"))[0]
