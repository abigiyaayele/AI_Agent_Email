import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiAuth, sameOrigin } from "@/server/auth/api";
import { db } from "@/server/db/client";
import { pushSubscriptions } from "@/server/db/schema";

const Sub = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().max(500), auth: z.string().max(500) }),
});

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Bad origin" }, { status: 403 });
  const auth = await apiAuth();
  if (auth instanceof NextResponse) return auth;
  const parsed = Sub.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  const { endpoint, keys } = parsed.data;
  await db()
    .insert(pushSubscriptions)
    .values({ userId: auth.user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: auth.user.id, p256dh: keys.p256dh, auth: keys.auth } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Bad origin" }, { status: 403 });
  const auth = await apiAuth();
  if (auth instanceof NextResponse) return auth;
  const body = z.object({ endpoint: z.string() }).safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  await db()
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, body.data.endpoint), eq(pushSubscriptions.userId, auth.user.id)));
  return NextResponse.json({ ok: true });
}
