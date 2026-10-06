import { describe, expect, it } from "vitest";
import { applyStreamEvent, startTurn, type LiveTurn } from "@/lib/chat/stream-reducer";

const ev = (event: string, data: unknown) => ({ event, data: JSON.stringify(data) });

function run(events: { event: string; data: string }[]): LiveTurn {
  return events.reduce(applyStreamEvent, startTurn("Can I return the boots?", 2));
}

describe("applyStreamEvent", () => {
  it("builds multiple assistant segments with tools attached to the following text", () => {
    const t = run([
      ev("run", { run_id: "r1" }),
      ev("status", { stage: "thinking", label: "Thinking…" }),
      ev("token", { text: "Let me check." }),
      ev("message", { id: "m1", text: "Let me check.", citations: [] }),
      ev("tool", { id: "c1", name: "get_order", status: "started", label: "Looking up order #1042" }),
      ev("tool", { id: "c1", name: "get_order", status: "ok", label: "Looked up order #1042", duration_ms: 312 }),
      ev("token", { text: "Yes — " }),
      ev("token", { text: "eligible [Policy §2.1]." }),
      ev("message", { id: "m2", text: "Yes — eligible [Policy §2.1].", citations: [{ section_id: "§2.1" }] }),
      ev("done", { run_id: "r1", message_id: "m2" }),
    ]);
    expect(t.runId).toBe("r1");
    expect(t.baseCount).toBe(2);
    expect(t.segments).toHaveLength(2);
    expect(t.segments[0]).toMatchObject({ id: "m1", text: "Let me check.", tools: [], closed: true });
    expect(t.segments[1]!.tools).toEqual([
      expect.objectContaining({ id: "c1", status: "ok", label: "Looked up order #1042", duration_ms: 312 }),
    ]);
    expect(t.segments[1]!.citations[0]!.section_id).toBe("§2.1");
    expect(t.done).toBe(true);
    expect(t.messageId).toBe("m2");
    expect(t.status).toBeNull();
  });

  it("marks running tools and moves the status to the tools stage", () => {
    const t = run([ev("tool", { id: "c1", name: "list_orders", status: "started", label: "Looking up your orders" })]);
    expect(t.segments[0]!.tools[0]!.status).toBe("running");
    expect(t.status).toEqual({ stage: "tools", label: "Looking up your orders" });
  });

  it("attaches a pending approval to the last text segment and collects actions", () => {
    const t = run([
      ev("message", { id: "m1", text: "Sent for approval.", citations: [] }),
      ev("approval", { approval_id: "a1", status: "pending", amount: 129, summary: "Refund $129.00" }),
      ev("action", { id: "x1", kind: "refund", status: "pending_approval", label: "Refund $129.00", updated_at: "2026-10-05T00:00:00Z" }),
      ev("action", { id: "x1", kind: "refund", status: "queued", label: "Refund $129.00", updated_at: "2026-10-05T00:00:01Z" }),
    ]);
    expect(t.segments[0]!.approval).toEqual({ approval_id: "a1", status: "pending", amount: 129, note: null });
    expect(t.actions).toHaveLength(1);
    expect(t.actions[0]!.status).toBe("queued");
  });

  it("applies guard replacements to the matching segment", () => {
    const t = run([
      ev("message", { id: "m1", text: "risky text", citations: [] }),
      ev("replace", { id: "m1", text: "safe text" }),
    ]);
    expect(t.segments[0]).toMatchObject({ text: "safe text", replaced: true });
  });

  it("records errors and ends the turn", () => {
    const t = run([ev("token", { text: "Partial" }), ev("error", { code: "quota_exhausted", message: "Used up" })]);
    expect(t.error).toEqual({ code: "quota_exhausted", message: "Used up" });
    expect(t.done).toBe(true);
    expect(t.segments[0]!.closed).toBe(true);
  });

  it("ignores malformed payloads and unknown events", () => {
    const start = startTurn("x");
    expect(applyStreamEvent(start, { event: "token", data: "not json" })).toBe(start);
    expect(applyStreamEvent(start, { event: "mystery", data: "{}" })).toBe(start);
  });
});
