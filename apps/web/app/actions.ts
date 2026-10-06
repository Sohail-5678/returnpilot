"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";
import { isPersonaKey, PERSONAS } from "@/lib/personas";
import { canAccessPage, homeFor, safeNextPath } from "@/lib/roles";
import { ensureWorkspaceCookie } from "@/lib/server/workspace";

/** Sign in as a demo persona (DEMO_MODE). Keeps the browser's demo workspace (rp_ws). */
export async function signInAsPersona(formData: FormData) {
  const persona = formData.get("persona");
  const next = safeNextPath(formData.get("next")?.toString());
  if (!isPersonaKey(persona)) redirect("/login?error=persona");
  const role = PERSONAS[persona].role;
  const target = next && canAccessPage(role, next) ? next : homeFor(role);

  await ensureWorkspaceCookie();
  try {
    await signIn("demo", { persona, redirectTo: target });
  } catch (err) {
    if (err instanceof AuthError) redirect(`/login?error=${encodeURIComponent(err.type)}`);
    throw err; // NEXT_REDIRECT
  }
}

/** Quick persona switch from the user menu: replaces the session, keeps rp_ws. */
export async function switchPersona(persona: string) {
  if (!isPersonaKey(persona)) return;
  await ensureWorkspaceCookie();
  try {
    await signIn("demo", { persona, redirectTo: homeFor(PERSONAS[persona].role) });
  } catch (err) {
    if (err instanceof AuthError) redirect(`/login?error=${encodeURIComponent(err.type)}`);
    throw err;
  }
}

export async function signInWithGithub(formData: FormData) {
  const next = safeNextPath(formData.get("next")?.toString());
  await ensureWorkspaceCookie();
  await signIn("github", { redirectTo: next ?? "/chat" });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}
