"use client";

import { Menu as MenuIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import type { AppUser } from "@/auth";
import { LogoMark } from "@/components/brand/logo";
import { SessionProvider } from "@/components/session-context";
import { DemoBanner, QuotaBanner } from "@/components/states/banners";
import { BackendWatcher, WakingScreen } from "@/components/states/waking";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/overlay";
import { useMe } from "@/lib/api/hooks";
import { useBackendStatus } from "@/lib/backend-status";
import { titleCase } from "@/lib/utils";
import { SidebarFull, SidebarRail } from "./sidebar";
import { UserMenu } from "./user-menu";

function DeniedNotice({ user }: { user: AppUser }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const denied = params.get("denied");
  useEffect(() => {
    if (!denied) return;
    toast(`That page isn't available to ${titleCase(user.role).toLowerCase()}s.`, {
      description: `You're signed in as ${user.name}. Switch persona from the account menu to see it.`,
    });
    router.replace(pathname);
  }, [denied, user, router, pathname]);
  return null;
}

/** Calls /v1/me once per session so the backend provisions the demo workspace early. */
function WorkspaceBootstrap() {
  useMe();
  return null;
}

export function AppShell({ user, demoMode, children }: { user: AppUser; demoMode: boolean; children: React.ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const { waking } = useBackendStatus();

  return (
    <SessionProvider user={user}>
      <BackendWatcher />
      <WorkspaceBootstrap />
      <Suspense fallback={null}>
        <DeniedNotice user={user} />
      </Suspense>
      <div className="mx-auto flex min-h-dvh w-full max-w-[1720px] gap-5 px-3 md:gap-6 md:px-4 xl:gap-8 xl:px-6">
        {/* Desktop rail / full sidebar */}
        <aside className="sticky top-0 hidden h-dvh shrink-0 py-4 md:block" aria-label="Sidebar">
          <div className="neu h-full rounded-[32px] p-3 xl:hidden">
            <SidebarRail demoMode={demoMode} />
          </div>
          <div className="neu hidden h-full w-[272px] rounded-[32px] p-4 xl:block">
            <SidebarFull demoMode={demoMode} />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile top bar */}
          <header className="glass-light sticky top-2 z-40 mt-2 flex items-center gap-2 rounded-full p-1.5 shadow-raised-sm md:hidden">
            <Button variant="ghost" size="icon" aria-label="Open navigation" onClick={() => setDrawer(true)}>
              <MenuIcon size={20} aria-hidden />
            </Button>
            <Link href="/" className="flex flex-1 items-center gap-2 font-extrabold tracking-tight text-ink">
              <LogoMark size={30} /> ReturnPilot
            </Link>
            <UserMenu demoMode={demoMode} compact side="bottom" align="end" />
          </header>

          <DemoBanner className="pt-3" />
          <QuotaBanner />
          <main id="main" className="min-w-0 flex-1 pb-12">
            {waking ? <WakingScreen /> : children}
          </main>
        </div>
      </div>

      <Sheet open={drawer} onOpenChange={setDrawer} side="left" title="Navigation" hideTitle className="w-[min(320px,calc(100vw-24px))]">
        <div className="h-full pt-6">
          <SidebarFull demoMode={demoMode} onNavigate={() => setDrawer(false)} />
        </div>
      </Sheet>
    </SessionProvider>
  );
}
