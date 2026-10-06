"use client";

import { ChevronDown } from "lucide-react";
import { animate, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Number that counts up when it scrolls into view. */
export function CountUp({
  value,
  format = (n) => Math.round(n).toLocaleString("en-US"),
  duration = 1.1,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(() => format(0));

  useEffect(() => {
    if (!inView || reduce) return;
    const controls = animate(0, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(format(v)),
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, value, reduce, duration]);

  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      <span aria-hidden>{reduce ? format(value) : display}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}

/** Circular progress ring (0–1). Indeterminate rings spin slowly. */
export function ProgressRing({
  value,
  size = 96,
  stroke = 9,
  className,
  children,
  label,
}: {
  value: number;
  size?: number;
  stroke?: number;
  className?: string;
  children?: React.ReactNode;
  label?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div
      className={cn("neu-inset relative grid place-items-center rounded-full", className)}
      style={{ width: size + 16, height: size + 16 }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      aria-label={label}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#8D8CFF" />
            <stop offset="1" stopColor="#FF6FA8" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#ring-grad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          style={{ transition: "stroke-dashoffset .9s cubic-bezier(.2,.8,.2,1)" }}
        />
      </svg>
      {children ? <div className="absolute inset-0 grid place-items-center">{children}</div> : null}
    </div>
  );
}

/** Mono, collapsible JSON block for tool args / trace inputs. */
export function JsonBlock({ value, className, maxHeight = 320 }: { value: unknown; className?: string; maxHeight?: number }) {
  const text = (() => {
    if (value === undefined || value === null) return "null";
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  })();
  return (
    <pre
      className={cn(
        "neu-inset-sm scrollbar-soft overflow-auto rounded-2xl px-4 py-3 font-mono text-[12.5px] leading-relaxed text-ink-soft",
        className,
      )}
      style={{ maxHeight }}
    >
      <code>{text}</code>
    </pre>
  );
}

export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  className,
}: {
  summary: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-accent-ink hover:bg-sunken"
      >
        {summary}
        <ChevronDown size={16} className={cn("transition-transform duration-300", open && "rotate-180")} aria-hidden />
      </button>
      {open ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}

/** Small uppercase eyebrow label. */
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("text-[11.5px] font-bold uppercase tracking-[0.16em] text-ink-faint", className)}>{children}</p>
  );
}
