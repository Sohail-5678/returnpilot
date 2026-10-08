/**
 * Zod schemas mirroring docs/API_CONTRACT.md (v1). Keep in sync with the backend.
 * Unknown keys are stripped; optional/nullable is used where the contract allows absence.
 */
import { z } from "zod";

const iso = z.string();
const uuid = z.string();
const money = z.number();
const json = z.record(z.string(), z.unknown());

export const roleSchema = z.enum(["customer", "reviewer", "admin"]);

export const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string().default("") }),
});

/* ---------------- Health / me ---------------- */
export const healthSchema = z.object({
  status: z.string(),
  db: z.boolean().optional(),
  redis: z.boolean().optional(),
  mcp: z.boolean().optional(),
  rss_mb: z.record(z.string(), z.number()).optional(),
  version: z.string().optional(),
});
export type Health = z.infer<typeof healthSchema>;

export const customerSchema = z.object({
  id: uuid,
  name: z.string(),
  email: z.string(),
  loyalty_tier: z.string(),
  shipping_pref: z.string().nullable().optional(),
  country: z.string(),
});
export type Customer = z.infer<typeof customerSchema>;

export const meSchema = z.object({
  sub: z.string(),
  role: roleSchema,
  name: z.string(),
  persona: z.string().nullable().optional(),
  customer: customerSchema.nullable().optional(),
  workspace_id: z.string().nullable().optional(),
  demo_mode: z.boolean().optional(),
});
export type Me = z.infer<typeof meSchema>;

/* ---------------- Threads & messages ---------------- */
export const toolStatusSchema = z.enum(["ok", "error", "running"]);
export const toolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  label: z.string(),
  status: toolStatusSchema,
  duration_ms: z.number().nullable().optional(),
  args: json.nullable().optional(),
  result_preview: z.string().nullable().optional(),
});
export type ToolCall = z.infer<typeof toolCallSchema>;

export const citationSchema = z.object({
  section_id: z.string(),
  doc: z.string().optional(),
  heading: z.string().optional(),
});
export type Citation = z.infer<typeof citationSchema>;

export const approvalStatusSchema = z.enum(["pending", "approved", "rejected", "expired"]);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export const messageApprovalSchema = z.object({
  approval_id: z.string(),
  status: approvalStatusSchema,
  amount: money.nullable().optional(),
  note: z.string().nullable().optional(),
});
export type MessageApproval = z.infer<typeof messageApprovalSchema>;

export const messageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "system"]),
  text: z.string(),
  created_at: iso,
  tools: z.array(toolCallSchema).optional().default([]),
  citations: z.array(citationSchema).optional().default([]),
  approval: messageApprovalSchema.nullable().optional(),
  flags: z.object({ guard_replaced: z.boolean().optional() }).partial().nullable().optional(),
  /** Run that produced this reply (feedback + trace link). */
  run_id: z.string().nullable().optional(),
});
export type Message = z.infer<typeof messageSchema>;

export const actionStatusSchema = z.enum([
  "pending_approval",
  "queued",
  "running",
  "succeeded",
  "failed",
  "rejected",
  "expired",
]);
export type ActionStatus = z.infer<typeof actionStatusSchema>;

export const actionSchema = z.object({
  id: z.string(),
  kind: z.enum(["refund", "return", "ticket"]),
  status: actionStatusSchema,
  label: z.string(),
  amount: money.nullable().optional(),
  order_number: z.number().nullable().optional(),
  updated_at: iso,
  detail: z.string().nullable().optional(),
});
export type Action = z.infer<typeof actionSchema>;

export const threadStatusSchema = z.enum(["active", "escalated", "waiting_approval"]);

export const threadSummarySchema = z.object({
  id: z.string(),
  title: z.string().nullable().optional(),
  status: threadStatusSchema.or(z.string()),
  updated_at: iso,
  last_message_preview: z.string().nullable().optional(),
});
export type ThreadSummary = z.infer<typeof threadSummarySchema>;
export const threadListSchema = z.object({ threads: z.array(threadSummarySchema) });

export const pendingApprovalSchema = z.object({
  approval_id: z.string().optional(),
  id: z.string().optional(),
  status: approvalStatusSchema,
  amount: money.nullable().optional(),
  summary: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

export const threadSchema = z.object({
  id: z.string(),
  title: z.string().nullable().optional(),
  status: threadStatusSchema.or(z.string()),
  created_at: iso,
  updated_at: iso,
  messages: z.array(messageSchema),
  pending_approval: pendingApprovalSchema.nullable().optional(),
  actions: z.array(actionSchema).optional().default([]),
});
export type Thread = z.infer<typeof threadSchema>;

export const createThreadSchema = z.object({ thread_id: z.string() });

/* ---------------- SSE event payloads ---------------- */
export const sseRunSchema = z.object({ run_id: z.string() });
export const sseStatusSchema = z.object({
  stage: z.string(),
  label: z.string().optional().default(""),
});
export const sseToolSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  status: z.enum(["started", "ok", "error"]),
  label: z.string().optional(),
  duration_ms: z.number().optional(),
  args: json.optional(),
  result_preview: z.string().optional(),
});
export const sseTokenSchema = z.object({ text: z.string() });
export const sseMessageSchema = z.object({
  id: z.string(),
  text: z.string(),
  citations: z.array(citationSchema).optional().default([]),
});
export const sseReplaceSchema = z.object({ id: z.string(), text: z.string() });
export const sseApprovalSchema = z.object({
  approval_id: z.string(),
  status: approvalStatusSchema,
  amount: money.nullable().optional(),
  summary: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});
