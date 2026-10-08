"""LLM providers with routing, quota guard and automatic fallback (SPEC §8.2, §S.1).

| task  | used for                         | primary                 | fallback              | last resort            |
|-------|----------------------------------|-------------------------|-----------------------|------------------------|
| main  | agent with tools                 | Gemini Flash            | Groq gpt-oss-120b     | "quota reached" mode   |
| fast  | agent on faq / order_lookup      | Groq gpt-oss-120b       | Gemini Flash          | "quota reached" mode   |
| small | router, memory, summaries        | Groq gpt-oss-20b        | Gemini Flash-Lite     | caller's keyword rules |

Gemini is the main model because a Groq free model allows only ~200K tokens/day per organization
(shared with DataPilot and AgentForge) and one agent turn uses 5-10K tokens.

Fallback triggers: HTTP 429/5xx, timeout, connection errors, or invalid tool-call JSON twice.
Model names come from env vars because providers rename models.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Literal

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, SystemMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import BaseTool

from returnpilot import quota
from returnpilot.config import get_settings

log = logging.getLogger(__name__)

Task = Literal["main", "fast", "small"]


class LLMUnavailable(RuntimeError):
    """Every provider failed or is over quota; the app switches to read-only demo mode."""


class LLMBudgetExceeded(LLMUnavailable):
    """The eval adapter's --budget-calls limit was reached."""


_budget: dict[str, int | None] = {"limit": None, "used": 0}


def set_call_budget(limit: int | None) -> None:
    _budget["limit"], _budget["used"] = limit, 0


def calls_used() -> int:
    return int(_budget["used"] or 0)


@dataclass(frozen=True)
class ProviderSpec:
    provider: str  # groq | gemini | fake
    kind: str  # budget slot: main | lite | fast | small (usage_counters.kind)
    model: str
    daily_limit: int
    token_limit: int | None = None


@dataclass
class LLMResult:
    message: AIMessage
    provider: str
    model: str
    duration_ms: int
    tokens_in: int = 0
    tokens_out: int = 0
    attempts: list[dict[str, Any]] = field(default_factory=list)


def _gemini(slot: str) -> ProviderSpec:
    s = get_settings()
    if slot == "lite":
        return ProviderSpec(
            "gemini", "lite", s.gemini_model_lite, s.daily_budget_lite_requests, s.daily_budget_lite_tokens
        )
    return ProviderSpec("gemini", "main", s.main_model, s.daily_budget_main_requests, s.daily_budget_main_tokens)


def _groq(slot: str) -> ProviderSpec:
    s = get_settings()
    if slot == "small":
        return ProviderSpec("groq", "small", s.small_model, s.daily_budget_small_requests, s.daily_budget_small_tokens)
    return ProviderSpec("groq", "fast", s.fast_model, s.daily_budget_fast_requests, s.daily_budget_fast_tokens)


def provider_chain(task: Task, primary_model: str | None = None) -> list[ProviderSpec]:
    s = get_settings()
    if s.fake_llm:
        chain = [ProviderSpec("fake", task, f"fake-{task}", 10**9)]
        if s.fake_llm_fail_primary:  # simulate the primary provider being down (fallback eval)
            chain.insert(0, ProviderSpec("fake-down", task, f"fake-down-{task}", 10**9))
        return chain
    order = {
        "main": [("gemini", "main"), ("groq", "fast")],
        "fast": [("groq", "fast"), ("gemini", "main")],
        "small": [("groq", "small"), ("gemini", "lite")],
    }[task]
    chain: list[ProviderSpec] = []
    for provider, slot in order:
        if provider == "gemini" and s.gemini_api_key:
            chain.append(_gemini(slot))
        elif provider == "groq" and s.groq_api_key:
            chain.append(_groq(slot))
    if primary_model and chain:
        # The agent profile may pick a different model for this task (routing is optimizable, not locked).
        wanted = "gemini" if "gemini" in primary_model else "groq"
        match = next((c for c in chain if c.provider == wanted), None)
        if match:
            chain.remove(match)
            chain.insert(
                0, ProviderSpec(match.provider, match.kind, primary_model, match.daily_limit, match.token_limit)
            )
    return chain


def build_model(spec: ProviderSpec, temperature: float, max_tokens: int | None = None) -> BaseChatModel:
    s = get_settings()
    if spec.provider == "groq":
        from langchain_groq import ChatGroq

        return ChatGroq(  # type: ignore[call-arg]
            model=spec.model,
            api_key=s.groq_api_key,
            temperature=temperature,
            max_tokens=max_tokens,
            timeout=s.llm_timeout_s,
            max_retries=0,
            # gpt-oss models reason before answering; "low" keeps turns fast and inside the token budget
            reasoning_effort=s.groq_reasoning_effort if "gpt-oss" in spec.model else None,
        )
    if spec.provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI

        extra: dict[str, Any] = {"thinking_level": s.gemini_thinking_level} if "gemini-3" in spec.model else {}
        return ChatGoogleGenerativeAI(  # type: ignore[call-arg]
            model=spec.model,
            api_key=s.gemini_api_key,
            temperature=temperature,
            max_tokens=max_tokens,
            timeout=s.llm_timeout_s,
            retries=0,
            **extra,
        )
    if spec.provider in ("fake", "fake-down"):
        from returnpilot.agent.fake_llm import FakeAgentModel

        return FakeAgentModel(task=spec.kind, down=spec.provider == "fake-down")
    raise ValueError(spec.provider)


