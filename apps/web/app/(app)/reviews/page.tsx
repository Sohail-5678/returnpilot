"use client";

import { ArrowRight, ClipboardCheck, PartyPopper, ShieldAlert, Timer } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState, ErrorState } from "@/components/states/states";
import { GradientAvatar } from "@/components/ui/avatar";
import { ListSkeleton } from "@/components/ui/skeleton";
import { Segmented } from "@/components/ui/segmented";
import { StatusBadge } from "@/components/ui/status-badge";
import { useApprovals } from "@/lib/api/hooks";
import type { ApprovalSummary } from "@/lib/schemas";
import { useNow } from "@/lib/use-now";
import { cn, countdown, formatMoney, relativeTime, titleCase } from "@/lib/utils";

export default function ReviewsPage() {
  const [tab, setTab] = useState<"pending" | "decided">("pending");
  const pending = useApprovals("pending");
  const decided = useApprovals("decided", tab === "decided");
  const q = tab === "pending" ? pending : decided;
  const now = useNow(30_000);

  return (
    <div>
      <PageHeader
        icon={ClipboardCheck}
        tone="amber"
        eyebrow="Human in the loop"
        title="Review queue"
        description="Refunds the agent wasn't allowed to issue on its own. Check the evidence, then approve, edit or reject."
        actions={
          <Segmented
            label="Approval status"
            value={tab}
            onValueChange={setTab}
            items={[
              { value: "pending", label: "Pending", count: pending.data?.length },
              { value: "decided", label: "Decided" },
            ]}
          />
        }
      />

      {q.isLoading ? (
        <ListSkeleton count={2} className="lg:grid-cols-2" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        tab === "pending" ? (
          <EmptyState
            icon={PartyPopper}
            tone="mint"
            title="The queue is clear"
            body="New requests appear here within seconds. Sign in as Maya and ask for the boots refund to create one."
          />
        ) : (
          <EmptyState icon={ClipboardCheck} tone="slate" title="No decisions yet" body="Approved, rejected and expired requests show up here." />
        )
      ) : (
        <ul className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {q.data.map((a, i) => (
            <motion.li
              key={a.id}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, type: "spring", damping: 24, stiffness: 220 }}
            >
              <ReviewCard a={a} now={now} />
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReviewCard({ a, now }: { a: ApprovalSummary; now: number }) {
  const left = countdown(a.expires_at, now);
  const urgent = a.status === "pending" && a.expires_at && new Date(a.expires_at).getTime() - now < 2 * 3600_000;
  return (
    <Link
      href={`/reviews/${a.id}`}
      className={cn("neu-lift group relative flex h-full flex-col overflow-hidden rounded-card p-5 sm:p-6")}
    >
      {a.status === "pending" ? (
        <span aria-hidden className="absolute inset-y-6 left-0 w-1.5 rounded-r-full bg-[linear-gradient(180deg,#FCD34D,#F59E0B)]" />
      ) : null}
      <div className="flex items-start gap-3.5">
        <GradientAvatar name={a.customer_name ?? "Customer"} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold text-ink">{a.customer_name}</p>
          <p className="truncate text-[13px] text-ink-faint">
            Order #{a.order_number} · {a.item_name}
          </p>
        </div>
        <StatusBadge status={a.status} size="sm" />
      </div>

      <div className="mt-5 flex items-end justify-between gap-4">
        <div>
          <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-ink-faint">{titleCase(a.action.replace("issue_", ""))}</p>
          <p className="text-[32px] font-extrabold leading-none tracking-[-0.03em] text-ink tabular-nums">{formatMoney(a.amount)}</p>
        </div>
        {a.status === "pending" && left ? (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-bold",
              urgent ? "bg-rejected-bg text-rejected-ink" : "bg-pending-bg text-pending-ink",
            )}
          >
            <Timer size={13} aria-hidden /> Expires in {left}
          </span>
        ) : null}
      </div>

      {a.reason ? (
        <p className="mt-4 flex items-start gap-2 rounded-2xl bg-sunken px-3.5 py-2.5 text-[13.5px] font-medium text-ink-soft">
          <ShieldAlert size={15} className="mt-0.5 shrink-0 text-pending-ink dark:text-pending" aria-hidden />
          {a.reason}
        </p>
      ) : null}

      <div className="mt-auto flex items-center justify-between gap-3 pt-5 text-[12.5px] text-ink-faint">
        <span>
          {a.status === "pending" ? `Requested ${relativeTime(a.created_at, now)}` : `Decided ${relativeTime(a.decided_at ?? a.created_at, now)}`}
        </span>
        <span className="inline-flex items-center gap-1 font-bold text-accent-ink">
          {a.status === "pending" ? "Review" : "View"}
          <ArrowRight size={14} className="transition-transform duration-300 group-hover:translate-x-1" aria-hidden />
        </span>
      </div>
    </Link>
  );
}
