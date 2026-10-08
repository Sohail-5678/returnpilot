import type { BackendClaims } from "@/lib/server/backend-token";
import type { Action, Message, ToolCall } from "@/lib/schemas";
import { decisionInputSchema } from "@/lib/schemas";
import { formatSSE } from "@/lib/sse";
import { findPolicy, policyCitation, policyIndex } from "./policies";
import { buildSteps, closing, MODEL_MAIN, preamble, summarize, type StepSpec } from "./runs";
import { planTurn, type TurnPlan } from "./script";
import { customerFor, getWorkspace, nowIso, publish, subscribe } from "./store";
import type { MockApproval, MockCustomer, MockRun, MockThread, Workspace } from "./types";

/**
 * MOCK_BACKEND=true: serves API_CONTRACT v1 from in-memory fixtures (lib/mock/*).
 * Called by app/api/v1/[...path]/route.ts after the role check, with the same
 * claims the real backend would receive in the JWT.
 */
export interface MockRequest {
  method: string;
  segments: string[];
  search: URLSearchParams;
  body: unknown;
  claims: BackendClaims;
  signal: AbortSignal;
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

function omit<T extends object, K extends keyof T>(obj: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...obj };
  for (const k of keys) delete copy[k];
  return copy;
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}
function err(status: number, code: string, message: string) {
  return json({ error: { code, message } }, status);
}
const notFound = (what = "Not found") => err(404, "not_found", what);

/** MOCK_SPEED=0 makes the scripted stream instant (tests); 1 = demo pacing. */
const speed = () => {
  const v = Number(process.env.MOCK_SPEED ?? 1);
  return Number.isFinite(v) && v >= 0 ? v : 1;
};

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted || speed() === 0) return resolve();
    const t = setTimeout(resolve, ms * speed());
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });

/* Simulated cold start: MOCK_COLD_START_SECONDS=20 makes the first N seconds after boot return backend_starting. */
const bootedAt = Date.now();
export function mockIsWaking() {
  const secs = Number(process.env.MOCK_COLD_START_SECONDS ?? 0);
  return secs > 0 && Date.now() - bootedAt < secs * 1000;
}

export async function handleMock(req: MockRequest): Promise<Response> {
  if (mockIsWaking()) {
    return err(503, "backend_starting", "Starting the free server — this takes up to a minute after it has been idle.");
  }
  const ws = getWorkspace(req.claims.ws);
  const [head, id, sub] = req.segments;
  const m = req.method;
  const customer = req.claims.role === "customer" ? customerFor(ws, req.claims.persona) : null;

  // Small latency so loading states are visible but brief.
  await sleep(120 + Math.random() * 180, req.signal);

  switch (head) {
    case "me":
      return json({
        sub: req.claims.sub,
        role: req.claims.role,
        name: req.claims.name,
        persona: req.claims.persona,
        customer: customer
          ? {
              id: customer.id,
              name: customer.name,
              email: customer.email,
              loyalty_tier: customer.loyalty_tier,
              shipping_pref: customer.shipping_pref,
              country: customer.country,
            }
          : null,
        workspace_id: ws.id,
        demo_mode: true,
      });

    case "policies": {
      if (!id) return json(policyIndex());
      const p = findPolicy(decodeURIComponent(id));
      return p ? json(p) : notFound("Policy section not found");
    }

    case "threads":
      if (!customer) return err(403, "forbidden", "Customers only");
      return threads(ws, customer, req, id, sub);

    case "orders":
      if (!customer) return err(403, "forbidden", "Customers only");
      return orders(ws, customer, req, id);

    case "memories":
      if (!customer) return err(403, "forbidden", "Customers only");
      if (m === "GET" && !id) {
        const list = ws.memories
          .filter((x) => x.customer_id === customer.id)
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .map((x) => omit(x, "customer_id"));
        return json({ memories: list });
      }
      if (m === "DELETE" && id) {
        const idx = ws.memories.findIndex((x) => x.id === id && x.customer_id === customer.id);
        if (idx === -1) return notFound("Memory not found");
        ws.memories.splice(idx, 1);
        return new Response(null, { status: 204 });
      }
      return err(405, "method_not_allowed", "Method not allowed");

    case "approvals":
      return approvals(ws, req, id, sub);

    case "runs":
      return runs(ws, req, customer, id);

    case "admin":
      if (id === "metrics") return json(metrics(ws, Number(req.search.get("days") ?? 7)));
      if (id === "profile") return json(mockProfile());
      return notFound();

    default:
      return notFound();
  }
}

