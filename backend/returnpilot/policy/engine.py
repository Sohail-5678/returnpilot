"""Deterministic policy engine (SPEC §06).

The LLM never decides eligibility, refund amounts or whether a human must approve:
tools call these pure functions, and the graph's `policy_check` node calls them again
before anything executes. Hard rules always deny; soft rules deny unless the customer
explicitly asked for an exception, in which case a human reviewer decides.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from returnpilot.policy.rules import (
    DAMAGED_WINDOW_DAYS,
    FREQUENT_REFUNDS_90D,
    GOLD_WINDOW_DAYS,
    NO_RETURN_NEEDED_BELOW,
    R_AMOUNT_LIMIT,
    R_AMOUNT_MAX,
    R_AUTO_APPROVE,
    R_DAMAGED,
    R_ELECTRONICS,
    R_ELECTRONICS_CONFLICT,
    R_EXCEPTION,
    R_FINAL_SALE,
    R_FREQUENCY,
    R_INTERNATIONAL,
    R_LOW_CONFIDENCE,
    R_ORDER_STATUS,
    R_OWNER,
    R_REFUND_ONCE,
    R_RETURN_ONCE,
    R_WINDOW,
    R_WINDOW_GOLD,
    STANDARD_WINDOW_DAYS,
    CustomerFacts,
    Eligibility,
    ItemCondition,
    ItemFacts,
    ItemHistory,
    PolicyDecision,
)

CENT = Decimal("0.01")


def _money(value: Decimal | float | int | str) -> Decimal:
    return Decimal(str(value)).quantize(CENT)


def _fmt(value: Decimal) -> str:
    return f"${value:,.2f}"


def window_days_for(customer: CustomerFacts) -> int:
    return GOLD_WINDOW_DAYS if customer.loyalty_tier == "gold" else STANDARD_WINDOW_DAYS


def check_eligibility(
    item: ItemFacts,
    customer: CustomerFacts,
    condition: ItemCondition,
    now: datetime,
) -> Eligibility:
    """Can this item be returned/refunded, and for how much? Ignores ownership and history."""
    damaged = condition in ("damaged", "wrong_item")
    window = max(window_days_for(customer), DAMAGED_WINDOW_DAYS) if damaged else window_days_for(customer)
    window_rule = R_WINDOW_GOLD if customer.loyalty_tier == "gold" and not damaged else R_WINDOW

    days = (now - item.delivered_at).days if item.delivered_at else None
    refund_shipping = damaged
    reasons: list[str] = []
    blockers: list[str] = []  # why it is NOT eligible; listed first so explanations lead with the cause
    rule_ids: list[str] = []
    notes: list[str] = []
    eligible = True
    soft_block = False

    if item.order_status != "delivered" or days is None:
        eligible = False
        rule_ids.append(R_ORDER_STATUS)
        if item.order_status in ("processing", "cancelled"):
            blockers.append(f"Order #{item.order_number} is {item.order_status}; it can't be returned or refunded.")
        else:
            blockers.append(f"Order #{item.order_number} hasn't been delivered yet; returns open after delivery.")
    else:
        if days > window:
            eligible = False
            soft_block = True
            rule_ids.append(window_rule)
            blockers.append(f"Delivered {days} days ago, outside the {window}-day return window.")
        else:
            rule_ids.append(window_rule)
            reasons.append(f"Delivered {days} days ago, within the {window}-day return window.")

        if item.final_sale:
            rule_ids.append(R_FINAL_SALE)
            eligible = False
            soft_block = True
            if damaged:
                blockers.append("Final-sale items can't be refunded; a damaged final-sale item can be exchanged.")
            else:
                blockers.append("Final-sale items can't be returned or refunded.")
        elif item.category == "electronics":
            rule_ids.append(R_ELECTRONICS)
            if condition == "opened":
                eligible = False
                soft_block = True
                blockers.append("Opened electronics can only be returned if they are damaged or defective.")
            elif condition == "unopened":
                reasons.append("Unopened electronics are returnable.")
                if item.opened:
                    rule_ids.append(R_ELECTRONICS_CONFLICT)
                    notes.append("Store records show this item was activated, so a team member must confirm.")
            else:
                reasons.append("Damaged or defective electronics are returnable.")

        if damaged and not item.final_sale:
            rule_ids.append(R_DAMAGED)
            reasons.append("Damaged or wrong items are covered for 60 days, including original shipping.")

    if item.international:
        rule_ids.append(R_INTERNATIONAL)
        notes.append("International order: return shipping is paid by the customer.")
        if not damaged:
            notes.append("Original shipping is not refunded on international orders.")

    reasons = blockers + reasons
    max_refund = item.paid + (item.shipping_share if refund_shipping else Decimal("0.00"))
    return_required = not (damaged and item.paid < NO_RETURN_NEEDED_BELOW)
    if not return_required:
        notes.append(f"Items under {_fmt(NO_RETURN_NEEDED_BELOW)} that arrived damaged don't need to be sent back.")

    return Eligibility(
        eligible=eligible,
        return_required=return_required,
        max_refund=_money(max_refund),
        refund_shipping=refund_shipping,
        window_days=window,
        days_since_delivery=days,
        reasons=reasons,
        rule_ids=rule_ids,
        soft_block=soft_block,
        notes=notes,
    )


def _hard_checks(item: ItemFacts, customer: CustomerFacts) -> PolicyDecision | None:
    if item.owner_customer_id != customer.customer_id:
        return PolicyDecision("deny", ["This item belongs to a different customer."], [R_OWNER])
    if item.order_status in ("processing", "cancelled"):
        return PolicyDecision(
            "deny",
            [f"Order #{item.order_number} is {item.order_status}; refunds aren't possible."],
            [R_ORDER_STATUS],
        )
    if item.order_status != "delivered" or item.delivered_at is None:
        return PolicyDecision(
            "deny",
            [f"Order #{item.order_number} hasn't been delivered yet; returns open after delivery."],
            [R_ORDER_STATUS],
        )
    return None


def _approval_triggers(elig: Eligibility, customer: CustomerFacts, low_confidence: bool) -> tuple[list[str], list[str]]:
    reasons: list[str] = []
    rule_ids: list[str] = []
    if R_ELECTRONICS_CONFLICT in elig.rule_ids:
        reasons.append("Customer says the item is unopened but store records show it was activated.")
        rule_ids.append(R_ELECTRONICS_CONFLICT)
    if customer.refunds_last_90d >= FREQUENT_REFUNDS_90D:
        reasons.append(f"Customer has {customer.refunds_last_90d} refunds in the last 90 days.")
        rule_ids.append(R_FREQUENCY)
    if low_confidence:
        reasons.append("The agent flagged low confidence in this request.")
        rule_ids.append(R_LOW_CONFIDENCE)
    return reasons, rule_ids


def evaluate_refund(
    item: ItemFacts,
    customer: CustomerFacts,
    history: ItemHistory,
    condition: ItemCondition,
    amount: Decimal | float | int | str,
    now: datetime,
    *,
    auto_approve_limit: Decimal | float = Decimal("50"),
    request_exception: bool = False,
    low_confidence: bool = False,
) -> PolicyDecision:
    """Decide a proposed refund: allow (auto-approve), needs_approval (human), or deny."""
    hard = _hard_checks(item, customer)
    if hard:
        return hard
    if history.active_refund:
        return PolicyDecision(
            "deny", ["This item has already been refunded (an item can be refunded once)."], [R_REFUND_ONCE]
        )

    elig = check_eligibility(item, customer, condition, now)
    amt = _money(amount)
    if amt <= 0:
        return PolicyDecision("deny", ["Refund amount must be greater than zero."], [R_AMOUNT_MAX], elig.max_refund)
    if amt > elig.max_refund:
        return PolicyDecision(
            "deny",
            [f"{_fmt(amt)} is more than the {_fmt(elig.max_refund)} paid for this item."],
            [R_AMOUNT_MAX],
            elig.max_refund,
            elig.return_required,
        )

    if not elig.eligible:
        if request_exception and elig.soft_block:
            return PolicyDecision(
                "needs_approval",
                ["Customer asked for an exception to the policy.", *elig.reasons],
                [R_EXCEPTION, *elig.rule_ids],
                elig.max_refund,
                elig.return_required,
            )
        return PolicyDecision("deny", elig.reasons, elig.rule_ids, elig.max_refund, elig.return_required)

    limit = _money(auto_approve_limit)
    reasons, rule_ids = _approval_triggers(elig, customer, low_confidence)
    if amt > limit:
        reasons.insert(0, f"{_fmt(amt)} is over the {_fmt(limit)} auto-approve limit.")
        rule_ids.insert(0, R_AMOUNT_LIMIT)
    if request_exception:
        reasons.append("Customer asked for an exception to the policy.")
        rule_ids.append(R_EXCEPTION)

    if rule_ids:
        return PolicyDecision(
            "needs_approval", reasons, [*elig.rule_ids, *rule_ids], elig.max_refund, elig.return_required
        )
    return PolicyDecision(
        "allow",
        [*elig.reasons, f"{_fmt(amt)} is within the {_fmt(limit)} auto-approve limit."],
        [*elig.rule_ids, R_AUTO_APPROVE],
        elig.max_refund,
        elig.return_required,
    )


def evaluate_return(
    item: ItemFacts,
    customer: CustomerFacts,
    history: ItemHistory,
    condition: ItemCondition,
    now: datetime,
    *,
    request_exception: bool = False,
    low_confidence: bool = False,
) -> PolicyDecision:
    """Decide a proposed return (no money moves, so no amount limit)."""
    hard = _hard_checks(item, customer)
    if hard:
        return hard
    if history.active_return:
        return PolicyDecision("deny", ["A return is already open for this item."], [R_RETURN_ONCE])
    if history.active_refund:
        return PolicyDecision("deny", ["This item has already been refunded."], [R_REFUND_ONCE])

    elig = check_eligibility(item, customer, condition, now)
    if not elig.eligible:
        if request_exception and elig.soft_block:
            return PolicyDecision(
                "needs_approval",
                ["Customer asked for an exception to the policy.", *elig.reasons],
                [R_EXCEPTION, *elig.rule_ids],
                elig.max_refund,
                elig.return_required,
            )
        return PolicyDecision("deny", elig.reasons, elig.rule_ids, elig.max_refund, elig.return_required)

    reasons, rule_ids = _approval_triggers(elig, customer, low_confidence)
    # Frequent refunders can still send items back; only money movement needs a reviewer.
    if R_FREQUENCY in rule_ids:
        idx = rule_ids.index(R_FREQUENCY)
        rule_ids.pop(idx)
        reasons.pop(idx)
    if request_exception:
        reasons.append("Customer asked for an exception to the policy.")
        rule_ids.append(R_EXCEPTION)
    if rule_ids:
        return PolicyDecision(
            "needs_approval", reasons, [*elig.rule_ids, *rule_ids], elig.max_refund, elig.return_required
        )
    return PolicyDecision(
        "allow", elig.reasons, [*elig.rule_ids, R_AUTO_APPROVE], elig.max_refund, elig.return_required
    )
