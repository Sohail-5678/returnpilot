"use client";

import { BookOpen } from "lucide-react";
import { Sheet } from "@/components/ui/overlay";
import { Skeleton } from "@/components/ui/skeleton";
import { GlyphTile } from "@/components/ui/glyph-tile";
import { ErrorState } from "@/components/states/states";
import { usePolicy } from "@/lib/api/hooks";
import { Markdown } from "./markdown";

/** Side sheet with the cited policy section (GET /api/v1/policies/{section_id}). */
export function CitationSheet({ sectionId, onClose }: { sectionId: string | null; onClose: () => void }) {
  const q = usePolicy(sectionId);
  return (
    <Sheet
      open={!!sectionId}
      onOpenChange={(o) => !o && onClose()}
      title={q.data ? `${q.data.doc_title} · ${q.data.section_id}` : `Policy ${sectionId ?? ""}`}
      description="The exact store policy text the agent cited."
    >
      {q.isLoading ? (
        <div className="space-y-3 pt-2" aria-label="Loading policy">
          <Skeleton className="h-6 w-2/3 rounded-full" />
          <Skeleton className="h-3 w-full rounded-full" />
          <Skeleton className="h-3 w-full rounded-full" />
          <Skeleton className="h-3 w-4/5 rounded-full" />
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} className="shadow-none" />
      ) : q.data ? (
        <article className="pt-1">
          <div className="neu-sm flex items-center gap-3.5 rounded-[22px] p-4">
            <GlyphTile icon={BookOpen} tone="violet" size="md" />
            <div className="min-w-0">
              <p className="font-mono text-xs font-medium text-ink-faint">{q.data.doc}.md</p>
              <h3 className="text-[17px] font-bold tracking-tight text-ink">
                {q.data.section_id} {q.data.heading}
              </h3>
            </div>
          </div>
          <Markdown text={q.data.text} className="mt-5 text-[15px] text-ink-soft" />
          <p className="mt-6 rounded-2xl bg-sunken px-4 py-3 text-[13px] leading-relaxed text-ink-faint">
            Policy text is retrieved from the indexed policy documents. Eligibility and refund limits are enforced by the
            deterministic policy engine — the AI can&apos;t override them.
          </p>
        </article>
      ) : null}
    </Sheet>
  );
}
