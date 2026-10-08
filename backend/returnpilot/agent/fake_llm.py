"""Scripted chat model for offline development, deterministic tests and e2e runs (FAKE_LLM=true).

It plays a *naive but competent* support model: it follows the obvious tool path for returns,
refunds and policy questions, and it does whatever the customer asks (including "refund me
$500"). That is deliberate: the deterministic test tier proves the policy engine and the
approval gate, not the model's good manners, stop unauthorized actions.
"""

from __future__ import annotations

import json
import re
import uuid
from datetime import date
from typing import Any

from langchain_core.callbacks import AsyncCallbackManagerForLLMRun, CallbackManagerForLLMRun
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult

ITEM_WORDS = [
    "boots",
    "socks",
    "jacket",
    "headphones",
    "shirt",
    "mug",
    "cups",
    "lamp",
    "scarf",
    "beanie",
    "tee",
    "earbuds",
    "watch",
    "bottle",
    "tote",
    "sneakers",
    "vest",
    "hoodie",
]
YES = re.compile(r"\b(yes|yeah|yep|sure|please do|go ahead|do it|refund me|start (it|the return)|sounds good)\b", re.I)
REFUND = re.compile(r"\b(refund|money back)\b", re.I)
REFUND_REQ = re.compile(
    r"\b(refund me|refund (it|them|please)|want (a|my) refund|give me (a|my) refund|money back|i want (a )?refund)\b",
    re.I,
)
POLICY_Q = re.compile(
    r"\b(policy|how long|how many days|when will|show up|who pays|return shipping|window|final sale|international|gift|electronics|exchange|ship(ping)? back)\b",
    re.I,
)
ORDER_NO = re.compile(r"#\s?(\d{4})\b|\border\s+(?:number\s+)?(\d{4})\b", re.I)
AMOUNT = re.compile(r"\$\s?(\d+(?:\.\d{1,2})?)")


def _text(m: BaseMessage) -> str:
    return (
        m.content
        if isinstance(m.content, str)
        else "".join(b.get("text", "") for b in m.content if isinstance(b, dict))
    )


def _json(m: BaseMessage) -> dict[str, Any]:
    try:
        data = json.loads(_text(m))
        return data if isinstance(data, dict) else {}
    except ValueError:
        return {}


def _condition(text: str) -> str:
    t = text.lower()
    if re.search(r"\b(damaged|broken|cracked|defective|faulty|arrived broken)\b", t):
        return "damaged"
    if re.search(r"\bwrong (item|size sent|product)\b|\bnot what i ordered\b", t):
        return "wrong_item"
    if re.search(r"\b(opened|used|worn|tried (it|them) on)\b", t) and "unopened" not in t:
        return "opened"
    return "unopened"


def _md(iso: str | None) -> str:
    if not iso:
        return "recently"
    d = date.fromisoformat(iso[:10])
    return d.strftime("%b %d").replace(" 0", " ")


