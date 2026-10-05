"""PII masking for stored messages and redaction for logs/traces (SPEC §10.4)."""

from __future__ import annotations

import re
from typing import Any

_CARD = re.compile(r"\b(?:\d[ -]?){13,19}\b")
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_PHONE = re.compile(r"(?<!\d)(?:\+?\d{1,2}[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}(?!\d)")
_ADDRESS = re.compile(
    r"\b\d{1,5}\s+(?:[A-Z][a-z]+\s){1,3}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Way|Court|Ct)\b\.?"
)


def _luhn_ok(digits: str) -> bool:
    total, alt = 0, False
    for ch in reversed(digits):
        d = int(ch)
        if alt:
            d *= 2
            if d > 9:
                d -= 9
        total += d
        alt = not alt
    return total % 10 == 0


def mask_cards(text: str) -> tuple[str, bool]:
    """Replace anything that looks like a payment card number (Luhn-valid) with a mask."""
    found = False

    def repl(m: re.Match[str]) -> str:
        nonlocal found
        digits = re.sub(r"\D", "", m.group(0))
        if 13 <= len(digits) <= 19 and _luhn_ok(digits):
            found = True
            return f"[card ending {digits[-4:]}]"
        return m.group(0)

    return _CARD.sub(repl, text), found


def redact_text(text: str) -> str:
    text, _ = mask_cards(text)
    text = _EMAIL.sub("[email]", text)
    text = _PHONE.sub("[phone]", text)
    return _ADDRESS.sub("[address]", text)


def redact(value: Any, depth: int = 0) -> Any:
    """Recursively redact strings inside JSON-like data (for traces and logs)."""
    if depth > 6:
        return "…"
    if isinstance(value, str):
        out = redact_text(value)
        return out if len(out) <= 2000 else out[:2000] + "…"
    if isinstance(value, dict):
        return {
            k: ("[redacted]" if k in {"email", "customer_email", "authorization"} else redact(v, depth + 1))
            for k, v in value.items()
        }
    if isinstance(value, list | tuple):
        return [redact(v, depth + 1) for v in list(value)[:50]]
    return value
