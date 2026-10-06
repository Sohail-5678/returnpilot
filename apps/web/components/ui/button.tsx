import { Slot } from "radix-ui";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "neu" | "ghost" | "danger" | "success" | "ink" | "glass" | "outline";
type Size = "sm" | "md" | "lg" | "icon" | "icon-lg";

const base =
  "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold tracking-[-0.01em] transition-[transform,box-shadow,background-color,color,opacity] duration-300 ease-[cubic-bezier(.2,.8,.2,1)] disabled:pointer-events-none disabled:opacity-55 [&_svg]:shrink-0";

const variants: Record<Variant, string> = {
  primary:
    "bg-button-gradient text-white shadow-accent hover:-translate-y-0.5 hover:shadow-[0_18px_34px_-12px_rgba(75,74,201,.7),inset_0_1px_0_rgba(255,255,255,.35)] active:translate-y-0 active:shadow-[inset_0_3px_8px_rgba(20,18,90,.45)]",
  neu: "bg-surface text-ink shadow-raised-sm hover:-translate-y-0.5 hover:shadow-raised active:translate-y-0 active:shadow-inset-sm",
  ghost: "text-ink-soft hover:bg-sunken hover:text-ink active:shadow-inset-sm",
  outline:
    "bg-transparent text-ink ring-1 ring-line-strong hover:bg-surface hover:shadow-raised-sm active:shadow-inset-sm",
  danger:
    "bg-surface text-rejected shadow-raised-sm ring-1 ring-rejected/25 hover:-translate-y-0.5 hover:shadow-raised active:translate-y-0 active:shadow-inset-sm",
  success:
    "bg-[linear-gradient(135deg,#10b981,#047857)] text-white shadow-[0_14px_28px_-10px_rgba(4,120,87,.55),inset_0_1px_0_rgba(255,255,255,.3)] hover:-translate-y-0.5 active:translate-y-0",
  ink: "bg-white text-[#23224a] shadow-[0_16px_34px_-12px_rgba(10,8,50,.7)] hover:-translate-y-0.5 hover:shadow-[0_22px_40px_-12px_rgba(10,8,50,.8)] active:translate-y-0",
  glass: "glass text-white hover:bg-white/18 active:bg-white/8",
};

const sizes: Record<Size, string> = {
  sm: "min-h-11 px-4 text-sm",
  md: "min-h-11 px-5 text-[15px]",
  lg: "min-h-13 px-7 text-base",
  icon: "size-11",
  "icon-lg": "size-14",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "neu", size = "md", asChild, type, ...props },
  ref,
) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : (type ?? "button")}
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    />
  );
});