/* =============================== Threads =============================== */

function threadSummary(t: MockThread) {
  const last = [...t.messages].reverse().find((x) => x.role !== "system") ?? t.messages[t.messages.length - 1];
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    updated_at: t.updated_at,
    last_message_preview: last ? last.text.replace(/[*_#>`]/g, "").slice(0, 90) : null,
  };
}

function threadDetail(ws: Workspace, t: MockThread) {
  const pending = [...ws.approvals.values()].find((a) => a.thread_id === t.id && a.status === "pending");
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    created_at: t.created_at,
    updated_at: t.updated_at,
    messages: t.messages,
    pending_approval: pending
      ? {
          approval_id: pending.id,
          status: pending.status,
          amount: pending.amount,
          summary: `Refund ${fmt(pending.amount)} · ${pending.item_name}`,
          reason: pending.reason,
        }
      : null,
    actions: t.actions,
  };
}

async function threads(ws: Workspace, customer: MockCustomer, req: MockRequest, id?: string, sub?: string) {
  const m = req.method;
  if (!id) {
    if (m === "GET") {
      const list = [...ws.threads.values()]
        .filter((t) => t.customer_id === customer.id)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .map(threadSummary);
      return json({ threads: list });
    }
    if (m === "POST") {
      const tid = crypto.randomUUID();
      const now = nowIso();
      ws.threads.set(tid, {
        id: tid,
        customer_id: customer.id,
        title: "New conversation",
        status: "active",
        created_at: now,
        updated_at: now,
        messages: [],
        actions: [],
        facts: {},
      });
      return json({ thread_id: tid }, 201);
    }
    return err(405, "method_not_allowed", "Method not allowed");
  }

  const t = ws.threads.get(id);
  if (!t || t.customer_id !== customer.id) return notFound("Conversation not found");

  if (!sub) {
    if (m === "GET") return json(threadDetail(ws, t));
    if (m === "DELETE") {
      ws.threads.delete(id);
      return new Response(null, { status: 204 });
    }
    return err(405, "method_not_allowed", "Method not allowed");
  }

  if (sub === "messages" && m === "POST") {
    const text = typeof (req.body as { text?: unknown })?.text === "string" ? (req.body as { text: string }).text.trim() : "";
    if (text.length < 1 || text.length > 2000) return err(422, "validation_error", "Message must be 1–2000 characters.");
    return streamTurn(ws, customer, t, text);
  }

  if (sub === "events" && m === "GET") return threadEvents(ws, t, req.signal);

  return notFound();
}

function chunkText(text: string) {
  const parts = text.split(/(\s+)/);
  const chunks: string[] = [];
  let cur = "";
  let words = 0;
  for (const p of parts) {
    cur += p;
    if (p.trim()) words += 1;
    if (words >= 1 + Math.floor(Math.random() * 3) && /\s$/.test(cur + " ")) {
      chunks.push(cur);
      cur = "";
      words = 0;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

function streamTurn(ws: Workspace, customer: MockCustomer, thread: MockThread, text: string) {
  const encoder = new TextEncoder();
  const ctrl = new AbortController();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const send = (event: string, data: unknown) => {
        if (!open || ctrl.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(formatSSE(event, data)));
        } catch {
          open = false;
        }
      };
      const ping = setInterval(() => {
        if (open && !ctrl.signal.aborted) {
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            open = false;
          }
        }
      }, 15_000);
      // Run the turn without blocking start() so chunks flush as they are enqueued.
      void executeTurn(ws, customer, thread, text, send, ctrl.signal)
        .catch(() => send("error", { code: "internal", message: "The mock agent crashed." }))
        .finally(() => {
          clearInterval(ping);
          open = false;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        });
    },
    cancel() {
      ctrl.abort();
    },
  });
  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}

