import { ArrowLeft, CircleAlert, ClipboardCheck, MessagesSquare, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { signInAsPersona, signInWithGithub } from "@/app/actions";
import { getAppUser } from "@/auth";
import { GithubIcon, Wordmark } from "@/components/brand/logo";
import { GithubSubmit, PersonaCard } from "@/components/login/persona-card";
import { ThemeToggle } from "@/components/shell/theme";
import { DemoBanner } from "@/components/states/banners";
import { GlyphTile } from "@/components/ui/glyph-tile";
import { InkChip, InkPanel } from "@/components/ui/ink-panel";
import { PERSONA_ORDER, PERSONAS } from "@/lib/personas";
import { homeFor, safeNextPath } from "@/lib/roles";
import { serverEnv } from "@/lib/server/env";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Pick a demo persona — a customer, a reviewer or an admin — and try ReturnPilot.",
};

const STEPS = [
  { icon: MessagesSquare, tone: "violet" as const, title: "Ask as Maya", body: "“Can I return the boots from my last order?”" },
  { icon: ClipboardCheck, tone: "amber" as const, title: "Approve as Riley", body: "The $129 refund waits in the review queue." },
  { icon: Sparkles, tone: "mint" as const, title: "Watch it finish", body: "The job runs and the chat updates live." },
];

export default async function LoginPage(props: PageProps<"/login">) {
  const sp = await props.searchParams;
  const next = safeNextPath(typeof sp.next === "string" ? sp.next : null);
  const error = typeof sp.error === "string" ? sp.error : null;
  const user = await getAppUser();
  const demo = serverEnv.demoMode();
  const github = serverEnv.githubEnabled();

  return (
    <div className="min-h-dvh">
      <DemoBanner className="pt-3" />
      <div className="mx-auto grid grid-cols-1 max-w-[1320px] gap-0 px-3 pb-10 md:px-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-2">
        {/* Ink side: bottom wave on mobile, right wave on desktop */}
        <InkPanel wave="bottom" className="lg:hidden" innerClassName="rounded-t-hero px-6 pb-24 pt-8">
          <LoginIntro compact />
        </InkPanel>
        <InkPanel wave="right" className="sticky top-4 hidden h-[calc(100dvh-72px)] min-h-[620px] lg:block" innerClassName="h-full rounded-l-hero py-11 pl-11 pr-32" contentClassName="h-full">
          <LoginIntro />
        </InkPanel>

        <main id="main" className="relative z-10 -mt-12 px-1 sm:px-3 lg:mt-0 lg:px-6 lg:py-6">
          <div className="flex items-center justify-between gap-3 pb-5 pt-2 lg:pt-4">
            <Link href="/" className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-surface px-4 text-sm font-semibold text-ink-soft shadow-raised-sm hover:text-ink lg:bg-transparent lg:shadow-none">
              <ArrowLeft size={16} aria-hidden /> Home
            </Link>
            <ThemeToggle />
          </div>

          <h1 className="text-[28px] font-extrabold tracking-[-0.03em] text-ink sm:text-[34px]">Choose who you are</h1>
          <p className="mt-1.5 max-w-xl text-[15px] leading-relaxed text-ink-soft">
            No password needed. Each browser gets its own private copy of the demo store, shared across personas so you can
            play both sides.
          </p>

          {error ? (
            <p role="alert" className="mt-5 flex items-center gap-2.5 rounded-2xl bg-rejected-bg px-4 py-3 text-sm font-medium text-rejected-ink">
              <CircleAlert size={17} aria-hidden /> Sign-in didn&apos;t work. Please try again.
            </p>
          ) : null}
          {user ? (
            <p className="mt-5 flex flex-wrap items-center gap-2 rounded-2xl bg-info-bg px-4 py-3 text-sm font-medium text-info">
              You&apos;re signed in as <strong>{user.name}</strong>.
              <Link href={homeFor(user.role)} className="font-bold underline underline-offset-4">
                Continue
              </Link>
              or pick another persona.
            </p>
          ) : null}

          {demo ? (
            <>
              <h2 className="mb-3 mt-8 text-[11.5px] font-bold uppercase tracking-[0.16em] text-ink-faint">Customers</h2>
              <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                {PERSONA_ORDER.filter((k) => PERSONAS[k].role === "customer").map((k, i) => (
                  <PersonaCard
                    key={k}
                    persona={PERSONAS[k]}
                    next={next}
                    action={signInAsPersona}
                    index={i}
                    current={user?.persona === k}
                    featured={k === "maya"}
                  />
                ))}
              </ul>
              <h2 className="mb-3 mt-8 text-[11.5px] font-bold uppercase tracking-[0.16em] text-ink-faint">Staff</h2>
              <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                {PERSONA_ORDER.filter((k) => PERSONAS[k].role !== "customer").map((k, i) => (
                  <PersonaCard key={k} persona={PERSONAS[k]} next={next} action={signInAsPersona} index={i + 3} current={user?.persona === k} />
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-8 rounded-2xl bg-sunken px-5 py-4 text-sm text-ink-soft">Demo personas are turned off on this deployment.</p>
          )}

          {github ? (
            <div className="neu mt-8 rounded-[28px] p-5 sm:p-6">
              <p className="text-[15px] font-bold text-ink">Prefer your own account?</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                GitHub sign-in maps you to a demo customer. Allow-listed logins get reviewer or admin access.
              </p>
              <form action={signInWithGithub} className="mt-4">
                {next ? <input type="hidden" name="next" value={next} /> : null}
                <GithubSubmit>
                  <GithubIcon size={18} /> Continue with GitHub
                </GithubSubmit>
              </form>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}

function LoginIntro({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex h-full flex-col">
      <Link href="/" className="w-fit rounded-2xl text-white" aria-label="ReturnPilot home">
        <Wordmark />
      </Link>
      <div className="mt-7 lg:mt-16">
        <InkChip>Live demo · 3 minutes</InkChip>
        <p className="mt-5 max-w-[16ch] text-[32px] font-extrabold leading-[1.06] tracking-[-0.035em] lg:text-[44px]">
          Play both sides of a <span className="text-hero-gradient">risky refund.</span>
        </p>
        <p className="mt-4 max-w-[40ch] text-[15px] leading-relaxed text-white/80">
          The agent handles the easy parts. When money is at stake, it stops and asks a person.
        </p>
      </div>
      <ol className={compact ? "hidden" : "mt-8 space-y-3 lg:mt-auto"}>
        {STEPS.map((s, i) => (
          <li key={s.title} className="glass flex items-center gap-3.5 rounded-[22px] p-3 pr-4">
            <GlyphTile icon={s.icon} tone={s.tone} size="sm" well="none" />
            <div className="min-w-0">
              <p className="text-[14px] font-bold">
                <span className="mr-1.5 text-white/60">{i + 1}.</span>
                {s.title}
              </p>
              <p className="text-[13px] text-white/75">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
