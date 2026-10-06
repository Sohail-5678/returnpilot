"use client";

import { CircleCheck, CircleX, Clock3, Hourglass, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import type { ApprovalStatus } from "@/lib/schemas";
import { cn, formatMoney } from "@/lib/utils";

interface Copy {
  title: string;
  body: string;
  icon: LucideIcon;
  orb: string;
  tint: string;
}

/** Plain-words copy for each approval state (SPEC §2.4/§2.5). */
export function approvalCopy(status: ApprovalStatus, amount?: number | null, note?: string | null): Copy {
  const amt = amount != null ? formatMoney(amount) : "this amount";
  switch (status) {
    case "pending":
      return {
        title: "Waiting for a human reviewer",
        body: `Refund of ${amt} is waiting for a team member's approval. Usually within minutes — you'll see the decision here.`,
        icon: Hourglass,
        orb: "linear-gradient(145deg,#FCD34D,#F59E0B)",
        tint: "bg-pending-bg text-pending-ink",
      };
    case "approved":
      return {
        title: "Approved by a team member",
        body: note ? `Refund of ${amt} approved. Note: ${note}` : `Refund of ${amt} approved and sent for processing.`,
        icon: CircleCheck,
        orb: "linear-gradient(145deg,#6EE7B7,#059669)",
        tint: "bg-approved-bg text-approved-ink",
      };
    case "rejected":
      return {
        title: "Not approved",
        body: `A team member couldn't approve this refund${note ? `: ${note}` : "."}`,
        icon: CircleX,
        orb: "linear-gradient(145deg,#FCA5A5,#DC2626)",
        tint: "bg-rejected-bg text-rejected-ink",
      };
    case "expired":
    default:
      return {
        title: "Request expired",
        body: `No one reviewed the ${amt} refund in time. Ask again and I'll resubmit it.`,
        icon: Clock3,
        orb: "linear-gradient(145deg,#D4D4D8,#71717A)",
        tint: "bg-expired-bg text-expired-ink",
      };
  }
}

export function ApprovalCard({
  status,
  amount,
  note,
  className,
}: {
  status: ApprovalStatus;
  amount?: number | null;
  note?: string | null;
  className?: string;
}) {
  const c = approvalCopy(status, amount, note);
  const Icon = c.icon;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", damping: 24, stiffness: 260 }}
      role="status"
      data-testid="approval-card"
      data-status={status}
      className={cn(
        "flex items-start gap-3.5 rounded-[22px] px-4 py-3.5 shadow-raised-sm",
        c.tint,
        status === "pending" && "animate-pulse-amber",
        className,
      )}
    >
      <span
        className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full text-white"
        style={{ background: c.orb, boxShadow: "inset 1.5px 1.5px 3px rgba(255,255,255,.5), 0 6px 14px -6px rgba(0,0,0,.35)" }}
        aria-hidden
      >
        <Icon size={17} strokeWidth={2.6} className={status === "pending" ? "animate-[spin_6s_linear_infinite]" : undefined} />
      </span>
      <div className="min-w-0">
        <p className="text-[14.5px] font-bold">{c.title}</p>
        <p className="mt-0.5 text-[14px] leading-relaxed opacity-95">{c.body}</p>
      </div>
    </motion.div>
  );
}
