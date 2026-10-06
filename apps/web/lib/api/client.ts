import type { z } from "zod";
import { reportApiError } from "@/lib/backend-status";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
  get isWaking() {
    return this.code === "backend_starting";
  }
  get isQuota() {
    return this.code === "quota_exhausted";
  }
}

const FALLBACK_MESSAGES: Record<number, [string, string]> = {
  401: ["unauthorized", "Your session ended. Please sign in again."],
  403: ["forbidden", "You don't have access to this."],
  404: ["not_found", "We couldn't find that."],
  409: ["already_decided", "This was already decided."],
  422: ["validation_error", "Please check the input and try again."],
  429: ["rate_limited", "Too many requests — please wait a moment."],
  503: ["backend_starting", "Starting the free server — this takes up to a minute after it has been idle."],
};

export async function toApiError(res: Response): Promise<ApiError> {
  let code: string | undefined;
  let message: string | undefined;
  try {
    const data = (await res.json()) as { error?: { code?: string; message?: string } };
    code = data?.error?.code;
    message = data?.error?.message;
  } catch {
    /* not JSON */
  }
  const fb = FALLBACK_MESSAGES[res.status] ?? ["internal", "Something went wrong. Please try again."];
  return new ApiError(res.status, code ?? fb[0], message || fb[1]);
}

export interface ApiOptions<T> {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  schema?: z.ZodType<T>;
  signal?: AbortSignal;
}

/** Calls the Next.js proxy at /api/v1/<path>. Throws ApiError on non-2xx. */
export async function api<T = unknown>(path: string, opts: ApiOptions<T> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/v1/${path.replace(/^\/+/, "")}`, {
      method: opts.method ?? "GET",
      headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch (e) {
    if ((e as Error)?.name === "AbortError") throw e;
    const err = new ApiError(0, "network", "Can't reach the server. Check your connection and try again.");
    throw err;
  }
  if (!res.ok) {
    const err = await toApiError(res);
    reportApiError(err);
    throw err;
  }
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json();
  if (opts.schema) {
    const parsed = opts.schema.safeParse(data);
    if (parsed.success) return parsed.data;
    // Contract drift: keep the UI working, but make it loud in the console.
    console.warn(`[api] response for ${path} doesn't match the contract`, parsed.error.issues);
  }
  return data as T;
}
