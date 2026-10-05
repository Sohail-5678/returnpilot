"""Read models shared by several routes (orders, thread actions, approvals)."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select

from returnpilot.db.models import Approval, Customer, Order, OrderItem, Product, Refund, Return, Ticket
from returnpilot.db.session import db_session
from returnpilot.policy.facts import item_statuses, money, ordered_items

REFUND_STATUS = {
    "pending_approval": "pending_approval",
    "queued": "queued",
    "issued": "succeeded",
    "failed": "failed",
    "rejected": "rejected",
    "expired": "expired",
}
REFUND_DETAIL = {
    "pending_approval": "Waiting for a team member",
    "queued": "Processing (simulated)…",
    "issued": "Refund issued (simulated)",
    "failed": "Processing failed",
    "rejected": "Not approved",
    "expired": "Approval expired",
}
RETURN_STATUS = {
    "pending_approval": "pending_approval",
    "requested": "queued",
    "label_created": "succeeded",
    "received": "succeeded",
    "rejected": "rejected",
    "expired": "expired",
    "cancelled": "failed",
}


def short_name(name: str) -> str:
    parts = name.split()
    return f"{parts[0]} {parts[-1][0]}." if len(parts) > 1 else name


async def thread_actions(thread_id: uuid.UUID) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    async with db_session() as s:
        refunds = (
            await s.execute(
                select(Refund, Product.name, Order.order_number)
                .join(OrderItem, OrderItem.id == Refund.order_item_id)
                .join(Product, Product.id == OrderItem.product_id)
                .join(Order, Order.id == OrderItem.order_id)
                .where(Refund.thread_id == thread_id)
                .order_by(Refund.created_at)
            )
        ).all()
        returns = (
            await s.execute(
                select(Return, Product.name, Order.order_number)
                .join(OrderItem, OrderItem.id == Return.order_item_id)
                .join(Product, Product.id == OrderItem.product_id)
                .join(Order, Order.id == OrderItem.order_id)
                .where(Return.thread_id == thread_id)
                .order_by(Return.created_at)
            )
        ).all()
        tickets = (
            await s.scalars(select(Ticket).where(Ticket.thread_id == thread_id).order_by(Ticket.created_at))
        ).all()
    for r, name, number in refunds:
        out.append(
            {
                "id": str(r.id),
                "kind": "refund",
                "status": REFUND_STATUS.get(r.status, r.status),
                "label": f"Refund ${float(r.amount):,.2f} · {name}",
                "amount": money(r.amount),
                "order_number": number,
                "updated_at": r.updated_at.isoformat(),
                "detail": REFUND_DETAIL.get(r.status, r.status),
            }
        )
    for r, name, number in returns:
        detail = {
            "pending_approval": "Waiting for a team member",
            "requested": "Creating return label…",
            "label_created": f"Return label {r.label_code} created (simulated)",
            "received": "Return received",
            "rejected": "Not approved",
            "expired": "Approval expired",
            "cancelled": "Cancelled",
        }.get(r.status, r.status)
        out.append(
            {
                "id": str(r.id),
                "kind": "return",
                "status": RETURN_STATUS.get(r.status, r.status),
                "label": f"Return · {name}",
                "amount": None,
                "order_number": number,
                "updated_at": r.updated_at.isoformat(),
                "detail": detail,
            }
        )
    for t in tickets:
        out.append(
            {
                "id": str(t.id),
                "kind": "ticket",
                "status": "succeeded",
                "label": f"Support ticket · {t.subject[:60]}",
                "amount": None,
                "order_number": None,
                "updated_at": t.created_at.isoformat(),
                "detail": "A team member will reply by email",
            }
        )
    return sorted(out, key=lambda a: a["updated_at"])


async def order_list(customer_id: uuid.UUID, status: str | None) -> list[dict[str, Any]]:
    from sqlalchemy.orm import selectinload

    async with db_session() as s:
        stmt = (
            select(Order)
            .options(selectinload(Order.items).joinedload(OrderItem.product))
            .where(Order.customer_id == customer_id)
            .order_by(Order.placed_at.desc())
        )
        if status:
            stmt = stmt.where(Order.status == status)
        orders = (await s.scalars(stmt)).all()
    return [
        {
            "id": str(o.id),
            "order_number": o.order_number,
            "placed_at": o.placed_at.isoformat(),
            "delivered_at": o.delivered_at.isoformat() if o.delivered_at else None,
            "status": o.status,
            "total": money(o.total),
            "items_count": sum(i.qty for i in o.items),
            "shipping_country": o.shipping_country,
            "thumbnail_category": ordered_items(o)[0].product.category if o.items else None,
            "item_names": [i.product.name for i in ordered_items(o)],
        }
        for o in orders
    ]


async def order_detail(order: Order) -> dict[str, Any]:
    items = ordered_items(order)
    async with db_session() as s:
        statuses = await item_statuses(s, [i.id for i in items])
    return {
        "id": str(order.id),
        "order_number": order.order_number,
        "status": order.status,
        "placed_at": order.placed_at.isoformat(),
        "delivered_at": order.delivered_at.isoformat() if order.delivered_at else None,
        "shipping_country": order.shipping_country,
        "shipping_cost": money(order.shipping_cost),
        "total": money(order.total),
        "customer_note": order.customer_note,
        "items": [
            {
                "id": str(i.id),
                "ref": f"{order.order_number}-{n}",
                "sku": i.product.sku,
                "name": i.product.name,
                "category": i.product.category,
                "qty": i.qty,
                "unit_price": money(i.unit_price),
                "discount": money(i.discount),
                "final_sale": i.product.final_sale,
                "opened": i.opened,
                **statuses[i.id],
            }
            for n, i in enumerate(items, start=1)
        ],
    }


async def approval_customer_names(approvals: list[Approval]) -> dict[uuid.UUID, str]:
    ids = {a.customer_id for a in approvals}
    if not ids:
        return {}
    async with db_session() as s:
        rows = (await s.execute(select(Customer.id, Customer.name).where(Customer.id.in_(ids)))).all()
    return {r.id: short_name(r.name) for r in rows}


def approval_summary(a: Approval, customer_name: str) -> dict[str, Any]:
    ev = a.evidence or {}
    return {
        "id": str(a.id),
        "status": a.status,
        "action": a.action,
        "title": a.title,
        "amount": money(a.amount) if a.amount is not None else None,
        "order_number": (ev.get("order") or {}).get("order_number"),
        "item_name": (ev.get("item") or {}).get("name"),
        "customer_name": customer_name,
        "reason": a.reason,
        "created_at": a.created_at.isoformat(),
        "expires_at": a.expires_at.isoformat(),
        "decided_at": a.decided_at.isoformat() if a.decided_at else None,
    }


def approval_detail(a: Approval, customer_name: str) -> dict[str, Any]:
    ev = dict(a.evidence or {})
    ev.pop("action", None)
    return {
        **approval_summary(a, customer_name),
        "args": a.args,
        "max_amount": money(a.max_amount) if a.max_amount is not None else None,
        "policy": a.policy,
        "evidence": ev,
        "agent_summary": a.agent_summary,
        "thread_id": str(a.thread_id),
        "run_id": str(a.run_id) if a.run_id else None,
        "decision": a.decision,
        "decided_by": a.decided_by,
    }