async function executeTurn(
  ws: Workspace,
  customer: MockCustomer,
  thread: MockThread,
  text: string,
  send: (event: string, data: unknown) => void,
  signal: AbortSignal,
) {
  const plan: TurnPlan = planTurn(ws, customer, thread, text);
  const runId = crypto.randomUUID();
  const runStart = Date.now();
  const userMsg: Message = {
    id: crypto.randomUUID(),
    role: "user",
    text,
    created_at: nowIso(),
    tools: [],
    citations: [],
    approval: null,
    flags: {},
  };
  thread.messages.push(userMsg);
  thread.updated_at = userMsg.created_at;
  if (thread.title === "New conversation") thread.title = plan.title;

  send("run", { run_id: runId });

  const runSpecs: StepSpec[] = preamble(text, plan.route, plan.memories ?? 0, plan.steps.filter((s) => s.type === "tool").map((s) => (s.type === "tool" ? s.call.name : "")));
  let segTools: ToolCall[] = [];
  let lastMsg: Message | null = null;
  let errored = false;

  for (const step of plan.steps) {
    if (step.type === "status") {
      send("status", { stage: step.stage, label: step.label });
      await sleep(step.wait ?? 380, signal);
    } else if (step.type === "tool") {
      const c = step.call;
      send("tool", { id: c.id, name: c.name, status: "started", label: step.startedLabel });
      await sleep((c.duration_ms ?? 250) + 280, signal);
      send("tool", { id: c.id, name: c.name, status: c.status === "error" ? "error" : "ok", label: c.label, duration_ms: c.duration_ms });
      segTools.push(c);
      runSpecs.push({ kind: "tool", name: c.name, ms: c.duration_ms ?? 200, gap: 280, input: c.args, output: { preview: c.result_preview } });
      await sleep(90, signal);
    } else if (step.type === "say") {
      for (const chunk of chunkText(step.text)) {
        send("token", { text: chunk });
        await sleep(22 + Math.random() * 26, signal);
      }
      const msg: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: step.text,
        created_at: nowIso(),
        tools: segTools,
        citations: step.citations,
        approval: null,
        flags: { guard_replaced: false },
      };
      thread.messages.push(msg);
      thread.updated_at = msg.created_at;
      lastMsg = msg;
      segTools = [];
      send("message", { id: msg.id, text: msg.text, citations: msg.citations });
      await sleep(160, signal);
    } else if (step.type === "error") {
      errored = true;
      send("error", { code: step.code, message: step.message });
    }
  }

  if (thread.facts && plan.facts) Object.assign(thread.facts, plan.facts);

  if (plan.createReturn && !errored) {
    const item = plan.createReturn.order.items.find((i) => i.id === plan.createReturn!.itemId);
    if (item) item.return_status = "requested";
    const action: Action = {
      id: crypto.randomUUID(),
      kind: "return",
      status: "queued",
      label: plan.createReturn.label,
      amount: null,
      order_number: plan.createReturn.order.order_number,
      updated_at: nowIso(),
      detail: "Creating a prepaid return label",
    };
    thread.actions.push(action);
    send("action", action);
    // The label job "runs" in the background and finishes a moment later.
    setTimeout(() => {
      action.status = "succeeded";
      action.detail = "Return label emailed (simulated)";
      action.updated_at = nowIso();
      if (item) item.return_status = "label_created";
      publish(ws, thread.id, "action", { ...action });
    }, 2600);
  }

  let approval: MockApproval | null = null;
  if (plan.approval && !errored) {
    approval = createApproval(ws, customer, thread, plan, runId);
    if (lastMsg) lastMsg.approval = { approval_id: approval.id, status: "pending", amount: approval.amount, note: null };
    thread.status = "waiting_approval";
    const refund = thread.actions.find((a) => a.id === approval!.refund_action_id)!;
    send("approval", {
      approval_id: approval.id,
      status: "pending",
      amount: approval.amount,
      summary: `Refund ${fmt(approval.amount)} · ${approval.item_name}`,
      reason: approval.reason,
    });
    send("action", refund);
    runSpecs.push(
      { kind: "policy", name: "policy_check", ms: 12, input: { tool: "issue_refund", amount: approval.amount }, output: { decision: "needs_approval", rule_ids: approval.policy?.rule_ids ?? [] } },
      { kind: "interrupt", name: "approval_gate", ms: 38, status: "interrupted", output: { approval_id: approval.id, expires_in: "24h" } },
    );
  }

  // Record the run trace (interrupted runs end at the approval gate).
  const specs = approval ? [...runSpecs, closing(82)[0]!, closing(82)[1]!] : [...runSpecs, ...closing(88)];
  const { steps } = buildSteps(runStart, specs);
  const run: MockRun = summarize({
    customer_id: customer.id,
    steps,
    run: {
      id: runId,
      thread_id: thread.id,
      status: errored ? "error" : approval ? "interrupted" : "ok",
      route: plan.route,
      model_primary: MODEL_MAIN,
      total_ms: 0,
      llm_calls: 0,
      tool_calls: 0,
      tokens_in: 0,
      tokens_out: 0,
      created_at: new Date(runStart).toISOString(),
      first_user_text: text,
    },
  });
  ws.runs.set(runId, run);

  send("done", { run_id: runId, message_id: lastMsg?.id ?? userMsg.id });
}

