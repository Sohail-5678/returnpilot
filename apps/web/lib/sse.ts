/**
 * Minimal, spec-compliant Server-Sent Events parser for `fetch` streams
 * (EventSource can't POST, so the chat endpoint is read manually).
 *
 * - Handles \n, \r\n and \r line endings, including a \r\n split across chunks.
 * - Multiple `data:` lines are joined with "\n".
 * - Lines starting with ":" are comments (`: ping` keep-alives); they are reported
 *   via `onComment` but never dispatched as events.
 * - An event is dispatched on a blank line. A trailing event without a blank line
 *   is flushed when the stream ends.
 */
export interface SSEEvent {
  event: string;
  data: string;
  id?: string;
  retry?: number;
}

export class SSEParser {
  private buffer = "";
  private dataLines: string[] = [];
  private eventName = "";
  private lastId: string | undefined;
  private retry: number | undefined;
  private sawCR = false;
  private hasFields = false;

  constructor(private readonly onComment?: (text: string) => void) {}

  /** Feed a decoded text chunk; returns the events completed by this chunk. */
  push(chunk: string): SSEEvent[] {
    const out: SSEEvent[] = [];
    let text = chunk;
    // A previous chunk ended with "\r" — drop a leading "\n" so "\r\n" counts once.
    if (this.sawCR && text.startsWith("\n")) text = text.slice(1);
    this.sawCR = false;
    this.buffer += text;

    let start = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      const ch = this.buffer[i];
      if (ch !== "\n" && ch !== "\r") continue;
      const line = this.buffer.slice(start, i);
      if (ch === "\r") {
        if (i + 1 < this.buffer.length) {
          if (this.buffer[i + 1] === "\n") i++;
        } else {
          this.sawCR = true;
        }
      }
      start = i + 1;
      const ev = this.processLine(line);
      if (ev) out.push(ev);
    }
    this.buffer = this.buffer.slice(start);
    return out;
  }

  /** Call when the stream ends; returns a final event if one was pending. */
  flush(): SSEEvent[] {
    const out: SSEEvent[] = [];
    if (this.buffer.length > 0) {
      const ev = this.processLine(this.buffer);
      this.buffer = "";
      if (ev) out.push(ev);
    }
    const last = this.dispatch();
    if (last) out.push(last);
    return out;
  }

  private processLine(line: string): SSEEvent | null {
    if (line === "") return this.dispatch();
    if (line.startsWith(":")) {
      this.onComment?.(line.slice(1).trimStart());
      return null;
    }
    const colon = line.indexOf(":");
    let field: string;
    let value: string;
    if (colon === -1) {
      field = line;
      value = "";
    } else {
      field = line.slice(0, colon);
      value = line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
    }
    switch (field) {
      case "event":
        this.eventName = value;
        this.hasFields = true;
        break;
      case "data":
        this.dataLines.push(value);
        this.hasFields = true;
        break;
      case "id":
        if (!value.includes("\0")) this.lastId = value;
        break;
      case "retry":
        if (/^\d+$/.test(value)) this.retry = Number(value);
        break;
      default:
        break; // unknown fields are ignored per spec
    }
    return null;
  }

  private dispatch(): SSEEvent | null {
    if (!this.hasFields || this.dataLines.length === 0) {
      this.reset();
      return null;
    }
    const ev: SSEEvent = {
      event: this.eventName || "message",
      data: this.dataLines.join("\n"),
    };
    if (this.lastId !== undefined) ev.id = this.lastId;
    if (this.retry !== undefined) ev.retry = this.retry;
    this.reset();
    return ev;
  }

  private reset() {
    this.dataLines = [];
    this.eventName = "";
    this.hasFields = false;
  }
}

/**
 * Reads an SSE response body to completion, invoking `onEvent` for each event.
 * Resolves when the stream ends; rejects on network errors (but not on abort).
 */
export async function readSSE(
  body: ReadableStream<Uint8Array>,
  onEvent: (ev: SSEEvent) => void,
  opts: { signal?: AbortSignal; onComment?: (text: string) => void } = {},
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SSEParser(opts.onComment);
  const abort = () => reader.cancel().catch(() => {});
  opts.signal?.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const ev of parser.push(decoder.decode(value, { stream: true }))) onEvent(ev);
    }
    const tail = decoder.decode();
    if (tail) for (const ev of parser.push(tail)) onEvent(ev);
    for (const ev of parser.flush()) onEvent(ev);
  } catch (err) {
    if (opts.signal?.aborted) return;
    throw err;
  } finally {
    opts.signal?.removeEventListener("abort", abort);
  }
}

/** Serializes one SSE event (used by the mock backend). */
export function formatSSE(event: string, data: unknown): string {
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  const lines = payload.split(/\r\n|\r|\n/).map((l) => `data: ${l}`);
  return `event: ${event}\n${lines.join("\n")}\n\n`;
}
