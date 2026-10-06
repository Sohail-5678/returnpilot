"use client";

import { useSyncExternalStore } from "react";

/**
 * Tiny global store for cross-cutting backend states:
 * - waking: the free Render instance is cold (503 backend_starting) → show the waking screen
 * - quotaExhausted: the LLM quota for today is used up (503 quota_exhausted) → banner
 */
interface BackendState {
  waking: boolean;
  wakingSince: number | null;
  quotaExhausted: boolean;
}

let state: BackendState = { waking: false, wakingSince: null, quotaExhausted: false };
const listeners = new Set<() => void>();
const SERVER_STATE: BackendState = { waking: false, wakingSince: null, quotaExhausted: false };

function emit() {
  for (const l of listeners) l();
}

export const backendStatus = {
  get: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  setWaking(waking: boolean) {
    if (state.waking === waking) return;
    state = { ...state, waking, wakingSince: waking ? Date.now() : null };
    emit();
  },
  setQuota(quotaExhausted: boolean) {
    if (state.quotaExhausted === quotaExhausted) return;
    state = { ...state, quotaExhausted };
    emit();
  },
};

export function reportApiError(err: unknown) {
  const code = (err as { code?: string } | null)?.code;
  if (code === "backend_starting") backendStatus.setWaking(true);
  if (code === "quota_exhausted") backendStatus.setQuota(true);
}

export function useBackendStatus() {
  return useSyncExternalStore(backendStatus.subscribe, backendStatus.get, () => SERVER_STATE);
}
