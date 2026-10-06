"use client";

import { DropdownMenu } from "radix-ui";
import { cn } from "@/lib/utils";

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;

export function MenuContent({
  children,
  className,
  align = "end",
  side = "top",
}: {
  children: React.ReactNode;
  className?: string;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align={align}
        side={side}
        sideOffset={10}
        collisionPadding={12}
        className={cn(
          "z-50 min-w-64 origin-[var(--radix-dropdown-menu-content-transform-origin)] rounded-3xl bg-surface-hi p-2 shadow-float",
          "data-[state=open]:animate-[menu-in_.22s_cubic-bezier(.2,.8,.2,1)]",
          className,
        )}
      >
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}

export function MenuItem({
  children,
  className,
  onSelect,
  disabled,
  asChild,
}: {
  children: React.ReactNode;
  className?: string;
  onSelect?: (e: Event) => void;
  disabled?: boolean;
  asChild?: boolean;
}) {
  return (
    <DropdownMenu.Item
      asChild={asChild}
      onSelect={onSelect}
      disabled={disabled}
      className={cn(
        "flex min-h-11 cursor-pointer select-none items-center gap-3 rounded-2xl px-3 text-sm font-medium text-ink outline-none transition-colors",
        "data-[highlighted]:bg-sunken data-[highlighted]:shadow-inset-sm data-[disabled]:cursor-default data-[disabled]:opacity-60",
        className,
      )}
    >
      {children}
    </DropdownMenu.Item>
  );
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <DropdownMenu.Label className="px-3 pb-1.5 pt-2 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-faint">
      {children}
    </DropdownMenu.Label>
  );
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="mx-2 my-1.5 h-px bg-line" />;
}
