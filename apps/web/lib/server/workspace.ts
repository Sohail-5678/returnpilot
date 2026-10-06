import "server-only";
import { cookies } from "next/headers";

/**
 * Demo workspace id (API_CONTRACT §1, claim `ws`): one random UUID per browser, kept for
 * 30 days and reused across persona switches so the customer and the reviewer share
 * the same private copy of the demo data.
 */
export const WS_COOKIE = "rp_ws";
export const WS_MAX_AGE = 60 * 60 * 24 * 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isWorkspaceId(v: string | undefined | null): v is string {
  return !!v && UUID_RE.test(v);
}

export function workspaceCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: WS_MAX_AGE,
  };
}

/** For Server Actions / Route Handlers: returns the workspace id, creating the cookie if needed. */
export async function ensureWorkspaceCookie(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(WS_COOKIE)?.value;
  if (isWorkspaceId(existing)) return existing;
  const ws = crypto.randomUUID();
  jar.set(WS_COOKIE, ws, workspaceCookieOptions());
  return ws;
}
