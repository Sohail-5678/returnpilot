import NextAuth, { type NextAuthConfig, type Session, type User } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import { PERSONAS, isPersonaKey, type PersonaKey } from "@/lib/personas";
import { isRole, type Role } from "@/lib/roles";

/**
 * Auth.js v5 (SPEC §10.1, API_CONTRACT §1/§4).
 * - "demo" Credentials provider (DEMO_MODE=true): no password, input = persona key.
 * - GitHub OAuth (only when AUTH_GITHUB_ID/SECRET are set); role from allowlists.
 * Session strategy is JWT; the session carries role/persona/name/login/sub/sid.
 * Cookies use Auth.js defaults: httpOnly, sameSite=lax, secure (+ __Secure- prefix) on https.
 */

export interface AppUser {
  sub: string;
  role: Role;
  persona: PersonaKey | null;
  name: string;
  login: string | null;
  sid: string;
  image: string | null;
}

function csv(v: string | undefined) {
  return (v ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function roleForGithubLogin(login: string): Role {
  const l = login.toLowerCase();
  if (csv(process.env.ADMIN_GITHUB_USERS).includes(l)) return "admin";
  if (csv(process.env.REVIEWER_GITHUB_USERS).includes(l)) return "reviewer";
  return "customer";
}

// Best-effort sign-in rate limit for the passwordless demo provider (per instance).
const attempts = new Map<string, { count: number; reset: number }>();
function allowDemoSignIn(key: string) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.reset < now) {
    attempts.set(key, { count: 1, reset: now + 60_000 });
    if (attempts.size > 5000) attempts.clear();
    return true;
  }
  entry.count += 1;
  return entry.count <= 20;
}

const providers: NextAuthConfig["providers"] = [];

if (process.env.DEMO_MODE === "true") {
  providers.push(
    Credentials({
      id: "demo",
      name: "Demo persona",
      credentials: { persona: { label: "Persona", type: "text" } },
      async authorize(credentials, request) {
        const key = credentials?.persona;
        if (!isPersonaKey(key)) return null;
        const ip =
          request?.headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          request?.headers?.get("x-real-ip") ||
          "local";
        if (!allowDemoSignIn(ip)) return null;
        const p = PERSONAS[key];
        return { id: `demo:${key}`, name: p.name, role: p.role, persona: key } as User;
      },
    }),
  );
}

if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) {
  providers.push(
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
    }),
  );
}

export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  pages: { signIn: "/login", error: "/login" },
  providers,
  callbacks: {
    async jwt({ token, user, account, profile }) {
      if (user && account) {
        if (account.provider === "github") {
          const gh = (profile ?? {}) as { id?: number | string; login?: string; name?: string };
          const login = String(gh.login ?? "");
          token.sub = `github:${gh.id ?? account.providerAccountId}`;
          token.role = roleForGithubLogin(login);
          token.persona = null;
          token.login = login;
          token.name = gh.name || login;
        } else {
          const u = user as User & { role?: Role; persona?: PersonaKey };
          token.sub = String(u.id);
          token.role = u.role;
          token.persona = u.persona ?? null;
          token.login = null;
          token.name = u.name ?? null;
        }
        token.sid = crypto.randomUUID();
      }
      return token;
    },
    async session({ session, token }) {
      const app: AppUser = {
        sub: String(token.sub ?? ""),
        role: isRole(token.role) ? token.role : "customer",
        persona: isPersonaKey(token.persona) ? token.persona : null,
        name: typeof token.name === "string" ? token.name : "Guest",
        login: typeof token.login === "string" ? token.login : null,
        sid: typeof token.sid === "string" ? token.sid : "",
        image: typeof token.picture === "string" ? token.picture : null,
      };
      return { ...session, app } as Session;
    },
  },
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

/** Typed view of the current session, or null when signed out. */
export function appUserFrom(session: Session | null | undefined): AppUser | null {
  const app = (session as (Session & { app?: AppUser }) | null | undefined)?.app;
  if (!app || !app.sub || !isRole(app.role)) return null;
  return app;
}

export async function getAppUser(): Promise<AppUser | null> {
  return appUserFrom(await auth());
}
