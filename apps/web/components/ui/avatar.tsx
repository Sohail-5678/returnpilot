import { cn, initials } from "@/lib/utils";

const PALETTE: [string, string][] = [
  ["#FFB36B", "#FF6FA8"],
  ["#4FD1C5", "#7C7BFF"],
  ["#C38BFF", "#6B6CF6"],
  ["#7DD3FC", "#6B6CF6"],
  ["#86EFAC", "#22C55E"],
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const SIZES = {
  sm: "size-8 text-[11px]",
  md: "size-10 text-[13px]",
  lg: "size-14 text-base",
  xl: "size-16 text-lg",
} as const;

export function GradientAvatar({
  name,
  gradient,
  size = "md",
  className,
  ring = true,
}: {
  name: string;
  gradient?: [string, string];
  size?: keyof typeof SIZES;
  className?: string;
  ring?: boolean;
}) {
  const [a, b] = gradient ?? PALETTE[hash(name) % PALETTE.length]!;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-grid shrink-0 select-none place-items-center rounded-full font-bold tracking-tight text-white",
        SIZES[size],
        className,
      )}
      style={{
        background: `linear-gradient(145deg, ${a}, ${b})`,
        boxShadow: ring
          ? `0 8px 18px -8px ${b}aa, inset 1.5px 1.5px 3px rgba(255,255,255,.5), 0 0 0 3px var(--surface)`
          : `inset 1.5px 1.5px 3px rgba(255,255,255,.5)`,
        textShadow: "0 1px 2px rgba(0,0,0,.25)",
      }}
    >
      {initials(name)}
    </span>
  );
}
