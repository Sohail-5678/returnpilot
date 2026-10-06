import {
  Ban,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock3,
  Hourglass,
  LoaderCircle,
  PackageCheck,
  PauseCircle,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type Tint = "pending" | "approved" | "rejected" | "expired" | "info";

const TINT: Record<Tint, string> = {
  pending: "bg-pending-bg text-pending-ink",
  approved: "bg-approved-bg text-approved-ink",
  rejected: "bg-rejected-bg text-rejected-ink",
  expired: "bg-expired-bg text-expired-ink",
  info: "bg-info-bg text-info",
};

interface Meta {
  label: string;
  tint: Tint;
  icon: LucideIcon;
  spin?: boolean;
}

/** Status → label/icon/tint. Status is always shown as icon + text, never color alone. */
export const STATUS_META: Record<string, Meta> = {
  // approvals
  pending: { label: "Pending", tint: "pending", icon: Hourglass },
  approved: { label: "Approved", tint: "approved", icon: CircleCheck },
  rejected: { label: "Rejected", tint: "rejected", icon: CircleX },
  expired: { label: "Expired", tint: "expired", icon: Clock3 },
  // actions / jobs
  pending_approval: { label: "Waiting for approval", tint: "pending", icon: Hourglass },
  queued: { label: "Queued", tint: "info", icon: CircleDashed },
  running: { label: "Processing", tint: "info", icon: LoaderCircle, spin: true },
  succeeded: { label: "Done", tint: "approved", icon: CircleCheck },
  failed: { label: "Failed", tint: "rejected", icon: CircleX },
  // orders
  processing: { label: "Processing", tint: "info", icon: CircleDashed },
  shipped: { label: "Shipped", tint: "pending", icon: Truck },
  delivered: { label: "Delivered", tint: "approved", icon: PackageCheck },
  cancelled: { label: "Cancelled", tint: "expired", icon: Ban },
  // runs
  ok: { label: "OK", tint: "approved", icon: CircleCheck },
  interrupted: { label: "Paused for approval", tint: "pending", icon: PauseCircle },
  error: { label: "Error", tint: "rejected", icon: CircleX },
  // item return/refund
  requested: { label: "Return requested", tint: "info", icon: CircleDashed },
  label_created: { label: "Label created", tint: "info", icon: PackageCheck },
  received: { label: "Received", tint: "approved", icon: PackageCheck },
  issued: { label: "Refund issued", tint: "approved", icon: CircleCheck },
  // threads
  active: { label: "Active", tint: "info", icon: CircleDashed },
  waiting_approval: { label: "Waiting for approval", tint: "pending", icon: Hourglass },
  escalated: { label: "With a human", tint: "pending", icon: PauseCircle },
};

export function statusMeta(status: string | null | undefined): Meta {
  return (status && STATUS_META[status]) || { label: status ?? "Unknown", tint: "expired", icon: CircleDashed };
}

export function StatusBadge({
  status,
  label,
  className,
  size = "md",
}: {
  status: string;
  label?: string;
  className?: string;
  size?: "sm" | "md";
}) {
  const m = statusMeta(status);
  const Icon = m.icon;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full font-semibold",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-[13px]",
        TINT[m.tint],
        className,
      )}
    >
      <Icon size={size === "sm" ? 13 : 14} strokeWidth={2.5} className={m.spin ? "animate-spin" : undefined} aria-hidden />
      {label ?? m.label}
    </span>
  );
}

export function TintPill({ tint, children, className }: { tint: Tint; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold", TINT[tint], className)}>
      {children}
    </span>
  );
}
