"use client";

import { createContext, useContext } from "react";
import type { AppUser } from "@/auth";

const SessionContext = createContext<AppUser | null>(null);

export function SessionProvider({ user, children }: { user: AppUser | null; children: React.ReactNode }) {
  return <SessionContext.Provider value={user}>{children}</SessionContext.Provider>;
}

export function useAppUser() {
  return useContext(SessionContext);
}
