import { Bot, Cog, Hand, Scale, ShieldCheck, Workflow, Wrench, type LucideIcon } from "lucide-react";
import type { Tone } from "@/components/ui/glyph-tile";

export const STEP_KIND: Record<string, { icon: LucideIcon; tone: Tone; label: string; bar: string }> = {
  node: { icon: Workflow, tone: "violet", label: "Graph node", bar: "linear-gradient(90deg,#C38BFF,#6B6CF6)" },
  llm: { icon: Bot, tone: "sky", label: "LLM call", bar: "linear-gradient(90deg,#7DD3FC,#6B6CF6)" },
  tool: { icon: Wrench, tone: "sunset", label: "Tool (MCP)", bar: "linear-gradient(90deg,#FFB36B,#FF6FA8)" },
  guard: { icon: ShieldCheck, tone: "teal", label: "Guardrail", bar: "linear-gradient(90deg,#4FD1C5,#7C7BFF)" },
  policy: { icon: Scale, tone: "mint", label: "Policy engine", bar: "linear-gradient(90deg,#86EFAC,#22C55E)" },
  interrupt: { icon: Hand, tone: "amber", label: "Human approval", bar: "linear-gradient(90deg,#FCD34D,#F59E0B)" },
  job: { icon: Cog, tone: "mint", label: "Async job", bar: "linear-gradient(90deg,#6EE7B7,#059669)" },
};

export function stepKind(kind: string) {
  return STEP_KIND[kind] ?? STEP_KIND.node!;
}
