"""LLM providers with routing, quota guard and automatic fallback (SPEC §8.2).

| task  | primary                  | fallback                | last resort            |
|-------|--------------------------|-------------------------|------------------------|
| small | Groq llama-3.1-8b-instant| Gemini Flash-Lite       | caller's keyword rules |
| main  | Groq llama-3.3-70b       | Gemini Flash            | "quota reached" mode   |

Fallback triggers: HTTP 429/5xx, timeout, connection errors, or invalid tool-call JSON twice.
Model names come from env vars because providers rename models.
"""

from __future__ import annotations

import asyncio
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

Task = Literal["main", "small"]


class LLMUnavailable(RuntimeError):
    """Every provider failed or is over quota; the app switches to read-only demo mode."""


@dataclass(frozen=True)
class ProviderSpec:
    provider: str  # groq | gemini | fake
    kind: str  # usage_counters.kind
    model: str
    daily_limit: int


@dataclass
class LLMResult:
    message: AIMessage
    provider: str
    model: str
    duration_ms: int
    tokens_in: int = 0
    tokens_out: int = 0
    attempts: list[dict[str, Any]] = field(default_factory=list)


def provider_chain(task: Task) -> list[ProviderSpec]:
    s = get_settings()
    if s.fake_llm:
        chain = [ProviderSpec("fake", task, f"fake-{task}", 10**9)]
        if s.fake_llm_fail_primary:  # simulate the primary provider being down (fallback eval)
            chain.insert(0, ProviderSpec("fake-down", task, f"fake-down-{task}", 10**9))
        return chain
    chain: list[ProviderSpec] = []
    if s.groq_api_key:
        chain.append(
            ProviderSpec(
                "groq",
                task,
                s.groq_model_main if task == "main" else s.groq_model_small,
                s.daily_limit_groq_main if task == "main" else s.daily_limit_groq_small,
            )
        )
    if s.gemini_api_key:
        chain.append(
            ProviderSpec(
                "gemini",
                "chat",
                s.gemini_model_fallback if task == "main" else s.gemini_model_fallback_small,
                s.daily_limit_gemini,
            )
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
        )
    if spec.provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI

        return ChatGoogleGenerativeAI(  # type: ignore[call-arg]
            model=spec.model,
            api_key=s.gemini_api_key,
            temperature=temperature,
            max_tokens=max_tokens,
            timeout=s.llm_timeout_s,
            retries=0,
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


def normalize_for(provider: str, messages: list[BaseMessage]) -> list[BaseMessage]:
    """Gemini wants a single leading system message and no back-to-back plain AI turns."""
    if provider != "gemini":
        return messages
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
) -> LLMResult:
    """Call the first healthy provider for `task`, falling back on errors or quota."""
    chain = provider_chain(task)
    if not chain:
        raise LLMUnavailable("no LLM provider is configured")
    attempts: list[dict[str, Any]] = []
    for spec in chain:
        if not spec.provider.startswith("fake") and not await quota.reserve(spec.provider, spec.kind, spec.daily_limit):
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
