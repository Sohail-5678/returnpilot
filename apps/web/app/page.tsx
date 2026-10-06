import {
  Activity,
  ArrowRight,
  Boxes,
  Brain,
  Clock3,
  FlaskConical,
  Hand,
  Scale,
  ShieldCheck,
  Sparkles,
  Star,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { signInAsPersona } from "@/app/actions";
import { ArchitectureDiagram } from "@/components/landing/architecture";
import { HeroDemo } from "@/components/landing/hero-demo";
import { HowItWorks } from "@/components/landing/how-it-works";
import { GITHUB_URL, SiteFooter, SiteNav } from "@/components/landing/site-chrome";
import { TryButton } from "@/components/landing/try-button";
import { DemoBanner } from "@/components/states/banners";
import { GlyphTile, type Tone } from "@/components/ui/glyph-tile";
import { InkChip, InkPanel } from "@/components/ui/ink-panel";

const TILES: { icon: LucideIcon; tone: Tone; title: string; body: string }[] = [
  { icon: ShieldCheck, tone: "teal", title: "Follows the rules", body: "Eligibility and refund limits come from tested code, never from the AI's guess." },
  { icon: Clock3, tone: "sunset", title: "Waits for a human", body: "Refunds over $50 pause until a reviewer approves, edits, or rejects them." },
  { icon: Star, tone: "violet", title: "Remembers you", body: "Preferences carry across chats, and every step is traced so you can see why." },
];

const FEATURES: { icon: LucideIcon; tone: Tone; title: string; body: string }[] = [
  { icon: Boxes, tone: "sunset", title: "Real tools over MCP", body: "A custom Model Context Protocol server exposes the order system. The customer id is injected from the token, so the model can't ask for someone else's data." },
  { icon: Scale, tone: "mint", title: "LLM proposes, code disposes", body: "Write tools return proposals. A deterministic policy engine with 100% test coverage decides eligibility, limits and when a human is needed." },
  { icon: Hand, tone: "amber", title: "Pause, approve, resume", body: "LangGraph interrupts at the approval gate and checkpoints to Postgres — a reviewer can decide hours later and the run resumes exactly there." },
  { icon: Brain, tone: "violet", title: "Memory you control", body: "Long-term preferences live in pgvector, are filtered for sensitive data, and can be viewed and deleted by the customer." },
  { icon: Activity, tone: "sky", title: "Every step traced", body: "Router, LLM calls, tools, guards, policy, interrupts and jobs — with timings and tokens — on a step-by-step timeline." },
  { icon: FlaskConical, tone: "teal", title: "Evaluated on trajectories", body: "30 scenarios check the right tools in the right order, forbidden tools never called and zero policy violations." },
];

const STACK = [
  "Next.js 16",
  "React 19",
  "TypeScript",
  "Tailwind CSS v4",
  "Auth.js",
  "TanStack Query",
  "FastAPI",
  "LangGraph",
  "MCP",
  "Celery + Redis",
  "PostgreSQL",
  "pgvector",
  "Groq · Llama 3.3",
  "Gemini",
  "Vercel",
  "Render",
  "Neon",
];

export default function LandingPage() {
  return (
    <div className="overflow-x-clip">
      <DemoBanner className="pt-2" />
      <SiteNav />

      <main id="main">
        {/* Hero */}
        <section className="mx-auto mt-6 w-full max-w-[1240px] px-3 sm:px-5" aria-labelledby="hero-title">
          <InkPanel innerClassName="rounded-t-[44px] px-6 pb-36 pt-10 sm:px-12 sm:pt-14 lg:pb-44" className="rounded-t-[44px]">
            <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
              <div>
                <InkChip>
                  <Sparkles size={14} aria-hidden /> Agent · Tools · Memory · Human approval
                </InkChip>
                <h1 id="hero-title" className="mt-6 text-[38px] font-extrabold leading-[1.04] tracking-[-0.04em] sm:text-[54px] xl:text-[62px]">
                  <span className="sm:block">The returns agent </span>
                  <span className="sm:block">
                    that <span className="text-hero-gradient">knows when </span>
                  </span>
                  <span className="text-hero-gradient sm:block">to ask.</span>
                </h1>
                <p className="mt-5 max-w-[52ch] text-[16.5px] leading-relaxed text-white/82 sm:text-[17.5px]">
                  An AI support agent for a demo store. It looks up orders, checks the return policy and starts returns. Before any
                  risky refund, it stops and waits for a person to approve.
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                  <form action={signInAsPersona}>
                    <input type="hidden" name="persona" value="maya" />
                    <TryButton variant="ink" className="w-full sm:w-auto">
                      Try as Maya <span className="font-semibold text-[#5c5d82]">· customer</span>
                    </TryButton>
                  </form>
                  <form action={signInAsPersona}>
                    <input type="hidden" name="persona" value="reviewer" />
                    <TryButton variant="glass" className="w-full sm:w-auto">
                      Try as reviewer
                    </TryButton>
                  </form>
                  <Link
                    href="/about"
                    className="group inline-flex min-h-13 items-center justify-center gap-2 rounded-full px-5 text-[15.5px] font-bold text-white/90 transition-colors hover:text-white"
                  >
                    Take the tour
                    <ArrowRight size={17} className="transition-transform duration-300 group-hover:translate-x-1" aria-hidden />
                  </Link>
                </div>
                <p className="mt-6 text-[13.5px] text-white/65">
                  3-minute demo · no sign-up · each visitor gets a private copy of the store
                </p>
              </div>
              <div className="mx-auto w-full max-w-[460px] lg:mr-0">
                <HeroDemo />
              </div>
            </div>
          </InkPanel>

          <div className="relative z-10 -mt-24 grid grid-cols-1 gap-6 px-2 sm:px-8 md:grid-cols-3 lg:-mt-28">
            {TILES.map((t, i) => (
              <article key={t.title} className="neu animate-float rounded-[30px] p-6" style={{ animationDelay: `${-i * 2}s` }}>
                <GlyphTile icon={t.icon} tone={t.tone} size="lg" />
                <h2 className="mt-4 text-[17px] font-bold tracking-tight text-ink">{t.title}</h2>
                <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-soft">{t.body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto mt-24 w-full max-w-[1240px] scroll-mt-28 px-3 sm:px-5" aria-labelledby="how-title">
          <SectionHead eyebrow="How it works" title="One request, five safe steps" id="how-title">
            Every chat turn runs through the same pipeline. The interesting part is step four: the agent can&apos;t move money on its
            own.
          </SectionHead>
          <HowItWorks />
        </section>

        {/* Architecture */}
        <section id="architecture" className="mx-auto mt-24 w-full max-w-[1240px] scroll-mt-28 px-3 sm:px-5" aria-labelledby="arch-title">
          <SectionHead eyebrow="Architecture" title="Small, real, and free to run" id="arch-title">
            A Next.js front end on Vercel talks to one Docker container on Render: the agent, the MCP server, the policy engine and a
            job queue, all backed by Postgres on Neon.
          </SectionHead>
          <ArchitectureDiagram />
        </section>

        {/* Features */}
        <section className="mx-auto mt-24 w-full max-w-[1240px] px-3 sm:px-5" aria-labelledby="features-title">
          <SectionHead eyebrow="What it shows" title="What companies actually build" id="features-title">
            Not a single prompt with no tools — the pieces a production support agent needs.
          </SectionHead>
          <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <li key={f.title} className="neu-lift rounded-[30px] p-6">
                <GlyphTile icon={f.icon} tone={f.tone} size="lg" />
                <h3 className="mt-4 text-[17px] font-bold tracking-tight text-ink">{f.title}</h3>
                <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-soft">{f.body}</p>
              </li>
            ))}
          </ul>
          <ul className="mt-10 flex flex-wrap justify-center gap-2.5" aria-label="Tech stack">
            {STACK.map((s) => (
              <li key={s} className="neu-sm rounded-full px-4 py-2 text-[13.5px] font-semibold text-ink-soft">
                {s}
              </li>
            ))}
          </ul>
        </section>

        {/* CTA */}
        <section className="mx-auto mt-24 w-full max-w-[1240px] px-3 sm:px-5" aria-labelledby="cta-title">
          <InkPanel wave="none" innerClassName="rounded-hero px-6 py-12 text-center sm:px-12" className="rounded-hero">
            <h2 id="cta-title" className="mx-auto max-w-[22ch] text-[30px] font-extrabold leading-tight tracking-[-0.035em] sm:text-[40px]">
              Play both sides of a <span className="text-hero-gradient">risky refund.</span>
            </h2>
            <p className="mx-auto mt-3 max-w-[48ch] text-[15.5px] leading-relaxed text-white/80">
              Ask for a refund as Maya, approve it as Riley, then watch the job finish and the chat update — in about three minutes.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <form action={signInAsPersona}>
                <input type="hidden" name="persona" value="maya" />
                <TryButton variant="ink" className="w-full sm:w-auto">
                  Start the demo
                </TryButton>
              </form>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="glass inline-flex min-h-13 items-center justify-center gap-2 rounded-full px-6 text-[15.5px] font-bold text-white transition-colors hover:bg-white/18"
              >
                Read the code
              </a>
            </div>
          </InkPanel>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

function SectionHead({ eyebrow, title, id, children }: { eyebrow: string; title: string; id: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto mb-10 max-w-2xl text-center">
      <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-accent-ink">{eyebrow}</p>
      <h2 id={id} className="mt-2 text-[30px] font-extrabold leading-tight tracking-[-0.035em] text-ink sm:text-[38px]">
        {title}
      </h2>
      <p className="mt-3 text-[15.5px] leading-relaxed text-ink-soft">{children}</p>
    </div>
  );
}
