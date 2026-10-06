import {
  Boxes,
  CircleDollarSign,
  Database,
  FlaskConical,
  Fingerprint,
  Hand,
  KeyRound,
  Layers,
  Repeat,
  Scale,
  ServerCog,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import { signInAsPersona } from "@/app/actions";
import { ArchitectureDiagram } from "@/components/landing/architecture";
import { SiteFooter, SiteNav } from "@/components/landing/site-chrome";
import { TryButton } from "@/components/landing/try-button";
import { DemoBanner } from "@/components/states/banners";
import { GlyphTile, type Tone } from "@/components/ui/glyph-tile";
import { InkChip, InkPanel } from "@/components/ui/ink-panel";

export const metadata: Metadata = {
  title: "How it works",
  description: "Architecture, stack and the key design decisions behind ReturnPilot — and why it costs $0 to run.",
};

const DECISIONS: { icon: LucideIcon; tone: Tone; title: string; body: string }[] = [
  {
    icon: Scale,
    tone: "mint",
    title: "The LLM proposes, deterministic code disposes",
    body: "Eligibility, refund limits and whether a human must approve come from a pure-Python policy engine with exhaustive tests. Write tools only return proposals.",
  },
  {
    icon: Hand,
    tone: "amber",
    title: "interrupt() + Postgres checkpoints",
    body: "Risky actions pause the LangGraph run at an approval gate. State is checkpointed, so a reviewer can decide hours later and the run resumes exactly where it stopped.",
  },
  {
    icon: Fingerprint,
    tone: "violet",
    title: "customer_id comes from the token",
    body: "The web server signs a 5-minute ES256 JWT per request. The agent runtime injects the customer id into every tool call — it isn't in the tool schema, so the model can't be talked into reading another customer's data.",
  },
  {
    icon: Repeat,
    tone: "teal",
    title: "Idempotent jobs",
    body: "Refunds and labels run as Celery jobs keyed by sha256(action + target + approval). Double clicks, retries or a restarted worker can't refund twice.",
  },
  {
    icon: FlaskConical,
    tone: "sky",
    title: "Trajectory evals, not vibes",
    body: "30 scenarios assert the tools called (in order), tools never called, approval routing and zero policy violations — deterministic tier on every PR, live tier nightly.",
  },
  {
    icon: Sparkles,
    tone: "sunset",
    title: "Two free providers + a quota guard",
    body: "Groq Llama 3.3 for tool use and 3.1-8B for routing, Gemini as fallback. Usage is counted per day; at 90% the router switches, and when both run out the demo degrades to read-only.",
  },
  {
    icon: Users,
    tone: "violet",
    title: "Per-visitor demo sandboxes",
    body: "Each browser gets a workspace id cookie; the backend clones the demo store for it. Customer and reviewer personas share it, so one person can play both sides privately.",
  },
  {
    icon: KeyRound,
    tone: "mint",
    title: "The browser never holds a backend token",
    body: "Auth.js keeps an httpOnly session; every API call goes through the Next.js proxy, which re-checks the role, mints the JWT and streams SSE through unbuffered.",
  },
];

const COSTS = [
  ["Vercel Hobby", "Next.js web app", "$0"],
  ["Render free web service", "Docker backend (API, agent, MCP, worker, Redis)", "$0"],
  ["Neon free", "Postgres + pgvector, 1 GB", "$0"],
  ["Groq free API", "Llama 3.3 70B / 3.1 8B", "$0"],
  ["Google AI Studio", "Gemini fallback + embeddings", "$0"],
  ["GitHub", "Code, CI, eval and cron workflows", "$0"],
];

const STACK: { icon: LucideIcon; tone: Tone; layer: string; items: string }[] = [
  { icon: Layers, tone: "violet", layer: "Web", items: "Next.js 16 · React 19 · TypeScript · Tailwind v4 · Auth.js v5 · TanStack Query · Recharts · motion" },
  { icon: ServerCog, tone: "sky", layer: "API & agent", items: "FastAPI · LangGraph (Postgres checkpointer) · langchain-mcp-adapters · SSE" },
  { icon: Boxes, tone: "sunset", layer: "Tools", items: "MCP server “commerce” (FastMCP, Streamable HTTP) · local tools for policy search & memory" },
  { icon: Database, tone: "teal", layer: "Data", items: "Neon Postgres · pgvector · hybrid retrieval (vector + full-text, RRF) · Alembic" },
  { icon: CircleDollarSign, tone: "mint", layer: "Jobs", items: "Celery + Redis in-container · retries with backoff · beat for expiring approvals" },
];

export default function AboutPage() {
  return (
    <div className="overflow-x-clip">
      <DemoBanner className="pt-2" />
      <SiteNav />
      <main id="main" className="mx-auto mt-6 w-full max-w-[1240px] px-3 sm:px-5">
        <InkPanel innerClassName="rounded-t-[44px] px-6 pb-32 pt-10 sm:px-12 sm:pt-14" className="rounded-t-[44px]">
          <InkChip>Design notes</InkChip>
          <h1 className="mt-5 max-w-[20ch] text-[38px] font-extrabold leading-[1.04] tracking-[-0.04em] sm:text-[54px]">
            How ReturnPilot <span className="text-hero-gradient">works under the hood.</span>
          </h1>
          <p className="mt-4 max-w-[60ch] text-[16.5px] leading-relaxed text-white/80">
            A support agent is easy to demo and hard to trust. These are the decisions that make this one safe to put in front of
            customers — and cheap enough to run for free.
          </p>
        </InkPanel>

        <section className="relative z-10 -mt-20 px-1 sm:px-6" aria-labelledby="arch">
          <h2 id="arch" className="sr-only">
            Architecture
          </h2>
          <ArchitectureDiagram />
        </section>

        <section className="mt-20" aria-labelledby="decisions">
          <h2 id="decisions" className="mb-8 text-center text-[30px] font-extrabold tracking-[-0.035em] text-ink sm:text-[36px]">
            Key design decisions
          </h2>
          <ul className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {DECISIONS.map((d, i) => (
              <li key={d.title} className="neu flex gap-4 rounded-[30px] p-6">
                <GlyphTile icon={d.icon} tone={d.tone} size="lg" />
                <div className="min-w-0">
                  <p className="text-[12px] font-bold tabular-nums text-ink-faint">0{i + 1}</p>
                  <h3 className="text-[17px] font-bold leading-snug tracking-tight text-ink">{d.title}</h3>
                  <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-soft">{d.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-20 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]" aria-label="Stack and cost">
          <div className="neu rounded-[32px] p-6 sm:p-8">
            <h2 className="text-[22px] font-extrabold tracking-tight text-ink">Stack</h2>
            <ul className="mt-5 space-y-4">
              {STACK.map((s) => (
                <li key={s.layer} className="flex items-start gap-4">
                  <GlyphTile icon={s.icon} tone={s.tone} size="md" />
                  <div>
                    <p className="text-[15px] font-bold text-ink">{s.layer}</p>
                    <p className="text-[14px] leading-relaxed text-ink-soft">{s.items}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="neu rounded-[32px] p-6 sm:p-8">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-[22px] font-extrabold tracking-tight text-ink">Monthly cost</h2>
              <span className="bg-button-gradient rounded-full px-4 py-1.5 text-[15px] font-extrabold text-white shadow-accent">$0</span>
            </div>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">
              No card is entered anywhere. Every service suspends or rate-limits at its free limit instead of billing.
            </p>
            <table className="mt-5 w-full text-left text-[14px]">
              <caption className="sr-only">Services and their cost</caption>
              <thead>
                <tr className="text-[12px] uppercase tracking-[0.12em] text-ink-faint">
                  <th className="pb-2 font-bold">Service</th>
                  <th className="hidden pb-2 font-bold sm:table-cell">Used for</th>
                  <th className="pb-2 text-right font-bold">Cost</th>
                </tr>
              </thead>
              <tbody>
                {COSTS.map(([svc, use, cost]) => (
                  <tr key={svc} className="border-t border-line">
                    <td className="py-2.5 pr-3 font-semibold text-ink">
                      {svc}
                      <span className="block text-[12.5px] font-normal text-ink-faint sm:hidden">{use}</span>
                    </td>
                    <td className="hidden py-2.5 pr-3 text-ink-soft sm:table-cell">{use}</td>
                    <td className="py-2.5 text-right font-bold tabular-nums text-approved-ink dark:text-approved">{cost}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-20 text-center">
          <h2 className="text-[26px] font-extrabold tracking-[-0.03em] text-ink">See it run</h2>
          <p className="mx-auto mt-2 max-w-md text-[15px] text-ink-soft">Sign in as Maya and ask about her boots. It takes three minutes.</p>
          <form action={signInAsPersona} className="mt-6">
            <input type="hidden" name="persona" value="maya" />
            <TryButton variant="primary">Try as Maya</TryButton>
          </form>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
