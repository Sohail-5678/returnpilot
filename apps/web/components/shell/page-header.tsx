import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { GlyphTile, type Tone } from "@/components/ui/glyph-tile";
import { Eyebrow } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

/** Light page header for list pages: glyph tile + title + one-line purpose + primary action. */
export function PageHeader({
  icon,
  tone = "violet",
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  icon: LucideIcon;
  tone?: Tone;
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-5 pb-7 pt-4 sm:flex-row sm:items-end sm:justify-between md:pt-6", className)}>
      <div className="flex items-center gap-4">
        <GlyphTile icon={icon} tone={tone} size="lg" well="raised" />
        <div className="min-w-0">
          {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
          <h1 className="mt-0.5 text-[28px] font-extrabold leading-tight tracking-[-0.03em] text-ink sm:text-[32px]">{title}</h1>
          {description ? <p className="mt-1 max-w-xl text-[15px] leading-relaxed text-ink-soft">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
  );
}

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="mb-3 mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-ink-soft transition-colors hover:bg-sunken hover:text-ink md:mt-6"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="m15 18-6-6 6-6" />
      </svg>
      {children}
    </Link>
  );
}