function createApproval(ws: Workspace, customer: MockCustomer, thread: MockThread, plan: TurnPlan, runId: string): MockApproval {
  const a = plan.approval!;
  const item = a.order.items.find((i) => i.id === a.itemId)!;
  item.refund_status = "pending_approval";
  const now = Date.now();
  const refund: Action = {
    id: crypto.randomUUID(),
    kind: "refund",
    status: "pending_approval",
    label: `Refund ${fmt(a.amount)} · ${item.name}`,
    amount: a.amount,
    order_number: a.order.order_number,
    updated_at: nowIso(),
    detail: "Waiting for a team member",
  };
  thread.actions.push(refund);
  const approval: MockApproval = {
    id: crypto.randomUUID(),
    customer_id: customer.id,
    item_id: item.id,
    refund_action_id: refund.id,
    status: "pending",
    action: "issue_refund",
    args: { order_item_id: item.id, amount: a.amount, reason: "return_within_window" },
    amount: a.amount,
    max_amount: item.unit_price - item.discount,
    order_number: a.order.order_number,
    item_name: item.name,
    customer_name: customer.short,
    reason: a.reason,
    policy: { decision: "needs_approval", reasons: [a.reason], rule_ids: a.ruleIds },
    evidence: {
      order: { order_number: a.order.order_number, delivered_at: a.order.delivered_at, status: a.order.status },
      eligibility: { eligible: true, reasons: a.eligibility },
      policy_sections: a.sections.map((s) => {
        const p = findPolicy(s);
        return { section_id: s, heading: p?.heading ?? "", text: p?.text ?? "" };
      }),
      prior_refunds_90d: customer.refunds_90d,
    },
    agent_summary: a.summary,
    thread_id: thread.id,
    run_id: runId,
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + 24 * 3600_000).toISOString(),
    decided_at: null,
    decision: null,
  };
  ws.approvals.set(approval.id, approval);
  return approval;
}

function threadEvents(ws: Workspace, thread: MockThread, signal: AbortSignal) {
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const write = (s: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(s));
        } catch {
          open = false;
        }
      };
      const unsub = subscribe(ws, thread.id, (event, data) => write(formatSSE(event, data)));
      const ping = setInterval(() => write(": ping\n\n"), 15_000);
      const close = setTimeout(() => finish(), 280_000);
      write(": connected\n\n");
      function finish() {
        if (!open) return;
        open = false;
        unsub();
        clearInterval(ping);
        clearTimeout(close);
        try {
          controller.close();
        } catch {
          /* noop */
        }
      }
      cleanup = finish;
      signal.addEventListener("abort", finish, { once: true });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}

/* =============================== Orders =============================== */

