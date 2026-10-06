"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Pings /api/health on load (which also wakes the free backend early) and shows
 * whether the demo server is ready.
 */
export function ServerStatus({ className, onInk }: { className?: string; onInk?: boolean }) {
  const [state, setState] = useState<"checking" | "ready" | "waking">("checking");
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as { status?: string };
        if (stop) return;
        if (res.ok && (data.status === "ok" || data.status === "degraded")) {
          setState("ready");
          return;
        }
      } catch {
        /* fall through */
      }
      if (stop) return;
      setState("waking");
      timer = setTimeout(check, 4000);
    };
    void check();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, []);

  const label = state === "ready" ? "Demo server ready" : state === "waking" ? "Waking demo server…" : "Checking server…";
  return (
    <span
      role="status"
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[12.5px] font-semibold",
        onInk ? "glass text-white" : "bg-surface text-ink-soft shadow-raised-sm",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          state === "ready" ? "bg-emerald-400 shadow-[0_0_10px_#34d399]" : state === "waking" ? "animate-pulse bg-amber-400" : "bg-slate-400",
        )}
      />
      {label}
    </span>
  );
}
