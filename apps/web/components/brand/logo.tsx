import { cn } from "@/lib/utils";

/** The ReturnPilot mark: a return arrow on an accent-gradient tile. */
export function LogoMark({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("grid shrink-0 place-items-center bg-accent-gradient text-white", className)}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.33,
        boxShadow: "inset 2px 2px 6px rgba(255,255,255,.45), 0 14px 30px -10px rgba(40,38,140,.75)",
      }}
    >
      <svg width={size * 0.52} height={size * 0.52} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 14 4 9l5-5" />
        <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
      </svg>
    </span>
  );
}

export function Wordmark({ className, size = 40 }: { className?: string; size?: number }) {
  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <LogoMark size={size} />
      <span className="text-[19px] font-extrabold tracking-[-0.03em]">ReturnPilot</span>
    </span>
  );
}

export function GithubIcon({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.58.23 2.75.11 3.04.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}
