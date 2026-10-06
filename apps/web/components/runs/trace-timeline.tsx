"use client";

import { ChevronDown, CircleCheck, CircleX, PauseCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Fragment, useId, useState } from "react";
import { GlyphTile } from "@/components/ui/glyph-tile";
import { JsonBlock } from "@/components/ui/misc";
import type { RunStep } from "@/lib/schemas";
import { cn, formatMs, formatNumber } from "@/lib/utils";
import { STEP_KIND, stepKind } from "./step-kinds";

function StatusIcon({ status }: { status: string }) {
  if (status === "error") return <CircleX size={17} className="text-rejected" aria-label="Error" />;
  if (status === "interrupted") return <PauseCircle size={17} className="text-pending" aria-label="Paused for approval" />;
  return <CircleCheck size={17} className="text-approved" aria-label="OK" />;
}

/**
 * Vertical trace timeline. Each step: kind glyph, name, model, a waterfall duration
 * bar scaled to the whole run, tokens and status. Click to see input/output JSON.
 */
const GAP_MAX_MS = 2_000;
const GAP_SHOWN_MS = 300;

/**
 * Positions steps on a compressed time axis: idle gaps longer than 2 s (e.g. waiting
 * hours for a reviewer) are collapsed to a short visual gap and labeled instead.
 */
function layoutSteps(steps: RunStep[]) {
  const sorted = [...steps].sort((a, b) => a.seq - b.seq);
  let shift = 0;
  let cursor = sorted.length ? new Date(sorted[0]!.started_at).getTime() : 0;
  const origin = cursor;
  const rows = sorted.map((s) => {
    const st = new Date(s.started_at).getTime();
    const gap = st - cursor;
    let pause: number | null = null;
    if (gap > GAP_MAX_MS) {
      shift += gap - GAP_SHOWN_MS;
      pause = gap;
    }
    cursor = Math.max(cursor, st + (s.duration_ms ?? 0));
    return { step: s, at: st - origin - shift, pause };
  });
  const total = Math.max(1, ...rows.map((r) => r.at + (r.step.duration_ms ?? 0)));
  return { rows, total };
}

function humanGap(ms: number) {
  const min = Math.round(ms / 60_000);
  if (min >= 60) return `${Math.floor(min / 60)} h ${min % 60} min`;
  if (min >= 1) return `${min} min`;
  return `${Math.round(ms / 1000)} s`;
}

export function TraceTimeline({ steps }: { steps: RunStep[] }) {
  const { rows, total } = layoutSteps(steps);

  return (
    <div>
      <ul className="mb-5 flex flex-wrap gap-x-4 gap-y-2" aria-label="Legend">
        {Object.entries(STEP_KIND).map(([k, v]) => (
          <li key={k} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink-soft">
            <span className="h-2 w-5 rounded-full" style={{ background: v.bar }} aria-hidden />
            {v.label}
          </li>
        ))}
      </ul>
      <ol className="relative">
        <span aria-hidden className="absolute bottom-6 left-[19px] top-6 w-[3px] rounded-full bg-[linear-gradient(180deg,var(--accent-a),transparent)] opacity-40 sm:left-[23px]" />
        {rows.map((r, i) => (
          <Fragment key={r.step.seq}>
            {r.pause ? (
              <li className="relative flex items-center gap-3 py-2 pl-12 sm:pl-16" aria-label={`Paused for ${humanGap(r.pause)}`}>
                <span className="rounded-full bg-pending-bg px-3 py-1 text-[12px] font-bold text-pending-ink">
                  Paused {humanGap(r.pause)} — waiting outside the run (e.g. for a reviewer)
                </span>
              </li>
            ) : null}
            <StepRow step={r.step} index={i} at={r.at} total={total} />
          </Fragment>
        ))}
      </ol>
    </div>
  );
}

function StepRow({ step, index, at, total }: { step: RunStep; index: number; at: number; total: number }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const k = stepKind(step.kind);
  const offset = (at / total) * 100;
  const width = Math.max(0.8, ((step.duration_ms ?? 0) / total) * 100);
  const tokens = (step.tokens_in ?? 0) + (step.tokens_out ?? 0);

  return (
    <motion.li
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: Math.min(index, 16) * 0.035, type: "spring", damping: 26, stiffness: 260 }}
      className="relative pb-3"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        className={cn(
          "group flex w-full items-center gap-3 rounded-[22px] py-2 pl-0 pr-3 text-left transition-[background-color,box-shadow] duration-300 sm:gap-4",
          open ? "bg-surface shadow-raised-sm" : "hover:bg-surface/70",
        )}
      >
        <span className="relative z-10">
          <GlyphTile icon={k.icon} tone={k.tone} size="sm" well="raised" className="sm:size-12" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-[13.5px] font-semibold text-ink">{step.name}</span>
            <span className="text-[11.5px] font-medium text-ink-faint">{k.label}</span>
            {step.model ? (
              <span className="rounded-full bg-sunken px-2 py-0.5 font-mono text-[11px] font-medium text-ink-soft">{step.model}</span>
            ) : null}
          </span>
          <span className="mt-2 block h-2.5 w-full overflow-hidden rounded-full bg-sunken shadow-inset-sm" aria-hidden>
            <motion.span
              className="block h-full rounded-full"
              style={{ marginLeft: `${Math.min(offset, 99)}%`, background: k.bar }}
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(width, 100 - Math.min(offset, 99))}%` }}
              transition={{ delay: 0.15 + Math.min(index, 16) * 0.035, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            />
          </span>
          {step.error ? <span className="mt-1.5 block truncate text-[12px] font-semibold text-rejected">{step.error}</span> : null}
        </span>
        <span className="hidden w-20 shrink-0 text-right font-mono text-[12px] tabular-nums text-ink-soft sm:block">{formatMs(step.duration_ms)}</span>
        <span className="hidden w-24 shrink-0 text-right font-mono text-[12px] tabular-nums text-ink-faint md:block">
          {tokens ? `${formatNumber(step.tokens_in)}→${formatNumber(step.tokens_out)}` : "—"}
        </span>
        <StatusIcon status={step.status} />
        <ChevronDown size={16} className={cn("shrink-0 text-ink-faint transition-transform duration-300", open && "rotate-180")} aria-hidden />
        <span className="sr-only">
          {formatMs(step.duration_ms)}
          {tokens ? `, ${tokens} tokens` : ""}. {open ? "Hide" : "Show"} input and output
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={id}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-1 gap-3 pb-3 pl-12 pr-2 pt-2 sm:pl-16 lg:grid-cols-2">
              <div>
                <p className="mb-1.5 text-[11.5px] font-bold uppercase tracking-[0.14em] text-ink-faint">Input</p>
                <JsonBlock value={step.input ?? null} />
              </div>
              <div>
                <p className="mb-1.5 text-[11.5px] font-bold uppercase tracking-[0.14em] text-ink-faint">Output</p>
                <JsonBlock value={step.error ? { error: step.error, output: step.output ?? null } : (step.output ?? null)} />
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.li>
  );
}
