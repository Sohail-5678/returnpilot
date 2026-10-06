"use client";

import { ArrowUp, Square } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export const MAX_CHARS = 2000;

export interface ComposerHandle {
  focus: () => void;
  setText: (t: string) => void;
}

/** Enter = send, Shift+Enter = newline, 2000-char counter, floating round send button. */
export const Composer = forwardRef<
  ComposerHandle,
  {
    onSend: (text: string) => void;
    onStop?: () => void;
    busy?: boolean;
    disabled?: boolean;
    initialText?: string;
    placeholder?: string;
    className?: string;
  }
>(function Composer({ onSend, onStop, busy, disabled, initialText = "", placeholder = "Ask about an order, a return or a refund…", className }, ref) {
  const [text, setText] = useState(initialText);
  const area = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => area.current?.focus(),
    setText: (t: string) => {
      setText(t);
      requestAnimationFrame(() => {
        area.current?.focus();
        area.current?.setSelectionRange(t.length, t.length);
      });
    },
  }));

  // Auto-grow up to ~8 lines.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);

  const trimmed = text.trim();
  const canSend = !busy && !disabled && trimmed.length > 0 && text.length <= MAX_CHARS;

  const submit = () => {
    if (!canSend) return;
    onSend(trimmed);
    setText("");
  };

  const count = text.length;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className={cn("neu rounded-[30px] p-2.5", className)}
    >
      <div className="flex items-end gap-2.5">
        <label htmlFor="composer" className="sr-only">
          Message ReturnPilot
        </label>
        <textarea
          id="composer"
          ref={area}
          rows={1}
          value={text}
          maxLength={MAX_CHARS}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          aria-describedby="composer-hint"
          className="scrollbar-soft min-h-12 flex-1 resize-none rounded-[22px] bg-surface px-4 py-3 text-[15px] leading-relaxed text-ink shadow-inset-sm placeholder:text-ink-faint focus-visible:outline-offset-2 disabled:opacity-60"
        />
        {busy && onStop ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop generating"
            className="grid size-12 shrink-0 place-items-center rounded-full bg-surface text-ink shadow-raised-sm transition-transform hover:-translate-y-0.5 active:shadow-inset-sm"
          >
            <Square size={16} fill="currentColor" aria-hidden />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Send message"
            className="bg-button-gradient grid size-12 shrink-0 place-items-center rounded-full text-white shadow-accent transition-[transform,box-shadow,opacity] duration-300 hover:-translate-y-0.5 hover:scale-[1.03] active:translate-y-0 active:scale-95 disabled:opacity-45 disabled:shadow-none"
          >
            <ArrowUp size={20} strokeWidth={2.6} aria-hidden />
          </button>
        )}
      </div>
      <div id="composer-hint" className="flex items-center justify-between gap-3 px-3 pb-0.5 pt-2 text-[11.5px] text-ink-faint">
        <span>
          <kbd className="font-sans font-semibold">Enter</kbd> to send · <kbd className="font-sans font-semibold">Shift + Enter</kbd> for a new line
        </span>
        <span
          className={cn("tabular-nums font-semibold", count > MAX_CHARS * 0.9 && "text-pending-ink dark:text-pending", count >= MAX_CHARS && "text-rejected")}
          aria-live={count > MAX_CHARS * 0.9 ? "polite" : "off"}
        >
          {count.toLocaleString()} / {MAX_CHARS.toLocaleString()}
        </span>
      </div>
    </form>
  );
});
