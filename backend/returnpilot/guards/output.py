"""Output guard (SPEC §10.2): the reply must agree with the tools, cite real policy sections,
show no other customer's data and promise nothing the system hasn't done."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from itertools import combinations

MAX_REPLY_CHARS = 1500
POLICY_CONSTANTS = {20.0, 50.0}

_MONEY = re.compile(r"\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)")
_NUMBER = re.compile(r"(?<![\w.])(\d+(?:\.\d+)?)(?![\w])")
_CITATION = re.compile(r"\[Policy\s*§\s*(\d+\.\d+)\]")
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_ISO_DATE = re.compile(r"\b(20\d{2})-(\d{2})-(\d{2})\b")
_MONTHS = {
    m: i + 1
    for i, names in enumerate(
        [
            ("jan", "january"),
            ("feb", "february"),
            ("mar", "march"),
            ("apr", "april"),
            ("may",),
            ("jun", "june"),
            ("jul", "july"),
            ("aug", "august"),
            ("sep", "sept", "september"),
            ("oct", "october"),
            ("nov", "november"),
            ("dec", "december"),
        ]
    )
    for m in names
}
_MONTH_RE = "|".join(sorted(_MONTHS, key=len, reverse=True))
_TEXT_DATE = re.compile(
    rf"\b({_MONTH_RE})\.?\s+(\d{{1,2}})(?:st|nd|rd|th)?\b|\b(\d{{1,2}})(?:st|nd|rd|th)?\s+({_MONTH_RE})\b",
    re.IGNORECASE,
)
_DONE_CLAIM = re.compile(
    r"\b(?:i(?:'ve| have)|we(?:'ve| have))\s+(?:already\s+)?(?:issued|processed|approved|refunded|sent)\b"
    r"|\brefund (?:has been|was|is now|is) (?:issued|approved|processed|on its way|complete)",
    re.IGNORECASE,
)


@dataclass
class OutputVerdict:
    ok: bool
    text: str
    issues: list[str] = field(default_factory=list)
    stripped_citations: list[str] = field(default_factory=list)


def _numbers(texts: list[str]) -> set[float]:
    found: set[float] = set()
    for t in texts:
        for m in _NUMBER.finditer(t.replace(",", "")):
            try:
                found.add(round(float(m.group(1)), 2))
            except ValueError:  # pragma: no cover
                continue
    return found


def _dates(texts: list[str]) -> set[tuple[int, int]]:
    out: set[tuple[int, int]] = set()
    for t in texts:
        for _y, mo, d in _ISO_DATE.findall(t):
            out.add((int(mo), int(d)))
    return out


def _reply_dates(text: str) -> set[tuple[int, int]]:
    out = {(int(mo), int(d)) for _, mo, d in _ISO_DATE.findall(text)}
    for m in _TEXT_DATE.finditer(text):
        month = (m.group(1) or m.group(4) or "").lower()
        day = m.group(2) or m.group(3)
        if month in _MONTHS and day:
            out.add((_MONTHS[month], int(day)))
    return out


def check_output(
    reply: str,
    *,
    tool_texts: list[str],
    user_texts: list[str],
    section_ids: set[str],
    customer_email: str | None,
    action_executed: bool,
    today: date | None = None,
) -> OutputVerdict:
    issues: list[str] = []
    text = reply.strip()

    # 1. Citations must point at real sections; unknown ones are removed (not fatal).
    stripped: list[str] = []

    def fix_citation(m: re.Match[str]) -> str:
        sid = f"§{m.group(1)}"
        if sid in section_ids:
            return f"[Policy {sid}]"
        stripped.append(sid)
        return ""

    text = _CITATION.sub(fix_citation, text)
    text = re.sub(r"\s+([.,;])", r"\1", text)

    # 2. Money amounts must come from tools, the customer, policy constants or a sum of two of those.
    allowed = _numbers(tool_texts) | _numbers(user_texts) | POLICY_CONSTANTS
    pool = sorted(a for a in allowed if 0 < a < 100000)[:200]
    sums = {round(a + b, 2) for a, b in combinations(pool, 2)}
    for m in _MONEY.finditer(text):
        value = round(float(m.group(1).replace(",", "")), 2)
        if value not in allowed and value not in sums:
            issues.append(f"amount ${value:.2f} does not match any tool result")

    # 3. Calendar dates must appear in tool results (or be today).
    known_dates = _dates(tool_texts)
    if today:
        known_dates.add((today.month, today.day))
    for md in _reply_dates(text):
        if md not in known_dates:
            issues.append(f"date {md[0]:02d}-{md[1]:02d} does not match any tool result")

    # 4. No other customer's email addresses.
    for email in _EMAIL.findall(text):
        if not customer_email or email.lower() != customer_email.lower():
            issues.append("reply contains an email address that isn't the customer's")

    # 5. No claims that a refund/return already happened unless the system executed one.
    if not action_executed and _DONE_CLAIM.search(text):
        issues.append("reply claims an action was completed, but nothing was executed")

    # 6. Over-long replies are trimmed at a sentence boundary (not a violation).
    if len(text) > MAX_REPLY_CHARS:
        cut = text[:MAX_REPLY_CHARS]
        text = cut[: cut.rfind(". ") + 1] if ". " in cut else cut

    return OutputVerdict(ok=not issues, text=text, issues=issues, stripped_citations=stripped)
