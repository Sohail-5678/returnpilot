"use client";

import { CalendarCheck, CalendarDays, Globe2, MessageSquareText, Quote, ShieldAlert, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { use } from "react";
import { categoryMeta } from "@/components/orders/category";
import { BackLink } from "@/components/shell/page-header";
import { ErrorState } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { GlyphTile } from "@/components/ui/glyph-tile";
import { InkChip, InkPanel } from "@/components/ui/ink-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, statusMeta } from "@/components/ui/status-badge";
import { useOrder } from "@/lib/api/hooks";
import { formatDate, formatMoney } from "@/lib/utils";

export default function OrderDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params);
  const q = useOrder(orderId);

  if (q.isError) {
    return (
      <div>
        <BackLink href="/orders">Orders</BackLink>
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </div>
    );
  }

  const o = q.data;
  const subtotal = o ? o.items.reduce((a, i) => a + i.unit_price * i.qty, 0) : 0;
  const discount = o ? o.items.reduce((a, i) => a + i.discount, 0) : 0;
  const StatusIcon = statusMeta(o?.status).icon;

  return (
    <div>
      <BackLink href="/orders">Orders</BackLink>
      <InkPanel innerClassName="rounded-t-hero px-6 pb-28 pt-8 sm:px-10 sm:pt-10" className="rounded-t-hero">
        {o ? (
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex flex-wrap gap-2">
                <InkChip>
                  <StatusIcon size={14} aria-hidden /> {statusMeta(o.status).label}
                </InkChip>
                {o.shipping_country !== "US" ? (
                  <InkChip>
                    <Globe2 size={14} aria-hidden /> Ships to {o.shipping_country}
                  </InkChip>
                ) : null}
              </div>
              <h1 className="mt-4 text-[34px] font-extrabold leading-tight tracking-[-0.035em] sm:text-[44px]">Order #{o.order_number}</h1>
              <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[15px] text-white/80">
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays size={15} aria-hidden /> Placed {formatDate(o.placed_at)}
                </span>
                {o.delivered_at ? (
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarCheck size={15} aria-hidden /> Delivered {formatDate(o.delivered_at)}
                  </span>
                ) : null}
              </p>
            </div>
            <div className="flex flex-col items-start gap-3 lg:items-end">
              <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-white/70">Total</p>
              <p className="-mt-2 text-[40px] font-extrabold tracking-[-0.03em] tabular-nums">{formatMoney(o.total)}</p>
              <Button asChild variant="ink" size="lg">
                <Link href={`/chat?order=${o.order_number}`}>
                  <Sparkles size={18} aria-hidden /> Ask ReturnPilot about this order
                </Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4" aria-label="Loading order">
            <Skeleton className="h-8 w-32 rounded-full bg-white/10 shadow-none" />
            <Skeleton className="h-12 w-72 rounded-full bg-white/10 shadow-none" />
          </div>
        )}
      </InkPanel>

      <div className="relative z-10 -mt-16 grid grid-cols-1 gap-6 px-2 sm:px-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <section aria-labelledby="items-title" className="neu rounded-card p-5 sm:p-6">
          <h2 id="items-title" className="mb-4 text-[17px] font-bold tracking-tight text-ink">
            Items
          </h2>
          {!o ? (
            <div className="space-y-3">
              <Skeleton className="h-20 rounded-[22px]" />
              <Skeleton className="h-20 rounded-[22px]" />
            </div>
          ) : (
            <ul className="space-y-3">
              {o.items.map((it, i) => {
                const cat = categoryMeta(it.category);
                return (
                  <motion.li
                    key={it.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 + i * 0.06 }}
                    className="neu-inset-sm flex flex-col gap-4 rounded-[22px] p-4 sm:flex-row sm:items-center"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-4">
                      <GlyphTile icon={cat.icon} tone={cat.tone} size="md" well="raised" />
                      <div className="min-w-0">
                        <p className="font-bold text-ink">{it.name}</p>
                        <p className="font-mono text-xs text-ink-faint">{it.sku}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {it.final_sale ? <span className="rounded-full bg-rejected-bg px-2.5 py-0.5 text-[11.5px] font-bold text-rejected-ink">Final sale</span> : null}
                          {it.opened ? <span className="rounded-full bg-pending-bg px-2.5 py-0.5 text-[11.5px] font-bold text-pending-ink">Opened</span> : null}
                          {it.return_status ? <StatusBadge status={it.return_status} size="sm" /> : null}
                          {it.refund_status ? (
                            <StatusBadge
                              status={it.refund_status}
                              size="sm"
                              label={
                                it.refund_status === "pending_approval"
                                  ? "Refund waiting for approval"
                                  : it.refund_status === "queued"
                                    ? "Refund queued"
                                    : it.refund_status === "rejected"
                                      ? "Refund not approved"
                                      : undefined
                              }
                            />
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div className="text-right sm:min-w-28">
                      <p className="text-lg font-extrabold tabular-nums text-ink">{formatMoney(it.unit_price * it.qty - it.discount)}</p>
                      <p className="text-xs text-ink-faint">
                        {it.qty} × {formatMoney(it.unit_price)}
                        {it.discount ? ` − ${formatMoney(it.discount)}` : ""}
                      </p>
                    </div>
                  </motion.li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="space-y-6">
          <section aria-labelledby="summary-title" className="neu rounded-card p-5 sm:p-6">
            <h2 id="summary-title" className="mb-4 text-[17px] font-bold tracking-tight text-ink">
              Summary
            </h2>
            {o ? (
              <dl className="space-y-2.5 text-[14.5px]">
                <Row label="Items" value={formatMoney(subtotal)} />
                {discount ? <Row label="Discounts" value={`− ${formatMoney(discount)}`} /> : null}
                <Row label="Shipping" value={formatMoney(o.shipping_cost)} />
                <div className="my-3 h-px bg-line" />
                <Row label="Total" value={formatMoney(o.total)} strong />
              </dl>
            ) : (
              <Skeleton className="h-28 rounded-2xl" />
            )}
          </section>

          {o?.customer_note ? (
            <section className="neu rounded-card p-5 sm:p-6">
              <h2 className="mb-3 flex items-center gap-2 text-[15px] font-bold text-ink">
                <Quote size={16} className="text-accent-ink" aria-hidden /> Your note on this order
              </h2>
              <p className="rounded-2xl bg-sunken px-4 py-3 text-[14px] italic text-ink-soft">{o.customer_note}</p>
              <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-ink-faint">
                <ShieldAlert size={14} className="mt-px shrink-0" aria-hidden />
                The agent reads notes as data, never as instructions.
              </p>
            </section>
          ) : null}

          <section className="neu rounded-card p-5 sm:p-6">
            <div className="flex items-start gap-3.5">
              <GlyphTile icon={MessageSquareText} tone="violet" size="md" />
              <div>
                <p className="text-[15px] font-bold text-ink">Need a return or refund?</p>
                <p className="mt-1 text-[13.5px] leading-relaxed text-ink-soft">
                  The agent checks eligibility against the policy and asks a reviewer before refunds over $50.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className={strong ? "font-bold text-ink" : "text-ink-soft"}>{label}</dt>
      <dd className={strong ? "text-lg font-extrabold tabular-nums text-ink" : "font-semibold tabular-nums text-ink"}>{value}</dd>
    </div>
  );
}
