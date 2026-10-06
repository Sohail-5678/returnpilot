import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleMock } from "@/lib/mock/handler";
import type { BackendClaims } from "@/lib/server/backend-token";
import { readSSE, type SSEEvent } from "@/lib/sse";

const ws = crypto.randomUUID();
const maya: BackendClaims = { sub: "demo:maya", role: "customer", persona: "maya", ws, name: "Maya Patel", sid: "s1" };
const riley: BackendClaims = { sub: "demo:reviewer", role: "reviewer", persona: "reviewer", ws, name: "Riley (Support Lead)", sid: "s2" };

function call(claims: BackendClaims, method: string, path: string, body?: unknown) {
  const [p, q] = path.split("?");
  return handleMock({
    method,
    segments: p!.split("/").filter(Boolean),
    search: new URLSearchParams(q ?? ""),
    body,
    claims,
    signal: new AbortController().signal,
  });
}

beforeAll(() => {
  process.env.MOCK_SPEED = "0";
});
afterAll(() => {
  delete process.env.MOCK_SPEED;
});

describe("mock backend (contract fixtures)", () => {
  it("streams Maya's boots refund: tools → message with citation → pending approval", async () => {
    const created = await call(maya, "POST", "threads", {});
    expect(created.status).toBe(201);
    const { thread_id } = (await created.json()) as { thread_id: string };

    const res = await call(maya, "POST", `threads/${thread_id}/messages`, {
      text: "I want to return the trail boots and get a refund. They're unopened.",
    });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events: SSEEvent[] = [];
    await readSSE(res.body!, (e) => events.push(e));
    const names = events.map((e) => e.event);

    expect(names[0]).toBe("run");
    expect(names.filter((n) => n === "tool").length).toBeGreaterThanOrEqual(6); // started + ok, ×3+
    expect(names).toContain("token");
    const msg = JSON.parse(events.find((e) => e.event === "message")!.data);
    expect(msg.citations[0].section_id).toBe("§2.1");
    const approval = JSON.parse(events.find((e) => e.event === "approval")!.data);
    expect(approval).toMatchObject({ status: "pending", amount: 129 });
    expect(names[names.length - 1]).toBe("done");

    // The reviewer sees it in the same workspace and approves it.
    const queue = (await (await call(riley, "GET", "approvals?status=pending")).json()) as { approvals: { id: string; amount: number }[] };
    expect(queue.approvals.find((a) => a.id === approval.approval_id)?.amount).toBe(129);

    const tooMuch = await call(riley, "POST", `approvals/${approval.approval_id}/decision`, { decision: "approve_with_edit", amount: 500 });
    expect(tooMuch.status).toBe(422);

    const ok = await call(riley, "POST", `approvals/${approval.approval_id}/decision`, { decision: "approve" });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { status: string }).status).toBe("approved");

    const again = await call(riley, "POST", `approvals/${approval.approval_id}/decision`, { decision: "reject", note: "x" });
    expect(again.status).toBe(409);
  });

  it("keeps customers and reviewers in their lanes", async () => {
    expect((await call(riley, "GET", "orders")).status).toBe(403);
    const orders = (await (await call(maya, "GET", "orders")).json()) as { orders: { order_number: number }[] };
    expect(orders.orders.map((o) => o.order_number)).toContain(1042);
    const detail = (await (await call(maya, "GET", "orders/1042")).json()) as { items: { name: string }[] };
    expect(detail.items[0]!.name).toBe("Trail Runner Boots");
  });

  it("serves policy sections by id", async () => {
    const res = await call(maya, "GET", `policies/${encodeURIComponent("§2.1")}`);
    expect(((await res.json()) as { heading: string }).heading).toBe("Standard window");
  });
});
