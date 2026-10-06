import { NextResponse, type NextRequest } from "next/server";
import { auth, appUserFrom } from "@/auth";
import { apiAccess } from "@/lib/roles";
import { claimsFor, mintBackendToken } from "@/lib/server/backend-token";
import { serverEnv } from "@/lib/server/env";
import { isWorkspaceId, WS_COOKIE, workspaceCookieOptions } from "@/lib/server/workspace";

/**
 * Authenticated proxy: /api/v1/* → ${BACKEND_URL}/v1/* (SPEC §12.2, API_CONTRACT §1).
 * Reads the Auth.js session, enforces roles per path prefix, mints a 5-minute ES256 JWT
 * and streams SSE responses through unbuffered. With MOCK_BACKEND=true it serves lib/mock.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_BODY_BYTES = 16 * 1024;
/** Time allowed for the backend to send response headers before we report a cold start. */
const HEADERS_TIMEOUT_MS = { default: 12_000, stream: 25_000 };

function apiError(status: number, code: string, message: string, requestId?: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status, headers: requestId ? { "X-Request-Id": requestId } : undefined },
  );
}

const starting = (rid: string) =>
  apiError(503, "backend_starting", "Starting the free server — this takes up to a minute after it has been idle.", rid);

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const requestId = req.headers.get("x-request-id")?.slice(0, 128) || crypto.randomUUID();
  const { path = [] } = await ctx.params;
  const segments = path.map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });

  const user = appUserFrom(await auth());
  if (!user) return apiError(401, "unauthorized", "Please sign in.", requestId);

  const access = apiAccess(user.role, segments);
  if (access === "not_found") return apiError(404, "not_found", "Unknown API route.", requestId);
  if (access === "forbidden") return apiError(403, "forbidden", "Your role can't access this.", requestId);

  // Demo workspace id: reuse the browser's cookie, or create one now.
  let ws = req.cookies.get(WS_COOKIE)?.value;
  let newWs: string | null = null;
  if (!isWorkspaceId(ws)) {
    ws = crypto.randomUUID();
    newWs = ws;
  }
  const claims = claimsFor(user, ws);

  let bodyText: string | undefined;
  if (req.method === "POST") {
    bodyText = await req.text();
    if (bodyText.length > MAX_BODY_BYTES) return apiError(413, "validation_error", "Request body too large.", requestId);
  }

  const withWs = (res: Response) => {
    res.headers.set("X-Request-Id", requestId);
    if (newWs) {
      const o = workspaceCookieOptions();
      const parts = [`${WS_COOKIE}=${newWs}`, `Path=${o.path}`, `Max-Age=${o.maxAge}`, "HttpOnly", "SameSite=Lax"];
      if (o.secure) parts.push("Secure");
      res.headers.append("Set-Cookie", parts.join("; "));
    }
    return res;
  };

  /* ---------------- Mock mode (development) ---------------- */
  if (serverEnv.mockBackend()) {
    const { handleMock } = await import("@/lib/mock/handler");
    let body: unknown = undefined;
    if (bodyText) {
      try {
        body = JSON.parse(bodyText);
      } catch {
        return apiError(422, "validation_error", "Body must be JSON.", requestId);
      }
    }
    const res = await handleMock({
      method: req.method,
      segments,
      search: req.nextUrl.searchParams,
      body,
      claims,
      signal: req.signal,
    });
    return withWs(res);
  }

  /* ---------------- Real backend ---------------- */
  const base = serverEnv.backendUrl();
  if (!base) return apiError(500, "internal", "BACKEND_URL is not configured.", requestId);

  let token: string;
  try {
    token = await mintBackendToken(claims);
  } catch {
    return apiError(500, "internal", "The web server can't sign backend requests (JWT_PRIVATE_KEY).", requestId);
  }

  const target = `${base}/v1/${segments.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
  const isStream =
    (req.method === "POST" && segments[0] === "threads" && segments[2] === "messages") ||
    (req.method === "GET" && segments[0] === "threads" && segments[2] === "events");

  const headers = new Headers({
    Authorization: `Bearer ${token}`,
    "X-Request-Id": requestId,
    Accept: isStream ? "text/event-stream" : "application/json",
  });
  if (bodyText !== undefined) headers.set("Content-Type", "application/json");

  // Abort when the browser disconnects, or when the backend doesn't answer in time (cold start).
  const upstreamCtl = new AbortController();
  const onClientAbort = () => upstreamCtl.abort();
  req.signal.addEventListener("abort", onClientAbort, { once: true });
  const timer = setTimeout(() => upstreamCtl.abort(), isStream ? HEADERS_TIMEOUT_MS.stream : HEADERS_TIMEOUT_MS.default);

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: bodyText,
      signal: upstreamCtl.signal,
      cache: "no-store",
      redirect: "manual",
    });
  } catch {
    clearTimeout(timer);
    req.signal.removeEventListener("abort", onClientAbort);
    if (req.signal.aborted) return new Response(null, { status: 499 });
    return withWs(starting(requestId));
  }
  clearTimeout(timer);

  const contentType = upstream.headers.get("content-type") ?? "";

  // Render returns 502/503/504 (often HTML) while the free instance spins up.
  if ([502, 503, 504].includes(upstream.status)) {
    if (contentType.includes("application/json")) {
      const data = (await upstream.json().catch(() => null)) as { error?: { code?: string } } | null;
      if (data?.error?.code && data.error.code !== "backend_starting") {
        return withWs(NextResponse.json(data, { status: upstream.status }));
      }
    } else {
      await upstream.body?.cancel().catch(() => {});
    }
    return withWs(starting(requestId));
  }

  const outHeaders = new Headers();
  outHeaders.set("X-Request-Id", upstream.headers.get("x-request-id") ?? requestId);
  if (contentType) outHeaders.set("Content-Type", contentType);

  if (contentType.includes("text/event-stream")) {
    // Pass the stream through untouched — no buffering, no transforms.
    outHeaders.set("Cache-Control", "no-cache, no-transform");
    outHeaders.set("Connection", "keep-alive");
    outHeaders.set("X-Accel-Buffering", "no");
    return withWs(new Response(upstream.body, { status: upstream.status, headers: outHeaders }));
  }

  req.signal.removeEventListener("abort", onClientAbort);
  outHeaders.set("Cache-Control", "no-store");
  if (upstream.status === 204) return withWs(new Response(null, { status: 204, headers: outHeaders }));
  return withWs(new Response(upstream.body, { status: upstream.status, headers: outHeaders }));
}

export { proxy as GET, proxy as POST, proxy as DELETE };
