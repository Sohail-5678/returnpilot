import { Activity, Brain, ClipboardCheck, LayoutDashboard, MessagesSquare, Package, type LucideIcon } from "lucide-react";
import type { Tone } from "@/components/ui/glyph-tile";

export const NAV_META: Record<string, { icon: LucideIcon; tone: Tone; hint: string }> = {
  "/chat": { icon: MessagesSquare, tone: "violet", hint: "Talk to the agent" },
  "/orders": { icon: Package, tone: "sunset", hint: "Your orders" },
  "/memory": { icon: Brain, tone: "teal", hint: "What the agent remembers" },
  "/reviews": { icon: ClipboardCheck, tone: "amber", hint: "Approval queue" },
  "/runs": { icon: Activity, tone: "sky", hint: "Traces" },
  "/admin": { icon: LayoutDashboard, tone: "mint", hint: "Metrics" },
};
