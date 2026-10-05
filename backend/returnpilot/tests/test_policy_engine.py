from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from returnpilot.policy import rules as R
from returnpilot.policy.engine import check_eligibility, evaluate_refund, evaluate_return
from returnpilot.policy.rules import CustomerFacts, ItemFacts, ItemHistory

NOW = datetime(2026, 10, 5, 12, 0, tzinfo=UTC)
MAYA = "cust-maya"


def item(**kw: object) -> ItemFacts:
    base = ItemFacts(
        order_item_id="item-1",
        order_number=1042,
        owner_customer_id=MAYA,
        order_status="delivered",
        delivered_at=NOW - timedelta(days=15),
        shipping_country="US",
        shipping_cost=Decimal("6.00"),
        items_in_order=2,
        name="Trail Runner Boots",
        category="footwear",
        final_sale=False,
        unit_price=Decimal("129.00"),
        qty=1,
        discount=Decimal("0.00"),
        opened=None,
    )
    return replace(base, **kw)  # type: ignore[arg-type]


def customer(**kw: object) -> CustomerFacts:
    base = CustomerFacts(customer_id=MAYA, loyalty_tier="standard", refunds_last_90d=0)
    return replace(base, **kw)  # type: ignore[arg-type]


NO_HISTORY = ItemHistory()


# ---------------------------------------------------------------- refunds: table


@pytest.mark.parametrize(
    ("label", "item_kw", "cust_kw", "history", "condition", "amount", "flags", "decision", "must_have"),
    [
        (
            "small eligible refund auto-approves",
            {"unit_price": Decimal("18.00")},
            {},
            NO_HISTORY,
            "unopened",
            18,
            {},
            "allow",
            R.R_AUTO_APPROVE,
        ),
        ("over $50 needs a human", {}, {}, NO_HISTORY, "unopened", 129, {}, "needs_approval", R.R_AMOUNT_LIMIT),
        (
            "exactly $50 auto-approves",
            {"unit_price": Decimal("50.00")},
            {},
            NO_HISTORY,
            "unopened",
            50,
            {},
            "allow",
            R.R_AUTO_APPROVE,
        ),
        (
            "outside 30 days denied",
            {"delivered_at": NOW - timedelta(days=45)},
            {},
            NO_HISTORY,
            "unopened",
            40,
            {},
            "deny",
            R.R_WINDOW,
        ),
        (
            "gold gets 60 days",
            {"delivered_at": NOW - timedelta(days=45), "unit_price": Decimal("40.00")},
            {"loyalty_tier": "gold"},
            NO_HISTORY,
            "unopened",
            40,
            {},
            "allow",
            R.R_WINDOW_GOLD,
        ),
        (
            "gold outside 60 days denied",
            {"delivered_at": NOW - timedelta(days=61)},
            {"loyalty_tier": "gold"},
            NO_HISTORY,
            "unopened",
            40,
            {},
            "deny",
            R.R_WINDOW_GOLD,
        ),
        (
            "exception outside window goes to a human",
            {"delivered_at": NOW - timedelta(days=45)},
            {},
            NO_HISTORY,
            "unopened",
            40,
            {"request_exception": True},
            "needs_approval",
            R.R_EXCEPTION,
        ),
        (
            "final sale denied",
            {"final_sale": True, "unit_price": Decimal("45.00")},
            {},
            NO_HISTORY,
            "unopened",
            45,
            {},
            "deny",
            R.R_FINAL_SALE,
        ),
        (
            "damaged final sale still denied (exchange only)",
            {"final_sale": True, "unit_price": Decimal("45.00")},
            {},
            NO_HISTORY,
            "damaged",
            45,
            {},
            "deny",
            R.R_FINAL_SALE,
        ),
        (
            "final sale exception goes to a human",
            {"final_sale": True, "unit_price": Decimal("45.00")},
            {},
            NO_HISTORY,
            "unopened",
            45,
            {"request_exception": True},
            "needs_approval",
            R.R_EXCEPTION,
        ),
        (
            "opened electronics denied",
            {"category": "electronics", "unit_price": Decimal("199.00")},
            {},
            NO_HISTORY,
            "opened",
            199,
            {},
            "deny",
            R.R_ELECTRONICS,
        ),
        (
            "unopened electronics small allowed",
            {"category": "electronics", "unit_price": Decimal("29.00")},
            {},
            NO_HISTORY,
            "unopened",
            29,
            {},
            "allow",
            R.R_ELECTRONICS,
        ),
        (
            "unopened claim vs activated record needs a human",
            {"category": "electronics", "unit_price": Decimal("29.00"), "opened": True},
            {},
            NO_HISTORY,
            "unopened",
            29,
            {},
            "needs_approval",
            R.R_ELECTRONICS_CONFLICT,
        ),
        (
            "defective electronics allowed",
            {"category": "electronics", "unit_price": Decimal("29.00"), "opened": True},
            {},
            NO_HISTORY,
            "damaged",
            29,
            {},
            "allow",
            R.R_DAMAGED,
        ),
        (
            "damaged item covered for 60 days",
            {"delivered_at": NOW - timedelta(days=50), "unit_price": Decimal("32.00")},
            {},
            NO_HISTORY,
            "damaged",
            32,
            {},
            "allow",
            R.R_DAMAGED,
        ),
        (
            "damaged item past 60 days denied",
            {"delivered_at": NOW - timedelta(days=61), "unit_price": Decimal("32.00")},
            {},
            NO_HISTORY,
            "wrong_item",
            32,
            {},
            "deny",
            R.R_WINDOW,
        ),
        (
            "already refunded denied",
            {},
            {},
            ItemHistory(active_refund=True),
            "unopened",
            10,
            {},
            "deny",
            R.R_REFUND_ONCE,
        ),
        (
            "amount over price denied",
            {"unit_price": Decimal("18.00")},
            {},
            NO_HISTORY,
            "unopened",
            25,
            {},
            "deny",
            R.R_AMOUNT_MAX,
        ),
        ("zero amount denied", {}, {}, NO_HISTORY, "unopened", 0, {}, "deny", R.R_AMOUNT_MAX),
        (
            "processing order denied",
            {"order_status": "processing", "delivered_at": None},
            {},
            NO_HISTORY,
            "unopened",
            10,
            {},
            "deny",
            R.R_ORDER_STATUS,
        ),
        (
            "cancelled order denied",
            {"order_status": "cancelled", "delivered_at": None},
            {},
            NO_HISTORY,
            "unopened",
            10,
            {},
            "deny",
            R.R_ORDER_STATUS,
        ),
        (
            "shipped but not delivered denied",
            {"order_status": "shipped", "delivered_at": None},
            {},
            NO_HISTORY,
            "unopened",
            10,
            {},
            "deny",
            R.R_ORDER_STATUS,
        ),
        (
            "another customer's item denied",
            {"owner_customer_id": "cust-arjun"},
            {},
            NO_HISTORY,
            "unopened",
            10,
            {},
            "deny",
            R.R_OWNER,
        ),
        (
            "3 refunds in 90 days needs a human",
            {"unit_price": Decimal("18.00")},
            {"refunds_last_90d": 3},
            NO_HISTORY,
            "unopened",
            18,
            {},
            "needs_approval",
            R.R_FREQUENCY,
        ),
        (
            "2 refunds in 90 days still auto",
            {"unit_price": Decimal("18.00")},
            {"refunds_last_90d": 2},
            NO_HISTORY,
            "unopened",
            18,
            {},
            "allow",
            R.R_AUTO_APPROVE,
        ),
        (
            "low confidence needs a human",
            {"unit_price": Decimal("18.00")},
            {},
            NO_HISTORY,
            "unopened",
            18,
            {"low_confidence": True},
            "needs_approval",
            R.R_LOW_CONFIDENCE,
        ),
        (
            "exception on an eligible refund goes to a human",
            {"unit_price": Decimal("18.00")},
            {},
            NO_HISTORY,
            "unopened",
            18,
            {"request_exception": True},
            "needs_approval",
            R.R_EXCEPTION,
        ),
        (
            "hard rules beat exceptions",
            {"order_status": "cancelled", "delivered_at": None},
            {},
            NO_HISTORY,
            "unopened",
            10,
            {"request_exception": True},
            "deny",
            R.R_ORDER_STATUS,
        ),
    ],
)
def test_refund_table(label, item_kw, cust_kw, history, condition, amount, flags, decision, must_have) -> None:  # type: ignore[no-untyped-def]
    result = evaluate_refund(item(**item_kw), customer(**cust_kw), history, condition, amount, NOW, **flags)
    assert result.decision == decision, (label, result)
    assert must_have in result.rule_ids, (label, result.rule_ids)
    assert result.reasons, label