function orders(ws: Workspace, customer: MockCustomer, req: MockRequest, id?: string) {
  if (req.method !== "GET") return err(405, "method_not_allowed", "Method not allowed");
  const mine = ws.orders.filter((o) => o.customer_id === customer.id);
  if (!id) {
    const status = req.search.get("status");
    const list = mine
      .filter((o) => !status || o.status === status)
      .sort((a, b) => b.placed_at.localeCompare(a.placed_at))
      .map((o) => ({
        id: o.id,
        order_number: o.order_number,
        placed_at: o.placed_at,
        delivered_at: o.delivered_at,
        status: o.status,
        total: o.total,
        items_count: o.items.reduce((a, i) => a + i.qty, 0),
        shipping_country: o.shipping_country,
        thumbnail_category: o.items[0]?.category ?? "apparel",
      }));
    return json({ orders: list });
  }
  const o = mine.find((x) => x.id === id || String(x.order_number) === id.replace(/^#/, ""));
  if (!o) return notFound("Order not found");
  return json(omit(o, "customer_id"));
}

/* =============================== Approvals =============================== */

function approvalSummary(a: MockApproval) {
  return {
    id: a.id,
    status: a.status,
    action: a.action,
    amount: a.amount,
    order_number: a.order_number,
    item_name: a.item_name,
    customer_name: a.customer_name,
    reason: a.reason,
    created_at: a.created_at,
    expires_at: a.expires_at,
    decided_at: a.decided_at,
  };
}

function approvalDetail(a: MockApproval) {
  return omit(a, "customer_id", "item_id", "refund_action_id");
}

async function approvals(ws: Workspace, req: MockRequest, id?: string, sub?: string) {
  if (!id) {
    if (req.method !== "GET") return err(405, "method_not_allowed", "Method not allowed");
    const status = req.search.get("status") ?? "pending";
    const list = [...ws.approvals.values()]
      .filter((a) => (status === "pending" ? a.status === "pending" : a.status !== "pending"))
      .sort((a, b) =>
        status === "pending" ? b.created_at.localeCompare(a.created_at) : (b.decided_at ?? "").localeCompare(a.decided_at ?? ""),
      )
      .map(approvalSummary);
    return json({ approvals: list });
  }
  const a = ws.approvals.get(id);
  if (!a) return notFound("Approval not found");
  if (!sub && req.method === "GET") return json(approvalDetail(a));
  if (sub === "decision" && req.method === "POST") {
    const parsed = decisionInputSchema.safeParse(req.body);
    if (!parsed.success) return err(422, "validation_error", "Invalid decision.");
    if (a.status !== "pending") return err(409, "already_decided", "This request was already decided.");
    const d = parsed.data;
    let amount = a.amount;
    if (d.decision === "approve_with_edit") {
      if (d.amount === undefined) return err(422, "validation_error", "Enter the edited amount.");
      amount = Math.round(d.amount * 100) / 100;
      if (amount <= 0 || amount > (a.max_amount ?? a.amount)) {
        return err(422, "validation_error", `The policy engine rejected ${fmt(amount)}: the amount must be between $0.01 and ${fmt(a.max_amount ?? a.amount)} (the price paid).`);
      }
    }
    if (d.decision === "reject" && !(d.note && d.note.trim())) {
      return err(422, "validation_error", "Add a note for the customer when rejecting.");
    }
    applyDecision(ws, a, d.decision, amount, d.note?.trim() || null, req.claims.name);
    return json(approvalDetail(a));
  }
  return err(405, "method_not_allowed", "Method not allowed");
}

function applyDecision(
  ws: Workspace,
  a: MockApproval,
  decision: "approve" | "approve_with_edit" | "reject",
  amount: number,
  note: string | null,
  reviewer: string,
) {
  const approved = decision !== "reject";
  a.status = approved ? "approved" : "rejected";
  a.amount = amount;
  a.decided_at = nowIso();
  a.decision = { decision, amount, note, decided_by: reviewer };
  a.args = { ...a.args, amount };

  const order = ws.orders.find((o) => o.order_number === a.order_number);
  const item = order?.items.find((i) => i.id === a.item_id);
  if (item) item.refund_status = approved ? "queued" : "rejected";

  const run = a.run_id ? ws.runs.get(a.run_id) : undefined;
  const thread = a.thread_id ? ws.threads.get(a.thread_id) : undefined;
  if (!thread) {
    if (run) finishRun(run, decision, approved);
    return;
  }

  thread.status = "active";
  for (const msg of thread.messages) {
    if (msg.approval?.approval_id === a.id) msg.approval = { approval_id: a.id, status: a.status, amount, note };
  }
  const refund = thread.actions.find((x) => x.id === a.refund_action_id);
  const touch = () => {
    thread.updated_at = nowIso();
    if (refund) refund.updated_at = thread.updated_at;
  };

  if (refund) {
    refund.label = `Refund ${fmt(amount)} · ${a.item_name}`;
    refund.amount = amount;
    refund.status = approved ? "queued" : "rejected";
    refund.detail = approved ? "Approved by a team member · queued for processing" : `Not approved: ${note}`;
  }
  touch();
  publish(ws, thread.id, "approval", { approval_id: a.id, status: a.status, amount, note });
  if (refund) publish(ws, thread.id, "action", { ...refund });

  if (!approved) {
    const msg: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      text: `A team member couldn't approve this refund: ${note}. Would you like store credit or an exchange instead?`,
      created_at: nowIso(),
      tools: [],
      citations: [],
      approval: null,
      flags: { guard_replaced: false },
    };
    thread.messages.push(msg);
    touch();
    publish(ws, thread.id, "message", msg);
    if (run) finishRun(run, decision, false);
    return;
  }

  // Simulated Celery job: queued → running → succeeded.
  setTimeout(() => {
    if (refund) {
      refund.status = "running";
      refund.detail = "Processing refund (simulated payment provider)";
    }
    touch();
    if (refund) publish(ws, thread.id, "action", { ...refund });
  }, 1400);

  setTimeout(() => {
    if (refund) {
      refund.status = "succeeded";
      refund.detail = "Refund issued (simulated)";
    }
    if (item) item.refund_status = "issued";
    const msg: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      text: `Good news — a team member approved your refund of **${fmt(amount)}** for the ${a.item_name}. It has been issued to your original payment method (simulated) and usually shows up within 5–7 business days [Policy §3.1].`,
      created_at: nowIso(),
      tools: [
        {
          id: `call_job_${a.id.slice(0, 6)}`,
          name: "process_refund",
          label: `Issued refund of ${fmt(amount)} (simulated)`,
          status: "ok",
          duration_ms: 1840,
          args: { approval_id: a.id, amount },
          result_preview: "job succeeded · idempotency key reused: no",
        },
      ],
      citations: [policyCitation("§3.1")],
      approval: null,
      flags: { guard_replaced: false },
    };
    thread.messages.push(msg);
    touch();
    if (refund) publish(ws, thread.id, "action", { ...refund });
    publish(ws, thread.id, "message", msg);
    if (run) finishRun(run, decision, true);
  }, 3600);
}