def _status_code(exc: BaseException) -> int | None:
    for attr in ("status_code", "code", "status"):
        val = getattr(exc, attr, None)
        if isinstance(val, int):
            return val
    resp = getattr(exc, "response", None)
    code = getattr(resp, "status_code", None)
    return code if isinstance(code, int) else None


def is_tool_json_error(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return "tool_use_failed" in msg or "failed to call a function" in msg or "invalid tool" in msg


GEMINI_SIGS = "__gemini_function_call_thought_signatures__"
# Google's documented placeholder for function calls Gemini didn't produce itself (e.g. a Groq fallback).
SKIP_SIGNATURE = base64.b64encode(b"skip_thought_signature_validator").decode()


def _with_signatures(m: AIMessage) -> AIMessage:
    sigs = dict(m.additional_kwargs.get(GEMINI_SIGS) or {})
    missing = [tc["id"] for tc in m.tool_calls if tc.get("id") and tc["id"] not in sigs]
    if not missing:
        return m
    sigs.update({tid: SKIP_SIGNATURE for tid in missing})
    return m.model_copy(update={"additional_kwargs": {**m.additional_kwargs, GEMINI_SIGS: sigs}})


def normalize_for(provider: str, messages: list[BaseMessage]) -> list[BaseMessage]:
    """Gemini wants a single leading system message, no back-to-back plain AI turns, and a thought
    signature on every earlier function call (Gemini 3)."""
    if provider != "gemini":
        return messages
    messages = [_with_signatures(m) if isinstance(m, AIMessage) and m.tool_calls else m for m in messages]
    system = [m for m in messages if isinstance(m, SystemMessage)]
    rest = [m for m in messages if not isinstance(m, SystemMessage)]
    merged: list[BaseMessage] = []
    for m in rest:
        prev = merged[-1] if merged else None
        if isinstance(m, AIMessage) and isinstance(prev, AIMessage) and not m.tool_calls and not prev.tool_calls:
            merged[-1] = AIMessage(content=f"{prev.text}\n\n{m.text}".strip(), id=prev.id)
        else:
            merged.append(m)
    head = [SystemMessage(content="\n\n".join(str(m.content) for m in system))] if system else []
    return head + merged


async def invoke(
    task: Task,
    messages: list[BaseMessage],
    *,
    tools: list[BaseTool] | None = None,
    temperature: float = 0.2,
    max_tokens: int | None = None,
    config: RunnableConfig | None = None,
    tool_choice: str | None = None,
    primary_model: str | None = None,
) -> LLMResult:
    """Call the first healthy provider for `task`, falling back on errors or quota."""
    chain = provider_chain(task, primary_model)
    if not chain:
        raise LLMUnavailable("no LLM provider is configured")
    attempts: list[dict[str, Any]] = []
    limit = _budget["limit"]
    if limit is not None and int(_budget["used"] or 0) >= limit:
        raise LLMBudgetExceeded(f"LLM call budget of {limit} reached")
    _budget["used"] = int(_budget["used"] or 0) + 1
    if get_settings().fake_llm_fail_primary and len(chain) > 1 and not chain[0].provider.startswith("fake"):
        attempts.append({"provider": chain[0].provider, "model": chain[0].model, "error": "simulated_outage"})
        chain = chain[1:]
    for spec in chain:
        if not spec.provider.startswith("fake") and not await quota.reserve(
            spec.provider, spec.kind, spec.daily_limit, spec.token_limit
        ):
            attempts.append({"provider": spec.provider, "model": spec.model, "error": "quota_guard"})
            continue
        model: Any = build_model(spec, temperature, max_tokens)
        if tools:
            kwargs: dict[str, Any] = {"tool_choice": tool_choice} if tool_choice else {}
            model = model.bind_tools(tools, **kwargs)
        msgs = normalize_for(spec.provider, messages)
        for attempt in (1, 2):
            started = time.perf_counter()
            try:
                ai = await asyncio.wait_for(
                    model.ainvoke(msgs, config=config), timeout=get_settings().llm_timeout_s + 5
                )
            except Exception as exc:  # noqa: BLE001 - every provider error is a fallback signal
                code = _status_code(exc)
                retry_same = is_tool_json_error(exc) and attempt == 1
                attempts.append(
                    {
                        "provider": spec.provider,
                        "model": spec.model,
                        "error": type(exc).__name__,
                        "status": code,
                        "detail": str(exc)[:300],
                    }
                )
                log.warning("LLM %s/%s failed (attempt %s): %s", spec.provider, spec.model, attempt, exc)
                if retry_same:
                    continue
                break
            if not isinstance(ai, AIMessage):  # pragma: no cover - defensive
                ai = AIMessage(content=str(getattr(ai, "content", ai)))
            if ai.invalid_tool_calls:
                attempts.append({"provider": spec.provider, "model": spec.model, "error": "invalid_tool_calls"})
                if attempt == 1:
                    continue
                break
            usage = ai.usage_metadata or {}
            if not spec.provider.startswith("fake"):
                await quota.add_tokens(spec.provider, spec.kind, int(usage.get("total_tokens", 0) or 0))
            return LLMResult(
                message=ai,
                provider=spec.provider,
                model=spec.model,
                duration_ms=int((time.perf_counter() - started) * 1000),
                tokens_in=int(usage.get("input_tokens", 0) or 0),
                tokens_out=int(usage.get("output_tokens", 0) or 0),
                attempts=attempts,
            )
    raise LLMUnavailable(f"all providers failed for task '{task}': {attempts}")


def tool_result_messages(messages: list[BaseMessage]) -> list[ToolMessage]:
    return [m for m in messages if isinstance(m, ToolMessage)]
