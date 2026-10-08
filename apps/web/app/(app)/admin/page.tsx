"use client";

import {
  Activity,
  CircleCheck,
  ClipboardCheck,
  FlaskConical,
  Gauge,
  GitCommitHorizontal,
  Hourglass,
  Lock,
  SlidersHorizontal,
  ShieldCheck,
  Timer,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { ApprovalsDonut, LatencyChart, RoutesChart, RunsChart } from "@/components/charts/charts";
import { ErrorState } from "@/components/states/states";
import { GlyphTile, type Tone } from "@/components/ui/glyph-tile";
import { InkChip, InkPanel } from "@/components/ui/ink-panel";
import { CountUp, ProgressRing } from "@/components/ui/misc";
import { Skeleton } from "@/components/ui/skeleton";
import { useMetrics, useProfileInfo } from "@/lib/api/hooks";
import type { Metrics, ProfileInfo } from "@/lib/schemas";
import { cn, formatDateTime, titleCase } from "@/lib/utils";

const WINDOWS = [7, 14, 30];

export default function AdminPage() {
  const [days, setDays] = useState(7);
  const q = useMetrics(days);
  const m = q.data;

  return (
    <div>
      <div className="pt-4 md:pt-6">
        <InkPanel innerClassName="rounded-t-hero px-6 pb-32 pt-8 sm:px-10 sm:pt-10" className="rounded-t-hero">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div>
              <InkChip>
                <span className="size-2 rounded-full bg-[#86EFAC] shadow-[0_0_10px_#86EFAC]" aria-hidden /> Operations
              </InkChip>
              <h1 className="mt-4 text-[34px] font-extrabold leading-tight tracking-[-0.035em] sm:text-[42px]">How the agent is doing</h1>
              <p className="mt-2 max-w-[56ch] text-[15px] leading-relaxed text-white/80">
                Runs, latency, approvals, free-tier LLM quota and the latest evaluation — for this demo workspace.
              </p>
            </div>
            <div role="group" aria-label="Time window" className="glass inline-flex w-fit gap-1 rounded-full p-1.5">
              {WINDOWS.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={days === d}
                  onClick={() => setDays(d)}
                  className={cn(
                    "min-h-11 rounded-full px-4 text-sm font-bold transition-colors",
                    days === d ? "bg-white text-[#23224a] shadow-[0_8px_20px_-8px_rgba(0,0,0,.6)]" : "text-white/80 hover:text-white",
                  )}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>
        </InkPanel>
      </div>

      <div className="relative z-10 -mt-20 space-y-6 px-2 sm:px-6">
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <>
            <Kpis m={m} />
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <Panel title="Runs per day" icon={Activity} tone="violet">
                {m ? <RunsChart data={m.runs_per_day} /> : <Skeleton className="h-64 rounded-2xl" />}
              </Panel>
              <Panel title="Latency" icon={Timer} tone="sky" hint="Full agent turn, per day">
                {m ? <LatencyChart data={m.latency_per_day} /> : <Skeleton className="h-64 rounded-2xl" />}
              </Panel>
              <Panel title="Routes" icon={GitCommitHorizontal} tone="sunset" hint="What people asked about">
                {m ? <RoutesChart data={m.routes} /> : <Skeleton className="h-60 rounded-2xl" />}
              </Panel>
              <Panel
                title="Approvals"
                icon={ClipboardCheck}
                tone="amber"
                hint={
                  <Link href="/reviews" className="font-semibold text-accent-ink hover:underline">
                    Open queue
                  </Link>
                }
              >
                {m ? <ApprovalsDonut data={m.approvals} /> : <Skeleton className="h-44 rounded-2xl" />}
              </Panel>
            </div>
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
              <Panel title="LLM quota today" icon={Gauge} tone="teal" hint="Free tiers · the guard switches provider at 90%">
                {m ? <Quota quota={m.quota} /> : <Skeleton className="h-48 rounded-2xl" />}
              </Panel>
              <Panel title="Latest evaluation" icon={FlaskConical} tone="mint" hint="30 scenarios · trajectory checks">
                {m ? <Evals evals={m.evals} /> : <Skeleton className="h-48 rounded-2xl" />}
              </Panel>
            </div>
            <ProfilePanel />
          </>
        )}
      </div>
    </div>
  );
}

function Panel({ title, icon, tone, hint, children }: { title: string; icon: LucideIcon; tone: Tone; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <motion.section initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="neu rounded-card p-5 sm:p-6" aria-label={title}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <GlyphTile icon={icon} tone={tone} size="sm" />
        <h2 className="text-[16.5px] font-bold tracking-tight text-ink">{title}</h2>
        {hint ? <span className="ml-auto text-[12.5px] text-ink-faint">{hint}</span> : null}
      </div>
      {children}
    </motion.section>
  );
}

