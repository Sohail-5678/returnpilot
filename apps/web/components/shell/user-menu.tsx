"use client";

import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, Check, ChevronsUpDown, LoaderCircle, LogOut, Moon, Repeat, Sun } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";
import { signOutAction, switchPersona } from "@/app/actions";
import { useAppUser } from "@/components/session-context";
import { GradientAvatar } from "@/components/ui/avatar";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { PERSONA_ORDER, PERSONAS } from "@/lib/personas";
import { cn, titleCase } from "@/lib/utils";
import { useTheme } from "./theme";

export function UserMenu({
  demoMode,
  compact = false,
  side = "top",
  align = "start",
}: {
  demoMode: boolean;
  compact?: boolean;
  side?: "top" | "bottom";
  align?: "start" | "end";
}) {
  const user = useAppUser();
  const qc = useQueryClient();
  const [pending, start] = useTransition();
  const { dark, toggle } = useTheme();
  if (!user) return null;
  const persona = user.persona ? PERSONAS[user.persona] : null;

  const switchTo = (key: string) =>
    start(async () => {
      qc.clear();
      await switchPersona(key);
    });

  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account menu for ${user.name}`}
          className={cn(
            "group flex min-h-12 items-center gap-3 rounded-[22px] text-left transition-[box-shadow,background-color] duration-300",
            compact ? "size-12 justify-center rounded-full" : "w-full p-2 pr-3 hover:bg-sunken data-[state=open]:shadow-inset-sm",
          )}
        >
          <span className="relative">
            <GradientAvatar name={user.name} gradient={persona?.gradient} size="md" />
            {pending ? (
              <span className="absolute inset-0 grid place-items-center rounded-full bg-black/35">
                <LoaderCircle size={16} className="animate-spin text-white" aria-hidden />
              </span>
            ) : null}
          </span>
          {!compact ? (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-ink">{user.name}</span>
                <span className="block truncate text-xs font-medium text-ink-faint">
                  {titleCase(user.role)}
                  {user.login ? ` · @${user.login}` : persona ? " · demo" : ""}
                </span>
              </span>
              <ChevronsUpDown size={16} className="text-ink-faint" aria-hidden />
            </>
          ) : null}
        </button>
      </MenuTrigger>
      <MenuContent side={side} align={align}>
        {demoMode ? (
          <>
            <MenuLabel>
              <span className="inline-flex items-center gap-1.5">
                <Repeat size={12} aria-hidden /> Switch demo persona
              </span>
            </MenuLabel>
            {PERSONA_ORDER.map((key) => {
              const p = PERSONAS[key];
              const current = user.persona === key;
              return (
                <MenuItem key={key} disabled={current || pending} onSelect={() => switchTo(key)}>
                  <GradientAvatar name={p.name} gradient={p.gradient} size="sm" ring={false} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{p.short}</span>
                    <span className="block truncate text-xs text-ink-faint">{titleCase(p.role)}</span>
                  </span>
                  {current ? <Check size={16} className="text-accent-ink" aria-label="Current persona" /> : null}
                </MenuItem>
              );
            })}
            <MenuSeparator />
          </>
        ) : null}
        <MenuItem onSelect={(e) => { e.preventDefault(); toggle(); }}>
          {dark ? <Sun size={17} aria-hidden /> : <Moon size={17} aria-hidden />}
          {dark ? "Light theme" : "Dark theme"}
        </MenuItem>
        <MenuItem asChild>
          <Link href="/about">
            <BookOpen size={17} aria-hidden /> How it works
          </Link>
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          onSelect={() =>
            start(async () => {
              qc.clear();
              await signOutAction();
            })
          }
        >
          <LogOut size={17} aria-hidden /> Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
