import { createWorkspace } from "./fixtures";
import type { BusListener, MockCustomer, Workspace } from "./types";

/**
 * In-memory per-workspace store for MOCK_BACKEND=true. Lives on globalThis so it
 * survives dev hot reloads and is shared by all route handler instances.
 */
const g = globalThis as unknown as { __rpMockWorkspaces?: Map<string, Workspace> };
const workspaces: Map<string, Workspace> = (g.__rpMockWorkspaces ??= new Map());

const MAX_WORKSPACES = 200;

export function getWorkspace(wsId: string): Workspace {
  let ws = workspaces.get(wsId);
  if (!ws) {
    if (workspaces.size >= MAX_WORKSPACES) {
      const oldest = [...workspaces.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
      if (oldest) workspaces.delete(oldest.id);
    }
    ws = createWorkspace(wsId);
    workspaces.set(wsId, ws);
  }
  return ws;
}

export function customerFor(ws: Workspace, persona: string | null | undefined): MockCustomer | null {
  // GitHub customers (no persona) are mapped to the first demo customer.
  const key = persona ?? "maya";
  return ws.customers.find((c) => c.persona === key) ?? null;
}

export function subscribe(ws: Workspace, threadId: string, fn: BusListener) {
  let set = ws.listeners.get(threadId);
  if (!set) {
    set = new Set();
    ws.listeners.set(threadId, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) ws.listeners.delete(threadId);
  };
}

export function publish(ws: Workspace, threadId: string, event: string, data: unknown) {
  const set = ws.listeners.get(threadId);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(event, data);
    } catch {
      /* listener errors never break the publisher */
    }
  }
}

export function nowIso() {
  return new Date().toISOString();
}