function Kpis({ m }: { m?: Metrics }) {
  const k = m?.kpis;
  const tiles: { label: string; icon: LucideIcon; tone: Tone; value?: number; format?: (n: number) => string; note?: string }[] = [
    { label: "Runs", icon: Activity, tone: "violet", value: k?.runs },
    { label: "Success rate", icon: CircleCheck, tone: "mint", value: k ? k.success_rate * 100 : undefined, format: (n) => `${n.toFixed(1)}%` },
    { label: "Avg latency", icon: Timer, tone: "sky", value: k ? k.avg_latency_ms / 1000 : undefined, format: (n) => `${n.toFixed(1)}s`, note: k ? `p95 ${(k.p95_latency_ms / 1000).toFixed(1)}s` : undefined },
    { label: "Tool calls", icon: Wrench, tone: "sunset", value: k?.tool_calls },
    { label: "Pending approvals", icon: Hourglass, tone: "amber", value: k?.approvals_pending },
    { label: "Decided", icon: ClipboardCheck, tone: "teal", value: k?.approvals_decided },
    { label: "Policy violations", icon: ShieldCheck, tone: "mint", value: k?.policy_violations, note: k && k.policy_violations === 0 ? "Target: 0 — met" : undefined },
    { label: "LLM calls today", icon: Gauge, tone: "violet", value: m ? m.quota.reduce((a, q) => a + (q.kind === "embed" || q.kind === "guard" ? 0 : q.used), 0) : undefined },
  ];
  return (
    <ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {tiles.map((t, i) => (
        <motion.li
          key={t.label}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.04, type: "spring", damping: 24, stiffness: 240 }}
          className="neu rounded-[26px] p-4 sm:p-5"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-ink-faint">{t.label}</p>
            <GlyphTile icon={t.icon} tone={t.tone} size="sm" well="none" />
          </div>
          <div className="mt-2 text-[28px] font-extrabold leading-none tracking-[-0.03em] text-ink sm:text-[32px]">
            {t.value !== undefined ? <CountUp value={t.value} format={t.format} /> : <Skeleton className="h-8 w-20 rounded-full" />}
          </div>
          {t.note ? <p className="mt-1.5 text-[12px] font-semibold text-ink-faint">{t.note}</p> : null}
        </motion.li>
      ))}
    </ul>
  );
}

const SLOT_LABEL: Record<string, string> = {
  main: "Agent",
  fast: "Fast path · fallback",
  small: "Router · memory",
  guard: "Prompt Guard",
  lite: "Fallback (small)",
  embed: "Embeddings",
};

function Meter({ used, limit, label }: { used: number; limit: number; label: string }) {
  const pct = Math.min(100, (used / Math.max(1, limit)) * 100);
  const hot = pct >= 90;
  const warm = pct >= 70;
  return (
    <div className="relative h-3 rounded-full bg-sunken shadow-inset-sm" role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} aria-label={label}>
      <motion.div
        className="h-full rounded-full"
        style={{
          background: hot
            ? "linear-gradient(90deg,#FCA5A5,#DC2626)"
            : warm
              ? "linear-gradient(90deg,#FCD34D,#F59E0B)"
              : "linear-gradient(90deg,var(--accent-a),var(--accent-b))",
        }}
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(2, pct)}%` }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
      />
      <span aria-hidden className="absolute inset-y-[-3px] left-[90%] w-[2px] rounded-full bg-ink-faint/50" title="Guard threshold (90%)" />
    </div>
  );
}

function compact(n: number) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}K` : n.toLocaleString();
}

