import { NextResponse, type NextRequest } from "next/server";

const PUBLIC = ["/login", "/register", "/offline", "/api/cron", "/api/health"];

/**
 * Cheap edge check: send visitors without a session cookie to the sign-in page.
 * Real authorization (session lookup, ownership checks) happens on the server for every request.
 */
export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (req.cookies.has("gf_session")) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icons/|manifest.webmanifest|sw.js|favicon.ico|robots.txt).*)"],
};