export type SseApproval = z.infer<typeof sseApprovalSchema>;
export const sseDoneSchema = z.object({
  run_id: z.string().optional(),
  message_id: z.string().optional(),
});
export const sseErrorSchema = z.object({
  code: z.string(),
  message: z.string().optional().default(""),
});

/* ---------------- Orders ---------------- */
export const orderStatusSchema = z.enum(["processing", "shipped", "delivered", "cancelled"]);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

export const orderSummarySchema = z.object({
  id: z.string(),
  order_number: z.number(),
  placed_at: iso,
  delivered_at: iso.nullable().optional(),
  status: orderStatusSchema.or(z.string()),
  total: money,
  items_count: z.number(),
  shipping_country: z.string().optional(),
  thumbnail_category: z.string().nullable().optional(),
});
export type OrderSummary = z.infer<typeof orderSummarySchema>;
export const orderListSchema = z.object({ orders: z.array(orderSummarySchema) });

export const orderItemSchema = z.object({
  id: z.string(),
  sku: z.string(),
  name: z.string(),
  category: z.string(),
  qty: z.number(),
  unit_price: money,
  discount: money.optional().default(0),
  final_sale: z.boolean().optional().default(false),
  opened: z.boolean().nullable().optional(),
  return_status: z.string().nullable().optional(),
  refund_status: z.string().nullable().optional(),
});
export type OrderItem = z.infer<typeof orderItemSchema>;

export const orderDetailSchema = z.object({
  id: z.string(),
  order_number: z.number(),
  status: orderStatusSchema.or(z.string()),
  placed_at: iso,
  delivered_at: iso.nullable().optional(),
  shipping_country: z.string().optional(),
  shipping_cost: money.optional().default(0),
  total: money,
  customer_note: z.string().nullable().optional(),
  items: z.array(orderItemSchema),
});
export type OrderDetail = z.infer<typeof orderDetailSchema>;

/* ---------------- Memories ---------------- */
export const memorySchema = z.object({
  id: z.string(),
  content: z.string(),
  kind: z.string(),
  created_at: iso,
  source_thread_id: z.string().nullable().optional(),
});
export type Memory = z.infer<typeof memorySchema>;
export const memoryListSchema = z.object({ memories: z.array(memorySchema) });

/* ---------------- Approvals ---------------- */
export const approvalSummarySchema = z.object({
  id: z.string(),
  status: approvalStatusSchema,
  action: z.string(),
  amount: money,
  order_number: z.number().nullable().optional(),
  item_name: z.string().nullable().optional(),
  customer_name: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  created_at: iso,
  expires_at: iso.nullable().optional(),
  decided_at: iso.nullable().optional(),
});
export type ApprovalSummary = z.infer<typeof approvalSummarySchema>;
export const approvalListSchema = z.object({ approvals: z.array(approvalSummarySchema) });

export const policySectionSchema = z.object({
  section_id: z.string(),
  heading: z.string().optional().default(""),
  text: z.string().optional().default(""),
});

