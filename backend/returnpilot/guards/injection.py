"""Prompt-injection heuristics (SPEC §10.2). Flags suspicious input; it never relies on the model to notice."""

from __future__ import annotations

import base64
import re

_PATTERNS = [
    r"ignore (all |any |the |your )?(previous|prior|above|earlier) (instructions|rules|prompts?)",
    r"ignore (your|all|the) (rules|policy|policies|guidelines)",
    r"disregard (the |your |all )?(rules|instructions|policy|system prompt)",
    r"\b(system|developer)\s*(prompt|message|override)\b",
    r"^\s*(system|assistant|developer)\s*:",
    r"\byou are now\b",
    r"\bact as (the |an? )?(admin|administrator|system|developer|reviewer|manager)\b",
    r"\bas (the |an? )?(admin|administrator|reviewer|manager|supervisor),? (i |we )?(approve|authori[sz]e)",
    r"\bjailbreak\b|\bDAN mode\b",
    r"\b(approve|issue|process) (this|the|a|my) (refund|return) (without|with no) (approval|review)",
    r"\bpretend (that )?(you|the policy)\b",
    r"<\s*/?\s*(system|tool_result|policy)\s*>",
]
_REGEX = [re.compile(p, re.IGNORECASE | re.MULTILINE) for p in _PATTERNS]
_B64 = re.compile(r"[A-Za-z0-9+/]{60,}={0,2}")


def _suspicious_base64(text: str) -> bool:
    for blob in _B64.findall(text):
        try:
            decoded = base64.b64decode(blob + "=" * (-len(blob) % 4), validate=False).decode("utf-8", "ignore")
        except Exception:  # noqa: BLE001
            continue
        if sum(c.isprintable() for c in decoded) > 0.8 * max(1, len(decoded)):
            return True
    return False


def detect_injection(text: str) -> list[str]:
    """Return the names of matched heuristics (empty list = nothing suspicious)."""
    hits = [p.pattern for p in _REGEX if p.search(text)]
    if _suspicious_base64(text):
        hits.append("base64_blob")
    return hits
