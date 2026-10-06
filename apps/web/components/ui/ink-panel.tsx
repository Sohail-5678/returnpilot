import { cn } from "@/lib/utils";

/**
 * Deep-indigo panel whose edge melts into the lavender page with a smooth S-curve
 * (CSS mask), with a drop-shadow that follows the curve ("shades underneath").
 */
export function InkPanel({
  children,
  wave = "bottom",
  className,
  innerClassName,
  contentClassName,
  contours = true,
  as: Tag = "section",
  ...rest
}: {
  children: React.ReactNode;
  wave?: "bottom" | "right" | "none";
  className?: string;
  innerClassName?: string;
  contentClassName?: string;
  contours?: boolean;
  as?: "section" | "header" | "div" | "aside";
} & Omit<React.HTMLAttributes<HTMLElement>, "className" | "children">) {
  return (
    <Tag className={cn("ink-shadow relative", className)} {...rest}>
      <div
        className={cn(
          "ink-panel on-ink overflow-hidden",
          wave === "bottom" && "wave-bottom",
          wave === "right" && "wave-right",
          innerClassName,
        )}
      >
        {contours ? <Contours wave={wave} /> : null}
        <div className={cn("relative", contentClassName)}>{children}</div>
      </div>
    </Tag>
  );
}

/** Faint topographic lines echoing the S-curve. */
function Contours({ wave }: { wave: "bottom" | "right" | "none" }) {
  if (wave === "right") {
    return (
      <svg aria-hidden className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.16]" preserveAspectRatio="none" viewBox="0 0 400 1000">
        {[0, 1, 2, 3].map((i) => (
          <path
            key={i}
            d={`M${250 + i * 26} 0 C ${200 + i * 26} 260, ${330 + i * 26} 520, ${260 + i * 26} 760 S ${300 + i * 26} 960, ${280 + i * 26} 1000`}
            fill="none"
            stroke="white"
            strokeWidth="1.2"
          />
        ))}
      </svg>
    );
  }
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[min(100%,340px)] w-full opacity-[0.14]" preserveAspectRatio="none" viewBox="0 0 1440 400">
      {[0, 1, 2, 3].map((i) => (
        <path
          key={i}
          d={`M0 ${250 - i * 34} C 320 ${170 - i * 34}, 560 ${330 - i * 34}, 860 ${260 - i * 34} S 1260 ${190 - i * 34}, 1440 ${240 - i * 34}`}
          fill="none"
          stroke="white"
          strokeWidth="1.2"
        />
      ))}
    </svg>
  );
}

/** Frosted pill chip for use on ink panels. */
export function InkChip({ children, className, ...rest }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn("glass inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-semibold text-white", className)}
      {...rest}
    >
      {children}
    </span>
  );
}
