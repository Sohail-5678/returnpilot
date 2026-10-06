"use client";

import { CircleDollarSign, LifeBuoy, PackageOpen, Zap } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { GlyphTile, type Tone } from "@/components/ui/glyph-tile";
import { StatusBadge } from "@/components/ui/status-badge";
import type { Action } from "@/lib/schemas";
import { cn, relativeTime } from "@/lib/utils";

const KIND: Record<Action["kind"], { icon: typeof Zap; tone: Tone; name: string }> = {
  refund: { icon: CircleDollarSign, tone: "mint", name: "Refund" },
  return: { icon: PackageOpen, tone: "sky", name: "Return" },
  ticket: { icon: LifeBuoy, tone: "violet", name: "Ticket" },
};

/** Side effects created in this thread (refunds, returns, tickets) with live status. */
export function ActionsList({ actions, className }: { actions: Action[]; className?: string }) {
  if (!actions.length) {
    return (
      <div className={cn("rounded-[22px] bg-sunken/60 px-4 py-6 text-center", className)}>
        <p className="text-sm font-semibold text-ink">No actions yet</p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-faint">
          Returns and refunds started in this chat show up here with live status.
        </p>
      </div>
    );
  }
  return (
    <ul className={cn("space-y-3", className)} aria-live="polite">
      <AnimatePresence initial={false}>
        {actions.map((a) => {
          const k = KIND[a.kind] ?? KIND.ticket;
          return (
            <motion.li
              key={a.id}
              layout
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className="neu-sm rounded-[22px] p-3.5"
            >
              <div className="flex items-start gap-3">
                <GlyphTile icon={k.icon} tone={k.tone} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-bold leading-snug text-ink">{a.label}</p>
                  <div className="mt-1.5">
                    <StatusBadge status={a.status} size="sm" />
                  </div>
                  {a.detail ? <p className="mt-2 text-[12.5px] leading-relaxed text-ink-soft">{a.detail}</p> : null}
                  <p className="mt-1.5 text-[11.5px] text-ink-faint">
                    {a.order_number ? (
                      <Link href={`/orders/${a.order_number}`} className="font-semibold text-accent-ink hover:underline">
                        Order #{a.order_number}
                      </Link>
                    ) : null}
                    {a.order_number ? " · " : ""}
                    updated {relativeTime(a.updated_at)}
                  </p>
                </div>
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}

export function ActionsPanel({ actions }: { actions: Action[] }) {
  return (
    <section aria-labelledby="actions-title" className="neu rounded-[28px] p-4">
      <div className="mb-3.5 flex items-center gap-2.5 px-1">
        <GlyphTile icon={Zap} tone="amber" size="sm" well="none" />
        <h2 id="actions-title" className="text-[15px] font-bold tracking-tight text-ink">
          Actions
        </h2>
        <span className="ml-auto rounded-full bg-sunken px-2.5 py-0.5 text-xs font-bold text-ink-soft">{actions.length}</span>
      </div>
      <ActionsList actions={actions} />
    </section>
  );
}
