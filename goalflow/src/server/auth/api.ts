import "server-only";
import { NextResponse } from "next/server";
import { getAuth, type AuthContext } from "./session";

/** For route handlers: resolve the user or return a 401 response. */
export async function apiAuth(): Promise<AuthContext | NextResponse> {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return auth;
}

/** Reject cross-site state-changing requests to JSON endpoints. */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