function finishRun(run: MockRun, decision: string, approved: boolean) {
  const gate = run.steps.find((s) => s.kind === "interrupt");
  if (gate) gate.status = "ok";
  const resumeAt = Date.now() - 3000;
  const specs: StepSpec[] = [
    { kind: "node", name: "resume", ms: 24, input: { decision }, output: { resumed_from: "approval_gate" } },
    ...(approved
      ? [
          { kind: "node" as const, name: "execute_action", ms: 31, output: { enqueued: "process_refund" } },
          { kind: "job" as const, name: "process_refund", ms: 1840, output: { status: "succeeded" } },
        ]
      : []),
    ...closing(64),
  ];
  const { steps } = buildSteps(resumeAt, specs, run.steps.length + 1);
  run.steps.push(...steps);
  run.run.status = "ok";
  summarize(run);
}

/* =============================== Runs =============================== */

function runs(ws: Workspace, req: MockRequest, customer: MockCustomer | null, id?: string) {
  if (req.method === "POST" && id && req.segments[2] === "feedback") {
    const body = (req.body ?? {}) as { thumbs?: number };
    if (body.thumbs !== 1 && body.thumbs !== -1) return err(422, "validation_error", "thumbs must be 1 or -1");
    return json({ run_id: id, thumbs: body.thumbs });
  }
  if (req.method !== "GET") return err(405, "method_not_allowed", "Method not allowed");
  const visible = [...ws.runs.values()].filter((r) => req.claims.role === "admin" || (customer && r.customer_id === customer.id));
  if (!id) {
    const limit = Math.min(200, Math.max(1, Number(req.search.get("limit") ?? 50)));
    const list = visible
      .sort((a, b) => b.run.created_at.localeCompare(a.run.created_at))
      .slice(0, limit)
      .map((r) => r.run);
    return json({ runs: list });
  }
  const r = visible.find((x) => x.run.id === id);
  if (!r) return notFound("Run not found");
  const redact = req.claims.role !== "admin";
  return json({
    run: r.run,
    steps: r.steps.map((s) => (redact && s.kind === "llm" ? { ...s, input: { redacted: true } } : s)),
  });
}

/* =============================== Admin =============================== */

