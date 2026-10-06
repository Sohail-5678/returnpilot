"use client";

import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { AlertDialog, Dialog } from "radix-ui";
import { cn } from "@/lib/utils";
import { Button } from "./button";

const SPRING = { type: "spring" as const, damping: 32, stiffness: 320, mass: 0.9 };

function Backdrop() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="fixed inset-0 z-50 bg-[#15142f]/30 backdrop-blur-[3px] dark:bg-black/50"
    />
  );
}

/** Side sheet that springs in from the edge. */
export function Sheet({
  open,
  onOpenChange,
  side = "right",
  title,
  description,
  children,
  className,
  hideTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: "right" | "left";
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  hideTitle?: boolean;
}) {
  const from = side === "right" ? "104%" : "-104%";
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <Backdrop />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={description ? undefined : undefined}>
              <motion.div
                initial={{ x: from }}
                animate={{ x: 0 }}
                exit={{ x: from }}
                transition={SPRING}
                className={cn(
                  "neu-hero fixed top-0 z-50 flex h-dvh w-[min(440px,calc(100vw-24px))] flex-col overflow-hidden focus:outline-none sm:top-3 sm:h-[calc(100dvh-24px)]",
                  side === "right" ? "right-0 rounded-l-[32px] sm:right-3 sm:rounded-[32px]" : "left-0 rounded-r-[32px] sm:left-3 sm:rounded-[32px]",
                  className,
                )}
              >
                <div className={cn("flex items-start gap-3 px-6 pb-3 pt-6", hideTitle && "sr-only")}>
                  <div className="min-w-0 flex-1">
                    <Dialog.Title className="text-lg font-bold tracking-tight text-ink">{title}</Dialog.Title>
                    {description ? (
                      <Dialog.Description className="mt-1 text-sm text-ink-soft">{description}</Dialog.Description>
                    ) : (
                      <Dialog.Description className="sr-only">Panel</Dialog.Description>
                    )}
                  </div>
                  <Dialog.Close asChild>
                    <Button variant="neu" size="icon" aria-label="Close panel">
                      <X size={18} />
                    </Button>
                  </Dialog.Close>
                </div>
                <div className="scrollbar-soft min-h-0 flex-1 overflow-y-auto px-6 pb-6">{children}</div>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  );
}

/** Confirmation dialog for irreversible actions (approve/reject, delete memory). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  tone = "primary",
  onConfirm,
  pending,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description: React.ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger" | "success";
  onConfirm: () => void;
  pending?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <AlertDialog.Portal forceMount>
            <AlertDialog.Overlay asChild forceMount>
              <Backdrop />
            </AlertDialog.Overlay>
            <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center p-4">
              <AlertDialog.Content asChild forceMount>
                <motion.div
                  initial={{ opacity: 0, scale: 0.94, y: 12 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 8 }}
                  transition={SPRING}
                  className="neu-hero pointer-events-auto w-full max-w-md rounded-[32px] p-7 focus:outline-none"
                >
                  <AlertDialog.Title className="text-xl font-bold tracking-tight text-ink">{title}</AlertDialog.Title>
                  <AlertDialog.Description className="mt-2 text-[15px] leading-relaxed text-ink-soft">
                    {description}
                  </AlertDialog.Description>
                  {children ? <div className="mt-4">{children}</div> : null}
                  <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                    <AlertDialog.Cancel asChild>
                      <Button variant="ghost">Cancel</Button>
                    </AlertDialog.Cancel>
                    <Button
                      variant={tone === "danger" ? "danger" : tone === "success" ? "success" : "primary"}
                      onClick={onConfirm}
                      disabled={pending}
                      autoFocus
                    >
                      {pending ? "Working…" : confirmLabel}
                    </Button>
                  </div>
                </motion.div>
              </AlertDialog.Content>
            </div>
          </AlertDialog.Portal>
        ) : null}
      </AnimatePresence>
    </AlertDialog.Root>
  );
}
