"use client";

import { LoaderCircle } from "lucide-react";
import { useFormStatus } from "react-dom";
import { cn } from "@/lib/utils";

/** Submit button for the "Try as …" server-action forms, with a pending spinner. */
export function TryButton({ children, variant = "ink", className }: { children: React.ReactNode; variant?: "ink" | "glass" | "primary"; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        "inline-flex min-h-13 items-center justify-center gap-2 rounded-full px-6 text-[15.5px] font-bold transition-[transform,box-shadow,background-color] duration-300 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-75",
        variant === "ink" && "bg-white text-[#23224a] shadow-[0_18px_36px_-14px_rgba(10,8,50,.8)]",
        variant === "glass" && "glass text-white hover:bg-white/18",
        variant === "primary" && "bg-button-gradient text-white shadow-accent",
        className,
      )}
    >
      {pending ? <LoaderCircle size={18} className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}
