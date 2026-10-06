"use client";

import { Activity, ArrowRight, Bot, Coins, Wrench } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useAppUser } from "@/components/session-context";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState, ErrorState } from "@/components/states/states";
import { ListSkeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { useRuns } from "@/lib/api/hooks";
import { useNow } from "@/lib/use-now";
import { formatMs, formatNumber, relativeTime, routeLabel } from "@/lib/utils";

export default function RunsPage() {
  const user = useAppUser();
  const q = useRuns();
  const now = useNow(30_000);
  const maxMs = Math.max(1, ...(q.data ?? []).map((r) => r.total_ms ?? 0));

  return (
    <div>
      <PageHeader
        icon={Activity}
        tone="sky"
        eyebrow="Tracing"
        title="Runs"
        description={
          user?.role === "admin"
            ? "Every agent run in this workspace, step by step: routing, LLM calls, MCP tools, policy checks, approvals and jobs."
            : "Traces of your own conversations (personal details redacted). See exactly what the agent did and why."
        }
      />

      {q.isLoading ? (
        <ListSkeleton count={4} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState icon={Activity} tone="sky" title="No runs yet" body="Each message you send creates a traced run." />
      ) : (
        <div>
          <div className="mb-2 hidden grid-cols-[minmax(0,2.4fr)_110px_minmax(0,1.2fr)_minmax(0,1fr)_70px_90px_80px] gap-4 px-6 text-[11.5px] font-bold uppercase tracking-[0.14em] text-ink-faint lg:grid">
            <span>Request</span>
            <span>Route</span>
            <span>Model</span>
            <span>Latency</span>
            <span>Tools</span>
            <span>Tokens</span>
            <span className="text-right">When</span>
          </div>
          <ul className="space-y-3.5">
            {q.data.map((r, i) => (
              <motion.li
                key={r.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 12) * 0.035 }}
              >
                <Link
                  href={`/runs/${r.id}`}
                  className="neu-lift group grid grid-cols-1 items-center gap-x-4 gap-y-3 rounded-[24px] px-5 py-4 lg:grid-cols-[minmax(0,2.4fr)_110px_minmax(0,1.2fr)_minmax(0,1fr)_70px_90px_80px] lg:px-6"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <StatusBadge status={r.status} size="sm" label={r.status === "interrupted" ? "Paused" : undefined} />
                    <span className="truncate text-[14.5px] font-semibold text-ink">“{r.first_user_text ?? "—"}”</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-soft lg:contents">
                    <span className="w-fit rounded-full bg-sunken px-2.5 py-1 font-semibold text-ink-soft">{routeLabel(r.route)}</span>
                    <span className="inline-flex min-w-0 items-center gap-1.5 truncate font-mono text-[12px]">
                      <Bot size={13} className="shrink-0 text-ink-faint" aria-hidden /> <span className="truncate">{r.model_primary ?? "—"}</span>
                    </span>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-1.5 w-full max-w-24 overflow-hidden rounded-full bg-sunken shadow-inset-sm" aria-hidden>
                        <span className="block h-full rounded-full bg-accent-gradient" style={{ width: `${Math.max(6, ((r.total_ms ?? 0) / maxMs) * 100)}%` }} />
                      </span>
                      <span className="shrink-0 font-mono text-[12px] tabular-nums">{formatMs(r.total_ms)}</span>
                    </span>
                    <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                      <Wrench size={12} className="text-ink-faint lg:hidden" aria-hidden /> {r.tool_calls ?? 0}
                      <span className="lg:sr-only"> tools</span>
                    </span>
                    <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                      <Coins size={12} className="text-ink-faint lg:hidden" aria-hidden />
                      {formatNumber((r.tokens_in ?? 0) + (r.tokens_out ?? 0))}
                      <span className="lg:sr-only"> tokens</span>
                    </span>
                    <span className="inline-flex items-center justify-end gap-1 text-ink-faint lg:text-right">
                      {relativeTime(r.created_at, now)}
                      <ArrowRight size={13} className="hidden text-accent-ink transition-transform group-hover:translate-x-0.5 lg:inline" aria-hidden />
                    </span>
                  </div>
                </Link>
              </motion.li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
