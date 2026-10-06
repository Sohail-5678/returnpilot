import { describe, expect, it, vi } from "vitest";
import { formatSSE, readSSE, SSEParser, type SSEEvent } from "@/lib/sse";

function feed(chunks: string[], onComment?: (t: string) => void) {
  const p = new SSEParser(onComment);
  const out: SSEEvent[] = [];
  for (const c of chunks) out.push(...p.push(c));
  out.push(...p.flush());
  return out;
}

describe("SSEParser", () => {
  it("parses a single named event", () => {
    expect(feed(['event: run\ndata: {"run_id":"r1"}\n\n'])).toEqual([{ event: "run", data: '{"run_id":"r1"}' }]);
  });

  it("defaults the event name to 'message'", () => {
    expect(feed(["data: hi\n\n"])).toEqual([{ event: "message", data: "hi" }]);
  });

  it("handles chunk boundaries anywhere, including inside field names and values", () => {
    const raw = 'event: token\ndata: {"text":"Yes — "}\n\nevent: done\ndata: {"run_id":"r"}\n\n';
    // Split into 1-character chunks: the worst case.
    const events = feed(raw.split(""));
    expect(events).toEqual([
      { event: "token", data: '{"text":"Yes — "}' },
      { event: "done", data: '{"run_id":"r"}' },
    ]);
  });

  it("treats CRLF split across chunks as a single line break", () => {
    const events = feed(["event: tool\r", "\ndata: x\r", "\n\r", "\n"]);
    expect(events).toEqual([{ event: "tool", data: "x" }]);
  });

  it("supports bare CR line endings", () => {
    expect(feed(["event: a\rdata: 1\r\r"])).toEqual([{ event: "a", data: "1" }]);
  });

  it("ignores `: ping` comments but reports them", () => {
    const onComment = vi.fn();
    const events = feed([": ping\n\n", "event: status\ndata: {}\n\n", ": ping\n\n"], onComment);
    expect(events).toEqual([{ event: "status", data: "{}" }]);
    expect(onComment).toHaveBeenCalledTimes(2);
    expect(onComment).toHaveBeenCalledWith("ping");
  });

  it("joins multi-line data with newlines and strips one leading space", () => {
    const events = feed(["event: message\ndata: line one\ndata:  two (indented)\ndata:three\n\n"]);
    expect(events[0]!.data).toBe("line one\n two (indented)\nthree");
  });

  it("flushes a final event that has no trailing blank line", () => {
    expect(feed(["event: done\ndata: {}"])).toEqual([{ event: "done", data: "{}" }]);
  });

  it("does not dispatch events without data", () => {
    expect(feed(["event: lonely\n\n"])).toEqual([]);
  });

  it("keeps id and retry fields", () => {
    expect(feed(["id: 7\nretry: 3000\ndata: x\n\n"])).toEqual([{ event: "message", data: "x", id: "7", retry: 3000 }]);
  });

  it("round-trips formatSSE output, including multi-line payloads", () => {
    const wire = formatSSE("message", "a\nb") + formatSSE("approval", { status: "pending", amount: 129 });
    expect(feed([wire])).toEqual([
      { event: "message", data: "a\nb" },
      { event: "approval", data: '{"status":"pending","amount":129}' },
    ]);
  });
});

describe("readSSE", () => {
  it("reads a byte stream with multibyte characters split across chunks", async () => {
    const bytes = new TextEncoder().encode('event: token\ndata: {"text":"§2.1 — ok"}\n\n: ping\n\nevent: done\ndata: {}\n\n');
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < bytes.length; i += 3) c.enqueue(bytes.slice(i, i + 3));
        c.close();
      },
    });
    const seen: SSEEvent[] = [];
    await readSSE(stream, (e) => seen.push(e));
    expect(seen.map((e) => e.event)).toEqual(["token", "done"]);
    expect(JSON.parse(seen[0]!.data).text).toBe("§2.1 — ok");
  });

  it("stops quietly when aborted", async () => {
    const ctl = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode("event: a\ndata: 1\n\n"));
      },
    });
    const seen: SSEEvent[] = [];
    const p = readSSE(stream, (e) => {
      seen.push(e);
      ctl.abort();
    }, { signal: ctl.signal });
    await expect(p).resolves.toBeUndefined();
    expect(seen).toHaveLength(1);
  });
});
