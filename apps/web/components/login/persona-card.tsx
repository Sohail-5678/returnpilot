"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import { motion } from "motion/react";
import { useFormStatus } from "react-dom";
import { GradientAvatar } from "@/components/ui/avatar";
import type { Persona } from "@/lib/personas";
import { cn, titleCase } from "@/lib/utils";

function SubmitInner({ persona, current, featured }: { persona: Persona; current: boolean; featured?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        "neu-lift group flex h-full w-full items-start gap-4 rounded-[28px] p-5 text-left disabled:opacity-80",
        current && "ring-2 ring-accent/40",
        featured && "sm:items-center sm:p-6",
      )}
    >
      <GradientAvatar name={persona.name} gradient={persona.gradient} size="lg" />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[16.5px] font-bold tracking-tight text-ink">{persona.name}</span>
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider",
              persona.role === "customer" && "bg-info-bg text-info",
              persona.role === "reviewer" && "bg-approved-bg text-approved-ink",
              persona.role === "admin" && "bg-pending-bg text-pending-ink",
            )}
          >
            {titleCase(persona.role)}
          </span>
          {featured ? (
            <span className="bg-button-gradient rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white shadow-accent">
              Start here
            </span>
          ) : null}
          {current ? <span className="text-xs font-semibold text-accent-ink">· signed in</span> : null}
        </span>
        <span className="mt-1.5 block text-[13.5px] leading-relaxed text-ink-soft">{persona.blurb}</span>
        <span className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-bold text-accent-ink">
          {pending ? (
            <>
              <LoaderCircle size={15} className="animate-spin" aria-hidden /> Signing in…
            </>
          ) : (
            <>
              Continue as {persona.short}
              <ArrowRight size={15} className="transition-transform duration-300 group-hover:translate-x-1" aria-hidden />
            </>
          )}
        </span>
      </span>
    </button>
  );
}

export function PersonaCard({
  persona,
  next,
  action,
  index,
  current,
  featured,
}: {
  persona: Persona;
  next: string | null;
  action: (fd: FormData) => Promise<void>;
  index: number;
  current: boolean;
  featured?: boolean;
}) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.08 + index * 0.06, type: "spring", damping: 24, stiffness: 220 }}
      className={cn("list-none", featured && "sm:col-span-2")}
    >
      <form action={action} className="h-full">
        <input type="hidden" name="persona" value={persona.key} />
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <SubmitInner persona={persona} current={current} featured={featured} />
      </form>
    </motion.li>
  );
}

export function GithubSubmit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-12 w-full items-center justify-center gap-2.5 rounded-full bg-[#1f1e3d] px-6 text-[15px] font-semibold text-white shadow-[0_16px_30px_-14px_rgba(20,18,60,.8)] transition-transform hover:-translate-y-0.5 disabled:opacity-70 dark:bg-white dark:text-[#1f1e3d]"
    >
      {pending ? <LoaderCircle size={18} className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}