function Quota({ quota }: { quota: Metrics["quota"] }) {
  return (
    <ul className="space-y-4">
      {quota.map((q) => {
        const reqPct = (q.used / Math.max(1, q.limit)) * 100;
        const tokPct = q.token_limit ? ((q.tokens_used ?? 0) / Math.max(1, q.token_limit)) * 100 : 0;
        const hot = Math.max(reqPct, tokPct) >= 90;
        return (
          <li key={`${q.provider}-${q.kind}`}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13.5px]">
              <span className="min-w-0 truncate font-bold text-ink">
                {SLOT_LABEL[q.kind] ?? titleCase(q.kind)}{" "}
                <span className="font-medium text-ink-faint">
                  · {titleCase(q.provider)} {q.model ? <span className="font-mono text-[11.5px]">{q.model.replace(/^.*\//, "")}</span> : null}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[12px] tabular-nums text-ink-soft">
                {q.used.toLocaleString()} / {q.limit.toLocaleString()} req
              </span>
            </div>
            <Meter used={q.used} limit={q.limit} label={`${q.provider} ${q.kind} requests`} />
            {q.token_limit ? (
              <div className="mt-1.5">
                <Meter used={q.tokens_used ?? 0} limit={q.token_limit} label={`${q.provider} ${q.kind} tokens`} />
              </div>
            ) : null}
            <p className="mt-1 text-[11.5px] text-ink-faint">
              {reqPct.toFixed(0)}% of requests
              {q.token_limit ? ` · ${compact(q.tokens_used ?? 0)} / ${compact(q.token_limit)} tokens (${tokPct.toFixed(0)}%)` : ""}
              {hot ? " · falling back to the next provider" : ""}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

/** Active agent profile (SPEC §18.2): what AgentForge may tune, and what stays locked. */
function ProfilePanel() {
  const { data, isLoading, isError, error, refetch } = useProfileInfo();
  return (
    <Panel
      title="Agent profile"
      icon={SlidersHorizontal}
      tone="violet"
      hint="Prompts, tool descriptions and routing · tuned by AgentForge"
    >
      {isError ? (
        <ErrorState error={error} title="Couldn't load the profile" onRetry={() => refetch()} />
      ) : isLoading || !data ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : (
        <ProfileBody p={data} />
      )}
    </Panel>
  );
}

const PARAM_LABEL: Record<string, string> = {
  temperature: "Temp",
  max_steps: "Max steps",
  history_messages: "History",
  self_consistency_k: "Samples",
};

function ProfileBody({ p }: { p: ProfileInfo }) {
  const params = Object.entries(p.active.params);
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-surface px-3 py-1 font-mono text-[13px] font-bold text-accent-ink shadow-raised-sm">{p.label}</span>
          <span className="rounded-full px-3 py-1 text-[12.5px] font-semibold text-ink-soft shadow-inset-sm">source: {p.source}</span>
          <span className="text-[12.5px] text-ink-faint">by {p.active.created_by}</span>
        </div>
        {p.active.notes ? <p className="text-[13.5px] leading-relaxed text-ink-soft">{p.active.notes}</p> : null}
        <dl className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {params.map(([k, v]) => (
            <div key={k} className="rounded-2xl px-3 py-2.5 shadow-inset-sm">
              <dt className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-faint">{PARAM_LABEL[k] ?? k.replace(/_/g, " ")}</dt>
              <dd className="mt-0.5 font-mono text-[15px] font-bold text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="text-[12.5px] text-ink-soft">
          Main model <span className="font-mono">{p.active.routing.main_model}</span> · fast model{" "}
          <span className="font-mono">{p.active.routing.fast_model}</span> when <span className="font-mono">{p.active.routing.use_fast_when}</span>
        </p>
      </div>
      <div className="space-y-4">
        <div>
          <h3 className="mb-2 text-[13px] font-bold text-ink">Changes vs default ({p.default_label})</h3>
          {p.diff.length === 0 ? (
            <p className="rounded-2xl px-4 py-3 text-[13px] text-ink-soft shadow-inset-sm">Identical to the bundled default.</p>
          ) : (
            <ul className="max-h-48 space-y-1.5 overflow-auto pr-1">
              {p.diff.map((d) => (
                <li key={d.path} className="rounded-xl px-3 py-2 text-[12.5px] shadow-inset-sm">
                  <span className="font-mono font-bold text-accent-ink">{d.path}</span>
                  <span className="block truncate text-ink-faint">
                    {String(JSON.stringify(d.default) ?? "—").slice(0, 60)} → {String(JSON.stringify(d.active) ?? "—").slice(0, 60)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-bold text-ink">
            <Lock size={13} aria-hidden /> Locked — never in a profile
          </h3>
          <ul className="flex flex-wrap gap-1.5">
            {["policy rules", "refund auto-approve limit", "approval requirements", "tool permissions", "guardrail thresholds"].map((l) => (
              <li key={l} className="rounded-full bg-surface px-2.5 py-1 text-[12px] font-semibold text-ink-soft shadow-raised-sm">{l}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Evals({ evals }: { evals: Metrics["evals"] }) {
  if (!evals) return <p className="text-sm text-ink-faint">No evaluation has run yet.</p>;
  const pct = evals.passed / Math.max(1, evals.total);
  const metrics = Object.entries(evals.metrics);
  return (
    <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
      <div className="mx-auto shrink-0 sm:mx-0">
        <ProgressRing value={pct} size={128} stroke={11} label={`${evals.passed} of ${evals.total} scenarios passed`}>
          <div className="text-center">
            <p className="text-[24px] font-extrabold leading-none tracking-tight text-ink tabular-nums">
              {evals.passed}/{evals.total}
            </p>
            <p className="mt-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink-faint">passed</p>
          </div>
        </ProgressRing>
      </div>
      <div className="min-w-0 flex-1">
        <ul className="space-y-3">
          {metrics.map(([k, v]) => {
            const isCount = k === "policy_violations";
            return (
              <li key={k} className="text-[13.5px]">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-ink-soft">{titleCase(k)}</span>
                  {isCount ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-approved-bg px-2.5 py-0.5 text-[12.5px] font-bold text-approved-ink">
                      <ShieldCheck size={13} aria-hidden /> {v}
                    </span>
                  ) : (
                    <span className="font-bold tabular-nums text-ink">{Math.round(v * 100)}%</span>
                  )}
                </div>
                {!isCount ? (
                  <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-sunken shadow-inset-sm" aria-hidden>
                    <span className="block h-full rounded-full bg-accent-gradient" style={{ width: `${Math.round(v * 100)}%` }} />
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-[12px] text-ink-faint">
          Suite <strong className="text-ink-soft">{evals.suite}</strong> · <span className="font-mono">{evals.git_sha ?? "—"}</span> · {formatDateTime(evals.created_at)}
        </p>
      </div>
    </div>
  );
}
