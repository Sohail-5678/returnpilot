"use client";

import { Bot, Clock3, Coins, MessagesSquare, Route as RouteIcon, Wrench } from "lucide-react";
import Link from "next/link";
import { use } from "react";
import { TraceTimeline } from "@/components/runs/trace-timeline";
import { useAppUser } from "@/components/session-context";
import { BackLink } from "@/components/shell/page-header";
import { ErrorState } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { InkChip, InkPanel } from "@/components/ui/ink-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { statusMeta } from "@/components/ui/status-badge";
import { useRun } from "@/lib/api/hooks";
import { formatDateTime, formatMs, formatNumber, routeLabel } from "@/lib/utils";

export default function RunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params);
  const q = useRun(runId);
  const user = useAppUser();

  if (q.isError) {
    return (
      <div>
        <BackLink href="/runs">Runs</BackLink>
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </div>
    );
  }
  const r = q.data?.run;
  const meta = statusMeta(r?.status);
  const Icon = meta.icon;

  return (
    <div>
      <BackLink href="/runs">Runs</BackLink>
      <InkPanel innerClassName="rounded-t-hero px-6 pb-28 pt-8 sm:px-10 sm:pt-10" className="rounded-t-hero">
        {r ? (
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap gap-2">
                <InkChip>Trace</InkChip>
                <InkChip>
                  <Icon size={14} aria-hidden /> {r.status === "interrupted" ? "Paused for approval" : meta.label}
                </InkChip>
                <InkChip>
                  <RouteIcon size={14} aria-hidden /> {routeLabel(r.route)}
                </InkChip>
              </div>
              <h1 className="mt-4 max-w-[30ch] text-[26px] font-extrabold leading-tight tracking-[-0.03em] sm:text-[34px]">“{r.first_user_text}”</h1>
              <p className="mt-2 text-[14px] text-white/75">
                {formatDateTime(r.created_at)} · <span className="font-mono">{r.id.slice(0, 8)}</span>
              </p>
            </div>
            {user?.role === "customer" && r.thread_id ? (
              <Button asChild variant="ink">
                <Link href={`/chat/${r.thread_id}`}>
                  <MessagesSquare size={17} aria-hidden /> Open conversation
                </Link>
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="space-y-4" aria-label="Loading run">
            <Skeleton className="h-8 w-48 rounded-full bg-white/10 shadow-none" />
            <Skeleton className="h-10 w-96 max-w-full rounded-full bg-white/10 shadow-none" />
          </div>
        )}
      </InkPanel>

      <div className="relative z-10 -mt-16 space-y-6 px-2 sm:px-6">
        <dl className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[
            { icon: Clock3, label: "Total time", value: formatMs(r?.total_ms) },
            { icon: Bot, label: "LLM calls", value: formatNumber(r?.llm_calls) },
            { icon: Wrench, label: "Tool calls", value: formatNumber(r?.tool_calls) },
            { icon: Coins, label: "Tokens in → out", value: r ? `${formatNumber(r.tokens_in)} → ${formatNumber(r.tokens_out)}` : "—" },
          ].map((s) => (
            <div key={s.label} className="neu rounded-[24px] p-4 sm:p-5">
              <dt className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-[0.12em] text-ink-faint">
                <s.icon size={13} aria-hidden /> {s.label}
              </dt>
              <dd className="mt-1.5 text-[22px] font-extrabold tracking-tight text-ink tabular-nums">{r ? s.value : "…"}</dd>
            </div>
          ))}
        </dl>

        <section className="neu rounded-card p-4 sm:p-6" aria-labelledby="timeline-title">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="timeline-title" className="text-[17px] font-bold tracking-tight text-ink">
              Timeline
            </h2>
            <p className="text-[12.5px] text-ink-faint">Bars are positioned and scaled to the whole run. Click a step for its input and output.</p>
          </div>
          {q.data ? (
            <TraceTimeline steps={q.data.steps} />
          ) : (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-14 rounded-[22px]" />
              ))}
            </div>
          )}
          {user?.role !== "admin" ? (
            <p className="mt-4 text-[12.5px] text-ink-faint">Model prompts are redacted on customer traces.</p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
