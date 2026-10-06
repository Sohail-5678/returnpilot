"use client";

import { Hourglass, Plus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark, LogoMark } from "@/components/brand/logo";
import { useAppUser } from "@/components/session-context";
import { Skeleton } from "@/components/ui/skeleton";
import { useApprovals, useThreads } from "@/lib/api/hooks";
import { navFor } from "@/lib/roles";
import { cn, relativeTime } from "@/lib/utils";
import { NAV_META } from "./nav-config";
import { UserMenu } from "./user-menu";

function NavLinks({ mode, onNavigate }: { mode: "full" | "rail"; onNavigate?: () => void }) {
  const user = useAppUser();
  const pathname = usePathname();
  const reviewer = user?.role === "reviewer" || user?.role === "admin";
  const pending = useApprovals("pending", reviewer);
  if (!user) return null;
  const items = navFor(user.role);
  const pendingCount = reviewer ? (pending.data?.length ?? 0) : 0;

  return (
    <nav aria-label="Main" className="flex flex-col gap-1.5">
      {items.map((item) => {
        const meta = NAV_META[item.href]!;
        const Icon = meta.icon;
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const badge = item.href === "/reviews" && pendingCount > 0 ? pendingCount : null;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            title={mode === "rail" ? item.label : undefined}
            className={cn(
              "group relative flex min-h-12 items-center gap-3 rounded-[20px] font-semibold transition-[background-color,box-shadow,color] duration-300",
              mode === "rail" ? "size-14 justify-center" : "px-2.5 pr-3",
              active ? "neu-inset-sm text-ink" : "text-ink-soft hover:bg-sunken/70 hover:text-ink",
            )}
          >
            <span
              className={cn(
                "grid size-9 shrink-0 place-items-center rounded-full transition-all duration-300",
                active ? "" : "neu-sm group-hover:-translate-y-px",
              )}
              style={
                active
                  ? {
                      background: `linear-gradient(145deg, var(--tw-a), var(--tw-b))`,
                      ["--tw-a" as string]: TONE_A[meta.tone],
                      ["--tw-b" as string]: TONE_B[meta.tone],
                      boxShadow: `0 8px 16px -6px ${TONE_B[meta.tone]}aa, inset 1.5px 1.5px 3px rgba(255,255,255,.5)`,
                    }
                  : undefined
              }
            >
              <Icon size={17} strokeWidth={2.4} color={active ? "#fff" : `url(#rp-grad-${meta.tone})`} aria-hidden />
            </span>
            {mode === "full" ? <span className="flex-1 text-[15px]">{item.label}</span> : <span className="sr-only">{item.label}</span>}
            {badge ? (
              <span
                className={cn(
                  "grid min-w-6 place-items-center rounded-full bg-pending-bg px-1.5 py-0.5 text-xs font-bold text-pending-ink",
                  mode === "rail" && "absolute -right-0.5 -top-0.5",
                )}
                aria-label={`${badge} pending`}
              >
                {badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

const TONE_A: Record<string, string> = { violet: "#C38BFF", sunset: "#FFB36B", teal: "#4FD1C5", amber: "#FCD34D", sky: "#7DD3FC", mint: "#86EFAC" };
const TONE_B: Record<string, string> = { violet: "#6B6CF6", sunset: "#FF6FA8", teal: "#7C7BFF", amber: "#F59E0B", sky: "#6B6CF6", mint: "#22C55E" };

export function ConversationList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { data, isLoading, isError } = useThreads();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex items-center justify-between gap-2 px-2">
        <h2 className="text-[11.5px] font-bold uppercase tracking-[0.16em] text-ink-faint">Conversations</h2>
        <Link
          href="/chat"
          onClick={onNavigate}
          className="neu-sm inline-flex min-h-9 shrink-0 pointer-coarse:min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-bold text-accent-ink transition-transform hover:-translate-y-px active:shadow-inset-sm"
        >
          <Plus size={14} strokeWidth={2.6} aria-hidden /> New chat
        </Link>
      </div>
      <div className="scrollbar-soft -mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-2 pt-1">
        {isLoading ? (
          <div className="space-y-2 px-1" aria-label="Loading conversations">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 rounded-[18px]" />
            ))}
          </div>
        ) : isError ? (
          <p className="px-2 py-3 text-sm text-ink-faint">Conversations unavailable right now.</p>
        ) : !data?.length ? (
          <p className="px-2 py-3 text-sm leading-relaxed text-ink-faint">No conversations yet. Start one — the agent remembers what matters.</p>
        ) : (
          <ul className="space-y-1">
            <AnimatePresence initial={false}>
              {data.map((t) => {
                const href = `/chat/${t.id}`;
                const active = pathname === href;
                return (
                  <motion.li key={t.id} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                    <Link
                      href={href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "block rounded-[18px] px-3 py-2.5 transition-[background-color,box-shadow] duration-300",
                        active ? "neu-inset-sm" : "hover:bg-sunken/70",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            "size-2 shrink-0 rounded-full",
                            t.status === "waiting_approval" ? "bg-pending" : active ? "bg-accent" : "bg-line-strong",
                          )}
                          aria-hidden
                        />
                        <span className={cn("min-w-0 flex-1 truncate text-sm", active ? "font-bold text-ink" : "font-semibold text-ink")}>
                          {t.title || "New conversation"}
                        </span>
                        <span className="shrink-0 text-[11px] text-ink-faint">{relativeTime(t.updated_at)}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5 pl-4">
                        {t.status === "waiting_approval" ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-pending-ink dark:text-pending">
                            <Hourglass size={11} aria-hidden /> Waiting for a reviewer
                          </span>
                        ) : (
                          <span className="truncate text-xs text-ink-faint">{t.last_message_preview ?? "—"}</span>
                        )}
                      </span>
                    </Link>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </div>
  );
}

/** Full sidebar content (desktop ≥1280px, and inside the mobile drawer). */
export function SidebarFull({ demoMode, onNavigate }: { demoMode: boolean; onNavigate?: () => void }) {
  const user = useAppUser();
  return (
    <div className="flex h-full flex-col gap-6">
      <Link href="/" className="rounded-2xl px-2 pt-1 text-ink" onClick={onNavigate} aria-label="ReturnPilot home">
        <Wordmark size={40} />
      </Link>
      <NavLinks mode="full" onNavigate={onNavigate} />
      {user?.role === "customer" ? <ConversationList onNavigate={onNavigate} /> : <div className="flex-1" />}
      <div className="border-t border-line pt-3">
        <UserMenu demoMode={demoMode} />
      </div>
    </div>
  );
}

/** Icon rail (768–1279px). */
export function SidebarRail({ demoMode }: { demoMode: boolean }) {
  return (
    <div className="flex h-full flex-col items-center gap-6">
      <Link href="/" aria-label="ReturnPilot home" className="rounded-2xl pt-1">
        <LogoMark size={44} />
      </Link>
      <NavLinks mode="rail" />
      <div className="flex-1" />
      <UserMenu demoMode={demoMode} compact />
    </div>
  );
}
