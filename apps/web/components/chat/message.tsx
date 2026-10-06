"use client";

import { Activity, BookOpen, ShieldCheck } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";
import type { Citation, MessageApproval, ToolCall } from "@/lib/schemas";
import { cn, formatTime } from "@/lib/utils";
import { ApprovalCard } from "./approval-card";
import { Markdown } from "./markdown";
import { ToolChipGroup } from "./tool-chip";

const enter = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { type: "spring" as const, damping: 26, stiffness: 260 },
};

export function UserBubble({ text, at, quiet }: { text: string; at?: string; quiet?: boolean }) {
  return (
    <motion.div {...enter} initial={quiet ? false : enter.initial} className="flex flex-col items-end">
      <div className="bg-button-gradient max-w-[min(85%,560px)] whitespace-pre-wrap break-words rounded-[22px] rounded-br-[8px] px-4.5 py-3 text-[15px] leading-relaxed text-white shadow-accent">
        <span className="sr-only">You said: </span>
        {text}
      </div>
      {at ? <span className="mt-1.5 pr-1 text-[11px] font-medium text-ink-faint">{formatTime(at)}</span> : null}
    </motion.div>
  );
}

export function AssistantAvatar() {
  return (
    <span className="mt-0.5 hidden sm:block">
      <LogoMark size={34} />
    </span>
  );
}

export function AssistantMessage({
  text,
  tools,
  citations,
  approval,
  streaming,
  replaced,
  at,
  runId,
  onCite,
  showAvatar = true,
  quiet,
}: {
  text: string;
  tools: ToolCall[];
  citations: Citation[];
  approval?: MessageApproval | null;
  streaming?: boolean;
  replaced?: boolean;
  at?: string;
  runId?: string;
  onCite: (sectionId: string) => void;
  showAvatar?: boolean;
  /** Skip the enter animation (server copy replacing an already-visible live message). */
  quiet?: boolean;
}) {
  const node = (
    <motion.div {...enter} initial={quiet ? false : enter.initial} className="flex items-start gap-3">
      {showAvatar ? <AssistantAvatar /> : <span className="hidden w-[34px] shrink-0 sm:block" />}
      <div className="flex min-w-0 max-w-[min(100%,680px)] flex-1 flex-col gap-2.5">
        {tools.length ? <ToolChipGroup tools={tools} /> : null}
        {text ? (
          <div className="neu-sm rounded-[22px] rounded-tl-[8px] px-5 py-3.5 text-[15px] text-ink">
            <span className="sr-only">ReturnPilot said: </span>
            <Markdown text={text} onCite={onCite} streaming={streaming} />
          </div>
        ) : null}
        {approval ? <ApprovalCard status={approval.status} amount={approval.amount} note={approval.note} /> : null}
        {!streaming && (citations.length > 0 || replaced || at || runId) ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-1 text-[11.5px] font-medium text-ink-faint">
            {at ? <span>{formatTime(at)}</span> : null}
            {citations.length ? (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <span>Sources</span>
                {citations.map((c) => (
                  <button
                    key={c.section_id}
                    type="button"
                    onClick={() => onCite(c.section_id)}
                    className="inline-flex min-h-7 items-center gap-1 rounded-full bg-surface px-2.5 pointer-coarse:min-h-11 font-semibold text-accent-ink shadow-raised-sm transition-transform hover:-translate-y-px"
                  >
                    <BookOpen size={11} aria-hidden />
                    {c.section_id}
                    {c.heading ? <span className="font-medium text-ink-faint">· {c.heading}</span> : null}
                  </button>
                ))}
              </span>
            ) : null}
            {replaced ? (
              <span className="inline-flex items-center gap-1 text-pending-ink dark:text-pending">
                <ShieldCheck size={12} aria-hidden /> Adjusted by the safety check
              </span>
            ) : null}
            {runId ? (
              <Link href={`/runs/${runId}`} className="inline-flex min-h-7 items-center gap-1 rounded-full px-2 font-semibold text-accent-ink pointer-coarse:min-h-11 hover:bg-surface">
                <Activity size={12} aria-hidden /> Trace
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </motion.div>
  );
  // Nested chips/cards skip their enter animation too when the message is "quiet".
  return quiet ? <AnimatePresence initial={false}>{node}</AnimatePresence> : node;
}

export function SystemNote({ text, at }: { text: string; at?: string }) {
  return (
    <motion.div {...enter} className="flex justify-center">
      <p className="neu-inset-sm max-w-md rounded-full px-4 py-2 text-center text-[13px] font-medium text-ink-soft">
        {text}
        {at ? <span className="ml-2 text-ink-faint">{formatTime(at)}</span> : null}
      </p>
    </motion.div>
  );
}

export function TypingIndicator({ label, className }: { label?: string; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className={cn("flex items-center gap-3", className)}
    >
      <AssistantAvatar />
      <div className="neu-sm flex items-center gap-3 rounded-full py-2.5 pl-4 pr-5" role="status">
        <span className="flex items-center gap-1" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span key={i} className="typing-dot size-2 rounded-full bg-accent" style={{ animationDelay: `${i * 0.16}s` }} />
          ))}
        </span>
        <span className="text-[13.5px] font-medium text-ink-soft">{label || "Thinking…"}</span>
      </div>
    </motion.div>
  );
}
