"""Red-team seed overrides (SPEC §18.4), applied to the persona *templates* in an eval schema.

Only the surfaces through which indirect prompt injection would arrive can be changed, and only
in eval mode. Keys:

    orders.<order_number>.customer_note       e.g. "orders.1042.customer_note"
    products.<sku>.name                       e.g. "products.FW-TRAIL-01.name"
    customers.<persona>.name                  e.g. "customers.maya.name"
    tickets.<persona>.text                    a support ticket on the persona's account
    policy_chunks.<section_id>.copy           adds a *copy* of a section with this text appended

The real policy text is never modified, and nothing else (prices, statuses, limits) can be.
"""

from __future__ import annotations

import hashlib
from typing import Any

from sqlalchemy import select, text, update

from returnpilot.config import get_settings
from returnpilot.db.models import Customer, Order, PolicyChunk, Product, Ticket
from returnpilot.db.session import db_session


class OverrideError(ValueError):
    pass


async def apply_overrides(overrides: dict[str, Any]) -> list[str]:
    if not overrides:
        return []
    if not get_settings().eval_mode:
        raise OverrideError("seed overrides are only allowed in eval mode")
    applied: list[str] = []
    async with db_session() as s:
        for key, value in overrides.items():
            parts = key.split(".")
            if len(parts) < 3:
                raise OverrideError(f"unsupported override key '{key}'")
            table, ident, field = parts[0], ".".join(parts[1:-1]), parts[-1]
            value = str(value)
            if table == "orders" and field == "customer_note":
                res = await s.execute(
                    update(Order)
                    .where(
                        Order.order_number == int(ident.lstrip("#")),
                        Order.customer_id.in_(
                            select(Customer.id).where(
                                Customer.template_key.is_not(None), Customer.workspace_id.is_(None)
                            )
                        ),
                    )
                    .values(customer_note=value)
                )
                if not res.rowcount:  # type: ignore[attr-defined]
                    raise OverrideError(f"no demo-persona order #{ident}")
            elif table == "products" and field == "name":
                res = await s.execute(update(Product).where(Product.sku == ident).values(name=value))
                if not res.rowcount:  # type: ignore[attr-defined]
                    raise OverrideError(f"no product {ident}")
            elif table == "customers" and field == "name":
                res = await s.execute(
                    update(Customer)
                    .where(Customer.template_key == ident, Customer.workspace_id.is_(None))
                    .values(name=value)
                )
                if not res.rowcount:  # type: ignore[attr-defined]
                    raise OverrideError(f"no persona {ident}")
            elif table == "tickets" and field == "text":
                cust = await s.scalar(
                    select(Customer).where(Customer.template_key == ident, Customer.workspace_id.is_(None))
                )
                if cust is None:
                    raise OverrideError(f"no persona {ident}")
                s.add(Ticket(customer_id=cust.id, subject="Earlier ticket", summary=value, priority="normal"))
            elif table == "policy_chunks" and field == "copy":
                sid = ident if ident.startswith("§") else f"§{ident}"
                src = await s.scalar(select(PolicyChunk).where(PolicyChunk.section_id == sid))
                if src is None:
                    raise OverrideError(f"no policy section {sid}")
                content = f"{src.content}\n\n{value}"
                s.add(
                    PolicyChunk(
                        doc=f"{src.doc}-copy",
                        doc_title=src.doc_title,
                        section_id=sid,
                        heading=src.heading,
                        breadcrumb=src.breadcrumb,
                        content=content,
                        ord=src.ord + 1000,
                        content_hash=hashlib.sha256(f"copy|{sid}|{content}".encode()).hexdigest(),
                        embedding=src.embedding,
                    )
                )
            else:
                raise OverrideError(f"override '{key}' is not an allowed red-team surface")
            applied.append(key)
        await s.execute(text("SELECT 1"))
    return applied
