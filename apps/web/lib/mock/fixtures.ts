import type { Message, OrderItem } from "@/lib/schemas";
import { policyCitation } from "./policies";
import { buildRun, closing, MODEL_FALLBACK, MODEL_SMALL, preamble } from "./runs";
import type {
  MockApproval,
  MockCustomer,
  MockMemory,
  MockOrder,
  MockRun,
  MockThread,
  Workspace,
} from "./types";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const id = () => crypto.randomUUID();

function item(p: Partial<OrderItem> & Pick<OrderItem, "sku" | "name" | "category" | "unit_price">): OrderItem {
  return {
    id: id(),
    qty: 1,
    discount: 0,
    final_sale: false,
    opened: null,
    return_status: null,
    refund_status: null,
    ...p,
  };
}

function orderTotal(items: OrderItem[], shipping: number) {
  return Math.round((items.reduce((a, i) => a + i.unit_price * i.qty - i.discount, 0) + shipping) * 100) / 100;
}

export function createWorkspace(wsId: string): Workspace {
  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  const isoIn = (msAhead: number) => new Date(now + msAhead).toISOString();

  /* ---------------- Customers ---------------- */
  const maya: MockCustomer = {
    id: id(),
    persona: "maya",
    name: "Maya Patel",
    short: "Maya P.",
    email: "maya.patel@example.com",
    loyalty_tier: "standard",
    shipping_pref: "store_dropoff",
    country: "US",
    refunds_90d: 0,
  };
  const arjun: MockCustomer = {
    id: id(),
    persona: "arjun",
    name: "Arjun Mehta",
    short: "Arjun M.",
    email: "arjun.mehta@example.com",
    loyalty_tier: "gold",
    shipping_pref: "carrier_pickup",
    country: "US",
    refunds_90d: 1,
  };
  const lena: MockCustomer = {
    id: id(),
    persona: "lena",
    name: "Lena Fischer",
    short: "Lena F.",
    email: "lena.fischer@example.com",
    loyalty_tier: "standard",
    shipping_pref: "store_dropoff",
    country: "DE",
    refunds_90d: 3,
  };
  const others: MockCustomer[] = [
    ["Jordan Kim", "Jordan K."],
    ["Sam Rivera", "Sam R."],
    ["Priya Shah", "Priya S."],
    ["Diego Alvarez", "Diego A."],
    ["Mei Tanaka", "Mei T."],
  ].map(([name, short]) => ({
    id: id(),
    persona: null,
    name: name!,
    short: short!,
    email: `${name!.toLowerCase().replace(/\s+/g, ".")}@example.com`,
    loyalty_tier: "standard",
    shipping_pref: "store_dropoff",
    country: "US",
    refunds_90d: name === "Sam Rivera" ? 3 : 0,
  }));
  const [jordan, sam, priya, diego, mei] = others as [MockCustomer, MockCustomer, MockCustomer, MockCustomer, MockCustomer];

  /* ---------------- Orders ---------------- */
  const mk = (
    customer: MockCustomer,
    order_number: number,
    status: MockOrder["status"],
    placedAgo: number,
    deliveredAgo: number | null,
    items: OrderItem[],
    shipping = 6,
    country = customer.country,
  ): MockOrder => ({
    id: id(),
    order_number,
    customer_id: customer.id,
    status,
    placed_at: iso(placedAgo),
    delivered_at: deliveredAgo === null ? null : iso(deliveredAgo),
    shipping_country: country,
    shipping_cost: shipping,
    total: orderTotal(items, shipping),
    customer_note: null,
    items,
  });

  const orders: MockOrder[] = [
    // Maya
    mk(maya, 1042, "delivered", 19 * DAY, 15 * DAY, [
      item({ sku: "FW-TRAIL-01", name: "Trail Runner Boots", category: "footwear", unit_price: 129 }),
      item({ sku: "AP-SOCK-02", name: "Merino Hiking Socks (2-pack)", category: "apparel", unit_price: 18 }),
    ]),
    mk(maya, 1057, "shipped", 4 * DAY, null, [
      item({ sku: "AP-RAIN-07", name: "Packable Rain Shell", category: "apparel", unit_price: 89 }),
    ]),
    mk(maya, 988, "delivered", 68 * DAY, 63 * DAY, [
      item({ sku: "HM-BOTL-03", name: "Insulated Water Bottle", category: "home", unit_price: 32 }),
    ]),
    // Arjun
    mk(arjun, 1031, "delivered", 25 * DAY, 20 * DAY, [
      item({ sku: "AP-LINEN-11", name: "Linen Camp Shirt", category: "apparel", unit_price: 42, final_sale: true }),
    ]),
    mk(arjun, 1036, "delivered", 16 * DAY, 12 * DAY, [
      item({ sku: "EL-ANC-200", name: "Noise-Cancelling Headphones", category: "electronics", unit_price: 199, opened: true }),
    ]),
    mk(arjun, 1049, "delivered", 8 * DAY, 5 * DAY, [
      item({ sku: "HM-MUG-04", name: "Stoneware Mug Set (4)", category: "home", unit_price: 64 }),
    ]),
    mk(arjun, 1061, "processing", 1 * DAY, null, [
      item({ sku: "FW-SLIP-05", name: "Wool Slippers", category: "footwear", unit_price: 54 }),
    ]),
    // Lena (international)
    mk(lena, 1012, "delivered", 46 * DAY, 40 * DAY, [
      item({ sku: "AP-SCRF-09", name: "Cashmere Scarf", category: "apparel", unit_price: 79, refund_status: "issued", return_status: "received" }),
    ], 14),
    mk(lena, 1044, "delivered", 14 * DAY, 9 * DAY, [
      item({ sku: "AP-BEAN-12", name: "Wool Beanie", category: "apparel", unit_price: 28 }),
      item({ sku: "AC-WALL-02", name: "Leather Card Wallet", category: "home", unit_price: 45 }),
    ], 14),
    // Others (review-queue context)
    mk(jordan, 1038, "delivered", 15 * DAY, 11 * DAY, [
      item({ sku: "AP-FLCE-03", name: "Alpine Fleece Jacket", category: "apparel", unit_price: 89, return_status: "requested", refund_status: "pending_approval" }),
    ]),
    mk(sam, 1029, "delivered", 22 * DAY, 18 * DAY, [
      item({ sku: "HM-WKND-01", name: "Canvas Weekender Bag", category: "home", unit_price: 46, return_status: "requested", refund_status: "pending_approval" }),
    ]),
    mk(priya, 1019, "delivered", 30 * DAY, 26 * DAY, [
      item({ sku: "AP-MERI-06", name: "Merino Base Layer", category: "apparel", unit_price: 64, refund_status: "issued" }),
    ]),
    mk(diego, 1003, "delivered", 47 * DAY, 41 * DAY, [
      item({ sku: "EL-BAND-01", name: "Smartwatch Band", category: "electronics", unit_price: 129, refund_status: "rejected" }),
    ]),
    mk(mei, 1021, "delivered", 29 * DAY, 24 * DAY, [
      item({ sku: "HM-POLE-02", name: "Trekking Poles", category: "home", unit_price: 58 }),
    ]),
  ];
  const byNumber = (n: number) => orders.find((o) => o.order_number === n)!;

  /* ---------------- Seeded threads (one per customer persona) ---------------- */
  const threads = new Map<string, MockThread>();
  const runs = new Map<string, MockRun>();

  function seedThread(
    customer: MockCustomer,
    title: string,
    agoMs: number,
    userText: string,
    reply: Omit<Message, "id" | "role" | "created_at" | "approval" | "flags">,
    route: string,
    toolSpecs: { name: string; ms: number; input: unknown; output: unknown }[],
  ) {
    const tid = id();
    const created = iso(agoMs);
    const replyAt = iso(agoMs - 4200);
    threads.set(tid, {
      id: tid,
      customer_id: customer.id,
      title,
      status: "active",
      created_at: created,
      updated_at: replyAt,
      facts: {},
      actions: [],
      messages: [
        { id: id(), role: "user", text: userText, created_at: created, tools: [], citations: [], approval: null, flags: {} },
        { id: id(), role: "assistant", created_at: replyAt, approval: null, flags: { guard_replaced: false }, ...reply },
      ],
    });
    const r = buildRun({
      thread_id: tid,
      customer_id: customer.id,
      status: "ok",
      route,
      startMs: now - agoMs,
      first_user_text: userText,
      specs: [
        ...preamble(userText, route, 2, toolSpecs.map((t) => t.name)),
        ...toolSpecs.map((t) => ({ kind: "tool" as const, name: t.name, ms: t.ms, input: t.input, output: t.output })),
        ...closing(84),
      ],
    });
    runs.set(r.run.id, r);
  }

  const shell = byNumber(1057);
  seedThread(
    maya,
    "Rain shell delivery",
    2 * DAY + 3 * HOUR,
    "Where is my rain shell?",
    {
      text: `Your **Packable Rain Shell** (order #1057) shipped on ${new Date(now - 3 * DAY).toLocaleDateString("en-US", { month: "short", day: "numeric" })} and is on its way. Carrier estimates delivery within 2–3 business days. Anything else I can help with?`,
      tools: [
        { id: "call_s1", name: "list_orders", label: "Looked up your orders", status: "ok", duration_ms: 286, args: { limit: 5 }, result_preview: "3 orders · latest #1057 (shipped)" },
        { id: "call_s2", name: "get_order", label: "Opened order #1057", status: "ok", duration_ms: 241, args: { order_id: "1057" }, result_preview: "#1057 · shipped · 1 item" },
      ],
      citations: [],
    },
    "order_lookup",
    [
      { name: "list_orders", ms: 286, input: { limit: 5 }, output: { count: 3 } },
      { name: "get_order", ms: 241, input: { order_id: "1057" }, output: { order_number: 1057, status: shell.status } },
    ],
  );
  seedThread(
    arjun,
    "Return window question",
    1 * DAY + 5 * HOUR,
    "How long is my return window?",
    {
      text: "As a **Gold** member you have **60 days** from delivery to return most items [Policy §2.2]. Final-sale items are the exception [Policy §5.1].",
      tools: [
        { id: "call_a1", name: "search_policy", label: "Read policy: Returns › Loyalty tiers", status: "ok", duration_ms: 334, args: { query: "return window gold tier" }, result_preview: "§2.2 Loyalty tiers · §5.1 Final sale items" },
      ],
      citations: [policyCitation("§2.2"), policyCitation("§5.1")],
    },
    "faq",
    [{ name: "search_policy", ms: 334, input: { query: "return window gold tier" }, output: { sections: ["§2.2", "§5.1"] } }],
  );
  seedThread(
    lena,
    "International return",
    3 * DAY,
    "How do international returns work?",
    {
      text: "You can return items from Germany within the normal window, but return shipping isn't free and the refund won't include the original shipping cost [Policy §7.1]. Want me to check a specific order?",
      tools: [
        { id: "call_l1", name: "search_policy", label: "Read policy: International returns", status: "ok", duration_ms: 298, args: { query: "international returns shipping" }, result_preview: "§7.1 International returns" },
      ],
      citations: [policyCitation("§7.1")],
    },
    "faq",
    [{ name: "search_policy", ms: 298, input: { query: "international returns shipping" }, output: { sections: ["§7.1"] } }],
  );

  /* ---------------- Review queue (other customers) ---------------- */
  const approvals = new Map<string, MockApproval>();
  function seedApproval(p: {
    customer: MockCustomer;
    orderNumber: number;
    status: MockApproval["status"];
    amount: number;
    reason: string;
    ruleIds: string[];
    createdAgo: number;
    decidedAgo?: number;
    note?: string;
    decision?: "approve" | "approve_with_edit" | "reject";
    summary: string;
    eligibility: string[];
    sections: string[];
    runStatus: "ok" | "interrupted";
  }) {
    const order = byNumber(p.orderNumber);
    const it = order.items[0]!;
    const aid = id();
    const runStart = now - p.createdAgo - 6000;
    const userText = `I'd like to return the ${it.name.toLowerCase()} and get a refund.`;
    const r = buildRun({
      thread_id: null,
      customer_id: p.customer.id,
      status: p.runStatus,
      route: "refund",
      startMs: runStart,
      first_user_text: userText,
      specs: [
        ...preamble(userText, "refund", 1, ["get_order", "check_return_eligibility", "issue_refund"]),
        { kind: "tool", name: "get_order", ms: 233, input: { order_id: String(p.orderNumber) }, output: { order_number: p.orderNumber, status: "delivered" } },
        { kind: "tool", name: "check_return_eligibility", ms: 198, input: { order_item_id: it.id, item_condition: "unopened" }, output: { eligible: true, rule_ids: ["R-WINDOW-30"] } },
        { kind: "tool", name: "issue_refund", ms: 176, input: { order_item_id: it.id, amount: p.amount, reason: "return_within_window" }, output: { proposal_id: id(), decision: "needs_approval" } },
        { kind: "policy", name: "policy_check", ms: 11, input: { tool: "issue_refund", amount: p.amount }, output: { decision: "needs_approval", rule_ids: p.ruleIds } },
        { kind: "interrupt", name: "approval_gate", ms: 41, status: p.runStatus === "interrupted" ? "interrupted" : "ok", output: { approval_id: aid } },
        ...(p.runStatus === "ok"
          ? [
              { kind: "node" as const, name: "resume", ms: 22, gap: Math.max(1000, (p.createdAgo - (p.decidedAgo ?? 0)) / 10), output: { decision: p.decision ?? "approve" } },
              ...(p.decision === "reject" ? [] : [{ kind: "job" as const, name: "process_refund", ms: 1840, output: { status: "succeeded", idempotency_key: "sha256:…" } }]),
              ...closing(72),
            ]
          : []),
      ],
    });
    runs.set(r.run.id, r);
    const decided = p.status !== "pending";
    approvals.set(aid, {
      id: aid,
      customer_id: p.customer.id,
      item_id: it.id,
      refund_action_id: null,
      status: p.status,
      action: "issue_refund",
      args: { order_item_id: it.id, amount: p.amount, reason: "return_within_window" },
      amount: p.amount,
      max_amount: it.unit_price - it.discount,
      order_number: p.orderNumber,
      item_name: it.name,
      customer_name: p.customer.short,
      reason: p.reason,
      policy: { decision: "needs_approval", reasons: [p.reason], rule_ids: p.ruleIds },
      evidence: {
        order: { order_number: p.orderNumber, delivered_at: order.delivered_at, status: order.status },
        eligibility: { eligible: true, reasons: p.eligibility },
        policy_sections: p.sections.map((s) => {
          const c = policyCitation(s);
          return { section_id: s, heading: c.heading, text: "" };
        }),
        prior_refunds_90d: p.customer.refunds_90d,
      },
      agent_summary: p.summary,
      thread_id: null,
      run_id: r.run.id,
      created_at: iso(p.createdAgo),
      expires_at: p.status === "expired" ? iso(p.createdAgo - DAY) : isoIn(DAY - p.createdAgo),
      decided_at: decided ? iso(p.decidedAgo ?? p.createdAgo - HOUR) : null,
      decision: decided
        ? {
            decision: p.status === "expired" ? "expired" : (p.decision ?? "approve"),
            amount: p.amount,
            note: p.note ?? null,
            decided_by: p.status === "expired" ? null : "Riley (Support Lead)",
          }
        : null,
    });
  }

  seedApproval({
    customer: jordan,
    orderNumber: 1038,
    status: "pending",
    amount: 89,
    reason: "Amount is over the $50 auto-approve limit",
    ruleIds: ["R-AMOUNT-50"],
    createdAgo: 34 * MIN,
    summary: "Customer wants to return an unworn fleece jacket (wrong size) 11 days after delivery. Eligible under the 30-day window; the refund is over the auto-approve limit.",
    eligibility: ["Delivered 11 days ago — within the 30-day window", "Item reported unworn with tags"],
    sections: ["§2.1", "§3.4"],
    runStatus: "interrupted",
  });
  seedApproval({
    customer: sam,
    orderNumber: 1029,
    status: "pending",
    amount: 46,
    reason: "Customer has 3 refunds in the last 90 days",
    ruleIds: ["R-FREQ-3"],
    createdAgo: 2 * HOUR + 12 * MIN,
    summary: "Customer asked to return a weekender bag that 'wasn't as roomy as expected'. Eligible, but they've had 3 refunds in 90 days, so the policy requires review.",
    eligibility: ["Delivered 18 days ago — within the 30-day window", "Unused, original packaging"],
    sections: ["§2.1", "§3.4"],
    runStatus: "interrupted",
  });
  seedApproval({
    customer: priya,
    orderNumber: 1019,
    status: "approved",
    amount: 64,
    reason: "Amount is over the $50 auto-approve limit",
    ruleIds: ["R-AMOUNT-50"],
    createdAgo: 27 * HOUR,
    decidedAgo: 26 * HOUR,
    note: "Approved — item unworn.",
    decision: "approve",
    summary: "Customer returned an unworn base layer within the window. Eligible; amount over the limit.",
    eligibility: ["Delivered 26 days ago — within the 30-day window"],
    sections: ["§2.1", "§3.4"],
    runStatus: "ok",
  });
  seedApproval({
    customer: diego,
    orderNumber: 1003,
    status: "rejected",
    amount: 129,
    reason: "Exception requested: outside the 30-day window (41 days)",
    ruleIds: ["R-WINDOW-30", "R-EXCEPTION"],
    createdAgo: 2 * DAY,
    decidedAgo: 2 * DAY - 2 * HOUR,
    note: "Outside the return window — offered store credit instead.",
    decision: "reject",
    summary: "Customer asked for an exception: band returned 41 days after delivery. Agent flagged it as an exception request.",
    eligibility: ["Delivered 41 days ago — outside the 30-day window"],
    sections: ["§2.1", "§6.1"],
    runStatus: "ok",
  });
  seedApproval({
    customer: mei,
    orderNumber: 1021,
    status: "expired",
    amount: 58,
    reason: "Amount is over the $50 auto-approve limit",
    ruleIds: ["R-AMOUNT-50"],
    createdAgo: 3 * DAY,
    decidedAgo: 2 * DAY,
    summary: "Customer wanted to return trekking poles within the window. Not reviewed within 24 hours.",
    eligibility: ["Delivered 24 days ago — within the 30-day window"],
    sections: ["§2.1", "§3.4"],
    runStatus: "ok",
  });

  /* ---------------- A couple of interesting historical runs for /admin and /runs ---------------- */
  const fallbackRun = buildRun({
    thread_id: null,
    customer_id: jordan.id,
    status: "ok",
    route: "faq",
    startMs: now - 5 * HOUR,
    first_user_text: "Do you accept returns on gifts?",
    model_primary: MODEL_FALLBACK,
    specs: [
      ...preamble("Do you accept returns on gifts?", "faq", 0, ["search_policy"]).map((s) =>
        s.name === "agent"
          ? { ...s, status: "error" as const, error: "groq: 429 rate_limited — falling back to gemini", output: null, ms: 140 }
          : s,
      ),
      { kind: "llm", name: "agent (fallback)", model: MODEL_FALLBACK, ms: 1320, tokens_in: 1790, tokens_out: 41, output: { tool_calls: ["search_policy"] } },
      { kind: "tool", name: "search_policy", ms: 312, input: { query: "gift returns" }, output: { sections: ["§8.1"] } },
      ...closing(66).map((s) => (s.name === "respond" ? { ...s, model: MODEL_FALLBACK } : s)),
    ],
  });
  runs.set(fallbackRun.run.id, fallbackRun);

  const errorRun = buildRun({
    thread_id: null,
    customer_id: sam.id,
    status: "error",
    route: "order_lookup",
    startMs: now - 9 * HOUR,
    first_user_text: "Where's my order?",
    specs: [
      ...preamble("Where's my order?", "order_lookup", 1, ["list_orders"]),
      { kind: "tool", name: "list_orders", ms: 10000, status: "error", error: "MCP tool timeout after 10 s", input: { limit: 5 }, output: null },
      { kind: "llm", name: "respond", model: MODEL_SMALL, ms: 420, tokens_in: 640, tokens_out: 38, output: { template: "tool_unavailable" } },
    ],
  });
  runs.set(errorRun.run.id, errorRun);

  /* ---------------- Memories ---------------- */
  const mayaThread = [...threads.values()].find((t) => t.customer_id === maya.id)!;
  const memories: MockMemory[] = [
    { id: id(), customer_id: maya.id, content: "Prefers store drop-off for returns", kind: "preference", created_at: iso(12 * DAY), source_thread_id: mayaThread.id },
    { id: id(), customer_id: maya.id, content: "Wears US women's size 8 in boots", kind: "fact", created_at: iso(19 * DAY), source_thread_id: null },
    { id: id(), customer_id: maya.id, content: "Prefers email updates over text messages", kind: "preference", created_at: iso(30 * DAY), source_thread_id: null },
    { id: id(), customer_id: arjun.id, content: "Prefers exchanges over refunds when an item is damaged", kind: "preference", created_at: iso(8 * DAY), source_thread_id: null },
    { id: id(), customer_id: arjun.id, content: "Usually schedules carrier pickups for returns", kind: "preference", created_at: iso(21 * DAY), source_thread_id: null },
    { id: id(), customer_id: lena.id, content: "Ships orders to Germany", kind: "fact", created_at: iso(40 * DAY), source_thread_id: null },
    { id: id(), customer_id: lena.id, content: "Prefers short answers in bullet points", kind: "preference", created_at: iso(6 * DAY), source_thread_id: null },
  ];

  return {
    id: wsId,
    createdAt: now,
    customers: [maya, arjun, lena, ...others],
    orders,
    threads,
    approvals,
    runs,
    memories,
    listeners: new Map(),
  };
}
