"use client";

import { CircleCheck, CircleX, Clock3, Hourglass } from "lucide-react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import type { Metrics } from "@/lib/schemas";
import { formatMs, formatNumber, routeLabel } from "@/lib/utils";

const AXIS = { stroke: "var(--chart-axis)", fontSize: 12, fontFamily: "var(--font-sans)" };
const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Neumorphic tooltip; values in ink, colored dot carries identity. */
function ChartTooltip({
  active,
  payload,
  label,
  format = (v: number) => formatNumber(v),
  labelFormat = (l: string) => l,
}: Partial<TooltipContentProps<number, string>> & { format?: (v: number) => string; labelFormat?: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-36 rounded-2xl bg-surface-hi px-3.5 py-2.5 shadow-float">
      {label !== undefined ? <p className="mb-1 text-xs font-bold text-ink">{labelFormat(String(label))}</p> : null}
      <ul className="space-y-0.5">
        {payload.map((p) => (
          <li key={String(p.dataKey)} className="flex items-center gap-2 text-[12.5px] text-ink-soft">
            <span className="size-2.5 rounded-full" style={{ background: (p.color as string) ?? (p.payload as { fill?: string })?.fill }} aria-hidden />
            <span className="flex-1">{p.name}</span>
            <span className="font-bold tabular-nums text-ink">{format(Number(p.value))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5" aria-label="Legend">
      {items.map((i) => (
        <li key={i.label} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-soft">
          <span
            className="h-[3px] w-5 rounded-full"
            style={{ background: i.dashed ? `repeating-linear-gradient(90deg, ${i.color} 0 5px, transparent 5px 8px)` : i.color }}
            aria-hidden
          />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

function DataTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="mt-3 text-[12.5px]">
      <summary className="inline-flex min-h-9 cursor-pointer items-center pointer-coarse:min-h-11 rounded-full px-3 font-semibold text-accent-ink hover:bg-sunken">
        View as table
      </summary>
      <div className="scrollbar-soft mt-2 max-h-56 overflow-auto rounded-2xl bg-sunken p-2">
        <table className="w-full text-left">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h} className="px-2 py-1 font-bold text-ink">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-line">
                {r.map((c, j) => (
                  <td key={j} className="px-2 py-1 tabular-nums text-ink-soft">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** Runs per day (area) with errors (bars) — same unit, one axis. */
export function RunsChart({ data }: { data: Metrics["runs_per_day"] }) {
  return (
    <div>
      <Legend items={[{ label: "Runs", color: "var(--chart-1)" }, { label: "Errors", color: "var(--chart-bad)" }]} />
      <div className="mt-3 h-56" role="img" aria-label={`Runs per day over ${data.length} days; total ${data.reduce((a, d) => a + d.runs, 0)} runs and ${data.reduce((a, d) => a + d.errors, 0)} errors.`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 6, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="runsFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.32} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="day" tickFormatter={shortDay} tickLine={false} axisLine={false} tick={AXIS} minTickGap={16} />
            <YAxis tickLine={false} axisLine={false} tick={AXIS} allowDecimals={false} width={44} />
            <Tooltip
              cursor={{ stroke: "var(--chart-1)", strokeOpacity: 0.35, strokeWidth: 1.5 }}
              content={(p) => <ChartTooltip {...(p as TooltipContentProps<number, string>)} labelFormat={shortDay} />}
            />
            <Area type="monotone" dataKey="runs" name="Runs" stroke="var(--chart-1)" strokeWidth={2} fill="url(#runsFill)" activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--surface)" }} />
            <Bar dataKey="errors" name="Errors" fill="var(--chart-bad)" barSize={8} radius={[4, 4, 0, 0]} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <DataTable caption="Runs per day" head={["Day", "Runs", "Errors"]} rows={data.map((d) => [shortDay(d.day), d.runs, d.errors])} />
    </div>
  );
}

export function LatencyChart({ data }: { data: Metrics["latency_per_day"] }) {
  return (
    <div>
      <Legend items={[{ label: "p50", color: "var(--chart-1)" }, { label: "p95", color: "var(--chart-2)", dashed: true }]} />
      <div className="mt-3 h-56" role="img" aria-label="Median and 95th percentile latency per day.">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 6, left: -6, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="day" tickFormatter={shortDay} tickLine={false} axisLine={false} tick={AXIS} minTickGap={16} />
            <YAxis tickLine={false} axisLine={false} tick={AXIS} width={52} tickFormatter={(v: number) => `${(v / 1000).toFixed(1)}s`} />
            <Tooltip
              cursor={{ stroke: "var(--chart-1)", strokeOpacity: 0.35, strokeWidth: 1.5 }}
              content={(p) => <ChartTooltip {...(p as TooltipContentProps<number, string>)} labelFormat={shortDay} format={(v) => formatMs(v)} />}
            />
            <Line type="monotone" dataKey="p50_ms" name="p50" stroke="var(--chart-1)" strokeWidth={2} dot={data.length < 4 ? { r: 4, fill: "var(--chart-1)" } : false} activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--surface)" }} />
            <Line type="monotone" dataKey="p95_ms" name="p95" stroke="var(--chart-2)" strokeWidth={2} strokeDasharray="6 4" dot={data.length < 4 ? { r: 4, fill: "var(--chart-2)" } : false} activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--surface)" }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <DataTable caption="Latency per day" head={["Day", "p50", "p95"]} rows={data.map((d) => [shortDay(d.day), formatMs(d.p50_ms), formatMs(d.p95_ms)])} />
    </div>
  );
}

export function RoutesChart({ data }: { data: Metrics["routes"] }) {
  const rows = data.map((r) => ({ ...r, label: routeLabel(r.route) }));
  return (
    <div>
      <div className="h-60" role="img" aria-label={`Runs by route: ${rows.map((r) => `${r.label} ${r.count}`).join(", ")}.`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 36, left: 8, bottom: 0 }} barCategoryGap={8}>
            <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} tick={{ ...AXIS, fill: "var(--ink-soft)" }} width={104} />
            <Tooltip cursor={{ fill: "var(--chart-grid)" }} content={(p) => <ChartTooltip {...(p as TooltipContentProps<number, string>)} />} />
            <Bar
              dataKey="count"
              name="Runs"
              fill="var(--chart-1)"
              radius={[0, 4, 4, 0]}
              barSize={14}
              label={{ position: "right", fill: "var(--ink-soft)", fontSize: 12, fontWeight: 700 }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const APPROVAL_SLICES = [
  { key: "approved", label: "Approved", color: "var(--chart-ok)", icon: CircleCheck },
  { key: "pending", label: "Pending", color: "var(--chart-warn)", icon: Hourglass },
  { key: "rejected", label: "Rejected", color: "var(--chart-bad)", icon: CircleX },
  { key: "expired", label: "Expired", color: "var(--chart-neutral)", icon: Clock3 },
] as const;

export function ApprovalsDonut({ data }: { data: Metrics["approvals"] }) {
  const rows = APPROVAL_SLICES.map((s) => ({ ...s, value: data[s.key] }));
  const total = rows.reduce((a, r) => a + r.value, 0);
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <div className="relative size-44 shrink-0" role="img" aria-label={`Approvals: ${rows.map((r) => `${r.label} ${r.value}`).join(", ")}.`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip content={(p) => <ChartTooltip {...(p as TooltipContentProps<number, string>)} />} />
            <Pie data={rows} dataKey="value" nameKey="label" innerRadius="68%" outerRadius="100%" paddingAngle={2} cornerRadius={4} stroke="var(--surface)" strokeWidth={2} startAngle={90} endAngle={-270}>
              {rows.map((r) => (
                <Cell key={r.key} fill={r.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-[26px] font-extrabold leading-none tracking-tight text-ink tabular-nums">{total}</p>
            <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-faint">requests</p>
          </div>
        </div>
      </div>
      <ul className="grid w-full grid-cols-2 gap-2.5 sm:grid-cols-1">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center gap-2.5 rounded-2xl bg-sunken/70 px-3 py-2">
            <span className="size-3 shrink-0 rounded-full" style={{ background: r.color }} aria-hidden />
            <r.icon size={14} className="shrink-0 text-ink-soft" aria-hidden />
            <span className="flex-1 text-[13px] font-semibold text-ink-soft">{r.label}</span>
            <span className="text-[14px] font-extrabold tabular-nums text-ink">{r.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
