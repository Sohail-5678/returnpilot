"""ORM models mirroring migrations/versions/0001_initial.py (the migration is the source of truth)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import BigInteger, Boolean, Date, DateTime, ForeignKey, Integer, Numeric, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())


def _now() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now())


class Customer(Base):
    __tablename__ = "customers"
    id: Mapped[uuid.UUID] = _uuid_pk()
    name: Mapped[str] = mapped_column(Text)
    email: Mapped[str] = mapped_column(Text, unique=True)
    loyalty_tier: Mapped[str] = mapped_column(Text, default="standard")
    shipping_pref: Mapped[str | None] = mapped_column(Text)
    country: Mapped[str] = mapped_column(Text, default="US")
    template_key: Mapped[str | None] = mapped_column(Text)
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    seeded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _now()

    orders: Mapped[list[Order]] = relationship(back_populates="customer")


class AppUser(Base):
    __tablename__ = "app_users"
    id: Mapped[uuid.UUID] = _uuid_pk()
    provider: Mapped[str] = mapped_column(Text)
    provider_user_id: Mapped[str] = mapped_column(Text)
    github_login: Mapped[str | None] = mapped_column(Text)
    display_name: Mapped[str | None] = mapped_column(Text)
    role: Mapped[str] = mapped_column(Text)
    customer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"))
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = _now()
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Product(Base):
    __tablename__ = "products"
    id: Mapped[uuid.UUID] = _uuid_pk()
    sku: Mapped[str] = mapped_column(Text, unique=True)
    name: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(Text)
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    final_sale: Mapped[bool] = mapped_column(Boolean, default=False)


class Order(Base):
    __tablename__ = "orders"
    id: Mapped[uuid.UUID] = _uuid_pk()
    order_number: Mapped[int] = mapped_column(Integer)
    customer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(Text)
    placed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    shipping_country: Mapped[str] = mapped_column(Text, default="US")
    shipping_cost: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0"))
    total: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    customer_note: Mapped[str | None] = mapped_column(Text)

    customer: Mapped[Customer] = relationship(back_populates="orders")
    items: Mapped[list[OrderItem]] = relationship(back_populates="order", order_by="OrderItem.unit_price.desc()")


class OrderItem(Base):
    __tablename__ = "order_items"
    id: Mapped[uuid.UUID] = _uuid_pk()
    order_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"))
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id"))
    qty: Mapped[int] = mapped_column(Integer, default=1)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    discount: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0"))
    opened: Mapped[bool | None] = mapped_column(Boolean)

    order: Mapped[Order] = relationship(back_populates="items")
    product: Mapped[Product] = relationship(lazy="joined")


class Thread(Base):
    __tablename__ = "threads"
    id: Mapped[uuid.UUID] = _uuid_pk()
    customer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"))
    title: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, default="active")
    summary: Mapped[str | None] = mapped_column(Text)
    summary_upto: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = _now()
    updated_at: Mapped[datetime] = _now()


class Approval(Base):
    __tablename__ = "approvals"
    id: Mapped[uuid.UUID] = _uuid_pk()
    thread_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("threads.id", ondelete="CASCADE"))
    customer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"))
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    run_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    proposal_key: Mapped[str] = mapped_column(Text, unique=True)
    action: Mapped[str] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text)
    args: Mapped[dict[str, Any]] = mapped_column(JSONB)
    amount: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    max_amount: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    evidence: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    policy: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    reason: Mapped[str] = mapped_column(Text)
    agent_summary: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, default="pending")
    decided_by: Mapped[str | None] = mapped_column(Text)
    decision: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = _now()
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Return(Base):
    __tablename__ = "returns"
    id: Mapped[uuid.UUID] = _uuid_pk()
    order_item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("order_items.id", ondelete="CASCADE"))
    customer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"))
    thread_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("threads.id", ondelete="SET NULL"))
    approval_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("approvals.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(Text)
    reason: Mapped[str | None] = mapped_column(Text)
    item_condition: Mapped[str | None] = mapped_column(Text)
    label_code: Mapped[str | None] = mapped_column(Text)
    idempotency_key: Mapped[str | None] = mapped_column(Text, unique=True)
    created_at: Mapped[datetime] = _now()
    updated_at: Mapped[datetime] = _now()


class Refund(Base):
    __tablename__ = "refunds"
    id: Mapped[uuid.UUID] = _uuid_pk()
    order_item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("order_items.id", ondelete="CASCADE"))
    customer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"))
    thread_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("threads.id", ondelete="SET NULL"))
    approval_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("approvals.id", ondelete="SET NULL"))
    amount: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    status: Mapped[str] = mapped_column(Text)
    reason: Mapped[str | None] = mapped_column(Text)
    idempotency_key: Mapped[str | None] = mapped_column(Text, unique=True)
    created_at: Mapped[datetime] = _now()
    updated_at: Mapped[datetime] = _now()


class Ticket(Base):
    __tablename__ = "tickets"
    id: Mapped[uuid.UUID] = _uuid_pk()
    customer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"))
    thread_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("threads.id", ondelete="SET NULL"))
    subject: Mapped[str] = mapped_column(Text)
    summary: Mapped[str | None] = mapped_column(Text)
    priority: Mapped[str] = mapped_column(Text, default="normal")
    status: Mapped[str] = mapped_column(Text, default="open")
    created_at: Mapped[datetime] = _now()


class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[uuid.UUID] = _uuid_pk()
    kind: Mapped[str] = mapped_column(Text)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    idempotency_key: Mapped[str] = mapped_column(Text, unique=True)
    status: Mapped[str] = mapped_column(Text, default="queued")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_error: Mapped[str | None] = mapped_column(Text)
    celery_task_id: Mapped[str | None] = mapped_column(Text)
    thread_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    customer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = _now()
    updated_at: Mapped[datetime] = _now()


class OutboxEmail(Base):
    __tablename__ = "outbox_emails"
    id: Mapped[uuid.UUID] = _uuid_pk()
    customer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"))
    subject: Mapped[str] = mapped_column(Text)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = _now()


class PolicyChunk(Base):
    __tablename__ = "policy_chunks"
    id: Mapped[uuid.UUID] = _uuid_pk()
    doc: Mapped[str] = mapped_column(Text)
    doc_title: Mapped[str] = mapped_column(Text)
    section_id: Mapped[str] = mapped_column(Text)
    heading: Mapped[str] = mapped_column(Text)
    breadcrumb: Mapped[str] = mapped_column(Text)
    content: Mapped[str] = mapped_column(Text)
    ord: Mapped[int] = mapped_column(Integer, default=0)
    content_hash: Mapped[str] = mapped_column(Text, unique=True)
    embedding: Mapped[list[float] | None] = mapped_column(Vector(768))


class Memory(Base):
    __tablename__ = "memories"
    id: Mapped[uuid.UUID] = _uuid_pk()
    customer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"))
    content: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(Text, default="preference")
    embedding: Mapped[list[float] | None] = mapped_column(Vector(768))
    source_thread_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = _now()
    updated_at: Mapped[datetime] = _now()


class Run(Base):
    __tablename__ = "runs"
    id: Mapped[uuid.UUID] = _uuid_pk()
    thread_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    customer_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    kind: Mapped[str] = mapped_column(Text, default="turn")
    status: Mapped[str] = mapped_column(Text, default="running")
    route: Mapped[str | None] = mapped_column(Text)
    model_primary: Mapped[str | None] = mapped_column(Text)
    total_ms: Mapped[int | None] = mapped_column(Integer)
    llm_calls: Mapped[int] = mapped_column(Integer, default=0)
    tool_calls: Mapped[int] = mapped_column(Integer, default=0)
    tokens_in: Mapped[int] = mapped_column(Integer, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0)
    first_user_text: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    profile_version: Mapped[str | None] = mapped_column(Text)
    mode: Mapped[str] = mapped_column(Text, default="live")
    case_id: Mapped[str | None] = mapped_column(Text)
    feedback_thumbs: Mapped[int | None] = mapped_column(Integer)
    feedback_comment: Mapped[str | None] = mapped_column(Text)
    exported_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _now()


class RunStep(Base):
    __tablename__ = "run_steps"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"))
    seq: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text)
    model: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    tokens_in: Mapped[int | None] = mapped_column(Integer)
    tokens_out: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(Text, default="ok")
    input_redacted: Mapped[Any] = mapped_column(JSONB)
    output_redacted: Mapped[Any] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(Text)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    actor: Mapped[str] = mapped_column(Text)
    action: Mapped[str] = mapped_column(Text)
    target: Mapped[str | None] = mapped_column(Text)
    details: Mapped[Any] = mapped_column(JSONB)
    created_at: Mapped[datetime] = _now()


class UsageCounter(Base):
    __tablename__ = "usage_counters"
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    provider: Mapped[str] = mapped_column(Text, primary_key=True)
    kind: Mapped[str] = mapped_column(Text, primary_key=True)
    count: Mapped[int] = mapped_column(Integer, default=0)


class EvalResult(Base):
    __tablename__ = "eval_results"
    id: Mapped[uuid.UUID] = _uuid_pk()
    suite: Mapped[str] = mapped_column(Text)
    run_label: Mapped[str] = mapped_column(Text)
    scenario_id: Mapped[str] = mapped_column(Text)
    passed: Mapped[bool] = mapped_column(Boolean)
    details: Mapped[Any] = mapped_column(JSONB)
    git_sha: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _now()