def test_custom_auto_approve_limit() -> None:
    result = evaluate_refund(item(), customer(), NO_HISTORY, "unopened", 129, NOW, auto_approve_limit=200)
    assert result.decision == "allow"


def test_refund_decision_serializes() -> None:
    d = evaluate_refund(item(), customer(), NO_HISTORY, "unopened", 129, NOW).to_dict()
    assert d["decision"] == "needs_approval"
    assert d["max_refund"] == 129.0
    assert d["return_required"] is True
    deny = evaluate_refund(item(owner_customer_id="x"), customer(), NO_HISTORY, "unopened", 1, NOW).to_dict()
    assert deny["max_refund"] is None


# ---------------------------------------------------------------- eligibility details


def test_international_excludes_shipping_unless_damaged() -> None:
    intl = item(shipping_country="DE", shipping_cost=Decimal("18.00"), items_in_order=1, unit_price=Decimal("64.00"))
    normal = check_eligibility(intl, customer(), "unopened", NOW)
    assert R.R_INTERNATIONAL in normal.rule_ids
    assert normal.max_refund == Decimal("64.00")
    assert any("Original shipping" in n for n in normal.notes)
    damaged = check_eligibility(intl, customer(), "damaged", NOW)
    assert damaged.max_refund == Decimal("82.00")
    assert damaged.refund_shipping is True
    assert not any("Original shipping" in n for n in damaged.notes)


