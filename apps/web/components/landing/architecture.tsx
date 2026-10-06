import { Bot, Boxes, Cpu, Database, Globe, Layers, Scale, ServerCog, Sparkles, Workflow, type LucideIcon } from "lucide-react";
import { GlyphTile, type Tone } from "@/components/ui/glyph-tile";
import { cn } from "@/lib/utils";

function Node({
  icon,
  tone,
  title,
  sub,
  chips,
  className,
}: {
  icon: LucideIcon;
  tone: Tone;
  title: string;
  sub: string;
  chips?: string[];
  className?: string;
}) {
  return (
    <div className={cn("neu relative z-10 flex flex-col items-center rounded-[26px] px-4 py-5 text-center", className)}>
      <GlyphTile icon={icon} tone={tone} size="lg" />
      <p className="mt-3 text-[15px] font-bold tracking-tight text-ink">{title}</p>
      <p className="mt-0.5 text-[12.5px] text-ink-faint">{sub}</p>
      {chips ? (
        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          {chips.map((c) => (
            <span key={c} className="rounded-full bg-sunken px-2.5 py-1 text-[11px] font-semibold text-ink-soft">
              {c}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Inner({ icon, tone, title, sub }: { icon: LucideIcon; tone: Tone; title: string; sub: string }) {
  return (
    <div className="neu-sm flex items-center gap-3 rounded-[20px] p-3">
      <GlyphTile icon={icon} tone={tone} size="sm" />
      <div className="min-w-0 text-left">
        <p className="text-[13.5px] font-bold leading-tight text-ink">{title}</p>
        <p className="text-[11.5px] leading-snug text-ink-faint">{sub}</p>
      </div>
    </div>
  );
}

/** Animated dashed connector; horizontal on desktop, vertical on small screens. */
function Link({ label, className }: { label?: string; className?: string }) {
  return (
    <div className={cn("relative flex items-center justify-center", className)} aria-hidden>
      <svg className="h-10 w-3 lg:hidden" viewBox="0 0 12 40" preserveAspectRatio="none">
        <line x1="6" y1="0" x2="6" y2="40" stroke="var(--accent)" strokeWidth="2.5" strokeDasharray="5 7" strokeLinecap="round" className="animate-dash" />
      </svg>
      <svg className="hidden h-3 w-full lg:block" viewBox="0 0 100 12" preserveAspectRatio="none">
        <line x1="0" y1="6" x2="100" y2="6" stroke="var(--accent)" strokeWidth="2.5" strokeDasharray="5 7" strokeLinecap="round" className="animate-dash" vectorEffect="non-scaling-stroke" />
      </svg>
      {label ? (
        <span className="absolute left-[calc(50%+14px)] whitespace-nowrap rounded-full bg-surface px-2 py-0.5 text-[10.5px] font-bold text-ink-soft shadow-raised-sm lg:left-1/2 lg:top-[-22px] lg:-translate-x-1/2">
          {label}
        </span>
      ) : null}
    </div>
  );
}

/** Browser → Next.js (Vercel) → FastAPI container (Render) → Neon; Groq + Gemini LLMs. */
export function ArchitectureDiagram() {
  return (
    <figure className="neu-hero rounded-hero p-5 sm:p-8" aria-labelledby="arch-caption">
      <div className="grid grid-cols-1 items-center gap-0 lg:grid-cols-[1fr_68px_1.15fr_68px_2.6fr_68px_1.15fr]">
        <Node icon={Globe} tone="sky" title="Browser" sub="Chat · reviews · traces" />
        <Link label="HTTPS" />
        <Node icon={Layers} tone="violet" title="Next.js on Vercel" sub="Auth.js · route guards" chips={["JWT proxy", "SSE passthrough"]} />
        <Link label="JWT" />
        <div className="relative z-10 rounded-[30px] bg-sunken/80 p-3.5 shadow-inset sm:p-4">
          <p className="mb-3 flex items-center justify-center gap-2 text-[12.5px] font-bold uppercase tracking-[0.12em] text-ink-soft">
            <ServerCog size={15} aria-hidden /> FastAPI on Render · one Docker container
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Inner icon={Workflow} tone="violet" title="LangGraph agent" sub="Checkpoints · interrupt()" />
            <Inner icon={Boxes} tone="sunset" title="MCP server" sub="Order & refund tools" />
            <Inner icon={Scale} tone="mint" title="Policy engine" sub="Deterministic rules" />
            <Inner icon={Cpu} tone="teal" title="Celery + Redis" sub="Idempotent jobs" />
          </div>
          <div className="mt-3 flex flex-col items-center">
            <svg className="h-6 w-3" viewBox="0 0 12 24" aria-hidden>
              <line x1="6" y1="0" x2="6" y2="24" stroke="var(--accent)" strokeWidth="2.5" strokeDasharray="4 6" strokeLinecap="round" className="animate-dash" />
            </svg>
            <div className="neu-sm flex w-full items-center justify-center gap-3 rounded-[20px] px-3 py-2.5">
              <GlyphTile icon={Sparkles} tone="amber" size="sm" />
              <div className="text-left">
                <p className="text-[13.5px] font-bold text-ink">Groq + Gemini</p>
                <p className="text-[11.5px] text-ink-faint">Free LLMs · routing, fallback, quota guard</p>
              </div>
              <Bot size={16} className="ml-auto hidden text-ink-faint sm:block" aria-hidden />
            </div>
          </div>
        </div>
        <Link label="SQL" />
        <Node icon={Database} tone="teal" title="Neon Postgres" sub="+ pgvector" chips={["Business data", "Memory", "Traces"]} />
      </div>
      <figcaption id="arch-caption" className="mt-6 text-center text-[13px] text-ink-faint">
        The browser never talks to the backend directly — the Next.js server signs a 5-minute token for every call and streams replies through.
      </figcaption>
    </figure>
  );
}
