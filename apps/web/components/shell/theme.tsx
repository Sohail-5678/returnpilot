"use client";

import { Moon, Sun } from "lucide-react";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

const KEY = "rp-theme";

/** Inline, render-blocking script: applies the theme class before first paint. */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('${KEY}');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;var r=document.documentElement;r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light';}catch(e){}})();`;

function subscribe(fn: () => void) {
  const obs = new MutationObserver(fn);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}
const getDark = () => document.documentElement.classList.contains("dark");

function apply(dark: boolean) {
  const r = document.documentElement;
  r.classList.add("theme-transition");
  r.classList.toggle("dark", dark);
  r.style.colorScheme = dark ? "dark" : "light";
  window.setTimeout(() => r.classList.remove("theme-transition"), 400);
}

export function useTheme() {
  const dark = useSyncExternalStore(subscribe, getDark, () => false);

  // Follow the OS setting until the user picks a theme explicitly.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      try {
        if (localStorage.getItem(KEY)) return;
      } catch {
        /* storage blocked */
      }
      apply(e.matches);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const toggle = useCallback(() => {
    const next = !getDark();
    try {
      localStorage.setItem(KEY, next ? "dark" : "light");
    } catch {
      /* storage blocked */
    }
    apply(next);
  }, []);

  return { dark, toggle };
}

export function ThemeToggle({ className, onInk = false }: { className?: string; onInk?: boolean }) {
  const { dark, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      className={cn(
        "relative grid size-11 shrink-0 place-items-center rounded-full transition-[transform,box-shadow] duration-300",
        onInk ? "glass text-white hover:bg-white/15" : "neu-sm text-ink-soft hover:-translate-y-0.5 hover:text-ink active:shadow-inset-sm",
        className,
      )}
    >
      <Sun size={18} aria-hidden className={cn("absolute transition-all duration-500", dark ? "rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100")} />
      <Moon size={18} aria-hidden className={cn("absolute transition-all duration-500", dark ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-0 opacity-0")} />
    </button>
  );
}
