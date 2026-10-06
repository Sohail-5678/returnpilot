import {
  actionSchema,
  sseApprovalSchema,
  sseDoneSchema,
  sseErrorSchema,
  sseMessageSchema,
  sseReplaceSchema,
  sseRunSchema,
  sseStatusSchema,
  sseTokenSchema,
  sseToolSchema,
  type Action,
  type Citation,
  type MessageApproval,
  type SseApproval,
  type ToolCall,
} from "@/lib/schemas";
import type { SSEEvent } from "@/lib/sse";

/**
 * Client-side state for one in-flight chat turn, built from the SSE events in
 * API_CONTRACT §3 ("Send a message"). A turn can have several assistant segments;
 * tool calls attach to the segment that follows them, tokens to the latest open one.
 */
export interface LiveSegment {
  key: string;
  id?: string;
  text: string;
  tools: ToolCall[];
  citations: Citation[];
  closed: boolean;
  replaced?: boolean;
  approval?: MessageApproval | null;
}

export interface LiveTurn {
  userText: string;
  /** Number of server messages in the thread when this turn started. */
  baseCount: number;
  /** True once the refetched thread contains this turn (server copy replaces the live view). */
  synced?: boolean;
  startedAt: string;
  runId?: string;
  status: { stage: string; label: string } | null;
  segments: LiveSegment[];
  actions: Action[];
  approval?: SseApproval;
  error?: { code: string; message: string };
  done: boolean;
  messageId?: string;
}

export function startTurn(userText: string, baseCount = 0): LiveTurn {
  return {
    userText,
    baseCount,
    startedAt: new Date().toISOString(),
    status: { stage: "thinking", label: "Thinking…" },
    segments: [],
    actions: [],
    done: false,
  };
}

let segSeq = 0;
function newSegment(): LiveSegment {
  segSeq += 1;
  return { key: `seg-${segSeq}`, text: "", tools: [], citations: [], closed: false };
}

/** Returns segments with an open segment at the end (creating one if needed). */
function withOpenSegment(segments: LiveSegment[]): [LiveSegment[], LiveSegment] {
  const last = segments[segments.length - 1];
  if (last && !last.closed) {
    const copy = { ...last };
    return [[...segments.slice(0, -1), copy], copy];
  }
  const fresh = newSegment();
  return [[...segments, fresh], fresh];
}

function parse<T>(schema: { safeParse: (d: unknown) => { success: true; data: T } | { success: false } }, raw: string): T | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const r = schema.safeParse(data);
  return r.success ? r.data : null;
}

export function applyStreamEvent(turn: LiveTurn, ev: SSEEvent): LiveTurn {
  switch (ev.event) {
    case "run": {
      const d = parse(sseRunSchema, ev.data);
      return d ? { ...turn, runId: d.run_id } : turn;
    }
    case "status": {
      const d = parse(sseStatusSchema, ev.data);
      return d ? { ...turn, status: { stage: d.stage, label: d.label } } : turn;
    }
    case "tool": {
      const d = parse(sseToolSchema, ev.data);
      if (!d) return turn;
      const [segments, seg] = withOpenSegment(turn.segments);
      const tools = [...seg.tools];
      const idx = d.id
        ? tools.findIndex((t) => t.id === d.id)
        : tools.findLastIndex((t) => t.name === d.name && t.status === "running");
      const status: ToolCall["status"] = d.status === "started" ? "running" : d.status;
      if (idx === -1) {
        tools.push({
          id: d.id ?? `${d.name}-${tools.length}`,
          name: d.name,
          label: d.label ?? d.name,
          status,
          duration_ms: d.duration_ms ?? null,
          args: d.args ?? null,
          result_preview: d.result_preview ?? null,
        });
      } else {
        const prev = tools[idx]!;
        tools[idx] = {
          ...prev,
          status,
          label: d.label ?? prev.label,
          duration_ms: d.duration_ms ?? prev.duration_ms,
          args: d.args ?? prev.args,
          result_preview: d.result_preview ?? prev.result_preview,
        };
      }
      seg.tools = tools;
      const label = d.status === "started" ? (d.label ?? turn.status?.label ?? "Working…") : turn.status?.label ?? "";
      return { ...turn, segments, status: { stage: "tools", label } };
    }
    case "token": {
      const d = parse(sseTokenSchema, ev.data);
      if (!d) return turn;
      const [segments, seg] = withOpenSegment(turn.segments);
      seg.text = seg.text + d.text;
      return { ...turn, segments, status: { stage: "writing", label: turn.status?.label ?? "" } };
    }
    case "message": {
      const d = parse(sseMessageSchema, ev.data);
      if (!d) return turn;
      const [segments, seg] = withOpenSegment(turn.segments);
      seg.id = d.id;
      seg.text = d.text;
      seg.citations = d.citations;
      seg.closed = true;
      return { ...turn, segments };
    }
    case "replace": {
      const d = parse(sseReplaceSchema, ev.data);
      if (!d) return turn;
      let found = false;
      const segments = turn.segments.map((s) => {
        if (s.id === d.id) {
          found = true;
          return { ...s, text: d.text, replaced: true };
        }
        return s;
      });
      if (!found && segments.length > 0) {
        const last = segments[segments.length - 1]!;
        segments[segments.length - 1] = { ...last, id: last.id ?? d.id, text: d.text, replaced: true };
      }
      return { ...turn, segments };
    }
    case "approval": {
      const d = parse(sseApprovalSchema, ev.data);
      if (!d) return turn;
      const segments = [...turn.segments];
      for (let i = segments.length - 1; i >= 0; i--) {
        if (segments[i]!.text) {
          segments[i] = {
            ...segments[i]!,
            approval: { approval_id: d.approval_id, status: d.status, amount: d.amount ?? null, note: d.note ?? null },
          };
          break;
        }
      }
      return { ...turn, segments, approval: d };
    }
    case "action": {
      const d = parse(actionSchema, ev.data);
      if (!d) return turn;
      const actions = turn.actions.filter((a) => a.id !== d.id);
      actions.push(d);
      return { ...turn, actions };
    }
    case "done": {
      const d = parse(sseDoneSchema, ev.data);
      const segments = turn.segments.map((s) => (s.closed ? s : { ...s, closed: true }));
      return { ...turn, segments, done: true, status: null, runId: d?.run_id ?? turn.runId, messageId: d?.message_id };
    }
    case "error": {
      const d = parse(sseErrorSchema, ev.data) ?? { code: "internal", message: "Something went wrong." };
      const segments = turn.segments.map((s) => (s.closed ? s : { ...s, closed: true }));
      return { ...turn, segments, error: { code: d.code, message: d.message }, done: true, status: null };
    }
    default:
      return turn;
  }
}
