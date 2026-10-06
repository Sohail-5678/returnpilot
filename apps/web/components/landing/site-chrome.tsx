import Link from "next/link";
import { GithubIcon, Wordmark } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/shell/theme";
import { ServerStatus } from "./server-status";

export const GITHUB_URL = process.env.NEXT_PUBLIC_GITHUB_URL || "https://github.com/Sohail-5678/returnpilot";

export function SiteNav() {
  return (
    <header className="sticky top-3 z-40 mx-auto w-full max-w-[1240px] px-3 sm:px-5">
      <nav aria-label="Primary" className="glass-light flex items-center gap-2 rounded-full py-2 pl-4 pr-2 shadow-raised-sm sm:gap-3">
        <Link href="/" className="rounded-2xl text-ink" aria-label="ReturnPilot home">
          <Wordmark size={34} />
        </Link>
        <div className="ml-4 hidden items-center gap-1 lg:flex">
          {[
            ["How it works", "/#how"],
            ["Architecture", "/#architecture"],
            ["About", "/about"],
          ].map(([label, href]) => (
            <Link key={href} href={href!} className="rounded-full px-3.5 py-2 text-[14px] font-semibold text-ink-soft transition-colors hover:bg-sunken hover:text-ink">
              {label}
            </Link>
          ))}
        </div>
        <div className="flex-1" />
        <ServerStatus className="hidden md:inline-flex" />
        <a
          href={GITHUB_URL}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Source code on GitHub"
          className="neu-sm grid size-11 place-items-center rounded-full text-ink transition-transform hover:-translate-y-0.5"
        >
          <GithubIcon size={18} />
        </a>
        <ThemeToggle className="hidden sm:grid" />
        <Link
          href="/login"
          className="bg-button-gradient inline-flex min-h-11 items-center rounded-full px-5 text-[14.5px] font-bold text-white shadow-accent transition-transform hover:-translate-y-0.5"
        >
          Sign in
        </Link>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mx-auto mt-24 w-full max-w-[1240px] px-3 pb-10 sm:px-5">
      <div className="neu flex flex-col gap-6 rounded-[32px] p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div>
          <Wordmark size={36} />
          <p className="mt-3 max-w-md text-[13.5px] leading-relaxed text-ink-soft">
            A portfolio project: an AI returns agent with MCP tools, a deterministic policy engine, memory, human approval and full
            tracing — running entirely on free tiers.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/about" className="neu-sm inline-flex min-h-11 items-center rounded-full px-5 text-sm font-semibold text-ink transition-transform hover:-translate-y-0.5">
            Design notes
          </Link>
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#1f1e3d] px-5 text-sm font-semibold text-white shadow-[0_14px_28px_-12px_rgba(20,18,60,.7)] transition-transform hover:-translate-y-0.5 dark:bg-white dark:text-[#1f1e3d]"
          >
            <GithubIcon size={17} /> View on GitHub
          </a>
        </div>
      </div>
      <p className="mt-6 text-center text-[12.5px] text-ink-faint">
        Northwind Outfitters is a fictional store. Payments and emails are simulated. Built with Next.js, FastAPI and LangGraph.
      </p>
    </footer>
  );
}
