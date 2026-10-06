import { Boxes, Cog, Hand, MessagesSquare, Scale, type LucideIcon } from "lucide-react";
import { GlyphTile, type Tone } from "@/components/ui/glyph-tile";

const STEPS: { icon: LucideIcon; tone: Tone; title: string; body: string }[] = [
  { icon: MessagesSquare, tone: "violet", title: "Ask", body: "A customer asks about an order in plain words." },
  { icon: Boxes, tone: "sunset", title: "Tools via MCP", body: "The agent looks up orders and checks eligibility with real tools." },
  { icon: Scale, tone: "mint", title: "Policy engine", body: "Tested rules — not the AI — decide what's allowed." },
  { icon: Hand, tone: "amber", title: "Human approval", body: "Risky refunds pause until a reviewer approves." },
  { icon: Cog, tone: "teal", title: "Async job", body: "An idempotent job issues the refund; chat updates live." },
];

export function HowItWorks() {
  return (
    <ol className="relative grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5">
      <span aria-hidden className="absolute left-[10%] right-[10%] top-[52px] hidden h-[3px] rounded-full bg-[repeating-linear-gradient(90deg,var(--accent)_0_8px,transparent_8px_16px)] opacity-40 lg:block" />
      {STEPS.map((s, i) => (
        <li key={s.title} className="neu relative flex items-center gap-4 rounded-[28px] p-4 text-left sm:flex-col sm:gap-0 sm:px-4 sm:pb-6 sm:pt-5 sm:text-center">
          <span className="mb-3 hidden rounded-full bg-sunken px-2.5 py-0.5 text-[11px] font-bold tabular-nums text-ink-faint sm:inline">Step {i + 1}</span>
          <GlyphTile icon={s.icon} tone={s.tone} size="lg" well="inset" className="sm:size-20" />
          <div className="min-w-0">
            <h3 className="text-[16px] font-bold tracking-tight text-ink sm:mt-4">
              <span className="text-ink-faint sm:hidden">{i + 1}. </span>
              {s.title}
            </h3>
            <p className="mt-1 text-[13.5px] leading-relaxed text-ink-soft">{s.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
