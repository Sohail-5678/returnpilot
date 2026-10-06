"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { qk } from "@/lib/api/hooks";
import { toApiError } from "@/lib/api/client";
import { backendStatus, reportApiError } from "@/lib/backend-status";
import { readSSE } from "@/lib/sse";
import { applyStreamEvent, startTurn, type LiveTurn } from "./stream-reducer";

export interface ChatError {
  code: string;
  message: string;
  text: string;
}

/**
 * Sends a message and streams the assistant's reply (SSE over fetch POST).
 * When the stream ends the thread is refetched (source of truth); the turn is then
 * marked `synced` and the view switches to the server copy without re-animating.
 */
export function useChatStream() {
  const qc = useQueryClient();
  const [turn, setTurn] = useState<LiveTurn | null>(null);
  const [error, setError] = useState<ChatError | null>(null);
  /** message id → run id, for "Trace" links on messages produced in this session. */
  const [runs, setRuns] = useState<Record<string, string>>({});
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(
    async (threadId: string, text: string, baseCount = 0) => {
      abortRef.current?.abort();
      const ctl = new AbortController();
      abortRef.current = ctl;
      setError(null);
      let current = startTurn(text, baseCount);
      setTurn(current);

      const fail = (code: string, message: string) => {
        setError({ code, message, text });
        if (code === "quota_exhausted") backendStatus.setQuota(true);
      };

      try {
        const res = await fetch(`/api/v1/threads/${encodeURIComponent(threadId)}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({ text }),
          signal: ctl.signal,
          cache: "no-store",
        });
        if (!res.ok || !res.body) {
          const err = await toApiError(res);
          reportApiError(err);
          fail(err.code, err.message);
          setTurn(null);
          return;
        }
        await readSSE(
          res.body,
          (ev) => {
            current = applyStreamEvent(current, ev);
            setTurn(current);
          },
          { signal: ctl.signal },
        );
        if (current.error) fail(current.error.code, current.error.message);
        const { runId, messageId } = current;
        if (runId && messageId) setRuns((m) => ({ ...m, [messageId]: runId }));
      } catch {
        if (ctl.signal.aborted) return;
        fail("network", "The connection dropped before the reply finished.");
      }

      if (ctl.signal.aborted) return;
      await Promise.allSettled([
        qc.refetchQueries({ queryKey: qk.thread(threadId) }),
        qc.invalidateQueries({ queryKey: qk.threads }),
      ]);
      // Swap to the server copy only once it is in the cache (no flicker, no loss).
      const synced = qc.getQueryState(qk.thread(threadId))?.status === "success";
      if (abortRef.current === ctl) setTurn((t) => (t ? { ...t, done: true, status: null, synced } : t));
    },
    [qc],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  return {
    turn,
    liveTurn: turn && !turn.synced ? turn : null,
    runs,
    error,
    send,
    stop,
    streaming: !!turn && !turn.done,
    clearError: () => setError(null),
  };
}
