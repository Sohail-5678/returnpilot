"use client";

import { ArrowRight, Globe2, Package } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { categoryMeta } from "@/components/orders/category";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState, ErrorState } from "@/components/states/states";
import { GlyphTile } from "@/components/ui/glyph-tile";
import { ListSkeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { useOrders } from "@/lib/api/hooks";
import { cn, formatDate, formatMoney } from "@/lib/utils";

const FILTERS = [
  { value: "", label: "All" },
  { value: "processing", label: "Processing" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

export default function OrdersPage() {
  const [status, setStatus] = useState("");
  const q = useOrders(status || undefined);

  return (
    <div>
      <PageHeader
        icon={Package}
        tone="sunset"
        eyebrow="Northwind Outfitters"
        title="Your orders"
        description="Everything you've bought, with return and refund status. Ask the agent about any of them."
      />

      <div role="group" aria-label="Filter by status" className="mb-7 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = status === f.value;
          return (
            <button
              key={f.value || "all"}
              type="button"
              aria-pressed={active}
              onClick={() => setStatus(f.value)}
              className={cn(
                "min-h-11 rounded-full px-4.5 text-sm font-semibold transition-[box-shadow,color,transform] duration-300",
                active ? "neu-inset-sm text-ink" : "neu-sm text-ink-soft hover:-translate-y-0.5 hover:text-ink",
              )}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {q.isLoading ? (
        <ListSkeleton count={3} className="sm:grid-cols-2 2xl:grid-cols-3" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState
          icon={Package}
          tone="sunset"
          title={status ? `No ${status} orders` : "No orders yet"}
          body={status ? "Try another filter." : "Orders you place at Northwind Outfitters show up here."}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 2xl:grid-cols-3">
          {q.data.map((o, i) => {
            const cat = categoryMeta(o.thumbnail_category);
            return (
              <motion.li
                key={o.id}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05, type: "spring", damping: 24, stiffness: 220 }}
              >
                <Link href={`/orders/${o.order_number}`} className="neu-lift group flex h-full flex-col rounded-card p-5 sm:p-6">
                  <div className="flex items-start gap-4">
                    <GlyphTile icon={cat.icon} tone={cat.tone} size="lg" />
                    <div className="min-w-0 flex-1 pt-1">
                      <p className="text-[17px] font-bold tracking-tight text-ink">Order #{o.order_number}</p>
                      <p className="text-[13px] text-ink-faint">Placed {formatDate(o.placed_at)}</p>
                    </div>
                    <StatusBadge status={o.status} size="sm" />
                  </div>
                  <div className="mt-6 flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[28px] font-extrabold tracking-[-0.03em] text-ink tabular-nums">{formatMoney(o.total)}</p>
                      <p className="text-[13px] text-ink-soft">
                        {o.items_count} {o.items_count === 1 ? "item" : "items"}
                        {o.delivered_at ? ` · delivered ${formatDate(o.delivered_at, { month: "short", day: "numeric" })}` : ""}
                      </p>
                    </div>
                    {o.shipping_country && o.shipping_country !== "US" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-sunken px-2.5 py-1 text-xs font-semibold text-ink-soft">
                        <Globe2 size={12} aria-hidden /> {o.shipping_country}
                      </span>
                    ) : null}
                  </div>
                  <span className="mt-5 inline-flex items-center gap-1.5 border-t border-line pt-4 text-[13.5px] font-bold text-accent-ink">
                    View details
                    <ArrowRight size={15} className="transition-transform duration-300 group-hover:translate-x-1" aria-hidden />
                  </span>
                </Link>
              </motion.li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
