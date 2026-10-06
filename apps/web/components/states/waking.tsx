"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Server } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { backendStatus, useBackendStatus } from "@/lib/backend-status";
import { GlyphTile } from "@/components/ui/glyph-tile";
import { ProgressRing } from "@/components/ui/misc";

const POLL_MS = 3_000;
const EXPECTED_MS = 60_000;

async function healthy(): Promise<boolean> {
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    if (!res.ok) return false;
    const data = (await res.json()) as { status?: string };
    return data.status === "ok" || data.status === "degraded";
  } catch {
    return false;
  }
}

/**
 * Polls GET /api/health every 3 s while the backend is waking, then refetches
 * everything. Mounted once in the app shell.
 */
export function BackendWatcher() {
  const qc = useQueryClient();
  const { waking } = useBackendStatus();
  useEffect(() => {
    if (!waking) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (stop) return;
      if (await healthy()) {
        backendStatus.setWaking(false);
        await qc.invalidateQueries();
        return;
      }
      timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, 600);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [waking, qc]);
  return null;
}

/** Full-content "server waking up" state (SPEC §2.5 copy) with a progress ring. */
export function WakingScreen() {
  const { wakingSince } = useBackendStatus();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const elapsed = wakingSince ? now - wakingSince : 0;
  // Ease toward 95% over the expected minute so the ring never looks stuck or "done".
  const progress = Math.min(0.95, 1 - Math.exp(-elapsed / (EXPECTED_MS / 2.4)));
  const secs = Math.floor(elapsed / 1000);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto grid max-w-lg place-items-center px-4 py-16 text-center"
      role="status"
      aria-live="polite"
    >
      <div className="neu-hero w-full rounded-hero px-8 py-10">
        <div className="mx-auto w-fit">
          <ProgressRing value={progress} size={112} label="Server start-up progress">
            <GlyphTile icon={Server} tone="sky" size="md" well="none" />
          </ProgressRing>
        </div>
        <h2 className="mt-7 text-xl font-bold tracking-tight text-ink">Waking up the demo server</h2>
        <p className="mx-auto mt-2 max-w-sm text-[15px] leading-relaxed text-ink-soft">
          Starting the free server — this takes up to a minute after it has been idle.
        </p>
        <p className="mt-5 text-sm font-semibold tabular-nums text-ink-faint">
          {secs < 2 ? "Checking…" : `${secs}s · checking every 3 seconds`}
        </p>
      </div>
    </motion.div>
  );
}
