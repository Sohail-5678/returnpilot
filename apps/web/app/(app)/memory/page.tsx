"use client";

import { Brain, Check, Heart, Lightbulb, Lock, MessagesSquare, Trash2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState, ErrorState } from "@/components/states/states";
import { GlyphTile } from "@/components/ui/glyph-tile";
import { ConfirmDialog } from "@/components/ui/overlay";
import { ListSkeleton } from "@/components/ui/skeleton";
import { useDeleteMemory, useMemories } from "@/lib/api/hooks";
import type { Memory } from "@/lib/schemas";
import { formatDate } from "@/lib/utils";

const MAY = ["Shipping and contact preferences", "Sizes you mention", "Product preferences you state"];
const NEVER = ["Payment details", "Health information", "Anything you didn't say directly", "Other people's data"];

export default function MemoryPage() {
  const q = useMemories();
  const del = useDeleteMemory();
  const [target, setTarget] = useState<Memory | null>(null);

  const confirmDelete = () => {
    if (!target) return;
    const m = target;
    del.mutate(m.id, {
      onSuccess: () => toast.success("Forgotten", { description: "The agent won't use this in future conversations." }),
      onError: () => toast.error("Couldn't delete that memory. Please try again."),
    });
    setTarget(null);
  };

  return (
    <div>
      <PageHeader
        icon={Brain}
        tone="teal"
        eyebrow="Long-term memory"
        title="What ReturnPilot remembers"
        description="Preferences the agent carries between conversations. You can see and delete every one of them."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-label="Memories">
          {q.isLoading ? (
            <ListSkeleton count={3} />
          ) : q.isError ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : !q.data?.length ? (
            <EmptyState
              icon={Brain}
              tone="teal"
              title="Nothing remembered yet"
              body="When you mention a preference in chat — like how you ship returns — it shows up here."
              action={
                <Link href="/chat" className="neu-sm inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-sm font-semibold text-accent-ink">
                  <MessagesSquare size={16} aria-hidden /> Start a chat
                </Link>
              }
            />
          ) : (
            <ul className="space-y-4">
              <AnimatePresence initial={true}>
                {q.data.map((m, i) => (
                  <motion.li
                    key={m.id}
                    layout
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0, transition: { delay: i * 0.05 } }}
                    exit={{ opacity: 0, x: -24, scale: 0.97, transition: { duration: 0.25 } }}
                    className="neu flex items-center gap-4 rounded-card p-4 pr-3 sm:p-5 sm:pr-4"
                  >
                    <GlyphTile icon={m.kind === "preference" ? Heart : Lightbulb} tone={m.kind === "preference" ? "sunset" : "sky"} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[15.5px] font-semibold leading-snug text-ink">{m.content}</p>
                      <p className="mt-1 text-[12.5px] text-ink-faint">
                        <span className="font-semibold capitalize">{m.kind}</span> · learned {formatDate(m.created_at)}
                        {m.source_thread_id ? (
                          <>
                            {" · "}
                            <Link href={`/chat/${m.source_thread_id}`} className="font-semibold text-accent-ink hover:underline">
                              from a conversation
                            </Link>
                          </>
                        ) : null}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setTarget(m)}
                      aria-label={`Forget: ${m.content}`}
                      className="grid size-11 shrink-0 place-items-center rounded-full text-ink-faint transition-[color,box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:text-rejected hover:shadow-raised-sm active:shadow-inset-sm"
                    >
                      <Trash2 size={18} aria-hidden />
                    </button>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </section>

        <aside className="space-y-5">
          <div className="neu rounded-card p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <GlyphTile icon={Lock} tone="violet" size="sm" />
              <h2 className="text-[15.5px] font-bold text-ink">How memory works</h2>
            </div>
            <p className="mt-3 text-[13.5px] leading-relaxed text-ink-soft">
              After each chat a small model suggests things worth remembering. Filters drop anything sensitive or guessed, and
              near-duplicates are merged instead of stored twice.
            </p>
            <h3 className="mb-2 mt-5 text-[12px] font-bold uppercase tracking-[0.14em] text-approved-ink dark:text-approved">May be stored</h3>
            <ul className="space-y-1.5">
              {MAY.map((t) => (
                <li key={t} className="flex items-center gap-2 text-[13.5px] text-ink">
                  <Check size={15} className="shrink-0 text-approved" aria-hidden /> {t}
                </li>
              ))}
            </ul>
            <h3 className="mb-2 mt-5 text-[12px] font-bold uppercase tracking-[0.14em] text-rejected-ink dark:text-rejected">Never stored</h3>
            <ul className="space-y-1.5">
              {NEVER.map((t) => (
                <li key={t} className="flex items-center gap-2 text-[13.5px] text-ink">
                  <X size={15} className="shrink-0 text-rejected" aria-hidden /> {t}
                </li>
              ))}
            </ul>
          </div>
          <p className="px-2 text-[12.5px] leading-relaxed text-ink-faint">
            Try it: ask “Use my usual shipping preference.” in a new chat, then delete the drop-off memory and ask again.
          </p>
        </aside>
      </div>

      <ConfirmDialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title="Forget this?"
        description={
          <>
            ReturnPilot will stop using <strong className="text-ink">“{target?.content}”</strong> in future conversations. This can&apos;t be
            undone.
          </>
        }
        confirmLabel="Forget it"
        tone="danger"
        onConfirm={confirmDelete}
        pending={del.isPending}
      />
    </div>
  );
}
