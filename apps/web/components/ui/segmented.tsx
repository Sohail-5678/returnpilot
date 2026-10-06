"use client";

import { motion } from "motion/react";
import { Tabs } from "radix-ui";
import { useId } from "react";
import { cn } from "@/lib/utils";

export interface SegmentItem<T extends string> {
  value: T;
  label: React.ReactNode;
  count?: number;
}

/** Neumorphic segmented control (Radix Tabs) with a sliding raised thumb. */
export function Segmented<T extends string>({
  value,
  onValueChange,
  items,
  label,
  className,
  children,
}: {
  value: T;
  onValueChange: (v: T) => void;
  items: SegmentItem<T>[];
  label: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const id = useId();
  return (
    <Tabs.Root value={value} onValueChange={(v) => onValueChange(v as T)} className={className}>
      <Tabs.List aria-label={label} className="neu-inset-sm inline-flex gap-1 rounded-full p-1.5">
        {items.map((it) => {
          const active = it.value === value;
          return (
            <Tabs.Trigger
              key={it.value}
              value={it.value}
              className={cn(
                "relative inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors",
                active ? "text-ink" : "text-ink-soft hover:text-ink",
              )}
            >
              {active ? (
                <motion.span
                  layoutId={`seg-${id}`}
                  className="absolute inset-0 rounded-full bg-surface shadow-raised-sm"
                  transition={{ type: "spring", damping: 30, stiffness: 380 }}
                />
              ) : null}
              <span className="relative">{it.label}</span>
              {typeof it.count === "number" ? (
                <span
                  className={cn(
                    "relative grid min-w-6 place-items-center rounded-full px-1.5 py-0.5 text-xs font-bold",
                    active ? "bg-button-gradient text-white" : "bg-sunken text-ink-soft",
                  )}
                >
                  {it.count}
                </span>
              ) : null}
            </Tabs.Trigger>
          );
        })}
      </Tabs.List>
      {children}
    </Tabs.Root>
  );
}
