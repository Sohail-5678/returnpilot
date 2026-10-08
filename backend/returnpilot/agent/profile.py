"""Agent profile (`profile.v1`, SPEC §18.2 / §S.3): the optimizable surface of ReturnPilot.

Prompts, tool descriptions, few-shot examples, model routing and non-safety parameters live in a
versioned profile instead of hard-coded strings, so AgentForge can evaluate, red-team and
optimize them. Safety never does: policy rules, the refund auto-approve limit, approval
requirements, tool permissions and guardrail thresholds stay in code/config, and a profile that
tries to set any of them is rejected.

Sources: an eval override (eval adapter --profile) → AgentForge's active profile when
PROFILE_SOURCE=agentforge (cached 5 min, last good copy on error) → the bundled default.
"""

from __future__ import annotations

import json
import logging
import time
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from returnpilot.config import get_settings

log = logging.getLogger(__name__)

BUNDLED = Path(__file__).resolve().parents[2] / "profiles" / "default.json"
CACHE_TTL_S = 300
LOCKED_KEYS = frozenset(
    {
        "policy",
        "policies",
        "policy_rules",
        "guardrails",
        "guard_threshold",
        "guard_model",
        "approval_threshold",
        "approval_requirements",
        "refund_auto_approve_limit",
        "auto_approve_limit",
        "tool_permissions",
        "customer_id",
        "reviewer_roles",
    }
)
REQUIRED_LOCKED = {"policy", "guardrails", "approval_threshold", "tool_permissions"}


class ProfileError(ValueError):
    pass


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Prompts(_Strict):
    system: str = Field(min_length=50)
    router: str = Field(min_length=20)
    memory_extractor: str = Field(min_length=20)


class FewShot(_Strict):
    input: str
    output: str


class Routing(_Strict):
    main_model: str = "env:MAIN_MODEL"
    fast_model: str = "env:FAST_MODEL"
    use_fast_when: str = "route in ['faq','order_lookup']"


class Params(_Strict):
    temperature: float = Field(default=0.2, ge=0.0, le=1.0)
    max_steps: int = Field(default=8, ge=4, le=10)
    history_messages: int = Field(default=12, ge=4, le=30)
    self_consistency_k: int = Field(default=1, ge=1, le=5)


class Profile(_Strict):
    contract_version: Literal["profile.v1"]
    agent: Literal["returnpilot"]
    version: int = Field(ge=0)
    parent_version: int | None = None
    created_by: Literal["human", "optimizer"] = "human"
    notes: str = ""
    prompts: Prompts
    tool_descriptions: dict[str, str] = Field(default_factory=dict)
    few_shots: list[FewShot] = Field(default_factory=list, max_length=12)
    routing: Routing = Field(default_factory=Routing)
    params: Params = Field(default_factory=Params)
    locked: list[str] = Field(default_factory=lambda: sorted(REQUIRED_LOCKED))

    @property
    def label(self) -> str:
        return f"returnpilot@{self.version}"

    def fast_routes(self) -> set[str]:
        import re

        return set(re.findall(r"['\"]([a-z_]+)['\"]", self.routing.use_fast_when))


def _locked_paths(data: Any, path: str = "") -> list[str]:
    found: list[str] = []
    if isinstance(data, dict):
        for key, value in data.items():
            here = f"{path}.{key}" if path else str(key)
            if key in LOCKED_KEYS and here != "locked":
                found.append(here)
            if key not in ("prompts", "tool_descriptions", "few_shots", "notes", "locked"):
                found.extend(_locked_paths(value, here))
    return found


def validate_profile(data: dict[str, Any]) -> Profile:
    locked = _locked_paths(data)
    if locked:
        raise ProfileError(f"profile tries to set locked safety settings: {', '.join(locked)}")
    try:
        profile = Profile.model_validate(data)
    except ValidationError as exc:
        raise ProfileError(f"invalid profile: {exc.errors()[:3]}") from exc
    if not set(profile.locked) >= REQUIRED_LOCKED:
        raise ProfileError("profile must declare policy, guardrails, approval_threshold and tool_permissions as locked")
    return profile


def load_file(path: str | Path) -> Profile:
    return validate_profile(json.loads(Path(path).read_text(encoding="utf-8")))


@lru_cache
def default_profile() -> Profile:
    return load_file(BUNDLED)


_state: dict[str, Any] = {"override": None, "cached": None, "fetched": 0.0, "source": "bundled"}


def set_override(profile: Profile | None) -> None:
    """Pin a profile for this process (eval adapter)."""
    _state["override"] = profile


async def get_active_profile() -> Profile:
    if _state["override"] is not None:
        return _state["override"]
    s = get_settings()
    if s.profile_source != "agentforge" or not s.agentforge_url:
        _state["source"] = "bundled"
        return default_profile()
    if _state["cached"] is not None and time.monotonic() - _state["fetched"] < CACHE_TTL_S:
        return _state["cached"]
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(
                f"{s.agentforge_url.rstrip('/')}/v1/profiles/returnpilot/active",
                headers={"X-AgentForge-Key": s.agentforge_key},
            )
            r.raise_for_status()
            profile = validate_profile(r.json())
        _state.update(cached=profile, fetched=time.monotonic(), source="agentforge")
        return profile
    except Exception as exc:  # noqa: BLE001 - never let the optimizer take the agent down
        log.warning("active profile unavailable (%s); using %s", exc, "last good" if _state["cached"] else "bundled")
        _state["fetched"] = time.monotonic()  # back off for one TTL
        if _state["cached"] is not None:
            _state["source"] = "agentforge (cached)"
            return _state["cached"]
        _state["source"] = "bundled (fallback)"
        return default_profile()


def active_source() -> str:
    return "eval override" if _state["override"] is not None else str(_state["source"])


def resolve_model(ref: str) -> str:
    """'env:MAIN_MODEL' → the configured model id; anything else is a literal model id."""
    if not ref.startswith("env:"):
        return ref
    s = get_settings()
    return {
        "MAIN_MODEL": s.main_model,
        "FAST_MODEL": s.fast_model,
        "SMALL_MODEL": s.small_model,
        "GEMINI_MODEL_LITE": s.gemini_model_lite,
    }.get(ref[4:], s.main_model)


def diff(base: Profile, other: Profile) -> list[dict[str, Any]]:
    a = base.model_dump(exclude={"version", "parent_version", "created_by", "notes"})
    b = other.model_dump(exclude={"version", "parent_version", "created_by", "notes"})
    out: list[dict[str, Any]] = []

    def walk(x: Any, y: Any, path: str) -> None:
        if isinstance(x, dict) and isinstance(y, dict):
            for key in sorted(set(x) | set(y)):
                walk(x.get(key), y.get(key), f"{path}.{key}" if path else key)
        elif x != y:
            out.append({"path": path, "default": x, "active": y})

    walk(a, b, "")
    return out
