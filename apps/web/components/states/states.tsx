"use client";

import { CloudOff, RefreshCw, type LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { ApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { GlyphTile, type Tone } from "@/components/ui/glyph-tile";
import { WakingScreen } from "./waking";

export function EmptyState({
  icon,
  tone = "violet",
  title,
  body,
  action,
  className,
}: {
  icon: LucideIcon;
  tone?: Tone;
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("neu grid place-items-center rounded-card px-6 py-14 text-center", className)}
    >
      <GlyphTile icon={icon} tone={tone} size="lg" />
      <h3 className="mt-5 text-lg font-bold tracking-tight text-ink">{title}</h3>
      {body ? <p className="mt-1.5 max-w-sm text-[15px] leading-relaxed text-ink-soft">{body}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </motion.div>
  );
}

export function ErrorState({
  error,
  onRetry,
  title,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  className?: string;
}) {
  if (error instanceof ApiError && error.isWaking) return <WakingScreen />;
  const message =
    error instanceof ApiError
      ? error.message
      : "Something went wrong while loading this. Please try again.";
  const notFound = error instanceof ApiError && error.status === 404;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      role="alert"
      className={cn("neu grid place-items-center rounded-card px-6 py-14 text-center", className)}
    >
      <GlyphTile icon={CloudOff} tone={notFound ? "slate" : "rose"} size="lg" />
      <h3 className="mt-5 text-lg font-bold tracking-tight text-ink">{title ?? (notFound ? "Not found" : "Couldn't load this")}</h3>
      <p className="mt-1.5 max-w-sm text-[15px] leading-relaxed text-ink-soft">{message}</p>
      {onRetry && !notFound ? (
        <Button variant="neu" className="mt-6" onClick={onRetry}>
          <RefreshCw size={16} aria-hidden /> Try again
        </Button>
      ) : null}
    </motion.div>
  );
}
