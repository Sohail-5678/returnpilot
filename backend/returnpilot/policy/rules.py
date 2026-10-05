"""Policy constants and value types. The numbers here are the store's rules (SPEC §06)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any, Literal

ItemCondition = Literal["unopened", "opened", "damaged", "wrong_item"]
Decision = Literal["allow", "needs_approval", "deny"]

ITEM_CONDITIONS: tuple[str, ...] = ("unopened", "opened", "damaged", "wrong_item")
REFUND_REASONS: tuple[str, ...] = (
    "return_within_window",
    "damaged_item",
    "wrong_item",
    "defective",
    "exception_request",
)
RETURN_REASONS: tuple[str, ...] = (
    "changed_mind",
    "wrong_size",
    "damaged_item",
    "wrong_item",
    "defective",
    "not_as_described",
    "other",
)

STANDARD_WINDOW_DAYS = 30
GOLD_WINDOW_DAYS = 60
DAMAGED_WINDOW_DAYS = 60
NO_RETURN_NEEDED_BELOW = Decimal("20.00")
FREQUENT_REFUNDS_90D = 3
HOME_COUNTRY = "US"

# Rule ids are stable: they are written to audit_log, shown to reviewers and asserted in evals.
R_OWNER = "R-OWNER"
R_ORDER_STATUS = "R-ORDER-STATUS"
R_WINDOW = "R-WINDOW"
R_WINDOW_GOLD = "R-WINDOW-GOLD"
R_FINAL_SALE = "R-FINAL-SALE"
R_ELECTRONICS = "R-ELECTRONICS"
R_ELECTRONICS_CONFLICT = "R-ELECTRONICS-CONFLICT"
R_DAMAGED = "R-DAMAGED"
R_INTERNATIONAL = "R-INTERNATIONAL"
R_REFUND_ONCE = "R-REFUND-ONCE"
R_RETURN_ONCE = "R-RETURN-ONCE"
R_AMOUNT_MAX = "R-AMOUNT-MAX"
R_AMOUNT_LIMIT = "R-AMOUNT-LIMIT"
R_FREQUENCY = "R-FREQUENCY"
R_LOW_CONFIDENCE = "R-LOW-CONFIDENCE"
R_EXCEPTION = "R-EXCEPTION"
R_AUTO_APPROVE = "R-AUTO-APPROVE"


@dataclass(frozen=True)
class ItemFacts:
    """Everything the engine needs to know about one order line, loaded from the database."""

    order_item_id: str
    order_number: int
    owner_customer_id: str
    order_status: str
    delivered_at: datetime | None
    shipping_country: str
    shipping_cost: Decimal
    items_in_order: int
    name: str
    category: str
    final_sale: bool
    unit_price: Decimal
    qty: int
    discount: Decimal
    opened: bool | None

    @property
    def paid(self) -> Decimal:
        return (self.unit_price * self.qty - self.discount).quantize(Decimal("0.01"))

    @property
    def shipping_share(self) -> Decimal:
        if self.items_in_order <= 0:
            return Decimal("0.00")
        return (self.shipping_cost / self.items_in_order).quantize(Decimal("0.01"))

    @property
    def international(self) -> bool:
        return self.shipping_country.upper() != HOME_COUNTRY


@dataclass(frozen=True)
class CustomerFacts:
    customer_id: str
    loyalty_tier: str
    refunds_last_90d: int


@dataclass(frozen=True)
class ItemHistory:
    active_refund: bool = False
    active_return: bool = False


@dataclass
class Eligibility:
    eligible: bool
    return_required: bool
    max_refund: Decimal
    refund_shipping: bool
    window_days: int
    days_since_delivery: int | None
    reasons: list[str] = field(default_factory=list)
    rule_ids: list[str] = field(default_factory=list)
    soft_block: bool = False
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "eligible": self.eligible,
            "return_required": self.return_required,
            "max_refund": float(self.max_refund),
            "refund_shipping": self.refund_shipping,
            "window_days": self.window_days,
            "days_since_delivery": self.days_since_delivery,
            "reasons": list(self.reasons),
            "rule_ids": list(self.rule_ids),
            "overridable": self.soft_block,
            "notes": list(self.notes),
        }


@dataclass
class PolicyDecision:
    decision: Decision
    reasons: list[str]
    rule_ids: list[str]
    max_refund: Decimal | None = None
    return_required: bool | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "decision": self.decision,
            "reasons": list(self.reasons),
            "rule_ids": list(self.rule_ids),
            "max_refund": float(self.max_refund) if self.max_refund is not None else None,
            "return_required": self.return_required,
        }
