import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/server/env";

/** Unauthenticated passthrough to ${BACKEND_URL}/healthz for the "server waking up" screen. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TIMEOUT_MS = 4_000;
const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  if (serverEnv.mockBackend()) {
    const { mockIsWaking } = await import("@/lib/mock/handler");
    if (mockIsWaking()) return NextResponse.json({ status: "starting" }, { status: 503, headers: noStore });
    return NextResponse.json(
      { status: "ok", db: true, redis: true, mcp: true, version: "mock", mock: true },
      { headers: noStore },
    );
  }

  const base = serverEnv.backendUrl();
  if (!base) return NextResponse.json({ status: "unconfigured" }, { status: 503, headers: noStore });

  try {
    const res = await fetch(`${base}/healthz`, {
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("application/json")) {
      return NextResponse.json({ status: "starting" }, { status: 503, headers: noStore });
    }
    const data = (await res.json()) as Record<string, unknown>;
    return NextResponse.json(data, { headers: noStore });
  } catch {
    return NextResponse.json({ status: "starting" }, { status: 503, headers: noStore });
  }
}
