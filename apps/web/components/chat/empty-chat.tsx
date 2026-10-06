"use client";

import { ArrowUpRight, Brain, ClipboardCheck, PackageSearch, ShieldCheck } from "lucide-react";
import { motion } from "motion/react";
import { useAppUser } from "@/components/session-context";
import { GlyphTile, type Tone } from "@/components/ui/glyph-tile";
import { InkChip, InkPanel } from "@/components/ui/ink-panel";
import { GENERIC_PROMPTS, PERSONAS } from "@/lib/personas";

const CAPS: { icon: typeof Brain; tone: Tone; title: string; body: string }[] = [
  { icon: PackageSearch, tone: "sunset", title: "Looks up your orders", body: "Through the store's MCP tools — never guesses." },
  { icon: ShieldCheck, tone: "teal", title: "Follows the policy", body: "Eligibility comes from tested rules, with citations." },
  { icon: ClipboardCheck, tone: "amber", title: "Asks a human", body: "Refunds over $50 wait for a reviewer." },
  { icon: Brain, tone: "violet", title: "Remembers you", body: "Preferences carry across chats. You control them." },
];

/** New-chat empty state: ink hero with persona-aware suggested prompts on frosted pills. */
export function EmptyChat({ onPick, disabled }: { onPick: (text: string) => void; disabled?: boolean }) {
  const user = useAppUser();
  const persona = user?.persona ? PERSONAS[user.persona] : null;
  const prompts = persona?.prompts.length ? persona.prompts : GENERIC_PROMPTS;
  const first = (persona?.short ?? user?.name ?? "there").split(" ")[0];

  return (
    <div className="pt-4 md:pt-6">
      <InkPanel innerClassName="rounded-t-hero px-6 pb-28 pt-9 sm:px-10 sm:pt-11" className="rounded-t-hero">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <InkChip>
            <span className="size-2 rounded-full bg-[#86EFAC] shadow-[0_0_10px_#86EFAC]" aria-hidden /> Agent online
          </InkChip>
          <h1 className="mt-5 max-w-[20ch] text-[30px] font-extrabold leading-[1.08] tracking-[-0.035em] sm:text-[40px]">
            Hi {first} — <span className="text-hero-gradient">how can I help with your orders?</span>
          </h1>
          <p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-white/80">
            Try one of these to see tools, policy citations and the human-approval step in action.
          </p>
          <ul className="mt-6 flex flex-wrap gap-2.5" aria-label="Suggested prompts">
            {prompts.map((p, i) => (
              <motion.li
                key={p}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + i * 0.06 }}
              >
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onPick(p)}
                  className="glass group inline-flex min-h-11 items-center gap-2 rounded-full px-4 py-2 text-left text-[14px] font-semibold text-white transition-[background-color,transform] duration-300 hover:-translate-y-0.5 hover:bg-white/18 disabled:opacity-60"
                >
                  {p}
                  <ArrowUpRight size={15} className="shrink-0 opacity-70 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden />
                </button>
              </motion.li>
            ))}
          </ul>
        </motion.div>
      </InkPanel>
      <div className="relative z-10 -mt-14 grid grid-cols-1 gap-4 px-2 sm:grid-cols-2 sm:px-6 xl:grid-cols-4">
        {CAPS.map((c, i) => (
          <motion.div
            key={c.title}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 + i * 0.07, type: "spring", damping: 24 }}
            className="neu flex items-start gap-3.5 rounded-[26px] p-4"
          >
            <GlyphTile icon={c.icon} tone={c.tone} size="md" />
            <div className="min-w-0">
              <p className="text-[14.5px] font-bold text-ink">{c.title}</p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-ink-soft">{c.body}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
