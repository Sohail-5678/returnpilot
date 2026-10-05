"""Authentication & authorization (SPEC §10.1).

Every /v1 route requires a 5-minute ES256 JWT minted by the Next.js server. The backend verifies
signature, issuer, audience, expiry and role on every request, then resolves the caller's
customer record itself (per-visitor demo sandbox) — the browser never supplies a customer id.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import jwt
from fastapi import Depends, Header, Request
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from returnpilot.api.errors import ApiError
from returnpilot.config import get_settings
from returnpilot.db.models import AppUser, Customer
from returnpilot.db.seed import PERSONAS, ensure_persona_clone
from returnpilot.db.session import db_session

ROLES = ("customer", "reviewer", "admin")
DEMO_PERSONA_ROLES = {
    "maya": "customer",
    "arjun": "customer",
    "lena": "customer",
    "reviewer": "reviewer",
    "admin": "admin",
}
_CACHE_TTL_S = 600
_customer_cache: dict[tuple[str, str], tuple[float, uuid.UUID]] = {}


@dataclass
class Principal:
    sub: str
    role: str
    name: str
    persona: str | None
    login: str | None
    workspace_id: uuid.UUID | None
    customer_id: uuid.UUID | None = None

    @property
    def is_demo(self) -> bool:
        return self.sub.startswith("demo:")

    @property
    def scope_workspace(self) -> uuid.UUID | None:
        """Demo reviewers/admins only see their own browser's sandbox; real (GitHub) staff see everything."""
        return self.workspace_id if self.is_demo else None


def decode_token(token: str) -> dict[str, Any]:
    s = get_settings()
    if not s.jwt_public_key:
        raise ApiError(503, "backend_starting", "Authentication is not configured on the server yet.")
    try:
        return jwt.decode(
            token,
            s.jwt_public_key,
            algorithms=["ES256"],
            audience=s.jwt_audience,
            issuer=s.jwt_issuer,
            options={"require": ["exp", "iat", "sub", "aud", "iss"]},
            leeway=10,
        )
    except jwt.ExpiredSignatureError as exc:
        raise ApiError(401, "unauthorized", "Your session token expired. Please retry.") from exc
    except jwt.PyJWTError as exc:
        raise ApiError(401, "unauthorized", "Invalid session token.") from exc


async def _resolve_customer(p: Principal) -> uuid.UUID:
    key = (p.sub, str(p.workspace_id))
    hit = _customer_cache.get(key)
    if hit and hit[0] > time.monotonic():
        return hit[1]
    persona = p.persona if p.persona in PERSONAS else "maya"  # GitHub customers get their own copy of a demo customer
    if p.workspace_id is None:
        raise ApiError(401, "unauthorized", "Missing demo workspace.")
    async with db_session() as s:
        customer = await ensure_persona_clone(s, persona, p.workspace_id)
        provider, provider_user_id = (
            ("demo", f"{persona}:{p.workspace_id}") if p.is_demo else ("github", p.sub.split(":", 1)[-1])
        )
        stmt = (
            pg_insert(AppUser)
            .values(
                provider=provider,
                provider_user_id=provider_user_id,
                github_login=p.login,
                display_name=p.name,
                role=p.role,
                customer_id=customer.id,
                workspace_id=p.workspace_id,
                last_seen_at=datetime.now(UTC),
            )
            .on_conflict_do_update(
                index_elements=["provider", "provider_user_id"],
                set_={"last_seen_at": datetime.now(UTC), "customer_id": customer.id, "role": p.role},
            )
        )
        await s.execute(stmt)
        customer_id = customer.id
    _customer_cache[key] = (time.monotonic() + _CACHE_TTL_S, customer_id)
    return customer_id


async def get_principal(request: Request, authorization: str | None = Header(default=None)) -> Principal:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise ApiError(401, "unauthorized", "Missing bearer token.")
    claims = decode_token(authorization.split(" ", 1)[1].strip())
    role = claims.get("role")
    if role not in ROLES:
        raise ApiError(403, "forbidden", "Unknown role.")
    persona = claims.get("persona")
    if claims["sub"].startswith("demo:"):
        if not get_settings().demo_mode:
            raise ApiError(403, "forbidden", "Demo sign-in is disabled.")
        if DEMO_PERSONA_ROLES.get(persona or "") != role:
            raise ApiError(403, "forbidden", "Persona and role don't match.")
    try:
        ws = uuid.UUID(str(claims["ws"])) if claims.get("ws") else None
    except ValueError as exc:
        raise ApiError(401, "unauthorized", "Invalid workspace claim.") from exc
    p = Principal(
        sub=claims["sub"],
        role=role,
        name=str(claims.get("name") or "Guest"),
        persona=persona,
        login=claims.get("login"),
        workspace_id=ws,
    )
    if role == "customer":
        p.customer_id = await _resolve_customer(p)
    request.state.principal = p
    return p


def require(*roles: str) -> Any:
    async def checker(p: Principal = Depends(get_principal)) -> Principal:
        if p.role not in roles:
            raise ApiError(403, "forbidden", "You don't have access to this.")
        return p

    return checker


customer_only = require("customer")
staff_only = require("reviewer", "admin")
admin_only = require("admin")
any_role = require(*ROLES)


async def customer_record(p: Principal) -> Customer:
    async with db_session() as s:
        cust = await s.scalar(select(Customer).where(Customer.id == p.customer_id))
    if cust is None:
        raise ApiError(404, "not_found", "Customer not found.")
    return cust
