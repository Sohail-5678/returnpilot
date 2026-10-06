import type { Role } from "./roles";

export type PersonaKey = "maya" | "arjun" | "lena" | "reviewer" | "admin";

export interface Persona {
  key: PersonaKey;
  role: Role;
  name: string;
  short: string;
  blurb: string;
  /** Gradient used for the avatar. */
  gradient: [string, string];
  prompts: string[];
}

/** API_CONTRACT §4 — demo personas shown on the login screen. */
export const PERSONAS: Record<PersonaKey, Persona> = {
  maya: {
    key: "maya",
    role: "customer",
    name: "Maya Patel",
    short: "Maya",
    blurb: "Standard tier · has a $129 boots order eligible for return (needs approval)",
    gradient: ["#FFB36B", "#FF6FA8"],
    prompts: [
      "Can I return the boots from my last order?",
      "I want to return the trail boots and get a refund. They're unopened.",
      "Where is my rain shell?",
      "Use my usual shipping preference.",
    ],
  },
  arjun: {
    key: "arjun",
    role: "customer",
    name: "Arjun Mehta",
    short: "Arjun",
    blurb: "Gold tier (60-day window) · final-sale shirt, opened headphones, a damaged mug set",
    gradient: ["#4FD1C5", "#7C7BFF"],
    prompts: [
      "My mug set arrived broken. Can I get a refund?",
      "Can I return the linen shirt? It doesn't fit.",
      "Can I return the headphones? I opened them.",
      "How long is my return window?",
    ],
  },
  lena: {
    key: "lena",
    role: "customer",
    name: "Lena Fischer",
    short: "Lena",
    blurb: "International (DE) · already-refunded scarf · 3 refunds in 90 days",
    gradient: ["#C38BFF", "#6B6CF6"],
    prompts: [
      "Can I get a refund for the cashmere scarf?",
      "How do international returns work?",
      "I'd like to return the wool beanie.",
      "How long do refunds take?",
    ],
  },
  reviewer: {
    key: "reviewer",
    role: "reviewer",
    name: "Riley (Support Lead)",
    short: "Riley",
    blurb: "Approves or rejects risky refunds",
    gradient: ["#86EFAC", "#22C55E"],
    prompts: [],
  },
  admin: {
    key: "admin",
    role: "admin",
    name: "Avery (Ops Admin)",
    short: "Avery",
    blurb: "Metrics, traces, evals",
    gradient: ["#7DD3FC", "#6B6CF6"],
    prompts: [],
  },
};

export const PERSONA_ORDER: PersonaKey[] = ["maya", "arjun", "lena", "reviewer", "admin"];

export function isPersonaKey(v: unknown): v is PersonaKey {
  return typeof v === "string" && v in PERSONAS;
}

export const GENERIC_PROMPTS = [
  "What is your return policy?",
  "Where is my latest order?",
  "How long do refunds take?",
  "Can I exchange an item for a different size?",
];
