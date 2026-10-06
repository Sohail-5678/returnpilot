import type { RunStep } from "@/lib/schemas";
import type { MockRun } from "./types";

export const MODEL_MAIN = "llama-3.3-70b-versatile";
export const MODEL_SMALL = "llama-3.1-8b-instant";
export const MODEL_FALLBACK = "gemini-2.5-flash";

export interface StepSpec {
  kind: RunStep["kind"];
  name: string;
  model?: string | null;
  ms: number;
  /** Idle gap before this step starts (ms). */
  gap?: number;
  tokens_in?: number;
  tokens_out?: number;
  status?: RunStep["status"];
  input?: unknown;
  output?: unknown;
  error?: string | null;
}

export function buildSteps(startMs: number, specs: StepSpec[], seqStart = 1) {
  let cursor = startMs;
  const steps: RunStep[] = specs.map((s, i) => {
    cursor += s.gap ?? 6;
    const step: RunStep = {
      seq: seqStart + i,
      kind: s.kind,
      name: s.name,
      model: s.model ?? null,
      started_at: new Date(cursor).toISOString(),
      duration_ms: s.ms,
      tokens_in: s.tokens_in ?? null,
      tokens_out: s.tokens_out ?? null,
      status: s.status ?? "ok",
      input: s.input ?? null,
      output: s.output ?? null,
      error: s.error ?? null,
    };
    cursor += s.ms;
    return step;
  });
  return { steps, endMs: cursor };
}

/** Idle gaps longer than this (e.g. waiting for a human) don't count as run time. */
export const IDLE_GAP_MS = 2_000;

export function summarize(run: MockRun) {
  const steps = [...run.steps].sort((a, b) => a.seq - b.seq);
  let cursor = new Date(run.run.created_at).getTime();
  let active = 0;
  for (const s of steps) {
    const st = new Date(s.started_at).getTime();
    const gap = st - cursor;
    if (gap > 0 && gap <= IDLE_GAP_MS) active += gap;
    active += s.duration_ms ?? 0;
    cursor = Math.max(cursor, st + (s.duration_ms ?? 0));
  }
  run.run.total_ms = Math.round(active);
  run.run.llm_calls = steps.filter((s) => s.kind === "llm").length;
  run.run.tool_calls = steps.filter((s) => s.kind === "tool").length;
  run.run.tokens_in = steps.reduce((a, s) => a + (s.tokens_in ?? 0), 0);
  run.run.tokens_out = steps.reduce((a, s) => a + (s.tokens_out ?? 0), 0);
  return run;
}

export function buildRun(opts: {
  id?: string;
  thread_id: string | null;
  customer_id: string | null;
  status: "ok" | "interrupted" | "error";
  route: string;
  startMs: number;
  first_user_text: string;
  specs: StepSpec[];
  model_primary?: string;
}): MockRun {
  const { steps } = buildSteps(opts.startMs, opts.specs);
  const run: MockRun = {
    customer_id: opts.customer_id,
    steps,
    run: {
      id: opts.id ?? crypto.randomUUID(),
      thread_id: opts.thread_id,
      status: opts.status,
      route: opts.route,
      model_primary: opts.model_primary ?? MODEL_MAIN,
      total_ms: 0,
      llm_calls: 0,
      tool_calls: 0,
      tokens_in: 0,
      tokens_out: 0,
      created_at: new Date(opts.startMs).toISOString(),
      first_user_text: opts.first_user_text,
    },
  };
  return summarize(run);
}

/** Steps every turn starts with: context → guard → router → first agent call. */
export function preamble(text: string, route: string, memories: number, toolCalls: string[]): StepSpec[] {
  return [
    {
      kind: "node",
      name: "load_context",
      ms: 118,
      gap: 4,
      input: { thread: "…", latest_message: text },
      output: { memories_loaded: memories, history_messages: 4, summary: null },
    },
    {
      kind: "guard",
      name: "input_guard",
      ms: 9,
      input: { length: text.length },
      output: { blocked: false, injection_suspected: false, pii_masked: 0 },
    },
    {
      kind: "llm",
      name: "route",
      model: MODEL_SMALL,
      ms: 214,
      tokens_in: 318,
      tokens_out: 9,
      input: { messages: 1, schema: "Route" },
      output: { route },
    },
    {
      kind: "llm",
      name: "agent",
      model: MODEL_MAIN,
      ms: 702,
      tokens_in: 1864,
      tokens_out: 58,
      input: { tools_bound: 9, temperature: 0.2 },
      output: { tool_calls: toolCalls },
    },
  ];
}

export function closing(tokensOut = 96): StepSpec[] {
  return [
    {
      kind: "llm",
      name: "respond",
      model: MODEL_MAIN,
      ms: 1180,
      tokens_in: 2412,
      tokens_out: tokensOut,
      input: { tool_results: "…" },
      output: { finish_reason: "stop" },
    },
    {
      kind: "guard",
      name: "output_guard",
      ms: 14,
      output: { amounts_match_tools: true, citations_exist: true, other_customer_data: false },
    },
    {
      kind: "llm",
      name: "write_memory",
      model: MODEL_SMALL,
      ms: 236,
      gap: 40,
      tokens_in: 402,
      tokens_out: 21,
      output: { candidates: 0, stored: 0 },
    },
  ];
}