function metrics(ws: Workspace, days: number) {
  const window = Math.min(30, Math.max(1, days || 7));
  const all = [...ws.approvals.values()];
  const count = (s: string) => all.filter((a) => a.status === s).length;
  const liveRuns = [...ws.runs.values()];
  const today = new Date();
  const seedRuns = [14, 19, 16, 22, 18, 21, 24, 17, 20, 23, 15, 19, 26, 22, 18, 21, 25, 19, 17, 22, 24, 20, 18, 23, 21, 19, 22, 24, 20, 26];
  const runs_per_day = Array.from({ length: window }, (_, i) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - (window - 1 - i));
    const day = d.toISOString().slice(0, 10);
    const extra = liveRuns.filter((r) => r.run.created_at.slice(0, 10) === day).length;
    const base = seedRuns[(i + 3) % seedRuns.length]!;
    return { day, runs: base + extra, errors: i % 3 === 1 ? 1 : i % 5 === 0 ? 2 : 0 };
  });
  const latency_per_day = runs_per_day.map((r, i) => ({
    day: r.day,
    p50_ms: 2600 + ((i * 337) % 900),
    p95_ms: 6400 + ((i * 541) % 1900),
  }));
  const totalRuns = runs_per_day.reduce((a, r) => a + r.runs, 0);
  const totalErrors = runs_per_day.reduce((a, r) => a + r.errors, 0);
  return {
    window_days: window,
    kpis: {
      runs: totalRuns,
      success_rate: Math.round((1 - totalErrors / totalRuns) * 1000) / 1000,
      approvals_pending: count("pending"),
      approvals_decided: 14 + count("approved") + count("rejected") + count("expired"),
      avg_latency_ms: 3400,
      p95_latency_ms: 7800,
      tool_calls: Math.round(totalRuns * 3.2),
      policy_violations: 0,
    },
    runs_per_day,
    latency_per_day,
    routes: [
      { route: "refund", count: Math.round(totalRuns * 0.31) },
      { route: "return", count: Math.round(totalRuns * 0.24) },
      { route: "order_lookup", count: Math.round(totalRuns * 0.19) },
      { route: "faq", count: Math.round(totalRuns * 0.16) },
      { route: "human", count: Math.round(totalRuns * 0.05) },
      { route: "smalltalk", count: Math.round(totalRuns * 0.05) },
    ],
    approvals: {
      approved: 9 + count("approved"),
      rejected: 2 + count("rejected"),
      expired: 1 + count("expired"),
      pending: count("pending"),
    },
    quota: [
      { provider: "gemini", kind: "main", model: "gemini-flash-latest", used: 212, limit: 1000, tokens_used: 1_180_000, token_limit: 3_000_000 },
      { provider: "groq", kind: "fast", model: "openai/gpt-oss-120b", used: 141, limit: 600, tokens_used: 61_000, token_limit: 120_000 },
      { provider: "groq", kind: "small", model: "openai/gpt-oss-20b", used: 188, limit: 300, tokens_used: 22_400, token_limit: 60_000 },
      { provider: "groq", kind: "guard", model: "meta-llama/llama-prompt-guard-2-86m", used: 403, limit: 7200, tokens_used: null, token_limit: null },
      { provider: "gemini", kind: "embed", model: "gemini-embedding-001", used: 186, limit: 1000, tokens_used: null, token_limit: null },
    ],
    evals: {
      suite: "live",
      git_sha: "a1c9e42",
      created_at: new Date(Date.now() - 14 * 3600_000).toISOString(),
      total: 30,
      passed: 28,
      metrics: { task_success: 0.933, trajectory_match: 0.95, policy_violations: 0, approval_routing: 1.0 },
    },
  };
}

function fmt(n: number) {
  return `$${n.toFixed(2)}`;
}

function mockProfile() {
  return {
    label: "returnpilot@1",
    source: "bundled",
    default_label: "returnpilot@1",
    diff: [],
    locked: ["approval_threshold", "guardrails", "policy", "refund_auto_approve_limit", "tool_permissions"],
    active: {
      version: 1,
      created_by: "human",
      notes: "Initial hand-written profile.",
      routing: { main_model: "env:MAIN_MODEL", fast_model: "env:FAST_MODEL", use_fast_when: "route in ['faq','order_lookup']" },
      params: { temperature: 0.2, max_steps: 8, history_messages: 12, self_consistency_k: 1 },
      tool_descriptions: { get_order: "Get one order with its items…", issue_refund: "Propose a refund…" },
      few_shots: [{ input: "Can I return my jacket?", output: "Which order is it from, and is it unopened?" }],
    },
    agentforge: { url: null, profile_source: "bundled" },
  };
}
