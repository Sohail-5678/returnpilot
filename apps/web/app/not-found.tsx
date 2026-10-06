import { Compass } from "lucide-react";
import Link from "next/link";
import { DemoBanner } from "@/components/states/banners";
import { GlyphTile } from "@/components/ui/glyph-tile";

export default function NotFound() {
  return (
    <div className="min-h-dvh">
      <DemoBanner className="pt-3" />
      <main id="main" className="mx-auto grid max-w-lg place-items-center px-4 py-24 text-center">
        <div className="neu-hero w-full rounded-hero px-8 py-12">
          <GlyphTile icon={Compass} tone="violet" size="xl" className="mx-auto" />
          <p className="mt-6 text-[13px] font-bold uppercase tracking-[0.18em] text-ink-faint">404</p>
          <h1 className="mt-1 text-[28px] font-extrabold tracking-[-0.03em] text-ink">This page took a wrong turn</h1>
          <p className="mt-2 text-[15px] text-ink-soft">The link may be old, or the conversation was deleted.</p>
          <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/" className="neu-sm inline-flex min-h-11 items-center justify-center rounded-full px-5 font-semibold text-ink">
              Home
            </Link>
            <Link href="/login" className="bg-button-gradient inline-flex min-h-11 items-center justify-center rounded-full px-5 font-semibold text-white shadow-accent">
              Open the demo
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
