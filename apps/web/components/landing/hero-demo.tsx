"use client";

import { BookOpen, Check, Hourglass, LoaderCircle } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { LogoMark } from "@/components/brand/logo";

const TOOLS = ["Looked up your orders", "Checked return eligibility (#1042)", "Read policy: Returns › 30-day window"];
// Timeline (ms): user → tools → answer → approval → hold → restart
const STEPS = [500, 1300, 2100, 2900, 3900, 5200, 10500];

/** A looping, scripted miniature of the real chat: tool chips, citation, approval card. */
export function HeroDemo() {
  const reduce = useReducedMotion();
  const [phase, setPhase] = useState(reduce ? STEPS.length : 0);
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const timers = STEPS.map((ms, i) => setTimeout(() => setPhase(i + 1), ms));
    const loop = setTimeout(() => {
      setPhase(0);
      setCycle((c) => c + 1);
    }, STEPS[STEPS.length - 1]! + 400);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(loop);
    };
  }, [cycle, reduce]);

  const toolState = (i: number) => (phase >= 2 + i + 1 ? "done" : phase >= 2 + i ? "running" : "hidden");

  return (
    <div className="relative" aria-label="Animated preview of a ReturnPilot conversation" role="img">
      <div className="glass rounded-[32px] p-4 shadow-[0_40px_80px_-30px_rgba(10,8,50,.8)] sm:p-5">
        <div className="mb-4 flex items-center gap-2 px-1">
          <span className="size-2.5 rounded-full bg-white/25" />
          <span className="size-2.5 rounded-full bg-white/25" />
          <span className="size-2.5 rounded-full bg-white/25" />
          <span className="ml-2 text-[12px] font-semibold text-white/60">Chat · Maya Patel</span>
        </div>
        <div className="flex min-h-[340px] flex-col gap-3 rounded-[24px] bg-surface p-4 text-ink shadow-inset-sm" key={cycle}>
          <AnimatePresence>
            {phase >= 1 ? (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-button-gradient ml-auto max-w-[85%] rounded-[18px] rounded-br-md px-3.5 py-2 text-[13px] font-medium text-white shadow-accent"
              >
                Can I return the boots from my last order?
              </motion.div>
            ) : null}
          </AnimatePresence>

          {phase >= 2 ? (
            <motion.ul initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="neu-inset-sm space-y-0.5 rounded-[18px] p-1.5">
              {TOOLS.map((t, i) => {
                const s = toolState(i);
                if (s === "hidden") return null;
                return (
                  <motion.li
                    key={t}
                    initial={{ opacity: 0, x: -8, scale: 0.97 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-[12.5px] font-medium"
                  >
                    <span
                      className={
                        s === "done"
                          ? "grid size-5 place-items-center rounded-full bg-[linear-gradient(145deg,#34d399,#059669)] text-white"
                          : "grid size-5 place-items-center rounded-full bg-[linear-gradient(145deg,#a5b4fc,#6b6cf6)] text-white"
                      }
                    >
                      {s === "done" ? <Check size={11} strokeWidth={3.2} /> : <LoaderCircle size={11} strokeWidth={3} className="animate-spin" />}
                    </span>
                    {t}
                  </motion.li>
                );
              })}
            </motion.ul>
          ) : null}

          {phase >= 5 ? (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex items-start gap-2">
              <LogoMark size={24} className="mt-1 shrink-0" />
              <div className="neu-sm rounded-[18px] rounded-tl-md px-3.5 py-2.5 text-[13px] leading-relaxed">
                Yes — the <strong>Trail Runner Boots</strong> are within the 30-day window{" "}
                <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-semibold text-accent-ink">
                  <BookOpen size={10} strokeWidth={2.6} /> Policy §2.1
                </span>
                . The $129.00 refund needs a quick human check.
              </div>
            </motion.div>
          ) : null}

          {phase >= 6 ? (
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className="animate-pulse-amber ml-8 flex items-center gap-2.5 rounded-[18px] bg-pending-bg px-3.5 py-2.5 text-pending-ink"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[linear-gradient(145deg,#FCD34D,#F59E0B)] text-white">
                <Hourglass size={14} strokeWidth={2.6} />
              </span>
              <span className="text-[12.5px] font-semibold leading-snug">Waiting for a human reviewer · $129.00</span>
            </motion.div>
          ) : null}
        </div>
      </div>
      {/* floating accent orbs */}
      <span aria-hidden className="animate-float absolute -right-4 -top-5 size-14 rounded-full bg-[linear-gradient(145deg,#FFB36B,#FF6FA8)] opacity-90 shadow-[0_18px_30px_-10px_rgba(255,111,168,.7)]" />
      <span
        aria-hidden
        className="animate-float absolute -bottom-6 -left-5 size-10 rounded-full bg-[linear-gradient(145deg,#4FD1C5,#7C7BFF)] opacity-90 shadow-[0_14px_26px_-10px_rgba(79,209,197,.7)]"
        style={{ animationDelay: "-3s" }}
      />
    </div>
  );
}
