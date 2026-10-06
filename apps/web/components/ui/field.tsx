import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const field =
  "w-full rounded-2xl bg-surface px-4 text-[15px] text-ink shadow-inset placeholder:text-ink-faint transition-shadow duration-300 focus-visible:outline-3 focus-visible:outline-offset-2 disabled:opacity-60";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(field, "min-h-12 py-3", className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={cn(field, "min-h-24 resize-none py-3 leading-relaxed", className)} {...props} />;
});

export function Label({ htmlFor, children, hint }: { htmlFor: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <label htmlFor={htmlFor} className="text-sm font-semibold text-ink">
        {children}
      </label>
      {hint ? <span className="text-xs text-ink-faint">{hint}</span> : null}
    </div>
  );
}
