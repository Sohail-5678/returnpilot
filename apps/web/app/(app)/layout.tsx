import { redirect } from "next/navigation";
import { getAppUser } from "@/auth";
import { AppShell } from "@/components/shell/app-shell";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await getAppUser();
  // proxy.ts already redirects; this is defense in depth for direct renders.
  if (!user) redirect("/login");
  return (
    <AppShell user={user} demoMode={process.env.DEMO_MODE === "true"}>
      {children}
    </AppShell>
  );
}
