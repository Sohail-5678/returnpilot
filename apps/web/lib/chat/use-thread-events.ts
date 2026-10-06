"use client";

import { useEffect, useRef } from "react";

export type ThreadEventName = "approval" | "action" | "message";

/**
 * Subscribes to GET /api/v1/threads/{id}/events (EventSource). The server closes the
 * stream after ~280 s; the browser reconnects on its own, and when the connection is
 * refused (e.g. a 503 while the backend wakes) we reconnect with exponential backoff.
 */
export function useThreadEvents(
  threadId: string | null,
  onEvent: (name: ThreadEventName, data: unknown) => void,
  enabled = true,
) {
  const handler = useRef(onEvent);
  useEffect(() => {
    handler.current = onEvent;
  });

  useEffect(() => {
    if (!threadId || !enabled || typeof EventSource === "undefined") return;
    let es: EventSource | null = null;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      es = new EventSource(`/api/v1/threads/${encodeURIComponent(threadId)}/events`);
      es.onopen = () => {
        retry = 0;
      };
      for (const name of ["approval", "action", "message"] as const) {
        es.addEventListener(name, (e) => {
          let data: unknown;
          try {
            data = JSON.parse((e as MessageEvent<string>).data);
          } catch {
            return;
          }
          handler.current(name, data);
        });
      }
      es.onerror = () => {
        if (es && es.readyState === EventSource.CLOSED) {
          es.close();
          const delay = Math.min(30_000, 1_000 * 2 ** retry);
          retry += 1;
          timer = setTimeout(connect, delay);
        }
      };
    };

    connect();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      es?.close();
    };
  }, [threadId, enabled]);
}
