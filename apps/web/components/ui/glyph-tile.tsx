import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type Tone = "teal" | "sunset" | "violet" | "sky" | "mint" | "amber" | "rose" | "slate";

export const TONES: Record<Tone, [string, string]> = {
  teal: ["#4FD1C5", "#7C7BFF"],
  sunset: ["#FFB36B", "#FF6FA8"],
  violet: ["#C38BFF", "#6B6CF6"],
  sky: ["#7DD3FC", "#6B6CF6"],
  mint: ["#86EFAC", "#22C55E"],
  amber: ["#FCD34D", "#F59E0B"],
  rose: ["#FDA4AF", "#E11D48"],
  slate: ["#CBD5E1", "#64748B"],
};

const SIZES = {
  sm: { well: "size-10", orb: "size-7", icon: 15 },
  md: { well: "size-13", orb: "size-9", icon: 18 },
  lg: { well: "size-16", orb: "size-11", icon: 22 },
  xl: { well: "size-20", orb: "size-14", icon: 26 },
} as const;

/**
 * Round neumorphic well holding a pastel gradient "orb" with a white glyph —
 * the 3D-ish icon tiles from the reference design.
 */
export function GlyphTile({
  icon: Icon,
  tone = "violet",
  size = "md",
  well = "inset",
  className,
  label,
}: {
  icon: LucideIcon;
  tone?: Tone;
  size?: keyof typeof SIZES;
  well?: "inset" | "raised" | "none" | "glass";
  className?: string;
  label?: string;
}) {
  const s = SIZES[size];
  const [a, b] = TONES[tone];
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        "relative inline-grid shrink-0 place-items-center rounded-full",
        s.well,
        well === "inset" && "neu-inset-sm",
        well === "raised" && "neu-sm",
        well === "glass" && "glass",
        className,
      )}
    >
      <span
        className={cn("grid place-items-center rounded-full", s.orb)}
        style={{
          background: `linear-gradient(145deg, ${a}, ${b})`,
          boxShadow: `0 8px 16px -6px ${b}99, inset 1.5px 1.5px 3px rgba(255,255,255,.55), inset -2px -2px 4px rgba(0,0,0,.12)`,
        }}
      >
        <Icon size={s.icon} strokeWidth={2.4} color="#fff" className="drop-shadow-[0_1px_1px_rgba(0,0,0,.18)]" />
      </span>
    </span>
  );
}

/** Lucide icon stroked with a pastel gradient (for inline accents). */
export function GradientIcon({ icon: Icon, tone = "violet", size = 20, className }: { icon: LucideIcon; tone?: Tone; size?: number; className?: string }) {
  return (
    <Icon
      size={size}
      strokeWidth={2.3}
      color={`url(#rp-grad-${tone})`}
      className={cn("drop-shadow-[0_3px_5px_rgba(107,108,246,.25)]", className)}
      aria-hidden
    />
  );
}

/** Mount once (in the root layout) so `url(#rp-grad-<tone>)` strokes resolve. */
export function GradientDefs() {
  return (
    <svg width="0" height="0" aria-hidden className="absolute">
      <defs>
        {Object.entries(TONES).map(([k, [a, b]]) => (
          <linearGradient key={k} id={`rp-grad-${k}`} gradientUnits="userSpaceOnUse" x1="2" y1="2" x2="22" y2="22">
            <stop stopColor={a} />
            <stop offset="1" stopColor={b} />
          </linearGradient>
        ))}
      </defs>
    </svg>
  );
}
