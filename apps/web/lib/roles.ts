export type Role = "customer" | "reviewer" | "admin";
export const ROLES: Role[] = ["customer", "reviewer", "admin"];

export function isRole(v: unknown): v is Role {
  return v === "customer" || v === "reviewer" || v === "admin";
}

/** Pages anyone can open without signing in. */
const PUBLIC_PAGES = ["/", "/login", "/about"];

/**
 * Page access by role (SPEC §2.2). The backend re-checks every request — this only
 * decides where the UI sends people.
 */
const PAGE_RULES: { prefix: string; roles: Role[] }[] = [
  { prefix: "/chat", roles: ["customer"] },
  { prefix: "/orders", roles: ["customer"] },
  { prefix: "/memory", roles: ["customer"] },
  { prefix: "/runs", roles: ["customer", "admin"] },
  { prefix: "/reviews", roles: ["reviewer", "admin"] },
  { prefix: "/admin", roles: ["admin"] },
];

function matchesPrefix(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isPublicPage(pathname: string) {
  return PUBLIC_PAGES.includes(pathname);
}

/** Returns true when the path is an app page that requires a session. */
export function isProtectedPage(pathname: string) {
  return PAGE_RULES.some((r) => matchesPrefix(pathname, r.prefix));
}

export function canAccessPage(role: Role | null | undefined, pathname: string) {
  if (isPublicPage(pathname)) return true;
  const rule = PAGE_RULES.find((r) => matchesPrefix(pathname, r.prefix));
  if (!rule) return true; // unknown paths fall through to Next's 404
  return !!role && rule.roles.includes(role);
}

export function homeFor(role: Role | null | undefined) {
  switch (role) {
    case "customer":
      return "/chat";
    case "reviewer":
      return "/reviews";
    case "admin":
      return "/admin";
    default:
      return "/login";
  }
}

/**
 * Backend API access by role, keyed by the first path segment after /api/v1/
 * (API_CONTRACT §3). Unknown prefixes are rejected.
 */
const API_RULES: Record<string, Role[]> = {
  me: ["customer", "reviewer", "admin"],
  policies: ["customer", "reviewer", "admin"],
  threads: ["customer"],
  orders: ["customer"],
  memories: ["customer"],
  approvals: ["reviewer", "admin"],
  runs: ["customer", "admin"],
  admin: ["admin"],
};

export type ApiAccess = "ok" | "forbidden" | "not_found";

export function apiAccess(role: Role | null | undefined, segments: string[]): ApiAccess {
  const head = segments[0];
  if (!head || !(head in API_RULES)) return "not_found";
  if (!role) return "forbidden";
  return API_RULES[head]!.includes(role) ? "ok" : "forbidden";
}

/** Only allow same-origin relative redirects such as "/chat/123?x=1". */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || typeof next !== "string") return null;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  if (next.startsWith("/api/") || next === "/login" || next.startsWith("/login?")) return null;
  return next;
}

export interface NavItem {
  href: string;
  label: string;
  roles: Role[];
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/chat", label: "Chat", roles: ["customer"] },
  { href: "/orders", label: "Orders", roles: ["customer"] },
  { href: "/memory", label: "Memory", roles: ["customer"] },
  { href: "/reviews", label: "Reviews", roles: ["reviewer", "admin"] },
  { href: "/runs", label: "Runs", roles: ["customer", "admin"] },
  { href: "/admin", label: "Admin", roles: ["admin"] },
];

export function navFor(role: Role) {
  return NAV_ITEMS.filter((i) => i.roles.includes(role));
}