def test_cheap_damaged_item_needs_no_return() -> None:
    cheap = item(unit_price=Decimal("16.00"))
    elig = check_eligibility(cheap, customer(), "damaged", NOW)
    assert elig.return_required is False
    assert elig.max_refund == Decimal("19.00")  # $16 + $3 shipping share
    assert check_eligibility(cheap, customer(), "unopened", NOW).return_required is True


def test_discount_and_quantity() -> None:
    socks = item(unit_price=Decimal("9.00"), qty=3, discount=Decimal("2.00"))
    assert socks.paid == Decimal("25.00")
    assert check_eligibility(socks, customer(), "unopened", NOW).max_refund == Decimal("25.00")


def test_zero_items_in_order_has_no_shipping_share() -> None:
    assert item(items_in_order=0).shipping_share == Decimal("0.00")


def test_not_delivered_reasons() -> None:
    shipped = check_eligibility(item(order_status="shipped", delivered_at=None), customer(), "unopened", NOW)
    assert not shipped.eligible and not shipped.soft_block
    assert "hasn't been delivered" in shipped.reasons[0]
    processing = check_eligibility(item(order_status="processing", delivered_at=None), customer(), "unopened", NOW)
    assert "is processing" in processing.reasons[0]


def test_eligibility_serializes() -> None:
    d = check_eligibility(item(), customer(), "unopened", NOW).to_dict()
    assert d["eligible"] is True
    assert d["window_days"] == 30
    assert d["days_since_delivery"] == 15
    assert d["overridable"] is False


# ---------------------------------------------------------------- returns


@pytest.mark.parametrize(
    ("label", "item_kw", "cust_kw", "history", "condition", "flags", "decision", "must_have"),
    [
        ("eligible return allowed", {}, {}, NO_HISTORY, "unopened", {}, "allow", R.R_AUTO_APPROVE),
        (
            "frequent refunder can still return",
            {},
            {"refunds_last_90d": 5},
            NO_HISTORY,
            "unopened",
            {},
            "allow",
            R.R_AUTO_APPROVE,
        ),
        (
            "open return blocks another",
            {},
            {},
            ItemHistory(active_return=True),
            "unopened",
            {},
            "deny",
            R.R_RETURN_ONCE,
        ),
        (
            "refunded item can't be returned",
            {},
            {},
            ItemHistory(active_refund=True),
            "unopened",
            {},
            "deny",
            R.R_REFUND_ONCE,
        ),
        (
            "outside window denied",
            {"delivered_at": NOW - timedelta(days=40)},
            {},
            NO_HISTORY,
            "unopened",
            {},
            "deny",
            R.R_WINDOW,
        ),
        (
            "outside window with exception goes to a human",
            {"delivered_at": NOW - timedelta(days=40)},
            {},
            NO_HISTORY,
            "unopened",
            {"request_exception": True},
            "needs_approval",
            R.R_EXCEPTION,
        ),
        (
            "activated electronics claim needs a human",
            {"category": "electronics", "opened": True},
            {},
            NO_HISTORY,
            "unopened",
            {},
            "needs_approval",
            R.R_ELECTRONICS_CONFLICT,
        ),
        (
            "eligible return with exception flag goes to a human",
            {},
            {},
            NO_HISTORY,
            "unopened",
            {"request_exception": True},
            "needs_approval",
            R.R_EXCEPTION,
        ),
        (
            "low confidence return goes to a human",
            {},
            {},
            NO_HISTORY,
            "unopened",
            {"low_confidence": True},
            "needs_approval",
            R.R_LOW_CONFIDENCE,
        ),
        (
            "frequency removed but low confidence kept",
            {},
            {"refunds_last_90d": 4},
            NO_HISTORY,
            "unopened",
            {"low_confidence": True},
            "needs_approval",
            R.R_LOW_CONFIDENCE,
        ),
        (
            "processing order can't be returned",
            {"order_status": "processing", "delivered_at": None},
            {},
            NO_HISTORY,
            "unopened",
            {},
            "deny",
            R.R_ORDER_STATUS,
        ),
        (
            "other customer's item denied",
            {"owner_customer_id": "someone-else"},
            {},
            NO_HISTORY,
            "unopened",
            {},
            "deny",
            R.R_OWNER,
        ),
        ("final sale return denied", {"final_sale": True}, {}, NO_HISTORY, "unopened", {}, "deny", R.R_FINAL_SALE),
    ],
)
def test_return_table(label, item_kw, cust_kw, history, condition, flags, decision, must_have) -> None:  # type: ignore[no-untyped-def]
    result = evaluate_return(item(**item_kw), customer(**cust_kw), history, condition, NOW, **flags)
    assert result.decision == decision, (label, result)
    assert must_have in result.rule_ids, (label, result.rule_ids)


def test_frequency_rule_does_not_leak_into_return_decision() -> None:
    result = evaluate_return(item(), customer(refunds_last_90d=4), NO_HISTORY, "unopened", NOW, low_confidence=True)
    assert R.R_FREQUENCY not in result.rule_ids
    assert not any("refunds in the last 90 days" in r for r in result.reasons)
