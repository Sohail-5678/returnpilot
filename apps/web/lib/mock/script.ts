import type { Citation, ToolCall } from "@/lib/schemas";
import { policyCitation } from "./policies";
import type { MockCustomer, MockOrder, MockThread, Workspace } from "./types";

/**
 * Scripted "agent" for MOCK_BACKEND=true. Picks a turn plan from the persona, the
 * message text and what was already established in the thread, so the full demo
 * (tools → citation → approval) can be clicked through without the Python backend.
 */
export type TurnStep =
  | { type: "status"; stage: "thinking" | "routing" | "tools" | "writing"; label: string; wait?: number }
  | { type: "tool"; call: ToolCall; startedLabel: string }
  | { type: "say"; text: string; citations: Citation[] }
  | { type: "error"; code: string; message: string };

export interface ApprovalPlan {
  order: MockOrder;
  itemId: string;
  amount: number;
  reason: string;
  ruleIds: string[];
  summary: string;
  eligibility: string[];
  sections: string[];
}

export interface TurnPlan {
  title: string;
  route: string;
  steps: TurnStep[];
  approval?: ApprovalPlan;
  /** Creates a return with a label job that completes shortly after the turn. */
  createReturn?: { order: MockOrder; itemId: string; label: string };
  facts?: Partial<MockThread["facts"]>;
  memories?: number;
}

let callSeq = 0;
function tool(
  name: string,
  startedLabel: string,
  label: string,
  args: Record<string, unknown>,
  preview: string,
  ms: number,
  status: "ok" | "error" = "ok",
): TurnStep {
  callSeq += 1;
  return {
    type: "tool",
    startedLabel,
    call: {
      id: `call_${Date.now().toString(36)}${callSeq}`,
      name,
      label,
      status,
      duration_ms: ms,
      args,
      result_preview: preview,
    },
  };
}

const say = (text: string, ...sections: string[]): TurnStep => ({
  type: "say",
  text,
  citations: sections.map(policyCitation),
});
const status = (stage: "thinking" | "routing" | "tools" | "writing", label: string, wait?: number): TurnStep => ({
  type: "status",
  stage,
  label,
  wait,
});

function shortDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function daysSince(iso: string | null) {
  if (!iso) return 0;
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

function findOrder(ws: Workspace, customer: MockCustomer, n: number) {
  return ws.orders.find((o) => o.customer_id === customer.id && o.order_number === n) ?? null;
}

function openApprovalFor(ws: Workspace, itemId: string) {
  return [...ws.approvals.values()].find((a) => a.item_id === itemId && (a.status === "pending" || a.status === "approved")) ?? null;
}

const has = (t: string, re: RegExp) => re.test(t);
const AFFIRM = /\b(yes|yeah|yep|sure|ok(ay)?|go ahead|please do|do it|start (the )?return|sounds good)\b/;
const REFUND = /\b(refund|money back)\b/;

export function planTurn(ws: Workspace, customer: MockCustomer, thread: MockThread, rawText: string): TurnPlan {
  const t = rawText.toLowerCase();

  // Dev-only triggers to exercise error UI.
  if (t.trim() === "/quota") {
    return {
      title: "Quota test",
      route: "smalltalk",
      steps: [status("thinking", "Thinking…"), { type: "error", code: "quota_exhausted", message: "The demo's free AI quota for today is used up." }],
    };
  }
  if (t.trim() === "/error") {
    return {
      title: "Error test",
      route: "smalltalk",
      steps: [status("thinking", "Thinking…"), { type: "error", code: "internal", message: "Something went wrong on our side." }],
    };
  }

  // Shared intents
  if (has(t, /how long/) && has(t, /refund/)) return refundTiming();

  switch (customer.persona) {
    case "arjun":
      return planArjun(ws, customer, thread, t);
    case "lena":
      return planLena(ws, customer, thread, t);
    default:
      return planMaya(ws, customer, thread, t);
  }
}

function refundTiming(): TurnPlan {
  return {
    title: "Refund timing",
    route: "faq",
    steps: [
      status("thinking", "Thinking…"),
      tool("search_policy", "Reading the refunds policy", "Read policy: Refunds › Refund timeline", { query: "refund timeline" }, "§3.1 Refund timeline", 312),
      status("writing", "Writing a reply…"),
      say(
        "Refunds go back to your original payment method within **5–7 business days** after we receive the return [Policy §3.1]. Refunds over $50 are checked by a team member first, which usually takes a few minutes [Policy §3.4].",
        "§3.1",
        "§3.4",
      ),
    ],
  };
}

function fallback(t: string): TurnPlan {
  return {
    title: t.length > 40 ? `${t.slice(0, 38)}…` : t.charAt(0).toUpperCase() + t.slice(1),
    route: "faq",
    steps: [
      status("thinking", "Thinking…"),
      tool("search_policy", "Searching the store policy", "Read policy: Returns › Standard window", { query: t.slice(0, 80) }, "§2.1 Standard window · §4.1 Exchanges", 344),
      status("writing", "Writing a reply…"),
      say(
        "I can help with returns, refunds, exchanges and order questions for Northwind Outfitters. Most items can be returned within **30 days of delivery** [Policy §2.1], and unused items can be exchanged for another size [Policy §4.1]. Which order is this about?",
        "§2.1",
        "§4.1",
      ),
    ],
  };
}

/* ------------------------------ Maya ------------------------------ */
function planMaya(ws: Workspace, c: MockCustomer, thread: MockThread, t: string): TurnPlan {
  const o1042 = findOrder(ws, c, 1042)!;
  const boots = o1042.items[0]!;
  const o1057 = findOrder(ws, c, 1057)!;

  if (has(t, /shipping pref|preference|usual|drop[- ]?off/)) {
    const mem = ws.memories.find((m) => m.customer_id === c.id && /drop-off/i.test(m.content));
    return {
      title: "Shipping preference",
      route: "return",
      memories: mem ? 1 : 0,
      steps: [
        status("thinking", "Thinking…"),
        tool(
          "recall_memories",
          "Checking what I remember about you",
          mem ? "Recalled your return preference" : "Checked saved preferences",
          { query: "shipping preference for returns" },
          mem ? `1 match · "${mem.content}"` : "0 matches",
          226,
        ),
        status("writing", "Writing a reply…"),
        mem
          ? say(
              "You prefer **store drop-off** for returns, so I'll use that — it's free at any partner store [Policy §2.3]. I'll attach a drop-off label to your next return.",
              "§2.3",
            )
          : say(
              "I don't have a saved shipping preference for you. Would you like **store drop-off** (free) or a **carrier pickup** ($6.00) [Policy §2.3]? I can remember your choice for next time.",
              "§2.3",
            ),
      ],
    };
  }

  const bootsMentioned = has(t, /boot|trail|last order|#?1042/);
  const wantsRefund = has(t, REFUND) || has(t, AFFIRM);

  if ((bootsMentioned || (wantsRefund && thread.facts.checkedBoots)) && boots.refund_status === "issued") {
    return {
      title: "Boots refund",
      route: "refund",
      steps: [
        status("tools", "Checking your order…"),
        tool("get_order", "Opening order #1042", "Opened order #1042", { order_id: "1042" }, "#1042 · boots refund issued", 231),
        status("writing", "Writing a reply…"),
        say("Your refund for the **Trail Runner Boots** has already been issued, and an item can only be refunded once [Policy §3.3]. It usually shows up within 5–7 business days [Policy §3.1].", "§3.3", "§3.1"),
      ],
    };
  }

  const existing = openApprovalFor(ws, boots.id);
  if ((bootsMentioned || wantsRefund) && existing?.status === "pending") {
    return {
      title: "Boots return",
      route: "refund",
      steps: [
        status("tools", "Checking your request…"),
        tool("get_order", "Opening order #1042", "Opened order #1042", { order_id: "1042" }, "#1042 · refund pending approval", 204),
        status("writing", "Writing a reply…"),
        say(`Your refund of **$${existing.amount.toFixed(2)}** for the Trail Runner Boots is still waiting for a team member. I'll update you here as soon as it's decided.`),
      ],
    };
  }

  const eligibilityTools: TurnStep[] = [
    status("tools", "Checking your orders…"),
    tool("list_orders", "Looking up your orders", "Looked up your orders", { limit: 5 }, "3 orders · latest delivered: #1042", 284),
    tool("get_order", "Opening order #1042", "Opened order #1042", { order_id: "1042" }, `#1042 · delivered ${shortDate(o1042.delivered_at)} · 2 items`, 242),
    tool(
      "check_return_eligibility",
      "Checking return eligibility (#1042)",
      "Checked return eligibility (#1042)",
      { order_item_id: boots.id, item_condition: "unopened" },
      `eligible · ${daysSince(o1042.delivered_at)} days since delivery · R-WINDOW-30`,
      198,
    ),
    tool("search_policy", "Reading the returns policy", "Read policy: Returns › 30-day window", { query: "return window footwear" }, "§2.1 Standard window", 318),
  ];

  const approval: ApprovalPlan = {
    order: o1042,
    itemId: boots.id,
    amount: 129,
    reason: "Amount is over the $50 auto-approve limit",
    ruleIds: ["R-AMOUNT-50"],
    summary: "Customer asked to return unopened Trail Runner Boots 15 days after delivery. Eligible under the 30-day window; refund of the full item price is over the auto-approve limit.",
    eligibility: [`Delivered ${daysSince(o1042.delivered_at)} days ago — within the 30-day window`, "Customer says the boots are unopened"],
    sections: ["§2.1", "§3.4"],
  };
  const refundTools: TurnStep[] = [
    status("tools", "Starting your return…"),
    tool(
      "create_return",
      "Starting a return for the boots",
      "Started a return for Trail Runner Boots",
      { order_item_id: boots.id, reason: "changed_mind", item_condition: "unopened" },
      "proposal · allow · store drop-off label",
      236,
    ),
    tool(
      "issue_refund",
      "Requesting a $129.00 refund",
      "Requested a $129.00 refund — needs approval",
      { order_item_id: boots.id, amount: 129, reason: "return_within_window" },
      "proposal · needs_approval · R-AMOUNT-50",
      174,
    ),
  ];
  const createReturn = { order: o1042, itemId: boots.id, label: "Return · Trail Runner Boots (store drop-off)" };

  if (wantsRefund && (thread.facts.checkedBoots || bootsMentioned)) {
    const already = thread.facts.checkedBoots;
    return {
      title: "Boots return",
      route: "refund",
      approval,
      createReturn,
      facts: { checkedBoots: true },
      memories: 1,
      steps: [
        status("thinking", "Thinking…"),
        ...(already ? [] : eligibilityTools),
        ...refundTools,
        status("writing", "Writing a reply…"),
        already
          ? say(
              "Done — I've started your return with a prepaid **store drop-off** label (your usual preference). I've sent this refund to a team member for approval because it's over $50. I'll update you here.",
            )
          : say(
              "Your **Trail Runner Boots** (order #1042) are within the 30-day return window [Policy §2.1], so I've started the return with a prepaid **store drop-off** label. I've sent this refund to a team member for approval because it's over $50. I'll update you here.",
              "§2.1",
            ),
      ],
    };
  }

  if (bootsMentioned || has(t, /\breturn/)) {
    return {
      title: "Boots return",
      route: "return",
      facts: { checkedBoots: true },
      memories: 1,
      steps: [
        status("thinking", "Thinking…", 450),
        say("Let me pull up your recent orders."),
        ...eligibilityTools,
        status("writing", "Writing a reply…"),
        say(
          `Yes — the **Trail Runner Boots** from order #1042 (delivered ${shortDate(o1042.delivered_at)}) are within the 30-day return window [Policy §2.1]. If they're unused, you'd get a full refund of **$129.00** to your original payment method. Want me to start the return and request the refund?`,
          "§2.1",
        ),
      ],
    };
  }

  if (has(t, /rain|shell|where|track|arriv|ship|status/)) {
    return {
      title: "Rain shell delivery",
      route: "order_lookup",
      steps: [
        status("tools", "Checking your orders…"),
        tool("list_orders", "Looking up your orders", "Looked up your orders", { limit: 5 }, "3 orders · latest #1057 (shipped)", 271),
        tool("get_order", "Opening order #1057", "Opened order #1057", { order_id: "1057" }, "#1057 · shipped · 1 item", 233),
        status("writing", "Writing a reply…"),
        say(
          `Your **Packable Rain Shell** (order #${o1057.order_number}) shipped and is on its way — the carrier estimates delivery in 2–3 business days. I'll let you know here if anything changes.`,
        ),
      ],
    };
  }

  return fallback(t);
}

/* ------------------------------ Arjun ------------------------------ */
function planArjun(ws: Workspace, c: MockCustomer, _thread: MockThread, t: string): TurnPlan {
  const mugOrder = findOrder(ws, c, 1049)!;
  const mug = mugOrder.items[0]!;
  const shirtOrder = findOrder(ws, c, 1031)!;
  const headOrder = findOrder(ws, c, 1036)!;

  if (has(t, /mug|broken|damag|crack|chip|shatter/)) {
    const existing = openApprovalFor(ws, mug.id);
    if (existing) {
      return {
        title: "Broken mug set",
        route: "refund",
        steps: [
          status("tools", "Checking your request…"),
          tool("get_order", "Opening order #1049", "Opened order #1049", { order_id: "1049" }, `#1049 · refund ${existing.status === "pending" ? "pending approval" : "approved"}`, 210),
          say(existing.status === "pending"
            ? `Your refund of **$${existing.amount.toFixed(2)}** for the mug set is waiting for a team member. I'll update you here.`
            : "Your refund for the mug set was approved and is being processed."),
        ],
      };
    }
    return {
      title: "Broken mug set",
      route: "refund",
      memories: 1,
      approval: {
        order: mugOrder,
        itemId: mug.id,
        amount: 64,
        reason: "Amount is over the $50 auto-approve limit",
        ruleIds: ["R-AMOUNT-50", "R-DAMAGED-60"],
        summary: "Customer reports the Stoneware Mug Set arrived broken 5 days after delivery. Damaged items are always eligible; refund is over the auto-approve limit.",
        eligibility: ["Damaged on arrival — eligible within 60 days", `Delivered ${daysSince(mugOrder.delivered_at)} days ago`],
        sections: ["§4.2", "§3.4"],
      },
      steps: [
        status("thinking", "Thinking…"),
        status("tools", "Checking your orders…"),
        tool("list_orders", "Looking up your orders", "Looked up your orders", { limit: 5 }, "4 orders · #1049 delivered recently", 262),
        tool("get_order", "Opening order #1049", "Opened order #1049", { order_id: "1049" }, `#1049 · delivered ${shortDate(mugOrder.delivered_at)} · Stoneware Mug Set (4)`, 219),
        tool("check_return_eligibility", "Checking eligibility for a damaged item", "Checked eligibility (#1049, damaged)", { order_item_id: mug.id, item_condition: "damaged" }, "eligible · damaged · R-DAMAGED-60", 187),
        tool("issue_refund", "Requesting a $64.00 refund", "Requested a $64.00 refund — needs approval", { order_item_id: mug.id, amount: 64, reason: "damaged" }, "proposal · needs_approval · R-AMOUNT-50", 166),
        status("writing", "Writing a reply…"),
        say(
          "I'm sorry the mug set arrived broken. Damaged items are always eligible [Policy §4.2], so I've requested a full refund of **$64.00** — no need to send it back. I've sent this refund to a team member for approval because it's over $50. I'll update you here.",
          "§4.2",
        ),
      ],
    };
  }

  if (has(t, /shirt|linen|final/)) {
    return {
      title: "Final-sale shirt",
      route: "return",
      steps: [
        status("tools", "Checking your order…"),
        tool("get_order", "Opening order #1031", "Opened order #1031", { order_id: "1031" }, "#1031 · Linen Camp Shirt · final sale", 228),
        tool("check_return_eligibility", "Checking return eligibility (#1031)", "Checked return eligibility (#1031)", { order_item_id: shirtOrder.items[0]!.id, item_condition: "opened" }, "not eligible · R-FINAL-SALE", 176),
        tool("search_policy", "Reading the final-sale policy", "Read policy: Final sale items", { query: "final sale returns" }, "§5.1 Final sale items", 301),
        status("writing", "Writing a reply…"),
        say(
          "I'm sorry — the **Linen Camp Shirt** (order #1031) was marked final sale, so it can't be returned or refunded [Policy §5.1]. If it arrived damaged, I can set up an exchange instead [Policy §4.2].",
          "§5.1",
          "§4.2",
        ),
      ],
    };
  }

  if (has(t, /headphone|electronic|opened/)) {
    return {
      title: "Headphones return",
      route: "return",
      steps: [
        status("tools", "Checking your order…"),
        tool("get_order", "Opening order #1036", "Opened order #1036", { order_id: "1036" }, "#1036 · Noise-Cancelling Headphones · opened", 236),
        tool("check_return_eligibility", "Checking return eligibility (#1036)", "Checked return eligibility (#1036)", { order_item_id: headOrder.items[0]!.id, item_condition: "opened" }, "not eligible · R-ELECTRONICS-OPENED", 181),
        tool("search_policy", "Reading the electronics policy", "Read policy: Electronics › Opened electronics", { query: "opened electronics" }, "§6.1 Opened electronics", 296),
        status("writing", "Writing a reply…"),
        say(
          "Because the headphones have been opened, they can't be returned unless they're defective [Policy §6.1]. If something isn't working, tell me what's happening and I'll open a warranty ticket for you.",
          "§6.1",
        ),
      ],
    };
  }

  if (has(t, /window|how long|days/)) {
    return {
      title: "Return window",
      route: "faq",
      steps: [
        status("thinking", "Thinking…"),
        tool("search_policy", "Reading the returns policy", "Read policy: Returns › Loyalty tiers", { query: "return window gold tier" }, "§2.2 Loyalty tiers", 288),
        status("writing", "Writing a reply…"),
        say("As a **Gold** member you have **60 days** from delivery to return most items [Policy §2.2]. Final-sale items are the exception [Policy §5.1].", "§2.2", "§5.1"),
      ],
    };
  }

  return fallback(t);
}

/* ------------------------------ Lena ------------------------------ */
function planLena(ws: Workspace, c: MockCustomer, _thread: MockThread, t: string): TurnPlan {
  const scarfOrder = findOrder(ws, c, 1012)!;
  const o1044 = findOrder(ws, c, 1044)!;
  const beanie = o1044.items[0]!;

  if (has(t, /scarf|cashmere/)) {
    return {
      title: "Scarf refund",
      route: "refund",
      steps: [
        status("tools", "Checking your order…"),
        tool("get_order", "Opening order #1012", "Opened order #1012", { order_id: "1012" }, "#1012 · Cashmere Scarf · refund issued", 233),
        tool("check_return_eligibility", "Checking refund eligibility (#1012)", "Checked refund eligibility (#1012)", { order_item_id: scarfOrder.items[0]!.id, item_condition: "opened" }, "not eligible · R-REFUNDED-ONCE", 172),
        tool("search_policy", "Reading the refunds policy", "Read policy: Refunds › Items already refunded", { query: "refund same item twice" }, "§3.3 Items already refunded", 284),
        status("writing", "Writing a reply…"),
        say(
          "The **Cashmere Scarf** from order #1012 was already refunded, and an item can only be refunded once [Policy §3.3]. I can help with an exchange or store credit on another item instead.",
          "§3.3",
        ),
      ],
    };
  }

  if (has(t, /beanie|wallet|return/) && !has(t, /how do|international|work/)) {
    const existing = openApprovalFor(ws, beanie.id);
    if (existing) {
      return {
        title: "Beanie return",
        route: "refund",
        steps: [
          status("tools", "Checking your request…"),
          tool("get_order", "Opening order #1044", "Opened order #1044", { order_id: "1044" }, "#1044 · refund pending approval", 207),
          say(`Your refund of **$${existing.amount.toFixed(2)}** for the beanie is waiting for a team member. I'll update you here.`),
        ],
      };
    }
    return {
      title: "Beanie return",
      route: "refund",
      approval: {
        order: o1044,
        itemId: beanie.id,
        amount: 28,
        reason: "Customer has 3 refunds in the last 90 days",
        ruleIds: ["R-FREQ-3", "R-INTL-SHIPPING"],
        summary: "International customer (DE) returning an unused wool beanie 9 days after delivery. Eligible; the account has 3 refunds in 90 days, so a review is required. Original shipping excluded.",
        eligibility: [`Delivered ${daysSince(o1044.delivered_at)} days ago — within the 30-day window`, "International order: refund excludes original shipping"],
        sections: ["§2.1", "§7.1", "§3.4"],
      },
      createReturn: { order: o1044, itemId: beanie.id, label: "Return · Wool Beanie (international)" },
      steps: [
        status("thinking", "Thinking…"),
        status("tools", "Checking your order…"),
        tool("get_order", "Opening order #1044", "Opened order #1044", { order_id: "1044" }, `#1044 · delivered ${shortDate(o1044.delivered_at)} · 2 items · DE`, 238),
        tool("check_return_eligibility", "Checking return eligibility (#1044)", "Checked return eligibility (#1044)", { order_item_id: beanie.id, item_condition: "unopened" }, "eligible · R-WINDOW-30 · R-INTL-SHIPPING", 191),
        tool("create_return", "Starting a return for the beanie", "Started a return for Wool Beanie", { order_item_id: beanie.id, reason: "changed_mind", item_condition: "unopened" }, "proposal · allow · international label", 222),
        tool("issue_refund", "Requesting a $28.00 refund", "Requested a $28.00 refund — needs approval", { order_item_id: beanie.id, amount: 28, reason: "return_within_window" }, "proposal · needs_approval · R-FREQ-3", 168),
        status("writing", "Writing a reply…"),
        say(
          "The **Wool Beanie** (order #1044) is within the return window [Policy §2.1]. Because it's an international order, return shipping isn't free and the refund excludes the original shipping [Policy §7.1]. There have been 3 refunds on your account in the last 90 days, so I've sent this refund to a team member for approval. I'll update you here.",
          "§2.1",
          "§7.1",
        ),
      ],
    };
  }

  if (has(t, /international|germany|abroad|ship(ping)? back|work/)) {
    return {
      title: "International returns",
      route: "faq",
      steps: [
        status("thinking", "Thinking…"),
        tool("search_policy", "Reading the international policy", "Read policy: International returns", { query: "international returns shipping" }, "§7.1 International returns", 301),
        status("writing", "Writing a reply…"),
        say(
          "- You can return items from Germany within the normal window [Policy §2.1].\n- Return shipping isn't free for international orders.\n- The refund doesn't include the original shipping cost [Policy §7.1].",
          "§2.1",
          "§7.1",
        ),
      ],
    };
  }

  return fallback(t);
}
