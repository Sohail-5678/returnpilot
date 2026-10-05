"""Input guard (SPEC §10.2): length limit, abuse filter, injection flags, card masking."""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from returnpilot.guards.injection import detect_injection
from returnpilot.guards.pii import mask_cards

MAX_CHARS = 2000
# Deliberately small list: slurs and threats get a calm, fixed reply instead of an LLM call.
_ABUSE = re.compile(
    r"\b(kill you|i will hurt|bomb (the|your) (store|office)|f+u+c+k+ (you|off)|piece of sh[i1]t)\b", re.IGNORECASE
)


@dataclass
class InputVerdict:
    text: str
    blocked: bool = False
    reply: str | None = None
    flags: dict[str, object] = field(default_factory=dict)


def check_input(raw: str) -> InputVerdict:
    text = raw.strip()
    if not text:
        return InputVerdict(
            text, blocked=True, reply="It looks like your message was empty. How can I help with your order?"
        )
    if len(text) > MAX_CHARS:
        return InputVerdict(
            text[:MAX_CHARS],
            blocked=True,
            reply=f"That message is a bit long for me (over {MAX_CHARS} characters). Could you shorten it?",
        )
    masked, had_card = mask_cards(text)
    flags: dict[str, object] = {}
    if had_card:
        flags["card_masked"] = True
    if _ABUSE.search(masked):
        return InputVerdict(
            masked,
            blocked=True,
            flags={**flags, "abuse": True},
            reply="I want to help, and I can do that best if we keep things respectful. What can I do for you with your order?",
        )
    injection = detect_injection(masked)
    if injection:
        flags["injection_suspected"] = True
        flags["injection_patterns"] = injection[:5]
    return InputVerdict(masked, flags=flags)
