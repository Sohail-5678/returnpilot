"use client";

import { Check, ChevronDown, LoaderCircle, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useId, useState } from "react";
import { JsonBlock } from "@/components/ui/misc";
import type { ToolCall } from "@/lib/schemas";
import { cn, formatMs } from "@/lib/utils";

const STATUS = {
  ok: { label: "Succeeded", icon: Check, cls: "bg-[linear-gradient(145deg,#34d399,#059669)] text-white" },
  error: { label: "Failed", icon: X, cls: "bg-[linear-gradient(145deg,#f87171,#dc2626)] text-white" },
  running: { label: "Running", icon: LoaderCircle, cls: "bg-[linear-gradient(145deg,#a5b4fc,#6b6cf6)] text-white" },
} as const;

/** One tool call: human sentence + ✓/✗/spinner; raw args/result behind "details". */
export function ToolChip({ tool, index = 0 }: { tool: ToolCall; index?: number }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const s = STATUS[tool.status] ?? STATUS.running;
  const Icon = s.icon;
  const hasDetails = tool.args != null || !!tool.result_preview;

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, x: -10, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={{ type: "spring", damping: 26, stiffness: 320, delay: Math.min(index, 4) * 0.04 }}
      className="list-none"
      data-testid="tool-chip"
      data-status={tool.status}
    >
      <div className="flex min-h-11 items-center gap-3 rounded-[16px] px-2.5 py-1.5">
        <span
          className={cn("grid size-6 shrink-0 place-items-center rounded-full shadow-[0_4px_10px_-4px_rgba(40,40,120,.5)]", s.cls)}
          role="img"
          aria-label={s.label}
        >
          <Icon size={13} strokeWidth={3} className={tool.status === "running" ? "animate-spin" : undefined} aria-hidden />
        </span>
        <span className={cn("min-w-0 flex-1 text-[14px] font-medium leading-snug", tool.status === "error" ? "text-rejected-ink dark:text-rejected" : "text-ink")}>
          {tool.label}
        </span>
        {tool.status !== "running" && typeof tool.duration_ms === "number" ? (
          <span className="hidden shrink-0 font-mono text-[11.5px] text-ink-faint sm:inline">{formatMs(tool.duration_ms)}</span>
        ) : null}
        {hasDetails ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={detailsId}
            className="-my-1 inline-flex min-h-9 shrink-0 pointer-coarse:min-h-11 items-center gap-1 rounded-full px-2.5 text-xs font-semibold text-accent-ink transition-colors hover:bg-surface"
          >
            details
            <ChevronDown size={14} className={cn("transition-transform duration-300", open && "rotate-180")} aria-hidden />
            <span className="sr-only"> for {tool.label}</span>
          </button>
        ) : null}
      </div>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={detailsId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="space-y-2 px-2.5 pb-2.5 pt-1">
              <p className="font-mono text-[11.5px] font-medium text-ink-faint">
                {tool.name}
                {tool.id ? ` · ${tool.id}` : ""}
              </p>
              {tool.args != null ? <JsonBlock value={tool.args} maxHeight={200} /> : null}
              {tool.result_preview ? (
                <p className="rounded-2xl bg-sunken px-4 py-2.5 font-mono text-[12.5px] text-ink-soft">→ {tool.result_preview}</p>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.li>
  );
}

export function ToolChipGroup({ tools, className }: { tools: ToolCall[]; className?: string }) {
  if (!tools.length) return null;
  const done = tools.filter((t) => t.status !== "running").length;
  return (
    <div className={cn("neu-inset-sm rounded-[22px] p-1.5", className)}>
      <p className="sr-only">
        {done} of {tools.length} tool calls finished
      </p>
      <ul className="flex flex-col">
        {tools.map((t, i) => (
          <ToolChip key={t.id} tool={t} index={i} />
        ))}
      </ul>
    </div>
  );
}
