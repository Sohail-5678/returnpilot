import { NextResponse } from "next/server";
import { auth, appUserFrom } from "@/auth";
import { canAccessPage, homeFor, isProtectedPage } from "@/lib/roles";
import { isWorkspaceId, WS_COOKIE, workspaceCookieOptions } from "@/lib/server/workspace";

/**
 * Route guards (Next 16 `proxy`, formerly middleware). UI convenience only — the
 * backend re-checks role and ownership on every request.
 */
export const proxy = auth((req) => {
  const { pathname, search } = req.nextUrl;
  const user = appUserFrom(req.auth);

  let res: NextResponse;
  if (isProtectedPage(pathname) && !user) {
    const url = new URL("/login", req.nextUrl.origin);
    url.searchParams.set("next", `${pathname}${search}`);
    res = NextResponse.redirect(url);
  } else if (user && !canAccessPage(user.role, pathname)) {
    const url = new URL(homeFor(user.role), req.nextUrl.origin);
    url.searchParams.set("denied", pathname);
    res = NextResponse.redirect(url);
  } else {
    res = NextResponse.next();
  }

  // Ensure every signed-in browser has a demo workspace id.
  if (user && !isWorkspaceId(req.cookies.get(WS_COOKIE)?.value)) {
    res.cookies.set(WS_COOKIE, crypto.randomUUID(), workspaceCookieOptions());
  }
  return res;
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|icon.svg|apple-icon|opengraph-image|robots.txt|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt)$).*)"],
};