class FakeAgentModel(BaseChatModel):
    task: str = "main"
    bound: list[str] = []
    down: bool = False

    @property
    def _llm_type(self) -> str:
        return "fake-agent"

    def bind_tools(self, tools: Any, **kwargs: Any) -> Any:  # type: ignore[override]
        return self.model_copy(update={"bound": [getattr(t, "name", str(t)) for t in tools]})

    def _generate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: CallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        if self.down:
            raise RuntimeError("503 Service Unavailable (simulated provider outage)")
        ai = self._decide(messages)
        chars = sum(len(_text(m)) for m in messages)
        ai.usage_metadata = {
            "input_tokens": chars // 4,
            "output_tokens": max(1, len(_text(ai)) // 4),
            "total_tokens": chars // 4 + 1,
        }
        return ChatResult(generations=[ChatGeneration(message=ai)])

    async def _agenerate(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager: AsyncCallbackManagerForLLMRun | None = None,
        **kwargs: Any,
    ) -> ChatResult:
        return self._generate(messages, stop, None, **kwargs)

    # ------------------------------------------------------------------ decisions

    def _decide(self, messages: list[BaseMessage]) -> AIMessage:
        system = next((_text(m) for m in messages if isinstance(m, SystemMessage)), "")
        if "Summarize this support conversation" in system:
            return AIMessage(content="Customer discussed returns and refunds for recent orders.")
        if '"memories"' in system:
            return AIMessage(content=json.dumps({"memories": []}))
        if self.task == "small" or '"route"' in system:  # router (its prompt lives in the agent profile)
            from returnpilot.agent.nodes.context import keyword_route

            return AIMessage(content=json.dumps({"route": keyword_route(_text(messages[-1]))}))
        if "Your previous reply had problems" in system:
            return AIMessage(
                content="Here's what I found in your order details. Is there anything specific you'd like me to check?"
            )

        convo = [m for m in messages if not isinstance(m, SystemMessage)]
        last_human_idx = max((i for i, m in enumerate(convo) if isinstance(m, HumanMessage)), default=-1)
        user = _text(convo[last_human_idx]) if last_human_idx >= 0 else ""
        turn = convo[last_human_idx + 1 :]
        tool_results = [m for m in turn if isinstance(m, ToolMessage)]
        if not tool_results:
            return self._on_user(user, convo, system)
        return self._on_tools(user, tool_results, convo, system)

    def _call(self, name: str, **args: Any) -> AIMessage:
        return AIMessage(
            content="",
            tool_calls=[{"name": name, "args": args, "id": f"call_{uuid.uuid4().hex[:10]}", "type": "tool_call"}],
        )

    def _last_eligibility(self, convo: list[BaseMessage]) -> dict[str, Any] | None:
        for m in reversed(convo):
            if isinstance(m, ToolMessage) and m.name == "check_return_eligibility":
                data = _json(m)
                if data.get("order_item_id"):
                    return data
        return None

    def _on_user(self, user: str, convo: list[BaseMessage], system: str) -> AIMessage:
        t = user.lower()
        if re.search(r"\b(usual|preference|prefer|remember|like last time)\b", t):
            mems = re.findall(r"^- (.+)$", system.split("What you remember")[-1], re.M)
            mems = [m for m in mems if "nothing yet" not in m]
            if mems:
                words = set(re.findall(r"[a-z]+", t)) | (
                    {"drop", "store", "return"} if re.search(r"ship|deliver|send", t) else set()
                )
                best = max(mems, key=lambda m: len(words & set(re.findall(r"[a-z]+", m.lower()))))
                return AIMessage(
                    content=f"Got it — I have that you {best[0].lower() + best[1:]}. I'll use that for this return."
                )
            return AIMessage(
                content="I don't have a saved preference for that yet. How would you like to send it back: store drop-off or mail?"
            )
        injected = AMOUNT.search(user)
        elig = self._last_eligibility(convo)
        if elig and (YES.search(user) or REFUND_REQ.search(user) or injected):
            amount = float(injected.group(1)) if injected else float(elig.get("max_refund") or 0)
            reason = "damaged_item" if _condition(user) == "damaged" else "return_within_window"
            if REFUND.search(user) or injected:
                return self._call(
                    "issue_refund",
                    order_item_id=elig["order_item_id"],
                    amount=amount,
                    reason=reason,
                    item_condition=_condition(user),
                    request_exception="exception" in user.lower(),
                )
            return self._call(
                "create_return", order_item_id=elig["order_item_id"], reason="changed_mind", item_condition="unopened"
            )
        m = ORDER_NO.search(user)
        if m:
            return self._call("get_order", order_id=m.group(1) or m.group(2))
        mentions_item = any(w in t for w in ITEM_WORDS) or re.search(r"\b(last order|my order|orders?)\b", t)
        if POLICY_Q.search(t) and not mentions_item:
            return self._call("search_policy", query=user[:200])
        if mentions_item or re.search(r"\b(return|refund)\b", t):
            return self._call("list_orders", limit=5)
        if re.search(r"\b(hi|hello|hey|thanks|thank you)\b", t):
            return AIMessage(
                content="Happy to help! I can check orders, explain our return policy, and start returns or refunds. What can I do for you?"
            )
        return AIMessage(
            content="I can help with returns, refunds and order questions. Which order or item is this about?"
        )

    def _on_tools(self, user: str, results: list[ToolMessage], convo: list[BaseMessage], system: str) -> AIMessage:
        last = results[-1]
        data = _json(last)
        if last.status == "error" or "error" in data:
            if last.name == "get_order":
                m = ORDER_NO.search(user)
                num = (m.group(1) or m.group(2)) if m else "that order"
                return AIMessage(
                    content=f"I couldn't find order #{num} on your account. Could you double-check the number? I can list your recent orders too."
                )
            return AIMessage(content="Something went wrong looking that up. Could you tell me the order number?")
        t = user.lower()
        if last.name == "list_orders":
            orders = data.get("orders", [])
            target = next(
                (
                    o
                    for o in orders
                    if any(w in t and w.rstrip("s") in " ".join(o["items"]).lower() for w in ITEM_WORDS)
                ),
                None,
            )
            target = target or next((o for o in orders if o["status"] == "delivered"), orders[0] if orders else None)
            if not target:
                return AIMessage(content="I don't see any orders on your account yet.")
            return self._call("get_order", order_id=str(target["order_number"]))
        if last.name == "get_order":
            items = data.get("items", [])
            word = next((w for w in ITEM_WORDS if w in t), None)
            item = next((i for i in items if word and word.rstrip("s") in i["name"].lower()), None) or (
                items[0] if items else None
            )
            if not item:
                return AIMessage(content=f"Order #{data.get('order_number')} has no items I can return.")
            if not re.search(r"\b(return|refund|send|money back|exchange|broken|damaged)\b", t):
                names = ", ".join(i["name"] for i in items)
                return AIMessage(
                    content=f"Order #{data['order_number']} is {data['status']} ({names}), total ${data['total']:.2f}."
                )
            return self._call(
                "check_return_eligibility", order_item_id=item["order_item_id"], item_condition=_condition(user)
            )
        if last.name == "check_return_eligibility":
            if REFUND.search(user) or AMOUNT.search(user):
                injected = AMOUNT.search(user)
                amount = float(injected.group(1)) if injected else float(data.get("max_refund") or 0)
                return self._call(
                    "issue_refund",
                    order_item_id=data["order_item_id"],
                    amount=amount,
                    reason="damaged_item" if _condition(user) == "damaged" else "return_within_window",
                    item_condition=_condition(user),
                    request_exception="exception" in user.lower(),
                )
            rules = data.get("rule_ids", [])
            topic = (
                "gold member return window"
                if "R-WINDOW-GOLD" in rules
                else "damaged or wrong item"
                if "R-DAMAGED" in rules
                else "final sale items"
                if "R-FINAL-SALE" in rules
                else "opened electronics returns"
                if "R-ELECTRONICS" in rules
                else "standard return window 30 days"
            )
            return self._call("search_policy", query=topic)
        if last.name == "search_policy":
            sections = data.get("sections", [])
            elig = self._last_eligibility(convo)
            if elig and any(
                isinstance(m, ToolMessage) and m.name == "check_return_eligibility" for m in results + convo[-6:]
            ):
                rules = elig.get("rule_ids", [])
                want = (
                    "§2.2"
                    if "R-WINDOW-GOLD" in rules
                    else "§5.1"
                    if "R-DAMAGED" in rules
                    else "§6.1"
                    if "R-FINAL-SALE" in rules
                    else "§7.2"
                    if "R-ELECTRONICS" in rules and not elig.get("eligible")
                    else "§2.1"
                )
                cite = (
                    want
                    if any(s["section_id"] == want for s in sections)
                    else (sections[0]["section_id"] if sections else None)
                )
                order = next(
                    (_json(m) for m in reversed(convo) if isinstance(m, ToolMessage) and m.name == "get_order"), {}
                )
                when = _md(order.get("delivered_at"))
                c = f" [Policy {cite}]" if cite else ""
                if elig.get("eligible"):
                    return AIMessage(
                        content=f"Yes — the {elig['item']} from order #{elig['order_number']} (delivered {when}) can be returned{c}. "
                        f"The most I can refund is ${elig['max_refund']:.2f}. Want me to start the return?"
                    )
                reason = (elig.get("reasons") or ["it isn't eligible under our policy."])[-1]
                return AIMessage(
                    content=f"I'm sorry — the {elig['item']} from order #{elig['order_number']} can't be returned: {reason}{c} "
                    "I can open a ticket for a team member if you'd like."
                )
            if not sections:
                return AIMessage(
                    content="I couldn't find that in our policy. Would you like me to connect you with a team member?"
                )
            top = sections[0]
            statements = [x for x in re.split(r"(?<=[.!?])\s", top["text"].strip()) if not x.endswith("?")]
            first = " ".join(statements[:2])
            return AIMessage(content=f"{first} [Policy {top['section_id']}]")
        if last.name in ("issue_refund", "create_return"):
            outcome = data.get("outcome") or {}
            what = "refund" if last.name == "issue_refund" else "return"
            if data.get("decision") == "allow":
                amt = f" of ${data['amount']:.2f}" if data.get("amount") else ""
                return AIMessage(
                    content=f"Done — your {what}{amt} for the {data.get('item')} is confirmed. {outcome.get('return_label', '')}".strip()
                )
            if data.get("decision") == "deferred":
                return AIMessage(
                    content=f"There's already a request waiting for a team member, so I'll handle this {what} once that's decided."
                )
            reason = (data.get("reasons") or ["it isn't allowed under our policy."])[0]
            return AIMessage(
                content=f"I'm sorry, I can't do that {what}: {reason} Would you like me to open a ticket for a team member?"
            )
        if last.name in ("create_ticket", "escalate_to_human"):
            return AIMessage(
                content="I've opened a ticket for our support team. A team member will reply by email within one business day."
            )
        return AIMessage(content="Is there anything else I can help with?")
