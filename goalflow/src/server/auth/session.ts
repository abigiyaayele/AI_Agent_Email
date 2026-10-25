import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/server/db/client";
import { sessions, userPreferences, users, type Preferences, type User } from "@/server/db/schema";

export const SESSION_COOKIE = "gf_session";
const SESSION_DAYS = 30;
const REFRESH_AFTER_MS = 24 * 3600 * 1000;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Create a session row and set an httpOnly cookie. Only the token's hash is stored. */
export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const ua = (await headers()).get("user-agent")?.slice(0, 300) ?? null;
  await db().insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt, userAgent: ua });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db().delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  jar.delete(SESSION_COOKIE);
}

export type AuthContext = { user: Pick<User, "id" | "email" | "name">; prefs: Preferences };

/** Resolve the signed-in user from the session cookie. Cached per request. */
export const getAuth = cache(async (): Promise<AuthContext | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const rows = await db()
    .select({ session: sessions, user: { id: users.id, email: users.email, name: users.name }, prefs: userPreferences })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(userPreferences, eq(userPreferences.userId, users.id))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (Date.now() - row.session.lastSeenAt.getTime() > REFRESH_AFTER_MS) {
    // Sliding expiry, at most once a day per session.
    await db()
      .update(sessions)
      .set({ lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000) })
      .where(eq(sessions.id, row.session.id));
  }
  return { user: row.user, prefs: row.prefs };
});

/** Use in server components and actions: never trust a client-supplied user id. */
export async function requireAuth(): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) redirect("/login");
  return auth;
}

export async function purgeExpiredSessions() {
  await db().delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
