"use client";

import { BookOpen } from "lucide-react";
import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { citationFromHref, linkifyCitations } from "@/lib/citations";
import { cn } from "@/lib/utils";

/** Assistant/policy markdown. `[Policy §x.y]` markers become buttons that open the policy sheet. */
export const Markdown = memo(function Markdown({
  text,
  onCite,
  streaming,
  className,
}: {
  text: string;
  onCite?: (sectionId: string) => void;
  streaming?: boolean;
  className?: string;
}) {
  const components: Components = {
    a({ href, children }) {
      const section = citationFromHref(href);
      if (section) {
        return (
          <button
            type="button"
            data-cite
            onClick={() => onCite?.(section)}
            className="mx-0.5 inline-flex translate-y-[-1px] items-center gap-1 rounded-full bg-accent-soft px-2.5 py-0.5 align-baseline text-[13px] font-semibold text-accent-ink ring-1 ring-accent/20 transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-raised-sm"
            aria-label={`Open policy ${section}`}
          >
            <BookOpen size={12} strokeWidth={2.6} aria-hidden />
            {children}
          </button>
        );
      }
      return (
        <a href={href} target="_blank" rel="noreferrer noopener">
          {children}
        </a>
      );
    },
  };
  return (
    <div className={cn("md", streaming && "md-streaming", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {linkifyCitations(text)}
      </ReactMarkdown>
    </div>
  );
});
