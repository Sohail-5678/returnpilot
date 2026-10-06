"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { DemoBanner } from "@/components/states/banners";
import { GlyphTile } from "@/components/ui/glyph-tile";

export default function GlobalRouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <>
      <DemoBanner className="pt-3" />
      <main id="main" className="mx-auto grid max-w-lg place-items-center px-4 py-24 text-center">
        <div className="neu-hero w-full rounded-hero px-8 py-12" role="alert">
          <GlyphTile icon={TriangleAlert} tone="rose" size="xl" className="mx-auto" />
          <h1 className="mt-6 text-[26px] font-extrabold tracking-[-0.03em] text-ink">Something went wrong</h1>
          <p className="mt-2 text-[15px] text-ink-soft">The page hit an unexpected error. Trying again usually fixes it.</p>
          <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
            <button
              type="button"
              onClick={reset}
              className="bg-button-gradient inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 font-semibold text-white shadow-accent"
            >
              <RefreshCw size={16} aria-hidden /> Try again
            </button>
            <Link href="/" className="neu-sm inline-flex min-h-11 items-center justify-center rounded-full px-5 font-semibold text-ink">
              Home
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
