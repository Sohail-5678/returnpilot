"use client";

import { Info, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { backendStatus, useBackendStatus } from "@/lib/backend-status";
import { cn } from "@/lib/utils";

/** SPEC §2.4 — shown on every page. */
export function DemoBanner({ className }: { className?: string }) {
  return (
    <div
      role="note"
      className={cn(
        "relative z-30 flex items-center justify-center gap-2 px-4 py-2 text-center text-[12.5px] font-medium text-ink-soft",
        className,
      )}
    >
      <Info size={14} className="shrink-0 text-accent-ink" aria-hidden />
      <span>
        <strong className="font-semibold text-ink">Demo store.</strong> Payments and emails are simulated. Don&apos;t enter real
        personal data.
      </span>
    </div>
  );
}

/** SPEC §2.5 "Quota reached" copy, shown after any 503 quota_exhausted. */
export function QuotaBanner() {
  const { quotaExhausted } = useBackendStatus();
  return (
    <AnimatePresence initial={false}>
      {quotaExhausted ? (
        <motion.div
          initial={{ opacity: 0, y: -8, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={{ opacity: 0, y: -8, height: 0 }}
          className="relative z-30 px-4"
        >
          <div
            role="status"
            className="mx-auto mb-3 flex max-w-3xl items-start gap-3 rounded-3xl bg-pending-bg px-5 py-3.5 text-sm text-pending-ink shadow-raised-sm"
          >
            <Sparkles size={18} className="mt-0.5 shrink-0" aria-hidden />
            <p className="flex-1 font-medium leading-relaxed">
              The demo&apos;s free AI quota for today is used up. You can still explore orders, the review queue and recorded
              runs.
            </p>
            <button
              type="button"
              onClick={() => backendStatus.setQuota(false)}
              className="-m-2 grid size-11 shrink-0 place-items-center rounded-full hover:bg-black/5"
              aria-label="Dismiss quota notice"
            >
              <X size={16} aria-hidden />
            </button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