export const approvalDetailSchema = z.object({
  id: z.string(),
  status: approvalStatusSchema,
  action: z.string(),
  args: json.optional().default({}),
  amount: money,
  max_amount: money.nullable().optional(),
  order_number: z.number().nullable().optional(),
  item_name: z.string().nullable().optional(),
  customer_name: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  policy: z
    .object({
      decision: z.string().optional(),
      reasons: z.array(z.string()).optional().default([]),
      rule_ids: z.array(z.string()).optional().default([]),
    })
    .nullable()
    .optional(),
  evidence: z
    .object({
      order: z
        .object({
          order_number: z.number().optional(),
          delivered_at: iso.nullable().optional(),
          status: z.string().optional(),
        })
        .nullable()
        .optional(),
      eligibility: z
        .object({
          eligible: z.boolean(),
          reasons: z.array(z.string()).optional().default([]),
        })
        .nullable()
        .optional(),
      policy_sections: z.array(policySectionSchema).optional().default([]),
      prior_refunds_90d: z.number().optional().default(0),
    })
    .nullable()
    .optional(),
  agent_summary: z.string().nullable().optional(),
  thread_id: z.string().nullable().optional(),
  run_id: z.string().nullable().optional(),
  created_at: iso,
  expires_at: iso.nullable().optional(),
  decided_at: iso.nullable().optional(),
  decision: z
    .object({
      decision: z.string().optional(),
      amount: money.nullable().optional(),
      note: z.string().nullable().optional(),
      decided_by: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});
export type ApprovalDetail = z.infer<typeof approvalDetailSchema>;

export const decisionInputSchema = z.object({
  decision: z.enum(["approve", "approve_with_edit", "reject"]),
  amount: z.number().positive().optional(),
  note: z.string().max(500).optional(),
});
export type DecisionInput = z.infer<typeof decisionInputSchema>;

/* ---------------- Runs ---------------- */
export const runSchema = z.object({
  id: z.string(),
  thread_id: z.string().nullable().optional(),
  status: z.enum(["ok", "interrupted", "error"]).or(z.string()),
  route: z.string().nullable().optional(),
  model_primary: z.string().nullable().optional(),
  total_ms: z.number().nullable().optional(),
  llm_calls: z.number().nullable().optional(),
  tool_calls: z.number().nullable().optional(),
  tokens_in: z.number().nullable().optional(),
  tokens_out: z.number().nullable().optional(),
  created_at: iso,
  first_user_text: z.string().nullable().optional(),
});
export type Run = z.infer<typeof runSchema>;
export const runListSchema = z.object({ runs: z.array(runSchema) });

export const stepKindSchema = z.enum(["node", "llm", "tool", "guard", "policy", "interrupt", "job"]);
export type StepKind = z.infer<typeof stepKindSchema>;

export const runStepSchema = z.object({
  seq: z.number(),
  kind: stepKindSchema.or(z.string()),
  name: z.string(),
  model: z.string().nullable().optional(),
  started_at: iso,
  duration_ms: z.number().nullable().optional(),
  tokens_in: z.number().nullable().optional(),
  tokens_out: z.number().nullable().optional(),
  status: z.enum(["ok", "error", "interrupted"]).or(z.string()),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  error: z.string().nullable().optional(),
});
export type RunStep = z.infer<typeof runStepSchema>;
export const runDetailSchema = z.object({ run: runSchema, steps: z.array(runStepSchema) });
export type RunDetail = z.infer<typeof runDetailSchema>;

/* ---------------- Admin ---------------- */
export const metricsSchema = z.object({
  window_days: z.number(),
  kpis: z.object({
    runs: z.number(),
    success_rate: z.number(),
    approvals_pending: z.number(),
    approvals_decided: z.number(),
    avg_latency_ms: z.number(),
    p95_latency_ms: z.number(),
    tool_calls: z.number(),
    policy_violations: z.number(),
  }),
  runs_per_day: z.array(z.object({ day: z.string(), runs: z.number(), errors: z.number() })),
  latency_per_day: z.array(z.object({ day: z.string(), p50_ms: z.number(), p95_ms: z.number() })),
  routes: z.array(z.object({ route: z.string(), count: z.number() })),
  approvals: z.object({
    approved: z.number(),
    rejected: z.number(),
    expired: z.number(),
    pending: z.number(),
  }),
  quota: z.array(
    z.object({
      provider: z.string(),
      kind: z.string(),
      model: z.string().nullable().optional(),
      used: z.number(),
      limit: z.number(),
      tokens_used: z.number().nullable().optional(),
      token_limit: z.number().nullable().optional(),
    }),
  ),
  evals: z
    .object({
      suite: z.string(),
      git_sha: z.string().nullable().optional(),
      created_at: iso,
      total: z.number(),
      passed: z.number(),
      metrics: z.record(z.string(), z.number()),
    })
    .nullable(),
});
export type Metrics = z.infer<typeof metricsSchema>;

/* ---------------- Policies ---------------- */
export const policySchema = z.object({
  section_id: z.string(),
  doc: z.string(),
  doc_title: z.string(),
  heading: z.string(),
  text: z.string(),
});
export type Policy = z.infer<typeof policySchema>;

/** GET /v1/admin/profile — the active agent profile (SPEC §18.2). */
export const profileInfoSchema = z.object({
  label: z.string(),
  source: z.string(),
  default_label: z.string(),
  diff: z.array(z.object({ path: z.string(), default: z.unknown(), active: z.unknown() })),
  locked: z.array(z.string()),
  active: z.object({
    version: z.number(),
    created_by: z.string(),
    notes: z.string().optional().default(""),
    routing: z.object({ main_model: z.string(), fast_model: z.string(), use_fast_when: z.string() }),
    params: z.record(z.string(), z.number()),
    tool_descriptions: z.record(z.string(), z.string()),
    few_shots: z.array(z.object({ input: z.string(), output: z.string() })),
  }),
  agentforge: z.object({ url: z.string().nullable(), profile_source: z.string() }),
});
export type ProfileInfo = z.infer<typeof profileInfoSchema>;
