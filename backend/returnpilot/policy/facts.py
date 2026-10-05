"""Load policy facts from the database. Shared by the MCP tools, the graph's policy_check node
and the reviewer decision endpoint so all three evaluate the same facts.

Order lines are referenced as `<order_number>-<n>` (e.g. `1042-1`): short, readable ids that
LLMs copy reliably. Every lookup is scoped to one customer; there is no cross-customer path.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from returnpilot.db.models import Customer, Order, OrderItem, Refund, Return
from returnpilot.policy.rules import CustomerFacts, ItemFacts, ItemHistory

ACTIVE_REFUND = ("pending_approval", "queued", "issued")
ACTIVE_RETURN = ("pending_approval", "requested", "label_created", "received")
COUNTED_REFUND = ("queued", "issued")
_REF = re.compile(r"^#?(\d{3,6})-(\d{1,2})$")
_ORDER = re.compile(r"^#?\s*(\d{3,6})$")


def ordered_items(order: Order) -> list[OrderItem]:
    return sorted(order.items, key=lambda i: (-float(i.unit_price), i.product.sku))


def item_ref(order: Order, item: OrderItem) -> str:
    return f"{order.order_number}-{ordered_items(order).index(item) + 1}"


@dataclass
class ResolvedItem:
    order: Order
    item: OrderItem
    ref: str


async def get_customer_order(session: AsyncSession, customer_id: uuid.UUID, order_id: str) -> Order | None:
    """Find one of this customer's orders by order number ("1042", "#1042") or UUID."""
    order_id = order_id.strip()
    stmt = (
        select(Order)
        .options(selectinload(Order.items).joinedload(OrderItem.product))
        .where(Order.customer_id == customer_id)
    )
    m = _ORDER.match(order_id)
    if m:
        stmt = stmt.where(Order.order_number == int(m.group(1)))
    else:
        try:
            stmt = stmt.where(Order.id == uuid.UUID(order_id))
        except ValueError:
            return None
    return (await session.scalars(stmt)).first()


async def resolve_item(session: AsyncSession, customer_id: uuid.UUID, ref: str) -> ResolvedItem | None:
    ref = ref.strip()
    m = _REF.match(ref)
    if m:
        order = await get_customer_order(session, customer_id, m.group(1))
        if not order:
            return None
        items = ordered_items(order)
        idx = int(m.group(2)) - 1
        if not 0 <= idx < len(items):
            return None
        return ResolvedItem(order, items[idx], f"{order.order_number}-{idx + 1}")
    try:
        item_uuid = uuid.UUID(ref)
    except ValueError:
        return None
    item = (
        await session.scalars(
            select(OrderItem).join(Order).where(OrderItem.id == item_uuid, Order.customer_id == customer_id)
        )
    ).first()
    if not item:
        return None
    order = await get_customer_order(session, customer_id, str(item.order_id))
    if not order:  # pragma: no cover - same customer by construction
        return None
    item = next(i for i in order.items if i.id == item.id)
    return ResolvedItem(order, item, item_ref(order, item))


def item_facts(resolved: ResolvedItem) -> ItemFacts:
    o, i = resolved.order, resolved.item
    return ItemFacts(
        order_item_id=resolved.ref,
        order_number=o.order_number,
        owner_customer_id=str(o.customer_id),
        order_status=o.status,
        delivered_at=o.delivered_at,
        shipping_country=o.shipping_country,
        shipping_cost=o.shipping_cost,
        items_in_order=len(o.items),
        name=i.product.name,
        category=i.product.category,
        final_sale=i.product.final_sale,
        unit_price=i.unit_price,
        qty=i.qty,
        discount=i.discount,
        opened=i.opened,
    )


async def customer_facts(session: AsyncSession, customer_id: uuid.UUID, now: datetime) -> CustomerFacts:
    cust = await session.get(Customer, customer_id)
    if cust is None:
        raise LookupError("customer not found")
    n = await session.scalar(
        select(func.count())
        .select_from(Refund)
        .where(
            Refund.customer_id == customer_id,
            Refund.status.in_(COUNTED_REFUND),
            Refund.created_at >= now - timedelta(days=90),
        )
    )
    return CustomerFacts(customer_id=str(customer_id), loyalty_tier=cust.loyalty_tier, refunds_last_90d=int(n or 0))


async def item_history(
    session: AsyncSession, order_item_id: uuid.UUID, exclude_approval_id: uuid.UUID | None = None
) -> ItemHistory:
    """Open refunds/returns for an item. When re-checking a decision, the rows created for that
    same approval are excluded (they are the request itself, not a prior refund)."""
    refunds = (
        select(func.count())
        .select_from(Refund)
        .where(Refund.order_item_id == order_item_id, Refund.status.in_(ACTIVE_REFUND))
    )
    returns = (
        select(func.count())
        .select_from(Return)
        .where(Return.order_item_id == order_item_id, Return.status.in_(ACTIVE_RETURN))
    )
    if exclude_approval_id is not None:
        refunds = refunds.where(Refund.approval_id.is_distinct_from(exclude_approval_id))
        returns = returns.where(Return.approval_id.is_distinct_from(exclude_approval_id))
    refund = await session.scalar(refunds)
    ret = await session.scalar(returns)
    return ItemHistory(active_refund=bool(refund), active_return=bool(ret))


async def item_statuses(session: AsyncSession, item_ids: list[uuid.UUID]) -> dict[uuid.UUID, dict[str, str | None]]:
    """Latest return/refund status per order item (for order views)."""
    out: dict[uuid.UUID, dict[str, str | None]] = {i: {"return_status": None, "refund_status": None} for i in item_ids}
    if not item_ids:
        return out
    for r in (
        await session.scalars(select(Refund).where(Refund.order_item_id.in_(item_ids)).order_by(Refund.created_at))
    ).all():
        out[r.order_item_id]["refund_status"] = r.status
    for r in (
        await session.scalars(select(Return).where(Return.order_item_id.in_(item_ids)).order_by(Return.created_at))
    ).all():
        out[r.order_item_id]["return_status"] = r.status
    return out


def money(v: Any) -> float:
    return round(float(v), 2)


async def serialize_order(session: AsyncSession, order: Order, *, include_note: bool = True) -> dict[str, Any]:
    items = ordered_items(order)
    statuses = await item_statuses(session, [i.id for i in items])
    data: dict[str, Any] = {
        "order_id": str(order.id),
        "order_number": order.order_number,
        "status": order.status,
        "placed_at": order.placed_at.date().isoformat(),
        "delivered_at": order.delivered_at.date().isoformat() if order.delivered_at else None,
        "shipping_country": order.shipping_country,
        "shipping_cost": money(order.shipping_cost),
        "total": money(order.total),
        "items": [
            {
                "order_item_id": f"{order.order_number}-{n}",
                "name": i.product.name,
                "sku": i.product.sku,
                "category": i.product.category,
                "qty": i.qty,
                "unit_price": money(i.unit_price),
                "discount": money(i.discount),
                "price_paid": money(i.unit_price * i.qty - i.discount),
                "final_sale": i.product.final_sale,
                **statuses[i.id],
            }
            for n, i in enumerate(items, start=1)
        ],
    }
    if include_note:
        data["customer_note"] = order.customer_note
    return data
